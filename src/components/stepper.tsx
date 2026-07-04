import { useT } from "../i18n";

const STEPS = [
  { key: "video", n: "01" },
  { key: "xml", n: "02" },
  { key: "clips", n: "03" },
] as const;

function Check() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.5 8.5l3 3 6-7"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// The connective tissue across the flow: one rail under the titlebar marking
// which of the three stages (video → xml → clips) you're on. Indicator only —
// navigation stays with the in-screen back buttons.
export function Stepper({ current }: { current: 1 | 2 | 3 }) {
  const { t } = useT();
  return (
    <nav className="stepper" aria-label={t("stepper.aria")}>
      {STEPS.map((s, i) => {
        const idx = (i + 1) as 1 | 2 | 3;
        const state = idx < current ? "done" : idx === current ? "active" : "todo";
        return (
          <div key={s.key} className={`stepper-item ${state}`}>
            <span className="stepper-badge">
              {state === "done" ? <Check /> : s.n}
            </span>
            <span className="stepper-label">{t(`stepper.${s.key}`)}</span>
            {i < STEPS.length - 1 && (
              <span className="stepper-line" aria-hidden="true" />
            )}
          </div>
        );
      })}
    </nav>
  );
}
