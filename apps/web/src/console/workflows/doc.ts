// The editor's document: a Flow plus canvas positions. Pure edit operations used by the canvas,
// palette and detail panel so they can be tested without React.
import type { Flow, FlowEdge, FlowNode, NodeType } from "../types";
import { GATE_OUTPUTS, metaFor } from "./nodeTypes";

export type Pos = { x: number; y: number };
export interface FlowDoc {
  flow: Flow;
  positions: Record<string, Pos>;
}

export const edgeKey = (e: { from: string; to: string; when?: string }) =>
  `${e.from}->${e.to}${e.when ? `:${e.when}` : ""}`;

/** The source handle an edge leaves from: a gate's named output, or the default one. */
export function sourceHandleFor(flow: Flow, e: FlowEdge): string {
  const src = flow.nodes.find((n) => n.id === e.from);
  const outs = src ? metaFor(src.type).outputs : undefined;
  if (!outs) return "out";
  // A multi-output node has no plain "out" handle; an unlabelled edge leaves from its first output.
  return e.when && outs.includes(e.when) ? e.when : outs[0];
}

export function uniqueNodeId(type: NodeType, taken: Iterable<string>): string {
  const set = new Set(taken);
  const base = type === "safety_gate" ? "gate" : type === "history_lookup" ? "history" : type;
  if (!set.has(base)) return base;
  for (let i = 2; ; i++) if (!set.has(`${base}_${i}`)) return `${base}_${i}`;
}

export function addNode(doc: FlowDoc, type: NodeType, pos: Pos): { doc: FlowDoc; id: string } {
  const meta = metaFor(type);
  const id = uniqueNodeId(type, doc.flow.nodes.map((n) => n.id));
  const node: FlowNode = { id, type, runs_on: [...meta.runners] };
  if (meta.defaultConfig) node.config = structuredClone(meta.defaultConfig);
  return {
    id,
    doc: { flow: { ...doc.flow, nodes: [...doc.flow.nodes, node] }, positions: { ...doc.positions, [id]: pos } },
  };
}

export function removeNodes(doc: FlowDoc, ids: string[]): FlowDoc {
  if (!ids.length) return doc;
  const kill = new Set(ids);
  const positions = { ...doc.positions };
  for (const id of ids) delete positions[id];
  return {
    flow: {
      ...doc.flow,
      nodes: doc.flow.nodes.filter((n) => !kill.has(n.id)),
      edges: doc.flow.edges.filter((e) => !kill.has(e.from) && !kill.has(e.to)),
    },
    positions,
  };
}

export function removeEdges(doc: FlowDoc, keys: string[]): FlowDoc {
  if (!keys.length) return doc;
  const kill = new Set(keys);
  return { ...doc, flow: { ...doc.flow, edges: doc.flow.edges.filter((e) => !kill.has(edgeKey(e))) } };
}

/** Connect two nodes. A named source handle (gate allow/ask/block) becomes the edge's `when`.
 *  Returns the doc unchanged for self-loops or duplicates. */
export function connect(doc: FlowDoc, from: string, to: string, handle?: string | null): FlowDoc {
  if (from === to) return doc;
  const when = handle && handle !== "out" ? handle : undefined;
  const edge: FlowEdge = when ? { from, to, when } : { from, to };
  if (doc.flow.edges.some((e) => edgeKey(e) === edgeKey(edge))) return doc;
  // A gate output feeds exactly one target: reconnecting replaces it.
  const edges = when && (GATE_OUTPUTS as readonly string[]).includes(when)
    ? doc.flow.edges.filter((e) => !(e.from === from && e.when === when))
    : doc.flow.edges;
  return { ...doc, flow: { ...doc.flow, edges: [...edges, edge] } };
}

export function updateNode(doc: FlowDoc, id: string, patch: Partial<Omit<FlowNode, "id">>): FlowDoc {
  return {
    ...doc,
    flow: { ...doc.flow, nodes: doc.flow.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) },
  };
}

export function updateEdgeWhen(doc: FlowDoc, key: string, when: string): FlowDoc {
  return {
    ...doc,
    flow: {
      ...doc.flow,
      edges: doc.flow.edges.map((e) => {
        if (edgeKey(e) !== key) return e;
        const w = when.trim();
        return w ? { from: e.from, to: e.to, when: w } : { from: e.from, to: e.to };
      }),
    },
  };
}

export function moveNodes(doc: FlowDoc, moves: Record<string, Pos>): FlowDoc {
  return { ...doc, positions: { ...doc.positions, ...moves } };
}

/** Stable serialisation for the dirty check. */
export function docSignature(doc: FlowDoc): string {
  const pos: Record<string, Pos> = {};
  for (const id of Object.keys(doc.positions).sort()) {
    const p = doc.positions[id];
    pos[id] = { x: Math.round(p.x), y: Math.round(p.y) };
  }
  return JSON.stringify({ flow: doc.flow, pos });
}
