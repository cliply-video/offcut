// OSD primitives: corner brackets, status dot/label, the blinking REC dot, and
// the scanline field texture.

type Tone = "accent" | "gold" | "white" | "win" | "loss";

export function Corners({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`corners ${className ?? ""}`}>
      <i className="c-tl" />
      <i className="c-tr" />
      <i className="c-bl" />
      <i className="c-br" />
    </span>
  );
}

export function StatusDot({
  tone = "accent",
  blink,
}: {
  tone?: Tone;
  blink?: boolean;
}) {
  return <span className={`dot tone-${tone} ${blink ? "rec" : ""}`} />;
}

export function StatusPill({
  tone = "accent",
  blink,
  children,
}: {
  tone?: Tone;
  blink?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className={`status-pill tone-${tone}`}>
      <StatusDot tone={tone} blink={blink} />
      {children}
    </span>
  );
}

// Opaque panels mask the scanlines, so they only show on the bare field.
export function FieldTexture() {
  return <div aria-hidden="true" className="field-lines" />;
}
