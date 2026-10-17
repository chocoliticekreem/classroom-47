// Pure, seeded placement for the streetscape: kerbside props along every non-downtown street,
// verges and shrubs along highways, billboards at highway junctions. No three.js, so it is cheap to test.
// Built at runtime from the merged road graph, so district roads added later are covered automatically.
import { RIVER, WATER_X, ZONES, inBox, type Box } from "../../config";
import { ROAD_EDGES, ROAD_NODES, type RoadKind } from "../../roads";

// ---------------------------------------------------------------- graph input

export interface GNode {
  id: string;
  x: number;
  z: number;
  zone: string;
}
export interface GEdge {
  key: string;
  a: string;
  b: string;
  kind: RoadKind;
}
export interface Graph {
  nodes: ReadonlyMap<string, GNode>;
  edges: readonly GEdge[];
}

export const worldGraph = (): Graph => ({ nodes: ROAD_NODES, edges: [...ROAD_EDGES.values()] });

// ---------------------------------------------------------------- constants

/** Half carriageway width per road kind (matches the Roads module). */
export const HALF: Record<RoadKind, number> = { street: 4, ramp: 4, highway: 6, country: 3 };

/** Lateral offsets from the centre line (metres). Everything kerbside stays inside 4.5..7. */
export const OFFSET = {
  bollard: 4.6,
  sign: 4.75,
  busStop: 4.8,
  car: 5.1, // half up on the pavement, London style (traffic lanes sit at 2 m)
  bin: 5.9,
  tree: 6.3,
  lamp: 6.6,
  neon: 6.85,
} as const;

/** Minimum distance from a junction (node with 3+ roads) per kind. */
export const JUNCTION_CLEAR = { car: 14, default: 9, bollard: 5.5 } as const;

export const VERGE = { inner: 6.7, outer: 10.3, chunk: 8 } as const;

export type PropKind =
  | "tree" | "lamp" | "bin" | "bollard" | "car" | "busStop" | "signSpeed" | "signGiveWay" | "signKeepLeft" | "neon";

export interface Prop {
  kind: PropKind;
  x: number;
  z: number;
  /** rotation.y; local +z is the "front" (signs face oncoming traffic, lamp arms reach over the road) */
  yaw: number;
  /** distance from the centre line of the road it belongs to */
  offset: number;
  edge: string;
  /** 0..1 seeded variety (colour, scale, ad index...) */
  v: number;
}

export interface Verge {
  x: number; // centre
  z: number;
  yaw: number; // local x runs along the road
  len: number;
  width: number;
  edge: string;
}

export interface Shrub {
  x: number;
  z: number;
  s: number; // scale
  v: number;
}

export interface Billboard {
  x: number;
  z: number;
  yaw: number; // local +z = ad face normal
  ad: number;
  node: string;
}

export interface Streetscape {
  props: Prop[];
  verges: Verge[];
  shrubs: Shrub[];
  billboards: Billboard[];
}

// ---------------------------------------------------------------- helpers

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

const RIVER_CLEAR = RIVER.width / 2 + 6;
export function inWater(x: number, z: number) {
  if (x > WATER_X - 3) return true;
  const p = RIVER.points;
  for (let i = 0; i + 1 < p.length; i++)
    if (distToSegment(x, z, p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]) < RIVER_CLEAR) return true;
  return false;
}

/** Areas the streetscape never touches: downtown (Life/TrafficLights own it), the depot yard, the airfield. */
const EXCLUDE: Box[] = [ZONES.downtown, ZONES.depot, ZONES.airport];
const EXCLUDE_MARGIN = [8, 2, 0];
export function excluded(x: number, z: number) {
  for (let i = 0; i < EXCLUDE.length; i++) if (inBox(EXCLUDE[i], x, z, EXCLUDE_MARGIN[i])) return true;
  return inWater(x, z);
}

/** Working zones get lamps, bollards and signs, but no trees, parked cars, bus stops or neon. */
const WORKS = new Set(["docks", "containerTerminal", "industrial", "airport", "depot"]);

