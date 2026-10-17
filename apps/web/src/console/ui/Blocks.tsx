import type { ReactNode } from "react";
import { cx } from "./cx";
import { Skeleton } from "./Feedback";
import { STATUS_FILL, STATUS_TEXT, statusKind } from "./Status";

/**
 * A big, simple number with a word under it: "12 / Sent". Pass `status` to colour the number by
 * case result (any raw value StatusPill accepts) or `tone` for a plain colour. `value` null shows
 * an em dash (never a made-up number). `onClick` turns the whole tile into a button.
 */
export function BigNumber({
  value,
  label,
  sub,
  status,
  tone = "default",
  size = "md",
  loading,
  onClick,
  title,
  className,
}: {
  value: ReactNode;
  label: ReactNode;
  sub?: ReactNode;
  status?: string;
  tone?: "default" | "orange" | "muted";
  size?: "md" | "lg";
  loading?: boolean;
  onClick?: () => void;
  title?: string;
  className?: string;
}) {
  const color = status
    ? STATUS_TEXT[statusKind(status)]
    : tone === "orange"
      ? "text-rv-orange"
      : tone === "muted"
        ? "text-white/60"
        : "text-white";
  const body = (
    <>
      <div className="flex items-center gap-2 text-rv-small text-white/60">
        {status && <span aria-hidden="true" className={cx("h-2 w-2 shrink-0 rounded-full", STATUS_FILL[statusKind(status)])} />}
        <span className="truncate">{label}</span>
      </div>
      {loading ? (
        <Skeleton className={size === "lg" ? "h-10 w-24" : "h-8 w-16"} />
      ) : (
        <div className={cx("tabular truncate font-semibold", size === "lg" ? "text-rv-hero" : "text-rv-big", color)}>
          {value ?? <span className="text-white/25">—</span>}
        </div>
      )}
      {(sub || loading) && (
        <div className="min-h-4 truncate text-rv-caption text-white/45">{loading ? <Skeleton className="h-3 w-24" /> : sub}</div>
      )}
    </>
  );
  const base = cx(
    "flex min-w-0 flex-col gap-2 rounded-xl border border-rv-line bg-rv-card text-left",
    size === "lg" ? "p-6" : "p-5",
    className,
  );
  if (onClick)
    return (
      <button type="button" onClick={onClick} title={title} className={cx(base, "transition-colors hover:border-white/15 hover:bg-rv-raised")}>
        {body}
      </button>
    );
  return (
    <div title={title} className={base}>
      {body}
    </div>
  );
}

/**
 * A calm card for one section of a page: a clear heading, an optional one-line description, an
 * optional action on the right and an optional footer. Roomier than <Panel>; use Panel for dense
 * tool panes and tables, SectionCard for page content.
 */
export function SectionCard({
  title,
  description,
  action,
  footer,
  children,
  flush,
  className,
  bodyClassName,
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  /** No body padding (tables, lists). */
  flush?: boolean;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      aria-label={typeof title === "string" ? title : undefined}
      className={cx("flex min-w-0 flex-col overflow-hidden rounded-xl border border-rv-line bg-rv-card", className)}
    >
      {(title || action) && (
        <header className="flex items-start gap-4 px-6 pt-5 pb-4">
          <div className="min-w-0 flex-1">
            {title && <h2 className="text-rv-title font-semibold text-white">{title}</h2>}
            {description && <p className="mt-0.5 text-rv-small text-white/55">{description}</p>}
          </div>
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </header>
      )}
      {children != null && (
        <div className={cx("min-h-0 min-w-0 flex-1", !flush && "px-6 pb-6", flush && !!(title || action) && "border-t border-rv-line", !title && !action && !flush && "pt-6", bodyClassName)}>
          {children}
        </div>
      )}
      {footer && <footer className="flex items-center gap-3 border-t border-rv-line px-6 py-3 text-rv-small text-white/55">{footer}</footer>}
    </section>
  );
}

/**
 * Progress bar. value/max (default max 1, so a 0..1 ratio works). `label` sits above on the left,
 * `showValue` prints "40%" (or "4 of 10" with `countMode`) on the right. `status` colours it by case
 * result, otherwise `tone`. value null/undefined = indeterminate (a sliding bar).
 */
