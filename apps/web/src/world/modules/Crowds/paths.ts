// Walkable paths for the crowd, derived at runtime from the shared road graph (so every district that
// agents add to districts/*.ts gets pedestrians automatically). Pure: no three.js, cheap to test.
//
// A street walk is a chain of "street" edges (junction to junction, through curve nodes). Its loop walks
// one sidewalk out, crosses the road at the far end (a junction), walks the other sidewalk back and
// crosses again at the start, so people only ever cross at junctions. Loops are resampled at a uniform
// step and packed into a float texture the vertex shader samples.
import type { ZoneName } from "../../config";
import { edgeKey, ROAD_EDGES, ROAD_NODES, type RoadEdge, type RoadNode } from "../../roads";

/** Sidewalk centre line, metres from the road centre line (roads are 8 m wide). People jitter ±LATERAL. */
export const SIDEWALK_OFFSET = 5.75;
export const LATERAL = 0.65; // keeps everyone inside 5.1..6.4 m from the centre line
/** Crossings sit this far back from the junction centre (along the street). */
export const CROSSING_INSET = 6;
/** Chains stop this far back from a node that touches a highway (ring, motorway). */
export const HIGHWAY_INSET = 11;
/** No walk point may come closer than this to a highway centre line (12 m dual carriageway + barrier). */
export const HIGHWAY_CLEARANCE = 7;
/** Resampling step along every loop (m). */
export const STEP = 1.75;

/** Raised sidewalk height downtown (Roads draws 0.14 m kerbs there); elsewhere people stand on the road surface. */
export const SIDEWALK_Y_DOWNTOWN = 0.14;
export const SIDEWALK_Y = 0.06;

export type Rand = () => number;

/** Small seeded RNG (mulberry32). */
export function mulberry32(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Graph {
  nodes: ReadonlyMap<string, RoadNode>;
  edges: ReadonlyMap<string, RoadEdge>;
}

const SHARED: Graph = { nodes: ROAD_NODES, edges: ROAD_EDGES };

/** Only plain streets get sidewalks: no highway, ramp or country lanes. */
export function isWalkable(e: RoadEdge) {
  return e.kind === "street";
}

export function walkableEdges(g: Graph = SHARED): RoadEdge[] {
  return [...g.edges.values()].filter(isWalkable);
}

// --- zones and density ------------------------------------------------------

type Zone = ZoneName | "highway";

const ZONE_WEIGHT: Partial<Record<Zone, number>> = {
  downtown: 1,
  southbank: 0.8,
  shoreditch: 0.8,
  oldTown: 0.8,
  hampstead: 0.45,
  suburbs: 0.4,
  docks: 0.15,
  containerTerminal: 0.12,
  industrial: 0.12,
  depot: 0.15,
  airport: 0.3,
  countryside: 0.1,
  highway: 0.25,
};

/** Zone of an edge: the first endpoint that isn't a highway node. */
export function edgeZone(e: RoadEdge, g: Graph = SHARED): Zone {
  const za = g.nodes.get(e.a)!.zone;
  return za !== "highway" ? za : g.nodes.get(e.b)!.zone;
}

const HIGH_STREET = /_(hs|high)/;
const SQUARE = /_(sq|square|market|mkt)/;

/** Pedestrians per metre of sidewalk, relative: downtown core and high streets are busiest. */
export function edgeWeight(e: RoadEdge, g: Graph = SHARED): number {
  const a = g.nodes.get(e.a)!;
  const b = g.nodes.get(e.b)!;
  const zone = edgeZone(e, g);
  let w = ZONE_WEIGHT[zone] ?? 0.4;
  if (zone === "downtown") {
    const r = Math.hypot((a.x + b.x) / 2, (a.z + b.z) / 2);
    w *= 1 + 0.9 * Math.max(0, 1 - r / 170); // busier towards the centre
    if (a.x === 0 && b.x === 0) w *= 1.4; // the two main axes are the high streets
    if (a.z === 0 && b.z === 0) w *= 1.4;
  }
  if (HIGH_STREET.test(e.a) || HIGH_STREET.test(e.b)) w *= 2.2;
  else if (SQUARE.test(e.a) || SQUARE.test(e.b)) w *= 1.6;
  return w;
}

// --- sidewalks --------------------------------------------------------------

export interface Sidewalk {
  edge: string;
  side: 1 | -1;
  ax: number;
  az: number;
  bx: number;
  bz: number;
  zone: Zone;
  weight: number;
  y: number;
}

function sidewalkY(zone: Zone) {
  return zone === "downtown" ? SIDEWALK_Y_DOWNTOWN : SIDEWALK_Y;
}

function touchesHighway(id: string, g: Graph, adj: Map<string, RoadEdge[]>) {
  if (g.nodes.get(id)!.zone === "highway") return true;
  return (adj.get(id) ?? []).some((e) => e.kind === "highway");
}

/** Every walkable street edge, both sides, offset SIDEWALK_OFFSET, pulled back from both junctions. */
export function sidewalks(g: Graph = SHARED, off = SIDEWALK_OFFSET): Sidewalk[] {
  const adj = allAdjacency(g);
  const out: Sidewalk[] = [];
  for (const e of walkableEdges(g)) {
    const a = g.nodes.get(e.a)!;
    const b = g.nodes.get(e.b)!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-3) continue;
    const dx = (b.x - a.x) / len;
    const dz = (b.z - a.z) / len;
    const ia = Math.min(touchesHighway(e.a, g, adj) ? HIGHWAY_INSET : CROSSING_INSET, len * 0.35);
    const ib = Math.min(touchesHighway(e.b, g, adj) ? HIGHWAY_INSET : CROSSING_INSET, len * 0.35);
    const zone = edgeZone(e, g);
    const weight = edgeWeight(e, g);
    for (const side of [1, -1] as const) {
      const nx = -dz * off * side;
      const nz = dx * off * side;
      out.push({
        edge: e.key, side, zone, weight, y: sidewalkY(zone),
        ax: a.x + dx * ia + nx, az: a.z + dz * ia + nz,
        bx: b.x - dx * ib + nx, bz: b.z - dz * ib + nz,
      });
    }
  }
  return out;
}

