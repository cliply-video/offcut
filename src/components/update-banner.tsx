import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useState } from "react";
import { useT } from "../i18n";
import { Corners } from "./osd";

type Phase = "hidden" | "available" | "downloading" | "ready" | "error";

// Checks for a signed release on launch and, if one exists, offers a one-click
// download-and-relaunch. Any failure (dev build, no endpoint yet, offline,
// unsigned) is swallowed — the toast simply never appears.
export function UpdateBanner() {
  const { t } = useT();
  const [update, setUpdate] = useState<Update | null>(null);
  const [phase, setPhase] = useState<Phase>("hidden");
  const [pct, setPct] = useState(0);

  useEffect(() => {
    let cancelled = false;
    check()
      .then((u) => {
        if (!cancelled && u) {
          setUpdate(u);
          setPhase("available");
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const install = useCallback(async () => {
    if (!update) return;
    setPhase("downloading");
    setPct(0);
    let total = 0;
    let got = 0;
    try {
      await update.downloadAndInstall((e) => {
        if (e.event === "Started") total = e.data.contentLength ?? 0;
        else if (e.event === "Progress") {
          got += e.data.chunkLength;
          if (total > 0) setPct(Math.round((got / total) * 100));
        } else if (e.event === "Finished") setPct(100);
      });
      setPhase("ready");
      await relaunch();
    } catch {
      setPhase("error");
    }
  }, [update]);

  if (phase === "hidden" || !update) return null;

  return (
    <div className="update-toast" role="status">
      <Corners />
      <p className="eyebrow">{t("update.eyebrow")}</p>
      {phase === "available" && (
        <>
          <p className="update-msg">
            {t("update.available", { version: update.version })}
          </p>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button
              type="button"
              className="ghost"
              onClick={() => setPhase("hidden")}
            >
              {t("update.later")}
            </button>
            <button type="button" className="primary" onClick={install}>
              {t("update.install")}
            </button>
          </div>
        </>
      )}
      {phase === "downloading" && (
        <>
          <p className="update-msg">{t("update.downloading", { pct })}</p>
          <div className="bar">
            <span style={{ width: `${pct}%` }} />
          </div>
        </>
      )}
      {phase === "ready" && <p className="update-msg">{t("update.restarting")}</p>}
      {phase === "error" && (
        <>
          <p className="update-msg" style={{ color: "var(--destructive)" }}>
            {t("update.failed")}
          </p>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button
              type="button"
              className="ghost"
              onClick={() => setPhase("hidden")}
            >
              {t("update.dismiss")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
