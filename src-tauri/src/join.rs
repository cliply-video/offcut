//! Video joiner. Same rule as cliply's concatPlan: when every file shares one
//! stream layout the packets are appended untouched (seconds, lossless);
//! otherwise each part is re-encoded to a common shape first, then appended.

use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::binaries::{resolve, Tool};
use crate::convert::{video_encode_args, Quality};
use crate::jobs::{emit, run_ffmpeg, Jobs, Run, ToolProgress};
use crate::media::same_file;
use crate::probe::{file_ext, managed_root, probe_all, FileEntry, SourceFile};

/// Frame rates this close are treated as the same rate.
const FPS_TOLERANCE: f64 = 0.5;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinPlan {
    /// "copy" | "reencode" | "invalid" (a file can't be used)
    pub mode: &'static str,
    /// Why a copy isn't possible: "video-codec" | "decoder-config" | "box" |
    /// "rotation" | "pixel-format" | "audio-presence" | "audio-codec" |
    /// "audio-layout" | "stream-layout"
    pub mismatches: Vec<&'static str>,
    /// Copy mode only: rates differ, so the result has a variable frame rate.
    pub variable_fps: bool,
    pub files: Vec<FileEntry>,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub ext: String,
    pub duration_sec: f64,
}

/// `fps` overrides the re-encode rate; None follows the first video.
pub fn plan(mut files: Vec<FileEntry>, force_reencode: bool, fps_choice: Option<f64>) -> JoinPlan {
    for f in &mut files {
        if f.error.is_none() && f.probe.as_ref().is_some_and(|p| p.video.is_none()) {
            f.error = Some("no-video");
        }
    }

    let mut mismatches: Vec<&'static str> = Vec::new();
    let mut variable_fps = false;
    let (mut width, mut height, mut fps, mut duration_sec) = (0u32, 0u32, 0.0, 0.0);
    let mut ext = "mp4".to_string();

    let usable: Vec<_> = files
        .iter()
        .filter_map(|f| {
            let p = f.probe.as_ref()?;
            Some((f, p, p.video.as_ref()?))
        })
        .collect();

    if let Some((lead_file, lead, lead_v)) = usable.first() {
        fps = if lead_v.fps > 0.0 {
            lead_v.fps.min(60.0)
        } else {
            30.0
        };
        ext = match file_ext(&lead_file.path).as_str() {
            e @ ("mp4" | "mov" | "mkv" | "webm") => e.to_string(),
            "m4v" => "mp4".to_string(),
            // AVI/WMV/FLV… can't all take a stream copy; Matroska carries anything.
            _ => "mkv".to_string(),
        };

        for (_, p, v) in &usable {
            duration_sec += p.duration_sec;
            if u64::from(v.width) * u64::from(v.height) > u64::from(width) * u64::from(height) {
                (width, height) = (v.width, v.height);
            }

            let mut differs = |reason: &'static str, yes: bool| {
                if yes && !mismatches.contains(&reason) {
                    mismatches.push(reason);
                }
            };
            differs("video-codec", v.codec != lead_v.codec);
            differs(
                "decoder-config",
                v.codec == lead_v.codec && v.config != lead_v.config,
            );
            differs("box", (v.width, v.height) != (lead_v.width, lead_v.height));
            differs("rotation", v.rotation != lead_v.rotation);
            differs("pixel-format", v.pix_fmt != lead_v.pix_fmt);
            differs("stream-layout", v.index != lead_v.index);
            match (&p.audio, &lead.audio) {
                (Some(a), Some(la)) => {
                    differs("audio-codec", a.codec != la.codec);
                    differs(
                        "audio-layout",
                        (a.sample_rate, a.channels) != (la.sample_rate, la.channels),
                    );
                    differs("stream-layout", a.index != la.index);
                }
                (None, None) => {}
                _ => differs("audio-presence", true),
            }
            if v.fps > 0.0 && lead_v.fps > 0.0 && (v.fps - lead_v.fps).abs() > FPS_TOLERANCE {
                variable_fps = true;
            }
        }
    }

    // Encoders need even dimensions (4:2:0 chroma).
    width += width % 2;
    height += height % 2;

    let mode = if files.iter().any(|f| f.error.is_some()) {
        "invalid"
    } else if force_reencode || !mismatches.is_empty() {
        "reencode"
    } else {
        "copy"
    };
    if mode == "reencode" {
        ext = "mp4".to_string();
        if let Some(chosen) = fps_choice.filter(|f| (1.0..=120.0).contains(f)) {
            fps = chosen;
        }
    }

    JoinPlan {
        mode,
        mismatches,
        variable_fps: variable_fps && mode == "copy",
        files,
        width,
        height,
        fps,
        ext,
        duration_sec,
    }
}

