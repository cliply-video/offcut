import { open, save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useState } from "react";
import { FolderIcon } from "../components/icons";
import { useT } from "../i18n";
import { copyFile, fetchXmlUrl, readXmlFile } from "../lib/api";
import { friendlyError } from "../lib/errors";
import { getVideo, saveParsed } from "../lib/db";
import { parseSportXml } from "../lib/xml";

export function ImportXml({
  videoId,
  onDone,
  onBack,
  onHome,
}: {
  videoId: string;
  onDone: () => void;
  onBack: () => void;
  onHome: () => void;
}) {
  const { t } = useT();
  const [src, setSrc] = useState("");
  // Local picks store an empty url; downloaded videos carry their source url.
  const [isLocal, setIsLocal] = useState(false);
  const [xmlUrl, setXmlUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedTo, setSavedTo] = useState<string | null>(null);

  useEffect(() => {
    getVideo(videoId).then((v) => {
      if (v) {
        setSrc(v.local_path);
        setIsLocal(!v.url);
      }
    });
  }, [videoId]);

  // Parse + persist an XML payload from either source (file or URL).
  const ingest = useCallback(
    async (text: string) => {
      const parsed = parseSportXml(text);
      if (parsed.clips.length === 0) {
        throw new Error(t("import.noClips"));
      }
      await saveParsed(videoId, parsed);
      onDone();
    },
    [videoId, onDone, t],
  );

  const pickXml = useCallback(async () => {
    setError(null);
    const path = await open({
      multiple: false,
      filters: [{ name: "Analysis XML", extensions: ["xml"] }],
    });
    if (!path || typeof path !== "string") return;
    setBusy(true);
    try {
      await ingest(await readXmlFile(path));
    } catch (e) {
      setError(friendlyError(e, t));
      setBusy(false);
    }
  }, [ingest, t]);

  const loadUrl = useCallback(async () => {
    const url = xmlUrl.trim();
    if (!url) return;
    setError(null);
    setBusy(true);
    try {
      await ingest(await fetchXmlUrl(url));
    } catch (e) {
      setError(friendlyError(e, t));
      setBusy(false);
    }
  }, [xmlUrl, ingest, t]);

  const saveVideo = useCallback(async () => {
    if (!src) return;
    setError(null);
    const dest = await save({
      defaultPath: "video.mp4",
      filters: [{ name: "Video", extensions: ["mp4"] }],
    });
    if (!dest) return;
    setBusy(true);
    try {
      await copyFile(src, dest);
      setSavedTo(dest);
    } catch (e) {
      setError(friendlyError(e, t));
    } finally {
      setBusy(false);
    }
  }, [src]);

  if (savedTo) {
    return (
      <div className="stage stage-top">
        <div className="hero hero-step">
          <div style={{ display: "grid", gap: 10 }}>
            <p className="eyebrow">{t("import.savedEyebrow")}</p>
            <h1 className="display">{t("import.savedTitle")}</h1>
          </div>
          <p className="lead" style={{ wordBreak: "break-all" }}>
            {savedTo}
          </p>
          <div className="row">
            <button
              type="button"
              className="primary btn-lg"
              onClick={() => revealItemInDir(savedTo)}
            >
              {t("import.reveal")}
            </button>
            <button type="button" className="btn-lg" onClick={onHome}>
              {t("import.another")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="stage stage-top">
      <div className="hero hero-step">
        <div style={{ display: "grid", gap: 10 }}>
          <p className="eyebrow">{t("import.eyebrow")}</p>
          <h1 className="display">{t("import.title")}</h1>
        </div>

        <p className="lead">{t(isLocal ? "import.bodyLocal" : "import.body")}</p>

        <div style={{ display: "grid", gap: 12 }}>
          <input
            className="input-xl"
            type="url"
            placeholder={t("import.urlPlaceholder")}
            value={xmlUrl}
            onChange={(e) => setXmlUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") loadUrl();
            }}
            disabled={busy}
          />
          {error && (
            <p style={{ color: "var(--destructive)", margin: 0 }}>{error}</p>
          )}
          <div className="row">
            <button
              type="button"
              className="primary btn-lg"
              onClick={loadUrl}
              disabled={busy || !xmlUrl.trim()}
            >
              {busy ? t("import.working") : t("import.loadUrl")}
            </button>
            <button
              type="button"
              className="btn-lg"
              onClick={pickXml}
              disabled={busy}
            >
              <FolderIcon size={14} />
              {t("import.choose")}
            </button>
            {!isLocal && (
              <button
                type="button"
                className="btn-lg"
                onClick={saveVideo}
                disabled={busy || !src}
              >
                {t("import.noxml")}
              </button>
            )}
          </div>
        </div>

        <button
          type="button"
          className="ghost"
          onClick={onBack}
          disabled={busy}
          style={{ justifySelf: "start" }}
        >
          {t("video.back")}
        </button>
      </div>
    </div>
  );
}
