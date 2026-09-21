import { confirm } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useState } from "react";
import { ArrowRightIcon } from "../components/icons";
import { Corners } from "../components/osd";
import { TOOLS, type ToolName } from "../components/tool-rail";
import { useT } from "../i18n";
import { deleteMedia } from "../lib/api";
import {
  deleteVideo,
  getClipIds,
  listVideos,
  type VideoListRow,
} from "../lib/db";
import { friendlyError } from "../lib/errors";

// Home — the tool hub. Each card opens a tool; the library below resumes a
// past video in the clip cutter.
export function Landing({
  onTool,
  onResume,
  onDeleted,
}: {
  onTool: (tool: ToolName) => void;
  onResume: (videoId: string, hasClips: boolean) => void;
  onDeleted: (videoId: string) => void;
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
        onDeleted(v.id);
      } catch (e) {
        setError(friendlyError(e, t));
      }
    },
    [t, onDeleted],
  );

  return (
    <div className="stage stage-top">
      <div className="hero">
        <div style={{ display: "grid", gap: 10 }}>
          <p className="eyebrow">{t("home.eyebrow")}</p>
          <h1 className="display display-md">
            {t("home.titleA")}
            <br />
            <span className="accent-text">{t("home.titleB")}</span>
          </h1>
        </div>

        <p className="lead">{t("home.lead")}</p>

        {error && <p className="error-text">{error}</p>}

        <div className="toolgrid">
          {TOOLS.map(({ key, Icon }, i) => (
            <button
              key={key}
              type="button"
              className="toolcard"
              onClick={() => onTool(key)}
            >
              <Corners />
              <span className="toolcard-top">
                <Icon size={20} />
                <span className="toolcard-n">0{i + 1}</span>
              </span>
              <span className="toolcard-name">{t(`tools.${key}`)}</span>
              <span className="toolcard-desc">{t(`home.tool.${key}`)}</span>
              <span className="toolcard-go">
                {t("home.open")}
                <ArrowRightIcon size={12} />
              </span>
            </button>
          ))}
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
