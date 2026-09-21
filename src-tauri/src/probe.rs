//! ffprobe wrapper for the join/convert tools: one call per file, reduced to
//! the fields the planners compare.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};
use tokio::process::Command;

use crate::export::sanitize;

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoInfo {
    pub index: u32,
    pub codec: String,
    pub pix_fmt: String,
    /// Display size — rotation already applied, which is what ffmpeg's
    /// autorotate hands to filters.
    pub width: u32,
    pub height: u32,
    pub rotation: u32,
    pub fps: f64,
    /// Hash of the decoder config (SPS/PPS…). Two files can share a codec name
    /// yet differ here, and copying one's packets under the other's config
    /// decodes to garbage.
    pub config: String,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioInfo {
    pub index: u32,
    pub codec: String,
    pub sample_rate: u32,
    pub channels: u32,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileProbe {
    pub size_bytes: u64,
    pub duration_sec: f64,
    pub video: Option<VideoInfo>,
    pub audio: Option<AudioInfo>,
}

/// A file handed to a tool. `title` comes with library videos, whose file on
/// disk is just `<uuid>.mp4`.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct SourceFile {
    pub path: String,
    pub title: Option<String>,
}

/// Where downloads live. A file under it has no meaningful name or folder of
/// its own, so tools name it by title and never write next to it.
pub fn managed_root(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("media"))
}

/// A file as the tools see it: probed, or carrying the reason it can't be used.
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub path: String,
    /// Shown in the UI: the library title for a managed file, else the file name.
    pub name: String,
    /// Output file stem, same rule.
    #[serde(skip)]
    pub stem: String,
    pub managed: bool,
    pub probe: Option<FileProbe>,
    /// "unreadable" | "no-video" | "no-audio"
    pub error: Option<&'static str>,
}

pub fn file_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string())
}

pub fn file_stem(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "video".to_string())
}

