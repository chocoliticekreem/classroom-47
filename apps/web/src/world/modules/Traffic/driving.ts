// Pure driving logic for civilian traffic: car-following (IDM), path following with smooth
// junction curves, signal decisions, rerouting. No three.js, no React: unit-tested.
import { LANE_OFFSET } from "../../config";
import { ROAD_EDGES, ROAD_NODES, edgeKey, getEdge, getNode, neighbours, type RoadEdge, type RoadNode } from "../../roads";
import { fastPath } from "./pathfind";
import type { SignalColour } from "../../signals";

export interface Pose {
  x: number;
  z: number;
  h: number; // heading, rotation about y, 0 = facing +z
}

// --- Car following: Intelligent Driver Model -------------------------------------------------

export interface IdmParams {
  aMax: number; // comfortable acceleration m/s²
  bComf: number; // comfortable deceleration m/s²
  s0: number; // standstill gap m
  T: number; // time headway s
}

export const IDM: IdmParams = { aMax: 2.4, bComf: 3, s0: 2, T: 1.1 };
export const MAX_BRAKE = 9;

/**
 * Acceleration for speed `v` with desired speed `v0`, a bumper-to-bumper `gap` to the obstacle
 * ahead (Infinity when clear) closing at `closing` m/s (v - leaderSpeed).
 */
export function idmAccel(v: number, v0: number, gap: number, closing: number, p: IdmParams = IDM): number {
  const ratio = v / Math.max(v0, 0.1);
  // Above the limit (e.g. off the highway onto a street) slow down gently rather than slamming on.
  const free = Math.max(1 - ratio ** 4, -0.6);
  let a = p.aMax * free;
  if (Number.isFinite(gap)) {
    const sStar = p.s0 + Math.max(0, v * p.T + (v * closing) / (2 * Math.sqrt(p.aMax * p.bComf)));
    const g = Math.max(gap, 0.05);
    a -= p.aMax * (sStar / g) ** 2;
  }
  return Math.min(p.aMax, Math.max(-MAX_BRAKE, a));
}

// --- Path following ------------------------------------------------------------------------

export interface PathState {
  path: string[];
  idx: number; // current edge is path[idx] -> path[idx + 1]
  t: number; // 0..1 along it
}

// Nested from -> to -> edge cache: avoids building an edge-key string per lookup (hot path).
const EDGE_CACHE = new Map<string, Map<string, RoadEdge>>();
for (const e of ROAD_EDGES.values()) {
  for (const [x, y] of [[e.a, e.b], [e.b, e.a]]) {
    let m = EDGE_CACHE.get(x);
    if (!m) EDGE_CACHE.set(x, (m = new Map()));
    m.set(y, e);
  }
}

/** The road between a and b (either direction), without allocating. */
export function edgeOf(a: string, b: string): RoadEdge | undefined {
  return EDGE_CACHE.get(a)?.get(b) ?? getEdge(a, b);
}

export function edgeLen(a: string, b: string) {
  return Math.max(edgeOf(a, b)?.length ?? 1, 0.5);
}

/** Move `ds` metres along the path. Returns how many new edges were entered. Stops at the path end. */
export function advance(s: PathState, ds: number): number {
  let entered = 0;
  while (ds > 0) {
    const len = edgeLen(s.path[s.idx], s.path[s.idx + 1]);
    const rem = (1 - s.t) * len;
    if (ds < rem) {
      s.t += ds / len;
      break;
    }
    if (s.idx + 2 >= s.path.length) {
      s.t = 1;
      break;
    }
    ds -= rem;
    s.idx += 1;
    s.t = 0;
    entered += 1;
  }
  return entered;
}

export const TURN_R = 6; // metres before/after a node over which the turn is blended

function cornerR(a: string, b: string, c: string) {
  return Math.min(TURN_R, edgeLen(a, b) * 0.35, edgeLen(b, c) * 0.35);
}

