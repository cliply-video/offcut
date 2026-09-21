import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { extname } from "./media";

export type ListedFile = { id: string; path: string; title: string | null };

// The file list behind Join and Convert: picker + drag-and-drop in, reorder
// and remove. `unique` drops paths already listed (Convert); Join keeps
// repeats, since using one clip twice is legitimate.
export function useFileList({
  exts,
  active,
  unique,
  locked,
  done,
}: {
  exts: string[];
  // The webview reports drops window-wide and every tool stays mounted, so
  // only the visible one may claim them.
  active: boolean;
  unique: boolean;
  // A job is running on this list: it can't change under it.
  locked: boolean;
  // A finished result is on screen: the next files start a new list, or the
  // run after it would redo the ones already done.
  done: boolean;
}) {
  const [files, setFiles] = useState<ListedFile[]>([]);
  const [dragging, setDragging] = useState(false);

  // Read through a ref so the webview listener (bound once) sees live values.
  const live = useRef({ active, locked, done });
  live.current = { active, locked, done };

  // `title` names a library video, whose own file name is just a uuid.
  const add = useCallback(
    (paths: string[], title: string | null = null) => {
      if (live.current.locked) return;
      const wanted = paths.filter((p) => exts.includes(extname(p)));
      if (wanted.length === 0) return;
      const fresh = live.current.done;
      setFiles((prev) => {
        const kept = fresh ? [] : prev;
        const seen = new Set(kept.map((f) => f.path));
        const added = unique
          ? wanted.filter((p) => !seen.has(p) && seen.add(p))
          : wanted;
        return [
          ...kept,
          ...added.map((path) => ({ id: crypto.randomUUID(), path, title })),
        ];
      });
    },
    [exts, unique],
  );

  const pick = useCallback(async () => {
    const picked = await open({
      multiple: true,
      filters: [{ name: "Media", extensions: exts }],
    });
    if (Array.isArray(picked)) add(picked);
    else if (typeof picked === "string") add([picked]);
  }, [add, exts]);

  const remove = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const move = useCallback((id: string, delta: -1 | 1) => {
    setFiles((prev) => {
      const from = prev.findIndex((f) => f.id === id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  }, []);

  const clear = useCallback(() => setFiles([]), []);

  useEffect(() => {
    const un = getCurrentWebview().onDragDropEvent((e) => {
      const { active, locked } = live.current;
      if (!active || locked) {
        setDragging(false);
        return;
      }
      if (e.payload.type === "drop") {
        setDragging(false);
        add(e.payload.paths);
      } else {
        setDragging(e.payload.type !== "leave");
      }
    });
    return () => {
      un.then((f) => f());
    };
  }, [add]);

  return { files, dragging: dragging && active, add, pick, remove, move, clear };
}