// --- graph helpers ----------------------------------------------------------

function allAdjacency(g: Graph) {
  const adj = new Map<string, RoadEdge[]>();
  for (const e of g.edges.values()) {
    if (!adj.has(e.a)) adj.set(e.a, []);
    if (!adj.has(e.b)) adj.set(e.b, []);
    adj.get(e.a)!.push(e);
    adj.get(e.b)!.push(e);
  }
  return adj;
}

function walkAdjacency(g: Graph) {
  const adj = new Map<string, string[]>();
  for (const e of walkableEdges(g)) {
    if (!adj.has(e.a)) adj.set(e.a, []);
    if (!adj.has(e.b)) adj.set(e.b, []);
    adj.get(e.a)!.push(e.b);
    adj.get(e.b)!.push(e.a);
  }
  return adj;
}

/** Point-to-segment distance. */
export function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/** Spatial hash of highway centre lines for the clearance check. */
class SegmentGrid {
  private cells = new Map<string, number[]>();
  private segs: number[] = [];
  private cell: number;
  private pad: number;
  constructor(cell: number, pad: number) {
    this.cell = cell;
    this.pad = pad;
  }
  add(ax: number, az: number, bx: number, bz: number) {
    const i = this.segs.length;
    this.segs.push(ax, az, bx, bz);
    const c = this.cell;
    for (let x = Math.floor((Math.min(ax, bx) - this.pad) / c); x <= Math.floor((Math.max(ax, bx) + this.pad) / c); x++)
      for (let z = Math.floor((Math.min(az, bz) - this.pad) / c); z <= Math.floor((Math.max(az, bz) + this.pad) / c); z++) {
        const k = `${x},${z}`;
        if (!this.cells.has(k)) this.cells.set(k, []);
        this.cells.get(k)!.push(i);
      }
  }
  /** Distance from (x,z) to the nearest segment, capped at `pad`. */
  near(x: number, z: number) {
    const list = this.cells.get(`${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`);
    let best = this.pad;
    if (!list) return best;
    const s = this.segs;
    for (const i of list) best = Math.min(best, segDist(x, z, s[i], s[i + 1], s[i + 2], s[i + 3]));
    return best;
  }
}

