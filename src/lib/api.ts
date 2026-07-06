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