const tmpA: [number, number, number] = [0, 0, 0];
/** Same maths as roads.lanePosition (left-hand lane), without allocating. */
function lane(a: string, b: string, t: number, out: [number, number, number]) {
  const na = getNode(a);
  const nb = getNode(b);
  const dx = nb.x - na.x;
  const dz = nb.z - na.z;
  const len = Math.hypot(dx, dz) || 1;
  out[0] = na.x + dx * t + (dz / len) * LANE_OFFSET;
  out[1] = na.z + dz * t - (dx / len) * LANE_OFFSET;
  out[2] = Math.atan2(dx, dz);
  return out;
}

/** Cubic Bézier through a junction a->b->c; u in 0..1 spans R metres before to R metres after b. */
function corner(a: string, b: string, c: string, u: number, out: Pose): Pose {
  const R = cornerR(a, b, c);
  const l1 = edgeLen(a, b);
  const l2 = edgeLen(b, c);
  const p0 = lane(a, b, 1 - R / l1, tmpA);
  const p0x = p0[0];
  const p0z = p0[1];
  const p3 = lane(b, c, R / l2, tmpA);
  const p3x = p3[0];
  const p3z = p3[1];
  const na = getNode(a);
  const nb = getNode(b);
  const nc = getNode(c);
  const d1x = (nb.x - na.x) / l1;
  const d1z = (nb.z - na.z) / l1;
  const d2x = (nc.x - nb.x) / l2;
  const d2z = (nc.z - nb.z) / l2;
  const dot = d1x * d2x + d1z * d2z;
  // Straight: 2/3 R keeps uniform speed; U-turn: a wider loop.
  const k = dot > 0.95 ? R / 1.5 : R * (0.55 + 0.45 * Math.max(0, -dot));
  bezier(p0x, p0z, p0x + d1x * k, p0z + d1z * k, p3x - d2x * k, p3z - d2z * k, p3x, p3z, u, out);
  return out;
}

function bezier(
  x0: number, z0: number, x1: number, z1: number, x2: number, z2: number, x3: number, z3: number,
  u: number, out: Pose,
) {
  const v = 1 - u;
  out.x = v * v * v * x0 + 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u * x3;
  out.z = v * v * v * z0 + 3 * v * v * u * z1 + 3 * v * u * u * z2 + u * u * u * z3;
  const dx = 3 * v * v * (x1 - x0) + 6 * v * u * (x2 - x1) + 3 * u * u * (x3 - x2);
  const dz = 3 * v * v * (z1 - z0) + 6 * v * u * (z2 - z1) + 3 * u * u * (z3 - z2);
  if (dx * dx + dz * dz > 1e-9) out.h = Math.atan2(dx, dz);
  return out;
}

/** World pose for a vehicle at (path, idx, t), on the left lane, with curves through junctions. */
export function poseAt(path: readonly string[], idx: number, t: number, out: Pose): Pose {
  const a = path[idx];
  const b = path[idx + 1];
  const len = edgeLen(a, b);
  const s = t * len;
  if (idx + 2 < path.length) {
    const R = cornerR(a, b, path[idx + 2]);
    if (s > len - R) return corner(a, b, path[idx + 2], (s - (len - R)) / (2 * R), out);
  }
  if (idx >= 1) {
    const R = cornerR(path[idx - 1], a, b);
    if (s < R) return corner(path[idx - 1], a, b, 0.5 + s / (2 * R), out);
  }
  const p = lane(a, b, t, tmpA);
  out.x = p[0];
  out.z = p[1];
  out.h = p[2];
  return out;
}

/** +1 for a left turn at b, -1 for right, 0 for (roughly) straight or a U-turn. */
export function turnSide(a: string, b: string, c: string): -1 | 0 | 1 {
  const na = getNode(a);
  const nb = getNode(b);
  const nc = getNode(c);
  const l1 = Math.hypot(nb.x - na.x, nb.z - na.z) || 1;
  const l2 = Math.hypot(nc.x - nb.x, nc.z - nb.z) || 1;
  const d1x = (nb.x - na.x) / l1;
  const d1z = (nb.z - na.z) / l1;
  const d2x = (nc.x - nb.x) / l2;
  const d2z = (nc.z - nb.z) / l2;
  if (d1x * d2x + d1z * d2z < -0.9) return 0;
  // left of travel direction (dx, dz) is (dz, -dx)
  const side = d2x * d1z - d2z * d1x;
  return side > 0.35 ? 1 : side < -0.35 ? -1 : 0;
}

