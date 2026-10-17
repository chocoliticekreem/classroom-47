// Pure helpers for the "Ask the Architect" builder: request bodies, the order a generated flow is
// revealed on the canvas, the step-by-step explanation, and mapping validation problems to nodes.
import type { Flow, FlowEdge } from "../types";
import { metaFor, nodeTitle, plainWhen } from "./nodeTypes";

export interface ArchitectUsage { model: string; latencyMs: number; tokensIn: number; tokensOut: number; costUsd: number }
export interface ArchitectResult { ok?: boolean; flow?: Flow; problems?: string[]; usage?: ArchitectUsage[]; error?: string }

export const EXAMPLE_PROMPTS = [
  "A residential parcel courier. Drivers sometimes reach a locked gate. Contact the verified recipient for intercom admission or meeting the driver; never request permanent access codes. If the recipient is unavailable, ask Dispatch for feasible alternatives matching their availability. Confirm handover from the driver's actual record. Build a granular incident workflow with missing-information and conflict checks, safe owner coordination, human authority checks and an unfamiliar-case fallback. Use only executable incident nodes, with concrete planner policies.",
  "Pharmacy courier, 40 drivers, controlled meds",
  "Frozen food, cold-chain vans",
  "Furniture two-person delivery and returns",
  "Same-day parcels, gig drivers",
];

/** The description sent to the Architect: the original brief, plus requested changes on a refine. */
export function architectDescription(description: string, followup?: string | null): string {
  const base = description.trim();
  const f = followup?.trim();
  return f ? `${base}\n\nChanges: ${f}` : base;
}

export function buildRequest(description: string, followup?: string | null): { description: string } {
  return { description: architectDescription(description, followup) };
}

export function validateRequest(flow: Flow): { flow: Flow } {
  return { flow };
}

/** Order nodes appear in: breadth-first from the entry (ingest, else nodes with no incoming edge),
 *  following edges in declared order; anything unreachable is appended in declared order. */
export function revealOrder(flow: Pick<Flow, "nodes" | "edges">): string[] {
  const ids = flow.nodes.map((n) => n.id);
  const known = new Set(ids);
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  const incoming = new Set<string>();
  for (const e of flow.edges) {
    if (!known.has(e.from) || !known.has(e.to) || e.from === e.to) continue;
    out.get(e.from)!.push(e.to);
    incoming.add(e.to);
  }
  const ingest = flow.nodes.filter((n) => n.type === "ingest").map((n) => n.id);
  const starts = ingest.length ? ingest : ids.filter((id) => !incoming.has(id));
  const seen = new Set<string>();
  const order: string[] = [];
  const queue = [...starts];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    for (const to of out.get(id)!) if (!seen.has(to)) queue.push(to);
  }
  for (const id of ids) if (!seen.has(id)) order.push(id);
  return order;
}

/** What is on the canvas after `count` reveal steps: the first `count` nodes and every edge
 *  whose two ends are both visible. */
export function revealFrame(flow: Pick<Flow, "nodes" | "edges">, order: string[], count: number): { nodes: Set<string>; edges: FlowEdge[] } {
  const nodes = new Set(order.slice(0, Math.max(0, count)));
  return { nodes, edges: flow.edges.filter((e) => nodes.has(e.from) && nodes.has(e.to)) };
}

export interface Step { id: string; type: string; label: string; role: string; branches: string[] }

/** One line per node, in reveal order, with the labelled exits (gate allow/ask/block). */
export function explainFlow(flow: Flow): Step[] {
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  return revealOrder(flow).map((id) => {
    const n = byId.get(id)!;
    const m = metaFor(n.type);
    const branches = flow.edges
      .filter((e) => e.from === id && e.when)
      .map((e) => `${plainWhen(e.when)} → ${byId.get(e.to) ? nodeTitle(byId.get(e.to)!) : e.to}`);
    return { id, type: n.type, label: nodeTitle(n), role: m.description, branches };
  });
}

export function usageTotals(usage: ArchitectUsage[] | undefined): { costUsd: number; latencyMs: number; calls: number; model: string | null } | null {
  if (!usage?.length) return null;
  return {
    costUsd: usage.reduce((s, u) => s + (u.costUsd || 0), 0),
    latencyMs: usage.reduce((s, u) => s + (u.latencyMs || 0), 0),
    calls: usage.length,
    model: usage[usage.length - 1].model ?? null,
  };
}

