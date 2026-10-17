"use client";
// "Show a run": header dropdown of this playbook's recent case runs. Picking one lights up the
// path it took on the canvas.
import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import type { ExecutionSummary } from "./api";
import { cents, plainOutcome } from "../../ui/plain";
import { Badge } from "./bits";

const dot = (s: ExecutionSummary["status"]) => (s === "success" ? "#22c55e" : s === "error" ? "#ef4444" : "#ff6a1a");

function ago(iso: string): string {
  const d = Date.now() - Date.parse(iso);
  if (!Number.isFinite(d)) return "";
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}

export function ExecutionPicker({ executions: all, error, selectedId, onSelect, onRefresh, workflowId }: {
  executions: ExecutionSummary[] | null;
  /** Only runs of this playbook are listed (all runs when null). */
  workflowId?: string | null;
  error: string | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const executions = all && workflowId ? all.filter((e) => e.workflowId === workflowId).slice(0, 30) : all?.slice(0, 30) ?? null;
  const ref = useRef<HTMLDivElement>(null);
  const sel = all?.find((e) => e.id === selectedId) ?? null;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button" onClick={() => { setOpen((o) => !o); if (!open) onRefresh(); }}
        aria-haspopup="listbox" aria-expanded={open}
        className={`inline-flex h-8 max-w-[260px] items-center gap-2 rounded-md border px-2.5 text-[12px] text-white/85 hover:bg-white/[0.06] ${sel ? "border-rv-green/40" : "border-white/15"}`}
      >
        {sel ? (
          <>
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot(sel.status) }} />
            <span className="truncate">{sel.caseId}</span>
            {sel.simulated && <Badge tone="amber">Practice case</Badge>}
          </>
        ) : (
          <>
            <Icon name="play" size={11} className="shrink-0 text-white/45" />
            <span className="text-white/70">Show a run</span>
          </>
        )}
        <Icon name="chevron" size={12} className="shrink-0 rotate-90 text-white/45" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1.5 w-[380px] overflow-hidden rounded-lg border border-white/10 bg-[#222227] shadow-2xl">
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-[11px] text-white/45">
            <span>Recent runs of this playbook</span>
            {selectedId && (
              <button type="button" className="text-white/60 hover:text-white" onClick={() => { onSelect(null); setOpen(false); }}>
                Hide
              </button>
            )}
          </div>
          <div className="max-h-[360px] overflow-y-auto py-1">
            {error && <div className="px-3 py-3 text-[12px] text-[#f87171]">{error}</div>}
            {!error && executions === null && <div className="px-3 py-3 text-[12px] text-white/40">Loading…</div>}
            {!error && executions?.length === 0 && <div className="px-3 py-3 text-[12px] text-white/40">This playbook has no case runs yet.</div>}
            {executions?.map((e) => (
              <button
                key={e.id} type="button" onClick={() => { onSelect(e.id); setOpen(false); }}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-white/[0.05] ${e.id === selectedId ? "bg-[#ff6a1a]/10" : ""}`}
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot(e.status) }} title={e.status} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <code className="truncate text-[12px] text-white/90">{e.caseId}</code>
                    {e.simulated && <Badge tone="amber">Practice case</Badge>}
                  </span>
                  <span className="block truncate text-[11px] text-white/45">
                    {plainOutcome(e.outcome ?? (e.status === "running" ? null : e.status))}
                  </span>
                </span>
                <span className="shrink-0 text-right text-[11px] tabular-nums text-white/50">
                  {e.costUsd ? <span className="block">{cents(e.costUsd)}</span> : null}
                  <span className="block text-white/35">{ago(e.startedAt)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
