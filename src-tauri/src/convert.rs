//! Format converter. Same rule as cliply's convertPlan: keep a stream whenever
//! the target container plays it as-is (a remux, seconds), and re-encode only
//! what actually has to change.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::binaries::{resolve, Tool};
use crate::jobs::{emit, run_ffmpeg, Jobs, Run, ToolProgress};
use crate::probe::{managed_root, probe_all, FileEntry, FileProbe, SourceFile};

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Quality {
    Low,
    Medium,
    High,
    VeryHigh,
}

impl Quality {
    fn parse(s: Option<&str>) -> Option<Quality> {
        match s? {
            "low" => Some(Quality::Low),
            "medium" => Some(Quality::Medium),
            "high" => Some(Quality::High),
            "veryHigh" => Some(Quality::VeryHigh),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertTarget {
    /// "mp4" | "mov" | "mkv" | "webm" | "mp3" | "m4a" | "wav"
    pub container: String,
    /// "auto" keeps the source codec when the container plays it.
    pub video_codec: String,
    /// "none" strips the audio track (ignored by the audio-only containers).
    pub audio_codec: String,
    /// Set = the user asked for a specific size/quality trade, so re-encode.
    pub quality: Option<String>,
    /// Exact video bitrate. Wins over `quality`.
    pub video_kbps: Option<u32>,
    /// Size each output should land near; the bitrate is derived per file from
    /// its duration. Wins over both.
    pub size_mb: Option<f64>,
    pub height: Option<u32>,
    pub fps: Option<f64>,
}

const CONTAINERS: [&str; 7] = ["mp4", "mov", "mkv", "webm", "mp3", "m4a", "wav"];

fn audio_only(container: &str) -> bool {
    matches!(container, "mp3" | "m4a" | "wav")
}

// What plays reliably, not what the spec allows: MP4 can legally carry VP9 or
// Opus, but QuickTime and Windows reject them.
fn plays_video(container: &str, codec: &str) -> bool {
    match container {
        "mp4" => matches!(codec, "h264" | "hevc" | "av1"),
        "mov" => matches!(codec, "h264" | "hevc" | "prores"),
        "mkv" => !codec.is_empty(),
        "webm" => matches!(codec, "vp8" | "vp9" | "av1"),
        _ => false,
    }
}

fn plays_audio(container: &str, codec: &str) -> bool {
    match container {
        "mp4" => matches!(codec, "aac" | "mp3" | "ac3" | "eac3"),
        "mov" => matches!(codec, "aac" | "alac" | "ac3" | "pcm_s16le" | "pcm_s24le"),
        "mkv" => !codec.is_empty(),
        "webm" => matches!(codec, "opus" | "vorbis"),
        "m4a" => matches!(codec, "aac" | "alac"),
        "mp3" => codec == "mp3",
        "wav" => matches!(codec, "pcm_s16le" | "pcm_s24le"),
        _ => false,
    }
}

fn video_encoder(container: &str, wanted: &str) -> &'static str {
    match (container, wanted) {
        ("webm", _) => "vp9",
        ("mkv", "vp9") => "vp9",
        (_, "hevc") => "hevc",
        _ => "h264",
    }
}

fn audio_encoder(container: &str, wanted: &str) -> &'static str {
    match (container, wanted) {
        ("webm", _) => "opus",
        ("mp3", _) => "mp3",
        ("wav", _) => "pcm_s16le",
        ("mkv", "opus") => "opus",
        ("mp4" | "mkv", "mp3") => "mp3",
        _ => "aac",
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Op {
    Drop,
    Copy,
    Encode(&'static str),
}

#[derive(Clone, Debug)]
pub struct Decision {
    pub video: Op,
    pub audio: Op,
    pub scale_height: Option<u32>,
    pub fps: Option<f64>,
    pub quality: Quality,
    /// Bitrate-driven encode (explicit, or derived from a target size).
    pub video_kbps: Option<u32>,
}

/// Audio rate reserved inside a target size: fixed, so the video share is known.
const SIZED_AUDIO_KBPS: u32 = 128;
const MIN_VIDEO_KBPS: u32 = 100;

// Container overhead and single-pass rate control both overshoot a little.
fn sized_video_kbps(size_mb: f64, duration_sec: f64, has_audio: bool) -> u32 {
    let total = size_mb * 8000.0 * 0.97 / duration_sec.max(1.0);
    let audio = if has_audio {
        f64::from(SIZED_AUDIO_KBPS)
    } else {
        0.0
    };
    ((total - audio).max(0.0) as u32).max(MIN_VIDEO_KBPS)
}

impl Decision {
    /// "copy" (remux) | "audio" (video kept, audio re-encoded) | "reencode"
    pub fn verdict(&self) -> &'static str {
        match (&self.video, &self.audio) {
            (Op::Encode(_), _) | (Op::Drop, Op::Encode(_)) => "reencode",
            (Op::Copy, Op::Encode(_)) => "audio",
            _ => "copy",
        }
    }
}

pub fn decide(probe: &FileProbe, t: &ConvertTarget) -> Result<Decision, &'static str> {
    let container = t.container.as_str();
    let quality = Quality::parse(t.quality.as_deref());
    let mute = t.audio_codec == "none" && !audio_only(container);
    let sized = t.size_mb.filter(|mb| *mb > 0.0 && !audio_only(container));
    let video_kbps = match sized {
        Some(mb) => Some(sized_video_kbps(
            mb,
            probe.duration_sec,
            probe.audio.is_some() && !mute,
        )),
        None => t.video_kbps.filter(|k| *k > 0 && !audio_only(container)),
    };
    let mut scale_height = None;
    let mut fps = None;

    let video = if audio_only(container) {
        Op::Drop
    } else {
        let v = probe.video.as_ref().ok_or("no-video")?;
        scale_height = t.height.filter(|h| v.height > *h);
        fps = t.fps.filter(|f| v.fps > 0.0 && (v.fps - f).abs() > 0.5);
        let keeps_codec =
            t.video_codec == "auto" || video_encoder(container, &t.video_codec) == v.codec;
        if keeps_codec
            && plays_video(container, &v.codec)
            && scale_height.is_none()
            && fps.is_none()
            && quality.is_none()
            && video_kbps.is_none()
        {
            Op::Copy
        } else {
            let wanted = if t.video_codec == "auto" && plays_video(container, &v.codec) {
                v.codec.as_str()
            } else {
                t.video_codec.as_str()
            };
            Op::Encode(video_encoder(container, wanted))
        }
    };

    let audio = match &probe.audio {
        None if audio_only(container) => return Err("no-audio"),
        None => Op::Drop,
        Some(_) if mute => Op::Drop,
        Some(a) => {
            let keeps_codec =
                t.audio_codec == "auto" || audio_encoder(container, &t.audio_codec) == a.codec;
            // A target size only adds up if the audio share is known. And for an
            // audio-only output the quality level IS the request: copying an MP3
            // into an MP3 at "low" would hand back the same file.
            let requalify = audio_only(container) && quality.is_some();
            if keeps_codec && plays_audio(container, &a.codec) && sized.is_none() && !requalify {
                Op::Copy
            } else {
                Op::Encode(audio_encoder(container, &t.audio_codec))
            }
        }
    };

    Ok(Decision {
        video,
        audio,
        scale_height,
        fps,
        quality: match (sized, quality) {
            (Some(_), _) => Quality::Medium,
            (None, q) => q.unwrap_or(Quality::High),
        },
        video_kbps,
    })
}

fn video_kbps(codec: &str, height: u32, quality: Quality) -> u32 {
    let base = match height {
        0..=480 => 2500.0,
        481..=720 => 5000.0,
        721..=1080 => 8000.0,
        1081..=1440 => 16000.0,
        _ => 35000.0,
    };
    let scale = match quality {
        Quality::Low => 0.4,
        Quality::Medium => 0.65,
        Quality::High => 1.0,
        Quality::VeryHigh => 1.6,
    };
    let codec_gain = if codec == "hevc" { 0.6 } else { 1.0 };
    (base * scale * codec_gain) as u32
}

fn strs(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| s.to_string()).collect()
}

/// Encoder flags for `codec` at the given output height. H.264/HEVC use
/// VideoToolbox on macOS (hardware, bitrate-driven) and x264/x265 CRF elsewhere.
/// `kbps` switches every encoder to that exact bitrate instead.
pub fn video_encode_args(
    codec: &str,
    height: u32,
    quality: Quality,
    kbps: Option<u32>,
) -> Vec<String> {
    encode_args_for(codec, height, quality, kbps, cfg!(target_os = "macos"))
}

// `hardware` is a parameter rather than a #[cfg] split so both encoder paths
// compile and are tested on every platform, not just the one they ship on.
pub(crate) fn encode_args_for(
    codec: &str,
    height: u32,
    quality: Quality,
    kbps: Option<u32>,
    hardware: bool,
) -> Vec<String> {
    let crf = match quality {
        Quality::Low => 28,
        Quality::Medium => 23,
        Quality::High => 20,
        Quality::VeryHigh => 17,
    };
    if codec == "vp9" {
        let mut args = strs(&["-c:v", "libvpx-vp9", "-row-mt", "1", "-cpu-used", "4"]);
        match kbps {
            Some(k) => args.extend(strs(&["-b:v", &format!("{k}k")])),
            None => args.extend(strs(&["-crf", &(crf + 11).to_string(), "-b:v", "0"])),
        }
        return args;
    }
    let hevc = codec == "hevc";
    let mut args = if hardware {
        let encoder = if hevc {
            "hevc_videotoolbox"
        } else {
            "h264_videotoolbox"
        };
        let rate = format!(
            "{}k",
            kbps.unwrap_or_else(|| video_kbps(codec, height, quality))
        );
        strs(&["-c:v", encoder, "-b:v", &rate, "-allow_sw", "1"])
    } else {
        let (encoder, crf) = if hevc {
            ("libx265", crf + 4)
        } else {
            ("libx264", crf)
        };
        let mut args = strs(&["-c:v", encoder, "-preset", "fast"]);
        match kbps {
            // maxrate/bufsize keep a single pass honest about the size it lands on.
            Some(k) => args.extend(strs(&[
                "-b:v",
                &format!("{k}k"),
                "-maxrate",
                &format!("{k}k"),
                "-bufsize",
                &format!("{}k", k * 2),
            ])),
            None => args.extend(strs(&["-crf", &crf.to_string()])),
        }
        args
    };
    if hevc {
        // Without hvc1 QuickTime won't open HEVC in MP4/MOV.
        args.extend(strs(&["-tag:v", "hvc1"]));
    }
    args
}

fn audio_encode_args(codec: &str, quality: Quality) -> Vec<String> {
    let rate = match quality {
        Quality::Low => "96k",
        Quality::Medium => "128k",
        Quality::High => "192k",
        Quality::VeryHigh => "256k",
    };
    match codec {
        "opus" => strs(&["-c:a", "libopus", "-b:a", rate]),
        "mp3" => strs(&["-c:a", "libmp3lame", "-b:a", rate]),
        "pcm_s16le" => strs(&["-c:a", "pcm_s16le"]),
        _ => strs(&["-c:a", "aac", "-b:a", rate]),
    }
}

pub fn convert_args(
    src: &str,
    probe: &FileProbe,
    d: &Decision,
    container: &str,
    out: &Path,
) -> Vec<String> {
    let mut args = strs(&["-y", "-i", src]);

    match (&d.video, &probe.video) {
        (Op::Drop, _) | (_, None) => args.push("-vn".into()),
        (op, Some(v)) => {
            args.extend(["-map".into(), format!("0:{}", v.index)]);
            match op {
                Op::Encode(codec) => {
                    let mut filters = Vec::new();
                    if let Some(h) = d.scale_height {
                        filters.push(format!("scale=-2:{h}"));
                    }
                    if let Some(f) = d.fps {
                        filters.push(format!("fps={f}"));
                    }
                    filters.push("format=yuv420p".into());
                    args.extend(["-vf".into(), filters.join(",")]);
                    args.extend(video_encode_args(
                        codec,
                        d.scale_height.unwrap_or(v.height),
                        d.quality,
                        d.video_kbps,
                    ));
                }
                _ => {
                    args.extend(strs(&["-c:v", "copy"]));
                    if v.codec == "hevc" && matches!(container, "mp4" | "mov") {
                        args.extend(strs(&["-tag:v", "hvc1"]));
                    }
                }
            }
        }
    }

    match (&d.audio, &probe.audio) {
        (Op::Drop, _) | (_, None) => args.push("-an".into()),
        (op, Some(a)) => {
            args.extend(["-map".into(), format!("0:{}", a.index)]);
            match op {
                Op::Encode(codec) => args.extend(audio_encode_args(codec, d.quality)),
                _ => args.extend(strs(&["-c:a", "copy"])),
            }
        }
    }

    if matches!(container, "mp4" | "mov" | "m4a") {
        args.extend(strs(&["-movflags", "+faststart"]));
    }
    args.push(out.to_string_lossy().into_owned());
    args
}

/// First free `<stem>.<ext>`, then `<stem> (1).<ext>`… Checks the disk too, so
/// converting next to the source never overwrites it.
pub fn unique_out(dir: &Path, stem: &str, ext: &str, taken: &mut HashSet<PathBuf>) -> PathBuf {
    let mut n = 0;
    loop {
        let name = if n == 0 {
            format!("{stem}.{ext}")
        } else {
            format!("{stem} ({n}).{ext}")
        };
        let path = dir.join(name);
        if !path.exists() && taken.insert(path.clone()) {
            return path;
        }
        n += 1;
    }
}

/// Where outputs go: the folder the user chose, else next to each source —
/// except a library download, which lives in app data and goes to `fallback`
/// (the Downloads folder) instead.
#[derive(Default)]
pub struct OutDirs {
    pub chosen: Option<PathBuf>,
    pub fallback: Option<PathBuf>,
}

impl OutDirs {
    fn of(app: &AppHandle, chosen: Option<String>) -> OutDirs {
        OutDirs {
            chosen: chosen.map(PathBuf::from),
            fallback: app.path().download_dir().ok(),
        }
    }

