import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { cancelDownload, downloadUrl, downloadYoutube } from "./api";
import { createVideo } from "./db";
import { friendlyError } from "./errors";
import { isDirectMedia, toVideoUrl } from "./media";

export type Downloaded = { id: string; title: string; path: string };

// Downloads a link into the library (yt-dlp, or plain HTTP for a direct media
// URL) and tracks its progress. Shared by the Download tool and the clip flow.
export function useDownload() {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<string | null>(null);
  const alive = useRef(true);

  // A download with no screen left to show or cancel it is stopped. (Set on
  // mount too: StrictMode runs this cleanup once before the real mount.)
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (current.current) cancelDownload(current.current);
    };
  }, []);

  useEffect(() => {
    const un = listen<{ videoId: string; percent: number }>(
      "media-download",
      (e) => {
        if (e.payload.videoId === current.current) setPercent(e.payload.percent);
      },
    );
    return () => {
      un.then((f) => f());
    };
  }, []);

  // Resolves to null when cancelled or failed (the error is in `error`).
  const start = useCallback(
    async (input: string): Promise<Downloaded | null> => {
      const target = toVideoUrl(input);
      if (!target) return null;
      const id = crypto.randomUUID();
      current.current = id;
      setBusy(true);
      setError(null);
      setPercent(0);
      try {
        const fetcher = isDirectMedia(target) ? downloadUrl : downloadYoutube;
        const out = await fetcher(id, target);
        if (out.status === "cancelled") return null;
        const video = { id, title: out.title ?? target, path: out.path ?? "" };
        await createVideo({
          id,
          title: video.title,
          url: target,
          local_path: video.path,
        });
        // Finished in the same beat the screen went away: the video is in the
        // library, but nobody is waiting to be routed anywhere.
        return alive.current ? video : null;
      } catch (e) {
        setError(friendlyError(e, t));
        return null;
      } finally {
        current.current = null;
        setBusy(false);
      }
    },
    [t],
  );

  const cancel = useCallback(() => {
    if (current.current) cancelDownload(current.current);
  }, []);

  return { busy, percent, error, setError, start, cancel };
}
