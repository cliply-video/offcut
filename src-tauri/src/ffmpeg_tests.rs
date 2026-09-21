//! End-to-end checks of join/convert against a real ffmpeg. Skipped (pass) when
//! ffmpeg/ffprobe aren't on PATH, e.g. on CI runners.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::AtomicBool;

use crate::convert::{convert_files, ConvertTarget, OutDirs};
use crate::jobs::{Jobs, Run, EXIT_GRACE};
use crate::join::{join_files, plan};
use crate::probe::{probe, FileEntry, SourceFile};

async fn probe_all(ffprobe: &Path, paths: &[String]) -> Vec<FileEntry> {
    let files: Vec<SourceFile> = paths
        .iter()
        .map(|p| SourceFile {
            path: p.clone(),
            title: None,
        })
        .collect();
    crate::probe::probe_all(ffprobe, &files, None).await
}

fn on_path(name: &str) -> Option<PathBuf> {
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .map(|d| d.join(name))
            .find(|p| p.is_file())
    })
}

struct Bench {
    ffmpeg: PathBuf,
    ffprobe: PathBuf,
    dir: PathBuf,
}

impl Drop for Bench {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

impl Bench {
    fn new(name: &str) -> Option<Bench> {
        let bench = Bench {
            ffmpeg: on_path("ffmpeg")?,
            ffprobe: on_path("ffprobe")?,
            dir: std::env::temp_dir().join(format!("offcut-it-{name}-{}", std::process::id())),
        };
        std::fs::create_dir_all(&bench.dir).unwrap();
        Some(bench)
    }

    fn path(&self, name: &str) -> String {
        self.dir.join(name).to_string_lossy().into_owned()
    }

    fn ffmpeg(&self, args: &[&str]) {
        let ok = Command::new(&self.ffmpeg)
            .args(["-v", "error", "-y"])
            .args(args)
            .status()
            .unwrap()
            .success();
        assert!(ok, "fixture ffmpeg failed: {args:?}");
    }

