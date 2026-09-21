import { useT } from "../i18n";
import {
  ConvertIcon,
  DownloadIcon,
  HomeIcon,
  JoinIcon,
  ScissorsIcon,
} from "./icons";
import { StatusDot } from "./osd";

export type ToolName = "home" | "download" | "clips" | "join" | "convert";

export const TOOLS = [
  { key: "download", Icon: DownloadIcon },
  { key: "clips", Icon: ScissorsIcon },
  { key: "join", Icon: JoinIcon },
  { key: "convert", Icon: ConvertIcon },
] as const;

const TABS = [{ key: "home", Icon: HomeIcon }, ...TOOLS] as const;

// The tools are independent, not a sequence, so this is a tab rail rather than
// a stepper. A blinking dot marks a tool with a job still running, since every
// tool keeps working while you're on another one.
export function ToolRail({
  current,
  busy,
  onSelect,
}: {
  current: ToolName;
  busy: Partial<Record<ToolName, boolean>>;
  onSelect: (tool: ToolName) => void;
}) {
  const { t } = useT();
  return (
    <nav className="toolrail" aria-label={t("tools.aria")}>
      {TABS.map(({ key, Icon }) => (
        <button
          key={key}
          type="button"
          className={`toolrail-tab ${key === current ? "on" : ""}`}
          aria-current={key === current ? "page" : undefined}
          onClick={() => onSelect(key)}
        >
          <Icon size={13} />
          {t(`tools.${key}`)}
          {busy[key] && <StatusDot tone="gold" blink />}
        </button>
      ))}
    </nav>
  );
}
