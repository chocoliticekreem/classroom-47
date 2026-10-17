"use client";
// Small local UI pieces for the workflow editor.
import type { ReactNode } from "react";
import type { Runner } from "../types";
import { RUNNER_STYLE } from "./nodeTypes";

export function RunnerChip({ runner, active = true, onClick }: { runner: Runner; active?: boolean; onClick?: () => void }) {
  const s = RUNNER_STYLE[runner] ?? { label: runner, fg: "#cbd5e1", bg: "rgba(148,163,184,0.14)" };
  const cls = "inline-flex items-center rounded px-1.5 py-[1px] text-[10px] font-medium leading-4";
  const style = active
    ? { color: s.fg, background: s.bg, boxShadow: `inset 0 0 0 1px ${s.fg}33` }
    : { color: "rgba(255,255,255,0.35)", background: "transparent", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)" };
  return onClick ? (
    <button type="button" onClick={onClick} className={`${cls} cursor-pointer`} style={style} aria-pressed={active}>
      {s.label}
    </button>
  ) : (
    <span className={cls} style={style}>{s.label}</span>
  );
}

export function RunnerChips({ runners }: { runners: Runner[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {runners.length ? runners.map((r) => <RunnerChip key={r} runner={r} />) : <span className="text-[10px] text-white/30">no runner</span>}
    </div>
  );
}

export function Btn({
  children, onClick, disabled, title, variant = "ghost", className = "",
}: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; title?: string;
  variant?: "ghost" | "primary" | "outline"; className?: string;
}) {
  const v =
    variant === "primary" ? "bg-[#ff6a1a] text-white hover:bg-[#ff7d38] disabled:bg-[#ff6a1a]/40"
      : variant === "outline" ? "border border-white/15 text-white/85 hover:bg-white/[0.06]"
      : "text-white/70 hover:bg-white/[0.07] hover:text-white";
  return (
    <button
      type="button" onClick={onClick} disabled={disabled} title={title}
      className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${v} ${className}`}
    >
      {children}
    </button>
  );
}

export function Badge({ children, tone = "grey", title }: { children: ReactNode; tone?: "grey" | "green" | "red" | "amber" | "orange" | "violet"; title?: string }) {
  const t = {
    grey: "bg-white/[0.07] text-white/70",
    green: "bg-[#22c55e]/15 text-[#4ade80]",
    red: "bg-[#ef4444]/15 text-[#f87171]",
    amber: "bg-[#f59e0b]/15 text-[#fbbf24]",
    orange: "bg-[#ff6a1a]/15 text-[#ff8a4c]",
    violet: "bg-[#a78bfa]/15 text-[#c4b5fd]",
  }[tone];
  return <span title={title} className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${t}`}>{children}</span>;
}

export function JsonView({ value }: { value: unknown }) {
  return (
    <pre className="max-h-[50vh] overflow-auto rounded-md border border-white/10 bg-black/30 p-2.5 font-mono text-[11px] leading-relaxed text-white/80 whitespace-pre-wrap break-all">
      {value === undefined ? "undefined" : JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/40">{children}</div>;
}
