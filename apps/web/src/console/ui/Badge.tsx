import type { ReactNode } from "react";
import { cx } from "./cx";
import { plainDataset, plainGate, plainStatus } from "../../ui/plain";

export type Tone = "neutral" | "orange" | "green" | "red" | "amber" | "blue" | "violet";

const TONE: Record<Tone, string> = {
  neutral: "bg-white/[0.06] text-white/70 ring-white/10",
  orange: "bg-rv-orange/12 text-rv-orange ring-rv-orange/30",
  green: "bg-rv-green/12 text-rv-green ring-rv-green/30",
  red: "bg-rv-red/12 text-rv-red ring-rv-red/30",
  amber: "bg-rv-amber/12 text-rv-amber ring-rv-amber/30",
  blue: "bg-rv-blue/12 text-rv-blue ring-rv-blue/30",
  violet: "bg-rv-violet/12 text-rv-violet ring-rv-violet/30",
};

const DOT: Record<Tone, string> = {
  neutral: "bg-white/40",
  orange: "bg-rv-orange",
  green: "bg-rv-green",
  red: "bg-rv-red",
  amber: "bg-rv-amber",
  blue: "bg-rv-blue",
  violet: "bg-rv-violet",
};

export function Badge({
  tone = "neutral",
  dot,
  title,
  className,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex h-5 shrink-0 items-center gap-1.5 rounded px-1.5 text-[11px] leading-none font-medium whitespace-nowrap ring-1 ring-inset",
        TONE[tone],
        className,
      )}
    >
      {dot && <span className={cx("h-1.5 w-1.5 rounded-full", DOT[tone])} />}
      {children}
    </span>
  );
}

/** Small coloured dot (status lights). `pulse` for live/running. */
export function StatusDot({
  tone,
  pulse,
  size = 8,
  title,
}: {
  tone: Tone;
  pulse?: boolean;
  size?: number;
  title?: string;
}) {
  return (
    <span
      title={title}
      role={title ? "img" : undefined}
      aria-label={title}
      className={cx("inline-block shrink-0 rounded-full", DOT[tone], pulse && "rv-pulse")}
      style={{ width: size, height: size }}
    />
  );
}

/**
 * Mandatory label for anything with `simulated: true` (city-made cases). PRD J0: these must never
 * pass as real, so render this wherever such a record appears. Reads "Practice case".
 */
export function SimulatedBadge({ className }: { className?: string }) {
  return (
    <span
      title="Made from the city for practice. Not a live result."
      className={cx(
        "inline-flex h-5 shrink-0 items-center rounded border border-rv-amber/50 px-1.5 text-[11px] leading-none font-medium text-rv-amber",
        className,
      )}
    >
      Practice case
    </span>
  );
}

/** Marks real results from the live agent. Reads "Live". */
export function RealBadge({ className, title }: { className?: string; title?: string }) {
  return (
    <span
      title={title ?? "Real results from the live agent."}
      className={cx(
        "inline-flex h-5 shrink-0 items-center gap-1.5 rounded px-1.5 text-[11px] leading-none font-medium text-rv-green ring-1 ring-rv-green/40 ring-inset",
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-rv-green" />
      Live
    </span>
  );
}

/** Real or simulated, chosen from a record's `simulated` flag. */
export function ProvenanceBadge({ simulated, className }: { simulated: boolean; className?: string }) {
  return simulated ? <SimulatedBadge className={className} /> : <RealBadge className={className} />;
}

/** Eval verdict: pass / fail / not evaluated. */
export function PassBadge({ pass, score }: { pass: boolean | null | undefined; score?: number | null }) {
  if (pass === null || pass === undefined)
    return <Badge tone="neutral">Not checked</Badge>;
  const s = typeof score === "number" ? ` ${score <= 1 ? Math.round(score * 100) : Math.round(score)}` : "";
  return (
    <Badge tone={pass ? "green" : "red"} dot>
      {pass ? "Pass" : "Fail"}
      {s && <span className="tabular opacity-70">{s}</span>}
    </Badge>
  );
}

export type ExecStatus = "running" | "success" | "error";

export const STATUS_TONE: Record<ExecStatus, Tone> = { running: "blue", success: "green", error: "red" };

/** Case run status: Working on it / Finished / Didn't finish. */
export function ExecStatusBadge({ status }: { status: ExecStatus }) {
  const label = plainStatus(status);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-white/80">
      <StatusDot tone={STATUS_TONE[status]} pulse={status === "running"} />
      {label}
    </span>
  );
}

/** Safety check verdict: OK / Ask a person / Stop. */
export function GateBadge({ gate }: { gate: string | null | undefined }) {
  if (!gate) return <span className="text-white/30">—</span>;
  const tone: Tone = gate === "allow" ? "green" : gate === "ask" ? "amber" : gate === "block" ? "red" : "neutral";
  return <Badge tone={tone}>{plainGate(gate)}</Badge>;
}

/** Where a case came from, in plain words ("Sample cases"), with a stable colour. */
export function DatasetBadge({ dataset }: { dataset: string }) {
  const tone: Tone =
    dataset === "public"
      ? "blue"
      : dataset === "generated"
        ? "violet"
        : dataset === "fixtures"
          ? "orange"
          : dataset === "grounded"
            ? "green"
            : dataset === "reality"
              ? "amber"
              : "neutral";
  return <Badge tone={tone}>{dataset === "city" ? "From the city" : plainDataset(dataset)}</Badge>;
}

/** Inline keyboard/code chip, e.g. <Kbd>npm run answer</Kbd>. */
export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-white/[0.07] px-1.5 py-0.5 font-mono text-[0.92em] text-white/85 ring-1 ring-white/10 ring-inset">
      {children}
    </code>
  );
}