export function highwayGrid(g: Graph = SHARED) {
  const grid = new SegmentGrid(64, HIGHWAY_CLEARANCE + 1);
  for (const e of g.edges.values()) {
    if (e.kind !== "highway") continue;
    const a = g.nodes.get(e.a)!;
    const b = g.nodes.get(e.b)!;
    grid.add(a.x, a.z, b.x, b.z);
  }
  return grid;
}

// --- loops ------------------------------------------------------------------

/**
 * Closed walking loop around a chain of road centre points: side A out (offset +off), cross at the end,
 * side B back (offset -off), cross at the start. Interior corners use mitred offsets.
 * Returns flat [x0, z0, x1, z1, ...] (not repeated at the end) or null for a degenerate chain.
 */
export function chainLoop(pts: readonly [number, number][], off: number, insetA: number, insetB: number): number[] | null {
  const n = pts.length;
  if (n < 2) return null;
  const dirs: [number, number][] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0];
    const dz = pts[i + 1][1] - pts[i][1];
    const l = Math.hypot(dx, dz);
    if (l < 1e-3) return null;
    dirs.push([dx / l, dz / l]);
  }
  const side = (sgn: number) => {
    const out: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const [px, pz] = pts[i];
      if (i === 0 || i === n - 1) {
        const [dx, dz] = i === 0 ? dirs[0] : dirs[n - 2];
        const along = i === 0 ? insetA : -insetB;
        out.push([px + dx * along - dz * off * sgn, pz + dz * along + dx * off * sgn]);
      } else {
        const [ax, az] = dirs[i - 1];
        const [bx, bz] = dirs[i];
        const n1x = -az, n1z = ax, n2x = -bz, n2z = bx;
        const denom = 1 + n1x * n2x + n1z * n2z;
        const k = denom > 0.35 ? (off * sgn) / denom : off * sgn;
        const mx = denom > 0.35 ? n1x + n2x : n1x;
        const mz = denom > 0.35 ? n1z + n2z : n1z;
        out.push([px + mx * k, pz + mz * k]);
      }
    }
    return out;
  };
  const a = side(1);
  const b = side(-1).reverse();
  const flat: number[] = [];
  for (const [x, z] of [...a, ...b]) flat.push(x, z);
  return flat;
}

/** Perimeter length of a closed flat loop. */
export function loopLength(flat: readonly number[]) {
  let L = 0;
  const n = flat.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    L += Math.hypot(flat[j * 2] - flat[i * 2], flat[j * 2 + 1] - flat[i * 2 + 1]);
  }
  return L;
}

/** Resample a closed loop at a uniform arc-length step. Returns flat x,z samples; sample i is at s = i * length / count. */
export function resampleLoop(flat: readonly number[], step = STEP): { pts: Float32Array; length: number; count: number } {
  const n = flat.length / 2;
  const L = loopLength(flat);
  const count = Math.max(4, Math.round(L / step));
  const ds = L / count;
  const pts = new Float32Array(count * 2);
  let seg = 0;
  let segStart = 0;
  let segLen = Math.hypot(flat[2] - flat[0], flat[3] - flat[1]);
  for (let k = 0; k < count; k++) {
    const s = k * ds;
    while (s > segStart + segLen && seg < n - 1) {
      segStart += segLen;
      seg++;
      const j = (seg + 1) % n;
      segLen = Math.hypot(flat[j * 2] - flat[seg * 2], flat[j * 2 + 1] - flat[seg * 2 + 1]);
    }
    const j = (seg + 1) % n;
    const t = segLen > 0 ? Math.min(1, (s - segStart) / segLen) : 0;
    pts[k * 2] = flat[seg * 2] + (flat[j * 2] - flat[seg * 2]) * t;
    pts[k * 2 + 1] = flat[seg * 2 + 1] + (flat[j * 2 + 1] - flat[seg * 2 + 1]) * t;
  }
  return { pts, length: L, count };
}