export function ProgressBar({
  value,
  max = 1,
  label,
  showValue,
  countMode,
  status,
  tone = "orange",
  size = "md",
  className,
}: {
  value: number | null | undefined;
  max?: number;
  label?: ReactNode;
  showValue?: boolean;
  countMode?: boolean;
  status?: string;
  tone?: "orange" | "green" | "blue" | "amber" | "red" | "grey";
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const indeterminate = value === null || value === undefined || !Number.isFinite(value);
  const ratio = indeterminate || max <= 0 ? 0 : Math.max(0, Math.min(1, value / max));
  const fill = status
    ? STATUS_FILL[statusKind(status)]
    : { orange: "bg-rv-orange", green: "bg-rv-green", blue: "bg-rv-blue", amber: "bg-rv-amber", red: "bg-rv-red", grey: "bg-rv-grey" }[tone];
  const h = size === "sm" ? "h-1" : size === "lg" ? "h-2.5" : "h-1.5";
  const valueText = indeterminate ? "" : countMode ? `${value} of ${max}` : `${Math.round(ratio * 100)}%`;
  return (
    <div className={cx("flex min-w-0 flex-col gap-1.5", className)}>
      {(label || (showValue && valueText)) && (
        <div className="flex items-baseline justify-between gap-3 text-rv-small">
          <span className="truncate text-white/70">{label}</span>
          {showValue && valueText && <span className="tabular shrink-0 text-white/55">{valueText}</span>}
        </div>
      )}
      <div
        role="progressbar"
        aria-label={typeof label === "string" ? label : undefined}
        aria-valuemin={0}
        aria-valuemax={indeterminate ? undefined : max}
        aria-valuenow={indeterminate ? undefined : value}
        aria-valuetext={valueText || "Working"}
        className={cx("relative overflow-hidden rounded-full bg-white/[0.08]", h)}
      >
        {indeterminate ? (
          <div className={cx("rv-indeterminate absolute inset-y-0 w-2/5 rounded-full", fill)} />
        ) : (
          <div className={cx("h-full rounded-full transition-[width] duration-300", fill)} style={{ width: `${ratio * 100}%` }} />
        )}
      </div>
    </div>
  );
}

export interface KeyValueItem {
  label: ReactNode;
  value: ReactNode;
  /** Small grey line under the value. */
  hint?: ReactNode;
}

/**
 * Label/value pairs as a tidy list: <KeyValue items={[{ label: "Customer", value: "Ana" }]} />.
 * `columns` 1 (default: label left, value right-aligned rows) or 2/3 (stacked label over value in
 * a grid). Null/undefined/"" values show an em dash.
 */
export function KeyValue({
  items,
  columns = 1,
  className,
}: {
  items: KeyValueItem[];
  columns?: 1 | 2 | 3;
  className?: string;
}) {
  const empty = (v: ReactNode) => v === null || v === undefined || v === "";
  if (columns === 1)
    return (
      <dl className={cx("flex min-w-0 flex-col divide-y divide-white/[0.06]", className)}>
        {items.map((it, i) => (
          <div key={i} className="flex min-w-0 items-baseline justify-between gap-6 py-2.5 first:pt-0 last:pb-0">
            <dt className="shrink-0 text-rv-small text-white/55">{it.label}</dt>
            <dd className="min-w-0 text-right text-rv-body break-words text-white/90">
              {empty(it.value) ? <span className="text-white/25">—</span> : it.value}
              {it.hint && <div className="text-rv-caption text-white/45">{it.hint}</div>}
            </dd>
          </div>
        ))}
      </dl>
    );
  return (
    <dl className={cx("grid min-w-0 gap-x-6 gap-y-4", columns === 2 ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-3", className)}>
      {items.map((it, i) => (
        <div key={i} className="min-w-0">
          <dt className="truncate text-rv-caption text-white/50">{it.label}</dt>
          <dd className="mt-0.5 text-rv-body break-words text-white/90">
            {empty(it.value) ? <span className="text-white/25">—</span> : it.value}
            {it.hint && <div className="text-rv-caption text-white/45">{it.hint}</div>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
