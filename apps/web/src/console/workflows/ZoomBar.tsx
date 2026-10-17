"use client";
// Zoom controls for the playbook canvas: out, the current zoom (click for 100%), in, fit.
import { useReactFlow, useStore } from "@xyflow/react";
import { Icon } from "./icons";

const btn = "grid h-8 w-8 place-items-center text-white/70 transition-colors hover:bg-rv-raised hover:text-white";

export function ZoomBar() {
  const rf = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  return (
    <div className="flex items-center overflow-hidden rounded-lg border border-rv-line bg-rv-panel shadow-lg" role="group" aria-label="Zoom">
      <button type="button" className={btn} onClick={() => void rf.zoomOut({ duration: 200 })} title="Zoom out" aria-label="Zoom out">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M5 12h14" /></svg>
      </button>
      <button
        type="button" onClick={() => void rf.zoomTo(1, { duration: 250 })} title="Zoom to 100% (1)"
        className="h-8 min-w-[52px] border-x border-rv-line px-2 text-[12px] font-medium tabular text-white/75 hover:bg-rv-raised hover:text-white"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button type="button" className={btn} onClick={() => void rf.zoomIn({ duration: 200 })} title="Zoom in" aria-label="Zoom in">
        <Icon name="plus" size={14} strokeWidth={2.2} />
      </button>
      <button type="button" className={`${btn} border-l border-rv-line`} onClick={() => void rf.fitView({ padding: 0.15, duration: 400 })} title="Fit to screen (F)" aria-label="Fit to screen">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
        </svg>
      </button>
    </div>
  );
}
