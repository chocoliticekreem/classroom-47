// Pure helpers for the Executions tab: list filtering, polling decision, formatting,
// and turning a Trace's flat event list into a timeline of node steps.
import { scrubLeaks } from "../../ui/plain";
import type { ExecutionRecord, Trace } from "../types";
import type { DecisionCard, NextAction, TraceEvent } from "../../../../api/src/lib/trace";

export type ExecutionSummary = Omit<ExecutionRecord, "trace" | "answerMd" | "reasoningMd">;
export type ExecStatus = ExecutionRecord["status"];

export interface ExecFilter {
  status: ExecStatus | "all";
  dataset: string | "all";
  q?: string;
}

export function filterExecutions<T extends ExecutionSummary>(rows: T[], f: ExecFilter): T[] {
  const q = (f.q ?? "").trim().toLowerCase();
  return rows.filter(
    (r) =>
      (f.status === "all" || r.status === f.status) &&
      (f.dataset === "all" || r.dataset === f.dataset) &&
      (!q || r.caseId.toLowerCase().includes(q) || (r.outcome ?? "").toLowerCase().includes(q)),
  );
}

// ---- List chips -----------------------------------------------------------------------

export type ResultChip = "all" | "sent" | "person" | "asked" | "stopped" | "failed";

export const RESULT_CHIPS: { id: ResultChip; label: string }[] = [
  { id: "all", label: "All" },
  { id: "sent", label: "Sent" },
  { id: "person", label: "Needs a person" },
  { id: "asked", label: "Asked" },
  { id: "stopped", label: "Stopped" },
  { id: "failed", label: "Didn't finish" },
];

/** Which result chip a run falls under (besides "All"); null for running and "nothing to do" runs. */
export function chipOf(e: { status: ExecStatus; outcome: string | null }): Exclude<ResultChip, "all"> | null {
  if (e.status === "running") return null;
  if (e.status === "error" || e.outcome === "error") return "failed";
  switch (e.outcome) {
    case "acted": return "sent";
    case "escalated": return "person";
    case "asked_for_info": return "asked";
    case "blocked": return "stopped";
    default: return null;
  }
}

export function chipCounts(rows: { status: ExecStatus; outcome: string | null }[]): Record<ResultChip, number> {
  const c: Record<ResultChip, number> = { all: rows.length, sent: 0, person: 0, asked: 0, stopped: 0, failed: 0 };
  for (const r of rows) {
    const k = chipOf(r);
    if (k) c[k]++;
  }
  return c;
}

export function matchesChip(e: { status: ExecStatus; outcome: string | null }, chip: ResultChip): boolean {
  return chip === "all" || chipOf(e) === chip;
}

/** Newest first; running ones float to the top. */
export function sortExecutions<T extends ExecutionSummary>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if ((a.status === "running") !== (b.status === "running")) return a.status === "running" ? -1 : 1;
    return b.startedAt.localeCompare(a.startedAt);
  });
}

export function datasetsOf(rows: { dataset: string }[]): string[] {
  return [...new Set(rows.map((r) => r.dataset))].sort();
}

export function anyRunning(rows: { status: ExecStatus }[]): boolean {
  return rows.some((r) => r.status === "running");
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "–";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)} s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s - m * 60)}s`;
}

export function fmtCost(usd: number | null | undefined): string {
  if (usd == null || !Number.isFinite(usd)) return "–";
  if (usd === 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(usd < 10 ? 3 : 2)}`;
}

export function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}

/** "3m ago", "2h ago", or a date for anything older than a day. */
export function fmtStarted(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const d = Math.max(0, now - t) / 1000;
  if (d < 45) return "just now";
  if (d < 3600) return `${Math.round(d / 60)}m ago`;
  if (d < 86400) return `${Math.round(d / 3600)}h ago`;
  return new Date(t).toISOString().slice(0, 16).replace("T", " ");
}

// ---- Timeline -------------------------------------------------------------------------

type Ev<K extends TraceEvent["kind"]> = Extract<TraceEvent, { kind: K }>;
export type ModelCall = Ev<"model_call">;

export interface GateInfo {
  risk: number;
  decision: "allow" | "ask" | "block";
  allowBelow: number;
  blockAbove: number;
}

