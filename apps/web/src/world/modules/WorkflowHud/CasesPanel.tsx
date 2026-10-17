"use client";
// The city's side panel: one "Cases" list (real cases only: practice set, scenarios, console runs) and,
// under it, the selected case's run on the playbook. The playbook view follows the run: the current
// step is a big card kept centred as the trace advances, earlier steps marked done (green / amber /
// red). "Show whole path" shows every step. Merge/dedupe rules live in casesModel.ts (unit-tested).
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useWorld, type WorkflowEvent } from "../../store";
import { loadCityState } from "../../cityState";
import { traceToTimedEvents } from "../../agentBridge";
import { getExecution, listExecutions } from "../../../console/workflows/api";
import { scrubLeaks } from "../../../ui/plain";
import { on } from "../../bus";
import { caseEvents, caseForCaseId, CASE_STATE_WORD, currentStep, mergeCases, resolveSelection, runPath, type CaseItem, type CaseState, type PathStep, type RunRow, type SavedRun } from "./casesModel";
import { stepName, type NodeStatus } from "./flow";
import { useThrottledWorkflow } from "./parts";
import { STATUS_COLOR } from "./theme";

const STATE_TONE: Record<CaseState, string> = {
  waiting: "bg-white/10 text-white/70",
  working: "bg-[#ff6a1a]/15 text-[#ffb08a]",
  sent: "bg-emerald-400/15 text-emerald-200",
  person: "bg-amber-400/15 text-amber-200",
  stopped: "bg-rose-500/15 text-rose-200",
};

/** Case id -> where the city acted it out (scenario:staged), for the camera. */
const STAGED: Record<string, { x: number; z: number }> = {};
function rememberStaged(caseId: string, x: number, z: number) {
  STAGED[caseId] = { x, z };
}

/** Saved runs from SQLite (city runs + recent console executions), refreshed every 10 s. */
function useSavedRuns(): SavedRun[] {
  const [runs, setRuns] = useState<SavedRun[]>([]);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [city, ex] = await Promise.all([loadCityState(), listExecutions(30)]);
      if (!alive) return;
      const out: SavedRun[] = [...(city && Array.isArray(city.runs) ? city.runs : [])];
      if (ex.ok) for (const e of ex.data.executions) if (!out.some((r) => r.id === e.id)) out.push(e as SavedRun);
      setRuns(out);
    };
    void load();
    const id = setInterval(() => void load(), 10_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return runs;
}

/** performance.now() and Date.now() read together, ticking (read after mount, never during render). */
function useClocks(ms: number) {
  const [c, setC] = useState({ perf: 0, epoch: 0 });
  useEffect(() => {
    const tick = () => setC({ perf: performance.now(), epoch: Date.now() });
    tick();
    const id = setInterval(tick, ms);
    return () => clearInterval(id);
  }, [ms]);
  return c;
}

function age(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}

function CaseRow({ it, active, now, onPick }: { it: CaseItem; active: boolean; now: number; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={active}
      className={`w-full rounded-lg border px-2.5 py-2 text-left transition ${active ? "border-white/40 bg-white/[0.08]" : "border-white/[0.06] bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.05]"}`}
    >
      <span className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-white">{it.title}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-white/40">{age(now - it.at)}</span>
      </span>
      <span className="mt-1 flex items-center gap-2">
        <span className={`shrink-0 rounded px-1.5 py-px text-[11px] font-medium ${STATE_TONE[it.state]}`}>{CASE_STATE_WORD[it.state]}</span>
        <span className="min-w-0 truncate text-[11px] text-white/40">{it.caseId}</span>
      </span>
    </button>
  );
}

