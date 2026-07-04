type Translate = (key: string, vars?: Record<string, string | number>) => string;

// Maps the raw (English, technical) error strings the Rust side returns to
// friendly, localized messages. Unrecognized errors fall through to the raw
// text so nothing is ever hidden.
export function friendlyError(e: unknown, t: Translate): string {
  const raw = String(e).replace(/^Error:\s*/, "");
  const low = raw.toLowerCase();

  if (low.includes("javascript runtime") || low.includes("js runtime")) {
    return t("err.jsRuntime");
  }
  if (low.includes("checksum")) return t("err.checksum");
  if (low.includes("no managed download")) return t("err.noManagedDownload");
  if (low.includes("ffmpeg is not available")) return t("err.ffmpegMissing");
  if (low.includes("ffprobe is not available")) return t("err.ffprobeMissing");
  if (low.includes("yt-dlp is not available")) return t("err.ytdlpMissing");
  if (low.includes("source video not found")) return t("err.sourceMissing");
  if (
    low.includes("sign in") ||
    low.includes("private video") ||
    low.includes("unavailable") ||
    low.includes("removed") ||
    low.includes("age")
  ) {
    return t("err.videoUnavailable");
  }
  if (
    low.includes("http") ||
    low.includes("dns") ||
    low.includes("timed out") ||
    low.includes("connection") ||
    low.includes("network")
  ) {
    return t("err.network");
  }
  return raw;
}
