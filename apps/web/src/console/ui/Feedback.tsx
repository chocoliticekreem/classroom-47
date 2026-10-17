import type { ReactNode } from "react";
import { cx } from "./cx";
import { IconAlert, IconInbox } from "./icons";
import { Button } from "./Button";

export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={cx("animate-spin", className)}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Shimmer placeholder block. Size it with className (e.g. "h-4 w-32"). */
export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={cx("rv-skeleton", className)} style={style} aria-hidden="true" />;
}

/** A few lines of placeholder text; the last line is shorter. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cx("flex flex-col gap-2", className)} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cx("h-3.5", i === lines - 1 && lines > 1 ? "w-3/5" : "w-full")} />
      ))}
    </div>
  );
}

/** Placeholder list rows (tables, lists) while data loads. Announces "Loading" once. */
export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cx("flex flex-col", className)} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-12 items-center gap-4 border-b border-white/[0.05] px-4">
          <Skeleton className="h-2.5 w-2.5 rounded-full" />
          <Skeleton className="h-3.5 flex-1" style={{ maxWidth: `${70 - ((i * 13) % 30)}%` }} />
          <Skeleton className="h-3.5 w-16" />
        </div>
      ))}
    </div>
  );
}

/** Placeholder card the size of a <BigNumber/> or small <SectionCard/>. */
export function SkeletonCard({ className, lines = 0 }: { className?: string; lines?: number }) {
  return (
    <div className={cx("flex flex-col gap-3 rounded-xl border border-rv-line bg-rv-card p-5", className)} role="status" aria-label="Loading">
      <Skeleton className="h-3.5 w-24" />
      <Skeleton className="h-8 w-16" />
      {lines > 0 && <SkeletonText lines={lines} />}
    </div>
  );
}

/**
 * Centered empty state. Pass `action` for any button, or the shortcut `actionLabel` + `onAction`
 * for the standard primary button. `description` (or `children`) is one short sentence.
 */
export function EmptyState({
  icon,
  title,
  description,
  children,
  action,
  actionLabel,
  onAction,
  compact,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
  className?: string;
}) {
  const copy = description ?? children;
  const act =
    action ??
    (actionLabel && onAction ? (
      <Button variant="primary" onClick={onAction}>
        {actionLabel}
      </Button>
    ) : null);
  return (
    <div
      className={cx(
        "flex flex-col items-center justify-center text-center",
        compact ? "gap-2 px-4 py-6" : "gap-3 px-6 py-14",
        className,
      )}
    >
      <div aria-hidden="true" className={cx("flex items-center justify-center rounded-xl bg-white/[0.04] text-white/45 ring-1 ring-white/[0.06]", compact ? "h-10 w-10" : "h-12 w-12")}>
        {icon ?? <IconInbox size={20} />}
      </div>
      <div className={cx("font-semibold text-white/90", compact ? "text-rv-body" : "text-rv-heading")}>{title}</div>
      {copy && <div className="max-w-sm text-rv-small text-white/55">{copy}</div>}
      {act && <div className={compact ? "mt-1" : "mt-2"}>{act}</div>}
    </div>
  );
}

/** The standard "nothing yet" message, used across tabs so the wording is identical. */
export function NoRunsYet({ action, compact }: { action?: ReactNode; compact?: boolean }) {
  return (
    <EmptyState title="No cases yet" action={action} compact={compact}>
      Press <span className="font-medium text-white/80">Run a case</span> to start.
    </EmptyState>
  );
}

/** Inline error box with optional retry. */
export function ErrorState({
  title = "Couldn't load this",
  error,
  onRetry,
  compact,
}: {
  title?: string;
  error: string;
  onRetry?: () => void;
  compact?: boolean;
}) {
  return (
    <div
      role="alert"
      className={cx(
        "flex items-start gap-3 rounded-md border border-rv-red/25 bg-rv-red/[0.07] text-[13px]",
        compact ? "m-3 p-3" : "m-4 p-4",
      )}
    >
      <IconAlert size={16} className="mt-0.5 shrink-0 text-rv-red" />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-white/90">{title}</div>
        <div className="mt-0.5 break-words text-white/55">{error}</div>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded-md px-2 py-1 text-rv-small font-medium text-rv-orange hover:bg-rv-orange/10"
        >
          Try again
        </button>
      )}
    </div>
  );
}