/** Problems that name a node, keyed by node id. Matches quoted ids ("gate"), arrows
 *  (a -> b), and comma lists after "unreachable from the start:". Others stay flow-level. */
export function problemsByNode(problems: string[], flow: Pick<Flow, "nodes">): { byNode: Record<string, string[]>; general: string[] } {
  const ids = new Set(flow.nodes.map((n) => n.id));
  const byNode: Record<string, string[]> = {};
  const general: string[] = [];
  for (const p of problems) {
    const hit = new Set<string>();
    for (const m of p.matchAll(/"([^"]+)"/g)) if (ids.has(m[1])) hit.add(m[1]);
    const tail = /unreachable from the start:\s*(.+)$/i.exec(p)?.[1];
    if (tail) for (const t of tail.split(",")) if (ids.has(t.trim())) hit.add(t.trim());
    if (/->/.test(p)) for (const t of p.replace(/^[^:]*:\s*/, "").split(/\s*->\s*|\s+/)) if (ids.has(t)) hit.add(t);
    if (hit.size) for (const id of hit) (byNode[id] ??= []).push(p);
    else general.push(p);
  }
  return { byNode, general };
}

/** Workflow id and name from a business description. */
export function slugify(text: string, taken: Iterable<string> = [], suffix = ""): string {
  const base = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").split("-").slice(0, 5).join("-") || "flow";
  const set = new Set(taken);
  const stem = suffix ? `${base}-${suffix}` : base;
  if (!set.has(stem)) return stem;
  for (let i = 2; ; i++) if (!set.has(`${stem}-${i}`)) return `${stem}-${i}`;
}

export function nameFrom(description: string): string {
  const first = description.trim().split(/\n/)[0].replace(/\s+/g, " ");
  const short = first.length > 48 ? `${first.slice(0, 47).replace(/[\s,;.]+\S*$/, "")}…` : first;
  return short ? short[0].toUpperCase() + short.slice(1) : "AI-built flow";
}

export interface SafetySummary {
  /** Steps in the playbook. */
  steps: number;
  /** Safety-check steps. */
  gates: number;
  /** Every way from the start to a step that sends (or, with no sending step, to an end) passes a safety check. */
  everyPath: boolean;
}

/** Does every path through the flow pass a safety check before it acts? Walks from the start
 *  without entering safety checks; reaching a sending step (or an end, if nothing sends) means
 *  some path skips the check. Retry loops are ignored. */
export function safetySummary(flow: Pick<Flow, "nodes" | "edges">): SafetySummary {
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  const edges = flow.edges.filter((e) => byId.has(e.from) && byId.has(e.to) && e.from !== e.to && e.when?.toLowerCase() !== "retry");
  const out = new Map<string, string[]>();
  const incoming = new Set<string>();
  for (const e of edges) { out.set(e.from, [...(out.get(e.from) ?? []), e.to]); incoming.add(e.to); }
  const gates = flow.nodes.filter((n) => n.type === "safety_gate").length;
  const isGate = (id: string) => byId.get(id)?.type === "safety_gate";
  const senders = flow.nodes.filter((n) => n.type === "action").map((n) => n.id);
  const targets = new Set(senders.length ? senders : flow.nodes.filter((n) => !out.get(n.id)?.length).map((n) => n.id));
  const ingest = flow.nodes.filter((n) => n.type === "ingest").map((n) => n.id);
  const starts = ingest.length ? ingest : flow.nodes.filter((n) => !incoming.has(n.id)).map((n) => n.id);
  const seen = new Set<string>();
  const queue = starts.filter((id) => !isGate(id));
  let skips = false;
  while (queue.length && !skips) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    if (targets.has(id)) skips = true;
    for (const to of out.get(id) ?? []) if (!isGate(to) && !seen.has(to)) queue.push(to);
  }
  return { steps: flow.nodes.length, gates, everyPath: flow.nodes.length > 0 && gates > 0 && !skips };
}

/** The result banner line: "11 steps · checks safety on every path". */
export function safetyLine(s: SafetySummary): string {
  const steps = `${s.steps} step${s.steps === 1 ? "" : "s"}`;
  if (s.everyPath) return `${steps} · checks safety on every path`;
  if (!s.gates) return `${steps} · no safety check`;
  return `${steps} · some paths skip the safety check`;
}
