// A truck's route as a dense lane polyline: left-hand lane offsets, filleted junction corners, an optional
// "tail" of where the rig has just been (so the trailer can trail behind the cab), arc-length sampling,
// curvature, and the mapping back to road-graph edges for the registry. Pure (no three.js).
import { edgeKey, getEdge, getNode, lanePosition } from "../../roads";

export interface Route {
  nodes: string[];
  xs: number[];
  zs: number[];
  cum: number[];
  /** Signed curvature at each vertex (1/m, + = turning left). */
  kappa: number[];
  /** Arc length at which path edge i (nodes[i] -> nodes[i+1]) starts; edgeS[nodes.length - 1] = end. */
  edgeS: number[];
  /** Arc length where the path proper begins (after the tail / join). */
  start: number;
  /** Arc length of the rig's position when the route was built (end of the tail). */
  here: number;
  length: number;
}

export interface Pose {
  x: number;
  z: number;
  h: number; // rotation about y, 0 = facing +z
}

export const MAX_FILLET = 9;
const TAIL_LEN = 26;

function lane(a: string, b: string, t: number): [number, number] {
  const p = lanePosition(a, b, t);
  return [p[0], p[1]];
}

function len(a: string, b: string) {
  const e = getEdge(a, b);
  if (e) return e.length;
  const na = getNode(a);
  const nb = getNode(b);
  return Math.hypot(nb.x - na.x, nb.z - na.z);
}

function pushBezier(
  xs: number[], zs: number[], x0: number, z0: number, x1: number, z1: number, x2: number, z2: number, x3: number, z3: number, n: number,
) {
  for (let i = 1; i <= n; i++) {
    const u = i / n;
    const v = 1 - u;
    xs.push(v * v * v * x0 + 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u * x3);
    zs.push(v * v * v * z0 + 3 * v * v * u * z1 + 3 * v * u * u * z2 + u * u * u * z3);
  }
}

/**
 * Build a route along `path` (>= 2 nodes), starting `t0` of the way along its first edge.
 * `tail`: the last stretch the rig drove (oldest first, ending at its current position), joined smoothly
 * (a U-turn if the path doubles back). Without a tail, a straight run-up behind the start is synthesised.
 */