pub fn file_ext(path: &str) -> String {
    Path::new(path)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

fn num(v: &Value) -> Option<f64> {
    v.as_f64()
        .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
}

// "30000/1001" → 29.97; "0/0" (unknown) → 0.
fn ratio(v: &Value) -> f64 {
    let Some(s) = v.as_str() else { return 0.0 };
    let mut parts = s.split('/');
    let n: f64 = parts.next().and_then(|p| p.parse().ok()).unwrap_or(0.0);
    let d: f64 = parts.next().and_then(|p| p.parse().ok()).unwrap_or(1.0);
    if d == 0.0 {
        0.0
    } else {
        n / d
    }
}

fn rotation(stream: &Value) -> u32 {
    let from_side_data = stream["side_data_list"]
        .as_array()
        .and_then(|l| l.iter().find_map(|d| num(&d["rotation"])));
    let deg = from_side_data
        .or_else(|| num(&stream["tags"]["rotate"]))
        .unwrap_or(0.0) as i64;
    deg.rem_euclid(360) as u32
}

pub fn parse(v: &Value) -> FileProbe {
    let empty = Vec::new();
    let streams = v["streams"].as_array().unwrap_or(&empty);

    // Cover art shows up as a video stream; it isn't one.
    let video = streams
        .iter()
        .find(|s| s["codec_type"] == "video" && s["disposition"]["attached_pic"] != 1)
        .map(|s| {
            let rot = rotation(s);
            let (w, h) = (
                num(&s["width"]).unwrap_or(0.0) as u32,
                num(&s["height"]).unwrap_or(0.0) as u32,
            );
            let (width, height) = if rot % 180 == 90 { (h, w) } else { (w, h) };
            let avg = ratio(&s["avg_frame_rate"]);
            VideoInfo {
                index: num(&s["index"]).unwrap_or(0.0) as u32,
                codec: s["codec_name"].as_str().unwrap_or_default().to_string(),
                pix_fmt: s["pix_fmt"].as_str().unwrap_or_default().to_string(),
                width,
                height,
                rotation: rot,
                fps: if avg > 0.0 {
                    avg
                } else {
                    ratio(&s["r_frame_rate"])
                },
                config: s["extradata_hash"].as_str().unwrap_or_default().to_string(),
            }
        });

    let audio = streams
        .iter()
        .find(|s| s["codec_type"] == "audio")
        .map(|s| AudioInfo {
            index: num(&s["index"]).unwrap_or(0.0) as u32,
            codec: s["codec_name"].as_str().unwrap_or_default().to_string(),
            sample_rate: num(&s["sample_rate"]).unwrap_or(0.0) as u32,
            channels: num(&s["channels"]).unwrap_or(0.0) as u32,
        });

    let duration_sec = num(&v["format"]["duration"])
        .or_else(|| streams.iter().find_map(|s| num(&s["duration"])))
        .unwrap_or(0.0);

    FileProbe {
        size_bytes: num(&v["format"]["size"]).unwrap_or(0.0) as u64,
        duration_sec,
        video,
        audio,
    }
}

pub async fn probe(ffprobe: &Path, src: &str) -> Result<FileProbe, String> {
    let out = Command::new(ffprobe)
        .args([
            "-v",
            "error",
            "-show_format",
            "-show_streams",
            "-show_data_hash",
            "sha256",
            "-of",
            "json",
            src,
        ])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!(
            "ffprobe failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let v: Value = serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())?;
    Ok(parse(&v))
}

/// Probes every path concurrently, keeping input order. A file ffprobe can't
/// read becomes an "unreadable" entry rather than failing the batch.
pub async fn probe_all(
    ffprobe: &Path,
    files: &[SourceFile],
    managed_root: Option<&Path>,
) -> Vec<FileEntry> {
    let probes =
        futures_util::future::join_all(files.iter().map(|f| probe(ffprobe, &f.path))).await;
    files
        .iter()
        .zip(probes)
        .map(|(file, res)| {
            let probe = res.ok().filter(|p| p.video.is_some() || p.audio.is_some());
            let managed = managed_root.is_some_and(|r| Path::new(&file.path).starts_with(r));
            let title = file
                .title
                .as_deref()
                .map(str::trim)
                .filter(|t| managed && !t.is_empty());
            FileEntry {
                path: file.path.clone(),
                name: title.map_or_else(|| file_name(&file.path), str::to_string),
                stem: title.map_or_else(|| file_stem(&file.path), sanitize),
                managed,
                error: if probe.is_none() {
                    Some("unreadable")
                } else {
                    None
                },
                probe,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_streams_and_skips_cover_art() {
        let v = json!({
            "streams": [
                { "index": 0, "codec_type": "video", "codec_name": "mjpeg",
                  "width": 600, "height": 600, "disposition": { "attached_pic": 1 } },
                { "index": 1, "codec_type": "audio", "codec_name": "mp3",
                  "sample_rate": "44100", "channels": 2 }
            ],
            "format": { "duration": "12.5", "size": "2048" }
        });
        let p = parse(&v);
        assert!(p.video.is_none());
        let a = p.audio.unwrap();
        assert_eq!(
            (a.index, a.codec.as_str(), a.sample_rate, a.channels),
            (1, "mp3", 44100, 2)
        );
        assert_eq!((p.duration_sec, p.size_bytes), (12.5, 2048));
    }

    #[test]
    fn rotated_video_reports_display_size() {
        let v = json!({
            "streams": [{
                "index": 0, "codec_type": "video", "codec_name": "hevc",
                "width": 1920, "height": 1080, "avg_frame_rate": "30000/1001",
                "extradata_hash": "SHA256:abc",
                "side_data_list": [{ "rotation": -90 }]
            }],
            "format": {}
        });
        let video = parse(&v).video.unwrap();
        assert_eq!(
            (video.width, video.height, video.rotation),
            (1080, 1920, 270)
        );
        assert!((video.fps - 29.97).abs() < 0.01);
        assert_eq!(video.config, "SHA256:abc");
    }
}
