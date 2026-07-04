import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useState } from "react";
import { Corners } from "../components/osd";
import { useT } from "../i18n";
import { playSfx } from "../lib/sfx";
import {
  cancelExport,
  type ExportClip,
  type ExportSummary,
  exportClips,
  type MediaInfo,
  probeMedia,
  type ReelMode,
} from "../lib/api";

function fmtDur(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type Phase = "config" | "running" | "done" | "error";

interface Progress {
  phase: string;
  done: number;
  total: number;
  label: string;
}

export function ExportDialog({
  videoId,
  videoTitle,
  sourcePath,
  clips,
  onClose,
}: {
  videoId: string;
  videoTitle: string;
  sourcePath: string;
  clips: ExportClip[];
  onClose: () => void;
}) {
  const { t } = useT();
  const [outDir, setOutDir] = useState<string | null>(null);
  const [individual, setIndividual] = useState(true);
  const [reelMode, setReelMode] = useState<ReelMode>("perTag");
  const [reencode, setReencode] = useState(false);
  const [phase, setPhase] = useState<Phase>("config");
  const [prog, setProg] = useState<Progress | null>(null);
  const [summary, setSummary] = useState<ExportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<MediaInfo | null>(null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    const un = listen<{ videoId: string } & Progress>("export-progress", (e) => {
      if (e.payload.videoId === videoId) setProg(e.payload);
    });
    return () => {
      un.then((f) => f());
    };
  }, [videoId]);

  // Probe the source: stream-copy is only safe for h264, so default the
  // re-encode toggle on for anything else. Silent if ffprobe is unavailable.
  useEffect(() => {
    probeMedia(sourcePath)
      .then((i) => {
        setInfo(i);
        if (i.vcodec && i.vcodec !== "h264") setReencode(true);
      })
      .catch(() => {});
  }, [sourcePath]);

  const pickDir = useCallback(async () => {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === "string") setOutDir(dir);
  }, []);

  const run = useCallback(async () => {
    if (!outDir) return;
    setPhase("running");
    setError(null);
    // Clamp clip ends to the real duration so an over-long XML timecode can't
    // make ffmpeg overrun or fail the cut.
    const dur = info?.durationSec ?? 0;
    const safeClips =
      dur > 0
        ? clips.map((c) =>
            c.endSec > dur ? { ...c, endSec: dur } : c,
          )
        : clips;
    try {
      const result = await exportClips({
        videoId,
        videoTitle,
        sourcePath,
        outDir,
        clips: safeClips,
        individualClips: individual,
        reelMode,
        reencode,
      });
      if (result.cancelled) {
        setCancelling(false);
        setPhase("config");
        return;
      }
      setSummary(result);
      setPhase("done");
      playSfx();
    } catch (e) {
      setError(String(e));
      setPhase("error");
    }
  }, [
    outDir,
    videoId,
    videoTitle,
    sourcePath,
    clips,
    individual,
    reelMode,
    reencode,
    info,
  ]);

  const cancel = useCallback(() => {
    setCancelling(true);
    cancelExport(videoId);
  }, [videoId]);

  const pct =
    prog && prog.total > 0 ? Math.round((prog.done / prog.total) * 100) : 0;

  return (
    <div className="scrim">
      <div className="card">
        <Corners />
        <h2>{t("export.title", { n: clips.length })}</h2>

        {phase === "config" && info?.vcodec && (
          <p className="muted" style={{ fontSize: 12, margin: "0 0 4px" }}>
            {t("export.source", {
              codec: info.vcodec.toUpperCase(),
              dur: fmtDur(info.durationSec),
            })}
          </p>
        )}

        {phase === "config" && (
          <>
            <div className="row" style={{ margin: "12px 0" }}>
              <button type="button" onClick={pickDir}>
                {t("export.chooseFolder")}
              </button>
              <span className="muted" style={{ fontSize: 12 }}>
                {outDir ?? t("export.noFolder")}
              </span>
            </div>
            <label className="row" style={{ margin: "8px 0" }}>
              <input
                type="checkbox"
                checked={individual}
                onChange={(e) => setIndividual(e.target.checked)}
              />
              {t("export.individual")}
            </label>
            <label className="row" style={{ margin: "8px 0" }}>
              {t("export.reels")}
              <select
                value={reelMode}
                onChange={(e) => setReelMode(e.target.value as ReelMode)}
              >
                <option value="none">{t("export.reelNone")}</option>
                <option value="perTag">{t("export.reelPerTag")}</option>
                <option value="combined">{t("export.reelCombined")}</option>
              </select>
            </label>
            <label className="row" style={{ margin: "8px 0" }}>
              <input
                type="checkbox"
                checked={reencode}
                onChange={(e) => setReencode(e.target.checked)}
              />
              {t("export.reencode")}
            </label>
            <div
              className="row"
              style={{ justifyContent: "flex-end", marginTop: 16 }}
            >
              <button type="button" className="ghost" onClick={onClose}>
                {t("export.cancel")}
              </button>
              <button
                type="button"
                className="primary"
                onClick={run}
                disabled={!outDir}
              >
                {t("export.run")}
              </button>
            </div>
          </>
        )}

        {phase === "running" && (
          <>
            <p className="muted">
              {prog
                ? t("export.progress", {
                    verb:
                      prog.phase === "reel"
                        ? t("export.buildingReel")
                        : t("export.cutting"),
                    label: prog.label,
                    done: prog.done,
                    total: prog.total,
                  })
                : t("export.starting")}
            </p>
            <div className="bar">
              <span style={{ width: `${pct}%` }} />
            </div>
            <div
              className="row"
              style={{ justifyContent: "flex-end", marginTop: 16 }}
            >
              <button
                type="button"
                className="ghost"
                onClick={cancel}
                disabled={cancelling}
              >
                {cancelling ? t("export.cancelling") : t("export.cancel")}
              </button>
            </div>
          </>
        )}

        {phase === "done" && summary && (
          <>
            <p>
              {t("export.done", {
                clips: summary.clips,
                reels: summary.reels,
              })}
            </p>
            <div
              className="row"
              style={{ justifyContent: "flex-end", marginTop: 16 }}
            >
              <button type="button" className="ghost" onClick={onClose}>
                {t("export.close")}
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => revealItemInDir(summary.outDir)}
              >
                {t("export.openFolder")}
              </button>
            </div>
          </>
        )}

        {phase === "error" && (
          <>
            <p style={{ color: "var(--destructive)" }}>{error}</p>
            <div
              className="row"
              style={{ justifyContent: "flex-end", marginTop: 16 }}
            >
              <button type="button" className="ghost" onClick={onClose}>
                {t("export.close")}
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => setPhase("config")}
              >
                {t("export.back")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