export function buildRoute(path: readonly string[], t0 = 0, tail?: { xs: number[]; zs: number[] }): Route {
  const xs: number[] = [];
  const zs: number[] = [];
  const [sx, sz] = lane(path[0], path[1], t0);
  const n0 = getNode(path[0]);
  const n1 = getNode(path[1]);
  const l0 = Math.hypot(n1.x - n0.x, n1.z - n0.z) || 1;
  const dx0 = (n1.x - n0.x) / l0;
  const dz0 = (n1.z - n0.z) / l0;

  if (tail && tail.xs.length >= 2) {
    for (let i = 0; i < tail.xs.length; i++) {
      xs.push(tail.xs[i]);
      zs.push(tail.zs[i]);
    }
    const k = tail.xs.length - 1;
    const tx = tail.xs[k];
    const tz = tail.zs[k];
    let hx = tx - tail.xs[k - 1];
    let hz = tz - tail.zs[k - 1];
    const hl = Math.hypot(hx, hz) || 1;
    hx /= hl;
    hz /= hl;
    const gap = Math.hypot(sx - tx, sz - tz);
    const dot = hx * dx0 + hz * dz0;
    if (dot < -0.3) {
      // U-turn: swing out ahead and come back on the other lane
      const reach = 7;
      pushBezier(xs, zs, tx, tz, tx + hx * reach, tz + hz * reach, sx - dx0 * reach, sz - dz0 * reach, sx, sz, 14);
    } else if (gap > 0.3) {
      const k2 = Math.min(8, Math.max(1.5, gap * 0.45));
      pushBezier(xs, zs, tx, tz, tx + hx * k2, tz + hz * k2, sx - dx0 * k2, sz - dz0 * k2, sx, sz, 6);
    }
  } else {
    for (let d = TAIL_LEN; d > 0; d -= 6.5) {
      xs.push(sx - dx0 * d);
      zs.push(sz - dz0 * d);
    }
    xs.push(sx);
    zs.push(sz);
  }
  const startIdx = xs.length - 1;
  const hereIdx = tail && tail.xs.length >= 2 ? tail.xs.length - 1 : startIdx;

  // corners
  const cornerMid: number[] = []; // vertex index at the middle of each internal node's corner
  for (let i = 1; i < path.length - 1; i++) {
    const a = path[i - 1];
    const b = path[i];
    const c = path[i + 1];
    const l1 = len(a, b);
    const l2 = len(b, c);
    const na = getNode(a);
    const nb = getNode(b);
    const nc = getNode(c);
    const d1x = (nb.x - na.x) / l1;
    const d1z = (nb.z - na.z) / l1;
    const d2x = (nc.x - nb.x) / l2;
    const d2z = (nc.z - nb.z) / l2;
    const dot = d1x * d2x + d1z * d2z;
    // the fillet must start before the inner lane lines cross (2 m offset): R >= 2 tan(theta/2) + 1
    const theta = Math.acos(Math.max(-1, Math.min(1, dot)));
    const need = dot < -0.5 ? 4 : 2 * Math.tan(theta / 2) + 1;
    const R = Math.min(Math.max(Math.min(MAX_FILLET, l1 * 0.42, l2 * 0.42), need), l1 * 0.49, l2 * 0.49);
    const [px, pz] = lane(a, b, 1 - R / l1);
    const [qx, qz] = lane(b, c, R / l2);
    xs.push(px);
    zs.push(pz);
    if (dot > 0.999) {
      cornerMid.push(xs.length - 1);
      xs.push(qx);
      zs.push(qz);
      continue;
    }
    // circular-arc cubic: control length = 4/3 tan(theta/4) / tan(theta/2) x tangent length,
    // tangent lengths measured to where the two lane lines meet
    let k1 = R * 0.55;
    let k2 = R * 0.55;
    const den = d1x * d2z - d1z * d2x;
    if (dot > -0.5 && Math.abs(den) > 1e-3) {
      const wx = qx - px;
      const wz = qz - pz;
      const ta = (wx * d2z - wz * d2x) / den; // p + d1 * ta = intersection
      const tb = (d1x * wz - d1z * wx) / den; // q - d2 * tb = intersection
      if (ta > 0.2 && tb > 0.2) {
        const f = ((4 / 3) * Math.tan(theta / 4)) / Math.tan(theta / 2);
        k1 = f * ta;
        k2 = f * tb;
      }
    } else if (dot <= -0.5) {
      k1 = R * 1.2;
      k2 = R * 1.2;
    }
    const n = dot < 0.3 ? 8 : 5;
    const before = xs.length - 1;
    pushBezier(xs, zs, px, pz, px + d1x * k1, pz + d1z * k1, qx - d2x * k2, qz - d2z * k2, qx, qz, n);
    cornerMid.push(before + Math.round(n / 2));
  }
  const [ex, ez] = lane(path[path.length - 2], path[path.length - 1], 1);
  xs.push(ex);
  zs.push(ez);

  // drop near-duplicate points (keep indices consistent by rebuilding)
  const cx: number[] = [xs[0]];
  const cz: number[] = [zs[0]];
  const remap: number[] = [0];
  for (let i = 1; i < xs.length; i++) {
    if (Math.hypot(xs[i] - cx[cx.length - 1], zs[i] - cz[cz.length - 1]) > 0.05) {
      cx.push(xs[i]);
      cz.push(zs[i]);
    }
    remap.push(cx.length - 1);
  }

  const cum: number[] = [0];
  for (let i = 1; i < cx.length; i++) cum.push(cum[i - 1] + Math.hypot(cx[i] - cx[i - 1], cz[i] - cz[i - 1]));
  // signed curvature from headings over a +-1.5 m window (robust to tiny segments), + = left turn
  const kappa: number[] = new Array(cx.length).fill(0);
  const W = 1.5;
  const total = cum[cum.length - 1];
  const at = (d: number, out: [number, number]) => {
    const c = Math.max(0, Math.min(total, d));
    let lo = 0;
    let hi = cum.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (cum[m] <= c) lo = m;
      else hi = m;
    }
    const u = (c - cum[lo]) / (cum[hi] - cum[lo] || 1);
    out[0] = cx[lo] + (cx[hi] - cx[lo]) * u;
    out[1] = cz[lo] + (cz[hi] - cz[lo]) * u;
    return out;
  };
  const A: [number, number] = [0, 0];
  const B: [number, number] = [0, 0];
  for (let i = 1; i < cx.length - 1; i++) {
    at(cum[i] - W, A);
    at(cum[i] + W, B);
    const ax = cx[i] - A[0];
    const az = cz[i] - A[1];
    const bx = B[0] - cx[i];
    const bz = B[1] - cz[i];
    const la = Math.hypot(ax, az);
    const lb = Math.hypot(bx, bz);
    if (la < 1e-3 || lb < 1e-3) continue;
    const ang = Math.atan2(ax * bz - az * bx, ax * bx + az * bz);
    kappa[i] = -ang / ((la + lb) / 2);
  }
  const start = cum[remap[startIdx]];
  const edgeS: number[] = [start];
  for (const m of cornerMid) edgeS.push(cum[remap[m]]);
  edgeS.push(cum[cum.length - 1]);
  return { nodes: [...path], xs: cx, zs: cz, cum, kappa, edgeS, start, here: cum[remap[hereIdx]], length: cum[cum.length - 1] };
}

