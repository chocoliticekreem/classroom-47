// Pure route geometry for fleet vehicles: turns a node path into a smooth drivable curve
// (left-lane straights joined by cubic Bézier corners, optional off-lane manoeuvres at the
// start/end for bays and kerbside stops). Sampling is allocation-free.
import { getEdge, lanePosition } from "../../roads";

export interface Pose {
  x: number;
  z: number;
  heading: number; // rotation about y, 0 = facing +z
}

export const CORNER_R = 6; // metres before/after a junction where the corner curve starts/ends
export const TURN_SPEED = 5.5; // m/s through a turn
export const UTURN_SPEED = 3;
export const OFFLANE_SPEED = 4; // pulling in/out of bays and kerbs

export interface Seg {
  kind: "line" | "curve";
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  x3: number;
  z3: number;
  len: number;
  start: number; // route distance at the start of this segment
  edge: number; // index into route.edgeKeys, -1 when off-lane
  t0: number; // edge parameter (0..1) at segment start
  t1: number; // edge parameter at segment end
  vmax: number; // speed cap for this segment (Infinity = edge speed limit)
  lut: Float64Array | null; // curves: cumulative arc length at u = i / LUT_N, for uniform-speed sampling
}

const LUT_N = 16;

export interface Route {
  nodes: string[];
  edgeKeys: string[];
  edgeLens: number[];
  segs: Seg[];
  length: number;
  /** Route distance at which the corner into nodes[i] starts (the stop line). NaN where there's no corner. */
  stopLine: number[];
}

export interface BuildOpts {
  startAlong?: number; // metres along the first edge where lane driving starts
  startPose?: Pose; // if set, an off-lane curve leads from this pose to the lane at startAlong
  endAlong?: number; // metres along the last edge where lane driving ends
  endPose?: Pose; // if set, an off-lane curve leads from the lane at endAlong to this pose
  cornerR?: number;
}

export interface RouteSample {
  x: number;
  z: number;
  heading: number;
  seg: number; // segment index (also used as a search hint, keep it between calls)
  edge: number; // edge index or -1
  t: number; // edge parameter
}

export function newSample(): RouteSample {
  return { x: 0, z: 0, heading: 0, seg: 0, edge: -1, t: 0 };
}

function lanePoint(a: string, b: string, along: number, len: number): [number, number, number] {
  return lanePosition(a, b, len > 0 ? along / len : 0);
}

function lineSeg(p: [number, number, number], q: [number, number, number], edge: number, t0: number, t1: number): Seg {
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
  return {
    kind: "line",
    x0: p[0], z0: p[1], x1: p[0], z1: p[1], x2: q[0], z2: q[1], x3: q[0], z3: q[1],
    len, start: 0, edge, t0, t1, vmax: Infinity, lut: null,
  };
}

function cubicSeg(
  x0: number, z0: number, x1: number, z1: number, x2: number, z2: number, x3: number, z3: number,
  edge: number, t0: number, t1: number, vmax: number,
): Seg {
  const lut = new Float64Array(LUT_N + 1);
  const s: Seg = { kind: "curve", x0, z0, x1, z1, x2, z2, x3, z3, len: 0, start: 0, edge, t0, t1, vmax, lut };
  let len = 0;
  let px = x0;
  let pz = z0;
  const tmp = newSample();
  for (let i = 1; i <= LUT_N; i++) {
    evalSeg(s, i / LUT_N, tmp);
    len += Math.hypot(tmp.x - px, tmp.z - pz);
    lut[i] = len;
    px = tmp.x;
    pz = tmp.z;
  }
  s.len = Math.max(len, 0.01);
  return s;
}

/** Off-lane curve between a free pose and a lane point, leaving/arriving tangentially. */
function poseCurve(fx: number, fz: number, fh: number, tx: number, tz: number, th: number, edge: number, t: number) {
  const k = Math.hypot(tx - fx, tz - fz) / 3;
  return cubicSeg(
    fx, fz, fx + Math.sin(fh) * k, fz + Math.cos(fh) * k,
    tx - Math.sin(th) * k, tz - Math.cos(th) * k, tx, tz,
    edge, t, t, OFFLANE_SPEED,
  );
}

function evalSeg(s: Seg, u: number, out: { x: number; z: number; heading: number }) {
  if (s.kind === "line") {
    out.x = s.x0 + (s.x3 - s.x0) * u;
    out.z = s.z0 + (s.z3 - s.z0) * u;
    out.heading = Math.atan2(s.x3 - s.x0, s.z3 - s.z0);
    return;
  }
  const iu = 1 - u;
  const a = iu * iu * iu;
  const b = 3 * iu * iu * u;
  const c = 3 * iu * u * u;
  const d = u * u * u;
  out.x = a * s.x0 + b * s.x1 + c * s.x2 + d * s.x3;
  out.z = a * s.z0 + b * s.z1 + c * s.z2 + d * s.z3;
  const dx = 3 * iu * iu * (s.x1 - s.x0) + 6 * iu * u * (s.x2 - s.x1) + 3 * u * u * (s.x3 - s.x2);
  const dz = 3 * iu * iu * (s.z1 - s.z0) + 6 * iu * u * (s.z2 - s.z1) + 3 * u * u * (s.z3 - s.z2);
  out.heading = dx * dx + dz * dz > 1e-10 ? Math.atan2(dx, dz) : Math.atan2(s.x3 - s.x0, s.z3 - s.z0);
}

