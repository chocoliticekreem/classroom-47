// Canvas layout: a display-time tree built from the flow ("unmerge"), laid out left -> right as a
// tidy tree (each subtree owns a vertical band, so cards never overlap and edges never cross), and
// orthogonal edge routes with per-handle trunks.
//
// Unmerge: the flow is a DAG with shared nodes (one case_log fed by many branches) and retry loops.
// For display, every incoming edge of a shared node gets its own copy of that node. The copy at the
// node's shallowest depth (first in DFS order, siblings sorted by `when`) keeps the real id and draws
// the node's onward steps; the other copies are stubs with id `${id}~${n}` and a "shared xN" chip. Retry edges and any edge that
// closes a cycle are not tree edges: they become a "retry" badge on their source. The saved flow is
// never changed; a copy maps back to its node through `nodeId`.
import type { Flow, FlowEdge, FlowNode } from "../types";
import type { Pos } from "./doc";
import { metaFor } from "./nodeTypes";

export const CARD_W = 240;
export const CARD_H = 76;
export const GATE_H = 104;
/** Room under a card for run / problem / diff badges. */
export const BADGE_H = 26;
/** Vertical gap between neighbouring bands. */
export const GAP_Y = 34;
/** Horizontal gap between ranks (beyond the card width): room for the trunk and a label pill. */
export const RANK_GAP = 170;
export const RANK_W = CARD_W + RANK_GAP;
/** Edge trunk distance from the source card, and the step between parallel trunks. */
export const TRUNK = 18;
export const TRUNK_STEP = 14;

const WHEN_ORDER = ["allow", "ask", "block", "ok", "approve", "proceed", "retry", "failed", "missing", "complete", "reject", "fallback"];

export function cardHeight(type: string): number {
  const outs = metaFor(type).outputs;
  return outs && outs.length > 1 ? GATE_H : CARD_H;
}

/** Source handle y offset (from the card top) for an output handle. */
export function handleOffset(type: string, handle: string): number {
  const outs = metaFor(type).outputs;
  const h = cardHeight(type);
  if (!outs || outs.length < 2) return h / 2;
  const i = Math.max(0, outs.indexOf(handle));
  return ((i + 1) / (outs.length + 1)) * h;
}

export function sourceHandleOf(node: FlowNode | undefined, e: FlowEdge): string {
  const outs = node ? metaFor(node.type).outputs : undefined;
  if (!outs) return "out";
  return e.when && outs.includes(e.when) ? e.when : outs[0];
}

export interface DisplayNode {
  id: string; // display id: the node id for the expanded copy, `${id}~${n}` for the others
  nodeId: string;
  node: FlowNode;
  depth: number;
  /** How many copies of this node the tree draws (its incoming tree edges). */
  occurrences: number;
  /** A copy whose onward steps are drawn at the expanded copy. */
  stub: boolean;
  /** Back edges (retry loops) leaving this node, not drawn as tree edges. */
  loops: FlowEdge[];
}

export interface DisplayEdge {
  id: string;
  source: string; // display ids
  target: string;
  edge: FlowEdge; // the flow edge it draws
  handle: string;
}

export interface DisplayTree {
  nodes: DisplayNode[];
  edges: DisplayEdge[];
  backEdges: FlowEdge[];
  roots: string[];
  byId: Map<string, DisplayNode>;
  children: Map<string, DisplayEdge[]>;
}

export function whenRank(e: FlowEdge, declared: number): number {
  const i = e.when ? WHEN_ORDER.indexOf(e.when.toLowerCase()) : -1;
  return i >= 0 ? i : 100 + declared;
}