    /// size like "1280x720"; `tone` adds an AAC sine track.
    fn clip(&self, name: &str, size: &str, fps: &str, secs: &str, tone: bool) -> String {
        let out = self.path(name);
        let video = format!("testsrc2=s={size}:r={fps}:d={secs}");
        let audio = format!("sine=f=440:d={secs}");
        let mut args = vec!["-f", "lavfi", "-i", &video];
        if tone {
            args.extend(["-f", "lavfi", "-i", &audio, "-c:a", "aac", "-shortest"]);
        }
        args.extend(["-c:v", "libx264", "-pix_fmt", "yuv420p", &out]);
        self.ffmpeg(&args);
        out
    }
}

fn block_on<F: std::future::Future>(f: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(f)
}

#[test]
fn cuts_of_one_source_join_as_a_copy() {
    let Some(b) = Bench::new("copy") else { return };
    let src = b.clip("src.mp4", "640x360", "30", "4", true);
    let (p1, p2) = (b.path("p1.mp4"), b.path("p2.mp4"));
    b.ffmpeg(&["-i", &src, "-t", "2", "-c", "copy", &p1]);
    b.ffmpeg(&["-ss", "2", "-i", &src, "-c", "copy", &p2]);

    block_on(async {
        let plan = plan(probe_all(&b.ffprobe, &[p1, p2]).await, false, None);
        assert_eq!(plan.mode, "copy", "mismatches: {:?}", plan.mismatches);

        let out = b.path("joined.mp4");
        let cancel = AtomicBool::new(false);
        let run = join_files(
            &b.ffmpeg,
            &plan,
            Path::new(&out),
            "t",
            &cancel,
            &mut |_, _, _| {},
        )
        .await
        .unwrap();
        assert!(matches!(run, Run::Done));
        let joined = probe(&b.ffprobe, &out).await.unwrap();
        assert!(
            (joined.duration_sec - 4.0).abs() < 0.5,
            "{}",
            joined.duration_sec
        );
        assert!(!b.dir.join(".offcut-join-t").exists());
    });
}

#[test]
fn mismatched_parts_are_normalized_then_joined() {
    let Some(b) = Bench::new("reencode") else {
        return;
    };
    let big = b.clip("big.mp4", "1280x720", "30", "2", true);
    let small_silent = b.clip("small.mp4", "640x480", "25", "2", false);

    block_on(async {
        let plan = plan(
            probe_all(&b.ffprobe, &[small_silent, big]).await,
            false,
            None,
        );
        assert_eq!(plan.mode, "reencode");
        assert!(plan.mismatches.contains(&"box") && plan.mismatches.contains(&"audio-presence"));
        assert_eq!((plan.width, plan.height), (1280, 720));

        let out = b.path("joined.mp4");
        let cancel = AtomicBool::new(false);
        let mut last = 0.0;
        let run = join_files(
            &b.ffmpeg,
            &plan,
            Path::new(&out),
            "t",
            &cancel,
            &mut |r, _, _| {
                assert!(r >= last - 1e-9, "progress went backwards: {last} → {r}");
                last = r;
            },
        )
        .await
        .unwrap();
        assert!(matches!(run, Run::Done));
        assert!((last - 1.0).abs() < 1e-9);

        let joined = probe(&b.ffprobe, &out).await.unwrap();
        let v = joined.video.unwrap();
        assert_eq!((v.width, v.height, v.codec.as_str()), (1280, 720, "h264"));
        assert!((v.fps - 25.0).abs() < 0.5);
        assert!(joined.audio.is_some());
        assert!(
            (joined.duration_sec - 4.0).abs() < 0.5,
            "{}",
            joined.duration_sec
        );
    });
}

#[test]
fn a_cancelled_join_leaves_nothing_behind() {
    let Some(b) = Bench::new("cancel") else {
        return;
    };
    let a = b.clip("a.mp4", "320x240", "30", "1", false);
    let c = b.clip("c.mp4", "640x480", "30", "1", false);

    block_on(async {
        let plan = plan(probe_all(&b.ffprobe, &[a, c]).await, false, None);
        let out = b.path("joined.mp4");
        let cancel = AtomicBool::new(true);
        let run = join_files(
            &b.ffmpeg,
            &plan,
            Path::new(&out),
            "t",
            &cancel,
            &mut |_, _, _| {},
        )
        .await
        .unwrap();
        assert!(matches!(run, Run::Cancelled));
        assert!(!Path::new(&out).exists() && !b.dir.join(".offcut-join-t").exists());
    });
}

#[test]
fn cancelling_mid_encode_kills_ffmpeg_and_cleans_up() {
    let Some(b) = Bench::new("midcancel") else {
        return;
    };
    let long = b.clip("long.mp4", "1920x1080", "30", "20", false);
    let other = b.clip("other.mp4", "640x480", "30", "1", false);

    block_on(async {
        let plan = plan(probe_all(&b.ffprobe, &[long, other]).await, false, None);
        let out = b.path("joined.mp4");
        let cancel = std::sync::Arc::new(AtomicBool::new(false));
        let flag = cancel.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(400));
            flag.store(true, std::sync::atomic::Ordering::Relaxed);
        });
        let started = std::time::Instant::now();
        let run = join_files(
            &b.ffmpeg,
            &plan,
            Path::new(&out),
            "t",
            &cancel,
            &mut |_, _, _| {},
        )
        .await
        .unwrap();
        assert!(matches!(run, Run::Cancelled));
        assert!(
            started.elapsed().as_secs() < 5,
            "cancel didn't interrupt the encode"
        );
        assert!(!Path::new(&out).exists() && !b.dir.join(".offcut-join-t").exists());
    });
}

// What the app's exit hook relies on: flag every job, and within the grace
// period ffmpeg is dead and the scratch dir is gone.
#[test]
fn cancel_all_winds_a_running_job_down_within_the_exit_grace() {
    let Some(b) = Bench::new("exit") else { return };
    let long = b.clip("long.mp4", "1920x1080", "30", "20", false);
    let other = b.clip("other.mp4", "640x480", "30", "1", false);

    block_on(async {
        let plan = plan(probe_all(&b.ffprobe, &[long, other]).await, false, None);
        let out = b.path("joined.mp4");
        let jobs = std::sync::Arc::new(Jobs::default());
        let guard = jobs.register("exit");

        let at_exit = jobs.clone();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(400));
            let flagged = std::time::Instant::now();
            tx.send((at_exit.cancel_all(), flagged)).unwrap();
        });

        let run = join_files(
            &b.ffmpeg,
            &plan,
            Path::new(&out),
            "exit",
            &guard.cancel,
            &mut |_, _, _| {},
        )
        .await
        .unwrap();
        let (running, flagged) = rx.recv().unwrap();

        assert_eq!(running, 1);
        assert!(matches!(run, Run::Cancelled));
        assert!(
            flagged.elapsed() < EXIT_GRACE,
            "wind-down took {:?}, longer than the exit grace",
            flagged.elapsed()
        );
        assert!(!Path::new(&out).exists() && !b.dir.join(".offcut-join-exit").exists());
    });
}

