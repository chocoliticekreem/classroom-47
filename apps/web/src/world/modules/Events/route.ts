// Route building for city events: join waypoint legs into one drivable node path, find the government
// destination, and turn a path into a "track" that maps metres along it to a lane pose. Pure (no three).
import { BLOCK } from "../../config";
import { GOV_PLACES } from "../../districts/government";
import { ROAD_NODES, edgeKey, findPath, getEdge, getNode, PLACES } from "../../roads";
import { edgeLen, poseAt, type Pose } from "../Traffic/driving";

/** Fallback for the motorcade when the government district has no roads yet: the ring's NE corner. */
export const GOV_FALLBACK = "h_4";

const g = (i: number, j: number) => `g_${i}_${j}`;

/** Grid nodes along a straight downtown row/column (inclusive), e.g. row j=-2 from i=-4 to 4. */
export function gridRun(from: [number, number], to: [number, number]): string[] {
  const [i0, j0] = from;
  const [i1, j1] = to;
  if (i0 !== i1 && j0 !== j1) throw new Error("gridRun: not a straight run");
  const n = Math.max(Math.abs(i1 - i0), Math.abs(j1 - j0));
  const di = Math.sign(i1 - i0);
  const dj = Math.sign(j1 - j0);
  const out: string[] = [];
  for (let k = 0; k <= n; k++) out.push(g(i0 + di * k, j0 + dj * k));
  return out;
}

/** True when every consecutive pair is a real road. */
export function isDrivable(path: readonly string[]): boolean {
  if (path.length < 2) return false;
  for (let k = 0; k + 1 < path.length; k++) if (!getEdge(path[k], path[k + 1])) return false;
  return true;
}

/** Remove immediate back-and-forth (a, b, a) and repeated nodes, keeping the path drivable. */
export function tidy(path: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of path) {
    if (out[out.length - 1] === id) continue;
    if (out.length >= 2 && out[out.length - 2] === id) {
      out.pop(); // a, b, a -> a
      continue;
    }
    out.push(id);
  }
  // loops: cut back to the first visit of a node
  const seen = new Map<string, number>();
  const res: string[] = [];
  for (const id of out) {
    const at = seen.get(id);
    if (at !== undefined) {
      for (const dropped of res.splice(at + 1)) seen.delete(dropped);
      continue;
    }
    seen.set(id, res.length);
    res.push(id);
  }
  return res;
}

/**
 * Join legs into one path. A two-node leg [from, to] is routed with findPath (avoiding `blocked`); a
 * longer leg is an explicit node list used as is. Legs are chained end to start; null if any leg can't be routed.
 */
export function joinLegs(legs: readonly (readonly string[])[], blocked: ReadonlySet<string> = new Set()): string[] | null {
  const out: string[] = [];
  for (const leg of legs) {
    if (leg.length === 0) continue;
    let nodes: readonly string[];
    if (leg.length === 2) {
      const p = findPath(leg[0], leg[1], blocked);
      if (!p) return null;
      nodes = p;
    } else nodes = leg;
    if (out.length) {
      const last = out[out.length - 1];
      if (nodes[0] !== last) {
        const link = findPath(last, nodes[0], blocked);
        if (!link) return null;
        out.push(...link.slice(1));
      }
      out.push(...nodes.slice(1));
    } else out.push(...nodes);
  }
  const t = tidy(out);
  return isDrivable(t) ? t : null;
}

/**
 * Where the motorcade ends: the residence gate (GOV_PLACES.residenceGate) when that road node exists, else
 * the likeliest-looking "gov_*" node, else the ring's NE corner.
 */
export function governmentDestination(nodes: ReadonlyMap<string, { id: string; zone: string }> = ROAD_NODES): string {
  if (nodes.has(GOV_PLACES.residenceGate)) return GOV_PLACES.residenceGate;
  const gov = [...nodes.values()].filter((n) => n.id.startsWith("gov_") || n.zone === "government");
  if (!gov.length) return GOV_FALLBACK;
  const score = (id: string) =>
    /residence.*gate|gate.*residence/.test(id) ? 0 : /residence/.test(id) ? 1 : /gate/.test(id) ? 2 : /white|house|palace/.test(id) ? 3 : 4;
  gov.sort((a, b) => score(a.id) - score(b.id) || a.id.localeCompare(b.id));
  return gov[0].id;
}

/** Airport -> west ring -> straight through downtown along row j=-2 -> government quarter. */
export function motorcadeRoute(dest = governmentDestination(), blocked: ReadonlySet<string> = new Set()): string[] | null {
  return joinLegs([[PLACES.airport, g(-4, -2)], gridRun([-4, -2], [4, -2]), [g(4, -2), dest]], blocked);
}

/** Undirected edge keys of a path, in order. */
export function pathEdges(path: readonly string[]): string[] {
  const out: string[] = [];
  for (let k = 0; k + 1 < path.length; k++) out.push(edgeKey(path[k], path[k + 1]));
  return out;
}

/** Centre-line corner points of a path (flat x,z). */
export function pathCorners(path: readonly string[]): number[] {
  const out: number[] = [];
  for (const id of path) {
    const n = getNode(id);
    out.push(n.x, n.z);
  }
  return out;
}

/** Out-and-back closed loop over a path (for GPU walkers: out on one side of the road, back on the other). */
export function outAndBack(path: readonly string[]): number[] {
  const fwd = pathCorners(path);
  const back: number[] = [];
  for (let k = path.length - 2; k >= 1; k--) back.push(fwd[k * 2], fwd[k * 2 + 1]);
  return [...fwd, ...back];
}

/** Metres-along-path <-> (edge index, t) and lane poses. Allocation-free after construction. */
export class RouteTrack {
  readonly path: string[];
  readonly cum: Float64Array; // cum[k] = metres from the start to node k
  readonly length: number;

  constructor(path: readonly string[]) {
    if (path.length < 2) throw new Error("RouteTrack: path needs two nodes");
    this.path = [...path];
    this.cum = new Float64Array(path.length);
    for (let k = 1; k < path.length; k++) this.cum[k] = this.cum[k - 1] + edgeLen(path[k - 1], path[k]);
    this.length = this.cum[path.length - 1];
  }

  /** Index of the edge containing `s` (clamped to the path). */
  edgeAt(s: number): number {
    const n = this.path.length - 1;
    if (s <= 0) return 0;
    if (s >= this.length) return n - 1;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.cum[mid] <= s) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** t along edge `idx` at `s`. */
  tAt(idx: number, s: number): number {
    const len = this.cum[idx + 1] - this.cum[idx];
    return Math.min(1, Math.max(0, (s - this.cum[idx]) / (len || 1)));
  }

  /** Left-lane pose at `s` metres (curved through junctions like Traffic). */
  pose(s: number, out: Pose): Pose {
    const idx = this.edgeAt(s);
    return poseAt(this.path, idx, this.tAt(idx, s), out);
  }

  /** Metres from `s` to the next node where the route turns by more than ~30°, or Infinity. */
  nextTurn(s: number): number {
    for (let k = this.edgeAt(s) + 1; k < this.path.length - 1; k++) {
      if (this.cum[k] - s > BLOCK * 3) break;
      const a = getNode(this.path[k - 1]);
      const b = getNode(this.path[k]);
      const c = getNode(this.path[k + 1]);
      const h1 = Math.atan2(b.x - a.x, b.z - a.z);
      const h2 = Math.atan2(c.x - b.x, c.z - b.z);
      let d = Math.abs(h2 - h1);
      if (d > Math.PI) d = 2 * Math.PI - d;
      if (d > 0.5) return this.cum[k] - s;
    }
    return Infinity;
  }
}
