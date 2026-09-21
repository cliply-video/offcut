import { save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useState } from "react";
import { Handoff } from "../components/handoff";
import {
  ConvertIcon,
  DownloadIcon,
  FolderIcon,
  ScissorsIcon,
} from "../components/icons";
import { useT } from "../i18n";
import { moveFile } from "../lib/api";
import { setVideoPath } from "../lib/db";
import { friendlyError } from "../lib/errors";
import { safeFileName } from "../lib/media";
import { playSfx } from "../lib/sfx";
import { type Downloaded, useDownload } from "../lib/use-download";

// Download tool — a link in, a video file out. The video also lands in the
// library, so it can go straight on to the clip cutter or the converter.
export function Download({
  onBusy,
  onCutClips,
  onConvert,
}: {
  onBusy: (busy: boolean) => void;
  onCutClips: (videoId: string) => void;
  onConvert: (path: string, title: string) => void;
}) {
  const { t } = useT();
  const dl = useDownload();
  const [url, setUrl] = useState("");
  const [video, setVideo] = useState<Downloaded | null>(null);
  const [saved, setSaved] = useState(false);
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    onBusy(dl.busy);
  }, [dl.busy, onBusy]);

  const start = useCallback(async () => {
    const done = await dl.start(url);
    if (!done) return;
    playSfx();
    setVideo(done);
    setSaved(false);
    setUrl("");
  }, [dl, url]);

  // Moves the file out of app data instead of copying it: a match is several
  // GB, and the library keeps working from wherever it ends up.
  const saveAs = useCallback(async () => {
    if (!video) return;
    dl.setError(null);
    const dest = await save({
      defaultPath: `${safeFileName(video.title)}.mp4`,
      filters: [{ name: "Video", extensions: ["mp4"] }],
    });
    if (!dest) return;
    setMoving(true);
    try {
      await moveFile(video.path, dest);
      try {
        await setVideoPath(video.id, dest);
      } catch (e) {
        // The library row still names the old path: put the file back under it.
        await moveFile(dest, video.path).catch(() => {});
        throw e;
      }
      setVideo({ ...video, path: dest });
      setSaved(true);
    } catch (e) {
      dl.setError(friendlyError(e, t));
    } finally {
      setMoving(false);
    }
  }, [video, dl, t]);

  return (
    <div className="stage stage-top">
      <div className="hero hero-step">
        <div style={{ display: "grid", gap: 10 }}>
          <p className="eyebrow">{t("download.eyebrow")}</p>
          <h1 className="display display-sm">{t("download.title")}</h1>
        </div>
        <p className="lead">{t("download.body")}</p>

        <div style={{ display: "grid", gap: 12 }}>
          <input
            className="input-xl"
            type="text"
            placeholder={t("home.placeholder")}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !dl.busy) start();
            }}
            disabled={dl.busy}
          />
          {dl.busy && (
            <div className="bar">
              <span style={{ width: `${dl.percent}%` }} />
            </div>
          )}
          {dl.error && <p className="error-text">{dl.error}</p>}
          <div className="row">
            <button
              type="button"
              className="primary btn-lg"
              onClick={start}
              disabled={dl.busy || !url.trim()}
            >
              <DownloadIcon size={13} />
              {dl.busy
                ? t("home.downloading", { pct: Math.round(dl.percent) })
                : t("download.run")}
            </button>
            {dl.busy && (
              <button type="button" className="btn-lg" onClick={dl.cancel}>
                {t("home.cancel")}
              </button>
            )}
          </div>
        </div>

        {video && (
          <div className="result">
            <div className="result-copy">
              <span className="field-label">
                {t(saved ? "download.savedLabel" : "download.readyLabel")}
              </span>
              <span className="result-title">{video.title}</span>
              {saved && <span className="result-path">{video.path}</span>}
            </div>
            <div className="row result-actions">
              {saved ? (
                <button
                  type="button"
                  className="primary btn-lg"
                  onClick={() => revealItemInDir(video.path)}
                >
                  <FolderIcon size={13} />
                  {t("import.reveal")}
                </button>
              ) : (
                <button
                  type="button"
                  className="primary btn-lg"
                  onClick={saveAs}
                  disabled={moving}
                >
                  <FolderIcon size={13} />
                  {t("download.saveAs")}
                </button>
              )}
              <button
                type="button"
                className="btn-lg"
                onClick={() => onCutClips(video.id)}
                disabled={moving}
              >
                <ScissorsIcon size={13} />
                {t("download.toClips")}
              </button>
              <button
                type="button"
                className="btn-lg"
                onClick={() => onConvert(video.path, video.title)}
                disabled={moving}
              >
                <ConvertIcon size={13} />
                {t("download.toConvert")}
              </button>
            </div>
          </div>
        )}

        {saved && (
          <Handoff
            text={t("handoff.saved")}
            cta={t("handoff.savedCta")}
            touchpoint="video_saved"
          />
        )}
      </div>
    </div>
  );
}