export function unmerge(flow: Pick<Flow, "nodes" | "edges">): DisplayTree {
  const byNode = new Map(flow.nodes.map((n) => [n.id, n]));
  const ids = flow.nodes.map((n) => n.id);
  const valid = flow.edges
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => byNode.has(e.from) && byNode.has(e.to) && e.from !== e.to);

  const out = new Map<string, { e: FlowEdge; i: number }[]>(ids.map((id) => [id, []]));
  for (const x of valid) out.get(x.e.from)!.push(x);
  for (const list of out.values()) list.sort((a, b) => whenRank(a.e, a.i) - whenRank(b.e, b.i) || a.i - b.i);

  const incoming = new Set(valid.filter(({ e }) => e.when?.toLowerCase() !== "retry").map(({ e }) => e.to));
  const ingest = flow.nodes.filter((n) => n.type === "ingest").map((n) => n.id);
  const rootOrder = [...ingest, ...ids.filter((id) => !incoming.has(id) && !ingest.includes(id)), ...ids];

  // Back edges: retry, plus anything that closes a cycle in a DFS from the roots.
  const back = new Set<number>();
  for (const { e, i } of valid) if (e.when?.toLowerCase() === "retry") back.add(i);
  const state = new Map<string, 1 | 2>();
  for (const root of rootOrder) {
    if (state.has(root)) continue;
    const stack: { id: string; k: number }[] = [{ id: root, k: 0 }];
    state.set(root, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const list = out.get(top.id)!;
      if (top.k >= list.length) { state.set(top.id, 2); stack.pop(); continue; }
      const { e, i } = list[top.k++];
      if (back.has(i)) continue;
      if (state.get(e.to) === 1) back.add(i);
      else if (!state.has(e.to)) { state.set(e.to, 1); stack.push({ id: e.to, k: 0 }); }
    }
  }
  const tree = new Map<string, { e: FlowEdge; i: number }[]>(ids.map((id) => [id, out.get(id)!.filter((x) => !back.has(x.i))]));
  const indeg = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const list of tree.values()) for (const { e } of list) indeg.set(e.to, indeg.get(e.to)! + 1);

  // Each node is drawn in full at its shallowest occurrence; every other occurrence is a stub.
  const minDepth = new Map<string, number>();
  {
    const starts = [...ingest, ...ids.filter((id) => !incoming.has(id) && !ingest.includes(id))];
    const q = starts.filter((id, i) => starts.indexOf(id) === i);
    for (const id of q) minDepth.set(id, 0);
    for (let k = 0; k < q.length; k++) {
      for (const { e } of tree.get(q[k])!) {
        if (!minDepth.has(e.to)) { minDepth.set(e.to, minDepth.get(q[k])! + 1); q.push(e.to); }
      }
    }
  }

  const nodes: DisplayNode[] = [];
  const edges: DisplayEdge[] = [];
  const byId = new Map<string, DisplayNode>();
  const children = new Map<string, DisplayEdge[]>();
  const expanded = new Set<string>();
  const copies = new Map<string, number>();
  const roots: string[] = [];
  const backEdges = valid.filter(({ i }) => back.has(i)).map(({ e }) => e);
  const loopsOf = (id: string) => backEdges.filter((e) => e.from === id);

  const add = (nodeId: string, depth: number, stub: boolean): DisplayNode => {
    let id = nodeId;
    if (stub) {
      const n = (copies.get(nodeId) ?? 1) + 1;
      copies.set(nodeId, n);
      id = `${nodeId}~${n}`;
    }
    const d: DisplayNode = {
      id, nodeId, node: byNode.get(nodeId)!, depth, occurrences: Math.max(1, indeg.get(nodeId)!), stub, loops: stub ? [] : loopsOf(nodeId),
    };
    nodes.push(d);
    byId.set(id, d);
    children.set(id, []);
    return d;
  };
  // Iterative DFS so a long generated chain cannot overflow the stack.
  const expand = (rootId: string) => {
    expanded.add(rootId);
    const root = add(rootId, 0, false);
    roots.push(root.id);
    const stack: { d: DisplayNode; k: number }[] = [{ d: root, k: 0 }];
    while (stack.length) {
      const top = stack[stack.length - 1];
      const list = tree.get(top.d.nodeId)!;
      if (top.k >= list.length) { stack.pop(); continue; }
      const { e } = list[top.k++];
      const depth = top.d.depth + 1;
      const stub = expanded.has(e.to) || (minDepth.has(e.to) && depth > minDepth.get(e.to)!);
      if (!stub) expanded.add(e.to);
      const child = add(e.to, depth, stub);
      const de: DisplayEdge = { id: `${top.d.id}>${child.id}`, source: top.d.id, target: child.id, edge: e, handle: sourceHandleOf(top.d.node, e) };
      edges.push(de);
      children.get(top.d.id)!.push(de);
      if (!stub) stack.push({ d: child, k: 0 });
    }
  };
  for (const r of rootOrder) if (!expanded.has(r)) expand(r);
  return { nodes, edges, backEdges, roots, byId, children };
}

/** Tidy left -> right tree: each subtree owns a vertical band [top, top + size). A parent's card is
 *  centred between its first and last child's cards, clamped inside its own band. */
