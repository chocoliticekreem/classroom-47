import type { ReactNode } from "react";
import { cx } from "./cx";
import { Skeleton } from "./Feedback";

/** Card container with optional header (title, subtitle, right-side actions). */
export function Panel({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
  flush,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** No body padding (tables, lists). */
  flush?: boolean;
}) {
  return (
    <section
      className={cx(
        "flex min-w-0 flex-col overflow-hidden rounded-lg border border-rv-line bg-rv-card",
        className,
      )}
    >
      {(title || actions) && <PanelHeader title={title} subtitle={subtitle} actions={actions} />}
      <div className={cx("min-h-0 min-w-0 flex-1", !flush && "p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function PanelHeader({
  title,
  subtitle,
  actions,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex min-h-12 items-center gap-3 border-b border-rv-line px-4 py-2.5">
      <div className="min-w-0 flex-1">
        {title && <h2 className="truncate text-rv-heading font-semibold text-white/90">{title}</h2>}
        {subtitle && <p className="truncate text-rv-caption text-white/50">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Headline metric tile. `value` null shows an em dash; `loading` shows a skeleton. */
export function KpiCard({
  label,
  value,
  sub,
  icon,
  tone = "default",
  loading,
  title,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  tone?: "default" | "good" | "bad" | "warn";
  loading?: boolean;
  title?: string;
}) {
  const valueTone =
    tone === "good" ? "text-rv-green" : tone === "bad" ? "text-rv-red" : tone === "warn" ? "text-rv-amber" : "text-white";
  return (
    <div
      title={title}
      className="flex min-w-0 flex-col gap-2 rounded-xl border border-rv-line bg-rv-card p-5"
    >
      <div className="flex items-center gap-2 text-rv-small text-white/60">
        {icon && <span className="text-white/35">{icon}</span>}
        <span className="truncate">{label}</span>
      </div>
      {loading ? (
        <Skeleton className="h-8 w-20" />
      ) : (
        <div className={cx("tabular truncate text-rv-big font-semibold", valueTone)}>
          {value ?? <span className="text-white/25">—</span>}
        </div>
      )}
      <div className="min-h-4 truncate text-rv-caption text-white/45">{loading ? <Skeleton className="h-3 w-28" /> : sub}</div>
    </div>
  );
}

/** Thin horizontal progress/ratio bar. ratio 0..1 (null renders empty track). */
export function Meter({
  ratio,
  tone = "green",
  className,
}: {
  ratio: number | null;
  tone?: "green" | "orange" | "red" | "amber";
  className?: string;
}) {
  const color =
    tone === "green" ? "bg-rv-green" : tone === "orange" ? "bg-rv-orange" : tone === "red" ? "bg-rv-red" : "bg-rv-amber";
  const pct = ratio === null ? 0 : Math.max(0, Math.min(1, ratio)) * 100;
  return (
    <div className={cx("h-1.5 overflow-hidden rounded-full bg-white/[0.07]", className)}>
      <div className={cx("h-full rounded-full", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}
