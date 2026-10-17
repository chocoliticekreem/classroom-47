import type { RoadEdge, RoadNode, RoadNetwork, XZ } from "./types";

/** Heights (metres) of every drawn surface, shared by roads, pavements and whoever stands on them. */
export const ROAD_Y = 0.3;
export const PAVEMENT_Y = 0.45;
export const PATH_Y = 0.42;

export const PAVE_W = 2.8;
export const KERB_W = 0.3;
/** Lateral distance from the road edge to the pedestrian line on a pavement. */
export const WALK_OFF = 1.4;
export const PATH_W = 1.8;

const TAU = Math.PI * 2;
const CORNER_STEPS = 6;

export function polyCum(pts: XZ[]): number[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  return cum;
}

/** Index of the segment containing `dist` (binary search over cumulative lengths). */
export function segmentAt(cum: number[], dist: number): number {
  let lo = 0;
  let hi = cum.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid] <= dist) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function pointAt(pts: XZ[], cum: number[], dist: number): XZ {
  const s = segmentAt(cum, dist);
  const len = cum[s + 1] - cum[s] || 1;
  const t = Math.min(1, Math.max(0, (dist - cum[s]) / len));
  return [pts[s][0] + (pts[s + 1][0] - pts[s][0]) * t, pts[s][1] + (pts[s + 1][1] - pts[s][1]) * t];
}

/** Points of `pts` between cumulative distances s0 and s1 (both ends interpolated). */
export function subPolyline(pts: XZ[], cum: number[], s0: number, s1: number): XZ[] {
  const out: XZ[] = [pointAt(pts, cum, s0)];
  for (let i = 1; i < pts.length - 1; i++) if (cum[i] > s0 + 0.05 && cum[i] < s1 - 0.05) out.push(pts[i]);
  out.push(pointAt(pts, cum, s1));
  return out;
}

/**
 * Offset a polyline sideways by `d` metres (positive = left of travel, negative = right). One output
 * point per input point, mitred at the bends with a limited miter so sharp corners don't spike.
 */
export function offsetPolyline(pts: XZ[], d: number): XZ[] {
  const n = pts.length;
  const nx: number[] = [];
  const nz: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0];
    const dz = pts[i + 1][1] - pts[i][1];
    const l = Math.hypot(dx, dz) || 1;
    nx.push(dz / l);
    nz.push(-dx / l);
  }
  const out: XZ[] = [];
  for (let i = 0; i < n; i++) {
    let ax: number;
    let az: number;
    let scale = 1;
    if (i === 0) {
      ax = nx[0];
      az = nz[0];
    } else if (i === n - 1) {
      ax = nx[n - 2];
      az = nz[n - 2];
    } else {
      const mx = nx[i - 1] + nx[i];
      const mz = nz[i - 1] + nz[i];
      const ml = Math.hypot(mx, mz);
      if (ml < 1e-6) {
        ax = nx[i];
        az = nz[i];
      } else {
        ax = mx / ml;
        az = mz / ml;
        scale = 1 / Math.max(0.55, ax * nx[i] + az * nz[i]);
      }
    }
    out.push([pts[i][0] + ax * d * scale, pts[i][1] + az * d * scale]);
  }
  return out;
}

/** Drop offset points that fold back against the original direction (inside of a tight bend). Keeps both ends. */
export function despike(off: XZ[], orig: XZ[]): XZ[] {
  const out: XZ[] = [off[0]];
  let last = 0;
  for (let i = 1; i < off.length; i++) {
    const dot =
      (off[i][0] - off[last][0]) * (orig[i][0] - orig[last][0]) +
      (off[i][1] - off[last][1]) * (orig[i][1] - orig[last][1]);
    if (dot > 0 || i === off.length - 1) {
      out.push(off[i]);
      last = i;
    }
  }
  return out;
}

export interface EdgeStrip {
  /** Centre line with the junction mouths cut away. */
  pts: XZ[];
  cum: number[];
  length: number;
  /** Carriageway edges (left/right of travel from → to). */
  leftIn: XZ[];
  rightIn: XZ[];
  /** Outer boundary of the pavement on each side. */
  leftOut: XZ[];
  rightOut: XZ[];
}

export interface JunctionItem {
  edge: number;
  atStart: boolean;
  /** Direction away from the node, atan2(dz, dx). Increasing = clockwise seen from above. */
  theta: number;
  /** Zebra crossing across this edge's mouth. */
  crossing: boolean;
  /** Where the carriageway and pavement corners sit, seen looking away from the node. */
  ccwIn: XZ;
  cwIn: XZ;
  ccwOut: XZ;
  cwOut: XZ;
  dir: XZ;
}

