// Trace -> execution overlay: per-node status, latency, cost, model calls, and the path taken.
// The runtime only emits `edge` events at branches, so linear hops are inferred from the order
// nodes started in, but only where the flow actually has that edge.
import type { Flow, Trace } from "../types";
import type { TraceEvent } from "../../../../api/src/lib/trace";

export type NodeRunStatus = "running" | "ok" | "error" | "skipped";

export type ModelCallEvent = Extract<TraceEvent, { kind: "model_call" }>;
type NodeEndEvent = Extract<TraceEvent, { kind: "node_end" }>;
type RunStartEvent = Extract<TraceEvent, { kind: "run_start" }>;
type RunEndEvent = Extract<TraceEvent, { kind: "run_end" }>;

export interface NodeRun {
  nodeId: string;
  nodeType: string;
  status: NodeRunStatus;
  /** How many times the node started in this run (n8n's "items"). */
  runs: number;
  order: number; // 0-based position in the order nodes first started
  startT: number;
  endT: number | null;
  latencyMs: number;
  costUsd: number;
  summary: string | null;
  /** How the step reached its result, in a few plain lines (node_end.detail). Empty for older runs. */
  detail: string[];
  output: NodeEndEvent["output"] | null;
  modelCalls: ModelCallEvent[];
}

export interface TakenEdge {
  from: string;
  to: string;
  when?: string;
  inferred: boolean;
}

export interface RunOverlay {
  nodes: Record<string, NodeRun>;
  edges: TakenEdge[];
  /** `from->to` keys of taken edges. */
  taken: Set<string>;
  start: RunStartEvent | null;
  end: RunEndEvent | null;
  finished: boolean;
}

export const pairKey = (from: string, to: string) => `${from}->${to}`;

/** Build the overlay from the first `upto` events (all when omitted), for live replays. */
export function buildOverlay(trace: Trace, flow?: Pick<Flow, "edges"> | null, upto?: number): RunOverlay {
  const events = upto === undefined ? trace.events : trace.events.slice(0, Math.max(0, upto));
  const nodes: Record<string, NodeRun> = {};
  const edges: TakenEdge[] = [];
  const taken = new Set<string>();
  const flowEdges = new Set((flow?.edges ?? []).map((e) => pairKey(e.from, e.to)));
  let start: RunStartEvent | null = null;
  let end: RunEndEvent | null = null;
  let order = 0;
  let prevStarted: string | null = null;

  const addEdge = (from: string, to: string, when: string | undefined, inferred: boolean) => {
    const k = pairKey(from, to);
    if (taken.has(k)) return;
    taken.add(k);
    edges.push(when ? { from, to, when, inferred } : { from, to, inferred });
  };
  const ensure = (nodeId: string, nodeType: string, t: number): NodeRun => {
    let n = nodes[nodeId];
    if (!n) {
      n = nodes[nodeId] = {
        nodeId, nodeType, status: "running", runs: 0, order: order++, startT: t, endT: null,
        latencyMs: 0, costUsd: 0, summary: null, detail: [], output: null, modelCalls: [],
      };
    }
    return n;
  };

  for (const ev of events) {
    switch (ev.kind) {
      case "run_start":
        start = ev;
        break;
      case "node_start": {
        const n = ensure(ev.nodeId, ev.nodeType, ev.t);
        n.runs += 1;
        n.status = "running";
        if (prevStarted && prevStarted !== ev.nodeId && flowEdges.has(pairKey(prevStarted, ev.nodeId))) {
          addEdge(prevStarted, ev.nodeId, undefined, true);
        }
        prevStarted = ev.nodeId;
        break;
      }
      case "model_call": {
        const n = ensure(ev.nodeId, nodes[ev.nodeId]?.nodeType ?? "", ev.t);
        n.modelCalls.push(ev);
        break;
      }
      case "node_end": {
        const n = ensure(ev.nodeId, nodes[ev.nodeId]?.nodeType ?? "", ev.t);
        if (n.runs === 0) n.runs = 1;
        n.status = ev.status;
        n.endT = ev.t;
        n.latencyMs += ev.latencyMs;
        n.costUsd += ev.costUsd;
        n.summary = ev.summary;
        n.detail = ev.detail ?? [];
        n.output = ev.output ?? null;
        break;
      }
      case "edge":
        addEdge(ev.from, ev.to, ev.when, false);
        // An explicit edge supersedes the inferred hop from whatever started last.
        prevStarted = ev.from;
        break;
      case "run_end":
        end = ev;
        for (const n of Object.values(nodes)) {
          if (n.status === "running") n.status = ev.outcome === "error" || ev.error ? "error" : "ok";
        }
        break;
    }
  }
  // An explicit edge event recorded after the hop was already inferred keeps its `when` label.
  for (const ev of events) {
    if (ev.kind !== "edge" || !ev.when) continue;
    const e = edges.find((x) => x.from === ev.from && x.to === ev.to);
    if (e && !e.when) { e.when = ev.when; e.inferred = false; }
  }
  return { nodes, edges, taken, start, end, finished: end !== null };
}

/** Upstream nodes that fed `nodeId` in this run (for the Input tab). */
export function inputsOf(overlay: RunOverlay, nodeId: string): NodeRun[] {
  return overlay.edges
    .filter((e) => e.to === nodeId && overlay.nodes[e.from])
    .map((e) => overlay.nodes[e.from]);
}

/** Delays (ms) between successive events for a live replay squeezed into about `targetMs`.
 *  Each gap keeps its relative length but is clamped to [minGap, maxGap]. */
export function replayDelays(trace: Trace, targetMs = 5000, minGap = 60, maxGap = 900): number[] {
  const ev = trace.events;
  if (ev.length < 2) return ev.map(() => 0);
  const total = Math.max(1, ev[ev.length - 1].t - ev[0].t);
  const scale = targetMs / total;
  return ev.map((e, i) => (i === 0 ? 0 : Math.min(maxGap, Math.max(minGap, (e.t - ev[i - 1].t) * scale))));
}

export function fmtMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "–";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}

export function fmtUsd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "–";
  if (v === 0) return "$0";
  return v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(3)}`;
}
