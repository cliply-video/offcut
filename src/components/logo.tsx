import { useT } from "../i18n";
import { cliplyUrl, openExternal } from "../lib/links";

// Exporter mark: in/out cut brackets with an export arrow leaving the frame.
export function ExporterMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
    >
      <g stroke="currentColor" strokeWidth="10" strokeLinecap="square">
        <path d="M14 42V14h28" />
        <path d="M86 58v28H58" />
        <path d="M36 64 70 30M46 28h26v26" />
      </g>
    </svg>
  );
}

// cliply's C-ring + play mark, with the signal arcs cliply fires on hover.
export function CliplyMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
    >
      <g stroke="currentColor" strokeWidth="5" strokeLinecap="round">
        <path className="bx-signal-wave bx-signal-1" d="M41 16 Q50 8 59 16" />
        <path className="bx-signal-wave bx-signal-2" d="M36 13 Q50 1 64 13" />
        <path className="bx-signal-wave bx-signal-3" d="M31 10 Q50 -6 69 10" />
      </g>
      <path
        d="M73.3 26.7 A33 33 0 1 0 73.3 73.3"
        stroke="currentColor"
        strokeWidth="10"
        strokeLinecap="round"
      />
      <path d="M44 33 L71 50 L44 67 Z" fill="currentColor" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="logo" role="img" aria-label="Cliply Exporter">
      <ExporterMark className="logo-mark" />
      <span className="logo-word">Exporter</span>
      <span className="logo-by">
        by <CliplyMark className="by-mark" />
        <span className="by-word">cliply</span>
      </span>
    </span>
  );
}

// "A product of cliply" sign-off — the same lockup sinte.ar carries.
export function CliplySign() {
  const { t } = useT();
  return (
    <button
      type="button"
      className="cliply-sign bx-glitch-trigger"
      onClick={() => openExternal(cliplyUrl("statusbar"))}
    >
      <span className="sign-lab">{t("footer.productOf")}</span>
      <CliplyMark className="sign-mark" />
      <span className="sign-word bx-glitch">
        <span aria-hidden="true" className="bx-glitch-layer bx-glitch-a">
          cliply
        </span>
        <span aria-hidden="true" className="bx-glitch-layer bx-glitch-b">
          cliply
        </span>
        <span className="bx-glitch-base">cliply</span>
      </span>
    </button>
  );
}
