import { useEffect } from "react";
import mascotSignal from "../assets/mascot-signal.svg";
import { useT } from "../i18n";
import { playSfx } from "../lib/sfx";
import { CliplyMark, ExporterMark } from "./logo";

const VERSION = __APP_VERSION__;

// Boot splash — the Signal mascot peeks in from the lower-left while the Exporter
// lockup boots in the center. Plays the clip chime on mount.
export function Splash({ onDone }: { onDone: () => void }) {
  const { t } = useT();

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduced) playSfx(0.4);
    const id = window.setTimeout(onDone, reduced ? 1300 : 2000);
    return () => window.clearTimeout(id);
  }, [onDone]);

  return (
    <div className="splash" role="status" aria-live="polite">
      <div className="splash-drag" data-tauri-drag-region />
      <span aria-hidden="true" className="smpte" />
      <span aria-hidden="true" className="field-lines splash-lines" />

      <img
        src={mascotSignal}
        className="splash-mascot"
        alt=""
        aria-hidden="true"
      />

      <div className="splash-stage">
        <div className="splash-lockup">
          <ExporterMark className="splash-mark" />
          <span className="splash-word">Exporter</span>
        </div>
        <span className="splash-by">
          {t("footer.productOf")} <CliplyMark className="by-mark" />
          <span className="by-word">cliply</span>
        </span>

        <span aria-hidden="true" className="splash-bar">
          <i className="bx-boot-bar" />
        </span>
      </div>

      <p className="splash-version">v{VERSION}</p>
    </div>
  );
}
