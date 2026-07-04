import { open, save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useState } from "react";
import { Corners } from "../components/osd";
import { useT } from "../i18n";
import { copyFile, readXmlFile } from "../lib/api";
import { friendlyError } from "../lib/errors";
import { getVideo, saveParsed } from "../lib/db";
import { parseSportXml } from "../lib/xml";

export function ImportXml({
  videoId,
  onDone,
  onHome,
}: {
  videoId: string;
  onDone: () => void;
  onHome: () => void;
}) {
  const { t } = useT();
  const [src, setSrc] = useState("");
  // Local picks store an empty url; downloaded videos carry their source url.
  const [isLocal, setIsLocal] = useState(false);
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

  const pickXml = useCallback(async () => {
    setError(null);
    const path = await open({
      multiple: false,
      filters: [{ name: "Analysis XML", extensions: ["xml"] }],
    });
    if (!path || typeof path !== "string") return;
    setBusy(true);
    try {
      const text = await readXmlFile(path);
      const parsed = parseSportXml(text);
      if (parsed.clips.length === 0) {
        throw new Error(t("import.noClips"));
      }
      await saveParsed(videoId, parsed);
      onDone();
    } catch (e) {
      setError(friendlyError(e, t));
      setBusy(false);
    }
  }, [videoId, onDone, t]);

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
      <div className="stage">
        <div className="card">
          <Corners />
          <p className="eyebrow">{t("import.savedEyebrow")}</p>
          <h2>{t("import.savedTitle")}</h2>
          <p className="muted" style={{ wordBreak: "break-all" }}>
            {savedTo}
          </p>
          <div className="row" style={{ marginTop: 16 }}>
            <button type="button" className="ghost" onClick={onHome}>
              {t("import.another")}
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => revealItemInDir(savedTo)}
            >
              {t("import.reveal")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="stage">
      <div className="card">
        <Corners />
        <p className="eyebrow">{t("import.eyebrow")}</p>
        <h2>{t("import.title")}</h2>
        <p className="muted">{t(isLocal ? "import.bodyLocal" : "import.body")}</p>
        {error && <p style={{ color: "var(--destructive)" }}>{error}</p>}
        <div className="row" style={{ marginTop: 8 }}>
          <button
            type="button"
            className="primary"
            onClick={pickXml}
            disabled={busy}
          >
            {busy ? t("import.working") : t("import.choose")}
          </button>
          {!isLocal && (
            <button type="button" onClick={saveVideo} disabled={busy || !src}>
              {t("import.noxml")}
            </button>
          )}
        </div>
        <button
          type="button"
          className="ghost"
          onClick={onHome}
          disabled={busy}
          style={{ marginTop: 16 }}
        >
          {t("import.newVideo")}
        </button>
      </div>
    </div>
  );
}
