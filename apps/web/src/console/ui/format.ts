// Pure formatters for the console. Every number on screen goes through one of these so
// units and precision stay consistent across tabs. Null/undefined/NaN render as an em dash.

export const DASH = "—";

const ok = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);

/** $0.0042 / $0.042 / $1.24 / $1,204 */
export function formatUsd(n: number | null | undefined): string {
  if (!ok(n)) return DASH;
  if (n === 0) return "$0.00";
  const abs = Math.abs(n);
  const digits = abs < 0.01 ? 4 : abs < 1 ? 3 : abs < 1000 ? 2 : 0;
  return `${n < 0 ? "-" : ""}$${abs.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** 820 ms / 4.2 s / 3m 12s / 1h 04m */
export function formatDuration(ms: number | null | undefined): string {
  if (!ok(ms) || ms < 0) return DASH;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
  const totalS = Math.round(s);
  const m = Math.floor(totalS / 60);
  if (m < 60) return `${m}m ${String(totalS % 60).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, "0")}m`;
}

/** ratio 0..1 -> "87.5%" (one decimal unless whole). */
export function formatPct(ratio: number | null | undefined): string {
  if (!ok(ratio)) return DASH;
  const p = ratio * 100;
  return `${Number.isInteger(Math.round(p * 10) / 10) ? Math.round(p) : p.toFixed(1)}%`;
}

export function formatCount(n: number | null | undefined): string {
  return ok(n) ? Math.round(n).toLocaleString("en-US") : DASH;
}

/** "just now" / "42s ago" / "5m ago" / "3h ago" / "2d ago" / "12 Oct". `now` is injectable for tests. */
export function formatRelative(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return DASH;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return DASH;
  const diff = Math.max(0, now - t) / 1000;
  if (diff < 10) return "just now";
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Absolute timestamp for tooltips: "10 Oct 2026, 14:03:22". */
export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return DASH;
  return new Date(t).toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

/** snake_case outcome -> "Asked for info". */
export function humanize(s: string | null | undefined): string {
  if (!s) return DASH;
  const t = s.replace(/[_-]+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
