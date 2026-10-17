// Bus routes as fixed loops of road nodes, their stops, a loop navigator that detours around
// blocked roads (to the next stop) and rejoins, and a smooth left-lane pose through corners.
import { edgeKey, findPath, getEdge, getNode, lanePosition } from "../../roads";

export interface BusStop {
  id: string;
  route: string;
  name: string;
  from: string;
  to: string;
  loopIdx: number; // index of `from` in the loop
  t: number; // where along from->to the bus pulls in
}

export interface BusRoute {
  number: string;
  destination: string;
  loop: string[]; // closed: last connects back to first
  stops: BusStop[];
  buses: number;
}

const g = (i: number, j: number) => `g_${i}_${j}`;

/** Corner list of grid (i, j) points, each pair sharing an axis, into a closed loop of grid node ids. */
export function expandGridLoop(corners: readonly [number, number][]): string[] {
  const out: string[] = [];
  for (let k = 0; k < corners.length; k++) {
    const [i0, j0] = corners[k];
    const [i1, j1] = corners[(k + 1) % corners.length];
    const steps = Math.max(Math.abs(i1 - i0), Math.abs(j1 - j0));
    const di = Math.sign(i1 - i0);
    const dj = Math.sign(j1 - j0);
    for (let s = 0; s < steps; s++) out.push(g(i0 + di * s, j0 + dj * s));
  }
  return out;
}

const STOP_NAMES = [
  "Kings Rd", "Market St", "Bridge Row", "Fleet Lane", "Hamyway House", "Old Kent Rd", "Bow Church", "Mile End",
  "Gasworks", "Tower Gate", "Strand", "Cheapside", "Brick Lane", "Union Sq", "St Paul's", "Holloway",
  "Shoreditch", "Angel", "Borough", "Pimlico", "Elm Grove", "Oak Close", "Hill Crest", "The Green",
];

function pickStops(route: string, loop: string[], count: number, nameOffset: number): BusStop[] {
  const n = loop.length;
  const cands: number[] = [];
  for (let i = 0; i < n; i++) if (getEdge(loop[i], loop[(i + 1) % n])?.kind === "street") cands.push(i);
  const stops: BusStop[] = [];
  const used = new Set<number>();
  for (let k = 0; k < count; k++) {
    const idx = cands[Math.floor((k * cands.length) / count)];
    if (used.has(idx)) continue;
    used.add(idx);
    stops.push({
      id: `${route}-s${k}`,
      route,
      name: STOP_NAMES[(nameOffset + k) % STOP_NAMES.length],
      from: loop[idx],
      to: loop[(idx + 1) % n],
      loopIdx: idx,
      t: 0.5,
    });
  }
  return stops;
}

function route(number: string, destination: string, loop: string[], buses: number, nameOffset: number): BusRoute {
  return { number, destination, loop, buses, stops: pickStops(number, loop, 8, nameOffset) };
}

export const BUS_ROUTES: readonly BusRoute[] = [
  route("25", "Ilford", expandGridLoop([[-3, -2], [2, -2], [2, 1], [-3, 1]]), 3, 0),
  route("73", "Oxford Circus", expandGridLoop([[-1, -3], [1, -3], [1, 3], [-1, 3]]), 3, 8),
  // Out of downtown on the north ramp, round the suburbs, back in on the next ramp.
  route(
    "390",
    "Archway",
    [
      g(0, -2), g(0, -3), g(0, -4), "h_2", "sub_0_0", "sub_0_1", "sub_1_1", "sub_1_0", "h_3",
      g(3, -4), g(3, -3), g(3, -2), g(2, -2), g(1, -2),
    ],
    2,
    16,
  ),
];

export interface Detour {
  path: string[]; // nodes after the current one
  rejoin: number; // loop index the path ends at
}

/**
 * Plan a way from `cur` back onto the loop avoiding blocked roads. Aims for the start of the next
 * stop (whose own road is open) after loop index `idx`; falls back to any later loop node.
 */
export function planDetour(
  loop: readonly string[],
  idx: number,
  cur: string,
  stops: readonly BusStop[],
  blocked: ReadonlySet<string>,
  pathFn: typeof findPath = findPath,
): Detour | null {
  const n = loop.length;
  const tryIdx = (j: number): Detour | null => {
    if (loop[j] === cur) return null;
    const p = pathFn(cur, loop[j], blocked);
    return p && p.length > 1 ? { path: p.slice(1), rejoin: j } : null;
  };
  for (let k = 1; k < n; k++) {
    const j = (idx + k) % n;
    const stop = stops.find((s) => s.loopIdx === j);
    if (!stop || blocked.has(edgeKey(stop.from, stop.to))) continue;
    const d = tryIdx(j);
    if (d) return d;
  }
  for (let k = 1; k < n; k++) {
    const j = (idx + k) % n;
    if (blocked.has(edgeKey(loop[j], loop[(j + 1) % n]))) continue;
    const d = tryIdx(j);
    if (d) return d;
  }
  return null;
}

