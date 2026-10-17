// District roads: motorway (the "M25" outer orbital). Owned by the motorway agent.
//
// A C-shaped dual carriageway along config MOTORWAY.points, open to the sea in the east, with a node every
// ~40-60 m and gentle circular corners (6 nodes per corner). Radial links tie it into the city.
//
// JUNCTIONS other districts may connect to (all are nodes on the main carriageway unless noted). Districts are
// merged AFTER this one, so they connect to these ids from their own files (this file can't see their nodes):
//   mw_j_ne     (300,-700)  north-east terminus; slip road south to the river (mw_bridge_e_n)
//   mw_j_north  (-680,-700) Hampstead junction, north of the river: the Bridges agent's Orbital Viaduct (br_mw_top) joins here
//   mw_j_nw     (-880,-470) airport junction (west side, south of the river); link east to airport_gate
//   mw_j_hp     (-700,-470) node on the airport link where the Orbital Viaduct's south end (br_mw_bot) joins
//   mw_j_west   (-880,0)    Old Town junction: Old Town's west lane should end at this node
//   mw_j_svc    (-880,400)  services (fuel, food court, lorry park)
//   mw_j_sw     (-465,760)  Southbank junction; link north along x=-465 then east to ring h_12 (nodes mw_sw_*)
//   mw_j_south  (70,760)    city junction; link north along x=70 (between depot and industrial) to ring h_9 (mw_south_*)
//   mw_j_se     (300,760)   south-east terminus; coast road north along x=336 to dock_s (nodes mw_cs_*)
// Link-road nodes are also fair game: mw_cs_* (coast road by the container terminal / industrial east edge),
// mw_cn_* (coast road past Shoreditch's east edge to dock_n), mw_sw_*, mw_south_*, mw_nw_*.
//
// RIVER: the main carriageway crosses the river on its own viaduct on the west side (x = -880, drawn by the
// Motorway module). No other motorway edge crosses the river. The Hampstead crossing at x = -700 is the Bridges
// agent's Orbital Viaduct (mw_j_north <-> mw_j_hp). One stub pair still waits for a bridge:
//   mw_bridge_e_n (336,-676) north bank <-> mw_bridge_e_s (336,-562) south bank  (coast road to the docks)
import { MOTORWAY } from "../config";
import type { RoadKind } from "../roads";
import type { DistrictEdge, DistrictNode, DistrictRoads } from "./types";

export type P2 = [number, number];

export const MW_SPACING = 50; // target node spacing on the main carriageway
export const MW_MAX_SPACING = 60;
export const MW_CORNER_RADIUS = 150; // main corners: 90 deg arc of 236 m => 5 segments, 6 nodes
const LINK_RADIUS = 40;
const LINK_SPACING = 45;

// Existing (Layer 1) node positions we link to. roads.ts imports this file, so we can't import it back.
const EXISTING: Record<string, P2> = {
  h_9: [110, 220],
  h_12: [-220, 220],
  airport_gate: [-260, -260],
  dock_n: [300, -60],
  dock_s: [300, 60],
};

// ---------------------------------------------------------------------------------------------------------
// Pure geometry helpers (exported for tests and for the Motorway module)

export interface DensePath {
  pts: P2[];
  cum: number[]; // arc length at each point
  /** arc length of each corner's [start, end] tangent point */
  corners: [number, number][];
}

/** A polyline with every interior corner replaced by a circular arc of (at most) `radius`, densely sampled. */
export function roundCorners(points: readonly P2[], radius: number, step = 2): DensePath {
  const pts: P2[] = [[points[0][0], points[0][1]]];
  const corners: [number, number][] = [];
  const cum = [0];
  const push = (p: P2) => {
    const q = pts[pts.length - 1];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d < 1e-6) return;
    pts.push(p);
    cum.push(cum[cum.length - 1] + d);
  };
  for (let i = 1; i < points.length - 1; i++) {
    const [px, pz] = points[i];
    const [ax, az] = points[i - 1];
    const [bx, bz] = points[i + 1];
    const l1 = Math.hypot(px - ax, pz - az);
    const l2 = Math.hypot(bx - px, bz - pz);
    const ux = (px - ax) / l1, uz = (pz - az) / l1;
    const vx = (bx - px) / l2, vz = (bz - pz) / l2;
    const theta = Math.acos(Math.max(-1, Math.min(1, ux * vx + uz * vz)));
    if (theta < 1e-3) {
      push([px, pz]);
      continue;
    }
    const t = Math.min(radius * Math.tan(theta / 2), l1 / 2, l2 / 2);
    const r = t / Math.tan(theta / 2);
    const sgn = Math.sign(ux * vz - uz * vx);
    const A: P2 = [px - ux * t, pz - uz * t];
    const cx = A[0] + -uz * sgn * r, cz = A[1] + ux * sgn * r;
    push(A);
    const sA = cum[cum.length - 1];
    const a0 = Math.atan2(A[1] - cz, A[0] - cx);
    const n = Math.max(2, Math.ceil((r * theta) / step));
    for (let k = 1; k <= n; k++) {
      const a = a0 + (sgn * theta * k) / n;
      push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
    corners.push([sA, cum[cum.length - 1]]);
  }
  const last = points[points.length - 1];
  push([last[0], last[1]]);
  return { pts, cum, corners };
}