export type PathKind = "street" | "commuter" | "park";

export interface WalkPath {
  kind: PathKind;
  /** Corner points of the closed loop (flat x,z), before resampling. */
  corners: number[];
  /** Road nodes the loop follows (street/commuter), empty for plazas. */
  chain: string[];
  zone: Zone;
  weight: number; // relative share of the crowd
  y: number;
  /** Lateral jitter allowed for people on this loop. */
  lateral: number;
}

interface WalkOpts {
  maxLegs: number; // junction-to-junction streets to walk
  maxLen: number;
}

/**
 * Random walk along walkable streets from `start` via `next`, never revisiting a node or turning sharper
 * than ~110°, stopping at a junction once `maxLegs` junctions have been passed. Prefers going straight.
 */
export function walkChain(start: string, next: string, rand: Rand, g: Graph, adj: Map<string, string[]>, stopAt: (id: string) => boolean, o: WalkOpts) {
  const chain = [start, next];
  const seen = new Set(chain);
  let legs = (adj.get(next)?.length ?? 0) !== 2 ? 1 : 0;
  let len = dist(g, start, next);
  while (legs < o.maxLegs && len < o.maxLen) {
    const cur = chain[chain.length - 1];
    if (stopAt(cur)) break;
    const prev = chain[chain.length - 2];
    const c = g.nodes.get(cur)!;
    const p = g.nodes.get(prev)!;
    const inLen = Math.hypot(c.x - p.x, c.z - p.z);
    const ix = (c.x - p.x) / inLen;
    const iz = (c.z - p.z) / inLen;
    let total = 0;
    const cands: [string, number][] = [];
    for (const nb of adj.get(cur) ?? []) {
      if (seen.has(nb)) continue;
      const q = g.nodes.get(nb)!;
      const l = Math.hypot(q.x - c.x, q.z - c.z);
      if (l < 1e-3) continue;
      const cos = ((q.x - c.x) * ix + (q.z - c.z) * iz) / l;
      if (cos < -0.3) continue;
      const w = 0.4 + Math.max(0, cos) * 1.6;
      cands.push([nb, w]);
      total += w;
    }
    if (!cands.length) break;
    let r = rand() * total;
    let pick = cands[cands.length - 1][0];
    for (const [id, w] of cands) {
      r -= w;
      if (r <= 0) {
        pick = id;
        break;
      }
    }
    len += dist(g, cur, pick);
    chain.push(pick);
    seen.add(pick);
    if ((adj.get(pick)?.length ?? 0) !== 2) legs++;
  }
  return chain;
}

function dist(g: Graph, a: string, b: string) {
  const na = g.nodes.get(a)!;
  const nb = g.nodes.get(b)!;
  return Math.hypot(na.x - nb.x, na.z - nb.z);
}

function clearOfHighways(flat: readonly number[], grid: ReturnType<typeof highwayGrid>) {
  const n = flat.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (grid.near(flat[i * 2], flat[i * 2 + 1]) < HIGHWAY_CLEARANCE) return false;
    const mx = (flat[i * 2] + flat[j * 2]) / 2;
    const mz = (flat[i * 2 + 1] + flat[j * 2 + 1]) / 2;
    if (grid.near(mx, mz) < HIGHWAY_CLEARANCE) return false;
  }
  return true;
}