/** Where three or more roads meet (worth indicating at). */
export function isJunction(id: string) {
  return neighbours(id).length >= 3;
}

const LAT_ACCEL = 5; // m/s², comfortable-ish cornering for a stylised city

/** Safe speed through the corner a->b->c: from the blend curve's radius, capped at `limit`. */
export function turnSpeed(a: string, b: string, c: string, limit: number): number {
  if (c === a) return 3;
  const na = getNode(a);
  const nb = getNode(b);
  const nc = getNode(c);
  const h1 = Math.atan2(nb.x - na.x, nb.z - na.z);
  const h2 = Math.atan2(nc.x - nb.x, nc.z - nb.z);
  const theta = Math.abs(Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1)));
  if (theta < 0.12) return limit;
  const r = cornerR(a, b, c) / Math.tan(Math.min(theta, 3) / 2);
  return Math.min(limit, Math.max(3, Math.sqrt(LAT_ACCEL * r)));
}

/** Cubic arc for a mid-road U-turn from pose a to pose b (b faces the other way). */
export function uturnPose(a: Pose, b: Pose, u: number, out: Pose): Pose {
  const fx = Math.sin(a.h);
  const fz = Math.cos(a.h);
  const gx = Math.sin(b.h);
  const gz = Math.cos(b.h);
  const k = 3.5;
  return bezier(a.x, a.z, a.x + fx * k, a.z + fz * k, b.x - gx * k, b.z - gz * k, b.x, b.z, u, out);
}

// --- Anti-teleport smoothing --------------------------------------------------------------

export interface PoseOffset {
  x: number;
  z: number;
  h: number;
}

function wrapAngle(a: number) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * Rendered pose = target + offset, where the offset absorbs any jump bigger than `maxStep`
 * (e.g. a replan changing the curve mid-junction) and decays over ~0.4 s.
 */
export function smoothPose(prev: Pose, target: Pose, off: PoseOffset, dt: number, maxStep: number, out: Pose): Pose {
  const decay = Math.exp(-dt * 6);
  off.x *= decay;
  off.z *= decay;
  off.h *= decay;
  let x = target.x + off.x;
  let z = target.z + off.z;
  const jump = Math.hypot(x - prev.x, z - prev.z);
  if (jump > maxStep) {
    // move at most maxStep towards the target this frame
    const k = maxStep / jump;
    x = prev.x + (x - prev.x) * k;
    z = prev.z + (z - prev.z) * k;
    off.x = x - target.x;
    off.z = z - target.z;
  }
  let h = target.h + off.h;
  const dh = wrapAngle(h - prev.h);
  const maxTurn = 4 * dt + 0.05;
  if (Math.abs(dh) > maxTurn) {
    h = prev.h + Math.sign(dh) * maxTurn;
    off.h = wrapAngle(h - target.h);
  }
  out.x = x;
  out.z = z;
  out.h = h;
  return out;
}

// --- Obstacles ----------------------------------------------------------------------------

export interface LaneEntry {
  t: number;
  speed: number;
  half: number; // half length of that vehicle
}

export type LaneLookup = (from: string, to: string, afterT: number) => LaneEntry | null;

/** Nearest vehicle ahead on our lane, looking up to `lookahead` metres along the path. */
export function laneObstacle(
  path: readonly string[], idx: number, t: number, selfHalf: number, lookup: LaneLookup, lookahead = 60,
): { gap: number; speed: number } {
  const a = path[idx];
  const b = path[idx + 1];
  const len = edgeLen(a, b);
  const lead = lookup(a, b, t);
  if (lead) return { gap: (lead.t - t) * len - selfHalf - lead.half, speed: lead.speed };
  let d = (1 - t) * len;
  for (let k = idx + 1; k + 1 < path.length && d < lookahead; k++) {
    const l = lookup(path[k], path[k + 1], -1);
    const lk = edgeLen(path[k], path[k + 1]);
    if (l) return { gap: d + l.t * lk - selfHalf - l.half, speed: l.speed };
    d += lk;
  }
  return { gap: Infinity, speed: 0 };
}

