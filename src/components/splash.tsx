import { useEffect } from "react";
import mascotSignal from "../assets/mascot-signal.svg";
import { useT } from "../i18n";
import { playSfx } from "../lib/sfx";

const VERSION = __APP_VERSION__;

// Boot splash — the Signal mascot (crisp brand SVG, gentle idle bob) peeks in
// large from the lower-left edge of the window, with the RGB-glitch CLIPLY
// wordmark (burst-on-mount) + mono badge centered on the dark broadcast field.
// Plays the clip chime on mount.
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
      <span aria-hidden="true" className="bx-scanlines splash-lines" />
      <span aria-hidden="true" className="bx-grain splash-lines" />

      <img
        src={mascotSignal}
        className="splash-mascot"
        alt=""
        aria-hidden="true"
      />

      <div className="splash-stage">
        <div className="splash-lockup bx-glitch-auto">
          <span className="splash-word bx-glitch">
            <span aria-hidden="true" className="bx-glitch-layer bx-glitch-a">
              CLIPLY
            </span>
            <span aria-hidden="true" className="bx-glitch-layer bx-glitch-b">
              CLIPLY
            </span>
            <span className="bx-glitch-base">CLIPLY</span>
          </span>
          <span className="splash-badge">{t("splash.badge")}</span>
        </div>

        <span aria-hidden="true" className="splash-bar">
          <i className="bx-boot-bar" />
        </span>
      </div>

      <p className="splash-version">v{VERSION}</p>
    </div>
  );
}
