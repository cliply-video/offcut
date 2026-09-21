//! Local media helpers: read analysis XML (BOM-aware) and generate clip
//! poster frames with ffmpeg.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::OnceLock;

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tokio::process::Command;
use tokio::sync::Semaphore;

use crate::binaries::{resolve, Tool};

fn es(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// Caps concurrent poster ffmpeg jobs. A 300-clip XML mounts 300 cards at once,
/// each calling generate_poster; without a gate that spawns 300 ffmpeg
/// processes simultaneously and hammers the whole machine (CPU/FD/memory).
fn poster_gate() -> &'static Semaphore {
    static SEM: OnceLock<Semaphore> = OnceLock::new();
    SEM.get_or_init(|| Semaphore::new(4))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    /// ffprobe codec_name of the first video stream (e.g. "h264", "hevc",
    /// "av1"). Empty when unknown.
    vcodec: String,
    duration_sec: f64,
}

/// Probes a media file for its primary video codec and duration via ffprobe.
/// Drives export defaults (h264 → stream-copy, else re-encode) and clip-end
/// clamping. Errors only when ffprobe is missing or the file is unreadable;
/// missing fields degrade to "" / 0.0 so callers treat them as unknown.
#[tauri::command]
pub async fn probe_media(app: AppHandle, src: String) -> Result<MediaInfo, String> {
    let ffprobe =
        resolve(&app, Tool::Ffprobe).ok_or_else(|| "ffprobe is not available".to_string())?;
    let out = Command::new(&ffprobe)
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=codec_name",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
            &src,
        ])
        .output()
        .await
        .map_err(es)?;
    if !out.status.success() {
        return Err(format!(
            "ffprobe failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).map_err(es)?;
    let vcodec = v["streams"]
        .get(0)
        .and_then(|s| s["codec_name"].as_str())
        .unwrap_or_default()
        .to_string();
    let duration_sec = v["format"]["duration"]
        .as_str()
        .and_then(|d| d.parse::<f64>().ok())
        .unwrap_or(0.0);
    Ok(MediaInfo {
        vcodec,
        duration_sec,
    })
}

/// Removes a video's downloaded media file (app-data/media/<id>.mp4) and its
/// clip posters (app-data/posters/<clip_id>.jpg). Best-effort — absent files
/// are ignored. Never touches a local source path outside app data, so
/// deleting a locally-picked video leaves the user's own file intact. The DB
/// rows are removed by the caller.
#[tauri::command]
pub fn delete_media(app: AppHandle, video_id: String, clip_ids: Vec<String>) -> Result<(), String> {
    let data = app.path().app_data_dir().map_err(es)?;
    let _ = std::fs::remove_file(data.join("media").join(format!("{video_id}.mp4")));
    let posters = data.join("posters");
    for id in clip_ids {
        let _ = std::fs::remove_file(posters.join(format!("{id}.jpg")));
    }
    Ok(())
}

/// Reads an XML file and decodes it, honoring a UTF-16/UTF-8 BOM. NacSport and
/// SportsCode (Windows) frequently export UTF-16, which a plain UTF-8 read
/// would corrupt.
#[tauri::command]
pub fn read_xml_file(path: String) -> Result<String, String> {
    let buf = std::fs::read(&path).map_err(es)?;
    Ok(decode(&buf))
}

/// Fetches analysis XML over HTTP(S) and decodes it BOM-aware, same as a local
/// read — lets users point at an XML hosted next to their video instead of a
/// local file.
#[tauri::command]
pub async fn fetch_xml_url(url: String) -> Result<String, String> {
    let res = reqwest::get(&url).await.map_err(es)?;
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status().as_u16()));
    }
    let bytes = res.bytes().await.map_err(es)?;
    Ok(decode(&bytes))
}

fn decode(buf: &[u8]) -> String {
    if buf.starts_with(&[0xff, 0xfe]) {
        let u: Vec<u16> = buf[2..]
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        return String::from_utf16_lossy(&u);
    }
    if buf.starts_with(&[0xfe, 0xff]) {
        let u: Vec<u16> = buf[2..]
            .chunks_exact(2)
            .map(|c| u16::from_be_bytes([c[0], c[1]]))
            .collect();
        return String::from_utf16_lossy(&u);
    }
    if buf.starts_with(&[0xef, 0xbb, 0xbf]) {
        return String::from_utf8_lossy(&buf[3..]).into_owned();
    }
    String::from_utf8_lossy(buf).into_owned()
}

