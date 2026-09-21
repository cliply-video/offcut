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

// The clip cutter is the one tool that is a sequence: this rail, under the tool
// tabs, marks which of its three stages (video → xml → clips) you're on. Stages
// already reached are clickable, so it doubles as back/forward navigation.
export function Stepper({
  current,
  reached,
  onNavigate,
}: {
  current: 1 | 2 | 3;
  reached: 1 | 2 | 3;
  onNavigate?: (n: 1 | 2 | 3) => void;
}) {
  const { t } = useT();
  return (
    <nav className="stepper" aria-label={t("stepper.aria")}>
      {STEPS.map((s, i) => {
        const idx = (i + 1) as 1 | 2 | 3;
        const state =
          idx < current ? "done" : idx === current ? "active" : "todo";
        const clickable = !!onNavigate && idx !== current && idx <= reached;
        return (
          <div
            key={s.key}
            className={`stepper-item ${state} ${clickable ? "clickable" : ""}`}
            onClick={clickable ? () => onNavigate?.(idx) : undefined}
            onKeyDown={
              clickable
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onNavigate?.(idx);
                    }
                  }
                : undefined
            }
            role={clickable ? "button" : undefined}
            tabIndex={clickable ? 0 : undefined}
            aria-current={idx === current ? "step" : undefined}
          >
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
