// Camera and highlight helpers for the playbook canvas: open at a zoom where card text is readable,
// starting from the first step, and the path from the start to the selected step.
import type { Pos } from "./doc";
import { CARD_W, cardHeight, type DisplayTree } from "./layout";

/** Zoom at which card titles read comfortably. */
export const READ_ZOOM = 0.85;
/** Gap between the canvas edge and the start card when the playbook does not fit. */
export const START_MARGIN = 56;

export interface Viewport { x: number; y: number; zoom: number }

/** Bounding box of every drawn card. */
export function bounds(t: DisplayTree, pos: Record<string, Pos>): { x: number; y: number; w: number; h: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const d of t.nodes) {
    const p = pos[d.id];
    if (!p) continue;
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x + CARD_W);
    y1 = Math.max(y1, p.y + cardHeight(d.node.type));
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The viewport a playbook opens at. If the whole tree fits at the reading zoom it is centred;
 *  otherwise the start step sits at the left edge, vertically centred, so the next steps follow it. */
export function startViewport(
  t: DisplayTree, pos: Record<string, Pos>, size: { width: number; height: number }, zoom = READ_ZOOM,
): Viewport | null {
  const start = t.roots[0];
  const sp = start ? pos[start] : undefined;
  const b = bounds(t, pos);
  if (!sp || !b || size.width <= 0 || size.height <= 0) return null;
  const pad = START_MARGIN * 2;
  if (b.w * zoom + pad <= size.width && b.h * zoom + pad <= size.height) {
    return { x: size.width / 2 - (b.x + b.w / 2) * zoom, y: size.height / 2 - (b.y + b.h / 2) * zoom, zoom };
  }
  const cy = sp.y + cardHeight(t.byId.get(start)!.node.type) / 2;
  return { x: START_MARGIN - sp.x * zoom, y: size.height / 2 - cy * zoom, zoom };
}

/** Display nodes and edges on the way from the start to every drawn copy of `nodeId`. */
export function pathTo(t: DisplayTree, nodeId: string | null): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set<string>();
  const edges = new Set<string>();
  if (!nodeId) return { nodes, edges };
  const parent = new Map(t.edges.map((e) => [e.target, e]));
  for (const d of t.nodes) {
    if (d.nodeId !== nodeId) continue;
    let id: string | undefined = d.id;
    while (id && !nodes.has(id)) {
      nodes.add(id);
      const e = parent.get(id);
      if (!e) break;
      edges.add(e.id);
      id = e.source;
    }
  }
  return { nodes, edges };
}

/** Centre of a display node's card, for following it with the camera. */
export function cardCentre(t: DisplayTree, pos: Record<string, Pos>, displayId: string): Pos | null {
  const p = pos[displayId];
  const d = t.byId.get(displayId);
  if (!p || !d) return null;
  return { x: p.x + CARD_W / 2, y: p.y + cardHeight(d.node.type) / 2 };
}

/** Canvas keyboard shortcuts (n8n-like): F fits everything, 1 goes to 100%, Esc deselects. */
export type CanvasKey = "fit" | "zoom100" | "deselect";

export function canvasKey(e: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean }): CanvasKey | null {
  if (e.key === "Escape") return "deselect";
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  if (e.key === "f" || e.key === "F") return "fit";
  if (e.key === "1" && !e.shiftKey) return "zoom100";
  return null;
}

/** Snap grid for dragging cards; matches the dotted background gap. */
export const GRID = 20;