export type SignalAction = "go" | "stop" | "commit";

/** What to do about the light at the end of this edge. `distToLine` from our front bumper. */
export function signalDecision(colour: SignalColour, distToLine: number, v: number, committed: boolean): SignalAction {
  if (colour === "green" || committed || distToLine < -0.5) return "go";
  const comfy = (v * v) / (2 * IDM.bComf * 1.2);
  if (colour === "amber") return comfy <= distToLine ? "stop" : "commit";
  // red without having seen amber (e.g. just turned onto this edge): stop if physically possible
  return (v * v) / (2 * MAX_BRAKE) <= distToLine + 1 ? "stop" : "commit";
}

/** Where along the directed edge from->to a world point lies (0..1, unclamped). */
export function blockageT(from: string, to: string, x: number, z: number) {
  const a = getNode(from);
  const b = getNode(to);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1);
}

// --- Routing ------------------------------------------------------------------------------

/** True when any edge after the current one is blocked. */
export function needsReroute(path: readonly string[], idx: number, blocked: ReadonlySet<string>): boolean {
  if (!blocked.size) return false;
  for (let k = idx + 1; k + 1 < path.length; k++) {
    const e = edgeOf(path[k], path[k + 1]);
    if (blocked.has(e ? e.key : edgeKey(path[k], path[k + 1]))) return true;
  }
  return false;
}

/**
 * New path to `dest` that keeps the edge we're on (we can't leave it mid-way) and the node
 * before it (for turn blending). Avoids an immediate U-turn at the next node when possible.
 */
export function replanPath(
  path: readonly string[], idx: number, dest: string, blocked: ReadonlySet<string>,
): { path: string[]; idx: number } | null {
  const from = path[idx];
  const to = path[idx + 1];
  const noBack = new Set(blocked);
  noBack.add(edgeKey(from, to));
  const tail = fastPath(to, dest, noBack) ?? fastPath(to, dest, blocked);
  if (!tail || tail.length < 2) return null;
  const keep = idx >= 1 ? path.slice(idx - 1, idx + 1) : path.slice(idx, idx + 1);
  return { path: [...keep, ...tail], idx: idx >= 1 ? 1 : 0 };
}

export type Archetype =
  | "hatch" | "saloon" | "suv" | "estate" | "sports" | "cab" | "minibus" | "van" | "hgv" | "moto";

/** Relative traffic density per zone (busy districts and high streets get more cars). */
export const ZONE_WEIGHT: Record<string, number> = {
  downtown: 1.6, oldTown: 2, shoreditch: 1.9, southbank: 1.8, hampstead: 1, suburbs: 0.8, industrial: 0.7,
  containerTerminal: 0.6, docks: 0.6, countryside: 0.4, airport: 0.7, depot: 0, highway: 0.7,
};
const FREIGHT_ZONES = new Set(["industrial", "containerTerminal", "docks"]);

const nodeList = [...ROAD_NODES.values()];
/** Nodes on a highway-kind road (ring, motorway, slip roads). */
export const HIGHWAY_NODES = new Set<string>();
/** Highway nodes outside the inner ring (the motorway), empty until the Motorway district exists. */
export const MOTORWAY_NODES = new Set<string>();
for (const e of ROAD_EDGES.values()) {
  if (e.kind !== "highway") continue;
  HIGHWAY_NODES.add(e.a).add(e.b);
  if (!(e.a.startsWith("h_") && e.b.startsWith("h_"))) MOTORWAY_NODES.add(e.a).add(e.b);
}
export const FREIGHT_NODES = new Set(nodeList.filter((n) => FREIGHT_ZONES.has(n.zone)).map((n) => n.id));

function weighted(nodes: RoadNode[]) {
  const ids: string[] = [];
  const cum: number[] = [];
  let total = 0;
  for (const n of nodes) {
    const w = (ZONE_WEIGHT[n.zone] ?? 1) * (isJunction(n.id) ? 1.5 : 1);
    if (w <= 0) continue;
    total += w;
    ids.push(n.id);
    cum.push(total);
  }
  return { ids, cum, total };
}
type Pool = ReturnType<typeof weighted>;