export function pointAt(d: DensePath, s: number): P2 {
  const { pts, cum } = d;
  if (s <= 0) return pts[0];
  if (s >= cum[cum.length - 1]) return pts[pts.length - 1];
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const f = (s - cum[lo]) / (cum[hi] - cum[lo]);
  return [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * f, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * f];
}

/** Arc length of the point on the path nearest to p. */
export function projectS(d: DensePath, p: P2): number {
  let best = Infinity, bestS = 0;
  for (let i = 0; i < d.pts.length - 1; i++) {
    const [ax, az] = d.pts[i];
    const [bx, bz] = d.pts[i + 1];
    const dx = bx - ax, dz = bz - az;
    const L2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - az) * dz) / L2));
    const dist = Math.hypot(ax + dx * t - p[0], az + dz * t - p[1]);
    if (dist < best) {
      best = dist;
      bestS = d.cum[i] + Math.sqrt(L2) * t;
    }
  }
  return bestS;
}

/**
 * Sample the path so every anchor (arc length) is exactly a sample, and pieces between anchors are split into
 * equal steps no longer than maxSpacing. Returns arc lengths, each tagged with its anchor index (or -1).
 */
export function resample(d: DensePath, anchors: number[], maxSpacing: number): { s: number; anchor: number }[] {
  const total = d.cum[d.cum.length - 1];
  const marks = anchors.map((s, i) => ({ s, i }));
  if (!marks.some((m) => m.s < 0.5)) marks.push({ s: 0, i: -1 });
  if (!marks.some((m) => m.s > total - 0.5)) marks.push({ s: total, i: -1 });
  marks.sort((a, b) => a.s - b.s);
  const out: { s: number; anchor: number }[] = [{ s: marks[0].s, anchor: marks[0].i }];
  for (let k = 1; k < marks.length; k++) {
    const s0 = marks[k - 1].s, s1 = marks[k].s;
    if (s1 - s0 < 0.5) continue;
    // aim for ~5/6 of the max spacing (50 m of 60), never above the max
    const L = s1 - s0;
    let n = Math.max(1, Math.round(L / (maxSpacing * (5 / 6))));
    if (L / n > maxSpacing) n++;
    for (let j = 1; j < n; j++) out.push({ s: s0 + (L * j) / n, anchor: -1 });
    out.push({ s: s1, anchor: marks[k].i });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Main carriageway

export interface Junction {
  id: string;
  at: P2;
  /** gantry sign: junction number and destinations */
  num: number;
  dest: [string, string];
}

const MP = MOTORWAY.points;
export const MW_JUNCTIONS: Junction[] = [
  { id: "mw_j_ne", at: MP[0], num: 1, dest: ["DOCKS ↓", "SHOREDITCH"] },
  { id: "mw_j_north", at: [-680, -700], num: 2, dest: ["HAMPSTEAD", "HEATH ↑"] },
  { id: "mw_j_nw", at: [-880, -470], num: 3, dest: ["AIRPORT ✈", "CITY →"] },
  { id: "mw_j_west", at: [-880, 0], num: 4, dest: ["OLD TOWN", "CATHEDRAL →"] },
  { id: "mw_j_svc", at: [-880, 400], num: 5, dest: ["SERVICES", "FUEL · FOOD"] },
  { id: "mw_j_sw", at: [-465, 760], num: 6, dest: ["SOUTHBANK", "CITY ↑"] },
  { id: "mw_j_south", at: [70, 760], num: 7, dest: ["CITY CENTRE", "DEPOT ↑"] },
  { id: "mw_j_se", at: MP[MP.length - 1], num: 8, dest: ["DOCKS ↑", "INDUSTRY"] },
];

export const MW_PATH = roundCorners(MP, MW_CORNER_RADIUS);

const nodes: DistrictNode[] = [];
const edges: DistrictEdge[] = [];
const pos = new Map<string, P2>(Object.entries(EXISTING));
const addNode = (id: string, p: P2) => {
  nodes.push({ id, x: Math.round(p[0] * 10) / 10, z: Math.round(p[1] * 10) / 10, zone: "highway" });
  pos.set(id, p);
};
const addEdge = (a: string, b: string, kind: RoadKind) => edges.push({ a, b, kind });

/** Ordered ids of the main carriageway, NE terminus -> west side -> SE terminus. */
export const MW_MAIN: string[] = (() => {
  const jS = MW_JUNCTIONS.map((j) => projectS(MW_PATH, j.at));
  const anchors = [...jS, ...MW_PATH.corners.flat()];
  const ids: string[] = [];
  let k = 0;
  for (const smp of resample(MW_PATH, anchors, MW_MAX_SPACING)) {
    const id = smp.anchor >= 0 && smp.anchor < MW_JUNCTIONS.length ? MW_JUNCTIONS[smp.anchor].id : `mw_${k++}`;
    addNode(id, pointAt(MW_PATH, smp.s));
    if (ids.length) addEdge(ids[ids.length - 1], id, "highway");
    ids.push(id);
  }
  return ids;
})();

// ---------------------------------------------------------------------------------------------------------
// Links: a polyline from `from` to `to` (each an existing id, or a new id with a position), rounded and sampled.

interface LinkEnd {
  id: string;
  at?: P2; // set => create this node
}

function link(
  name: string,
  from: LinkEnd,
  to: LinkEnd,
  via: P2[],
  opts: { kind?: RoadKind; endKind?: RoadKind; stops?: { id: string; at: P2 }[] } = {},
): string[] {
  const kind = opts.kind ?? "highway";
  const endKind = opts.endKind ?? "ramp";
  for (const e of [from, to]) if (e.at) addNode(e.id, e.at);
  const a = pos.get(from.id)!;
  const b = pos.get(to.id)!;
  const path = roundCorners([a, ...via, b], LINK_RADIUS);
  const stops = opts.stops ?? [];
  const samples = resample(path, [...stops.map((st) => projectS(path, st.at)), ...path.corners.flat()], LINK_SPACING);
  const ids: string[] = [];
  let k = 0;
  samples.forEach((smp, i) => {
    let id: string;
    if (i === 0) id = from.id;
    else if (i === samples.length - 1) id = to.id;
    else if (smp.anchor >= 0 && smp.anchor < stops.length) id = stops[smp.anchor].id;
    else id = `mw_${name}_${k++}`;
    if (i > 0 && i < samples.length - 1) addNode(id, pointAt(path, smp.s));
    if (ids.length) addEdge(ids[ids.length - 1], id, i === 1 || i === samples.length - 1 ? endKind : kind);
    ids.push(id);
  });
  return ids;
}

/** Every link road, by name, as ordered node ids (for the Motorway module's props). */
export const MW_LINKS: Record<string, string[]> = {
  // Airport + city: east along z = -470 (south of the river), down x = -480, along z = -236 to the airport gate.
  airport: link("nw", { id: "mw_j_nw" }, { id: "airport_gate" }, [[-480, -470], [-480, -236], [-280, -236]], {
    stops: [{ id: "mw_j_hp", at: [-700, -470] }],
  }),
  // Southbank / city: north along x = -465 then east along z = 236 to the ring's SW corner.
  southwest: link("sw", { id: "mw_j_sw" }, { id: "h_12" }, [[-465, 236], [-240, 236]]),
  // City centre: north along x = 70 (between the depot and industry) to the ring's south side.
  south: link("south", { id: "mw_j_south" }, { id: "h_9" }, [[70, 280]]),
  // Docks south: coast road north along the sea wall past industry and the container terminal.
  coastSouth: link("cs", { id: "mw_j_se" }, { id: "dock_s" }, [[336, 720], [336, 105]], { kind: "ramp" }),
  // Docks north: terminus -> north river bank (bridge stub), then south bank -> coast road -> dock_n.
  coastNorthStub: link("cnb", { id: "mw_j_ne" }, { id: "mw_bridge_e_n", at: [336, -676] }, [], { kind: "ramp" }),
  coastNorth: link("cn", { id: "mw_bridge_e_s", at: [336, -562] }, { id: "dock_n" }, [[336, -105]], {
    kind: "ramp",
  }),
  // Services: spur into the service area, with roads to the forecourt, car park and lorry park.
  services: link("svc", { id: "mw_j_svc" }, { id: "mw_svc_hub", at: [-790, 440] }, [], { kind: "ramp" }),
};
// Service area internal roads (short, straight)
const SVC: [string, P2][] = [
  ["mw_svc_fuel", [-748, 412]],
  ["mw_svc_fuel_e", [-712, 412]],
  ["mw_svc_cars", [-748, 478]],
  ["mw_svc_cars_e", [-650, 478]],
  ["mw_svc_lorry", [-782, 528]],
  ["mw_svc_lorry_e", [-690, 528]],
];
for (const [id, p] of SVC) addNode(id, p);
addEdge("mw_svc_hub", "mw_svc_fuel", "street");
addEdge("mw_svc_fuel", "mw_svc_fuel_e", "street");
addEdge("mw_svc_hub", "mw_svc_cars", "street");
addEdge("mw_svc_cars", "mw_svc_cars_e", "street");
addEdge("mw_svc_hub", "mw_svc_lorry", "street");
addEdge("mw_svc_lorry", "mw_svc_lorry_e", "street");

export const motorway: DistrictRoads = { nodes, edges };
