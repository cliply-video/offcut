import { useId } from "react";

// A typed decimal, comma or point: "4,5" is how half the users write it.
export function parseDecimal(raw: string): number | null {
  const text = raw.trim().replace(",", ".");
  const value = Number(text);
  return text !== "" && Number.isFinite(value) ? value : null;
}

// Spec-sheet row for a typed value, with steppers and its unit in the field.
export function NumberField({
  label,
  hint,
  unit,
  value,
  invalid,
  step,
  min,
  max,
  placeholder,
  stepUpLabel,
  stepDownLabel,
  onChange,
}: {
  label: string;
  hint: string;
  unit: string;
  value: string;
  invalid: boolean;
  step: number;
  min: number;
  max?: number;
  placeholder: string;
  stepUpLabel: string;
  stepDownLabel: string;
  onChange: (value: string) => void;
}) {
  const id = useId();

  const nudge = (direction: 1 | -1) => {
    const from = parseDecimal(value) ?? Number(placeholder);
    const next = Math.min(max ?? Infinity, Math.max(min, from + direction * step));
    // 0.1 + 0.5 three times is 1.6000000000000001.
    onChange(String(Math.round(next * 10) / 10));
  };

  return (
    <div className="spec-row">
      <label className="spec-label" htmlFor={id}>
        {label}
      </label>
      <div className="spec-control">
        <div className={`numfield ${invalid ? "bad" : ""}`}>
          <button type="button" aria-label={stepDownLabel} onClick={() => nudge(-1)}>
            −
          </button>
          <input
            id={id}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder={placeholder}
            value={value}
            aria-invalid={invalid}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp") nudge(1);
              else if (e.key === "ArrowDown") nudge(-1);
              else return;
              e.preventDefault();
            }}
          />
          <span className="numfield-unit">{unit}</span>
          <button type="button" aria-label={stepUpLabel} onClick={() => nudge(1)}>
            +
          </button>
        </div>
        <span className="field-hint">{hint}</span>
      </div>
    </div>
  );
}
