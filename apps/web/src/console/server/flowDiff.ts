// Human-readable change list between two versions of a flow (nodes, edges, gate thresholds, rules).
import type { Flow, FlowEdge, FlowNode } from "../types";

const fmt = (v: unknown) => (typeof v === "number" ? String(v) : JSON.stringify(v));
const edgeKey = (e: FlowEdge) => `${e.from}->${e.to}`;
const edgeLabel = (e: FlowEdge) => `${e.from} → ${e.to}${e.when ? ` [${e.when}]` : ""}`;

type Rule = { at_least?: unknown; effect?: unknown; note?: unknown };
const rulesOf = (n: FlowNode) => ((n.config?.rules ?? {}) as Record<string, Rule>);

function configChanges(a: FlowNode, b: FlowNode): string[] {
  const out: string[] = [];
  const ca = a.config ?? {};
  const cb = b.config ?? {};
  for (const k of ["allow_below", "block_above"]) {
    if (fmt(ca[k]) !== fmt(cb[k])) {
      if (ca[k] === undefined) out.push(`${b.id}: ${k} set to ${fmt(cb[k])}`);
      else if (cb[k] === undefined) out.push(`${b.id}: ${k} removed (was ${fmt(ca[k])})`);
      else out.push(`${b.id}: ${k} ${fmt(ca[k])} → ${fmt(cb[k])}`);
    }
  }
  const ra = rulesOf(a);
  const rb = rulesOf(b);
  for (const q of Object.keys(rb)) {
    if (!(q in ra)) out.push(`${b.id}: rule ${q} added (at_least ${fmt(rb[q].at_least)}, ${fmt(rb[q].effect)})`);
    else {
      if (fmt(ra[q].at_least) !== fmt(rb[q].at_least)) out.push(`${b.id}: rule ${q} at_least ${fmt(ra[q].at_least)} → ${fmt(rb[q].at_least)}`);
      if (fmt(ra[q].effect) !== fmt(rb[q].effect)) out.push(`${b.id}: rule ${q} effect ${fmt(ra[q].effect)} → ${fmt(rb[q].effect)}`);
      if (fmt(ra[q].note) !== fmt(rb[q].note)) out.push(`${b.id}: rule ${q} note reworded`);
    }
  }
  for (const q of Object.keys(ra)) if (!(q in rb)) out.push(`${b.id}: rule ${q} removed`);
  const other = (c: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.entries(c).filter(([k]) => !["allow_below", "block_above", "rules"].includes(k)).sort()));
  if (other(ca) !== other(cb)) out.push(`${b.id}: other config changed`);
  return out;
}

export function diffFlows(before: Pick<Flow, "nodes" | "edges">, after: Pick<Flow, "nodes" | "edges">): string[] {
  const out: string[] = [];
  const A = new Map(before.nodes.map((n) => [n.id, n]));
  const B = new Map(after.nodes.map((n) => [n.id, n]));
  for (const n of after.nodes) if (!A.has(n.id)) out.push(`Node added: ${n.id} (${n.type})`);
  for (const n of before.nodes) if (!B.has(n.id)) out.push(`Node removed: ${n.id} (${n.type})`);
  for (const b of after.nodes) {
    const a = A.get(b.id);
    if (!a) continue;
    if (a.type !== b.type) out.push(`${b.id}: type ${a.type} → ${b.type}`);
    if ([...a.runs_on].sort().join(",") !== [...b.runs_on].sort().join(",")) out.push(`${b.id}: runs on ${a.runs_on.join("+")} → ${b.runs_on.join("+")}`);
    out.push(...configChanges(a, b));
  }
  const EA = new Map(before.edges.map((e) => [edgeKey(e), e]));
  const EB = new Map(after.edges.map((e) => [edgeKey(e), e]));
  for (const [k, e] of EB) {
    const old = EA.get(k);
    if (!old) out.push(`Edge added: ${edgeLabel(e)}`);
    else if ((old.when ?? "") !== (e.when ?? "")) out.push(`Edge ${e.from} → ${e.to}: branch ${old.when ?? "(none)"} → ${e.when ?? "(none)"}`);
  }
  for (const [k, e] of EA) if (!EB.has(k)) out.push(`Edge removed: ${edgeLabel(e)}`);
  const branchesBefore = new Set(before.edges.filter((e) => e.when).map((e) => e.from));
  const newBranchPoints = [...new Set(after.edges.filter((e) => e.when).map((e) => e.from))].filter((id) => !branchesBefore.has(id));
  if (newBranchPoints.length) out.push(`New decision points: ${newBranchPoints.join(", ")}`);
  return out;
}
