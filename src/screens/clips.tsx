import { convertFileSrc } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "../i18n";
import { type ExportClip, generatePoster } from "../lib/api";
import { type ClipRow, getClips, getVideo } from "../lib/db";
import { ExportDialog } from "./export-dialog";

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

interface Group {
  label: string;
  color: string;
  clips: ClipRow[];
}

export function Clips({
  videoId,
  onBack,
}: {
  videoId: string;
  onBack: () => void;
}) {
  const { t } = useT();
  const [clips, setClips] = useState<ClipRow[]>([]);
  const [localPath, setLocalPath] = useState("");
  const [title, setTitle] = useState("clips");
  const [sel, setSel] = useState<Set<string>>(new Set());
  // null = closed; number = seek-to seconds in the full video.
  const [playAt, setPlayAt] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    (async () => {
      const v = await getVideo(videoId);
      if (v) {
        setLocalPath(v.local_path);
        setTitle(v.title);
      }
      const rows = await getClips(videoId);
      setClips(rows);
      setSel(new Set(rows.map((c) => c.id)));
    })();
  }, [videoId]);

  const selectedClips = useMemo<ExportClip[]>(
    () =>
      clips
        .filter((c) => sel.has(c.id))
        .map((c) => ({
          name: c.name,
          startSec: c.start_sec,
          endSec: c.end_sec,
          tagLabel: c.tag_label,
        })),
    [clips, sel],
  );

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    for (const c of clips) {
      const label = c.tag_label ?? t("clips.untagged");
      let g = map.get(label);
      if (!g) {
        g = { label, color: c.tag_color ?? "#7a7a88", clips: [] };
        map.set(label, g);
      }
      g.clips.push(c);
    }
    return Array.from(map.values());
  }, [clips, t]);

  const toggle = useCallback((id: string) => {
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleGroup = useCallback((g: Group) => {
    setSel((prev) => {
      const next = new Set(prev);
      const allOn = g.clips.every((c) => next.has(c.id));
      for (const c of g.clips) {
        if (allOn) next.delete(c.id);
        else next.add(c.id);
      }
      return next;
    });
  }, []);

  const allSelected = clips.length > 0 && sel.size === clips.length;

  return (
    <div style={{ padding: "20px 28px" }}>
      <div className="clips-bar">
        <button type="button" className="ghost" onClick={onBack}>
          {t("clips.newVideo")}
        </button>
        <div className="row" style={{ gap: 10 }}>
          <span className="count-chip">
            {t("clips.selected", { sel: sel.size, total: clips.length })}
          </span>
          <button
            type="button"
            onClick={() =>
              setSel(allSelected ? new Set() : new Set(clips.map((c) => c.id)))
            }
          >
            {allSelected ? t("clips.clear") : t("clips.selectAll")}
          </button>
          {localPath && (
            <button type="button" onClick={() => setPlayAt(0)}>
              ▶ {t("clips.watch")}
            </button>
          )}
          <button
            type="button"
            className="primary"
            disabled={sel.size === 0}
            onClick={() => setExporting(true)}
          >
            {t("clips.export")}
          </button>
        </div>
      </div>

      {groups.map((g) => {
        const selN = g.clips.filter((c) => sel.has(c.id)).length;
        const state = selN === 0 ? "" : selN === g.clips.length ? "all" : "some";
        return (
          <section key={g.label}>
            <div
              className="group-head"
              onClick={() => toggleGroup(g)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleGroup(g);
                }
              }}
              role="button"
              tabIndex={0}
              aria-label={g.label}
            >
              <span className={`group-check ${state}`}>
                <CheckIcon />
              </span>
              <span className="dot" style={{ background: g.color }} />
              <span className="gname">{g.label}</span>
              <span className="gcount">
                {selN}/{g.clips.length}
              </span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(168px, 1fr))",
                gap: 10,
              }}
            >
              {g.clips.map((c) => (
                <ClipCard
                  key={c.id}
                  clip={c}
                  localPath={localPath}
                  selected={sel.has(c.id)}
                  onToggle={() => toggle(c.id)}
                  onPlay={() => setPlayAt(c.t_sec)}
                />
              ))}
            </div>
          </section>
        );
      })}

      {playAt !== null && localPath && (
        <VideoOverlay
          src={localPath}
          at={playAt}
          title={title}
          closeLabel={t("clips.close")}
          onClose={() => setPlayAt(null)}
        />
      )}

      {exporting && localPath && (
        <ExportDialog
          videoId={videoId}
          videoTitle={title}
          sourcePath={localPath}
          clips={selectedClips}
          onClose={() => setExporting(false)}
        />
      )}
    </div>
  );
}

function ClipCard({
  clip,
  localPath,
  selected,
  onToggle,
  onPlay,
}: {
  clip: ClipRow;
  localPath: string;
  selected: boolean;
  onToggle: () => void;
  onPlay: () => void;
}) {
  const { t } = useT();
  const [poster, setPoster] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!localPath) return;
    generatePoster(clip.id, localPath, clip.t_sec)
      .then((p) => {
        if (alive) setPoster(convertFileSrc(p));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [clip.id, clip.t_sec, localPath]);

  return (
    <div
      className={`clip ${selected ? "sel" : "unsel"}`}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      role="checkbox"
      aria-checked={selected}
      aria-label={clip.name ?? clip.tag_label ?? t("clips.clip")}
      tabIndex={0}
    >
      <div
        className="clip-poster"
        style={poster ? { backgroundImage: `url(${poster})` } : undefined}
      >
        <span className="clip-check">{selected && <CheckIcon />}</span>
        <button
          type="button"
          className="clip-play"
          aria-label={t("clips.watch")}
          onClick={(e) => {
            e.stopPropagation();
            onPlay();
          }}
        >
          <span>
            <PlayIcon />
          </span>
        </button>
      </div>
      <div className="clip-meta">
        <div className="nm">{clip.name ?? clip.tag_label ?? t("clips.clip")}</div>
        <div className="tm">
          {fmt(clip.start_sec)}–{fmt(clip.end_sec)}
        </div>
      </div>
    </div>
  );
}

function VideoOverlay({
  src,
  at,
  title,
  closeLabel,
  onClose,
}: {
  src: string;
  at: number;
  title: string;
  closeLabel: string;
  onClose: () => void;
}) {
  return (
    <div className="overlay" onClick={onClose}>
      <button type="button" className="overlay-close" onClick={onClose}>
        ✕ {closeLabel}
      </button>
      {/* biome-ignore lint/a11y: backdrop closes; native video controls used */}
      <video
        src={convertFileSrc(src)}
        controls
        autoPlay
        title={title}
        onClick={(e) => e.stopPropagation()}
        onLoadedMetadata={(e) => {
          if (at > 0) e.currentTarget.currentTime = at;
        }}
      >
        <track kind="captions" />
      </video>
    </div>
  );
}
