import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import { StatusPill } from "../components/osd";
import { useT } from "../i18n";
import { type BinariesStatus, downloadBinaries } from "../lib/api";
import { friendlyError } from "../lib/errors";

// Rust Tool::key() strings (what "binary-download" events carry) paired to the
// BinariesStatus field each maps to. yt-dlp's key and field spelling differ.
const TOOLS = [
  { key: "ffmpeg", field: "ffmpeg" },
  { key: "ffprobe", field: "ffprobe" },
  { key: "yt-dlp", field: "ytdlp" },
  { key: "deno", field: "deno" },
] as const;

export function Setup({
  status,
  onReady,
}: {
  status: BinariesStatus | null;
  onReady: () => void;
}) {
  const { t } = useT();
  const [downloading, setDownloading] = useState(false);
  const [prog, setProg] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const un = listen<{ tool: string; percent: number }>(
      "binary-download",
      (e) => setProg((p) => ({ ...p, [e.payload.tool]: e.payload.percent })),
    );
    return () => {
      un.then((f) => f());
    };
  }, []);

  const download = useCallback(async () => {
    setError(null);
    // Seed each missing tool to 0 so its row shows progress from the first frame.
    const seed: Record<string, number> = {};
    for (const tool of TOOLS) {
      if (!status?.[tool.field]) seed[tool.key] = 0;
    }
    setProg(seed);
    setDownloading(true);
    try {
      await downloadBinaries();
      onReady();
    } catch (e) {
      setError(friendlyError(e, t));
    } finally {
      setDownloading(false);
    }
  }, [onReady, status]);

  const pill = (tool: (typeof TOOLS)[number]) => {
    if (status?.[tool.field]) {
      return <StatusPill tone="win">{t("setup.ready")}</StatusPill>;
    }
    const p = prog[tool.key];
    if (p !== undefined && p >= 100) {
      return <StatusPill tone="win">{t("setup.ready")}</StatusPill>;
    }
    if (downloading && p !== undefined) {
      return (
        <StatusPill tone="gold" blink>
          {Math.round(p)}%
        </StatusPill>
      );
    }
    return <StatusPill tone="loss">{t("setup.missing")}</StatusPill>;
  };

  // Summary bar spans the tools this run is fetching.
  const active = Object.keys(prog);
  const overall = active.length
    ? Math.round(active.reduce((s, k) => s + prog[k], 0) / active.length)
    : 0;

  return (
    <div className="stage stage-top">
      <div className="hero hero-step">
        <div style={{ display: "grid", gap: 10 }}>
          <p className="eyebrow">{t("setup.eyebrow")}</p>
          <h1 className="display">{t("setup.title")}</h1>
        </div>
        <p className="lead">{t("setup.body")}</p>
        <ul className="tool-list">
          {TOOLS.map((tool) => (
            <li key={tool.key}>
              <span>{tool.key}</span>
              {pill(tool)}
            </li>
          ))}
        </ul>
        {downloading && (
          <div className="bar">
            <span style={{ width: `${overall}%` }} />
          </div>
        )}
        {error && (
          <p style={{ color: "var(--destructive)", margin: 0 }}>{error}</p>
        )}
        <div className="row">
          <button
            type="button"
            className="primary btn-lg"
            onClick={download}
            disabled={downloading}
          >
            {downloading
              ? t("setup.downloading", { pct: overall })
              : t("setup.download")}
          </button>
          <button
            type="button"
            className="btn-lg"
            onClick={onReady}
            disabled={downloading}
          >
            {t("setup.recheck")}
          </button>
        </div>
      </div>
    </div>
  );
}