export type TimelineItem =
  | { kind: "run_start"; t: number; title: string; inputs: Ev<"run_start">["inputs"] }
  | {
      kind: "node";
      t: number;
      nodeId: string;
      nodeType: string;
      status: "running" | "ok" | "error" | "skipped";
      summary: string | null;
      latencyMs: number | null;
      costUsd: number | null;
      calls: ModelCall[];
      output: Ev<"node_end">["output"] | null;
      gate: GateInfo | null;
      card: DecisionCard | null;
      action: { done: NextAction; ok: boolean } | null;
    }
  | { kind: "edge"; t: number; from: string; to: string; when: string | null }
  | {
      kind: "run_end";
      t: number;
      outcome: string;
      totalCostUsd: number;
      totalLatencyMs: number;
      nextAction: NextAction | null;
      error: string | null;
    };

type NodeItem = Extract<TimelineItem, { kind: "node" }>;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function gateOf(output: unknown): GateInfo | null {
  if (!output || typeof output !== "object") return null;
  const o = output as Record<string, unknown>;
  if (o.type !== "safety_gate") return null;
  const risk = num(o.risk), allowBelow = num(o.allowBelow), blockAbove = num(o.blockAbove);
  if (risk == null || allowBelow == null || blockAbove == null) return null;
  const d = o.decision;
  return { risk, allowBelow, blockAbove, decision: d === "allow" || d === "block" ? d : "ask" };
}

export function cardOf(output: unknown): DecisionCard | null {
  if (!output || typeof output !== "object") return null;
  const o = output as Record<string, unknown>;
  if (o.type !== "human_decision" || !o.card || typeof o.card !== "object") return null;
  const c = o.card as Partial<DecisionCard>;
  return {
    routeTo: String(c.routeTo ?? ""),
    summary: String(c.summary ?? ""),
    whyStopped: c.whyStopped && typeof c.whyStopped === "object" ? c.whyStopped : undefined,
    evidence: Array.isArray(c.evidence) ? c.evidence : undefined,
    alreadyDone: Array.isArray(c.alreadyDone) ? c.alreadyDone.map(String) : undefined,
    clash: c.clash,
    tried: Array.isArray(c.tried) ? c.tried.map(String) : [],
    options: Array.isArray(c.options) ? c.options : [],
    wouldChangeMyMind: String(c.wouldChangeMyMind ?? ""),
    deadlineMins: Number(c.deadlineMins ?? 0),
    fallback: String(c.fallback ?? ""),
    chosen: c.chosen,
  };
}

function actionOf(output: unknown): { done: NextAction; ok: boolean } | null {
  if (!output || typeof output !== "object") return null;
  const o = output as Record<string, unknown>;
  if (o.type !== "action" || !o.done || typeof o.done !== "object") return null;
  return { done: o.done as NextAction, ok: o.ok !== false };
}

/**
 * Fold the flat trace into timeline items: node_start opens a step, model_calls attach to the
 * open step for that node, node_end closes it. Edges and run start/end stay as their own items.
 */
export function buildTimeline(trace: Trace | null | undefined): TimelineItem[] {
  if (!trace?.events?.length) return [];
  const items: TimelineItem[] = [];
  const open = new Map<string, NodeItem>();
  const newNode = (t: number, nodeId: string, nodeType: string): NodeItem => ({
    kind: "node", t, nodeId, nodeType, status: "running", summary: null, latencyMs: null, costUsd: null,
    calls: [], output: null, gate: null, card: null, action: null,
  });
  for (const ev of trace.events) {
    switch (ev.kind) {
      case "run_start":
        items.push({ kind: "run_start", t: ev.t, title: ev.title, inputs: ev.inputs ?? [] });
        break;
      case "node_start": {
        const n = newNode(ev.t, ev.nodeId, ev.nodeType);
        open.set(ev.nodeId, n);
        items.push(n);
        break;
      }
      case "model_call": {
        let n = open.get(ev.nodeId);
        if (!n) {
          n = newNode(ev.t, ev.nodeId, ev.nodeId);
          open.set(ev.nodeId, n);
          items.push(n);
        }
        n.calls.push(ev);
        break;
      }
      case "node_end": {
        let n = open.get(ev.nodeId);
        if (!n) {
          n = newNode(ev.t - (ev.latencyMs ?? 0), ev.nodeId, ev.nodeId);
          items.push(n);
        }
        open.delete(ev.nodeId);
        n.status = ev.status;
        n.summary = ev.summary;
        n.latencyMs = ev.latencyMs;
        n.costUsd = ev.costUsd;
        n.output = ev.output ?? null;
        n.gate = gateOf(ev.output);
        n.card = cardOf(ev.output);
        n.action = actionOf(ev.output);
        break;
      }
      case "edge":
        items.push({ kind: "edge", t: ev.t, from: ev.from, to: ev.to, when: ev.when ?? null });
        break;
      case "run_end":
        items.push({
          kind: "run_end", t: ev.t, outcome: ev.outcome, totalCostUsd: ev.totalCostUsd,
          totalLatencyMs: ev.totalLatencyMs, nextAction: ev.nextAction ?? null, error: ev.error ?? null,
        });
        break;
    }
  }
  return items;
}