/// Copies a file (used to save a downloaded video out to a user-chosen path
/// when no XML is imported).
#[tauri::command]
pub async fn copy_file(src: String, dest: String) -> Result<(), String> {
    blocking(move || copy_guarded(Path::new(&src), Path::new(&dest))).await
}

/// Moves a file, falling back to copy + delete across volumes (rename can't
/// cross them). Used to hand a downloaded video over to a user-chosen path
/// without leaving a multi-GB duplicate in app data.
#[tauri::command]
pub async fn move_file(src: String, dest: String) -> Result<(), String> {
    blocking(move || {
        let (src, dest) = (Path::new(&src), Path::new(&dest));
        if same_file(src, dest) || std::fs::rename(src, dest).is_ok() {
            return Ok(());
        }
        copy_guarded(src, dest)?;
        let _ = std::fs::remove_file(src);
        Ok(())
    })
    .await
}

// A sync command runs on the main thread; copying a match-sized file there
// freezes the window until it's done.
async fn blocking<F>(work: F) -> Result<(), String>
where
    F: FnOnce() -> Result<(), String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(es)?
}

/// True when both paths name one file on disk — also through a symlink, a hard
/// link, or another spelling on a case-insensitive volume. Writing "to" such a
/// path truncates the source before a byte is read.
pub(crate) fn same_file(a: &Path, b: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        match (std::fs::metadata(a), std::fs::metadata(b)) {
            (Ok(ma), Ok(mb)) => ma.dev() == mb.dev() && ma.ino() == mb.ino(),
            _ => false,
        }
    }
    #[cfg(not(unix))]
    {
        match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
            (Ok(ca), Ok(cb)) => ca == cb,
            _ => false,
        }
    }
}

// std::fs::copy onto the source itself "succeeds" and leaves it empty.
fn copy_guarded(src: &Path, dest: &Path) -> Result<(), String> {
    if same_file(src, dest) {
        return Ok(());
    }
    if let Err(e) = std::fs::copy(src, dest) {
        let _ = std::fs::remove_file(dest);
        return Err(es(e));
    }
    Ok(())
}

fn posters_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(es)?.join("posters");
    std::fs::create_dir_all(&dir).map_err(es)?;
    Ok(dir)
}

/// Extracts a single frame at `t_sec` from `src` to <app-data>/posters/<id>.jpg
/// and returns its path. Cached: re-requesting an existing poster is a no-op.
#[tauri::command]
pub async fn generate_poster(
    app: AppHandle,
    clip_id: String,
    src: String,
    t_sec: f64,
) -> Result<String, String> {
    let out = posters_dir(&app)?.join(format!("{clip_id}.jpg"));
    let out_str = out.to_string_lossy().into_owned();
    if out.is_file() {
        return Ok(out_str);
    }
    let ffmpeg =
        resolve(&app, Tool::Ffmpeg).ok_or_else(|| "ffmpeg is not available".to_string())?;

    // Held across the ffmpeg run; bounds simultaneous poster jobs.
    let _permit = poster_gate().acquire().await.map_err(es)?;

    let status = Command::new(&ffmpeg)
        .args([
            "-y",
            "-ss",
            &format!("{t_sec:.3}"),
            "-i",
            &src,
            "-frames:v",
            "1",
            // Grid shows these ~168px wide; a full 1080p frame is wasted encode,
            // disk and paint. Downscale to a thumbnail (even height for the
            // encoder).
            "-vf",
            "scale=360:-2",
            "-q:v",
            "3",
            &out_str,
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .map_err(es)?;

    if !status.success() || !out.is_file() {
        return Err("could not generate poster".to_string());
    }
    Ok(out_str)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copying_a_file_onto_itself_leaves_it_intact() {
        let dir = std::env::temp_dir().join(format!("offcut-media-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("match.mp4");
        std::fs::write(&file, b"not empty").unwrap();

        // The same file under another spelling, as a save dialog can hand back.
        let alias = dir.join(".").join("match.mp4");
        assert!(same_file(&file, &alias));
        copy_guarded(&file, &alias).unwrap();
        assert_eq!(std::fs::read(&file).unwrap(), b"not empty");

        let other = dir.join("copy.mp4");
        assert!(!same_file(&file, &other));
        copy_guarded(&file, &other).unwrap();
        assert_eq!(std::fs::read(&other).unwrap(), b"not empty");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
