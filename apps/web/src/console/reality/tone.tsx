import { cx } from "../ui";
import { STATUS_TONE, type CaseStatus, type StatusTone } from "./logic";

/** Tile fill per tone. Literal class strings so Tailwind keeps them. */
export const TONE_CLASS: Record<StatusTone, string> = {
  green: "bg-rv-green/20 text-rv-green ring-1 ring-rv-green/40 ring-inset",
  blue: "bg-rv-blue/20 text-rv-blue ring-1 ring-rv-blue/40 ring-inset",
  amber: "bg-rv-amber/20 text-rv-amber ring-1 ring-rv-amber/40 ring-inset",
  violet: "bg-rv-violet/20 text-rv-violet ring-1 ring-rv-violet/40 ring-inset",
  red: "bg-rv-red/25 text-rv-red ring-1 ring-rv-red/50 ring-inset",
  neutral: "bg-white/[0.06] text-white/60 ring-1 ring-white/15 ring-inset",
};

const DOT: Record<StatusTone, string> = {
  green: "bg-rv-green",
  blue: "bg-rv-blue",
  amber: "bg-rv-amber",
  violet: "bg-rv-violet",
  red: "bg-rv-red",
  neutral: "bg-white/40",
};

export function TileStatusDot({ status }: { status: CaseStatus }) {
  return <span className={cx("inline-block h-2 w-2 rounded-sm", DOT[STATUS_TONE[status]])} />;
}
