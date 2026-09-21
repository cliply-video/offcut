import type { ReactNode } from "react";
import { useT } from "../i18n";
import type { FileEntry } from "../lib/api";
import { basename, fmtDuration, fmtSize } from "../lib/media";
import type { ListedFile } from "../lib/use-file-list";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
  FilmIcon,
  PlusIcon,
} from "./icons";
import { Corners } from "./osd";

function describe(entry: FileEntry): string {
  const p = entry.probe;
  if (!p) return "";
  const parts: string[] = [];
  if (p.video) {
    parts.push(p.video.codec.toUpperCase());
    parts.push(`${p.video.width}×${p.video.height}`);
    if (p.video.fps > 0) parts.push(`${Math.round(p.video.fps * 100) / 100} fps`);
  }
  if (p.audio) parts.push(p.audio.codec.toUpperCase());
  if (p.durationSec > 0) parts.push(fmtDuration(p.durationSec));
  if (p.sizeBytes > 0) parts.push(fmtSize(p.sizeBytes));
  return parts.join(" · ");
}

// Shared by Join (ordered: numbered rows + reorder) and Convert. `entries` is
// the backend's view of the same files, index-aligned; it lags the list while a
// probe is in flight, hence the path check.
export function FileList({
  files,
  entries,
  ordered,
  locked,
  dragging,
  emptyLabel,
  addLabel,
  chip,
  onPick,
  onRemove,
  onMove,
}: {
  files: ListedFile[];
  entries: FileEntry[] | undefined;
  ordered?: boolean;
  locked: boolean;
  dragging: boolean;
  emptyLabel: string;
  addLabel: string;
  chip?: (entry: FileEntry) => ReactNode;
  onPick: () => void;
  onRemove: (id: string) => void;
  onMove?: (id: string, delta: -1 | 1) => void;
}) {
  const { t } = useT();

  if (files.length === 0) {
    return (
      <button
        type="button"
        className={`dropzone ${dragging ? "over" : ""}`}
        onClick={onPick}
      >
        <Corners />
        <FilmIcon size={26} />
        <span className="dropzone-title">{emptyLabel}</span>
        <span className="dropzone-hint">{t("files.dropHint")}</span>
      </button>
    );
  }

  return (
    <div className={`filelist-wrap ${dragging ? "over" : ""}`}>
      <ol className="filelist">
        {files.map((file, i) => {
          const entry =
            entries?.[i]?.path === file.path ? entries[i] : undefined;
          return (
            <li
              key={file.id}
              className={`filerow ${entry?.error ? "bad" : ""}`}
            >
              {ordered && (
                <span className="filerow-n">
                  {(i + 1).toString().padStart(2, "0")}
                </span>
              )}
              <div className="filerow-main">
                <span className="filerow-name">
                  {entry?.name ?? file.title ?? basename(file.path)}
                </span>
                <span className="filerow-meta">
                  {!entry
                    ? t("files.reading")
                    : entry.error
                      ? t(`files.err.${entry.error}`)
                      : describe(entry)}
                </span>
              </div>
              {entry && !entry.error && chip?.(entry)}
              {ordered && onMove && (
                <div className="filerow-order">
                  <button
                    type="button"
                    className="filerow-btn"
                    aria-label={t("files.moveUp")}
                    disabled={locked || i === 0}
                    onClick={() => onMove(file.id, -1)}
                  >
                    <ChevronUpIcon />
                  </button>
                  <button
                    type="button"
                    className="filerow-btn"
                    aria-label={t("files.moveDown")}
                    disabled={locked || i === files.length - 1}
                    onClick={() => onMove(file.id, 1)}
                  >
                    <ChevronDownIcon />
                  </button>
                </div>
              )}
              <button
                type="button"
                className="filerow-btn"
                aria-label={t("files.remove")}
                disabled={locked}
                onClick={() => onRemove(file.id)}
              >
                <CloseIcon size={11} />
              </button>
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        className="filelist-add"
        onClick={onPick}
        disabled={locked}
      >
        <PlusIcon size={12} />
        {addLabel}
      </button>
    </div>
  );
}
