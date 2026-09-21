import { useT } from "../i18n";
import type { ToolProgress } from "../lib/api";
import { CloseIcon } from "./icons";

export function JobProgress({
  verb,
  progress,
  cancelling,
  onCancel,
}: {
  verb: string;
  progress: ToolProgress | null;
  cancelling: boolean;
  onCancel: () => void;
}) {
  const { t } = useT();
  const pct = Math.round(progress?.percent ?? 0);
  return (
    <div className="job">
      <div className="job-line">
        <span className="job-label">
          {progress
            ? t("job.progress", {
                verb,
                n: progress.index + 1,
                total: progress.total,
              })
            : t("job.starting")}
          {progress?.label && (
            <span className="job-file"> · {progress.label}</span>
          )}
        </span>
        <span className="job-pct">{pct}%</span>
      </div>
      <div className="bar">
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="row">
        <button
          type="button"
          className="btn-lg"
          onClick={onCancel}
          disabled={cancelling}
        >
          <CloseIcon size={12} />
          {cancelling ? t("export.cancelling") : t("export.cancel")}
        </button>
      </div>
    </div>
  );
}
