//! Clip export from the local media file. Mirrors cliply's worker/ffmpeg.ts:
//! stream-copy cuts (fast, keyframe-aligned) or re-encode (frame-accurate).
//! Layout under the chosen folder:
//!   <Video Title>/<Tag>/NN name.mp4            (individual clips, per-tag dirs)
//!   <Video Title>/Reels/Reel - <Tag>.mp4       (per-tag reels)
//!   <Video Title>/<Video Title> - all clips.mp4 (combined reel)

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{stream, StreamExt};
use serde::{Deserialize, Serialize};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::process::Command;

use crate::binaries::{resolve, Tool};

/// Clips cut concurrently. Bounded so a many-clip export uses several cores
/// without re-creating an unbounded ffmpeg spawn storm.
const CUT_CONCURRENCY: usize = 4;

#[derive(Default)]
pub struct ExportState {
    cancel: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl ExportState {
    /// Flags every running export to stop; returns how many there were.
    pub fn cancel_all(&self) -> usize {
        let exports = self.cancel.lock().unwrap();
        for flag in exports.values() {
            flag.store(true, Ordering::Relaxed);
        }
        exports.len()
    }
}

// Removes the export's cancel flag on any exit path (done, error, cancelled).
struct CancelGuard<'a> {
    state: &'a ExportState,
    id: String,
}
impl Drop for CancelGuard<'_> {
    fn drop(&mut self) {
        self.state.cancel.lock().unwrap().remove(&self.id);
    }
}

enum CutOutcome {
    Done,
    Cancelled,
}