export function treeLayout(t: DisplayTree, origin: Pos = { x: 0, y: 0 }): Record<string, Pos> {
  const boxH = (d: DisplayNode) => cardHeight(d.node.type) + BADGE_H;
  const size = new Map<string, number>();
  // Post-order sizes (nodes were added in DFS pre-order, so reverse order visits children first).
  for (let i = t.nodes.length - 1; i >= 0; i--) {
    const d = t.nodes[i];
    const kids = t.children.get(d.id)!;
    const sum = kids.reduce((s, e) => s + size.get(e.target)!, 0);
    size.set(d.id, Math.max(boxH(d) + GAP_Y, sum));
  }
  const pos: Record<string, Pos> = {};
  const centre = new Map<string, number>(); // card centre y
  const place = (rootId: string, rootTop: number) => {
    // Pre-order: compute band tops; then post-order: centres.
    const top = new Map<string, number>([[rootId, rootTop]]);
    const order: string[] = [];
    const stack = [rootId];
    while (stack.length) {
      const id = stack.pop()!;
      order.push(id);
      const kids = t.children.get(id)!;
      const total = kids.reduce((s, e) => s + size.get(e.target)!, 0);
      let y = top.get(id)! + (size.get(id)! - total) / 2;
      for (const e of kids) { top.set(e.target, y); y += size.get(e.target)!; }
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i].target);
    }
    for (let i = order.length - 1; i >= 0; i--) {
      const id = order[i];
      const d = t.byId.get(id)!;
      const kids = t.children.get(id)!;
      const h = cardHeight(d.node.type);
      const bandTop = top.get(id)!;
      const s = size.get(id)!;
      let c = kids.length ? (centre.get(kids[0].target)! + centre.get(kids[kids.length - 1].target)!) / 2 : bandTop + s / 2;
      // Keep the whole box (card + badges) inside the band.
      const minTop = bandTop + GAP_Y / 2;
      const maxTop = bandTop + s - GAP_Y / 2 - boxH(d);
      const cardTop = Math.min(maxTop, Math.max(minTop, c - h / 2));
      c = cardTop + h / 2;
      centre.set(id, c);
      pos[id] = { x: origin.x + d.depth * RANK_W, y: cardTop };
    }
  };
  let y = origin.y;
  for (const r of t.roots) { place(r, y); y += size.get(r)!; }
  return pos;
}

export interface Route { sx: number; sy: number; tx: number; ty: number; trunkX: number }

/** Orthogonal route per display edge: out of the handle, along to a trunk, then into the target.
 *  Each output handle of a branching node gets its own trunk, ordered so routes cannot cross: for
 *  routes going down the lower handle's trunk is nearer; going up, the upper one's. */
export function edgeRoutes(t: DisplayTree, pos: Record<string, Pos>): Map<string, Route> {
  const res = new Map<string, Route>();
  for (const d of t.nodes) {
    const kids = t.children.get(d.id)!;
    if (!kids.length || !pos[d.id]) continue;
    const p = pos[d.id];
    const byHandle = new Map<string, DisplayEdge[]>();
    for (const e of kids) byHandle.set(e.handle, [...(byHandle.get(e.handle) ?? []), e]);
    const sx = p.x + CARD_W;
    const info = [...byHandle.entries()].map(([handle, es]) => {
      const sy = p.y + handleOffset(d.node.type, handle);
      const tys = es.filter((e) => pos[e.target]).map((e) => pos[e.target].y + cardHeight(t.byId.get(e.target)!.node.type) / 2);
      const mean = tys.length ? tys.reduce((a, b) => a + b, 0) / tys.length : sy;
      return { handle, es, sy, dir: mean > sy + 0.5 ? 1 : mean < sy - 0.5 ? -1 : 0 };
    });
    const down = info.filter((h) => h.dir > 0).sort((a, b) => b.sy - a.sy);
    const up = info.filter((h) => h.dir < 0).sort((a, b) => a.sy - b.sy);
    const slot = new Map<string, number>();
    down.forEach((h, i) => slot.set(h.handle, i));
    up.forEach((h, i) => slot.set(h.handle, i));
    for (const h of info) {
      const trunkX = sx + TRUNK + (slot.get(h.handle) ?? 0) * TRUNK_STEP;
      for (const e of h.es) {
        const tp = pos[e.target];
        if (!tp) continue;
        res.set(e.id, { sx, sy: h.sy, tx: tp.x, ty: tp.y + cardHeight(t.byId.get(e.target)!.node.type) / 2, trunkX });
      }
    }
  }
  return res;
}

/** Tree layout positions keyed by display id (the expanded copy of a node uses the node id). */
export function layoutFlow(flow: Pick<Flow, "nodes" | "edges">, origin: Pos = { x: 0, y: 0 }): Record<string, Pos> {
  return treeLayout(unmerge(flow), origin);
}

/** Marker stored in saved positions: they were arranged on the tree canvas and cover its copies. */
export const TREE_MARK = "~tree";

/** Saved positions are used only when they come from the tree canvas and cover every display node. */
export function usablePositions(t: DisplayTree, saved: Record<string, Pos> | undefined): Record<string, Pos> | null {
  if (!saved || !saved[TREE_MARK]) return null;
  return t.nodes.every((d) => saved[d.id]) ? saved : null;
}

/** Positions for every display node: usable saved ones, else the tidy tree. */
export function displayPositions(t: DisplayTree, saved: Record<string, Pos> | undefined): Record<string, Pos> {
  return usablePositions(t, saved) ?? treeLayout(t);
}

/** Positions to store after a tidy-up: the tree layout plus the marker. */
export function tidyPositions(flow: Pick<Flow, "nodes" | "edges">): Record<string, Pos> {
  return { ...layoutFlow(flow), [TREE_MARK]: { x: 1, y: 1 } };
}

/** @deprecated kept for older callers: tree layout, with any saved tree positions kept. */
export function withPositions(flow: Flow, saved: Record<string, Pos> | undefined): Record<string, Pos> {
  const t = unmerge(flow);
  return usablePositions(t, saved) ?? { ...treeLayout(t) };
}