    pub fn for_entry(&self, entry: &FileEntry) -> PathBuf {
        let next_to_source = || {
            Path::new(&entry.path)
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_default()
        };
        match (&self.chosen, &self.fallback) {
            (Some(dir), _) => dir.clone(),
            (None, Some(dir)) if entry.managed => dir.clone(),
            _ => next_to_source(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertItem {
    #[serde(flatten)]
    entry: FileEntry,
    verdict: Option<&'static str>,
    out_dir: String,
}

fn check_target(target: &ConvertTarget) -> Result<(), String> {
    if CONTAINERS.contains(&target.container.as_str()) {
        Ok(())
    } else {
        Err(format!("unsupported format: {}", target.container))
    }
}

/// Probes the files and reports, per file, whether the target is a fast copy
/// or a re-encode — shown in the list before anything runs.
#[tauri::command]
pub async fn plan_convert(
    app: AppHandle,
    files: Vec<SourceFile>,
    target: ConvertTarget,
    out_dir: Option<String>,
) -> Result<Vec<ConvertItem>, String> {
    check_target(&target)?;
    let ffprobe =
        resolve(&app, Tool::Ffprobe).ok_or_else(|| "ffprobe is not available".to_string())?;
    let dirs = OutDirs::of(&app, out_dir);
    let items = probe_all(&ffprobe, &files, managed_root(&app).as_deref())
        .await
        .into_iter()
        .map(|mut entry| {
            let decision = entry.probe.as_ref().map(|p| decide(p, &target));
            let verdict = match decision {
                Some(Ok(d)) => Some(d.verdict()),
                Some(Err(code)) => {
                    entry.error = Some(code);
                    None
                }
                None => None,
            };
            ConvertItem {
                out_dir: dirs.for_entry(&entry).to_string_lossy().into_owned(),
                entry,
                verdict,
            }
        })
        .collect();
    Ok(items)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertedFile {
    src: String,
    out: String,
    verdict: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FailedFile {
    name: String,
    error: String,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertSummary {
    outputs: Vec<ConvertedFile>,
    failed: Vec<FailedFile>,
    cancelled: bool,
}

/// Converts one file at a time. A file that fails is reported and skipped so
/// one bad input can't sink the batch.
pub async fn convert_files(
    ffmpeg: &Path,
    entries: &[FileEntry],
    target: &ConvertTarget,
    dirs: &OutDirs,
    cancel: &AtomicBool,
    on_progress: &mut (dyn FnMut(f64, usize, &str) + Send),
) -> ConvertSummary {
    let weight = |e: &FileEntry| e.probe.as_ref().map_or(1.0, |p| p.duration_sec.max(1.0));
    let total: f64 = entries.iter().map(weight).sum();
    let mut before = 0.0;
    let mut taken = HashSet::new();
    let mut summary = ConvertSummary::default();

    for (i, entry) in entries.iter().enumerate() {
        let span = weight(entry);
        let planned = match (&entry.probe, entry.error) {
            (Some(probe), None) => decide(probe, target).map(|d| (probe, d)),
            (_, err) => Err(err.unwrap_or("unreadable")),
        };
        let (probe, decision) = match planned {
            Ok(p) => p,
            Err(code) => {
                summary.failed.push(FailedFile {
                    name: entry.name.clone(),
                    error: code.to_string(),
                });
                before += span;
                continue;
            }
        };

        let dir = dirs.for_entry(entry);
        let _ = std::fs::create_dir_all(&dir);
        let out = unique_out(&dir, &entry.stem, &target.container, &mut taken);
        let args = convert_args(&entry.path, probe, &decision, &target.container, &out);

        on_progress(before / total, i, &entry.name);
        let result = run_ffmpeg(ffmpeg, &args, probe.duration_sec, cancel, &mut |r| {
            on_progress((before + r * span) / total, i, &entry.name)
        })
        .await;

        match result {
            Ok(Run::Done) => summary.outputs.push(ConvertedFile {
                src: entry.path.clone(),
                out: out.to_string_lossy().into_owned(),
                verdict: decision.verdict(),
            }),
            Ok(Run::Cancelled) => {
                let _ = std::fs::remove_file(&out);
                summary.cancelled = true;
                return summary;
            }
            Err(error) => {
                let _ = std::fs::remove_file(&out);
                summary.failed.push(FailedFile {
                    name: entry.name.clone(),
                    error,
                });
            }
        }
        before += span;
    }
    summary
}

#[tauri::command]
pub async fn run_convert(
    app: AppHandle,
    jobs: State<'_, Jobs>,
    job_id: String,
    files: Vec<SourceFile>,
    target: ConvertTarget,
    out_dir: Option<String>,
) -> Result<ConvertSummary, String> {
    check_target(&target)?;
    if files.is_empty() {
        return Err("No files to convert".to_string());
    }
    let ffmpeg =
        resolve(&app, Tool::Ffmpeg).ok_or_else(|| "ffmpeg is not available".to_string())?;
    let ffprobe =
        resolve(&app, Tool::Ffprobe).ok_or_else(|| "ffprobe is not available".to_string())?;
    if let Some(dir) = &out_dir {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let dirs = OutDirs::of(&app, out_dir);

    let guard = jobs.register(&job_id);
    let entries = probe_all(&ffprobe, &files, managed_root(&app).as_deref()).await;
    let total = entries.len();
    let summary = convert_files(
        &ffmpeg,
        &entries,
        &target,
        &dirs,
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
    .await;
    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::probe::{AudioInfo, VideoInfo};

    fn probe(vcodec: &str, acodec: Option<&str>, height: u32) -> FileProbe {
        FileProbe {
            size_bytes: 0,
            duration_sec: 10.0,
            video: Some(VideoInfo {
                codec: vcodec.into(),
                width: height * 16 / 9,
                height,
                fps: 30.0,
                ..Default::default()
            }),
            audio: acodec.map(|c| AudioInfo {
                index: 1,
                codec: c.into(),
                sample_rate: 48000,
                channels: 2,
            }),
        }
    }

    fn target(container: &str) -> ConvertTarget {
        ConvertTarget {
            container: container.into(),
            video_codec: "auto".into(),
            audio_codec: "auto".into(),
            ..Default::default()
        }
    }

    #[test]
    fn container_change_alone_is_a_remux() {
        let d = decide(&probe("h264", Some("aac"), 1080), &target("mp4")).unwrap();
        assert_eq!((d.video.clone(), d.audio.clone()), (Op::Copy, Op::Copy));
        assert_eq!(d.verdict(), "copy");
    }

    #[test]
    fn unplayable_audio_is_swapped_without_touching_video() {
        let d = decide(&probe("h264", Some("opus"), 1080), &target("mp4")).unwrap();
        assert_eq!(
            (d.video.clone(), d.audio.clone()),
            (Op::Copy, Op::Encode("aac"))
        );
        assert_eq!(d.verdict(), "audio");
    }

    #[test]
    fn codec_the_container_cannot_play_is_reencoded() {
        let d = decide(&probe("vp9", Some("opus"), 1080), &target("mp4")).unwrap();
        assert_eq!(d.video, Op::Encode("h264"));
        let d = decide(&probe("h264", Some("aac"), 1080), &target("webm")).unwrap();
        assert_eq!((d.video, d.audio), (Op::Encode("vp9"), Op::Encode("opus")));
    }

    #[test]
    fn quality_or_a_smaller_height_forces_a_reencode() {
        let mut t = target("mp4");
        t.height = Some(720);
        let d = decide(&probe("h264", Some("aac"), 1080), &t).unwrap();
        assert_eq!(
            (d.video.clone(), d.scale_height),
            (Op::Encode("h264"), Some(720))
        );
        assert_eq!(d.audio, Op::Copy);

        // Never upscale: a 480p source under a 720p cap stays a copy.
        let d = decide(&probe("h264", Some("aac"), 480), &t).unwrap();
        assert_eq!((d.video, d.scale_height), (Op::Copy, None));

        let mut t = target("mp4");
        t.quality = Some("medium".into());
        assert_eq!(
            decide(&probe("h264", None, 480), &t).unwrap().video,
            Op::Encode("h264")
        );
    }

    #[test]
    fn a_bitrate_or_target_size_drives_the_encode() {
        let mut t = target("mp4");
        t.video_kbps = Some(4000);
        let d = decide(&probe("h264", Some("aac"), 1080), &t).unwrap();
        assert_eq!(
            (d.video.clone(), d.video_kbps, d.audio.clone()),
            (Op::Encode("h264"), Some(4000), Op::Copy)
        );
        // Bitrate-driven on both encoder paths; CRF only without one.
        for hardware in [true, false] {
            let args = encode_args_for("h264", 1080, d.quality, d.video_kbps, hardware).join(" ");
            assert!(
                args.contains("-b:v 4000k") && !args.contains("-crf"),
                "{args}"
            );
        }
        let software = encode_args_for("hevc", 1080, Quality::High, None, false).join(" ");
        assert_eq!(software, "-c:v libx265 -preset fast -crf 24 -tag:v hvc1");

        // 25 MB over 10 s ≈ 19.4 Mbps total; audio is pinned so the video share is exact.
        let mut t = target("mp4");
        t.size_mb = Some(25.0);
        let d = decide(&probe("h264", Some("aac"), 1080), &t).unwrap();
        assert_eq!(d.audio, Op::Encode("aac"));
        assert_eq!(
            d.video_kbps,
            Some((25.0 * 8000.0 * 0.97 / 10.0) as u32 - SIZED_AUDIO_KBPS)
        );

        // An impossible size still produces a playable file.
        t.size_mb = Some(0.01);
        assert_eq!(
            decide(&probe("h264", None, 1080), &t).unwrap().video_kbps,
            Some(MIN_VIDEO_KBPS)
        );

        // Neither applies to an audio-only target.
        let mut t = target("mp3");
        t.size_mb = Some(5.0);
        assert_eq!(
            decide(&probe("h264", Some("aac"), 1080), &t)
                .unwrap()
                .video_kbps,
            None
        );
    }

    #[test]
    fn explicit_codec_is_honored_and_kept_when_it_already_matches() {
        let mut t = target("mp4");
        t.video_codec = "hevc".into();
        assert_eq!(
            decide(&probe("h264", None, 1080), &t).unwrap().video,
            Op::Encode("hevc")
        );
        assert_eq!(
            decide(&probe("hevc", None, 1080), &t).unwrap().video,
            Op::Copy
        );
    }

    #[test]
    fn audio_targets_drop_video_and_need_an_audio_stream() {
        let d = decide(&probe("h264", Some("aac"), 1080), &target("mp3")).unwrap();
        assert_eq!((d.video, d.audio), (Op::Drop, Op::Encode("mp3")));
        let d = decide(&probe("h264", Some("aac"), 1080), &target("m4a")).unwrap();
        assert_eq!(d.verdict(), "copy");
        assert_eq!(
            decide(&probe("h264", None, 1080), &target("mp3")).unwrap_err(),
            "no-audio"
        );

        let mut audio_file = probe("h264", Some("mp3"), 1080);
        audio_file.video = None;
        assert_eq!(decide(&audio_file, &target("mp4")).unwrap_err(), "no-video");
    }

    #[test]
    fn stripping_the_audio_is_still_a_fast_copy() {
        let mut t = target("mp4");
        t.audio_codec = "none".into();
        let p = probe("h264", Some("aac"), 1080);
        let d = decide(&p, &t).unwrap();
        assert_eq!(
            (d.video.clone(), d.audio.clone(), d.verdict()),
            (Op::Copy, Op::Drop, "copy")
        );
        let args = convert_args("in.mp4", &p, &d, "mp4", Path::new("out.mp4")).join(" ");
        assert!(args.contains("-an") && !args.contains("-map 0:1"));

        // The whole target size goes to the video once there's no audio to pay for.
        t.size_mb = Some(25.0);
        assert_eq!(
            decide(&p, &t).unwrap().video_kbps,
            Some((25.0 * 8000.0 * 0.97 / 10.0) as u32)
        );

        // A quality level on an audio-only output is a real re-encode, not a copy.
        let mut mp3 = probe("h264", Some("mp3"), 1080);
        mp3.video = None;
        let mut t = target("mp3");
        assert_eq!(decide(&mp3, &t).unwrap().verdict(), "copy");
        t.quality = Some("low".into());
        assert_eq!(decide(&mp3, &t).unwrap().audio, Op::Encode("mp3"));

        // An audio-only output can't be muted; the flag is ignored there.
        let mut t = target("mp3");
        t.audio_codec = "none".into();
        assert_eq!(decide(&p, &t).unwrap().audio, Op::Encode("mp3"));
    }

    #[test]
    fn args_map_the_probed_streams() {
        let p = probe("h264", Some("opus"), 1080);
        let d = decide(&p, &target("mp4")).unwrap();
        let args = convert_args("in.mkv", &p, &d, "mp4", Path::new("out.mp4")).join(" ");
        assert!(args.starts_with("-y -i in.mkv -map 0:0 -c:v copy -map 0:1 -c:a aac"));
        assert!(args.ends_with("-movflags +faststart out.mp4"));
    }

    #[test]
    fn library_downloads_never_land_in_app_data() {
        let file = |managed| FileEntry {
            path: "/app/media/uuid.mp4".into(),
            managed,
            ..Default::default()
        };
        let auto = OutDirs {
            chosen: None,
            fallback: Some("/home/Downloads".into()),
        };
        assert_eq!(
            auto.for_entry(&file(true)),
            PathBuf::from("/home/Downloads")
        );
        assert_eq!(auto.for_entry(&file(false)), PathBuf::from("/app/media"));

        let chosen = OutDirs {
            chosen: Some("/out".into()),
            ..auto
        };
        assert_eq!(chosen.for_entry(&file(true)), PathBuf::from("/out"));
    }

    #[test]
    fn unique_out_never_reuses_a_name() {
        let dir = std::env::temp_dir();
        let mut taken = HashSet::new();
        let a = unique_out(&dir, "offcut-unique-test", "mp4", &mut taken);
        let b = unique_out(&dir, "offcut-unique-test", "mp4", &mut taken);
        assert_eq!(a.file_name().unwrap(), "offcut-unique-test.mp4");
        assert_eq!(b.file_name().unwrap(), "offcut-unique-test (1).mp4");
    }
}