export const CasesPanel = memo(function CasesPanel({ onDecide }: { onDecide: () => void }) {
  const workflow = useThrottledWorkflow(300);
  const setFocus = useWorld((s) => s.setFocus);
  const runs = useSavedRuns();
  const clocks = useClocks(2000);
  const [sel, setSel] = useState<{ key: string; label: string | null } | null>(null);
  const [expanded, setExpanded] = useState(false);

  const items = useMemo(
    () => (clocks.epoch ? mergeCases({ workflow, runs, positions: STAGED, perfNow: clocks.perf, epochNow: clocks.epoch }) : []),
    [workflow, runs, clocks],
  );
  // Nothing picked: follow the newest case (so a run that starts is shown as it happens).
  const selected = resolveSelection(items, sel) ?? items[0] ?? null;

  const pick = (it: CaseItem) => {
    setSel({ key: it.key, label: it.label });
    if (it.pos) setFocus(it.pos);
  };

  // Remember where scenarios were acted out; a staged case selects itself.
  useEffect(
    () =>
      on((e) => {
        if (e.type === "scenario:staged") rememberStaged(e.scenarioId, e.x, e.z);
        if (e.type === "ui:selectCase") {
          const it = caseForCaseId(items, e.caseId);
          if (it) setSel({ key: it.key, label: it.label });
        }
      }),
    [items],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {expanded && selected ? (
        <div className="shrink-0 px-3 py-2">
          <CaseRow it={selected} active now={clocks.epoch} onPick={() => setExpanded(false)} />
        </div>
      ) : (
        <ul className="hud-scroll max-h-[38%] shrink-0 space-y-1 overflow-y-auto px-3 py-2" aria-label="Cases">
          {items.length === 0 && <li className="px-1 py-3 text-center text-[12px] text-white/45">No cases yet. Start one from Practice cases.</li>}
          {items.map((it) => (
            <li key={it.key}>
              <CaseRow it={it} active={selected?.key === it.key} now={clocks.epoch} onPick={() => pick(it)} />
            </li>
          ))}
        </ul>
      )}
      <div className="flex min-h-0 flex-1 flex-col rounded-b-xl border-t border-white/[0.07] bg-[#111318] px-3 pb-3 pt-2.5">
        {selected ? (
          <RunView key={selected.key} item={selected} workflow={workflow} onDecide={onDecide} expanded={expanded} onExpand={() => setExpanded((x) => !x)} />
        ) : (
          <p className="py-6 text-center text-[12px] text-white/45">Pick a case to see its run on the playbook.</p>
        )}
      </div>
    </div>
  );
});

/** The run's lines: the HUD feed when it has them, else the saved trace from SQLite. */
function useRunRows(item: CaseItem, workflow: readonly WorkflowEvent[]): { rows: RunRow[]; loading: boolean; fromTrace: boolean } {
  const feed = useMemo(() => caseEvents(workflow, item), [workflow, item]);
  const [fetched, setFetched] = useState<RunRow[] | null>(null);
  const needFetch = feed.length === 0 && !!item.executionId;
  useEffect(() => {
    if (!needFetch || !item.executionId) return;
    let alive = true;
    void getExecution(item.executionId).then((r) => {
      if (!alive) return;
      const trace = r.ok ? r.data.execution.trace : null;
      setFetched(trace ? traceToTimedEvents(trace, item.label ?? item.title).map((t) => ({ atMs: t.atMs, nodeId: t.event.nodeId, status: t.event.status, summary: t.event.summary })) : []);
    });
    return () => {
      alive = false;
    };
  }, [needFetch, item.executionId, item.label, item.title]);
  if (feed.length) {
    const t0 = feed[0].t;
    return { rows: feed.map((e) => ({ atMs: e.t - t0, nodeId: e.nodeId, status: e.status, summary: e.summary })), loading: false, fromTrace: false };
  }
  return { rows: fetched ?? [], loading: needFetch && fetched === null, fromTrace: needFetch };
}

const MARK: Record<NodeStatus, { word: string; tone: string }> = {
  start: { word: "Working", tone: "border-[#ff6a1a] bg-[#ff6a1a]/10" },
  ok: { word: "Done", tone: "border-emerald-400/70 bg-emerald-400/[0.07]" },
  ask: { word: "Needs a person", tone: "border-amber-400/80 bg-amber-400/[0.08]" },
  block: { word: "Stopped", tone: "border-rose-500/80 bg-rose-500/[0.08]" },
  error: { word: "Went wrong", tone: "border-red-500/80 bg-red-500/[0.08]" },
};

/** Fetched traces replay one line at a time so the view can follow the run as it happens. */
function useReveal(rows: readonly RunRow[], animate: boolean): RunRow[] {
  const [n, setN] = useState(animate ? 0 : rows.length);
  useEffect(() => {
    if (!animate) return;
    if (n >= rows.length) return;
    const id = setTimeout(() => setN((k) => k + 1), n === 0 ? 150 : 650);
    return () => clearTimeout(id);
  }, [animate, n, rows.length]);
  return animate ? rows.slice(0, n) : (rows as RunRow[]);
}

