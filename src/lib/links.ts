import { openUrl } from "@tauri-apps/plugin-opener";

export const GITHUB_URL = "https://github.com/cliply-video/cliply-exporter";
export const CLIPLY_URL = "https://cliply.video";

// Only a query string on an outbound link — the app itself still sends nothing.
export const cliplyUrl = (content: string) =>
  `${CLIPLY_URL}/?utm_source=exporter&utm_medium=app&utm_campaign=exporter&utm_content=${content}`;

export const openExternal = (url: string) => {
  openUrl(url).catch(() => {});
};
