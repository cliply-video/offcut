import { confirm } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useState } from "react";
import { ArrowRightIcon } from "../components/icons";
import { useT } from "../i18n";
import { deleteMedia } from "../lib/api";
import {
  deleteVideo,
  getClipIds,
  listVideos,
  type VideoListRow,
} from "../lib/db";
import { friendlyError } from "../lib/errors";

// Landing / branding page — the entry point, outside the step flow. Introduces
// the app and launches the three-step flow (video → xml → clips) or resumes a
// past video.
export function Landing({
  onStart,
  onResume,
}: {
  onStart: () => void;
  onResume: (videoId: string, hasClips: boolean) => void;
}) {
  const { t } = useT();
  const [recent, setRecent] = useState<VideoListRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listVideos()
      .then(setRecent)
      .catch(() => {});
  }, []);

  const remove = useCallback(
    async (v: VideoListRow) => {
      const ok = await confirm(t("home.deleteConfirm", { title: v.title }), {
        title: t("home.deleteTitle"),
        kind: "warning",
      });
      if (!ok) return;
      try {
        const clipIds = await getClipIds(v.id);
        await deleteMedia(v.id, clipIds);
        await deleteVideo(v.id);
        setRecent((r) => r.filter((x) => x.id !== v.id));
      } catch (e) {
        setError(friendlyError(e, t));
      }
    },
    [t],
  );

  return (
    <div className="stage stage-top">
      <div className="hero">
        <div style={{ display: "grid", gap: 10 }}>
          <p className="eyebrow">{t("home.eyebrow")}</p>
          <h1 className="display">
            {t("home.titleA")}
            <br />
            <span className="accent-text">{t("home.titleB")}</span>
          </h1>
        </div>

        <p className="lead">{t("home.lead")}</p>

        {error && <p style={{ color: "var(--destructive)", margin: 0 }}>{error}</p>}

        <div className="hero-cta-row">
          <button type="button" className="primary hero-cta" onClick={onStart}>
            {t("home.start")}
            <ArrowRightIcon size={17} />
          </button>
        </div>

        {recent.length > 0 && (
          <div className="recent">
            <p className="eyebrow">{t("home.recent")}</p>
            <ul className="recent-list">
              {recent.map((v) => (
                <li key={v.id} className="recent-row">
                  <button
                    type="button"
                    className="recent-open"
                    onClick={() => onResume(v.id, v.clip_count > 0)}
                  >
                    <span className="recent-title">
                      {v.title || t("home.untitled")}
                    </span>
                    <span className="recent-meta">
                      {v.clip_count > 0
                        ? t("home.clipCount", { n: v.clip_count })
                        : t("home.noClipsYet")}
                    </span>
                  </button>
                  <button type="button" className="ghost" onClick={() => remove(v)}>
                    {t("home.delete")}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