function chainLoopFor(chain: string[], g: Graph, allAdj: Map<string, RoadEdge[]>, startInset?: number) {
  const pts = chain.map((id) => {
    const n = g.nodes.get(id)!;
    return [n.x, n.z] as [number, number];
  });
  const first = dist(g, chain[0], chain[1]);
  const last = dist(g, chain[chain.length - 2], chain[chain.length - 1]);
  const ia = startInset ?? Math.min(touchesHighway(chain[0], g, allAdj) ? HIGHWAY_INSET : CROSSING_INSET, first * 0.35);
  const ib = Math.min(touchesHighway(chain[chain.length - 1], g, allAdj) ? HIGHWAY_INSET : CROSSING_INSET, last * 0.35);
  return chainLoop(pts, SIDEWALK_OFFSET, ia, ib);
}

function chainWeight(chain: string[], g: Graph) {
  let w = 0;
  let L = 0;
  for (let i = 0; i < chain.length - 1; i++) {
    const e = g.edges.get(edgeKey(chain[i], chain[i + 1]))!;
    w += edgeWeight(e, g) * e.length;
    L += e.length;
  }
  return { avg: L > 0 ? w / L : 0, zone: edgeZone(g.edges.get(edgeKey(chain[0], chain[1]))!, g) };
}

/**
 * One looping street walk per walkable edge (starting on it in a random direction).
 * Loops that would come too close to a highway are dropped.
 */
export function streetPaths(rand: Rand, g: Graph = SHARED): WalkPath[] {
  const adj = walkAdjacency(g);
  const allAdj = allAdjacency(g);
  const grid = highwayGrid(g);
  const stopAt = (id: string) => touchesHighway(id, g, allAdj);
  const out: WalkPath[] = [];
  for (const e of walkableEdges(g)) {
    const fwd = rand() < 0.5;
    const start = fwd ? e.a : e.b;
    const next = fwd ? e.b : e.a;
    const maxLegs = 1 + Math.floor(rand() * 5);
    const chain = stopAt(start) ? [start, next] : walkChain(start, next, rand, g, adj, stopAt, { maxLegs, maxLen: 420 });
    const corners = chainLoopFor(chain, g, allAdj);
    if (!corners || !clearOfHighways(corners, grid)) continue;
    const { avg, zone } = chainWeight(chain, g);
    out.push({ kind: "street", corners, chain, zone, weight: avg * loopLength(corners), y: sidewalkY(zone), lateral: LATERAL });
  }
  return out;
}

export interface StationSite {
  name: string;
  x: number;
  z: number;
}

/**
 * Commuter streams: for each station near a walkable street, a few loops that start right at the
 * station foot (crossing under it) and head out 2-4 junctions into the neighbourhood.
 */
