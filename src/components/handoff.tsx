import { cliplyUrl, openExternal } from "../lib/links";

// `touchpoint` becomes utm_content so cliply can attribute each entry point.
export function Handoff({
  text,
  cta,
  touchpoint,
}: {
  text: string;
  cta: string;
  touchpoint: string;
}) {
  return (
    <div className="handoff">
      <p className="handoff-text">{text}</p>
      <button
        type="button"
        className="link-inline"
        onClick={() => openExternal(cliplyUrl(touchpoint))}
      >
        {cta} ↗
      </button>
    </div>
  );
}
