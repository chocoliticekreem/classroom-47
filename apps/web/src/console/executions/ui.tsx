"use client";
// Small local UI pieces for the Executions and Evidence tabs (kept local so these tabs don't
// depend on the shared kit being ready). Colours follow the console brief.
import type { ReactNode } from "react";

export const C = {
  canvas: "#1f1f23",
  card: "#2a2a30",
  cardHi: "#33333a",
  line: "#3a3a42",
  accent: "#ff6a1a",
  ok: "#3ecf8e",
  warn: "#f5b83d",
  err: "#ff5c5c",
  info: "#6aa7ff",
  muted: "#8b8b96",
};

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(" ");
}

export function StatusDot({ status, size = 8 }: { status: "running" | "success" | "error" | string; size?: number }) {
  const color = status === "success" ? C.ok : status === "error" ? C.err : status === "running" ? C.accent : C.muted;
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }} title={status}>
      {status === "running" && (
        <span className="absolute inset-0 animate-ping rounded-full opacity-60" style={{ background: color }} />
      )}
      <span className="relative inline-block rounded-full" style={{ width: size, height: size, background: color }} />
    </span>
  );
}

export function Badge({ children, tone = "muted", title }: { children: ReactNode; tone?: "muted" | "ok" | "err" | "warn" | "accent" | "info"; title?: string }) {
  const color = { muted: C.muted, ok: C.ok, err: C.err, warn: C.warn, accent: C.accent, info: C.info }[tone];
  return (
    <span
      title={title}
      className="inline-flex items-center whitespace-nowrap rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide"
      style={{ color, background: `${color}1f`, boxShadow: `inset 0 0 0 1px ${color}40` }}
    >
      {children}
    </span>
  );
}

export function SimulatedBadge() {
  return (
    <Badge tone="warn" title="Simulated run (city/mock). Not a real agent output.">
      Simulated
    </Badge>
  );
}

export function GateBadge({ gate }: { gate: string | null }) {
  if (!gate) return <span className="text-white/30">–</span>;
  const tone = gate === "allow" ? "ok" : gate === "block" ? "err" : gate === "ask" ? "warn" : "muted";
  return <Badge tone={tone}>{gate}</Badge>;
}

export function PassBadge({ pass }: { pass: boolean | null }) {
  if (pass === null) return <span className="text-white/30">–</span>;
  return <Badge tone={pass ? "ok" : "err"}>{pass ? "pass" : "fail"}</Badge>;
}

export function Button({
  children, onClick, disabled, variant = "ghost", title, className,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost";
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary"
          ? "bg-[#ff6a1a] text-white hover:bg-[#ff7d38]"
          : "bg-white/5 text-white/80 ring-1 ring-inset ring-white/10 hover:bg-white/10",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Select<T extends string>({
  value, onChange, options, label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label: string;
}) {
  return (
    <label className="inline-flex min-w-0 items-center gap-1 text-[11px] text-white/50">
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="min-w-0 rounded-md bg-white/5 px-2 py-1 text-xs text-white/80 outline-none ring-1 ring-inset ring-white/10 focus:ring-[#ff6a1a]/60"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-[#2a2a30]">
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function SearchInput({ value, onChange, placeholder, className }: { value: string; onChange: (v: string) => void; placeholder: string; className?: string }) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      className={cx("min-w-0 rounded-md bg-white/5 px-2.5 py-1 text-xs text-white/90 outline-none ring-1 ring-inset ring-white/10 placeholder:text-white/30 focus:ring-[#ff6a1a]/60", className)}
    />
  );
}

/** Wraps a fetch so non-2xx and non-JSON responses come back as readable errors. */
export async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const msg = body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : `${res.status} ${res.statusText}`;
    throw new Error(`${url}: ${msg}`);
  }
  if (body === null) throw new Error(`${url}: empty or non-JSON response`);
  return body as T;
}
