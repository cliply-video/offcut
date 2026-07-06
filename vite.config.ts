import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tauriConf from "./src-tauri/tauri.conf.json";

// Displayed version comes from the git tag, not a hand-maintained field, so it
// can never drift stale. Priority: CI tag (release build) → `git describe` (dev,
// shows commits-ahead of the last tag) → tauri.conf.json version (no-git build).
function appVersion(): string {
  const ciTag = process.env.GITHUB_REF_NAME;
  if (ciTag && /^v?\d/.test(ciTag)) return ciTag.replace(/^v/, "");
  try {
    const d = execSync("git describe --tags --always --dirty", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim()
      .replace(/^v/, "");
    if (d) return d;
  } catch {
    // no git / no tags — fall through
  }
  return tauriConf.version;
}

// Self-contained Tauri webview SPA. No monorepo coupling — "@" maps to ./src.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  server: { port: 1420, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true, target: "es2022" },
});
