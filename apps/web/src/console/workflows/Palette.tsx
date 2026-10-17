"use client";
// Left "steps" panel: search, then drag a step onto the playbook (or click to add it).
import { useMemo, useState } from "react";
import type { NodeType } from "../types";
import { Icon } from "./icons";
import { GROUP_ORDER, searchNodeTypes } from "./nodeTypes";

export const DND_MIME = "application/x-rivet-node-type";

export function Palette({ onAdd, onClose }: { onAdd: (type: NodeType) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const hits = searchNodeTypes(q);
    return GROUP_ORDER.map((g) => ({ g, items: hits.filter((m) => m.group === g) })).filter((x) => x.items.length);
  }, [q]);

  return (
    <aside className="flex h-full w-[232px] shrink-0 flex-col border-r border-white/10 bg-[#19191d]">
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <span className="text-[13px] font-semibold text-white/85">Add a step</span>
        <button type="button" onClick={onClose} className="rounded p-1 text-white/50 hover:bg-white/10 hover:text-white" title="Hide">
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className="px-3 pb-2">
        <label className="flex h-8 items-center gap-2 rounded-md border border-white/10 bg-black/25 px-2 text-white/50 focus-within:border-[#ff6a1a]/60">
          <Icon name="search" size={14} />
          <input
            value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search steps…"
            className="w-full bg-transparent text-[12px] text-white outline-none placeholder:text-white/35"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {groups.length === 0 && <div className="px-2 py-4 text-[12px] text-white/40">Nothing matches “{q}”.</div>}
        {groups.map(({ g, items }) => (
          <div key={g} className="mb-2">
            <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/35">{g}</div>
            {items.map((m) => (
              <div
                key={m.type}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(DND_MIME, m.type);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDoubleClick={() => onAdd(m.type)}
                title="Drag onto the playbook, or double-click to add"
                className="group flex cursor-grab items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-white/[0.06] active:cursor-grabbing"
              >
                <span
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-md"
                  style={{ background: "rgba(255,255,255,0.06)", color: m.color }}
                >
                  <Icon name={m.icon} size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-white/90">{m.label}</span>
                  <span className="block truncate text-[11.5px] text-white/45">{m.description}</span>
                </span>
                <button
                  type="button" onClick={() => onAdd(m.type)} title="Add to canvas"
                  className="rounded p-0.5 text-white/0 group-hover:text-white/60 hover:!text-white"
                >
                  <Icon name="plus" size={14} />
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}
