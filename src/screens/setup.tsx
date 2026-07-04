import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import { Corners, StatusPill } from "../components/osd";
import { useT } from "../i18n";
import { type BinariesStatus, downloadBinaries } from "../lib/api";

export function Setup({
  status,
  onReady,
}: {
  status: BinariesStatus | null;
  onReady: () => void;
}) {
  const { t } = useT();
  const [downloading, setDownloading] = useState(false);
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const un = listen<{ percent: number }>("binary-download", (e) =>
      setPercent(e.payload.percent),
    );
    return () => {
      un.then((f) => f());
    };
  }, []);

  const download = useCallback(async () => {
    setError(null);
    setDownloading(true);
    setPercent(0);
    try {
      await downloadBinaries();
      onReady();
    } catch (e) {
      setError(String(e));
    } finally {
      setDownloading(false);
    }
  }, [onReady]);

  const flag = (ok: boolean | undefined) => (
    <StatusPill tone={ok ? "win" : "loss"}>
      {ok ? t("setup.ready") : t("setup.missing")}
    </StatusPill>
  );

  return (
    <div className="stage">
      <div className="card">
        <Corners />
        <p className="eyebrow">{t("setup.eyebrow")}</p>
        <h2>{t("setup.title")}</h2>
        <p className="muted">{t("setup.body")}</p>
        <ul className="muted">
          <li>
            <span>ffmpeg</span>
            {flag(status?.ffmpeg)}
          </li>
          <li>
            <span>ffprobe</span>
            {flag(status?.ffprobe)}
          </li>
          <li>
            <span>yt-dlp</span>
            {flag(status?.ytdlp)}
          </li>
          <li>
            <span>deno</span>
            {flag(status?.deno)}
          </li>
        </ul>
        {downloading && (
          <div className="bar" style={{ margin: "16px 0" }}>
            <span style={{ width: `${percent}%` }} />
          </div>
        )}
        {error && <p style={{ color: "var(--destructive)" }}>{error}</p>}
        <div className="row">
          <button
            type="button"
            className="primary"
            onClick={download}
            disabled={downloading}
          >
            {downloading
              ? t("setup.downloading", { pct: Math.round(percent) })
              : t("setup.download")}
          </button>
          <button type="button" onClick={onReady} disabled={downloading}>
            {t("setup.recheck")}
          </button>
        </div>
      </div>
    </div>
  );
}