// Resolves once the flag flips to true (polled). Raced against the ffmpeg run.
async fn wait_cancel(cancel: &AtomicBool) {
    while !cancel.load(Ordering::Relaxed) {
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
}

// Runs one cut, killing the ffmpeg child if the export is cancelled. output()
// buffers stdout/stderr (no pipe deadlock); kill_on_drop means dropping the
// future on cancel terminates the child.
async fn run_cut(ffmpeg: &Path, args: &[String], cancel: &AtomicBool) -> Result<CutOutcome, String> {
    if cancel.load(Ordering::Relaxed) {
        return Ok(CutOutcome::Cancelled);
    }
    let fut = Command::new(ffmpeg).args(args).kill_on_drop(true).output();
    tokio::select! {
        out = fut => {
            let out = out.map_err(es)?;
            if out.status.success() {
                Ok(CutOutcome::Done)
            } else {
                let stderr = String::from_utf8_lossy(&out.stderr);
                let tail: Vec<&str> = stderr.lines().rev().take(4).collect();
                Err(format!("ffmpeg failed: {}", tail.into_iter().rev().collect::<Vec<_>>().join(" ")))
            }
        }
        _ = wait_cancel(cancel) => Ok(CutOutcome::Cancelled),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportClip {
    name: Option<String>,
    start_sec: f64,
    end_sec: f64,
    tag_label: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOptions {
    video_id: String,
    video_title: String,
    source_path: String,
    out_dir: String,
    clips: Vec<ExportClip>,
    individual_clips: bool,
    /// "none" | "perTag" | "combined"
    reel_mode: String,
    reencode: bool,
    /// Burn the Cliply mark into the top-right corner. Forces a re-encode.
    watermark: bool,
    /// Cut the clips without their audio track (reels inherit it).
    #[serde(default)]
    mute: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSummary {
    clips: usize,
    reels: usize,
    out_dir: String,
    cancelled: bool,
}

/// Signals an in-flight export to stop; running ffmpeg cuts are killed.
#[tauri::command]
pub fn cancel_export(state: State<'_, ExportState>, video_id: String) {
    if let Some(flag) = state.cancel.lock().unwrap().get(&video_id) {
        flag.store(true, Ordering::Relaxed);
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportProgress {
    video_id: String,
    phase: &'static str,
    done: usize,
    total: usize,
    label: String,
}

fn es(e: impl std::fmt::Display) -> String {
    e.to_string()
}

async fn run_ffmpeg(ffmpeg: &Path, args: &[String]) -> Result<(), String> {
    let out = Command::new(ffmpeg).args(args).output().await.map_err(es)?;
    if out.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&out.stderr);
    let tail: Vec<&str> = stderr.lines().rev().take(4).collect();
    Err(format!(
        "ffmpeg failed: {}",
        tail.into_iter().rev().collect::<Vec<_>>().join(" ")
    ))
}

pub(crate) fn sanitize(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            _ => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() {
        "clip".to_string()
    } else {
        trimmed.chars().take(80).collect()
    }
}

fn reencode_args() -> Vec<String> {
    // VideoToolbox on macOS (hardware, LGPL-clean); libx264 elsewhere.
    #[cfg(target_os = "macos")]
    {
        [
            "-c:v",
            "h264_videotoolbox",
            "-b:v",
            "8M",
            "-allow_sw",
            "1",
            "-c:a",
            "aac",
            "-movflags",
            "+faststart",
        ]
        .map(String::from)
        .to_vec()
    }
    #[cfg(not(target_os = "macos"))]
    {
        [
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-c:a",
            "aac",
            "-movflags",
            "+faststart",
        ]
        .map(String::from)
        .to_vec()
    }
}

// scale2ref naming is inverted: iw/ih = reference video, main_w/main_h = logo.
fn watermark_filter() -> String {
    "[1:v][0:v]scale2ref=w=min(iw\\,ih)*0.08*main_w/main_h:h=min(iw\\,ih)*0.08[wm][base];\
     [base][wm]overlay=W-w-H*0.03:H*0.03,format=yuv420p[v]"
        .replace(char::is_whitespace, "")
}

fn cut_args(
    src: &str,
    watermark: Option<&Path>,
    start: f64,
    end: f64,
    reencode: bool,
    mute: bool,
    out: &Path,
) -> Vec<String> {
    let duration = (end - start).max(0.1);
    let mut args = vec![
        "-y".into(),
        "-ss".into(),
        format!("{start:.3}"),
        "-i".into(),
        src.to_string(),
    ];
    if let Some(logo) = watermark {
        args.push("-i".into());
        args.push(logo.to_string_lossy().into_owned());
    }
    args.push("-t".into());
    args.push(format!("{duration:.3}"));
    if watermark.is_some() {
        // Overlay can't run on a stream copy — always re-encode when watermarking.
        args.extend(["-filter_complex".into(), watermark_filter()]);
        args.extend(["-map".into(), "[v]".into()]);
        if !mute {
            args.extend(["-map".into(), "0:a?".into()]);
        }
        args.extend(reencode_args());
    } else if reencode {
        args.extend(reencode_args());
    } else {
        args.extend(["-c".into(), "copy".into()]);
    }
    if mute {
        args.push("-an".into());
    }
    args.push(out.to_string_lossy().into_owned());
    args
}

async fn concat(
    ffmpeg: &Path,
    files: &[PathBuf],
    list_path: &Path,
    out: &Path,
) -> Result<(), String> {
    let body = files
        .iter()
        .map(|f| format!("file '{}'", f.to_string_lossy().replace('\'', "'\\''")))
        .collect::<Vec<_>>()
        .join("\n");
    std::fs::write(list_path, body).map_err(es)?;
    let args: Vec<String> = [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        &list_path.to_string_lossy(),
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        &out.to_string_lossy(),
    ]
    .map(String::from)
    .to_vec();
    let result = run_ffmpeg(ffmpeg, &args).await;
    let _ = std::fs::remove_file(list_path);
    result
}

/// Async: ffmpeg cuts run concurrently as child processes; an export takes
/// minutes and can be cancelled mid-run via `cancel_export`.
#[tauri::command]
pub async fn export_clips(
    app: AppHandle,
    state: State<'_, ExportState>,
    options: ExportOptions,
) -> Result<ExportSummary, String> {
    if options.clips.is_empty() {
        return Err("No clips to export".to_string());
    }
    let want_reels = options.reel_mode != "none";
    if !options.individual_clips && !want_reels {
        return Err("Pick at least one output (clips or a reel)".to_string());
    }
    if !Path::new(&options.source_path).is_file() {
        return Err("Source video not found — download it first".to_string());
    }
    let ffmpeg = resolve(&app, Tool::Ffmpeg).ok_or_else(|| "ffmpeg is not available".to_string())?;

    // The mascot mark burned into each clip's top-right corner. Bundled resource;
    // if it can't be resolved we skip the overlay rather than fail the export.
    let watermark = if options.watermark {
        app.path()
            .resolve("resources/watermark.png", BaseDirectory::Resource)
            .ok()
            .filter(|p| p.is_file())
    } else {
        None
    };

    let base = PathBuf::from(&options.out_dir).join(sanitize(&options.video_title));
    std::fs::create_dir_all(&base).map_err(es)?;
    // Cut files land in a scratch dir when the user only wants reels.
    let scratch = base.join(".cuts");
    if !options.individual_clips {
        std::fs::create_dir_all(&scratch).map_err(es)?;
    }

    // Register a cancel flag so cancel_export can stop this run; the guard
    // clears it from the map on every exit path.
    let cancel = Arc::new(AtomicBool::new(false));
    state
        .cancel
        .lock()
        .unwrap()
        .insert(options.video_id.clone(), cancel.clone());
    let _guard = CancelGuard {
        state: state.inner(),
        id: options.video_id.clone(),
    };

    let total = options.clips.len();
    let emit = |phase: &'static str, done: usize, total: usize, label: &str| {
        let _ = app.emit(
            "export-progress",
            ExportProgress {
                video_id: options.video_id.clone(),
                phase,
                done,
                total,
                label: label.to_string(),
            },
        );
    };

    // 1a) Plan every cut in timeline order (cheap: paths, per-tag numbering,
    // dirs). Output paths and the ordered file lists are fixed here so reels
    // stay in order regardless of the order cuts actually finish.
    struct Job {
        file: PathBuf,
        start: f64,
        end: f64,
        label: String,
    }
    let mut jobs: Vec<Job> = Vec::with_capacity(total);
    let mut all_files: Vec<PathBuf> = Vec::new();
    let mut by_tag: BTreeMap<String, Vec<PathBuf>> = BTreeMap::new();
    let mut tag_counters: BTreeMap<String, usize> = BTreeMap::new();
    for (i, clip) in options.clips.iter().enumerate() {
        let tag = clip.tag_label.clone().unwrap_or_else(|| "Untagged".into());
        let label = clip
            .name
            .clone()
            .unwrap_or_else(|| format!("clip {}", i + 1));
        let n = tag_counters.entry(tag.clone()).or_insert(0);
        *n += 1;
        let file = if options.individual_clips {
            let dir = base.join(sanitize(&tag));
            std::fs::create_dir_all(&dir).map_err(es)?;
            dir.join(format!("{:02} {}.mp4", n, sanitize(&label)))
        } else {
            scratch.join(format!("{i:03} {}.mp4", sanitize(&label)))
        };
        all_files.push(file.clone());
        by_tag.entry(tag).or_default().push(file.clone());
        jobs.push(Job {
            file,
            start: clip.start_sec,
            end: clip.end_sec,
            label,
        });
    }

    // 1b) Cut in parallel (bounded). Progress counts completions as they land.
    // Futures are built via Iterator::map (not Stream::map) to dodge a
    // higher-ranked lifetime error on the borrowed captures.
    let done = AtomicUsize::new(0);
    emit("clip", 0, total, "");
    let cancel_ref = cancel.as_ref();
    let watermark_ref = watermark.as_deref();
    let cuts = jobs.into_iter().map(|job| {
        let ffmpeg = &ffmpeg;
        let src = &options.source_path;
        let done = &done;
        let emit = &emit;
        async move {
            let outcome = run_cut(
                ffmpeg,
                &cut_args(
                    src,
                    watermark_ref,
                    job.start,
                    job.end,
                    options.reencode,
                    options.mute,
                    &job.file,
                ),
                cancel_ref,
            )
            .await?;
            if matches!(outcome, CutOutcome::Done) {
                let d = done.fetch_add(1, Ordering::Relaxed) + 1;
                emit("clip", d, total, &job.label);
            }
            Ok::<CutOutcome, String>(outcome)
        }
    });
    let results: Vec<Result<CutOutcome, String>> =
        stream::iter(cuts).buffer_unordered(CUT_CONCURRENCY).collect().await;
    let mut cancelled = cancel.load(Ordering::Relaxed);
    for r in results {
        if matches!(r?, CutOutcome::Cancelled) {
            cancelled = true;
        }
    }

    // Stop before reels; leave any finished cuts in place (non-destructive).
    if cancelled {
        if !options.individual_clips {
            let _ = std::fs::remove_dir_all(&scratch);
        }
        return Ok(ExportSummary {
            clips: 0,
            reels: 0,
            out_dir: base.to_string_lossy().into_owned(),
            cancelled: true,
        });
    }

    // 2) Reels (concat of already-cut files: same codec ⇒ copy-safe).
    let mut reels = 0usize;
    match options.reel_mode.as_str() {
        "perTag" => {
            let reel_dir = base.join("Reels");
            std::fs::create_dir_all(&reel_dir).map_err(es)?;
            let reel_total = by_tag.len();
            for (idx, (tag, files)) in by_tag.iter().enumerate() {
                emit("reel", idx, reel_total, tag);
                concat(
                    &ffmpeg,
                    files,
                    &reel_dir.join(format!(".concat-{idx}.txt")),
                    &reel_dir.join(format!("Reel - {}.mp4", sanitize(tag))),
                )
                .await?;
                reels += 1;
                emit("reel", idx + 1, reel_total, tag);
            }
        }
        "combined" => {
            emit("reel", 0, 1, "all clips");
            concat(
                &ffmpeg,
                &all_files,
                &base.join(".concat-all.txt"),
                &base.join(format!("{} - all clips.mp4", sanitize(&options.video_title))),
            )
            .await?;
            reels = 1;
            emit("reel", 1, 1, "all clips");
        }
        _ => {}
    }

    if !options.individual_clips {
        let _ = std::fs::remove_dir_all(&scratch);
    }

    Ok(ExportSummary {
        clips: if options.individual_clips { total } else { 0 },
        reels,
        out_dir: base.to_string_lossy().into_owned(),
        cancelled: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(watermark: bool, reencode: bool, mute: bool) -> String {
        let logo = Path::new("logo.png");
        cut_args("in.mp4", watermark.then_some(logo), 10.0, 15.0, reencode, mute, Path::new("out.mp4"))
            .join(" ")
    }

    #[test]
    fn muting_a_cut_keeps_it_a_stream_copy() {
        let muted = args(false, false, true);
        assert!(muted.contains("-c copy -an") && muted.ends_with("out.mp4"));
        assert!(!args(false, false, false).contains("-an"));
    }

    #[test]
    fn muting_drops_the_audio_map_from_a_watermarked_cut() {
        let muted = args(true, false, true);
        assert!(muted.contains("-map [v]") && !muted.contains("0:a?") && muted.contains("-an"));
        assert!(args(true, false, false).contains("-map 0:a?"));
        assert!(args(false, true, true).contains("-an"));
    }
}
