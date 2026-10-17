"use client";
// Overlay module: WorkflowHud. "Hamyway Ops — live" control-room HUD over the city canvas.
// The root is pointer-events-none so the canvas stays draggable; only panels take the mouse.
// Placement comes from WorkflowHud/layout.ts (one source of truth, unit-tested for overlaps):
//   top bar (full width, may wrap; its height is measured) > ops panel (right) / scenario panel (left,
//   above the minimap) > bottom band (decision card + hotkeys, between minimap and ops panel).
// Z-order inside the HUD: bottom band 10 < panels 20 < top bar + its menus 30. CityPage keeps the
// 3D canvas (and drei <Html> labels) in an isolated layer below the HUD.
import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { useWorld } from "../store";
import { hudLayout, TOPBAR_FALLBACK_H, type Insets } from "./WorkflowHud/layout";
import { CasesPanel } from "./WorkflowHud/CasesPanel";
import { AgentToggle, GLASS, HotkeysFooter } from "./WorkflowHud/parts";
import { useReviewQueue } from "../../review/useReviewQueue";
import { RealDecisionToast } from "./WorkflowHud/decision";
import { ScenarioButton, ScenarioPanel, TourBadge, useScenarioCoverage } from "./WorkflowHud/scenarios";
import { Clock, TopBar } from "./WorkflowHud/topbar";
import { DeskLinks } from "./WorkflowHud/deskLinks";

const px = (b: Insets): CSSProperties => ({ left: b.left, right: b.right, top: b.top, bottom: b.bottom });

const STYLES = `
@keyframes hud-toast-in { from { opacity: 0; transform: translateY(24px) scale(0.98); } to { opacity: 1; transform: none; } }
.hud-toast { animation: hud-toast-in 320ms cubic-bezier(0.2, 0.9, 0.25, 1.15) both; }
@keyframes hud-panel-in { from { opacity: 0; transform: translateX(16px); } to { opacity: 1; transform: none; } }
.hud-panel { animation: hud-panel-in 260ms ease-out both; }
.hud-scroll { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.15) transparent; }
.hud-scroll::-webkit-scrollbar { width: 6px; }
.hud-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 3px; }
`;

function AgentNote() {
  const online = useWorld((st) => st.agentOnline);
  if (online !== false) return null;
  return (
    <p className="border-b border-white/[0.07] bg-rose-500/[0.07] px-4 py-1.5 text-[11px] text-rose-100/85">
      Offline. Cases wait until it&apos;s back.
    </p>
  );
}

const OpsPanel = memo(function OpsPanel({ onCollapse, onDecide }: { onCollapse: () => void; onDecide: () => void }) {
  return (
    <aside className={`${GLASS} hud-panel flex h-full w-full flex-col overflow-hidden`} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <header className="flex items-center justify-between gap-2 border-b border-white/[0.07] px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="shrink-0 whitespace-nowrap text-[13px] font-semibold text-white">Cases</h2>
          <AgentToggle short />
        </div>
        <button
          type="button"
          onClick={onCollapse}
          title="Collapse panel"
          className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-white/60 transition hover:bg-white/10 hover:text-white"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path d="M3 1.5 L6.5 5 L3 8.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
          </svg>
        </button>
      </header>
      <AgentNote />
      <CasesPanel onDecide={onDecide} />
    </aside>
  );
});

function CollapsedTab({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`${GLASS} flex items-center gap-2 px-3 py-2 text-[11px] font-medium text-white/85 transition hover:text-white`}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
        <path d="M6.5 1.5 L3 5 L6.5 8.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      </svg>
      Cases
    </button>
  );
}

/** Embed mode (`?embed=1`, the desk console's iframe): only an honesty badge and the clock, in a corner. */
function EmbedBadge() {
  return (
    <div className="absolute left-2 top-2 flex items-center gap-2 rounded-lg border border-white/10 bg-[#0b0d12]/70 px-2 py-1 backdrop-blur-md">
      <span className="h-2 w-2 shrink-0 rounded-sm bg-[#ff6a1a]" />
      <Clock className="text-[11px]" />
      <AgentToggle short />
      <TourBadge />
    </div>
  );
}

/** Height of the top bar, kept in sync as it wraps (ResizeObserver; border-box). */
function useMeasuredHeight<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [h, setH] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setH(Math.ceil(el.getBoundingClientRect().height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, h] as const;
}

export default function WorkflowHud({ embed = false, onReviewOpen }: { embed?: boolean; onReviewOpen: () => void }) {
  const [open, setOpen] = useState(true);
  const [scenOpen, setScenOpen] = useState(false);
  const cov = useScenarioCoverage();
  const [barRef, barH] = useMeasuredHeight<HTMLDivElement>(TOPBAR_FALLBACK_H);
  const { tasks, loading } = useReviewQueue();
  // Agent cards only (real and synthetic city cases); the city has no mock cases any more.
  const reviewTasks = tasks.filter((task) => task.status === "pending" && task.origin !== "city");

  if (embed) {
    return (
      <div className="pointer-events-none absolute inset-0 z-10 select-none font-sans text-white antialiased">
        <EmbedBadge />
        <button type="button" onClick={onReviewOpen} className="pointer-events-auto absolute right-2 top-2 rounded-lg border border-white/15 bg-[#111318]/90 px-3 py-2 text-[11px] text-white/85">Needs a person{reviewTasks.length > 0 && <span className="ml-2 tabular-nums text-amber-200">{reviewTasks.length}</span>}</button>
      </div>
    );
  }

  const L = hudLayout({ topBarH: barH, opsOpen: open, minimap: true });
  return (
    <div className="pointer-events-none absolute inset-0 z-10 select-none font-sans text-white antialiased">
      <style>{STYLES}</style>

      {/* bottom band: decision card above the hotkeys, between the minimap and the ops panel */}
      <div className="absolute z-10 flex flex-col items-center justify-end gap-2" style={px(L.bottomBand)}>
        <RealDecisionToast tasks={tasks} loading={loading} onOpenQueue={onReviewOpen} />
        {reviewTasks.length > 0 && <button type="button" onClick={onReviewOpen} className={`${GLASS} flex items-center gap-2 px-3 py-2 text-[12px] text-white/90 transition hover:bg-[#1a1d24]`}>
          <span className="tabular-nums font-semibold text-amber-200">{reviewTasks.length}</span>
          <span>need a person</span>
        </button>}
        <HotkeysFooter />
      </div>

      <div className="absolute z-20 flex max-w-[calc(100%-24px)] flex-col items-end" style={{ ...px(L.ops), width: open ? L.ops.width : undefined }}>
        {open ? <OpsPanel onCollapse={() => setOpen(false)} onDecide={onReviewOpen} /> : <CollapsedTab onOpen={() => setOpen(true)} />}
      </div>

      {scenOpen && (
        <div className="absolute z-20 flex max-w-[calc(100%-24px)] flex-col" style={{ ...px(L.scenario), width: L.scenario.width }}>
          <ScenarioPanel cov={cov} onClose={() => setScenOpen(false)} />
        </div>
      )}

      <div ref={barRef} className="absolute z-30" style={px(L.topBar)}>
        <TopBar
          scenarios={<ScenarioButton open={scenOpen} onToggle={() => setScenOpen((o) => !o)} cov={cov} />}
          badge={<DeskLinks />}
        />
      </div>
    </div>
  );
}
