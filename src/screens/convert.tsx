import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FileList } from "../components/file-list";
import { ConvertIcon, FolderIcon } from "../components/icons";
import { JobProgress } from "../components/job-progress";
import { NumberField, parseDecimal } from "../components/number-field";
import { Corners } from "../components/osd";
import { PillField } from "../components/pill-field";
import { RecentVideos } from "../components/recent-videos";
import { Switch } from "../components/switch";
import { useT } from "../i18n";
import {
  type Container,
  type ConvertItem,
  type ConvertSummary,
  type ConvertTarget,
  type ConvertVerdict,
  planConvert,
  type Quality,
  runConvert,
} from "../lib/api";
import { friendlyError } from "../lib/errors";
import { AUDIO_EXTS, VIDEO_EXTS } from "../lib/media";
import { playSfx } from "../lib/sfx";
import { useFileList } from "../lib/use-file-list";
import { useToolJob } from "../lib/use-tool-job";

const MEDIA_EXTS = [...VIDEO_EXTS, ...AUDIO_EXTS];
const OUT_DIR_KEY = "offcut.convert.outDir";

type Translate = ReturnType<typeof useT>["t"];
type Preset = "compatible" | "light" | "audio" | "custom";
type VideoCodec = ConvertTarget["videoCodec"];
type AudioCodec = Exclude<ConvertTarget["audioCodec"], "none">;
// How the output's size is steered: a quality level, a size to land near, or an
// exact bitrate.
type RateMode = "quality" | "size" | "bitrate";

const PRESET_IDS: Preset[] = ["compatible", "light", "audio", "custom"];

const BASE: ConvertTarget = {
  container: "mp4",
  videoCodec: "h264",
  audioCodec: "aac",
  quality: null,
  videoKbps: null,
  sizeMb: null,
  height: null,
  fps: null,
};

const PRESETS: Record<Exclude<Preset, "custom">, ConvertTarget> = {
  compatible: BASE,
  light: { ...BASE, quality: "medium", height: 720 },
  audio: { ...BASE, container: "mp3", videoCodec: "auto", audioCodec: "auto" },
};

// The Custom sheet as the user left it. The typed fields stay text so a
// half-typed "4," isn't rewritten under the cursor.
type CustomState = {
  container: Container;
  videoCodec: VideoCodec;
  audioCodec: AudioCodec;
  rate: RateMode;
  quality: Quality | null;
  sizeText: string;
  bitrateText: string;
  height: number | null;
  fps: number | null;
};

const CUSTOM_START: CustomState = {
  container: "mp4",
  videoCodec: "h264",
  audioCodec: "aac",
  rate: "quality",
  quality: null,
  sizeText: "",
  bitrateText: "",
  height: null,
  fps: null,
};

// What each container can be asked to encode. A single entry means there's
// nothing to choose; the row still shows it, locked.
const CODECS: Record<Container, { video: VideoCodec[]; audio: AudioCodec[] }> =
  {
    mp4: { video: ["auto", "h264", "hevc"], audio: ["auto", "aac", "mp3"] },
    mov: { video: ["auto", "h264", "hevc"], audio: ["auto", "aac"] },
    mkv: {
      video: ["auto", "h264", "hevc", "vp9"],
      audio: ["auto", "aac", "opus", "mp3"],
    },
    webm: { video: ["vp9"], audio: ["opus"] },
    mp3: { video: [], audio: ["mp3"] },
    m4a: { video: [], audio: ["aac"] },
    wav: { video: [], audio: [] },
  };

const CONTAINERS = Object.keys(CODECS) as Container[];
const QUALITIES: Quality[] = ["low", "medium", "high", "veryHigh"];
const HEIGHTS = [2160, 1440, 1080, 720, 480];
const RATES = [24, 25, 30, 50, 60];
const BITRATE_MBPS = { min: 0.2, max: 80 };