interface Seg {
  key: string;
  kind: RoadKind;
  ax: number;
  az: number;
  bx: number;
  bz: number;
}

const CELL = 32;
const ck = (i: number, j: number) => `${i},${j}`;

/** Uniform grid over road segments and junction nodes for fast clearance queries. */
export class RoadIndex {
  private segs = new Map<string, Seg[]>();
  private junctions = new Map<string, GNode[]>();
  readonly degree = new Map<string, number>();
  readonly edges: GEdge[];

  constructor(readonly g: Graph) {
    this.edges = [...g.edges];
    for (const e of this.edges) {
      this.degree.set(e.a, (this.degree.get(e.a) ?? 0) + 1);
      this.degree.set(e.b, (this.degree.get(e.b) ?? 0) + 1);
      const a = g.nodes.get(e.a)!;
      const b = g.nodes.get(e.b)!;
      const s: Seg = { key: e.key, kind: e.kind, ax: a.x, az: a.z, bx: b.x, bz: b.z };
      const pad = HALF[e.kind];
      for (let i = Math.floor((Math.min(a.x, b.x) - pad) / CELL); i <= Math.floor((Math.max(a.x, b.x) + pad) / CELL); i++)
        for (let j = Math.floor((Math.min(a.z, b.z) - pad) / CELL); j <= Math.floor((Math.max(a.z, b.z) + pad) / CELL); j++) {
          const k = ck(i, j);
          const arr = this.segs.get(k);
          if (arr) arr.push(s);
          else this.segs.set(k, [s]);
        }
    }
    for (const n of g.nodes.values()) {
      if ((this.degree.get(n.id) ?? 0) < 3) continue;
      const k = ck(Math.floor(n.x / CELL), Math.floor(n.z / CELL));
      const arr = this.junctions.get(k);
      if (arr) arr.push(n);
      else this.junctions.set(k, [n]);
    }
  }

  isJunction(id: string) {
    return (this.degree.get(id) ?? 0) >= 3;
  }

  /** True if (x, z) is at least `extra` metres outside every road surface except `own`. */
  clearOfRoads(x: number, z: number, extra: number, own?: string) {
    const i0 = Math.floor(x / CELL);
    const j0 = Math.floor(z / CELL);
    const reach = Math.ceil((extra + 6) / CELL);
    for (let i = i0 - reach; i <= i0 + reach; i++)
      for (let j = j0 - reach; j <= j0 + reach; j++) {
        const arr = this.segs.get(ck(i, j));
        if (!arr) continue;
        for (const s of arr) {
          if (s.key === own) continue;
          if (distToSegment(x, z, s.ax, s.az, s.bx, s.bz) < HALF[s.kind] + extra) return false;
        }
      }
    return true;
  }

  /** Distance to the nearest junction node (Infinity if none within ~2 cells). */
  junctionDist(x: number, z: number) {
    const i0 = Math.floor(x / CELL);
    const j0 = Math.floor(z / CELL);
    let best = Infinity;
    for (let i = i0 - 1; i <= i0 + 1; i++)
      for (let j = j0 - 1; j <= j0 + 1; j++) {
        const arr = this.junctions.get(ck(i, j));
        if (arr) for (const n of arr) best = Math.min(best, Math.hypot(n.x - x, n.z - z));
      }
    return best;
  }
}

/** Point hash of placed props for spacing checks. */
class PropHash {
  private cells = new Map<string, Prop[]>();
  add(p: Prop) {
    const k = ck(Math.floor(p.x / 16), Math.floor(p.z / 16));
    const arr = this.cells.get(k);
    if (arr) arr.push(p);
    else this.cells.set(k, [p]);
  }
  near(x: number, z: number, r: number, kinds: readonly PropKind[]) {
    const i0 = Math.floor(x / 16);
    const j0 = Math.floor(z / 16);
    const reach = Math.ceil(r / 16);
    for (let i = i0 - reach; i <= i0 + reach; i++)
      for (let j = j0 - reach; j <= j0 + reach; j++) {
        const arr = this.cells.get(ck(i, j));
        if (!arr) continue;
        for (const p of arr) if (kinds.includes(p.kind) && Math.hypot(p.x - x, p.z - z) < r) return true;
      }
    return false;
  }
}