export function commuterPaths(stations: readonly StationSite[], rand: Rand, g: Graph = SHARED, perStation = 3): WalkPath[] {
  const adj = walkAdjacency(g);
  const allAdj = allAdjacency(g);
  const grid = highwayGrid(g);
  const stopAt = (id: string) => touchesHighway(id, g, allAdj);
  const edges = walkableEdges(g);
  const out: WalkPath[] = [];
  for (const st of stations) {
    let best: RoadEdge | null = null;
    let bestD = 25;
    for (const e of edges) {
      const a = g.nodes.get(e.a)!;
      const b = g.nodes.get(e.b)!;
      const d = segDist(st.x, st.z, a.x, a.z, b.x, b.z);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    if (!best) continue;
    const a = g.nodes.get(best.a)!;
    const b = g.nodes.get(best.b)!;
    const L = best.length;
    const t = Math.max(0, Math.min(1, ((st.x - a.x) * (b.x - a.x) + (st.z - a.z) * (b.z - a.z)) / (L * L)));
    for (let k = 0; k < perStation; k++) {
      // walk away from the station through endpoint `to`; the loop's start crossing sits at the station
      const toB = k % 2 === 0;
      const from = toB ? best.a : best.b;
      const to = toB ? best.b : best.a;
      const inset = Math.max(1, (toB ? t : 1 - t) * L);
      if (inset > L - 3) continue;
      const chain = walkChain(from, to, rand, g, adj, stopAt, { maxLegs: 2 + Math.floor(rand() * 3), maxLen: 260 });
      const corners = chainLoopFor(chain, g, allAdj, inset);
      if (!corners || !clearOfHighways(corners, grid)) continue;
      const zone = edgeZone(best, g);
      out.push({ kind: "commuter", corners, chain, zone, weight: 1, y: sidewalkY(zone), lateral: 0.8 });
    }
  }
  return out;
}

/** Central park (cell 20,20): a ring round the clock-tower plaza and out-and-back strolls along the four paths. */
export function parkPaths(cx = 20, cz = 20): WalkPath[] {
  const out: WalkPath[] = [];
  const ring: number[] = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    ring.push(cx + Math.cos(a) * 4.8, cz + Math.sin(a) * 4.8);
  }
  out.push({ kind: "park", corners: ring, chain: [], zone: "downtown", weight: 1, y: 0.3, lateral: 0.35 });
  for (const [ux, uz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const vx = -uz, vz = ux; // across the path
    const r0 = 5.8, r1 = 13.3, w = 0.55;
    out.push({
      kind: "park", chain: [], zone: "downtown", weight: 1, y: 0.26, lateral: 0.2,
      corners: [
        cx + ux * r0 + vx * w, cz + uz * r0 + vz * w,
        cx + ux * r1 + vx * w, cz + uz * r1 + vz * w,
        cx + ux * r1 - vx * w, cz + uz * r1 - vz * w,
        cx + ux * r0 - vx * w, cz + uz * r0 - vz * w,
      ],
    });
  }
  return out;
}

// --- packing for the GPU ----------------------------------------------------

export interface PackedPaths {
  /** RGBA float texels: (x, z, 0, 0) per sample. */
  points: Float32Array;
  width: number;
  height: number;
  /** RGBA float texels, one per path: (first texel, sample count, loop length, ground y). */
  heads: Float32Array;
  headWidth: number;
  headHeight: number;
  lengths: Float32Array;
}

export const TEX_WIDTH = 1024;

export function packPaths(paths: readonly WalkPath[], step = STEP, width = TEX_WIDTH): PackedPaths {
  const samples = paths.map((p) => resampleLoop(p.corners, step));
  const total = samples.reduce((n, s) => n + s.count, 0);
  const height = Math.max(1, Math.ceil(total / width));
  const points = new Float32Array(width * height * 4);
  const headWidth = Math.min(width, Math.max(1, paths.length));
  const headHeight = Math.max(1, Math.ceil(paths.length / headWidth));
  const heads = new Float32Array(headWidth * headHeight * 4);
  const lengths = new Float32Array(paths.length);
  let at = 0;
  samples.forEach((s, i) => {
    for (let k = 0; k < s.count; k++) {
      points[(at + k) * 4] = s.pts[k * 2];
      points[(at + k) * 4 + 1] = s.pts[k * 2 + 1];
    }
    heads[i * 4] = at;
    heads[i * 4 + 1] = s.count;
    heads[i * 4 + 2] = s.length;
    heads[i * 4 + 3] = paths[i].y;
    lengths[i] = s.length;
    at += s.count;
  });
  return { points, width, height, heads, headWidth, headHeight, lengths };
}

/** CPU mirror of the shader's path lookup (tests + debugging): position at arc length s on path `id`. */
export function samplePacked(p: PackedPaths, id: number, s: number): [number, number] {
  const start = p.heads[id * 4];
  const count = p.heads[id * 4 + 1];
  const L = p.heads[id * 4 + 2];
  const step = L / count;
  const f = (((s % L) + L) % L) / step;
  const i0 = Math.floor(f) % count;
  const i1 = (i0 + 1) % count;
  const t = f - Math.floor(f);
  const x = p.points[(start + i0) * 4] + (p.points[(start + i1) * 4] - p.points[(start + i0) * 4]) * t;
  const z = p.points[(start + i0) * 4 + 1] + (p.points[(start + i1) * 4 + 1] - p.points[(start + i0) * 4 + 1]) * t;
  return [x, z];
}
