import type { ReactNode } from "react";
import { cx } from "./cx";
import { plainOutcome } from "../../ui/plain";

/**
 * The five case results a person sees, each with ONE colour used everywhere:
 *   sent = green, asked = blue, needs_person = amber, stopped = red, didnt_finish = grey.
 * Plus two quiet extras: nothing (grey, "Nothing to do") and working (blue, pulsing).
 */
export type StatusKind = "sent" | "asked" | "needs_person" | "stopped" | "didnt_finish" | "nothing" | "working";

/** Text colour class per status (for numbers, icons). */
export const STATUS_TEXT: Record<StatusKind, string> = {
  sent: "text-rv-green",
  asked: "text-rv-blue",
  needs_person: "text-rv-amber",
  stopped: "text-rv-red",
  didnt_finish: "text-rv-grey",
  nothing: "text-rv-grey",
  working: "text-rv-blue",
};

/** Solid fill class per status (dots, bars). */
export const STATUS_FILL: Record<StatusKind, string> = {
  sent: "bg-rv-green",
  asked: "bg-rv-blue",
  needs_person: "bg-rv-amber",
  stopped: "bg-rv-red",
  didnt_finish: "bg-rv-grey",
  nothing: "bg-rv-grey",
  working: "bg-rv-blue",
};

const PILL: Record<StatusKind, string> = {
  sent: "bg-rv-green/12 text-rv-green ring-rv-green/25",
  asked: "bg-rv-blue/12 text-rv-blue ring-rv-blue/25",
  needs_person: "bg-rv-amber/12 text-rv-amber ring-rv-amber/25",
  stopped: "bg-rv-red/12 text-rv-red ring-rv-red/25",
  didnt_finish: "bg-white/[0.05] text-white/60 ring-white/10",
  nothing: "bg-white/[0.05] text-white/60 ring-white/10",
  working: "bg-rv-blue/12 text-rv-blue ring-rv-blue/25",
};

export const STATUS_LABEL: Record<StatusKind, string> = {
  sent: "Sent",
  asked: "Asked a question",
  needs_person: "Needs a person",
  stopped: "Stopped",
  didnt_finish: "Didn't finish",
  nothing: "Nothing to do",
  working: "Working on it",
};

/**
 * Map any raw value to a StatusKind. Accepts agent outcomes (acted, asked_for_info, escalated,
 * blocked, no_action, error), run statuses (running, success, error), gate verdicts
 * (allow, ask, block) and the StatusKind names themselves. Unknown/null -> "didnt_finish".
 */
export function statusKind(raw: string | null | undefined): StatusKind {
  switch (raw) {
    case "sent":
    case "acted":
    case "success":
    case "allow":
      return "sent";
    case "asked":
    case "asked_for_info":
      return "asked";
    case "needs_person":
    case "escalated":
    case "ask":
    case "human_decision":
      return "needs_person";
    case "stopped":
    case "blocked":
    case "block":
      return "stopped";
    case "nothing":
    case "no_action":
      return "nothing";
    case "working":
    case "running":
      return "working";
    default:
      return "didnt_finish";
  }
}

/** Plain label for a raw value: uses the shared glossary for known agent outcomes. */
export function statusLabel(raw: string | null | undefined): string {
  const kind = statusKind(raw);
  if (raw && ["acted", "escalated", "asked_for_info", "no_action", "blocked", "error"].includes(raw)) return plainOutcome(raw);
  return STATUS_LABEL[kind];
}

/**
 * Rounded status chip with a coloured dot: <StatusPill status="escalated" /> -> "Needs a person".
 * `status` takes any raw value (see statusKind). `label` overrides the words, `count` prefixes a
 * number ("3 Needs a person"), size "md" is bigger for headers and cards.
 */
export function StatusPill({
  status,
  label,
  count,
  size = "sm",
  className,
  title,
}: {
  status: string | null | undefined;
  label?: ReactNode;
  count?: number;
  size?: "sm" | "md";
  className?: string;
  title?: string;
}) {
  const kind = statusKind(status);
  return (
    <span
      title={title}
      className={cx(
        "inline-flex shrink-0 items-center rounded-full font-medium whitespace-nowrap ring-1 ring-inset",
        size === "md" ? "h-7 gap-2 px-3 text-rv-small" : "h-6 gap-1.5 px-2.5 text-rv-caption",
        PILL[kind],
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cx("shrink-0 rounded-full", size === "md" ? "h-2 w-2" : "h-1.5 w-1.5", STATUS_FILL[kind], kind === "working" && "rv-pulse")}
      />
      {typeof count === "number" && <span className="tabular font-semibold">{count}</span>}
      {label ?? statusLabel(status)}
    </span>
  );
}