const VERDICT_TONE: Record<ConvertVerdict, string> = {
  copy: "win",
  audio: "gold",
  reencode: "accent",
};

const hasVideo = (container: Container) => CODECS[container].video.length > 0;

const typedSize = (c: CustomState) => {
  const mb = parseDecimal(c.sizeText);
  return mb !== null && mb > 0 ? mb : null;
};

const typedBitrate = (c: CustomState) => {
  const mbps = parseDecimal(c.bitrateText);
  return mbps !== null && mbps >= BITRATE_MBPS.min && mbps <= BITRATE_MBPS.max
    ? mbps
    : null;
};

// Null while a typed value the chosen mode depends on is missing or out of range.
function customTarget(c: CustomState): ConvertTarget | null {
  const video = hasVideo(c.container);
  const rate = video ? c.rate : "quality";
  const sizeMb = rate === "size" ? typedSize(c) : null;
  const mbps = rate === "bitrate" ? typedBitrate(c) : null;
  if ((rate === "size" && !sizeMb) || (rate === "bitrate" && !mbps)) return null;
  return {
    container: c.container,
    videoCodec: video ? c.videoCodec : "auto",
    audioCodec: c.audioCodec,
    quality: rate === "quality" ? c.quality : null,
    videoKbps: mbps ? Math.round(mbps * 1000) : null,
    sizeMb,
    height: video ? c.height : null,
    fps: video ? c.fps : null,
  };
}

// Muting is orthogonal to the format, so it rides on top of whichever preset
// is live. An audio-only output has nothing else to keep, so it ignores it.
const muted = (target: ConvertTarget, mute: boolean): ConvertTarget =>
  mute && hasVideo(target.container) ? { ...target, audioCodec: "none" } : target;

// The output read back the way a monitor prints its signal: MP4 · H.264 · 720P…
function specLine(target: ConvertTarget, t: Translate): string {
  const parts = [target.container.toUpperCase()];
  if (target.videoCodec !== "auto") parts.push(t(`convert.codec.${target.videoCodec}`));
  if (target.audioCodec === "none") parts.push(t("convert.noAudio"));
  // For MP3/M4A the container already names the audio codec.
  else if (target.audioCodec !== "auto" && hasVideo(target.container))
    parts.push(t(`convert.codec.${target.audioCodec}`));
  if (target.height) parts.push(`${target.height}p`);
  if (target.fps) parts.push(`${target.fps} fps`);
  if (target.sizeMb) parts.push(`${target.sizeMb} MB`);
  else if (target.videoKbps) parts.push(`${target.videoKbps / 1000} Mbps`);
  else if (target.quality) parts.push(t(`convert.qualityName.${target.quality}`));
  return parts.join(" · ");
}

function storedOutDir(): string | null {
  try {
    return localStorage.getItem(OUT_DIR_KEY);
  } catch {
    return null;
  }
}