function StepCard({ s, current, open, onToggle, cardRef }: { s: PathStep; current: boolean; open: boolean; onToggle: () => void; cardRef?: (el: HTMLLIElement | null) => void }) {
  const last = s.lines[s.lines.length - 1];
  const mark = s.status ? MARK[s.status] : null;
  const result = last ? scrubLeaks(last.summary) || "…" : "Not reached";
  return (
    <li ref={cardRef}>
      <button
        type="button"
        onClick={onToggle}
        className={`w-full rounded-xl border-2 px-3.5 py-3 text-left transition-all duration-300 ${mark ? mark.tone : "border-white/10 bg-white/[0.02]"} ${current ? "shadow-[0_0_0_3px_rgba(255,255,255,0.12)]" : "opacity-80"}`}
      >
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.status ? STATUS_COLOR[s.status] : "rgba(255,255,255,0.2)" }} />
          <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-white">{stepName(s.nodeId)}</span>
          {mark && <span className="shrink-0 text-[12px] text-white/70">{mark.word}</span>}
        </div>
        <p className={`mt-1.5 text-[13px] leading-snug ${s.status ? "text-white/90" : "text-white/40"}`}>{result}</p>
        {open && s.lines.length > 0 && (
          <ol className="mt-2 space-y-1 border-t border-white/10 pt-2">
            {s.lines.map((r, i) => (
              <li key={i} className="flex gap-2 text-[12px] text-white/75">
                <span className="shrink-0 font-mono tabular-nums text-white/45">+{(r.atMs / 1000).toFixed(1)}s</span>
                <span className="min-w-0">{scrubLeaks(r.summary) || "…"}</span>
              </li>
            ))}
          </ol>
        )}
      </button>
    </li>
  );
}

function RunView({ item, workflow, onDecide, expanded, onExpand }: { item: CaseItem; workflow: readonly WorkflowEvent[]; onDecide: () => void; expanded: boolean; onExpand: () => void }) {
  const { rows: all, loading, fromTrace } = useRunRows(item, workflow);
  const rows = useReveal(all, fromTrace);
  const [whole, setWhole] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const path = useMemo(() => runPath(rows, whole), [rows, whole]);
  const current = currentStep(path);
  const refs = useRef(new Map<string, HTMLLIElement>());
  const box = useRef<HTMLOListElement>(null);

  // Follow the run: keep the current step centred as the trace advances (and on the last step when done).
  useEffect(() => {
    const el = current ? refs.current.get(current) : null;
    const b = box.current;
    if (!el || !b || whole) return;
    b.scrollTo({ top: el.offsetTop - b.clientHeight / 2 + el.clientHeight / 2, behavior: "smooth" });
  }, [current, rows.length, whole]);

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="min-w-0 truncate text-[14px] font-semibold text-white">{item.title}</h3>
        <span className={`shrink-0 rounded px-1.5 py-px text-[11px] font-medium ${STATE_TONE[item.state]}`}>{CASE_STATE_WORD[item.state]}</span>
      </div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {item.state === "person" && (
          <button type="button" onClick={onDecide} className="rounded-md bg-amber-400/90 px-2.5 py-1 text-[12px] font-semibold text-black transition hover:bg-amber-300">
            Decide
          </button>
        )}
        <button type="button" onClick={() => setWhole((w) => !w)} className="rounded-md border border-white/15 px-2.5 py-1 text-[12px] text-white/85 transition hover:bg-white/10">
          {whole ? "Follow the run" : "Show whole path"}
        </button>
        <button type="button" onClick={onExpand} className="rounded-md border border-white/15 px-2.5 py-1 text-[12px] text-white/85 transition hover:bg-white/10">
          {expanded ? "Show the list" : "Bigger"}
        </button>
        {item.executionId && (
          <a href={`/?tab=workflows&run=${encodeURIComponent(item.executionId)}`} className="rounded-md border border-white/15 px-2.5 py-1 text-[12px] text-white/85 transition hover:bg-white/10">
            Open in Playbooks
          </a>
        )}
      </div>
      {loading ? (
        <p className="text-[12px] text-white/45">Loading the run…</p>
      ) : path.length === 0 ? (
        <p className="text-[12px] text-white/45">{item.state === "waiting" ? "Waiting for its turn." : "No steps recorded yet."}</p>
      ) : (
        <ol ref={box} className={`hud-scroll relative min-h-[220px] flex-1 space-y-2 overflow-y-auto ${whole ? "" : "py-[30%]"}`}>
          {path.map((s) => (
            <StepCard
              key={s.nodeId}
              s={s}
              current={whole ? !!s.status : s.nodeId === current}
              open={open === s.nodeId}
              onToggle={() => setOpen((o) => (o === s.nodeId ? null : s.nodeId))}
              cardRef={(el) => {
                if (el) refs.current.set(s.nodeId, el);
                else refs.current.delete(s.nodeId);
              }}
            />
          ))}
        </ol>
      )}
    </section>
  );
}