export interface Corner {
  inner: XZ[];
  outer: XZ[];
  /** True when the corner has a kerb to draw along `inner`. */
  kerb: boolean;
}

export interface Layout {
  strips: (EdgeStrip | null)[];
  /** Per node, incident edges sorted clockwise. */
  items: JunctionItem[][];
  /** Asphalt polygon around every junction or sharp bend (fan around the node). */
  patches: { node: number; poly: XZ[] }[];
  corners: Corner[];
  /** Footway ids of OSM pedestrian paths (filled in by buildNetwork). */
  pathIds: number[];
}

const layouts = new WeakMap<object, Layout>();

export function layoutOf(net: RoadNetwork): Layout {
  const found = layouts.get(net);
  if (found) return found;
  const made = computeLayout(net.nodes, net.edges);
  layouts.set(net, made);
  return made;
}

export function registerLayout(net: RoadNetwork, layout: Layout) {
  layouts.set(net, layout);
}

function outwardDir(edge: RoadEdge, atStart: boolean): XZ {
  const node = atStart ? edge.pts[0] : edge.pts[edge.pts.length - 1];
  const n = edge.pts.length;
  for (let k = 1; k < n; k++) {
    const p = atStart ? edge.pts[k] : edge.pts[n - 1 - k];
    const dx = p[0] - node[0];
    const dz = p[1] - node[1];
    const l = Math.hypot(dx, dz);
    if (l >= 1.5 || k === n - 1) return l > 0 ? [dx / l, dz / l] : [1, 0];
  }
  return [1, 0];
}

function cornerPath(P: XZ, Q: XZ, node: XZ, dA: XZ, dB: XZ, gap: number): XZ[] {
  const out: XZ[] = [];
  const steps = CORNER_STEPS;
  if (Math.abs(gap - Math.PI) >= 0.12 && gap < Math.PI) {
    const det = dB[0] * dA[1] - dA[0] * dB[1];
    if (Math.abs(det) > 0.15) {
      const qx = Q[0] - P[0];
      const qz = Q[1] - P[1];
      const s = (dB[0] * qz - qx * dB[1]) / det;
      const kx = P[0] + s * dA[0];
      const kz = P[1] + s * dA[1];
      if (Math.hypot(kx - node[0], kz - node[1]) < 40) {
        for (let i = 0; i <= steps; i++) {
          const u = i / steps;
          const a = (1 - u) * (1 - u);
          const b = 2 * u * (1 - u);
          const c = u * u;
          out.push([a * P[0] + b * kx + c * Q[0], a * P[1] + b * kz + c * Q[1]]);
        }
        return out;
      }
    }
  } else if (gap > Math.PI + 0.12) {
    const aP = Math.atan2(P[1] - node[1], P[0] - node[0]);
    const aQ = Math.atan2(Q[1] - node[1], Q[0] - node[0]);
    const sweep = (((aQ - aP) % TAU) + TAU) % TAU;
    const rP = Math.hypot(P[0] - node[0], P[1] - node[1]);
    const rQ = Math.hypot(Q[0] - node[0], Q[1] - node[1]);
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const a = aP + sweep * u;
      const r = rP + (rQ - rP) * u;
      out.push([node[0] + Math.cos(a) * r, node[1] + Math.sin(a) * r]);
    }
    return out;
  }
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    out.push([P[0] + (Q[0] - P[0]) * u, P[1] + (Q[1] - P[1]) * u]);
  }
  return out;
}

function stripOf(edge: RoadEdge, tStart: number, tEnd: number): EdgeStrip | null {
  const s0 = tStart;
  const s1 = edge.length - tEnd;
  if (s1 - s0 < 0.3) return null;
  const pts = subPolyline(edge.pts, edge.cum, s0, s1);
  const half = edge.width / 2;
  return {
    pts,
    cum: polyCum(pts),
    length: s1 - s0,
    leftIn: offsetPolyline(pts, half),
    rightIn: offsetPolyline(pts, -half),
    leftOut: offsetPolyline(pts, half + PAVE_W),
    rightOut: offsetPolyline(pts, -(half + PAVE_W)),
  };
}

