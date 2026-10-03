import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import type { SourceStatus } from "@/lib/types";

export function SourceBadge({
  status,
  fetchedAt,
  itemCount,
}: {
  status: SourceStatus["status"];
  fetchedAt: string;
  itemCount: number;
}) {
  const live = status === "live";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] font-semibold ${
        live
          ? "border-signal-green/40 bg-signal-green/10 text-signal-green"
          : "border-signal-amber/40 bg-signal-amber/10 text-signal-amber"
      }`}
      title={`Catalog source status: ${status}, fetched ${fetchedAt}`}
    >
      {live ? (
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
      )}
      {live ? "Live" : "Offline sample"}
      <span className="font-normal opacity-70">· {itemCount.toLocaleString("en-US")}</span>
    </span>
  );
}

export function ErrorNotice({
  title,
  detail,
  onRetry,
}: {
  title: string;
  detail?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded border border-signal-rose/40 bg-signal-rose/10 p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3">
        <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-signal-rose" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold text-ivory-100">{title}</p>
          {detail ? <p className="mt-1 text-[13px] text-ivory-200">{detail}</p> : null}
        </div>
      </div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded border border-signal-rose/50 px-3 py-1.5 text-[13px] font-semibold text-signal-rose transition hover:bg-signal-rose/20"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="panel flex flex-col items-center gap-3 px-6 py-14 text-center">
      <div className="flex gap-1.5" aria-hidden="true">
        <span className="jack h-4 w-4" />
        <span className="jack h-4 w-4" />
        <span className="jack h-4 w-4" />
      </div>
      <h3 className="text-base font-semibold text-ivory-100">{title}</h3>
      <p className="max-w-sm text-[13px] leading-relaxed text-ivory-400">{detail}</p>
      {action}
    </div>
  );
}