/** Walks a bus round its loop, node by node, detouring around blocked roads. */
export class LoopNavigator {
  at: string;
  idx: number; // last loop index reached (or where the detour began)
  onLoop = true;
  target: string | null = null;
  private queue: string[] = [];
  private rejoin = -1;

  constructor(
    readonly loop: readonly string[],
    readonly stops: readonly BusStop[],
    startIdx: number,
  ) {
    this.idx = startIdx;
    this.at = loop[startIdx];
  }

  private loopNext(k = 1) {
    return this.loop[(this.idx + k) % this.loop.length];
  }

  /** Pick the next node from `at`, replanning if the road there is closed. Null = no way out (wait). */
  chooseNext(blocked: ReadonlySet<string>): string | null {
    let next: string | null = null;
    if (this.queue.length) next = this.queue[0];
    else if (this.onLoop) next = this.loopNext();
    if (next && !blocked.has(edgeKey(this.at, next))) return (this.target = next);
    const d = planDetour(this.loop, this.idx, this.at, this.stops, blocked);
    if (!d) return (this.target = null);
    this.queue = d.path;
    this.rejoin = d.rejoin;
    this.onLoop = false;
    return (this.target = this.queue[0]);
  }

  /** Call on reaching `target`. */
  arrive(node: string) {
    this.at = node;
    if (this.queue.length && this.queue[0] === node) {
      this.queue.shift();
      if (this.queue.length === 0) {
        if (this.rejoin >= 0 && node === this.loop[this.rejoin]) {
          this.idx = this.rejoin;
          this.onLoop = true;
        } else this.onLoop = false;
      }
    } else if (this.onLoop) {
      this.idx = (this.idx + 1) % this.loop.length;
    }
  }

  /** Turn round on the current road and head back to `node`; replans from there. */
  uTurn(node: string) {
    const backOnLoop = this.onLoop && this.loop[this.idx] === node;
    this.queue = [node];
    this.rejoin = backOnLoop ? this.idx : -1;
    this.onLoop = false;
    this.target = node;
  }

  /** The node after `target` (for smoothing the turn), if known. */
  peekAfterTarget(): string | null {
    if (this.queue.length >= 2) return this.queue[1];
    if (this.queue.length === 1)
      return this.rejoin >= 0 && this.queue[0] === this.loop[this.rejoin]
        ? this.loop[(this.rejoin + 1) % this.loop.length]
        : null;
    return this.onLoop ? this.loopNext(2) : null;
  }
}

// --- smooth pose on the left lane -----------------------------------------------------------

export interface Pose {
  x: number;
  z: number;
  h: number;
}

function edgeLen(a: string, b: string) {
  const na = getNode(a);
  const nb = getNode(b);
  return Math.hypot(nb.x - na.x, nb.z - na.z);
}

/** Quadratic Bezier through the lane-line corner between p->q and q->r, u in 0..1. */
function cornerBlend(p: string, q: string, r: string, R: number, u: number, out: Pose): boolean {
  const l1 = edgeLen(p, q);
  const l2 = edgeLen(q, r);
  const [ax, az, h1] = lanePosition(p, q, 1);
  const [bx, bz, h2] = lanePosition(q, r, 0);
  const d1x = Math.sin(h1), d1z = Math.cos(h1);
  const d2x = Math.sin(h2), d2z = Math.cos(h2);
  const cross = d1x * d2z - d1z * d2x;
  if (Math.abs(cross) < 0.05) return false; // straight on (or reversing): no blend
  const alpha = ((bx - ax) * d2z - (bz - az) * d2x) / cross;
  const cx = ax + d1x * alpha, cz = az + d1z * alpha;
  const [p0x, p0z] = lanePosition(p, q, 1 - R / l1);
  const [p2x, p2z] = lanePosition(q, r, R / l2);
  const w = 1 - u;
  out.x = w * w * p0x + 2 * u * w * cx + u * u * p2x;
  out.z = w * w * p0z + 2 * u * w * cz + u * u * p2z;
  const tx = 2 * w * (cx - p0x) + 2 * u * (p2x - cx);
  const tz = 2 * w * (cz - p0z) + 2 * u * (p2z - cz);
  out.h = Math.atan2(tx, tz);
  return true;
}

/** Pose on the left lane of a->b at t, rounding the corners into `next` and out of `prev` over R metres. */
export function lanePose(prev: string | null, a: string, b: string, next: string | null, t: number, R: number, out: Pose): Pose {
  const len = edgeLen(a, b);
  const s = t * len;
  if (next && len - s < R && cornerBlend(a, b, next, R, 0.5 * (1 - (len - s) / R), out)) return out;
  if (prev && s < R && cornerBlend(prev, a, b, R, 0.5 + (0.5 * s) / R, out)) return out;
  const [x, z, h] = lanePosition(a, b, t);
  out.x = x;
  out.z = z;
  out.h = h;
  return out;
}
