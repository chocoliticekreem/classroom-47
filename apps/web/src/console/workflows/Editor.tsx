"use client";
// n8n-style workflow editor for the agent's flows, with an execution overlay and live runs.
import "@xyflow/react/dist/style.css";
import "./workflows.css";
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  Background, BackgroundVariant, MiniMap, Panel, ReactFlow, ReactFlowProvider, useReactFlow,
  type Connection, type Edge, type NodeChange,
} from "@xyflow/react";
import type { ExecutionRecord, Flow, FlowNode, ImproveProposal, NodeType, Trace, WorkflowRecord, WorkflowVersion } from "../types";
import {
  architectValidate, createVersion, deleteWorkflow, executeCase, executeSample, executeReply, listVersions, getExecution, listExecutions, loadWorkflows, saveWorkflow,
  type ExecutionSummary,
} from "./api";
import { ArchitectPanel } from "./ArchitectPanel";
import { cents, plainFailure, plainOutcome, scrubLeaks } from "../../ui/plain";
import { nameFrom, problemsByNode, revealFrame, revealOrder, safetyLine, safetySummary, slugify, type ArchitectUsage } from "./architect";
import { WorkflowMenu } from "./WorkflowMenu";
import { TestPanel } from "./TestPanel";
import { diffCount, diffFlows, edgeMark, latestVersion, nodeMark, practiceLink, type FlowDiff } from "./testing";
import { Badge, Btn } from "./bits";
import { Button, ConsoleContext, HeaderActions, IconCity } from "../ui";
import {
  addNode, connect, docSignature, edgeKey, moveNodes, removeEdges, removeNodes, sourceHandleFor,
  updateEdgeWhen, updateNode, type FlowDoc, type Pos,
} from "./doc";
import { EdgePanel, NodePanel } from "./DetailPanel";
import { ExecuteDialog, type RunChoice } from "./ExecuteDialog";
import { ExecutionPicker } from "./ExecutionPicker";
import { CARD_W, FlowNodeCard, type CardNode } from "./FlowNodeCard";
import { checkpoint, initHistory, push, redo, replace, undo, type History } from "./history";
import { Icon } from "./icons";
import {
  TREE_MARK, displayPositions, edgeRoutes, tidyPositions, treeLayout, unmerge, type DisplayTree,
} from "./layout";
import { BranchEdge, type BranchEdgeType } from "./BranchEdge";
import { metaFor, nodeTitle } from "./nodeTypes";
import { DND_MIME, Palette } from "./Palette";
import { buildOverlay, pairKey, replayDelays } from "./status";
import { GRID, READ_ZOOM, canvasKey, cardCentre, pathTo, startViewport } from "./view";
import { passedLabel, playbookRuns, tallyRuns } from "./runStats";
import { ZoomBar } from "./ZoomBar";

/** How many recent case runs of a playbook feed the "n of N cases passed here" counts. */
const TALLY_RUNS = 20;

const nodeTypes = { card: FlowNodeCard };
const edgeTypes = { branch: BranchEdge };
type Selection = { kind: "node"; id: string } | { kind: "edge"; key: string } | null;
type Dims = Record<string, { width: number; height: number }>;

// Saved positions are kept only when the tree canvas wrote them; anything else gets the tidy tree.
const docOf = (w: WorkflowRecord): FlowDoc => ({ flow: w.flow, positions: w.positions?.[TREE_MARK] ? w.positions : {} });

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
}

