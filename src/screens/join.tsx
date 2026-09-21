import { save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FileList } from "../components/file-list";
import { FolderIcon, JoinIcon } from "../components/icons";
import { JobProgress } from "../components/job-progress";
import { StatusPill } from "../components/osd";
import { PillField } from "../components/pill-field";
import { RecentVideos } from "../components/recent-videos";
import { Switch } from "../components/switch";
import { useT } from "../i18n";
import { type JoinOutcome, type JoinPlan, planJoin, runJoin } from "../lib/api";
import { friendlyError } from "../lib/errors";
import { fmtDuration, VIDEO_EXTS } from "../lib/media";
import { playSfx } from "../lib/sfx";
import { useFileList } from "../lib/use-file-list";
import { useToolJob } from "../lib/use-tool-job";

const JOIN_RATES = [24, 25, 30, 50, 60];

// Join tool — videos in, in order, one file out. The plan (fast copy vs
// re-encode) comes from the backend and is shown before anything runs.
export function Join({
  active,
  onBusy,
}: {
  active: boolean;
  onBusy: (busy: boolean) => void;
}) {
  const { t } = useT();
  const job = useToolJob(onBusy);
  const [force, setForce] = useState(false);
  const [fps, setFps] = useState<number | null>(null);
  const [plan, setPlan] = useState<JoinPlan | null>(null);
  const [result, setResult] = useState<JoinOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = useFileList({
    exts: VIDEO_EXTS,
    active,
    unique: false,
    locked: job.running,
    done: !!result,
  });
  // Bumped on every return to the tab: a listed file may have moved meanwhile
  // (Download's "Save to…"), and only a fresh probe shows it.
  const [visit, setVisit] = useState(0);
  useEffect(() => {
    if (active) setVisit((v) => v + 1);
  }, [active]);

  const paths = useMemo(() => list.files.map((f) => f.path), [list.files]);
  const sources = useMemo(
    () => list.files.map(({ path, title }) => ({ path, title })),
    [list.files],
  );

  // A result describes one exact list and setup.
  useEffect(() => {
    setResult(null);
  }, [paths, force, fps]);

  useEffect(() => {
    if (paths.length === 0) {
      setPlan(null);
      return;
    }
    let stale = false;
    planJoin(sources, force, fps)
      .then((p) => {
        if (!stale) setPlan(p);
      })
      .catch((e) => {
        if (!stale) setError(friendlyError(e, t));
      });
    return () => {
      stale = true;
    };
  }, [paths, sources, force, fps, visit, t]);

  const planned = plan?.files.length === paths.length ? plan : null;
  // A join needs two parts; until then nothing about the run is offered.
  const enough = paths.length >= 2;
  const canRun = !!planned && planned.mode !== "invalid" && enough;

  const run = useCallback(async () => {
    if (!planned || !canRun) return;
    setError(null);
    const out = await save({
      defaultPath: `${t("join.defaultName")}.${planned.ext}`,
      filters: [{ name: "Video", extensions: [planned.ext] }],
    });
    if (!out) return;
    try {
      const done = await job.run((id) => runJoin(id, sources, force, fps, out));
      if (done.cancelled) return;
      setResult(done);
      playSfx();
    } catch (e) {
      setError(friendlyError(e, t));
    }
  }, [planned, canRun, sources, force, fps, job, t]);

  return (
    <div className="stage stage-top">
      <div className="hero hero-step">
        <div style={{ display: "grid", gap: 10 }}>
          <p className="eyebrow">{t("join.eyebrow")}</p>
          <h1 className="display display-sm">{t("join.title")}</h1>
        </div>
        <p className="lead">{t("join.body")}</p>

        <FileList
          files={list.files}
          entries={plan?.files}
          ordered
          locked={job.running}
          dragging={list.dragging}
          emptyLabel={t("join.empty")}
          addLabel={t("join.add")}
          onPick={list.pick}
          onRemove={list.remove}
          onMove={list.move}
        />

        {!job.running && !result && (
          <RecentVideos
            active={active}
            mode="add"
            onPick={(v) => list.add([v.local_path], v.title)}
          />
        )}

        {paths.length === 1 && (
          <div className="verdict need">
            <StatusPill tone="accent">{t("join.needLabel")}</StatusPill>
            <p className="verdict-text">{t("join.needTwo")}</p>
          </div>
        )}

        {planned && enough && planned.mode !== "invalid" && (
          <div className={`verdict ${planned.mode}`}>
            <StatusPill tone={planned.mode === "copy" ? "win" : "gold"}>
              {t(`join.mode.${planned.mode}`)}
            </StatusPill>
            <p className="verdict-text">
              {planned.mode === "copy"
                ? t("join.copyHint")
                : t("join.reencodeHint", {
                    size: `${planned.width}×${planned.height}`,
                    fps: Math.round(planned.fps * 100) / 100,
                  })}
              {planned.mode === "reencode" && planned.mismatches.length > 0 && (
                <>
                  {" "}
                  {t("join.differs", {
                    what: planned.mismatches
                      .map((m) => t(`join.mismatch.${m}`))
                      .join(", "),
                  })}
                </>
              )}
            </p>
            {planned.variableFps && (
              <p className="verdict-warn">{t("join.variableFps")}</p>
            )}
          </div>
        )}
        {planned?.mode === "invalid" && (
          <p className="error-text">{t("join.invalid")}</p>
        )}

        {enough && !job.running && !result && (
          <div className="field field--switch">
            <Switch
              checked={force}
              onChange={setForce}
              label={t("join.force")}
            />
            <span className="field-hint">{t("join.forceHint")}</span>
          </div>
        )}

        {enough && planned?.mode === "reencode" && !job.running && !result && (
          <div className="spec">
            <PillField
              label={t("convert.fps")}
              hint={t("join.fpsHint")}
              value={fps ?? 0}
              options={[
                { value: 0, label: t("join.fpsAuto") },
                ...JOIN_RATES.map((r) => ({ value: r, label: `${r}` })),
              ]}
              onChange={(r) => setFps(r || null)}
            />
          </div>
        )}

        {error && <p className="error-text">{error}</p>}

        {job.running ? (
          <JobProgress
            verb={t(
              planned?.mode === "copy" ? "join.verbCopy" : "join.verbEncode",
            )}
            progress={job.progress}
            cancelling={job.cancelling}
            onCancel={job.cancel}
          />
        ) : result ? (
          <div className="result">
            <div className="result-copy">
              <span className="field-label">{t("join.doneLabel")}</span>
              <span className="result-path">{result.out}</span>
            </div>
            <div className="row result-actions">
              <button
                type="button"
                className="primary btn-lg"
                onClick={() => revealItemInDir(result.out)}
              >
                <FolderIcon size={13} />
                {t("import.reveal")}
              </button>
              <button type="button" className="btn-lg" onClick={list.clear}>
                {t("join.again")}
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
                disabled={!canRun}
              >
                <JoinIcon size={13} />
                {enough ? t("join.run", { n: paths.length }) : t("join.runIdle")}
              </button>
              {enough && planned && planned.durationSec > 0 && (
                <span className="muted run-note">
                  {t("join.total", { dur: fmtDuration(planned.durationSec) })}
                </span>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
}