/** Spacing rules: a new prop of kind K is rejected if a prop of any listed kind is closer than r. */
const SPACING: Record<PropKind, [number, PropKind[]][]> = {
  bollard: [[0.9, ["bollard"]], [1.6, ["signSpeed", "signGiveWay", "signKeepLeft", "busStop"]]],
  signSpeed: [[3, ["signSpeed", "signGiveWay", "signKeepLeft", "busStop", "bollard"]]],
  signGiveWay: [[3, ["signSpeed", "signGiveWay", "signKeepLeft", "busStop", "bollard"]]],
  signKeepLeft: [[3, ["signSpeed", "signGiveWay", "signKeepLeft", "busStop", "bollard"]]],
  busStop: [[60, ["busStop"]], [4, ["signSpeed", "signGiveWay", "signKeepLeft", "bollard"]]],
  tree: [[9, ["tree"]], [2.5, ["lamp", "bin", "neon"]]],
  lamp: [[14, ["lamp"]], [2.5, ["tree", "bin", "neon"]]],
  bin: [[25, ["bin"]], [1.8, ["tree", "lamp", "neon"]]],
  neon: [[45, ["neon"]], [2.5, ["tree", "lamp", "bin"]]],
  car: [[5.2, ["car"]], [3.2, ["bollard", "signSpeed", "signGiveWay", "signKeepLeft"]], [10, ["busStop"]]],
};

// ---------------------------------------------------------------- street props