/** Vertex index i with cum[i] <= s < cum[i+1] (clamped). */
export function segIndex(r: Route, s: number) {
  const c = r.cum;
  if (s <= 0) return 0;
  if (s >= c[c.length - 1]) return c.length - 2;
  let lo = 0;
  let hi = c.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (c[m] <= s) lo = m;
    else hi = m;
  }
  return lo;
}

/** Pose at arc length s (extrapolates straight past either end). */
export function poseAt(r: Route, s: number, out: Pose): Pose {
  const i = segIndex(r, s);
  const x0 = r.xs[i];
  const z0 = r.zs[i];
  const dx = r.xs[i + 1] - x0;
  const dz = r.zs[i + 1] - z0;
  const l = r.cum[i + 1] - r.cum[i] || 1;
  const u = (s - r.cum[i]) / l;
  out.x = x0 + dx * u;
  out.z = z0 + dz * u;
  out.h = Math.atan2(dx, dz);
  return out;
}

/** Curvature at arc length s (linear between vertices). */
export function kappaAt(r: Route, s: number) {
  const i = segIndex(r, s);
  const l = r.cum[i + 1] - r.cum[i] || 1;
  const d = s - r.cum[i];
  if (l > 3) {
    // a long segment is straight: only its ends carry the neighbouring bends
    if (d < 1.5) return r.kappa[i];
    if (l - d < 1.5) return r.kappa[i + 1];
    return 0;
  }
  const u = Math.min(1, Math.max(0, d / l));
  return r.kappa[i] * (1 - u) + r.kappa[i + 1] * u;
}

/** Path edge index for arc length s, and t along it (0..1). */
export function edgeAt(r: Route, s: number): { i: number; t: number } {
  const e = r.edgeS;
  const last = r.nodes.length - 2;
  let i = 0;
  while (i < last && s >= e[i + 1]) i++;
  const span = e[i + 1] - e[i] || 1;
  return { i, t: Math.min(1, Math.max(0, (s - e[i]) / span)) };
}

export function routeEdgeKey(r: Route, i: number) {
  return edgeKey(r.nodes[i], r.nodes[i + 1]);
}

/** The last `back` metres of the route up to s (oldest first), for the next route's tail. */
export function tailOf(r: Route, s: number, back = TAIL_LEN): { xs: number[]; zs: number[] } {
  const xs: number[] = [];
  const zs: number[] = [];
  const p: Pose = { x: 0, z: 0, h: 0 };
  const s0 = s - back;
  const steps = 8;
  for (let k = 0; k <= steps; k++) {
    poseAt(r, s0 + ((s - s0) * k) / steps, p);
    xs.push(p.x);
    zs.push(p.z);
  }
  return { xs, zs };
}