#[test]
fn converts_by_remux_audio_extract_and_reencode() {
    let Some(b) = Bench::new("convert") else {
        return;
    };
    let src = b.clip("match.mp4", "640x360", "30", "2", true);
    let not_media = b.path("notes.mp4");
    std::fs::write(&not_media, "not a video").unwrap();

    let target = |container: &str, height: Option<u32>| ConvertTarget {
        container: container.into(),
        video_codec: "auto".into(),
        audio_codec: "auto".into(),
        quality: None,
        video_kbps: None,
        size_mb: None,
        height,
        fps: None,
    };

    block_on(async {
        let entries = probe_all(&b.ffprobe, &[src.clone(), not_media]).await;
        let cancel = AtomicBool::new(false);
        let run = async |t: ConvertTarget, dir: Option<&str>| {
            let dirs = OutDirs {
                chosen: dir.map(PathBuf::from),
                fallback: None,
            };
            serde_json::to_value(
                convert_files(&b.ffmpeg, &entries, &t, &dirs, &cancel, &mut |_, _, _| {}).await,
            )
            .unwrap()
        };

        // Same folder as the source, same extension: must not clobber it.
        let s = run(target("mp4", None), None).await;
        assert_eq!(s["outputs"][0]["verdict"], "copy");
        assert!(s["outputs"][0]["out"]
            .as_str()
            .unwrap()
            .ends_with("match (1).mp4"));
        assert_eq!(s["failed"][0]["error"], "unreadable");

        let out_dir = b.path("out");
        std::fs::create_dir_all(&out_dir).unwrap();
        let s = run(target("mp3", None), Some(&out_dir)).await;
        let mp3 = probe(&b.ffprobe, s["outputs"][0]["out"].as_str().unwrap())
            .await
            .unwrap();
        assert!(mp3.video.is_none());
        assert_eq!(mp3.audio.unwrap().codec, "mp3");

        let s = run(target("mkv", Some(240)), Some(&out_dir)).await;
        assert_eq!(s["outputs"][0]["verdict"], "reencode");
        let mkv = probe(&b.ffprobe, s["outputs"][0]["out"].as_str().unwrap())
            .await
            .unwrap();
        assert_eq!(mkv.video.unwrap().height, 240);
        assert_eq!(mkv.audio.unwrap().codec, "aac");

        // Muting: video copied, no audio track left.
        let mut muted = target("mov", None);
        muted.audio_codec = "none".into();
        let s = run(muted, Some(&out_dir)).await;
        assert_eq!(s["outputs"][0]["verdict"], "copy");
        let mov = probe(&b.ffprobe, s["outputs"][0]["out"].as_str().unwrap())
            .await
            .unwrap();
        assert!(mov.video.is_some() && mov.audio.is_none());

        // A target size re-encodes and lands near it (2 s clip → ~0.5 MB).
        let mut sized = target("mp4", None);
        sized.size_mb = Some(0.5);
        let s = run(sized, Some(&out_dir)).await;
        assert_eq!(s["outputs"][0]["verdict"], "reencode");
        let bytes = std::fs::metadata(s["outputs"][0]["out"].as_str().unwrap())
            .unwrap()
            .len();
        assert!(
            (150_000..900_000).contains(&bytes),
            "sized output is {bytes} bytes"
        );

        // A library download (a file under the managed root): named by its
        // title, and written to the fallback dir instead of next to itself.
        let files = [SourceFile {
            path: src.clone(),
            title: Some("Final: Apertura".into()),
        }];
        let library = crate::probe::probe_all(&b.ffprobe, &files, Some(&b.dir)).await;
        assert_eq!(
            (library[0].name.as_str(), library[0].managed),
            ("Final: Apertura", true)
        );
        let dirs = OutDirs {
            chosen: None,
            fallback: Some(PathBuf::from(&out_dir)),
        };
        let s = serde_json::to_value(
            convert_files(
                &b.ffmpeg,
                &library,
                &target("mp4", None),
                &dirs,
                &cancel,
                &mut |_, _, _| {},
            )
            .await,
        )
        .unwrap();
        let out = Path::new(s["outputs"][0]["out"].as_str().unwrap());
        assert_eq!(out, Path::new(&out_dir).join("Final- Apertura.mp4"));
    });
}