const TOWN = weighted(nodeList.filter((n) => !n.id.startsWith("depot_")));
const CENTRAL = weighted(nodeList.filter((n) => ["downtown", "oldTown", "shoreditch", "southbank"].includes(n.zone)));
const HIGHWAY = weighted(nodeList.filter((n) => HIGHWAY_NODES.has(n.id)));
const MOTORWAY = MOTORWAY_NODES.size ? weighted(nodeList.filter((n) => MOTORWAY_NODES.has(n.id))) : HIGHWAY;
const FREIGHT = FREIGHT_NODES.size ? weighted(nodeList.filter((n) => FREIGHT_NODES.has(n.id))) : HIGHWAY;

function sample(pool: Pool, rand: () => number) {
  const r = rand() * pool.total;
  let lo = 0;
  let hi = pool.cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pool.cum[mid] < r) lo = mid + 1;
    else hi = mid;
  }
  return pool.ids[lo];
}

function poolFor(kind: Archetype, rand: () => number): Pool {
  const r = rand();
  if (kind === "hgv") return r < 0.4 ? MOTORWAY : r < 0.7 ? HIGHWAY : FREIGHT;
  if (kind === "van") return r < 0.35 ? MOTORWAY : r < 0.5 ? FREIGHT : TOWN;
  if (kind === "cab") return r < 0.7 && CENTRAL.total ? CENTRAL : TOWN;
  return TOWN;
}

/**
 * A random destination suited to the vehicle type, never the current node. Prefers trips of
 * 80..900 m (lorries: up to 2 km) so traffic stays local to districts and path searches stay small.
 */
export function pickDestination(kind: Archetype, current: string, rand: () => number): string {
  const here = getNode(current);
  const maxD = kind === "hgv" ? 2000 : kind === "van" ? 1400 : 900;
  let fallback = "";
  for (let i = 0; i < 12; i++) {
    const pool = poolFor(kind, rand);
    if (!pool.total) continue;
    const id = sample(pool, rand);
    if (id === current) continue;
    const n = getNode(id);
    const d = Math.hypot(n.x - here.x, n.z - here.z);
    if (d >= 80 && d <= maxD) return id;
    if (!fallback || d <= maxD) fallback = id;
  }
  return fallback || TOWN.ids.find((id) => id !== current) || current;
}

// --- Look-ahead beam helpers ----------------------------------------------------------------

/**
 * Pose `ds` metres further along the path from (idx, t), without mutating anything. Returns the
 * distance that didn't fit (the path ended); the pose is then the path end.
 */
export function pathPointAhead(path: readonly string[], idx: number, t: number, ds: number, out: Pose): number {
  let i = idx;
  let tt = t;
  let rem = ds;
  while (rem > 0) {
    const len = edgeLen(path[i], path[i + 1]);
    const left = (1 - tt) * len;
    if (rem < left) {
      tt += rem / len;
      rem = 0;
      break;
    }
    if (i + 2 >= path.length) {
      tt = 1;
      rem -= left;
      break;
    }
    rem -= left;
    i += 1;
    tt = 0;
  }
  poseAt(path, i, tt, out);
  return rem;
}

/** Signed lateral offset of point (px, pz) from a vehicle at (x, z) heading h (> 0 = to its left). */
export function lateralOf(x: number, z: number, h: number, px: number, pz: number) {
  return (pz - z) * Math.sin(h) - (px - x) * Math.cos(h);
}

/**
 * Two vehicles in conflict inside a junction: exactly one of them yields. Give way to the vehicle on
 * your right (UK rule); when that's ambiguous (head-on, or each is on the other's right) the lower id
 * yields. Symmetric: shouldYield(a, b) !== shouldYield(b, a).
 */
export function shouldYield(
  x: number, z: number, h: number, id: string,
  ox: number, oz: number, oh: number, oid: string,
): boolean {
  const otherOnMyRight = lateralOf(x, z, h, ox, oz) < 0;
  const meOnItsRight = lateralOf(ox, oz, oh, x, z) < 0;
  if (otherOnMyRight !== meOnItsRight) return otherOnMyRight;
  return id < oid;
}