/** Positions (0..100 %) for drawing risk against the gate's thresholds on a 0..1 bar. */
export function gateBar(g: GateInfo): { risk: number; allow: number; block: number } {
  const pct = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 10;
  return { risk: pct(g.risk), allow: pct(g.allowBelow), block: pct(g.blockAbove) };
}

export function traceTotals(trace: Trace | null | undefined): { calls: number; tokensIn: number; tokensOut: number; costUsd: number } {
  const calls = (trace?.events ?? []).filter((e): e is ModelCall => e.kind === "model_call");
  return {
    calls: calls.length,
    tokensIn: calls.reduce((s, c) => s + (c.tokensIn || 0), 0),
    tokensOut: calls.reduce((s, c) => s + (c.tokensOut || 0), 0),
    costUsd: calls.reduce((s, c) => s + (c.costUsd || 0), 0),
  };
}

// ---- Decision card view model ----------------------------------------------------------

export type Tone = "muted" | "ok" | "err" | "warn" | "accent" | "info";
export type Basis = NonNullable<DecisionCard["evidence"]>[number]["basis"];

const STOP_REASON: Record<string, { label: string; tone: Tone }> = {
  rule_requires_person: { label: "Rule requires a person", tone: "info" },
  agent_judged_unsafe: { label: "Agent judged unsafe", tone: "warn" },
  message_too_risky: { label: "Message too risky", tone: "err" },
  delivery_failed: { label: "Delivery failed", tone: "err" },
  no_clear_action: { label: "No clear action", tone: "muted" },
};

export const BASIS: Record<Basis, { label: string; style: "solid" | "blue" | "dashed" }> = {
  system_record: { label: "system record", style: "solid" },
  owning_team_statement: { label: "owning team", style: "blue" },
  unverified_claim: { label: "unverified claim", style: "dashed" },
};

export interface CardView {
  /** Coloured reason chip + one line. Falls back to the summary (and clash) for older cards. */
  headline: { chip: { label: string; tone: Tone } | null; line: string };
  /** Shown under the headline when the headline came from whyStopped. */
  summary: string | null;
  clash: string | null;
  evidence: { who: string; says: string; basis: Basis; label: string; style: "solid" | "blue" | "dashed" }[];
  /** ✓ list: alreadyDone, or the older `tried` list. */
  done: { title: string; items: string[] };
  options: { id: string; label: string; effect: string | null; undoable: boolean; chosen: boolean }[];
}

export function cardView(card: DecisionCard): CardView {
  const ws = card.whyStopped;
  const reason = ws?.reason ? STOP_REASON[ws.reason] ?? { label: String(ws.reason).replaceAll("_", " "), tone: "muted" as Tone } : null;
  const hasWs = !!(ws && (ws.line || reason));
  const evidence = (card.evidence ?? [])
    .filter((e) => e && (e.says || e.who))
    .map((e) => {
      const b = BASIS[e.basis] ?? BASIS.unverified_claim;
      return { who: String(e.who ?? ""), says: String(e.says ?? ""), basis: (BASIS[e.basis] ? e.basis : "unverified_claim") as Basis, ...b };
    });
  const useDone = Array.isArray(card.alreadyDone);
  return {
    headline: { chip: hasWs ? reason : null, line: scrubLeaks(hasWs ? ws?.line || card.summary : card.summary) },
    summary: hasWs && card.summary && card.summary !== ws?.line ? scrubLeaks(card.summary) : null,
    clash: card.clash ? scrubLeaks(card.clash) : null,
    evidence,
    done: useDone ? { title: "Already done", items: card.alreadyDone!.map(scrubLeaks) } : { title: "Already tried", items: (card.tried ?? []).map(scrubLeaks) },
    options: (card.options ?? []).map((o) => ({
      id: o.id, label: scrubLeaks(o.label), effect: o.effect ? scrubLeaks(o.effect) : null, undoable: o.undoable !== false, chosen: card.chosen === o.id,
    })),
  };
}
