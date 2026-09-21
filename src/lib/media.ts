export const VIDEO_EXTS = [
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

export const AUDIO_EXTS = ["mp3", "m4a", "wav", "aac", "flac", "ogg", "opus"];

// Accept a full URL or a bare 11-char YouTube id (e.g. "TM5EWRJ2ZSQ").
export function toVideoUrl(input: string): string {
  const s = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) {
    return `https://www.youtube.com/watch?v=${s}`;
  }
  return s;
}

// A direct media URL ends in a single-file video extension — fetch it straight
// over HTTP. Anything else (YouTube, HLS, other sites) goes through yt-dlp.
export function isDirectMedia(input: string): boolean {
  try {
    const u = new URL(input);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const ext = u.pathname.split(".").pop()?.toLowerCase();
    return !!ext && VIDEO_EXTS.includes(ext);
  } catch {
    return false;
  }
}

export function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function extname(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

// Mirrors export.rs `sanitize` so saved videos and exported folders share names.
export function safeFileName(title: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|]/g, "-")
    .trim()
    .replace(/^\.+|\.+$/g, "");
  return Array.from(cleaned).slice(0, 80).join("") || "video";
}

export function fmtDuration(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = (total % 60).toString().padStart(2, "0");
  return h > 0 ? `${h}:${m.toString().padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export function fmtSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}