function buildProps(idx: RoadIndex, rand: () => number): Prop[] {
  const out: Prop[] = [];
  const hash = new PropHash();
  const nodes = idx.g.nodes;

  const tryPlace = (kind: PropKind, x: number, z: number, yaw: number, offset: number, edge: string, junctionClear: number) => {
    if (excluded(x, z)) return false;
    if (idx.junctionDist(x, z) < junctionClear) return false;
    // the prop's own footprint must be off every other carriageway (cars are wider)
    const extra = kind === "car" ? 1.1 : kind === "tree" ? 1.2 : 0.4;
    if (!idx.clearOfRoads(x, z, extra, edge)) return false;
    for (const [r, kinds] of SPACING[kind]) if (hash.near(x, z, r, kinds)) return false;
    const p: Prop = { kind, x, z, yaw, offset, edge, v: rand() };
    out.push(p);
    hash.add(p);
    return true;
  };

  const streets = idx.edges.filter((e) => {
    if (e.kind !== "street") return false;
    const a = nodes.get(e.a)!;
    const b = nodes.get(e.b)!;
    return !(a.zone === "downtown" && b.zone === "downtown");
  });

  // Pass order matters: kerb items first, then the back of the pavement, then parked cars fill the gaps.
  const passes = ["kerb", "back", "cars"] as const;
  for (const pass of passes)
    for (const e of streets) {
      const a = nodes.get(e.a)!;
      const b = nodes.get(e.b)!;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 4) continue;
      const dx = (b.x - a.x) / len;
      const dz = (b.z - a.z) / len;
      // left of travel a -> b (matches roads.lanePosition): (dz, -dx)
      const lx = dz;
      const lz = -dx;
      const zone = a.zone === "highway" ? b.zone : a.zone;
      const works = WORKS.has(zone);
      const at = (t: number, side: number, off: number): [number, number] => [a.x + dx * t + lx * off * side, a.z + dz * t + lz * off * side];
      const faceAB = Math.atan2(-dx, -dz); // faces drivers travelling a -> b
      const faceBA = Math.atan2(dx, dz);
      const juncA = idx.isJunction(e.a);
      const juncB = idx.isJunction(e.b);

      if (pass === "kerb") {
        // speed limit after leaving a junction, give way / keep left before entering one (left kerb, UK)
        if (len >= 30) {
          if (juncA && rand() < 0.6) tryPlace("signSpeed", ...at(12, 1, OFFSET.sign), faceAB, OFFSET.sign, e.key, JUNCTION_CLEAR.default);
          if (juncB && rand() < 0.6) tryPlace("signSpeed", ...at(len - 12, -1, OFFSET.sign), faceBA, OFFSET.sign, e.key, JUNCTION_CLEAR.default);
        }
        if (len >= 18) {
          const before = (): PropKind => (rand() < 0.55 ? "signGiveWay" : "signKeepLeft");
          if (juncB) tryPlace(before(), ...at(len - 8, 1, OFFSET.sign), faceAB, OFFSET.sign, e.key, 6);
          if (juncA) tryPlace(before(), ...at(8, -1, OFFSET.sign), faceBA, OFFSET.sign, e.key, 6);
        }
        // corner bollards at junction mouths
        for (const [isJ, t0, dir] of [[juncA, 6, 1], [juncB, len - 6, -1]] as const) {
          if (!isJ || len < 16 || rand() < 0.35) continue;
          for (const side of [1, -1])
            for (let k = 0; k < 3; k++) {
              const t = t0 + dir * k * 1.2;
              tryPlace("bollard", ...at(t, side, OFFSET.bollard), 0, OFFSET.bollard, e.key, JUNCTION_CLEAR.bollard);
            }
        }
        if (!works && len >= 40 && rand() < Math.min(0.9, len / 200)) {
          const side = rand() < 0.5 ? 1 : -1;
          tryPlace("busStop", ...at(len * (0.35 + rand() * 0.3), side, OFFSET.busStop), side > 0 ? faceAB : faceBA, OFFSET.busStop, e.key, 16);
        }
      } else if (pass === "back") {
        for (const side of [1, -1]) {
          // arm reaches back over the road: local +z -> -left*side
          const lampYaw = Math.atan2(-lx * side, -lz * side);
          const kerbYaw = lampYaw;
          const phase = rand() * 15;
          if (!works)
            for (let t = phase; t < len; t += 13 + rand() * 4)
              tryPlace("tree", ...at(t, side, OFFSET.tree), rand() * Math.PI * 2, OFFSET.tree, e.key, JUNCTION_CLEAR.default);
          // lamps staggered across the two sides
          for (let t = (side > 0 ? 6 : 21) + rand() * 3; t < len; t += 30)
            tryPlace("lamp", ...at(t, side, OFFSET.lamp), lampYaw, OFFSET.lamp, e.key, 4);
          for (let t = 10 + rand() * 20; t < len; t += 35 + rand() * 30)
            tryPlace("bin", ...at(t, side, OFFSET.bin), kerbYaw, OFFSET.bin, e.key, JUNCTION_CLEAR.default);
          if (!works && rand() < 0.25 && len > 30)
            tryPlace("neon", ...at(len * (0.2 + rand() * 0.6), side, OFFSET.neon), kerbYaw, OFFSET.neon, e.key, JUNCTION_CLEAR.default);
        }
      } else if (!works) {
        for (const side of [1, -1]) {
          const yaw = side > 0 ? faceBA : faceAB; // parked facing the direction of travel on that side
          for (let t = 2 + rand() * 4; t < len - 2; t += 5.6) {
            if (rand() < 0.42) continue;
            tryPlace("car", ...at(t, side, OFFSET.car), yaw, OFFSET.car, e.key, JUNCTION_CLEAR.car);
          }
        }
      }
    }
  return out;
}

// ---------------------------------------------------------------- highways

