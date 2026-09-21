import type { ReactNode } from "react";
import { useT } from "../i18n";
import { GITHUB_URL, openExternal } from "../lib/links";
import { CliplySign, Logo } from "./logo";
import { FieldTexture, StatusPill } from "./osd";
import { Stepper } from "./stepper";
import { type ToolName, ToolRail } from "./tool-rail";

const VERSION = __APP_VERSION__;

function GitHubIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

export function Shell({
  children,
  tool,
  busy,
  onTool,
  step,
  reached,
  onNavigate,
}: {
  children: ReactNode;
  // Undefined until the runtime tools are set up: no rail on the setup screen.
  tool?: ToolName;
  busy: Partial<Record<ToolName, boolean>>;
  onTool: (tool: ToolName) => void;
  step?: 1 | 2 | 3;
  reached?: 1 | 2 | 3;
  onNavigate?: (n: 1 | 2 | 3) => void;
}) {
  const { t, locale, setLocale } = useT();
  return (
    <div className="shell">
      <FieldTexture />

      {/* Native overlay titlebar — drags the window; sits over the traffic lights. */}
      <header className="titlebar" data-tauri-drag-region>
        <span aria-hidden="true" className="smpte" />
        <Logo />
        <nav className="titlebar-nav">
          <div className="langtoggle">
            <button
              type="button"
              className={locale === "en" ? "on" : ""}
              onClick={() => setLocale("en")}
            >
              EN
            </button>
            <button
              type="button"
              className={locale === "es" ? "on" : ""}
              onClick={() => setLocale("es")}
            >
              ES
            </button>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={() => openExternal(GITHUB_URL)}
          >
            <GitHubIcon /> {t("nav.github")}
          </button>
        </nav>
      </header>

      {tool && <ToolRail current={tool} busy={busy} onSelect={onTool} />}

      {step && (
        <Stepper
          current={step}
          reached={reached ?? step}
          onNavigate={onNavigate}
        />
      )}

      <main className="shell-main">{children}</main>

      {/* Quiet OSD status strip — app state + provenance. */}
      <footer className="statusbar">
        <div className="sb-group">
          <StatusPill tone="win">{t("status.local")}</StatusPill>
          <span>{t("footer.tagline")}</span>
        </div>
        <div className="sb-group">
          <span>v{VERSION}</span>
          <CliplySign />
        </div>
      </footer>
    </div>
  );
}
