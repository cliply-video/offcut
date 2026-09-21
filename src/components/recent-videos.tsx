import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { listVideos, type VideoListRow } from "../lib/db";
import {
  ArrowRightIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  PlusIcon,
} from "./icons";

// The library as a source: a video already downloaded (or opened) can feed any
// tool without a trip through the file dialog. "add" queues its file in Join /
// Convert; "open" resumes it in the clip cutter.
export function RecentVideos({
  active,
  mode,
  disabled,
  taken,
  onPick,
}: {
  active: boolean;
  mode: "add" | "open";
  disabled?: boolean;
  taken?: (path: string) => boolean;
  onPick: (video: VideoListRow) => void;
}) {
  const { t } = useT();
  const [videos, setVideos] = useState<VideoListRow[]>([]);
  const [open, setOpen] = useState(true);

  // The tools stay mounted, so reload on every return to the tab: a download
  // finished meanwhile has to show up.
  useEffect(() => {
    if (!active) return;
    listVideos()
      .then((rows) => setVideos(rows.filter((v) => v.local_path)))
      .catch(() => {});
  }, [active]);

  if (videos.length === 0) return null;

  return (
    <div className="recent">
      <button
        type="button"
        className="recent-toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {t("recent.title", { n: videos.length })}
        {open ? <ChevronUpIcon size={11} /> : <ChevronDownIcon size={11} />}
      </button>
      {open && (
        <ul className="recent-list recent-list--compact">
          {videos.map((v) => {
            const used = taken?.(v.local_path) ?? false;
            return (
              <li key={v.id} className="recent-row">
                <button
                  type="button"
                  className="recent-open"
                  disabled={disabled || used}
                  onClick={() => onPick(v)}
                >
                  <span className="recent-title">
                    {v.title || t("home.untitled")}
                  </span>
                  <span className="recent-meta">
                    {mode === "open"
                      ? v.clip_count > 0
                        ? t("home.clipCount", { n: v.clip_count })
                        : t("home.noClipsYet")
                      : t(v.url ? "recent.downloaded" : "recent.local")}
                  </span>
                </button>
                <span className={`recent-action ${used ? "used" : ""}`}>
                  {mode === "open" ? (
                    <>
                      {t("recent.open")}
                      <ArrowRightIcon size={11} />
                    </>
                  ) : used ? (
                    t("recent.added")
                  ) : (
                    <>
                      <PlusIcon size={11} />
                      {t("recent.add")}
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