/** Small "Advanced" dropdown for rarely used actions. */
function AdvancedMenu({ items }: { items: { label: string; onClick: () => void; disabled?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <Btn onClick={() => setOpen((o) => !o)} title="More options">Advanced <Icon name="chevron" size={11} className="rotate-90" /></Btn>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 w-52 overflow-hidden rounded-lg border border-white/10 bg-[#222227] py-1 shadow-xl">
          {items.map((it) => (
            <button
              key={it.label} type="button" disabled={it.disabled}
              onClick={() => { setOpen(false); it.onClick(); }}
              className="block w-full px-3 py-2 text-left text-[13px] text-white/80 hover:bg-white/[0.06] disabled:opacity-40"
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function EditorInner() {
  const rf = useReactFlow();
  const ctx = useContext(ConsoleContext); // null when rendered outside the console shell
  const wantWorkflow = useRef(ctx?.params.get("workflow") ?? null);
  // Deep link "Show on playbook" (?tab=workflows&run=<executionId>): open that run's playbook and play it.
  const wantRun = useRef(ctx?.params.get("run") ?? null);
  const setParamsRef = useRef(ctx?.setParams);
  useEffect(() => { setParamsRef.current = ctx?.setParams; }, [ctx?.setParams]);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Workflows
  const [records, setRecords] = useState<WorkflowRecord[] | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [hist, setHist] = useState<History<FlowDoc> | null>(null);
  const [savedSig, setSavedSig] = useState("");
  const [save, setSave] = useState<{ state: "idle" | "saving" | "saved" | "error"; msg?: string }>({ state: "idle" });
  const [sel, setSel] = useState<Selection>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [dims, setDims] = useState<Dims>({});
  const lastEdit = useRef<{ key: string; at: number } | null>(null);
  const saveRef = useRef<() => void>(() => {});

  // Executions
  const [executions, setExecutions] = useState<ExecutionSummary[] | null>(null);
  const [execError, setExecError] = useState<string | null>(null);
  const [execId, setExecId] = useState<string | null>(null);
  const [execution, setExecution] = useState<ExecutionRecord | null>(null);
  const [execLoadError, setExecLoadError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<number | null>(null); // live replay position; null = whole trace
  const [running, setRunning] = useState<{ caseId: string; dataset: string; since: number } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"new" | "reply" | null>(null);

  // Architect (AI builder) + validation
  // Deep link from Results ("Run more cases"): open Practice with that case list.
  const [practiceAsk] = useState(() => practiceLink(ctx?.params));
  const [drawer, setDrawer] = useState<"ai" | "test" | null>(practiceAsk ? "test" : null);
  const [mounted, setMounted] = useState<{ ai: boolean; test: boolean }>({ ai: false, test: !!practiceAsk });
  const openDrawer = useCallback((k: "ai" | "test" | null) => {
    setDrawer(k);
    setSel(null);
    if (k) setMounted((m) => (m[k] ? m : { ...m, [k]: true }));
  }, []);
  const [diffView, setDiffView] = useState<{ proposal: ImproveProposal; diff: FlowDiff } | null>(null);
  const [draft, setDraft] = useState<{ record: WorkflowRecord; description: string; prevId: string | null } | null>(null);
  const [reveal, setReveal] = useState<{ order: string[]; count: number } | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [check, setCheck] = useState<{ sig: string; problems: string[]; state: "ok" | "problems" | "unavailable"; msg?: string } | null>(null);
  const [validating, setValidating] = useState(false);
  const [versionsTick, setVersionsTick] = useState(0);
  const [viewReq, setViewReq] = useState(0);

  const doc = hist?.present ?? null;
  const current = draft?.record ?? records?.find((r) => r.id === currentId) ?? null;
  const docSig = useMemo(() => (doc ? docSignature(doc) : ""), [doc]);
  const dirty = !!doc && docSig !== savedSig;
  const liveCheck = check && check.sig === docSig ? check : null;
  const nodeProblems = useMemo(
    () => (liveCheck?.problems.length && doc ? problemsByNode(liveCheck.problems, doc.flow) : null),
    [liveCheck, doc],
  );

  const open = useCallback((w: WorkflowRecord) => {
    const d = docOf(w);
    setCurrentId(w.id);
    setHist(initHistory(d));
    setSavedSig(docSignature(d));
    setSel(null);
    setDraft(null);
    setReveal(null);
    setCheck(null);
    setViewReq((n) => n + 1); // open readable at the start step (applied once the canvas has the tree)
  }, []);

  useEffect(() => {
    let live = true;
    // Read, not cleared, here: StrictMode runs this effect twice and the first pass is discarded.
    const runId = wantRun.current;
    Promise.all([loadWorkflows(), runId ? getExecution(runId) : Promise.resolve(null)]).then(([{ workflows, fallback: why }, ex]) => {
      if (!live) return;
      setRecords(workflows);
      setFallback(why);
      const run = ex?.ok ? ex.data?.execution ?? null : null;
      const want = run?.workflowId ?? wantWorkflow.current;
      const first = workflows.find((w) => w.id === want) ?? workflows.find((w) => w.active) ?? workflows[0];
      open(first);
      if (runId) {
        wantRun.current = null;
        if (run) {
          setExecution(run);
          setExecId(run.id);
          setExecLoadError(null);
          setCursor(run.trace ? 0 : null);
        } else {
          setExecId(runId);
          setExecLoadError("Couldn't load that case run.");
        }
        setParamsRef.current?.({ run: null, workflow: first.id });
      }
    });
    return () => { live = false; };
  }, [open]);

  const refreshExecutions = useCallback(() => {
    listExecutions(60).then((r) => {
      if (r.ok) { setExecutions(r.data?.executions ?? []); setExecError(null); }
      else { setExecutions([]); setExecError("Couldn't load case runs right now."); }
    });
  }, []);
  useEffect(() => { refreshExecutions(); }, [refreshExecutions]);

  // Load the selected execution's trace.
  useEffect(() => {
    if (!execId) return;
    if (execution?.id === execId) return;
    let live = true;
    getExecution(execId).then((r) => {
      if (!live) return;
      if (r.ok && r.data?.execution) { setExecution(r.data.execution); setExecLoadError(null); }
      else { setExecution(null); setExecLoadError("Couldn't load that case run."); }
    });
    return () => { live = false; };
  }, [execId, execution?.id]);

  // Live replay: step the cursor through the trace events.
  const delays = useMemo(() => (execution?.trace ? replayDelays(execution.trace, 5000) : []), [execution]);
  useEffect(() => {
    if (cursor === null || !execution?.trace) return;
    if (cursor >= execution.trace.events.length) {
      const t = setTimeout(() => setCursor(null), 0);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setCursor((c) => (c === null ? null : c + 1)), delays[cursor] ?? 100);
    return () => clearTimeout(t);
  }, [cursor, execution, delays]);

  // A whole playbook only fits on screen at a zoom too small to read. While a run plays back, the
  // view moves to each step as it starts, and it stays on the last step when the playback ends, so
  // what each step found can still be read. "Show all" on the canvas zooms back out.
  useEffect(() => {
    if (cursor === null || !execution?.trace) return;
    const event = execution.trace.events[cursor];
    if (event?.kind !== "node_start") return;
    const node = rf.getNode(event.nodeId);
    if (!node) return;
    rf.setCenter(node.position.x + (node.measured?.width ?? 200) / 2, node.position.y + (node.measured?.height ?? 64) / 2, { zoom: 1, duration: 350 });
  }, [cursor, execution, rf]);

  const overlay = useMemo(() => {
    if (diffView || !execId || !execution?.trace || execution.id !== execId) return null;
    return buildOverlay(execution.trace, doc?.flow ?? null, cursor ?? undefined);
  }, [execId, execution, doc?.flow, cursor, diffView]);

  // The step whose reasoning is shown in full: the one that just finished in the playback, else the one clicked.
  const explained = useMemo(() => {
    if (!overlay) return null;
    let id: string | null = sel?.kind === "node" ? sel.id : null;
    if (cursor !== null && execution?.trace) {
      for (let i = Math.min(cursor, execution.trace.events.length - 1); i >= 0; i--) {
        const e = execution.trace.events[i];
        if (e.kind === "node_end") { id = e.nodeId; break; }
      }
    }
    const run = id ? overlay.nodes[id] : null;
    return run && run.detail.length ? run : null;
  }, [overlay, cursor, execution, sel]);

  // ---------- counts over recent runs ----------
  // Traces of the last TALLY_RUNS finished runs of this playbook, fetched once each and cached.
  const traceCache = useRef(new Map<string, Trace | null>());
  const [tallyTraces, setTallyTraces] = useState<{ workflowId: string; traces: Trace[] } | null>(null);
  const [showCounts, setShowCounts] = useState(false);
  const recentRuns = useMemo(() => playbookRuns(executions, draft ? null : currentId, TALLY_RUNS), [executions, currentId, draft]);
  useEffect(() => {
    if (!currentId || !recentRuns.length) return;
    let live = true;
    const want = recentRuns.map((r) => r.id);
    Promise.all(want.map(async (id) => {
      if (traceCache.current.has(id)) return traceCache.current.get(id) ?? null;
      const r = await getExecution(id);
      const t = r.ok ? r.data?.execution?.trace ?? null : null;
      traceCache.current.set(id, t);
      return t;
    })).then((ts) => {
      if (live) setTallyTraces({ workflowId: currentId, traces: ts.filter((t): t is Trace => !!t) });
    });
    return () => { live = false; };
  }, [currentId, recentRuns]);
  const tally = useMemo(() => {
    if (!tallyTraces || tallyTraces.workflowId !== currentId || !tallyTraces.traces.length || !doc) return null;
    return tallyRuns(tallyTraces.traces.map((t) => buildOverlay(t, doc.flow)));
  }, [tallyTraces, currentId, doc]);
  const countsOn = !!tally && !diffView && !reveal && (showCounts || !!execId);

  // ---------- canvas model ----------
  // The canvas draws a display tree (shared nodes copied per branch, loops as badges) laid out as
  // a tidy tree. Saved positions are used only when they cover every display node.
  const canvasFlow = diffView ? diffView.diff.merged : doc?.flow ?? null;
  const display: DisplayTree | null = useMemo(() => (canvasFlow ? unmerge(canvasFlow) : null), [canvasFlow]);
  const layoutPos = useMemo(() => (display ? treeLayout(display) : {}), [display]);
  const positions = useMemo(
    () => (!display ? {} : diffView ? layoutPos : displayPositions(display, doc?.positions)),
    [display, diffView, layoutPos, doc?.positions],
  );
  const positionsRef = useRef(positions);
  useEffect(() => { positionsRef.current = positions; }, [positions]);
  const routes = useMemo(() => (display ? edgeRoutes(display, layoutPos) : new Map()), [display, layoutPos]);
  // Display id -> node id, and display edge id -> flow edge key.
  const nodeOf = useMemo(() => {
    const m = new Map((display?.nodes ?? []).map((d) => [d.id, d.nodeId]));
    return (id: string) => m.get(id) ?? id.split("~")[0];
  }, [display]);
  const edgeKeyOf = useMemo(() => {
    const m = new Map((display?.edges ?? []).map((e) => [e.id, edgeKey(e.edge)]));
    return (id: string): string | null => m.get(id) ?? null;
  }, [display]);

  // ---------- camera ----------
  // A whole playbook only fits at a zoom too small to read, so it opens at a reading zoom on the
  // start step; "Show all" fits everything.
  const goStart = useCallback((duration = 0) => {
    const r = wrapRef.current?.getBoundingClientRect();
    const v = display && r ? startViewport(display, positions, { width: r.width, height: r.height }) : null;
    if (v) void rf.setViewport(v, { duration });
    return !!v;
  }, [display, positions, rf]);
  const showAll = useCallback(() => { void rf.fitView({ padding: 0.15, duration: 450 }); }, [rf]);
  const appliedView = useRef(0);
  useEffect(() => {
    if (!viewReq || appliedView.current === viewReq || !display) return;
    const raf = requestAnimationFrame(() => { if (goStart()) appliedView.current = viewReq; });
    return () => cancelAnimationFrame(raf);
  }, [viewReq, display, goStart]);

  // While "Make a playbook" places a draft, the camera follows each new step at a reading zoom.
  const newest = reveal && reveal.count > 0 ? reveal.order[reveal.count - 1] : null;
  useEffect(() => {
    if (!newest || !display) return;
    const c = cardCentre(display, positions, newest);
    if (c) void rf.setCenter(c.x, c.y, { zoom: READ_ZOOM, duration: 300 });
  }, [newest, display, positions, rf]);

  // The path from the start to the selected step, drawn in the accent colour.
  const selPath = useMemo(
    () => (display && sel?.kind === "node" && !overlay && !diffView && !reveal ? pathTo(display, sel.id) : null),
    [display, sel, overlay, diffView, reveal],
  );

  // ---------- edits ----------
  const commit = useCallback((fn: (d: FlowDoc) => FlowDoc, coalesce?: string) => {
    // Rapid edits of the same field (slider drags) collapse into one undo step.
    const now = Date.now();
    const same = !!coalesce && lastEdit.current?.key === coalesce && now - lastEdit.current.at < 1000;
    lastEdit.current = coalesce ? { key: coalesce, at: now } : null;
    setHist((h) => (h ? (same ? replace(h, fn(h.present)) : push(h, fn(h.present))) : h));
  }, []);

  const doUndo = useCallback(() => { lastEdit.current = null; setHist((h) => (h ? undo(h) : h)); }, []);
  const doRedo = useCallback(() => { lastEdit.current = null; setHist((h) => (h ? redo(h) : h)); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || !(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); doUndo(); }
      else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); doRedo(); }
      else if (k === "s") { e.preventDefault(); saveRef.current(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doUndo, doRedo]);

  // F fits everything, 1 goes to 100%, Esc deselects (n8n-style). Ignored while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const k = canvasKey(e);
      if (!k) return;
      if (k === "deselect") { if (sel) { e.preventDefault(); setSel(null); } return; }
      e.preventDefault();
      if (k === "fit") void rf.fitView({ padding: 0.15, duration: 400 });
      else void rf.zoomTo(1, { duration: 300 });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rf, sel]);

  const addAt = useCallback((type: NodeType, pos: Pos) => {
    if (!hist) return;
    // Pin the current layout so the dropped card stays where it was dropped.
    const pinned: FlowDoc = { ...hist.present, positions: { ...positionsRef.current, [TREE_MARK]: { x: 1, y: 1 } } };
    const r = addNode(pinned, type, pos);
    lastEdit.current = null;
    setHist(push(hist, r.doc));
    setSel({ kind: "node", id: r.id });
  }, [hist]);

  const addCentered = useCallback((type: NodeType) => {
    const r = wrapRef.current?.getBoundingClientRect();
    const p = r ? rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) : { x: 0, y: 0 };
    addAt(type, { x: p.x - CARD_W / 2 + (Math.random() - 0.5) * 40, y: p.y - 38 + (Math.random() - 0.5) * 40 });
  }, [rf, addAt]);

  const onDrop = useCallback((e: DragEvent) => {
    const type = e.dataTransfer.getData(DND_MIME) as NodeType;
    if (!type) return;
    e.preventDefault();
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    addAt(type, { x: p.x - CARD_W / 2, y: p.y - 38 });
  }, [rf, addAt]);

  const onNodesChange = useCallback((changes: NodeChange<CardNode>[]) => {
    const moves: Record<string, Pos> = {};
    const nd: Dims = {};
    for (const c of changes) {
      if (c.type === "position" && c.position) moves[c.id] = c.position;
      if (c.type === "dimensions" && c.dimensions) nd[c.id] = c.dimensions;
    }
    if (Object.keys(nd).length) setDims((d) => ({ ...d, ...nd }));
    if (Object.keys(moves).length) setHist((h) => (h ? replace(h, moveNodes(h.present, moves)) : h));
  }, []);

  const onDelete = useCallback(({ nodes, edges }: { nodes: CardNode[]; edges: Edge[] }) => {
    if (diffView) return;
    const nodeIds = [...new Set(nodes.map((n) => nodeOf(n.id)))];
    const keys = [...new Set(edges.map((e) => edgeKeyOf(e.id)).filter((k): k is string => !!k))];
    if (!nodeIds.length && !keys.length) return;
    commit((d) => removeEdges(removeNodes(d, nodeIds), keys));
    setSel(null);
  }, [commit, diffView, nodeOf, edgeKeyOf]);

  const onConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target) return;
    commit((d) => connect(d, nodeOf(c.source), nodeOf(c.target), c.sourceHandle));
  }, [commit, nodeOf]);

  const autoLayout = useCallback(() => {
    commit((d) => ({ ...d, positions: tidyPositions(d.flow) }));
    setTimeout(() => rf.fitView({ padding: 0.15, duration: 350 }), 60);
  }, [commit, rf]);

  /** Every save is also a version (the test loop runs versions). Skipped when the graph equals
   *  the latest version, e.g. a save that only moved cards. Never blocks the save. */
  const recordVersion = useCallback(async (workflowId: string, flow: Flow, createdBy: WorkflowVersion["createdBy"], note: string) => {
    const vs = await listVersions(workflowId);
    if (!vs.ok && vs.status === 404) return;
    const latest = latestVersion(vs.ok ? vs.data?.versions ?? [] : []);
    const graph = (f: Flow) => JSON.stringify({ nodes: f.nodes, edges: f.edges });
    if (latest && graph(latest.flow) === graph(flow)) return;
    const cv = await createVersion(workflowId, { flow, createdBy, note, parentVersion: latest?.version ?? null });
    if (cv.ok) setVersionsTick((t) => t + 1);
  }, []);

  /** Ask the Architect to check the flow. Never blocks on a missing agent API. */
  const runValidate = useCallback(async (): Promise<"ok" | "problems" | "unavailable"> => {
    if (!doc) return "unavailable";
    const sig = docSignature(doc);
    setValidating(true);
    const r = await architectValidate({ flow: doc.flow });
    setValidating(false);
    if (r.ok && Array.isArray(r.data?.problems)) {
      const problems = r.data.problems;
      setCheck({ sig, problems, state: problems.length ? "problems" : "ok" });
      return problems.length ? "problems" : "ok";
    }
    setCheck({ sig, problems: [], state: "unavailable", msg: r.ok ? r.data?.error ?? "no answer" : r.error });
    return "unavailable";
  }, [doc]);

  const doSave = useCallback(async (force = false) => {
    if (!doc || !current) return;
    setSave({ state: "saving" });
    if (!force && (await runValidate()) === "problems") {
      setSave({ state: "error", msg: "Some things need fixing first" });
      return;
    }
    const isDraft = !!draft;
    if (isDraft) setAccepting(true);
    const rec: WorkflowRecord = {
      ...current, flow: { ...doc.flow, id: current.id }, positions: doc.positions, updatedAt: new Date().toISOString(),
      ...(isDraft ? { source: "db" as const, active: false } : {}),
    };
    const r = await saveWorkflow(rec);
    setAccepting(false);
    if (r.ok) {
      const saved = r.data?.workflow ?? rec;
      await recordVersion(saved.id, rec.flow, isDraft ? "architect" : "user", isDraft ? "Built with the Architect" : "Saved in the editor");
      setRecords((rs) => {
        const list = rs ?? [];
        return list.some((x) => x.id === saved.id) ? list.map((x) => (x.id === saved.id ? saved : x)) : [...list, saved];
      });
      if (isDraft) {
        setDraft(null);
        setCurrentId(saved.id);
        setParamsRef.current?.({ workflow: saved.id });
      }
      setSavedSig(docSignature(doc));
      setFallback(null);
      setSave({ state: "saved" });
      setTimeout(() => setSave((s) => (s.state === "saved" ? { state: "idle" } : s)), 2000);
    } else {
      setSave({ state: "error", msg: "Couldn't save. Try again." });
    }
  }, [doc, current, draft, runValidate, recordVersion]);

  // ---------- Architect drafts ----------
  const startDraft = useCallback((d: { flow: Flow; description: string; problems: string[]; usage?: ArchitectUsage[] }) => {
    const brief = d.description.split("\n\nChanges:")[0];
    const name = draft?.record.name ?? nameFrom(brief);
    const id = draft?.record.id ?? slugify(name, (records ?? []).map((r) => r.id));
    const flow: Flow = { ...d.flow, id, name };
    const next: FlowDoc = { flow, positions: {} };
    const record: WorkflowRecord = { id, name, flow, positions: next.positions, active: false, updatedAt: new Date().toISOString(), source: "db" };
    lastEdit.current = null;
    setDraft({ record, description: d.description, prevId: draft ? draft.prevId : currentId });
    setHist(initHistory(next));
    setSavedSig("");
    setSel(null);
    setDims({});
    setExecId(null);
    setCursor(null);
    setSave({ state: "idle" });
    setCheck(d.problems.length ? { sig: docSignature(next), problems: d.problems, state: "problems" } : null);
    setReveal({ order: revealOrder(flow), count: 0 });
  }, [draft, records, currentId]);

  const discardDraft = useCallback(() => {
    if (!draft) return;
    const prev = records?.find((r) => r.id === draft.prevId) ?? records?.[0];
    if (prev) open(prev);
    else { setDraft(null); setReveal(null); }
  }, [draft, records, open]);

  // Reveal the draft node by node, following the camera.
  useEffect(() => {
    if (!reveal) return;
    if (reveal.count >= reveal.order.length) {
      const t = setTimeout(() => { setReveal(null); rf.fitView({ padding: 0.2, duration: 450 }); }, 350);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setReveal((r) => (r ? { ...r, count: r.count + 1 } : r)), reveal.count === 0 ? 150 : 380);
    return () => clearTimeout(t);
  }, [reveal, rf]);

  // ---------- workflow list actions ----------
  const switchTo = useCallback((w: WorkflowRecord) => { open(w); setParamsRef.current?.({ workflow: w.id }); }, [open]);

  const duplicate = useCallback(async () => {
    if (!current || !doc || draft) return;
    const id = slugify(`${current.name} copy`, (records ?? []).map((r) => r.id));
    const rec: WorkflowRecord = {
      ...current, id, name: `${current.name} (copy)`, flow: { ...doc.flow, id }, positions: doc.positions,
      active: false, source: "db", updatedAt: new Date().toISOString(),
    };
    const r = await saveWorkflow(rec);
    if (!r.ok) { setSave({ state: "error", msg: "Couldn't make a copy." }); return; }
    const saved = r.data?.workflow ?? rec;
    setRecords((rs) => [...(rs ?? []), saved]);
    switchTo(saved);
  }, [current, doc, draft, records, switchTo]);

  const rename = useCallback(async (name: string) => {
    if (!current) return;
    if (draft) { setDraft({ ...draft, record: { ...draft.record, name, flow: { ...draft.record.flow, name } } }); return; }
    // Rename the saved version only; unsaved canvas edits stay unsaved.
    const rec: WorkflowRecord = { ...current, name, flow: { ...current.flow, name }, updatedAt: new Date().toISOString() };
    const r = await saveWorkflow(rec);
    if (!r.ok) { setSave({ state: "error", msg: "Couldn't rename it." }); return; }
    const saved = r.data?.workflow ?? rec;
    setRecords((rs) => (rs ?? []).map((x) => (x.id === saved.id ? saved : x)));
  }, [current, draft]);

  const remove = useCallback(async () => {
    if (!current || draft || current.source !== "db") return;
    const r = await deleteWorkflow(current.id);
    if (!r.ok) { setSave({ state: "error", msg: "Couldn't delete it." }); return; }
    const rest = (records ?? []).filter((x) => x.id !== current.id);
    setRecords(rest);
    const next = rest.find((w) => w.active) ?? rest[0];
    if (next) switchTo(next);
  }, [current, draft, records, switchTo]);

  useEffect(() => { saveRef.current = () => { if (dirty) void doSave(); }; }, [dirty, doSave]);

  // ---------- execute ----------
  const runCase = useCallback(async (c: RunChoice, followup = false) => {
    setDialog(null);
    setRunError(null);
    setRunning({ caseId: "scenario" in c ? "New sample" : c.id, dataset: "scenario" in c ? "adhoc" : c.dataset, since: Date.now() });
    const r = "scenario" in c
      ? followup && execId ? await executeReply(currentId!, execId, c.scenario) : await executeSample(currentId!, c.scenario)
      : await executeCase({ caseId: c.id, dataset: c.dataset, workflowId: currentId ?? undefined });
    if (!r.ok || !r.data?.execution) {
      setRunning(null);
      setRunError("The case didn't run. Try again in a minute.");
      return;
    }
    let ex = r.data.execution;
    // If the API returns before the run finishes, poll until it does (max ~3 min).
    for (let i = 0; ex.status === "running" && i < 90; i++) {
      await new Promise((res) => setTimeout(res, 2000));
      const g = await getExecution(ex.id);
      if (g.ok && g.data?.execution) ex = g.data.execution;
    }
    setRunning(null);
    setExecution(ex);
    setExecId(ex.id);
    setExecLoadError(null);
    setCursor(ex.trace ? 0 : null);
    refreshExecutions();
  }, [currentId, execId, refreshExecutions]);

  const selectExecution = useCallback((id: string | null) => {
    setExecId(id);
    setCursor(null);
    setExecLoadError(null);
  }, []);

  // ---------- test & improve ----------
  const showProposal = useCallback((p: { proposal: ImproveProposal; base: Flow | null } | null) => {
    if (!p) { setDiffView(null); return; }
    const diff = diffFlows(p.base ?? doc?.flow ?? p.proposal.flow, p.proposal.flow);
    setDiffView({ proposal: p.proposal, diff });
    setSel(null);
    setTimeout(() => rf.fitView({ padding: 0.2, duration: 400 }), 60);
  }, [rf, doc]);

  const loadVersion = useCallback((v: WorkflowVersion) => {
    if (!doc) return;
    const flow: Flow = { ...v.flow, id: current?.id ?? v.flow.id, name: current?.name ?? v.flow.name };
    // Keep known positions; place any new node with the auto-layout. The saved workflow is
    // untouched, so "Unsaved" shows when this version differs from it.
    const next: FlowDoc = { flow, positions: doc.positions };
    lastEdit.current = null;
    setHist((h) => (h ? push(h, next) : initHistory(next)));
    setCheck(null);
    setTimeout(() => rf.fitView({ padding: 0.2, duration: 300 }), 60);
  }, [doc, current, rf]);

  /** Make a version the workflow Execute and the agent use: PUT it, and show it as saved. */
  const makeCurrent = useCallback(async (v: WorkflowVersion): Promise<boolean> => {
    if (!current || !doc || draft) return false;
    const flow: Flow = { ...v.flow, id: current.id, name: current.name };
    const rec: WorkflowRecord = { ...current, flow, positions: doc.positions, updatedAt: new Date().toISOString() };
    const r = await saveWorkflow(rec);
    if (!r.ok) { setSave({ state: "error", msg: `Couldn't switch to version ${v.version}.` }); return false; }
    const saved = r.data?.workflow ?? rec;
    setRecords((rs) => (rs ?? []).map((x) => (x.id === saved.id ? saved : x)));
    const next: FlowDoc = { flow, positions: doc.positions };
    lastEdit.current = null;
    setHist((h) => (h ? push(h, next) : initHistory(next)));
    setSavedSig(docSignature(next));
    setCheck(null);
    setSave({ state: "saved" });
    setTimeout(() => setSave((s) => (s.state === "saved" ? { state: "idle" } : s)), 2000);
    setTimeout(() => rf.fitView({ padding: 0.2, duration: 300 }), 60);
    return true;
  }, [current, doc, draft, rf]);

  const rfNodes: CardNode[] = useMemo(() => {
    if (!doc || !display) return [];
    const visible = reveal && !diffView ? revealFrame(doc.flow, reveal.order, reveal.count).nodes : null;
    const label = (id: string) => { const n = display.byId.get(id)?.node; return n ? nodeTitle(n) : id; };
    return display.nodes.filter((d) => !visible || visible.has(d.nodeId)).map((d) => {
      const run = overlay?.nodes[d.nodeId] ?? null;
      return {
        id: d.id,
        type: "card",
        position: positions[d.id] ?? { x: 0, y: 0 },
        selected: sel?.kind === "node" && sel.id === d.nodeId,
        measured: dims[d.id],
        draggable: !diffView,
        data: {
          node: d.node,
          run,
          dimmed: !!overlay && !run,
          problems: diffView ? undefined : nodeProblems?.byNode[d.nodeId],
          appear: !!reveal,
          fresh: !!reveal && d.id === newest,
          onPath: !!selPath?.nodes.has(d.id),
          diff: diffView ? { mark: nodeMark(diffView.diff, d.nodeId), change: diffView.diff.changedNodes.get(d.nodeId) } : undefined,
          shared: d.occurrences > 1 ? { count: d.occurrences, stub: d.stub } : undefined,
          loops: d.loops.map((e) => `${e.when ?? "loop"} → ${label(e.to)}`),
          tally: countsOn && tally ? { passed: tally.nodes[d.nodeId]?.passed ?? 0, runs: tally.runs, label: passedLabel(tally.nodes[d.nodeId], tally.runs) } : undefined,
        },
      };
    });
  }, [doc, display, positions, overlay, sel, dims, reveal, nodeProblems, diffView, newest, selPath, countsOn, tally]);

  const rfEdges: Edge[] = useMemo(() => {
    if (!doc || !display) return [];
    const visible = reveal && !diffView ? revealFrame(doc.flow, reveal.order, reveal.count).nodes : null;
    const res: Edge[] = display.edges
      .filter((de) => !visible || (visible.has(de.edge.from) && visible.has(de.edge.to)))
      .map((de): BranchEdgeType => {
        const key = edgeKey(de.edge);
        const taken = !!overlay?.taken.has(pairKey(de.edge.from, de.edge.to));
        const mark = diffView ? edgeMark(diffView.diff, de.edge) : null;
        const r = routes.get(de.id);
        const onPath = !!selPath?.edges.has(de.id);
        const fresh = !!reveal && de.target === newest;
        return {
          id: de.id,
          type: "branch",
          source: de.source,
          target: de.target,
          sourceHandle: de.handle,
          targetHandle: "in",
          selected: !diffView && sel?.kind === "edge" && sel.key === key,
          selectable: !diffView,
          deletable: !diffView,
          animated: taken || mark === "added",
          className: diffView
            ? mark === "added" ? "wf-diff-added" : mark === "removed" ? "wf-diff-removed" : "wf-faded"
            : overlay ? (taken ? "wf-taken" : "wf-faded")
            : countsOn && tally && !selPath ? ((tally.edges[pairKey(de.edge.from, de.edge.to)] ?? 0) > 0 ? "wf-busy" : "wf-faded")
            : selPath ? (onPath ? "wf-path" : "wf-faded")
            : fresh ? "wf-edge-new" : undefined,
          zIndex: taken || mark || onPath ? 1 : 0,
          data: {
            when: de.edge.when,
            trunk: r ? r.trunkX - r.sx : undefined,
            plain: !overlay && !diffView && !selPath && !fresh && !countsOn,
            labelTone: diffView ? (mark === "added" ? "added" : mark === "removed" ? "removed" : "faded")
              : overlay ? (taken ? "taken" : "faded")
              : selPath && !onPath ? "faded" : undefined,
          },
        };
      });
    // Hops the run took that the flow does not draw (e.g. action -> log): dotted, not editable.
    if (overlay && !diffView) {
      const drawn = new Set(display.edges.map((e) => pairKey(e.edge.from, e.edge.to)));
      for (const t of overlay.edges) {
        if (drawn.has(pairKey(t.from, t.to)) || !display.byId.has(t.from) || !display.byId.has(t.to)) continue;
        res.push({
          id: `run:${t.from}->${t.to}`, source: t.from, target: t.to, targetHandle: "in", type: "smoothstep",
          sourceHandle: sourceHandleFor(doc.flow, { from: t.from, to: t.to, when: t.when }),
          label: t.when ? `${t.when} (run)` : "run", animated: true, className: "wf-extra",
          selectable: false, deletable: false, focusable: false,
          labelStyle: { fill: "#4ade80", fontSize: 10 }, labelBgPadding: [5, 2] as [number, number], labelBgBorderRadius: 4,
        });
      }
    }
    return res;
  }, [doc, display, routes, overlay, sel, reveal, diffView, newest, selPath, countsOn, tally]);

  // Result banner for a new playbook, once every step is placed. Computed from the real flow.
  const draftSafety = useMemo(() => (draft && !reveal && doc ? safetySummary(doc.flow) : null), [draft, reveal, doc]);

  const selNode: FlowNode | null = sel?.kind === "node" ? doc?.flow.nodes.find((n) => n.id === sel.id) ?? null : null;
  const selEdge = sel?.kind === "edge" ? doc?.flow.edges.find((e) => edgeKey(e) === sel.key) ?? null : null;

  const execSummary = executions?.find((e) => e.id === execId) ?? null;
  const shownExec = execution && execution.id === execId ? execution : null;
  const simulated = shownExec?.simulated ?? execSummary?.simulated ?? false;

  const primaryActions = (
    <>
      <Btn variant="outline" onClick={() => openDrawer(drawer === "ai" ? null : "ai")} title="Make a new playbook from a description">
        <Icon name="plus" size={13} /> New playbook
      </Btn>
      <Btn variant="outline" onClick={() => openDrawer(drawer === "test" ? null : "test")} title="Practise on real cases and improve">
        <Icon name="check" size={13} /> Practice
      </Btn>
      <Btn variant="outline" onClick={() => setDialog("new")} disabled={!!running || !!draft} title={draft ? "Save the playbook first" : "Run one case through this playbook"}>
        <Icon name="play" size={13} /> Run a case
      </Btn>
      <Btn variant="outline" onClick={() => setDialog("reply")} disabled={!!running || !!draft || dirty || !shownExec || shownExec.status !== "success"}>Add a reply</Btn>
      <Btn variant="primary" onClick={() => void doSave()} disabled={!dirty || save.state === "saving" || !!reveal} title="Save (⌘S)">
        {save.state === "saving" ? (validating ? "Checking…" : "Saving…") : draft ? "Use this playbook" : "Save"}
      </Btn>
    </>
  );

  if (!doc || !records) {
    return <div className="grid h-full place-items-center bg-[#1f1f23] text-[13px] text-white/45">Loading playbook…</div>;
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-[#1f1f23] text-white">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-white/10 bg-[#19191d] px-3">
        {!paletteOpen && (
          <Btn onClick={() => setPaletteOpen(true)} title="Add a step"><Icon name="plus" size={14} /> Add step</Btn>
        )}
        <div className="flex min-w-0 items-center gap-2">
          <WorkflowMenu
            records={records} current={current} isDraft={!!draft} dirty={dirty}
            onOpen={switchTo} onDuplicate={() => void duplicate()} onRename={(n) => void rename(n)}
            onDelete={() => void remove()} onNew={() => openDrawer("ai")}
          />
          {draft && <Badge tone="orange" title="Not saved yet">Draft</Badge>}
          {current?.source === "file" && !draft && <Badge title="Comes with the app">Built-in</Badge>}
          {dirty ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-[#ff8a4c]"><span className="h-1.5 w-1.5 rounded-full bg-[#ff6a1a]" />Unsaved</span>
          ) : save.state === "saved" ? (
            <span className="text-[11px] text-[#4ade80]">Saved</span>
          ) : null}
        </div>

        <div className="ml-2 flex items-center gap-0.5 border-l border-white/10 pl-2">
          <Btn onClick={doUndo} disabled={!hist?.past.length} title="Undo (⌘Z)"><Icon name="undo" size={15} /></Btn>
          <Btn onClick={doRedo} disabled={!hist?.future.length} title="Redo (⇧⌘Z)"><Icon name="redo" size={15} /></Btn>
          <Btn onClick={autoLayout} title="Tidy up the layout"><Icon name="layout" size={15} /><span className="hidden xl:inline">Tidy up</span></Btn>
          <AdvancedMenu
            items={[
              { label: validating ? "Checking…" : "Check it is safe", onClick: () => void runValidate(), disabled: validating },
              { label: paletteOpen ? "Hide the step list" : "Show the step list", onClick: () => setPaletteOpen((o) => !o) },
            ]}
          />
        </div>

        <div className="ml-auto flex min-w-0 items-center gap-2">
          {save.state === "error" && (
            <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-[#f87171]">
              <span className="truncate" title={save.msg}>{save.msg}</span>
              {liveCheck?.state === "problems" && (
                <button type="button" className="shrink-0 underline hover:text-white" onClick={() => void doSave(true)}>Save anyway</button>
              )}
            </span>
          )}
          <ExecutionPicker
            executions={executions} error={execError} selectedId={execId} workflowId={draft ? null : currentId}
            onSelect={selectExecution} onRefresh={refreshExecutions}
          />
          {ctx?.headerSlot ? <HeaderActions>{primaryActions}</HeaderActions> : primaryActions}
        </div>
      </div>

      {/* Run strip */}
      {diffView && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-white/10 bg-[#1b1b1f] px-3 py-2 text-[13px]">
          <span className="font-semibold text-white">Suggested changes</span>
          {diffView.diff.addedNodes.size > 0 && <span className="text-[#4ade80]">{diffView.diff.addedNodes.size} new step{diffView.diff.addedNodes.size === 1 ? "" : "s"}</span>}
          {diffView.diff.removedNodes.size > 0 && <span className="text-[#f87171]">{diffView.diff.removedNodes.size} removed</span>}
          {diffView.diff.changedNodes.size > 0 && <span className="text-[#fbbf24]">{diffView.diff.changedNodes.size} changed</span>}
          {diffCount(diffView.diff) === 0 && <span className="text-white/55">Only small wording changes</span>}
          <span className="ml-auto text-white/45">Decide in Practice</span>
        </div>
      )}
      {liveCheck && !reveal && (
        <div className={`flex shrink-0 flex-wrap items-start gap-x-3 gap-y-1 border-b border-white/10 px-3 py-1.5 text-[12px] ${liveCheck.state === "problems" ? "bg-[#ef4444]/[0.07]" : "bg-[#1b1b1f]"}`}>
          {liveCheck.state === "ok" && (
            <span className="inline-flex items-center gap-1.5 text-[#4ade80]"><Icon name="check" size={13} strokeWidth={3} /> Looks safe.</span>
          )}
          {liveCheck.state === "unavailable" && (
            <span className="text-[#fbbf24]">Couldn&apos;t check it right now.</span>
          )}
          {liveCheck.state === "problems" && (
            <div className="min-w-0 flex-1 text-[#fca5a5]">
              <span className="font-semibold">{liveCheck.problems.length} thing{liveCheck.problems.length === 1 ? "" : "s"} to fix</span>
              {nodeProblems && Object.keys(nodeProblems.byNode).length > 0 && (
                <span className="text-white/50"> · steps with a problem have a red outline</span>
              )}
              <details className="text-white/50"><summary className="cursor-pointer">Details</summary>{liveCheck.problems.map((p, i) => <div key={i}>{p}</div>)}</details>
            </div>
          )}
          <button type="button" className="ml-auto text-white/40 hover:text-white" onClick={() => setCheck(null)} title="Dismiss"><Icon name="close" size={12} /></button>
        </div>
      )}
      {(running || runError || execId || fallback) && (
        <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-white/10 bg-[#1b1b1f] px-3 py-1.5 text-[12px]">
          {running && (
            <span className="inline-flex items-center gap-2 text-[#ff8a4c]">
              <span className="wf-spin block h-3.5 w-3.5 rounded-full border-2 border-[#ff6a1a] border-t-transparent" />
              Working on the case… it plays here when it&apos;s done.
            </span>
          )}
          {runError && (
            <span className="text-[#f87171]">{runError} <button type="button" className="ml-1 underline" onClick={() => setRunError(null)}>dismiss</button></span>
          )}
          {execId && !running && (
            <>
              {execLoadError ? (
                <span className="text-[#f87171]">{execLoadError}</span>
              ) : !shownExec ? (
                <span className="text-white/45">Loading…</span>
              ) : (
                <>
                  <span className="font-semibold text-white">{plainOutcome(overlay?.end?.outcome ?? shownExec.outcome ?? (shownExec.status === "running" ? null : shownExec.status))}</span>
                  <Badge tone={simulated ? "amber" : "green"} title={simulated ? "Made from the city" : "The real agent did this"}>{simulated ? "Practice case" : "Live"}</Badge>
                  {overlay?.end?.nextAction && (
                    <span className="min-w-0 truncate text-white/60" title={overlay.end.nextAction.message}>
                      To {overlay.end.nextAction.recipient}, by {overlay.end.nextAction.channel}
                    </span>
                  )}
                  {shownExec.status === "error" && <span className="min-w-0 truncate text-[#f87171]">{plainFailure(shownExec.error)}</span>}
                  {!shownExec.trace && shownExec.status !== "error" && <span className="text-white/45">No steps recorded</span>}
                  <span className="text-[11px] text-white/30">{shownExec.caseId}{shownExec.costUsd ? ` · ${cents(shownExec.costUsd)}` : ""}</span>
                  <span className="ml-auto flex items-center gap-1">
                    {shownExec.trace && <Btn onClick={() => setCursor(0)} title="Play it again"><Icon name="play" size={12} /> Play again</Btn>}
                    <Btn onClick={() => selectExecution(null)} title="Hide this case"><Icon name="close" size={12} /> Hide</Btn>
                  </span>
                </>
              )}
            </>
          )}
          {fallback && !execId && !running && (
            <span className="text-white/45">Showing the built-in playbook.</span>
          )}
        </div>
      )}

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        {paletteOpen && <Palette onAdd={addCentered} onClose={() => setPaletteOpen(false)} />}
        <div
          ref={wrapRef} className="wf-canvas relative min-w-0 flex-1"
          onDragOver={(e) => { if (e.dataTransfer.types.includes(DND_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } }}
          onDrop={onDrop}
        >
          <ReactFlow<CardNode, Edge>
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            colorMode="dark"
            onNodesChange={onNodesChange}
            onConnect={onConnect}
            onDelete={onDelete}
            onNodeDragStart={() => setHist((h) => {
              if (!h) return h;
              // Pin every card so moving one does not drop the rest back to the auto-layout.
              const c = checkpoint(h);
              return replace(c, { ...c.present, positions: { ...positionsRef.current, ...c.present.positions, [TREE_MARK]: { x: 1, y: 1 } } });
            })}
            onNodeClick={(_, n) => { if (!diffView) setSel({ kind: "node", id: nodeOf(n.id) }); }}
            onEdgeClick={(_, e) => { const k = edgeKeyOf(e.id); if (!diffView && k) setSel({ kind: "edge", key: k }); }}
            onPaneClick={() => setSel(null)}
            nodesConnectable={!diffView}
            deleteKeyCode={diffView ? null : ["Backspace", "Delete"]}
            defaultEdgeOptions={{ type: "default" }}
            connectionRadius={28}
            snapToGrid
            snapGrid={[GRID, GRID]}
            minZoom={0.08}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={GRID} size={1.4} color="#3b3b44" bgColor="#1f1f23" />
            <Panel position="bottom-left" className="!m-3"><ZoomBar /></Panel>
            {explained && (
              <Panel position="bottom-center" className="!mb-3">
                <div className="max-w-[560px] rounded-xl border border-white/10 bg-[#17171b]/92 px-4 py-3 text-[13px] text-white/85 shadow-xl backdrop-blur">
                  <div className="mb-1.5 flex items-center gap-2 text-[12px] font-semibold text-white">
                    <span>{nodeTitle(doc?.flow.nodes.find((n) => n.id === explained.nodeId) ?? { id: explained.nodeId, type: explained.nodeType as never, runs_on: [] })}</span>
                    <span className="font-normal text-white/45">how it decided</span>
                  </div>
                  <ul className="space-y-1">
                    {explained.detail.map((line, i) => <li key={i} className="leading-snug">{scrubLeaks(line)}</li>)}
                  </ul>
                </div>
              </Panel>
            )}
            <MiniMap
              position="bottom-right" pannable zoomable
              nodeColor={(n) => {
                const d = (n as CardNode).data;
                if (d?.run?.status === "ok") return "#22c55e";
                if (d?.run?.status === "error") return "#ef4444";
                return d ? metaFor(d.node.type).color : "#3a3a42";
              }}
              nodeBorderRadius={6}
              nodeStrokeWidth={0}
              maskStrokeColor="#ff6a1a"
              maskStrokeWidth={1.5}
              ariaLabel="Map of the playbook"
              style={{ width: 168, height: 110 }}
            />
          </ReactFlow>
          <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex items-start justify-between gap-3 px-3">
            <div className="pointer-events-auto flex overflow-hidden rounded-lg border border-white/10 bg-[#19191d]/90 shadow-lg backdrop-blur">
              <button type="button" onClick={() => goStart(400)} title="Back to the first step, readable" className="px-3 py-1.5 text-[12.5px] font-medium text-white/80 hover:bg-white/[0.07] hover:text-white">
                Start
              </button>
              <button type="button" onClick={showAll} title="Fit the whole playbook on screen (F)" className="border-l border-white/10 px-3 py-1.5 text-[12.5px] font-medium text-white/80 hover:bg-white/[0.07] hover:text-white">
                Show all
              </button>
              {tally && !execId && !diffView && !reveal && (
                <button
                  type="button" onClick={() => setShowCounts((v) => !v)} aria-pressed={showCounts}
                  title={`How many of the last ${tally.runs} cases passed through each step`}
                  className={`border-l border-white/10 px-3 py-1.5 text-[12.5px] font-medium hover:bg-white/[0.07] ${showCounts ? "bg-rv-green/10 text-[#9be8c4]" : "text-white/80 hover:text-white"}`}
                >
                  Case counts
                </button>
              )}
            </div>
            <div className="pointer-events-auto ml-auto flex items-start gap-2">
            {draftSafety && (
              <div
                className={`pointer-events-auto flex items-center gap-2 rounded-lg border px-3.5 py-2 text-[14px] font-semibold shadow-lg backdrop-blur ${draftSafety.everyPath ? "border-[#22c55e]/40 bg-[#0f2417]/90 text-[#4ade80]" : "border-[#f59e0b]/40 bg-[#2a1f0c]/90 text-[#fcd34d]"}`}
                role="status"
              >
                <Icon name={draftSafety.everyPath ? "check" : "shield"} size={15} strokeWidth={draftSafety.everyPath ? 3 : 2} />
                {safetyLine(draftSafety)}
              </div>
            )}
            <Button
              size="sm" icon={<IconCity size={15} />} className="shadow-lg"
              title="See this playbook at work in the 3D city"
              onClick={() => {
                const id = draft ? null : currentId;
                window.location.assign(id ? `/city?playbook=${encodeURIComponent(id)}` : "/city");
              }}
            >
              Open the city
            </Button>
            </div>
          </div>
        </div>
        <div className={drawer && !(selNode || selEdge) ? "flex h-full w-[380px] shrink-0 flex-col border-l border-white/10 bg-[#19191d]" : "hidden"}>
          <div className="flex shrink-0 gap-1 border-b border-white/10 px-2 pt-1.5">
            {([["ai", "New playbook"], ["test", "Practice"]] as const).map(([k, label]) => (
              <button
                key={k} type="button" onClick={() => openDrawer(k)}
                className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-2.5 pb-1.5 pt-1 text-[12px] font-medium ${drawer === k ? "border-[#ff6a1a] text-white" : "border-transparent text-white/50 hover:text-white/80"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {mounted.ai && (
            <div className={drawer === "ai" ? "flex min-h-0 flex-1" : "hidden"}>
              <ArchitectPanel
                draft={draft ? { description: draft.description, revealing: !!reveal, placed: reveal ? { count: reveal.count, total: reveal.order.length } : null } : null}
                onDraft={startDraft}
                onAccept={() => void doSave()}
                onDiscard={discardDraft}
                accepting={accepting || save.state === "saving"}
                onClose={() => openDrawer(null)}
              />
            </div>
          )}
          {mounted.test && (
            <div className={drawer === "test" ? "flex min-h-0 flex-1" : "hidden"}>
              <TestPanel
                key={current?.id ?? "none"}
                workflowId={draft ? null : current?.id ?? null}
                blocked={draft ? "Accept & save the AI draft before testing it." : null}
                hint={dirty ? "The canvas has unsaved edits. Tests run the selected saved version, not the canvas." : null}
                selectedExecId={execId}
                onShowExecution={(id) => { if (id) setDiffView(null); selectExecution(id); }}
                onProposal={showProposal}
                onLoadVersion={loadVersion}
                onMakeCurrent={makeCurrent}
                versionsTick={versionsTick}
                initialSet={practiceAsk?.set ?? null}
                initialFilter={practiceAsk?.filter ?? null}
                onClose={() => openDrawer(null)}
              />
            </div>
          )}
        </div>
        {selNode && (
          <NodePanel
            key={selNode.id}
            node={selNode}
            overlay={overlay}
            flow={doc.flow}
            tally={tally?.nodes[selNode.id]}
            runs={tally?.runs ?? 0}
            runName={shownExec?.caseId ?? null}
            onChange={(patch) => commit((d) => updateNode(d, selNode.id, patch), `node:${selNode.id}:${Object.keys(patch).join(",")}`)}
            onDelete={() => { commit((d) => removeNodes(d, [selNode.id])); setSel(null); }}
            onClose={() => setSel(null)}
          />
        )}
        {selEdge && sel?.kind === "edge" && (
          <EdgePanel
            key={sel.key}
            edge={selEdge}
            onWhen={(w) => {
              if ((selEdge.when ?? "") === w.trim()) return;
              const next = { from: selEdge.from, to: selEdge.to, ...(w.trim() ? { when: w.trim() } : {}) };
              commit((d) => updateEdgeWhen(d, sel.key, w));
              setSel({ kind: "edge", key: edgeKey(next) });
            }}
            onDelete={() => { commit((d) => removeEdges(d, [sel.key])); setSel(null); }}
            onClose={() => setSel(null)}
          />
        )}
      </div>

      {dialog && <ExecuteDialog followup={dialog === "reply"} onRun={(c) => void runCase(c, dialog === "reply")} onClose={() => setDialog(null)} />}
    </div>
  );
}

export default function WorkflowEditor() {
  return (
    <ReactFlowProvider>
      <EditorInner />
    </ReactFlowProvider>
  );
}
