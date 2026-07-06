import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeftIcon,
  CloseIcon,
  DownloadIcon,
  FolderIcon,
} from "../components/icons";
import { Corners } from "../components/osd";
import { useT } from "../i18n";
import { friendlyError } from "../lib/errors";
import { playSfx } from "../lib/sfx";
import { useModal } from "../lib/use-modal";
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

const REEL_MODES: { value: ReelMode; labelKey: string; hintKey: string }[] = [
  { value: "none", labelKey: "export.reelNone", hintKey: "export.reelHintNone" },
  {
    value: "perTag",
    labelKey: "export.reelPerTag",
    hintKey: "export.reelHintPerTag",
  },
  {
    value: "combined",
    labelKey: "export.reelCombined",
    hintKey: "export.reelHintCombined",
  },
];

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`switch ${checked ? "on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-track">
        <span className="switch-thumb" />
      </span>
      <span className="switch-label">{label}</span>
    </button>
  );
}

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
      setError(friendlyError(e, t));
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

  // Esc / focus-trap. Don't dismiss mid-export — Cancel is the way out then.
  const dismiss = useCallback(() => {
    if (phase !== "running") onClose();
  }, [phase, onClose]);
  const modalRef = useModal<HTMLDivElement>(dismiss);

  const pct =
    prog && prog.total > 0 ? Math.round((prog.done / prog.total) * 100) : 0;

  return (
    <div className="drawer-scrim" onClick={dismiss}>
      <div
        className="drawer"
        ref={modalRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <Corners />
        <div className="drawer-head">
          <h2>{t("export.title", { n: clips.length })}</h2>
          {phase === "config" && info?.vcodec && (
            <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
              {t("export.source", {
                codec: info.vcodec.toUpperCase(),
                dur: fmtDur(info.durationSec),
              })}
            </p>
          )}
        </div>

        {phase === "config" && (
          <>
            <div className="drawer-body">
              <div className="field">
                <span className="field-label">{t("export.outFolder")}</span>
                <div className="row">
                  <button type="button" onClick={pickDir}>
                    <FolderIcon size={13} />
                    {t("export.chooseFolder")}
                  </button>
                  <span
                    className="muted"
                    style={{ fontSize: 12, wordBreak: "break-all" }}
                  >
                    {outDir ?? t("export.noFolder")}
                  </span>
                </div>
              </div>

              <div className="field field--switch">
                <Switch
                  checked={individual}
                  onChange={setIndividual}
                  label={t("export.individual")}
                />
                <span className="field-hint">{t("export.individualHint")}</span>
              </div>

              <div className="field">
                <span className="field-label">{t("export.reels")}</span>
                <div
                  className="seg"
                  role="radiogroup"
                  aria-label={t("export.reels")}
                >
                  {REEL_MODES.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      role="radio"
                      aria-checked={reelMode === m.value}
                      className={reelMode === m.value ? "on" : ""}
                      onClick={() => setReelMode(m.value)}
                    >
                      {t(m.labelKey)}
                    </button>
                  ))}
                </div>
                <span className="field-hint">
                  {t(REEL_MODES.find((m) => m.value === reelMode)?.hintKey ?? "")}
                </span>
              </div>

              <div className="field field--switch">
                <Switch
                  checked={reencode}
                  onChange={setReencode}
                  label={t("export.reencode")}
                />
                <span className="field-hint">{t("export.reencodeHint")}</span>
              </div>
            </div>

            <div className="drawer-footer">
              <button type="button" className="ghost" onClick={onClose}>
                <CloseIcon size={12} />
                {t("export.cancel")}
              </button>
              <button
                type="button"
                className="primary"
                onClick={run}
                disabled={!outDir}
              >
                <DownloadIcon size={13} />
                {t("export.run")}
              </button>
            </div>
          </>
        )}

        {phase === "running" && (
          <>
            <div className="drawer-body">
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
            </div>
            <div className="drawer-footer">
              <button
                type="button"
                className="ghost"
                onClick={cancel}
                disabled={cancelling}
              >
                <CloseIcon size={12} />
                {cancelling ? t("export.cancelling") : t("export.cancel")}
              </button>
            </div>
          </>
        )}

        {phase === "done" && summary && (
          <>
            <div className="drawer-body">
              <p>
                {t("export.done", {
                  clips: summary.clips,
                  reels: summary.reels,
                })}
              </p>
            </div>
            <div className="drawer-footer">
              <button type="button" className="ghost" onClick={onClose}>
                <CloseIcon size={12} />
                {t("export.close")}
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => revealItemInDir(summary.outDir)}
              >
                <FolderIcon size={13} />
                {t("export.openFolder")}
              </button>
            </div>
          </>
        )}

        {phase === "error" && (
          <>
            <div className="drawer-body">
              <p style={{ color: "var(--destructive)" }}>{error}</p>
            </div>
            <div className="drawer-footer">
              <button type="button" className="ghost" onClick={onClose}>
                <CloseIcon size={12} />
                {t("export.close")}
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => setPhase("config")}
              >
                <ArrowLeftIcon size={13} />
                {t("export.back")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
