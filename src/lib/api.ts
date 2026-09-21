import { invoke } from "@tauri-apps/api/core";

export type BinariesStatus = {
  ffmpeg: boolean;
  ffprobe: boolean;
  ytdlp: boolean;
  deno: boolean;
};

export const binariesStatus = () =>
  invoke<BinariesStatus>("binaries_status");

export const downloadBinaries = () => invoke<void>("download_binaries");

export type DownloadOutcome = {
  status: "done" | "cancelled";
  path: string | null;
  title: string | null;
};

export const downloadYoutube = (videoId: string, url: string) =>
  invoke<DownloadOutcome>("download_youtube", { videoId, url });

export const downloadUrl = (videoId: string, url: string) =>
  invoke<DownloadOutcome>("download_url", { videoId, url });

export const cancelDownload = (videoId: string) =>
  invoke<void>("cancel_download", { videoId });

export const readXmlFile = (path: string) =>
  invoke<string>("read_xml_file", { path });

export const fetchXmlUrl = (url: string) =>
  invoke<string>("fetch_xml_url", { url });

export const generatePoster = (clipId: string, src: string, tSec: number) =>
  invoke<string>("generate_poster", { clipId, src, tSec });

export const copyFile = (src: string, dest: string) =>
  invoke<void>("copy_file", { src, dest });

export type MediaInfo = { vcodec: string; durationSec: number };

export const probeMedia = (src: string) =>
  invoke<MediaInfo>("probe_media", { src });

export const deleteMedia = (videoId: string, clipIds: string[]) =>
  invoke<void>("delete_media", { videoId, clipIds });

export type ExportClip = {
  name: string | null;
  startSec: number;
  endSec: number;
  tagLabel: string | null;
};

export type ReelMode = "none" | "perTag" | "combined";

export type ExportOptions = {
  videoId: string;
  videoTitle: string;
  sourcePath: string;
  outDir: string;
  clips: ExportClip[];
  individualClips: boolean;
  reelMode: ReelMode;
  reencode: boolean;
  watermark: boolean;
  mute: boolean;
};

export type ExportSummary = {
  clips: number;
  reels: number;
  outDir: string;
  cancelled: boolean;
};

export const exportClips = (options: ExportOptions) =>
  invoke<ExportSummary>("export_clips", { options });

export const cancelExport = (videoId: string) =>
  invoke<void>("cancel_export", { videoId });

export const moveFile = (src: string, dest: string) =>
  invoke<void>("move_file", { src, dest });

export type VideoInfo = {
  codec: string;
  width: number;
  height: number;
  fps: number;
};

export type AudioInfo = { codec: string; sampleRate: number; channels: number };

export type FileProbe = {
  sizeBytes: number;
  durationSec: number;
  video: VideoInfo | null;
  audio: AudioInfo | null;
};

export type FileError = "unreadable" | "no-video" | "no-audio";

// `title` rides along with library videos, whose file on disk is `<uuid>.mp4`.
export type SourceFile = { path: string; title: string | null };

export type FileEntry = {
  path: string;
  name: string;
  // A library download living in app data: outputs never go next to it.
  managed: boolean;
  probe: FileProbe | null;
  error: FileError | null;
};

export type ToolProgress = {
  jobId: string;
  percent: number;
  index: number;
  total: number;
  label: string;
};

export const cancelJob = (jobId: string) =>
  invoke<void>("cancel_job", { jobId });

export type JoinPlan = {
  mode: "copy" | "reencode" | "invalid";
  mismatches: string[];
  variableFps: boolean;
  files: FileEntry[];
  width: number;
  height: number;
  fps: number;
  ext: string;
  durationSec: number;
};

// `fps` sets the re-encode rate; null follows the first video.
export const planJoin = (
  files: SourceFile[],
  reencode: boolean,
  fps: number | null,
) => invoke<JoinPlan>("plan_join", { files, reencode, fps });

export type JoinOutcome = {
  cancelled: boolean;
  out: string;
  mode: JoinPlan["mode"];
};

export const runJoin = (
  jobId: string,
  files: SourceFile[],
  reencode: boolean,
  fps: number | null,
  outPath: string,
) => invoke<JoinOutcome>("run_join", { jobId, files, reencode, fps, outPath });

export type Container = "mp4" | "mov" | "mkv" | "webm" | "mp3" | "m4a" | "wav";
export type Quality = "low" | "medium" | "high" | "veryHigh";

export type ConvertTarget = {
  container: Container;
  videoCodec: "auto" | "h264" | "hevc" | "vp9";
  // "none" strips the audio track.
  audioCodec: "auto" | "none" | "aac" | "opus" | "mp3";
  quality: Quality | null;
  // Exact video bitrate, or a size each output should land near. Either one
  // replaces `quality` and forces a re-encode.
  videoKbps: number | null;
  sizeMb: number | null;
  height: number | null;
  fps: number | null;
};

export type ConvertVerdict = "copy" | "audio" | "reencode";

export type ConvertItem = FileEntry & {
  verdict: ConvertVerdict | null;
  outDir: string;
};

export const planConvert = (
  files: SourceFile[],
  target: ConvertTarget,
  outDir: string | null,
) => invoke<ConvertItem[]>("plan_convert", { files, target, outDir });

export type ConvertSummary = {
  outputs: { src: string; out: string; verdict: ConvertVerdict }[];
  failed: { name: string; error: string }[];
  cancelled: boolean;
};

export const runConvert = (
  jobId: string,
  files: SourceFile[],
  target: ConvertTarget,
  outDir: string | null,
) => invoke<ConvertSummary>("run_convert", { jobId, files, target, outDir });
