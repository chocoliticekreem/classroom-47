"use client";
// Header dropdown listing every playbook: switch, copy, rename, delete (your own only).
import { useEffect, useRef, useState } from "react";
import type { WorkflowRecord } from "../types";
import { Icon } from "./icons";
import { Badge } from "./bits";

export function WorkflowMenu({ records, current, isDraft, dirty, onOpen, onDuplicate, onRename, onDelete, onNew }: {
  records: WorkflowRecord[];
  current: WorkflowRecord | null;
  isDraft: boolean;
  dirty: boolean;
  onOpen: (w: WorkflowRecord) => void;
  onDuplicate: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onNew: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) { setOpen(false); setRenaming(null); } };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const finishRename = () => {
    const n = renaming?.trim();
    if (n && n !== current?.name) onRename(n);
    setRenaming(null);
    setOpen(false);
  };
  const item = "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-white/80 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button" onClick={() => setOpen((o) => !o)}
        className="inline-flex h-8 min-w-0 max-w-[280px] items-center gap-2 rounded-md px-2 text-[13px] font-semibold text-white hover:bg-white/[0.06]"
        title="Switch, copy, rename or delete playbooks"
      >
        <span className="truncate">{current?.name ?? "Playbook"}</span>
        <Icon name="chevron" size={12} className="shrink-0 rotate-90 text-white/45" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-1.5 w-[320px] overflow-hidden rounded-lg border border-white/10 bg-[#222227] shadow-2xl">
          <div className="border-b border-white/10 px-3 py-2 text-[12px] text-white/45">Playbooks</div>
          <div className="max-h-[300px] overflow-y-auto py-1">
            {records.map((r) => (
              <button
                key={r.id} type="button"
                onClick={() => {
                  setOpen(false);
                  if (r.id === current?.id && !isDraft) return;
                  if (dirty && !window.confirm("Discard unsaved changes?")) return;
                  onOpen(r);
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.05] ${r.id === current?.id && !isDraft ? "bg-[#ff6a1a]/10" : ""}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-white/90">{r.name}</span>
                  <span className="block truncate text-[11px] text-white/40">{r.flow.nodes.length} steps</span>
                </span>
                {r.active && <Badge tone="green">In use</Badge>}
                {r.source === "file" && <Badge>Built-in</Badge>}
              </button>
            ))}
          </div>
          <div className="border-t border-white/10 py-1">
            <button type="button" className={item} onClick={() => { setOpen(false); onNew(); }}>
              <Icon name="plus" size={13} /> New playbook…
            </button>
            {renaming !== null ? (
              <div className="flex items-center gap-1.5 px-3 py-1.5">
                <input
                  autoFocus value={renaming} onChange={(e) => setRenaming(e.target.value)}
                  onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") finishRename(); if (e.key === "Escape") setRenaming(null); }}
                  className="h-7 min-w-0 flex-1 rounded border border-white/15 bg-black/30 px-2 text-[12px] text-white outline-none focus:border-[#ff6a1a]/60"
                />
                <button type="button" onClick={finishRename} className="rounded px-2 py-1 text-[12px] text-[#ff8a4c] hover:bg-white/[0.06]">Rename</button>
              </div>
            ) : (
              <button type="button" className={item} disabled={!current} onClick={() => setRenaming(current?.name ?? "")}>
                <Icon name="planner" size={13} /> Rename…
              </button>
            )}
            <button type="button" className={item} disabled={!current || isDraft} onClick={() => { setOpen(false); onDuplicate(); }}>
              <Icon name="group" size={13} /> Make a copy
            </button>
            <button
              type="button" className={`${item} text-[#f87171]`}
              disabled={!current || isDraft || current.source !== "db"}
              title={current?.source === "file" ? "Built-in playbooks can't be deleted" : undefined}
              onClick={() => { setOpen(false); if (window.confirm(`Delete “${current?.name}”? This cannot be undone.`)) onDelete(); }}
            >
              <Icon name="trash" size={13} /> Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
