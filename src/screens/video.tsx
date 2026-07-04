import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { cancelDownload, downloadUrl, downloadYoutube } from "../lib/api";
import { createVideo } from "../lib/db";
import { friendlyError } from "../lib/errors";
import { playSfx } from "../lib/sfx";

const VIDEO_EXTS = [
  "mp4",
  "m4v",
  "mov",
  "webm",
  "mkv",
  "avi",
  "mpg",
  "mpeg",
  "wmv",
  "flv",
];

// Accept a full URL or a bare 11-char YouTube id (e.g. "TM5EWRJ2ZSQ").
function toVideoUrl(input: string): string {
  const s = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) {
    return `https://www.youtube.com/watch?v=${s}`;
  }
  return s;
}

// A direct media URL ends in a single-file video extension — fetch it straight
// over HTTP. Anything else (YouTube, HLS, other sites) goes through yt-dlp.
function isDirectMedia(input: string): boolean {
  try {
    const u = new URL(input);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const ext = u.pathname.split(".").pop()?.toLowerCase();
    return !!ext && VIDEO_EXTS.includes(ext);
  } catch {
    return false;
  }
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

// Step 1 — add a video by link/URL/id (downloaded) or a local file (used in
// place). On success routes on to the XML import step.
export function AddVideo({
  onVideo,
  onBack,
}: {
  onVideo: (videoId: string) => void;
  onBack: () => void;
}) {
  const { t } = useT();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const videoId = useRef<string | null>(null);

  useEffect(() => {
    const un = listen<{ videoId: string; percent: number }>(
      "media-download",
      (e) => {
        if (e.payload.videoId === videoId.current) setPercent(e.payload.percent);
      },
    );
    return () => {
      un.then((f) => f());
    };
  }, []);

  const start = useCallback(async () => {
    const target = toVideoUrl(url);
    if (!target) return;
    const id = crypto.randomUUID();
    videoId.current = id;
    setBusy(true);
    setError(null);
    setPercent(0);
    try {
      const fetcher = isDirectMedia(target) ? downloadUrl : downloadYoutube;
      const out = await fetcher(id, target);
      if (out.status === "cancelled") {
        setBusy(false);
        return;
      }
      await createVideo({
        id,
        title: out.title ?? target,
        url: target,
        local_path: out.path ?? "",
      });
      playSfx();
      onVideo(id);
    } catch (e) {
      setError(friendlyError(e, t));
      setBusy(false);
    }
  }, [url, onVideo, t]);

  // Use a local video file in place — no download, no copy. ffmpeg and the
  // asset protocol read the original path directly.
  const pickLocal = useCallback(async () => {
    setError(null);
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
      setError(friendlyError(e, t));
    }
  }, [onVideo, t]);

  const cancel = useCallback(() => {
    if (videoId.current) cancelDownload(videoId.current);
  }, []);

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
            disabled={busy}
          />
          {busy && (
            <div className="bar">
              <span style={{ width: `${percent}%` }} />
            </div>
          )}
          {error && (
            <p style={{ color: "var(--destructive)", margin: 0 }}>{error}</p>
          )}
          <div className="row">
            <button
              type="button"
              className="primary btn-lg"
              onClick={start}
              disabled={busy || !url.trim()}
            >
              {busy
                ? t("home.downloading", { pct: Math.round(percent) })
                : t("home.download")}
            </button>
            {busy && (
              <button type="button" className="btn-lg" onClick={cancel}>
                {t("home.cancel")}
              </button>
            )}
            {!busy && (
              <button type="button" className="btn-lg" onClick={pickLocal}>
                {t("home.localFile")}
              </button>
            )}
          </div>
        </div>

        <button
          type="button"
          className="ghost"
          onClick={onBack}
          disabled={busy}
          style={{ justifySelf: "start" }}
        >
          {t("video.back")}
        </button>
      </div>
    </div>
  );
}