/** Build a drivable route along `nodes` (>= 2 nodes, consecutive nodes must be joined by an edge). */
export function buildRoute(nodes: string[], opts: BuildOpts = {}): Route {
  if (nodes.length < 2) throw new Error("route needs at least two nodes");
  const n = nodes.length;
  const ne = n - 1;
  const edgeKeys: string[] = [];
  const edgeLens: number[] = [];
  const dirs: [number, number][] = [];
  for (let i = 0; i < ne; i++) {
    const e = getEdge(nodes[i], nodes[i + 1]);
    if (!e) throw new Error(`no road between ${nodes[i]} and ${nodes[i + 1]}`);
    edgeKeys.push(e.key);
    edgeLens.push(e.length);
    const [, , h] = lanePosition(nodes[i], nodes[i + 1], 0);
    dirs.push([Math.sin(h), Math.cos(h)]);
  }
  const baseR = opts.cornerR ?? CORNER_R;
  // corner radius at node k (1..n-2)
  const R = (k: number) => Math.min(baseR, edgeLens[k - 1] / 3, edgeLens[k] / 3);
  const lineStart: number[] = [];
  const lineEnd: number[] = [];
  for (let i = 0; i < ne; i++) {
    let s = i === 0 ? 0 : R(i);
    let e = i === ne - 1 ? edgeLens[i] : edgeLens[i] - R(i + 1);
    if (i === 0) s = Math.max(0, Math.min(opts.startAlong ?? 0, e));
    if (i === ne - 1) e = Math.min(edgeLens[i], Math.max(opts.endAlong ?? edgeLens[i], s));
    lineStart.push(s);
    lineEnd.push(e);
  }

  const segs: Seg[] = [];
  const stopLine: number[] = new Array(n).fill(NaN);
  let dist = 0;
  const push = (s: Seg) => {
    s.start = dist;
    dist += s.len;
    segs.push(s);
  };

  if (opts.startPose) {
    const p = opts.startPose;
    const [qx, qz, qh] = lanePoint(nodes[0], nodes[1], lineStart[0], edgeLens[0]);
    push(poseCurve(p.x, p.z, p.heading, qx, qz, qh, -1, lineStart[0] / edgeLens[0]));
  }

  for (let i = 0; i < ne; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    const L = edgeLens[i];
    const p = lanePoint(a, b, lineStart[i], L);
    const q = lanePoint(a, b, lineEnd[i], L);
    const ls = lineSeg(p, q, i, lineStart[i] / L, lineEnd[i] / L);
    if (ls.len > 1e-3) push(ls);
    if (i < ne - 1) {
      // corner at node i+1
      stopLine[i + 1] = dist;
      const r = lanePoint(nodes[i + 1], nodes[i + 2], lineStart[i + 1], edgeLens[i + 1]);
      const [d1x, d1z] = dirs[i];
      const [d2x, d2z] = dirs[i + 1];
      const dot = d1x * d2x + d1z * d2z;
      const rad = R(i + 1);
      const k = rad * (1 / 3 + (1 - dot) / 3);
      const vmax = dot > 0.95 ? Infinity : dot < -0.7 ? UTURN_SPEED : TURN_SPEED;
      push(
        cubicSeg(
          q[0], q[1], q[0] + d1x * k, q[1] + d1z * k,
          r[0] - d2x * k, r[1] - d2z * k, r[0], r[1],
          i + 1, 0, lineStart[i + 1] / edgeLens[i + 1], vmax,
        ),
      );
    }
  }

  if (opts.endPose) {
    const p = opts.endPose;
    const last = ne - 1;
    const [qx, qz, qh] = lanePoint(nodes[last], nodes[last + 1], lineEnd[last], edgeLens[last]);
    push(poseCurve(qx, qz, qh, p.x, p.z, p.heading, -1, lineEnd[last] / edgeLens[last]));
  }

  return { nodes: [...nodes], edgeKeys, edgeLens, segs, length: dist, stopLine };
}

/** Position/heading at route distance `d`. Writes into `out`; uses out.seg as a search hint. */
export function sampleRoute(route: Route, d: number, out: RouteSample): RouteSample {
  const segs = route.segs;
  if (segs.length === 0) return out;
  const dd = Math.max(0, Math.min(d, route.length));
  let i = Math.min(Math.max(out.seg, 0), segs.length - 1);
  while (i > 0 && dd < segs[i].start) i--;
  while (i < segs.length - 1 && dd > segs[i].start + segs[i].len) i++;
  const s = segs[i];
  const local = dd - s.start;
  let u = s.len > 0 ? Math.max(0, Math.min(1, local / s.len)) : 1;
  if (s.lut && s.len > 0.01) {
    // invert the arc-length table so speed is uniform along the curve
    const lut = s.lut;
    let k = 1;
    while (k < LUT_N && lut[k] < local) k++;
    const a = lut[k - 1];
    const b = lut[k];
    u = Math.max(0, Math.min(1, (k - 1 + (b > a ? (local - a) / (b - a) : 0)) / LUT_N));
  }
  evalSeg(s, u, out);
  out.seg = i;
  out.edge = s.edge;
  out.t = s.t0 + (s.t1 - s.t0) * u;
  return out;
}

/** First blocked edge on the route at or after edge index `fromEdge`, or null. */
export function firstBlockedEdge(route: Route, fromEdge: number, blocked: ReadonlySet<string>): string | null {
  for (let i = Math.max(0, fromEdge); i < route.edgeKeys.length; i++) if (blocked.has(route.edgeKeys[i])) return route.edgeKeys[i];
  return null;
}

/** A pose `side` metres to the left of the left lane at `along` metres on a->b (pulled over at the kerb). */
export function kerbPose(a: string, b: string, along: number, side = 2.2): Pose {
  const e = getEdge(a, b);
  const len = e ? e.length : 1;
  const [x, z, h] = lanePosition(a, b, along / len);
  // left of travel direction (sin h, cos h) in three.js (y up) is (cos h, -sin h)
  return { x: x + Math.cos(h) * side, z: z - Math.sin(h) * side, heading: h };
}