// Convert tool — files in, a target format, files out. Each row says up front
// whether it's a fast copy or a re-encode for the chosen target.
export function Convert({
  active,
  seed,
  onBusy,
}: {
  active: boolean;
  seed: { path: string; title: string; n: number } | null;
  onBusy: (busy: boolean) => void;
}) {
  const { t } = useT();
  const job = useToolJob(onBusy);
  const [preset, setPreset] = useState<Preset>("compatible");
  const [custom, setCustom] = useState<CustomState>(CUSTOM_START);
  const [mute, setMute] = useState(false);
  const [outDir, setOutDir] = useState<string | null>(storedOutDir);
  const [items, setItems] = useState<ConvertItem[] | null>(null);
  const [summary, setSummary] = useState<ConvertSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = useFileList({
    exts: MEDIA_EXTS,
    active,
    unique: true,
    locked: job.running,
    done: !!summary,
  });
  // Bumped on every return to the tab: a listed file may have moved meanwhile
  // (Download's "Save to…"), and only a fresh probe shows it.
  const [visit, setVisit] = useState(0);
  useEffect(() => {
    if (active) setVisit((v) => v + 1);
  }, [active]);

  const target = useMemo(() => {
    const base = preset === "custom" ? customTarget(custom) : PRESETS[preset];
    return base && muted(base, mute);
  }, [preset, custom, mute]);
  const paths = useMemo(() => list.files.map((f) => f.path), [list.files]);
  const sources = useMemo(
    () => list.files.map(({ path, title }) => ({ path, title })),
    [list.files],
  );

  const { add } = list;
  useEffect(() => {
    if (seed) add([seed.path], seed.title);
  }, [seed, add]);

  // A summary describes one exact list and target.
  useEffect(() => {
    setSummary(null);
  }, [paths, target, outDir]);

  useEffect(() => {
    if (paths.length === 0) {
      setItems(null);
      return;
    }
    if (!target) return;
    let stale = false;
    // Typing a size or bitrate changes the target on every keystroke, and each
    // plan probes every file.
    const timer = setTimeout(() => {
      planConvert(sources, target, outDir)
        .then((next) => {
          if (!stale) setItems(next);
        })
        .catch((e) => {
          if (!stale) setError(friendlyError(e, t));
        });
    }, 180);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [paths, sources, target, outDir, visit, t]);

  const patch = useCallback(
    (next: Partial<CustomState>) => setCustom((c) => ({ ...c, ...next })),
    [],
  );

  const setContainer = useCallback((container: Container) => {
    setCustom((c) => {
      const { video, audio } = CODECS[container];
      return {
        ...c,
        container,
        // A codec the new container can't carry would silently block the run.
        videoCodec: video.includes(c.videoCodec) ? c.videoCodec : (video[0] ?? "auto"),
        audioCodec: audio.includes(c.audioCodec) ? c.audioCodec : (audio[0] ?? "auto"),
      };
    });
  }, []);

  const pickDir = useCallback(async () => {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir !== "string") return;
    setOutDir(dir);
    try {
      localStorage.setItem(OUT_DIR_KEY, dir);
    } catch {}
  }, []);

  const resetDir = useCallback(() => {
    setOutDir(null);
    try {
      localStorage.removeItem(OUT_DIR_KEY);
    } catch {}
  }, []);

  const usable = items?.filter((i) => !i.error).length ?? 0;
  const planned = !!target && items?.length === paths.length;
  // A library download has no folder of its own; say where it will land.
  const libraryOut = outDir ? null : items?.find((i) => i.managed)?.outDir;

  const run = useCallback(async () => {
    if (!target) return;
    setError(null);
    try {
      const done = await job.run((id) =>
        runConvert(id, sources, target, outDir),
      );
      if (done.cancelled && done.outputs.length === 0) return;
      setSummary(done);
      if (done.outputs.length > 0) playSfx();
    } catch (e) {
      setError(friendlyError(e, t));
    }
  }, [job, sources, target, outDir, t]);

  const codecs = CODECS[custom.container];
  const customVideo = hasVideo(custom.container);
  const rate: RateMode = customVideo ? custom.rate : "quality";
  const canMute = hasVideo(
    preset === "custom" ? custom.container : PRESETS[preset].container,
  );
  const codecOptions = <C extends string>(list: C[]) =>
    list.map((c) => ({
      value: c,
      label: c === "auto" ? t("convert.keep") : t(`convert.codec.${c}`),
    }));

  return (
    <div className="stage stage-top">
      <div className="hero hero-step">
        <div style={{ display: "grid", gap: 10 }}>
          <p className="eyebrow">{t("convert.eyebrow")}</p>
          <h1 className="display display-sm">{t("convert.title")}</h1>
        </div>
        <p className="lead">{t("convert.body")}</p>

        <FileList
          files={list.files}
          entries={items ?? undefined}
          locked={job.running}
          dragging={list.dragging}
          emptyLabel={t("convert.empty")}
          addLabel={t("convert.add")}
          chip={(entry) => {
            const verdict = (entry as ConvertItem).verdict;
            return verdict ? (
              <span className={`chip tone-${VERDICT_TONE[verdict]}`}>
                {t(`convert.verdict.${verdict}`)}
              </span>
            ) : null;
          }}
          onPick={list.pick}
          onRemove={list.remove}
        />

        {!job.running && !summary && (
          <RecentVideos
            active={active}
            mode="add"
            taken={(path) => paths.includes(path)}
            onPick={(v) => list.add([v.local_path], v.title)}
          />
        )}

        {paths.length > 0 && !job.running && !summary && (
          <div className="panel">
            <div className="field">
              <span className="field-label">{t("convert.format")}</span>
              <div
                className="presets"
                role="radiogroup"
                aria-label={t("convert.format")}
              >
                {PRESET_IDS.map((p) => {
                  const base = p === "custom" ? customTarget(custom) : PRESETS[p];
                  const spec = base && muted(base, mute);
                  return (
                    <button
                      key={p}
                      type="button"
                      role="radio"
                      aria-checked={preset === p}
                      className={`preset ${preset === p ? "on" : ""}`}
                      onClick={() => setPreset(p)}
                    >
                      <Corners />
                      <span className="preset-name">
                        {t(`convert.preset.${p}`)}
                      </span>
                      <span className="preset-spec">
                        {spec ? specLine(spec, t) : t("convert.specPending")}
                      </span>
                      <span className="preset-hint">
                        {t(`convert.presetHint.${p}`)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {preset === "custom" && (
              <div className="spec">
                <PillField
                  label={t("convert.container")}
                  value={custom.container}
                  options={CONTAINERS.map((c) => ({
                    value: c,
                    label: c.toUpperCase(),
                  }))}
                  onChange={setContainer}
                />
                {customVideo && (
                  <PillField
                    label={t("convert.video")}
                    value={custom.videoCodec}
                    options={codecOptions(codecs.video)}
                    onChange={(videoCodec) => patch({ videoCodec })}
                  />
                )}
                {codecs.audio.length > 0 && !(mute && customVideo) && (
                  <PillField
                    label={t("convert.audio")}
                    value={custom.audioCodec}
                    options={codecOptions(codecs.audio)}
                    onChange={(audioCodec) => patch({ audioCodec })}
                  />
                )}
                {customVideo && (
                  <PillField
                    label={t("convert.rateBy")}
                    value={custom.rate}
                    options={[
                      { value: "quality", label: t("convert.quality") },
                      { value: "size", label: t("convert.rateSize") },
                      { value: "bitrate", label: t("convert.rateBitrate") },
                    ]}
                    onChange={(next) => patch({ rate: next })}
                  />
                )}
                {rate === "quality" && custom.container !== "wav" && (
                  <PillField
                    label={t("convert.quality")}
                    hint={t("convert.qualityHint")}
                    value={custom.quality ?? "auto"}
                    options={[
                      { value: "auto" as const, label: t("convert.keep") },
                      ...QUALITIES.map((q) => ({
                        value: q,
                        label: t(`convert.qualityName.${q}`),
                      })),
                    ]}
                    onChange={(q) => patch({ quality: q === "auto" ? null : q })}
                  />
                )}
                {rate === "size" && (
                  <NumberField
                    label={t("convert.rateSize")}
                    hint={t("convert.sizeHint")}
                    unit="MB"
                    value={custom.sizeText}
                    invalid={custom.sizeText !== "" && !typedSize(custom)}
                    step={5}
                    min={1}
                    placeholder="25"
                    stepUpLabel={t("convert.stepUp")}
                    stepDownLabel={t("convert.stepDown")}
                    onChange={(sizeText) => patch({ sizeText })}
                  />
                )}
                {rate === "bitrate" && (
                  <NumberField
                    label={t("convert.rateBitrate")}
                    hint={t("convert.bitrateHint", BITRATE_MBPS)}
                    unit="Mbps"
                    value={custom.bitrateText}
                    invalid={custom.bitrateText !== "" && !typedBitrate(custom)}
                    step={0.5}
                    min={BITRATE_MBPS.min}
                    max={BITRATE_MBPS.max}
                    placeholder="5"
                    stepUpLabel={t("convert.stepUp")}
                    stepDownLabel={t("convert.stepDown")}
                    onChange={(bitrateText) => patch({ bitrateText })}
                  />
                )}
                {customVideo && (
                  <>
                    <PillField
                      label={t("convert.height")}
                      value={custom.height ?? 0}
                      options={[
                        { value: 0, label: t("convert.original") },
                        ...HEIGHTS.map((h) => ({ value: h, label: `${h}p` })),
                      ]}
                      onChange={(h) => patch({ height: h || null })}
                    />
                    <PillField
                      label={t("convert.fps")}
                      value={custom.fps ?? 0}
                      options={[
                        { value: 0, label: t("convert.original") },
                        ...RATES.map((r) => ({ value: r, label: `${r}` })),
                      ]}
                      onChange={(r) => patch({ fps: r || null })}
                    />
                  </>
                )}
              </div>
            )}

            {canMute && (
              <div className="field field--switch">
                <Switch
                  checked={mute}
                  onChange={setMute}
                  label={t("convert.mute")}
                />
                <span className="field-hint">{t("convert.muteHint")}</span>
              </div>
            )}

            <div className="field">
              <span className="field-label">{t("export.outFolder")}</span>
              <div className="row" style={{ flexWrap: "wrap" }}>
                <button type="button" onClick={pickDir}>
                  <FolderIcon size={13} />
                  {t("export.chooseFolder")}
                </button>
                <span className="muted out-path">
                  {outDir ?? t("convert.nextToSource")}
                </span>
                {outDir && (
                  <button type="button" className="ghost" onClick={resetDir}>
                    {t("convert.resetFolder")}
                  </button>
                )}
              </div>
              {libraryOut && (
                <span className="field-hint">
                  {t("convert.libraryOut", { dir: libraryOut })}
                </span>
              )}
            </div>
          </div>
        )}

        {error && <p className="error-text">{error}</p>}

        {job.running ? (
          <JobProgress
            verb={t("convert.verb")}
            progress={job.progress}
            cancelling={job.cancelling}
            onCancel={job.cancel}
          />
        ) : summary ? (
          <div className="result">
            <div className="result-copy">
              <span className="field-label">
                {t(summary.cancelled ? "convert.stoppedLabel" : "join.doneLabel")}
              </span>
              <span className="result-title">
                {t("convert.done", { n: summary.outputs.length })}
              </span>
              {summary.failed.map((f) => (
                <span key={f.name} className="error-text">
                  {f.name} —{" "}
                  {["unreadable", "no-video", "no-audio"].includes(f.error)
                    ? t(`files.err.${f.error}`)
                    : f.error}
                </span>
              ))}
            </div>
            <div className="row result-actions">
              {summary.outputs.length > 0 && (
                <button
                  type="button"
                  className="primary btn-lg"
                  onClick={() => revealItemInDir(summary.outputs[0].out)}
                >
                  <FolderIcon size={13} />
                  {t("import.reveal")}
                </button>
              )}
              <button type="button" className="btn-lg" onClick={list.clear}>
                {t("convert.again")}
              </button>
            </div>
          </div>
        ) : (
          paths.length > 0 && (
            <div className="row">
              <button
                type="button"
                className="primary btn-lg"
                onClick={run}
                disabled={!planned || usable === 0}
              >
                <ConvertIcon size={13} />
                {t("convert.run", {
                  n: planned ? usable : paths.length,
                  format: (target?.container ?? custom.container).toUpperCase(),
                })}
              </button>
            </div>
          )
        )}
      </div>
    </div>
  );
}
