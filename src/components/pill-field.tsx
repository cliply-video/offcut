import { useId, useRef } from "react";

// One spec-sheet row: label left, every option in sight on the right. A select
// hides the choices two clicks deep; an encoder menu shows them.
export function PillField<T extends string | number>({
  label,
  hint,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  value: T;
  options: { value: T; label: string }[];
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  const id = useId();
  const group = useRef<HTMLDivElement>(null);

  // Radio-group keyboard model: arrows move the selection, Tab leaves the row.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0 || options.length < 2) return;
    e.preventDefault();
    const from = Math.max(
      0,
      options.findIndex((o) => o.value === value),
    );
    const to = (from + step + options.length) % options.length;
    onChange(options[to].value);
    group.current?.querySelectorAll("button")[to]?.focus();
  };

  return (
    <div className="spec-row">
      <span className="spec-label" id={id}>
        {label}
      </span>
      <div className="spec-control">
        <div
          ref={group}
          className="seg pills"
          role="radiogroup"
          aria-labelledby={id}
          onKeyDown={onKeyDown}
        >
          {options.map((o) => {
            const on = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={on ? 0 : -1}
                className={on ? "on" : ""}
                disabled={disabled}
                onClick={() => onChange(o.value)}
              >
                {o.label}
              </button>
            );
          })}
        </div>
        {hint && <span className="field-hint">{hint}</span>}
      </div>
    </div>
  );
}
