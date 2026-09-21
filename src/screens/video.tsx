import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useState } from "react";
import { RecentVideos } from "../components/recent-videos";
import { useT } from "../i18n";
import { createVideo } from "../lib/db";
import { friendlyError } from "../lib/errors";
import { basename, VIDEO_EXTS } from "../lib/media";
import { playSfx } from "../lib/sfx";
import { useDownload } from "../lib/use-download";

// Clips step 1 — add a video by link/URL/id (downloaded), a local file (used
// in place), or one already in the library. On success routes on to the XML
// import step (or straight to the clips, for a library video that has them).
export function AddVideo({
  active,
  onBusy,
  onVideo,
  onResume,
  onBack,
}: {
  active: boolean;
  onBusy: (busy: boolean) => void;
  onVideo: (videoId: string) => void;
  onResume: (videoId: string, hasClips: boolean) => void;
  onBack: () => void;
}) {
  const { t } = useT();
  const dl = useDownload();
  const [url, setUrl] = useState("");

  useEffect(() => {
    onBusy(dl.busy);
  }, [dl.busy, onBusy]);

  const start = useCallback(async () => {
    const video = await dl.start(url);
    if (!video) return;
    playSfx();
    onVideo(video.id);
  }, [dl, url, onVideo]);

  // Use a local video file in place — no download, no copy. ffmpeg and the
  // asset protocol read the original path directly.
  const pickLocal = useCallback(async () => {
    dl.setError(null);
    const path = await open({
      multiple: false,
      filters: [{ name: "Video", extensions: VIDEO_EXTS }],
    });
    if (!path || typeof path !== "string") return;
    const id = crypto.randomUUID();
    try {
      await createVideo({
        id,
        title: basename(path).replace(/\.[^.]+$/, ""),
        url: "",
        local_path: path,
      });
      playSfx();
      onVideo(id);
    } catch (e) {
      dl.setError(friendlyError(e, t));
    }
  }, [dl, onVideo, t]);

  return (
    <div className="stage stage-top">
      <div className="hero hero-step">
        <div style={{ display: "grid", gap: 10 }}>
          <p className="eyebrow">{t("video.eyebrow")}</p>
          <h1 className="display">{t("video.title")}</h1>
        </div>

        <p className="lead">{t("video.body")}</p>

        <div style={{ display: "grid", gap: 12 }}>
          <input
            className="input-xl"
            type="text"
            placeholder={t("home.placeholder")}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
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
              {dl.busy
                ? t("home.downloading", { pct: Math.round(dl.percent) })
                : t("home.download")}
            </button>
            {dl.busy && (
              <button type="button" className="btn-lg" onClick={dl.cancel}>
                {t("home.cancel")}
              </button>
            )}
            {!dl.busy && (
              <button type="button" className="btn-lg" onClick={pickLocal}>
                {t("home.localFile")}
              </button>
            )}
          </div>
        </div>

        <RecentVideos
          active={active}
          mode="open"
          disabled={dl.busy}
          onPick={(v) => onResume(v.id, v.clip_count > 0)}
        />

        <button
          type="button"
          className="ghost"
          onClick={onBack}
          disabled={dl.busy}
          style={{ justifySelf: "start" }}
        >
          {t("video.back")}
        </button>
      </div>
    </div>
  );
}