function buildVerges(idx: RoadIndex, rand: () => number) {
  const verges: Verge[] = [];
  const shrubs: Shrub[] = [];
  const nodes = idx.g.nodes;
  const mid = (VERGE.inner + VERGE.outer) / 2;
  const width = VERGE.outer - VERGE.inner;
  for (const e of idx.edges) {
    if (e.kind !== "highway") continue;
    const a = nodes.get(e.a)!;
    const b = nodes.get(e.b)!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 2) continue;
    const dx = (b.x - a.x) / len;
    const dz = (b.z - a.z) / len;
    const lx = dz;
    const lz = -dx;
    const n = Math.max(1, Math.round(len / VERGE.chunk));
    const cl = len / n;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) * cl;
      for (const side of [1, -1]) {
        const x = a.x + dx * t + lx * mid * side;
        const z = a.z + dz * t + lz * mid * side;
        if (excluded(x, z) || !idx.clearOfRoads(x, z, width / 2 + 0.6, e.key)) continue;
        // also check both chunk ends so strips never poke into a joining road
        const ex = (dx * cl) / 2;
        const ez = (dz * cl) / 2;
        if (!idx.clearOfRoads(x + ex, z + ez, width / 2 + 0.3, e.key) || !idx.clearOfRoads(x - ex, z - ez, width / 2 + 0.3, e.key)) continue;
        verges.push({ x, z, yaw: Math.atan2(-dz, dx), len: cl + 0.05, width, edge: e.key });
        if (rand() < 0.7) {
          const count = 1 + Math.floor(rand() * 3);
          for (let s = 0; s < count; s++) {
            const off = VERGE.outer + 0.6 + rand() * 3.5;
            const tt = t + (rand() - 0.5) * cl;
            const sx = a.x + dx * tt + lx * off * side;
            const sz = a.z + dz * tt + lz * off * side;
            if (excluded(sx, sz) || !idx.clearOfRoads(sx, sz, 2.4, e.key)) continue;
            shrubs.push({ x: sx, z: sz, s: 0.7 + rand() * 0.9, v: rand() });
          }
        }
      }
    }
  }
  return { verges, shrubs };
}

export const BILLBOARD = { width: 12, height: 4.5, legs: 6, back: 30, side: 17, minGap: 45 } as const;
export const AD_COUNT = 8;

function buildBillboards(idx: RoadIndex, rand: () => number): Billboard[] {
  const out: Billboard[] = [];
  const nodes = idx.g.nodes;
  const adj = new Map<string, GEdge[]>();
  for (const e of idx.edges) {
    for (const id of [e.a, e.b]) {
      const arr = adj.get(id);
      if (arr) arr.push(e);
      else adj.set(id, [e]);
    }
  }
  const ids = [...nodes.keys()].sort();
  for (const id of ids) {
    const es = adj.get(id) ?? [];
    if (es.length < 3 || !es.some((e) => e.kind === "highway")) continue;
    const n = nodes.get(id)!;
    let placed = 0;
    for (const e of es) {
      if (e.kind !== "highway" || placed >= 2) continue;
      const o = nodes.get(e.a === id ? e.b : e.a)!;
      const len = Math.hypot(o.x - n.x, o.z - n.z);
      if (len < BILLBOARD.back + 4) continue;
      const dx = (o.x - n.x) / len;
      const dz = (o.z - n.z) / len;
      for (const side of rand() < 0.5 ? [1, -1] : [-1, 1]) {
        const x = n.x + dx * BILLBOARD.back + dz * BILLBOARD.side * side;
        const z = n.z + dz * BILLBOARD.back - dx * BILLBOARD.side * side;
        // ad faces traffic driving towards the junction along this edge
        const yaw = Math.atan2(dx, dz);
        const hw = BILLBOARD.width / 2;
        const ok = [-hw, 0, hw].every((u) => {
          const px = x + dz * u;
          const pz = z - dx * u;
          return !excluded(px, pz) && idx.clearOfRoads(px, pz, 3);
        });
        if (!ok || out.some((bb) => Math.hypot(bb.x - x, bb.z - z) < BILLBOARD.minGap)) continue;
        out.push({ x, z, yaw, ad: Math.floor(rand() * AD_COUNT), node: id });
        placed++;
        break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- entry point

export function buildStreetscape(g: Graph = worldGraph(), seed = 4242): Streetscape {
  const idx = new RoadIndex(g);
  const props = buildProps(idx, mulberry32(seed));
  const { verges, shrubs } = buildVerges(idx, mulberry32(seed + 1));
  const billboards = buildBillboards(idx, mulberry32(seed + 2));
  return { props, verges, shrubs, billboards };
}
