import Database from "@tauri-apps/plugin-sql";
import type { ParsedXml } from "./xml";

let dbP: Promise<Database> | null = null;

// Migrations run on first load (registered in the Rust sql plugin builder
// against this exact connection string).
function db(): Promise<Database> {
  if (!dbP) dbP = Database.load("sqlite:cliply-exporter.db");
  return dbP;
}

export interface VideoRow {
  id: string;
  title: string;
  url: string;
  local_path: string;
  created_at: number;
}

export async function createVideo(
  v: Omit<VideoRow, "created_at">,
): Promise<void> {
  const d = await db();
  await d.execute(
    "INSERT INTO videos (id, title, url, local_path, created_at) VALUES (?, ?, ?, ?, ?)",
    [v.id, v.title, v.url, v.local_path, Date.now()],
  );
}

export async function getVideo(videoId: string): Promise<VideoRow | undefined> {
  const d = await db();
  const rows = await d.select<VideoRow[]>(
    "SELECT * FROM videos WHERE id = ?",
    [videoId],
  );
  return rows[0];
}

export interface VideoListRow extends VideoRow {
  clip_count: number;
}

// Recent videos, newest first, with how many clips each has (0 = imported but
// no XML yet).
export async function listVideos(): Promise<VideoListRow[]> {
  const d = await db();
  return d.select<VideoListRow[]>(
    `SELECT v.id, v.title, v.url, v.local_path, v.created_at,
            COUNT(c.id) AS clip_count
     FROM videos v
     LEFT JOIN clips c ON c.video_id = v.id
     GROUP BY v.id
     ORDER BY v.created_at DESC`,
  );
}

export async function getClipIds(videoId: string): Promise<string[]> {
  const d = await db();
  const rows = await d.select<{ id: string }[]>(
    "SELECT id FROM clips WHERE video_id = ?",
    [videoId],
  );
  return rows.map((r) => r.id);
}

// Removes a video and everything hanging off it. clips/tag_types are deleted
// explicitly (FK cascade isn't enforced unless the connection enables it).
export async function deleteVideo(videoId: string): Promise<void> {
  const d = await db();
  await d.execute("DELETE FROM clips WHERE video_id = ?", [videoId]);
  await d.execute("DELETE FROM tag_types WHERE video_id = ?", [videoId]);
  await d.execute("DELETE FROM videos WHERE id = ?", [videoId]);
}

// Inserts tag types (one per distinct code, colored from <ROWS>) and clips.
export async function saveParsed(
  videoId: string,
  parsed: ParsedXml,
): Promise<void> {
  const d = await db();

  const codes = new Map<string, { label: string; color: string }>();
  for (const c of parsed.clips) {
    const key = c.code.toLowerCase();
    if (!codes.has(key)) {
      codes.set(key, {
        label: c.code,
        color: parsed.rows.get(key)?.color ?? "#7a7a88",
      });
    }
  }

  const tagId = new Map<string, string>();
  for (const [key, meta] of codes) {
    const id = crypto.randomUUID();
    tagId.set(key, id);
    await d.execute(
      "INSERT INTO tag_types (id, video_id, key, label, color) VALUES (?, ?, ?, ?, ?)",
      [id, videoId, key, meta.label, meta.color],
    );
  }

  for (const c of parsed.clips) {
    const id = crypto.randomUUID();
    const tt = tagId.get(c.code.toLowerCase()) ?? null;
    const name = c.flags.length ? c.flags.join(", ") : null;
    await d.execute(
      "INSERT INTO clips (id, video_id, tag_type_id, name, t_sec, start_sec, end_sec) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, videoId, tt, name, c.start, c.start, c.end],
    );
  }
}

export interface ClipRow {
  id: string;
  name: string | null;
  t_sec: number;
  start_sec: number;
  end_sec: number;
  tag_label: string | null;
  tag_color: string | null;
}

export async function getClips(videoId: string): Promise<ClipRow[]> {
  const d = await db();
  return d.select<ClipRow[]>(
    `SELECT c.id, c.name, c.t_sec, c.start_sec, c.end_sec,
            t.label AS tag_label, t.color AS tag_color
     FROM clips c
     LEFT JOIN tag_types t ON t.id = c.tag_type_id
     WHERE c.video_id = ?
     ORDER BY c.start_sec`,
    [videoId],
  );
}