function hash01(a: number, b: number): number {
  let h = Math.imul(a + 374761393, 668265263) ^ Math.imul(b + 2246822519, 3266489917);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function computeLayout(nodes: RoadNode[], edges: RoadEdge[]): Layout {
  const raw: { node: RoadNode; edge: RoadEdge; atStart: boolean; dir: XZ; theta: number }[][] = nodes.map(() => []);
  for (const edge of edges) {
    raw[edge.from].push({ node: nodes[edge.from], edge, atStart: true, dir: outwardDir(edge, true), theta: 0 });
    raw[edge.to].push({ node: nodes[edge.to], edge, atStart: false, dir: outwardDir(edge, false), theta: 0 });
  }

  const trimStart = new Array<number>(edges.length).fill(0);
  const trimEnd = new Array<number>(edges.length).fill(0);
  const nodeTrim = new Array<number>(nodes.length).fill(0);

  raw.forEach((list, nodeId) => {
    for (const it of list) it.theta = Math.atan2(it.dir[1], it.dir[0]);
    list.sort((a, b) => a.theta - b.theta);
    const n = list.length;
    if (n < 2) return;
    let minGap = TAU;
    for (let i = 0; i < n; i++) {
      const next = list[(i + 1) % n];
      let g = next.theta - list[i].theta;
      if (g <= 0) g += TAU;
      minGap = Math.min(minGap, g);
    }
    const maxW = Math.max(...list.map((l) => l.edge.width));
    let t = 0;
    if (n >= 3) t = maxW / 2 + 1.6;
    else if (minGap < 2.6) t = maxW / 2 + 1;
    nodeTrim[nodeId] = t;
    if (t === 0) return;
    for (const it of list) {
      if (it.atStart) trimStart[it.edge.id] = t;
      else trimEnd[it.edge.id] = t;
    }
  });

  edges.forEach((edge, i) => {
    const sum = trimStart[i] + trimEnd[i];
    if (sum > edge.length * 0.85) {
      const k = (edge.length * 0.85) / sum;
      trimStart[i] *= k;
      trimEnd[i] *= k;
    }
  });

  const strips = edges.map((edge, i) => stripOf(edge, trimStart[i], trimEnd[i]));
  const items: JunctionItem[][] = nodes.map(() => []);
  const patches: Layout["patches"] = [];
  const corners: Corner[] = [];

  raw.forEach((list, nodeId) => {
    const node = nodes[nodeId];
    const here: JunctionItem[] = [];
    for (const it of list) {
      const strip = strips[it.edge.id];
      if (!strip) continue;
      const last = strip.pts.length - 1;
      const k = it.atStart ? 0 : last;
      const crossing =
        nodeTrim[nodeId] > 0 &&
        list.length >= 3 &&
        it.edge.length > nodeTrim[nodeId] * 2 + 8 &&
        hash01(nodeId, it.edge.id) < 0.55;
      here.push({
        edge: it.edge.id,
        atStart: it.atStart,
        theta: it.theta,
        crossing,
        ccwIn: it.atStart ? strip.leftIn[k] : strip.rightIn[k],
        cwIn: it.atStart ? strip.rightIn[k] : strip.leftIn[k],
        ccwOut: it.atStart ? strip.leftOut[k] : strip.rightOut[k],
        cwOut: it.atStart ? strip.rightOut[k] : strip.leftOut[k],
        dir: it.dir,
      });
    }
    items[nodeId] = here;
    if (here.length < 2) return;

    const poly: XZ[] = [];
    const np: XZ = [node.x, node.z];
    let minGap = TAU;
    for (let i = 0; i < here.length; i++) {
      const a = here[i];
      const b = here[(i + 1) % here.length];
      let gap = b.theta - a.theta;
      if (gap <= 0) gap += TAU;
      minGap = Math.min(minGap, gap);
      poly.push(a.ccwIn, a.cwIn);
      const inner = cornerPath(a.cwIn, b.ccwIn, np, a.dir, b.dir, gap);
      for (let k = 1; k < inner.length - 1; k++) poly.push(inner[k]);
      const trimmed = nodeTrim[nodeId] > 0;
      if (trimmed || gap > Math.PI + 0.12) {
        const outer = cornerPath(a.cwOut, b.ccwOut, np, a.dir, b.dir, gap);
        const span =
          Math.hypot(a.cwIn[0] - b.ccwIn[0], a.cwIn[1] - b.ccwIn[1]) +
          Math.hypot(a.cwOut[0] - b.ccwOut[0], a.cwOut[1] - b.ccwOut[1]);
        if (span > 0.4) corners.push({ inner, outer, kerb: true });
      }
    }
    if (nodeTrim[nodeId] > 0 || minGap < 3.0) patches.push({ node: nodeId, poly });
  });

  return { strips, items, patches, corners, pathIds: [] };
}
