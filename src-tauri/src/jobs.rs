//! Shared plumbing for the join/convert tools: a cancel registry keyed by job
//! id, and an ffmpeg runner that turns `-progress` output into a 0–1 ratio.

use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::Command;

/// How long the app waits at exit for cancelled jobs to kill their ffmpeg and
/// sweep their scratch dirs.
pub const EXIT_GRACE: Duration = Duration::from_millis(600);

#[derive(Default)]
pub struct Jobs {
    cancel: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

// Removes the job's cancel flag on any exit path (done, error, cancelled).
pub struct JobGuard<'a> {
    jobs: &'a Jobs,
    id: String,
    pub cancel: Arc<AtomicBool>,
}

impl Jobs {
    pub fn register(&self, id: &str) -> JobGuard<'_> {
        let cancel = Arc::new(AtomicBool::new(false));
        self.cancel
            .lock()
            .unwrap()
            .insert(id.to_string(), cancel.clone());
        JobGuard {
            jobs: self,
            id: id.to_string(),
            cancel,
        }
    }

    /// Flags every running job to stop; returns how many there were.
    pub fn cancel_all(&self) -> usize {
        let jobs = self.cancel.lock().unwrap();
        for flag in jobs.values() {
            flag.store(true, Ordering::Relaxed);
        }
        jobs.len()
    }
}

impl Drop for JobGuard<'_> {
    fn drop(&mut self) {
        self.jobs.cancel.lock().unwrap().remove(&self.id);
    }
}

/// Signals an in-flight join/convert to stop; the running ffmpeg is killed.
#[tauri::command]
pub fn cancel_job(state: State<'_, Jobs>, job_id: String) {
    if let Some(flag) = state.cancel.lock().unwrap().get(&job_id) {
        flag.store(true, Ordering::Relaxed);
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolProgress {
    pub job_id: String,
    /// Whole-job progress, 0–100.
    pub percent: f64,
    pub index: usize,
    pub total: usize,
    pub label: String,
}

pub fn emit(app: &AppHandle, progress: ToolProgress) {
    let _ = app.emit("tool-progress", progress);
}

pub enum Run {
    Done,
    Cancelled,
}

async fn wait_cancel(cancel: &AtomicBool) {
    while !cancel.load(Ordering::Relaxed) {
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
}

/// Runs ffmpeg to completion, reporting `out_time / duration_sec` as it goes
/// and killing the child when `cancel` flips.
pub async fn run_ffmpeg(
    ffmpeg: &Path,
    args: &[String],
    duration_sec: f64,
    cancel: &AtomicBool,
    on_ratio: &mut (dyn FnMut(f64) + Send),
) -> Result<Run, String> {
    if cancel.load(Ordering::Relaxed) {
        return Ok(Run::Cancelled);
    }
    let mut child = Command::new(ffmpeg)
        .args(["-hide_banner", "-nostdin", "-v", "error", "-nostats"])
        .args(["-progress", "pipe:1"])
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| e.to_string())?;

    // Drain stderr on its own task so a full pipe can't block the child.
    let stderr = child.stderr.take();
    let err_task = tokio::spawn(async move {
        let mut buf = String::new();
        if let Some(mut s) = stderr {
            let _ = s.read_to_string(&mut buf).await;
        }
        buf
    });

    if let Some(stdout) = child.stdout.take() {
        let mut lines = BufReader::new(stdout).lines();
        loop {
            tokio::select! {
                line = lines.next_line() => {
                    let Ok(Some(line)) = line else { break };
                    // Both keys carry microseconds; older builds only emit _ms.
                    let us = line
                        .strip_prefix("out_time_us=")
                        .or_else(|| line.strip_prefix("out_time_ms="))
                        .and_then(|v| v.trim().parse::<f64>().ok());
                    if let (Some(us), true) = (us, duration_sec > 0.0) {
                        on_ratio((us / 1_000_000.0 / duration_sec).clamp(0.0, 1.0));
                    }
                }
                _ = wait_cancel(cancel) => {
                    let _ = child.start_kill();
                    let _ = child.wait().await;
                    return Ok(Run::Cancelled);
                }
            }
        }
    }

    let status = child.wait().await.map_err(|e| e.to_string())?;
    if cancel.load(Ordering::Relaxed) {
        return Ok(Run::Cancelled);
    }
    if status.success() {
        on_ratio(1.0);
        return Ok(Run::Done);
    }
    let stderr = err_task.await.unwrap_or_default();
    let tail: Vec<&str> = stderr.lines().rev().take(4).collect();
    Err(format!(
        "ffmpeg failed: {}",
        tail.into_iter().rev().collect::<Vec<_>>().join(" ")
    ))
}