fn strs(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| s.to_string()).collect()
}

fn concat_list(files: &[PathBuf]) -> String {
    files
        .iter()
        .map(|f| format!("file '{}'", f.to_string_lossy().replace('\'', "'\\''")))
        .collect::<Vec<_>>()
        .join("\n")
}

/// `streams` = the probed (video, audio) indices to carry. "First video stream"
/// isn't safe for source files: cover art is a video stream too.
fn concat_args(list: &Path, hevc: bool, streams: (u32, Option<u32>), out: &Path) -> Vec<String> {
    let mut args = strs(&["-y", "-f", "concat", "-safe", "0", "-i"]);
    args.push(list.to_string_lossy().into_owned());
    args.extend(["-map".into(), format!("0:{}", streams.0)]);
    if let Some(audio) = streams.1 {
        args.extend(["-map".into(), format!("0:{audio}")]);
    }
    args.extend(strs(&["-c", "copy"]));
    let ext = file_ext(&out.to_string_lossy());
    if matches!(ext.as_str(), "mp4" | "mov") {
        if hevc {
            args.extend(strs(&["-tag:v", "hvc1"]));
        }
        args.extend(strs(&["-movflags", "+faststart"]));
    }
    args.push(out.to_string_lossy().into_owned());
    args
}

/// Re-encodes one part to the plan's box / rate / H.264 + AAC 48 kHz stereo so
/// the parts can then be appended with a stream copy. A silent part among
/// parts with sound gets a synthetic silence track.
fn normalize_args(file: &FileEntry, plan: &JoinPlan, any_audio: bool, out: &Path) -> Vec<String> {
    let probe = file.probe.as_ref();
    let v_index = probe.and_then(|p| p.video.as_ref()).map_or(0, |v| v.index);
    let a_index = probe.and_then(|p| p.audio.as_ref()).map(|a| a.index);
    let silent = any_audio && a_index.is_none();
    let (w, h) = (plan.width, plan.height);

    let mut args = strs(&["-y", "-i", &file.path]);
    if silent {
        args.extend(strs(&["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]));
    }
    args.extend(["-map".into(), format!("0:{v_index}")]);
    match a_index {
        Some(i) if any_audio => args.extend(["-map".into(), format!("0:{i}")]),
        _ if silent => args.extend(strs(&["-map", "1:a:0"])),
        _ => args.push("-an".into()),
    }
    args.extend([
        "-vf".into(),
        format!(
            "scale={w}:{h}:force_original_aspect_ratio=decrease,\
             pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={:.3},format=yuv420p",
            plan.fps
        ),
    ]);
    args.extend(video_encode_args("h264", h, Quality::High, None));
    if any_audio {
        args.extend(strs(&[
            "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
        ]));
    }
    if silent {
        // anullsrc never ends on its own.
        args.push("-shortest".into());
    }
    // One timescale across parts keeps the appended timestamps exact.
    args.extend(strs(&["-video_track_timescale", "90000"]));
    args.push(out.to_string_lossy().into_owned());
    args
}

// Removes the scratch dir on every exit path.
struct Scratch(PathBuf);
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Share of the bar given to re-encoding the parts; the final append is fast.
const ENCODE_SHARE: f64 = 0.95;

pub async fn join_files(
    ffmpeg: &Path,
    plan: &JoinPlan,
    out: &Path,
    job_id: &str,
    cancel: &AtomicBool,
    on_progress: &mut (dyn FnMut(f64, usize, &str) + Send),
) -> Result<Run, String> {
    if plan.mode == "invalid" {
        return Err("A file in the list can't be joined".to_string());
    }
    if plan.files.len() < 2 {
        return Err("Add at least two videos to join".to_string());
    }
    // Identity, not spelling: a symlink or a case variant still names the input,
    // and ffmpeg would truncate it before reading a frame.
    if plan
        .files
        .iter()
        .any(|f| same_file(Path::new(&f.path), out))
    {
        return Err("The output would overwrite one of the source files".to_string());
    }

    // Next to the output, not in the system temp dir: that's the volume the
    // user picked, so it's the one with room for a match-sized intermediate.
    let scratch = Scratch(
        out.parent()
            .unwrap_or(Path::new("."))
            .join(format!(".offcut-join-{job_id}")),
    );
    std::fs::create_dir_all(&scratch.0).map_err(|e| e.to_string())?;
    let list = scratch.0.join("list.txt");
    let last = plan.files.len() - 1;

    let parts: Vec<PathBuf> = if plan.mode == "copy" {
        plan.files.iter().map(|f| PathBuf::from(&f.path)).collect()
    } else {
        let any_audio = plan
            .files
            .iter()
            .any(|f| f.probe.as_ref().is_some_and(|p| p.audio.is_some()));
        let total = plan.duration_sec.max(1.0);
        let mut before = 0.0;
        let mut parts = Vec::with_capacity(plan.files.len());
        for (i, file) in plan.files.iter().enumerate() {
            let span = file.probe.as_ref().map_or(0.0, |p| p.duration_sec);
            let part = scratch.0.join(format!("{i:03}.mp4"));
            let args = normalize_args(file, plan, any_audio, &part);
            let run = run_ffmpeg(ffmpeg, &args, span, cancel, &mut |r| {
                on_progress((before + r * span) / total * ENCODE_SHARE, i, &file.name)
            })
            .await?;
            if matches!(run, Run::Cancelled) {
                return Ok(Run::Cancelled);
            }
            before += span;
            parts.push(part);
        }
        parts
    };

    std::fs::write(&list, concat_list(&parts)).map_err(|e| e.to_string())?;
    let lead = plan.files[0].probe.as_ref();
    let hevc = plan.mode == "copy"
        && lead
            .and_then(|p| p.video.as_ref())
            .is_some_and(|v| v.codec == "hevc");
    // Copy mode reads the sources, so it follows the lead's probed layout (the
    // plan only allows a copy when every file shares it). Normalized parts are
    // always video 0, audio 1.
    let streams = if plan.mode == "copy" {
        (
            lead.and_then(|p| p.video.as_ref()).map_or(0, |v| v.index),
            lead.and_then(|p| p.audio.as_ref()).map(|a| a.index),
        )
    } else {
        let any_audio = plan
            .files
            .iter()
            .any(|f| f.probe.as_ref().is_some_and(|p| p.audio.is_some()));
        (0, any_audio.then_some(1))
    };
    let base = if plan.mode == "copy" {
        0.0
    } else {
        ENCODE_SHARE
    };
    let run = run_ffmpeg(
        ffmpeg,
        &concat_args(&list, hevc, streams, out),
        plan.duration_sec,
        cancel,
        &mut |r| on_progress(base + r * (1.0 - base), last, ""),
    )
    .await;
    if !matches!(run, Ok(Run::Done)) {
        let _ = std::fs::remove_file(out);
    }
    run
}

/// Probes the files and says how they'd be joined — shown before anything runs.
#[tauri::command]
pub async fn plan_join(
    app: AppHandle,
    files: Vec<SourceFile>,
    reencode: bool,
    fps: Option<f64>,
) -> Result<JoinPlan, String> {
    let ffprobe =
        resolve(&app, Tool::Ffprobe).ok_or_else(|| "ffprobe is not available".to_string())?;
    let entries = probe_all(&ffprobe, &files, managed_root(&app).as_deref()).await;
    Ok(plan(entries, reencode, fps))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinOutcome {
    cancelled: bool,
    out: String,
    mode: &'static str,
}

#[tauri::command]
pub async fn run_join(
    app: AppHandle,
    jobs: State<'_, Jobs>,
    job_id: String,
    files: Vec<SourceFile>,
    reencode: bool,
    fps: Option<f64>,
    out_path: String,
) -> Result<JoinOutcome, String> {
    let ffmpeg =
        resolve(&app, Tool::Ffmpeg).ok_or_else(|| "ffmpeg is not available".to_string())?;
    let ffprobe =
        resolve(&app, Tool::Ffprobe).ok_or_else(|| "ffprobe is not available".to_string())?;

    let guard = jobs.register(&job_id);
    let entries = probe_all(&ffprobe, &files, managed_root(&app).as_deref()).await;
    let plan = plan(entries, reencode, fps);
    let total = plan.files.len();
    let run = join_files(
        &ffmpeg,
        &plan,
        Path::new(&out_path),
        &job_id,
        &guard.cancel,
        &mut |ratio, index, label| {
            emit(
                &app,
                ToolProgress {
                    job_id: job_id.clone(),
                    percent: ratio * 100.0,
                    index,
                    total,
                    label: label.to_string(),
                },
            )
        },
    )
    .await?;

    Ok(JoinOutcome {
        cancelled: matches!(run, Run::Cancelled),
        out: out_path,
        mode: plan.mode,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::probe::{AudioInfo, FileProbe, VideoInfo};

    fn entry(path: &str, config: &str, size: (u32, u32), audio: Option<&str>) -> FileEntry {
        FileEntry {
            path: path.into(),
            name: path.into(),
            probe: Some(FileProbe {
                size_bytes: 0,
                duration_sec: 5.0,
                video: Some(VideoInfo {
                    codec: "h264".into(),
                    pix_fmt: "yuv420p".into(),
                    width: size.0,
                    height: size.1,
                    fps: 30.0,
                    config: config.into(),
                    ..Default::default()
                }),
                audio: audio.map(|c| AudioInfo {
                    index: 1,
                    codec: c.into(),
                    sample_rate: 48000,
                    channels: 2,
                }),
            }),
            ..Default::default()
        }
    }

    #[test]
    fn matching_files_are_copied() {
        let p = plan(
            vec![
                entry("a.mov", "X", (1920, 1080), Some("aac")),
                entry("b.mov", "X", (1920, 1080), Some("aac")),
            ],
            false,
            None,
        );
        assert_eq!(
            (p.mode, p.ext.as_str(), p.duration_sec),
            ("copy", "mov", 10.0)
        );
        assert!(p.mismatches.is_empty());
    }

    #[test]
    fn same_codec_with_another_decoder_config_is_not_a_copy() {
        let p = plan(
            vec![
                entry("a.mp4", "X", (1920, 1080), Some("aac")),
                entry("b.mp4", "Y", (1920, 1080), Some("aac")),
            ],
            false,
            None,
        );
        assert_eq!((p.mode, p.mismatches), ("reencode", vec!["decoder-config"]));
    }

    #[test]
    fn mixed_parts_reencode_to_the_largest_even_box() {
        let p = plan(
            vec![
                entry("a.mp4", "X", (640, 360), Some("aac")),
                entry("b.mkv", "Y", (1279, 719), None),
            ],
            false,
            None,
        );
        assert_eq!(p.mode, "reencode");
        assert_eq!((p.width, p.height, p.ext.as_str()), (1280, 720, "mp4"));
        assert!(p.mismatches.contains(&"box") && p.mismatches.contains(&"audio-presence"));
    }

    #[test]
    fn differing_rates_only_warn() {
        let mut slow = entry("b.mp4", "X", (1920, 1080), Some("aac"));
        slow.probe.as_mut().unwrap().video.as_mut().unwrap().fps = 25.0;
        let p = plan(
            vec![entry("a.mp4", "X", (1920, 1080), Some("aac")), slow],
            false,
            None,
        );
        assert_eq!((p.mode, p.variable_fps), ("copy", true));
    }

    #[test]
    fn force_and_unusable_files() {
        let files = vec![
            entry("a.mp4", "X", (1920, 1080), Some("aac")),
            entry("b.mp4", "X", (1920, 1080), Some("aac")),
        ];
        assert_eq!(plan(files.clone(), true, None).mode, "reencode");

        let mut audio_only = files.clone();
        audio_only[1].probe.as_mut().unwrap().video = None;
        let p = plan(audio_only, false, None);
        assert_eq!((p.mode, p.files[1].error), ("invalid", Some("no-video")));
    }

    #[test]
    fn a_chosen_rate_only_applies_to_a_reencode() {
        let files = vec![
            entry("a.mp4", "X", (1920, 1080), Some("aac")),
            entry("b.mp4", "X", (1920, 1080), Some("aac")),
        ];
        assert_eq!(plan(files.clone(), false, Some(25.0)).fps, 30.0);
        assert_eq!(plan(files.clone(), true, Some(25.0)).fps, 25.0);
        assert_eq!(plan(files, true, Some(0.0)).fps, 30.0);
    }

    #[test]
    fn silent_part_gets_a_silence_track() {
        let files = vec![
            entry("a.mp4", "X", (1280, 720), Some("aac")),
            entry("b.mp4", "Y", (1280, 720), None),
        ];
        let p = plan(files, false, None);
        let args = normalize_args(&p.files[1], &p, true, Path::new("1.mp4")).join(" ");
        assert!(
            args.contains("anullsrc") && args.contains("-map 1:a:0") && args.contains("-shortest")
        );
        let args = normalize_args(&p.files[0], &p, true, Path::new("0.mp4")).join(" ");
        assert!(args.contains("-map 0:1") && !args.contains("anullsrc"));
    }

    #[test]
    fn copy_mode_maps_the_probed_streams_not_the_first_video() {
        let args =
            concat_args(Path::new("l.txt"), false, (1, Some(2)), Path::new("o.mp4")).join(" ");
        assert!(args.contains("-map 0:1 -map 0:2 -c copy"));
        let silent =
            concat_args(Path::new("l.txt"), false, (0, None), Path::new("o.mkv")).join(" ");
        assert!(silent.contains("-map 0:0 -c copy") && !silent.contains("movflags"));
    }

    #[test]
    fn concat_list_escapes_quotes() {
        assert_eq!(
            concat_list(&[PathBuf::from("/v/it's.mp4")]),
            "file '/v/it'\\''s.mp4'"
        );
    }
}
