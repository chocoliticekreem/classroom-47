// District roads: bridges. Owned by the bridges agent (module River). Every road that crosses the river
// lives here: four street bridges, the Orbital Viaduct (x = -700, joins the motorway at mw_j_north / mw_j_hp),
// and the Coast Lift Bridge at the river mouth (x = 336, links mw_bridge_e_n <-> mw_bridge_e_s). A south
// embankment road (`br_sbank_*`) ties the bridges' south ends together and down into the suburbs.
// North ends join the motorway's north side (z = -700) by short spurs to the nearest `mw_*` node (the motorway
// then links into Hampstead). A short north embankment road (`br_nbank_*`) only exists where it's well clear
// of the motorway (south of z = -685 and > 20 m from it).
//
// All bridges run north-south (along z). Node layout for bridge <id> at x (c = riverZAt(x)):
//   br_<id>_n  (x, c - BANK_ROAD)   north end (omitted when it would sit within 20 m of the motorway)
//   br_<id>_nd (x, c - ABUT)        north abutment (deck starts)
//   br_<id>_sd (x, c + ABUT)        south abutment
//   br_<id>_s  (x, c + BANK_ROAD)   south end, on the south embankment road
// The span edge is nd <-> sd: that's what the lifting bridges block (spanEdge()).
// Merged LAST (see index.ts), so `mw_*` / `sh_*` nodes are visible here; other districts can't link to br_*.
import { RIVER } from "../config";
import type { RoadKind } from "../roads";
import { hampstead } from "./hampstead";
import { motorway } from "./motorway";
import { shoreditch } from "./shoreditch";
import type { DistrictEdge, DistrictNode, DistrictRoads } from "./types";

export type BridgeStyle = "viaduct" | "suspension" | "arch" | "footbridge" | "stone" | "tower" | "lift";

export interface BridgeSpec {
  id: string;
  name: string;
  x: number;
  style: BridgeStyle;
  /** Road kind on the span; null = pedestrian only (not part of the road graph). */
  kind: RoadKind | null;
  /** Half width of the visible deck (m). */
  halfWidth: number;
}

export const BRIDGES: readonly BridgeSpec[] = [
  { id: "mw", name: "Orbital Viaduct", x: -700, style: "viaduct", kind: "highway", halfWidth: 9 },
  { id: "alb", name: "Albert Bridge", x: -430, style: "suspension", kind: "street", halfWidth: 7 },
  { id: "arch", name: "Battersea Arch", x: -200, style: "arch", kind: "street", halfWidth: 7 },
  { id: "foot", name: "Millennium Footbridge", x: -110, style: "footbridge", kind: null, halfWidth: 2.6 },
  { id: "wm", name: "Westminster Bridge", x: 60, style: "stone", kind: "street", halfWidth: 7.5 },
  { id: "tower", name: "Tower Bridge", x: 240, style: "tower", kind: "street", halfWidth: 7 },
  { id: "coast", name: "Coast Lift Bridge", x: 336, style: "lift", kind: "highway", halfWidth: 9 },
];

/** Bridges that open for the tall ship (bascule / vertical lift). */
export const OPENING = ["tower", "coast"] as const;

/** Distances from the river centre line (m). Water is +-RIVER.width/2 = 35, promenade to ~50. */
export const ABUT = 44;
export const BANK_ROAD = 62;

/** z of the river polyline at x (linear; clamps beyond the ends). */
export function riverZAt(x: number): number {
  const pts = RIVER.points;
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [x0, z0] = pts[i - 1];
    const [x1, z1] = pts[i];
    if (x <= x1) return z0 + ((z1 - z0) * (x - x0)) / (x1 - x0);
  }
  return pts[pts.length - 1][1];
}

function segIntersect(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number) {
  const d = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx);
  if (Math.abs(d) < 1e-9) return false;
  const t = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / d;
  const u = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/** How many times the segment a-b crosses the river centre polyline. */
export function riverCrossings(ax: number, az: number, bx: number, bz: number): number {
  const pts = RIVER.points;
  let n = 0;
  for (let i = 1; i < pts.length; i++)
    if (segIntersect(ax, az, bx, bz, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1])) n++;
  return n;
}

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}

/** Minimum distance between segment a-b and the river centre polyline (sampled every 5 m along a-b). */
export function riverDistance(ax: number, az: number, bx: number, bz: number): number {
  if (riverCrossings(ax, az, bx, bz) > 0) return 0;
  const pts = RIVER.points;
  const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 5));
  let best = Infinity;
  for (let k = 0; k <= steps; k++) {
    const px = ax + ((bx - ax) * k) / steps;
    const pz = az + ((bz - az) * k) / steps;
    for (let i = 1; i < pts.length; i++) best = Math.min(best, segDist(px, pz, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
  }
  return best;
}

/** Edge keys a span blocks (Tower Bridge lifting). Same format as roads.edgeKey. */
export function spanEdge(id: string): [string, string] {
  return [`br_${id}_nd`, `br_${id}_sd`];
}

// ---------------------------------------------------------------------------------------------------

const nodes: DistrictNode[] = [];
const edges: DistrictEdge[] = [];
const pos = new Map<string, [number, number]>();

function node(id: string, x: number, z: number, zone: DistrictNode["zone"]) {
  nodes.push({ id, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, zone });
  pos.set(id, [x, z]);
}
function edge(a: string, b: string, kind: RoadKind) {
  edges.push({ a, b, kind });
}

// Our nodes aren't in a zone box of our own; use the closest named one for "random node in zone" queries.
const NORTH_ZONE: DistrictNode["zone"] = "hampstead";
const SOUTH_ZONE: DistrictNode["zone"] = "suburbs";

type Ext = { id: string; x: number; z: number };
const mwNodes: Ext[] = motorway.nodes.filter((n) => n.id.startsWith("mw_"));
const mwPos = new Map(mwNodes.map((n) => [n.id, n] as const));
const mwSegs = motorway.edges
  .filter((e) => mwPos.has(e.a) && mwPos.has(e.b))
  .map((e) => [mwPos.get(e.a)!, mwPos.get(e.b)!] as const);
const extPos = (id: string): [number, number] | undefined => {
  const p = pos.get(id);
  if (p) return p;
  const m = mwPos.get(id) ?? shoreditch.nodes.find((n) => n.id === id);
  return m ? [m.x, m.z] : undefined;
};

/** Distance from a point to the nearest motorway edge (Infinity if there's no motorway). */
export function motorwayDistance(x: number, z: number): number {
  let best = Infinity;
  for (const [a, b] of mwSegs) best = Math.min(best, segDist(x, z, a.x, a.z, b.x, b.z));
  return best;
}
const MW_CLEAR = 20;
const clearOfMotorway = (x: number, z: number) => motorwayDistance(x, z) > MW_CLEAR && z > -685;

/** Nearest node in `pool` on the given bank, within maxDist, whose link wouldn't touch the river. */
function nearest(from: [number, number], pool: Ext[], maxDist: number, wantNorth: boolean): Ext | null {
  const [fx, fz] = from;
  let best: Ext | null = null;
  let bestD = maxDist;
  for (const n of pool) {
    const d = Math.hypot(n.x - fx, n.z - fz);
    if (d >= bestD) continue;
    if (n.z < riverZAt(n.x) !== wantNorth) continue;
    if (riverDistance(fx, fz, n.x, n.z) < RIVER.width / 2 + 6) continue;
    best = n;
    bestD = d;
  }
  return best;
}

/** The north end id of each road bridge (ours or a motorway node), and its south end id. */
export const BRIDGE_ENDS: Record<string, { north: string; south: string }> = {};

const roadBridges = BRIDGES.filter((b) => b.kind);

// 1) Bridge spans and their north spurs.
for (const b of roadBridges) {
  const c = riverZAt(b.x);
  const kind = b.kind!;
  const nd = `br_${b.id}_nd`;
  const sd = `br_${b.id}_sd`;
  node(nd, b.x, c - ABUT, NORTH_ZONE);
  node(sd, b.x, c + ABUT, SOUTH_ZONE);
  edge(nd, sd, kind);

  if (b.id === "coast") {
    // the motorway's coast road stubs either side of the river mouth
    const n = mwPos.has("mw_bridge_e_n") ? "mw_bridge_e_n" : null;
    const s = mwPos.has("mw_bridge_e_s") ? "mw_bridge_e_s" : null;
    if (n) edge(n, nd, kind);
    if (s) edge(sd, s, kind);
    BRIDGE_ENDS[b.id] = { north: n ?? nd, south: s ?? sd };
    continue;
  }

  // south end on the embankment road
  const s = `br_${b.id}_s`;
  node(s, b.x, c + BANK_ROAD, SOUTH_ZONE);
  edge(sd, s, kind);

  // north end: our own node if it's clear of the motorway, then a spur to the nearest motorway node
  let north = nd;
  const nz = c - BANK_ROAD;
  if (clearOfMotorway(b.x, nz)) {
    north = `br_${b.id}_n`;
    node(north, b.x, nz, NORTH_ZONE);
    edge(nd, north, kind);
  }
  const target = b.id === "mw" && mwPos.has("mw_j_north") ? mwPos.get("mw_j_north")! : nearest(pos.get(north)!, mwNodes, 90, true);
  if (target) edge(north, target.id, kind);
  BRIDGE_ENDS[b.id] = { north, south: s };
}

// Orbital Viaduct south: on to the motorway's airport link at mw_j_hp (-700,-470).
{
  const mw = BRIDGES.find((b) => b.id === "mw")!;
  node("br_mw_bot", mw.x, -505, SOUTH_ZONE);
  edge("br_mw_s", "br_mw_bot", "highway");
  if (mwPos.has("mw_j_hp")) edge("br_mw_bot", "mw_j_hp", "highway");
}

// 2) Embankment roads, a node every ~25 m, gently following the river.
function bankRoad(side: "n" | "s", x0: number, x1: number): string[] {
  const sign = side === "n" ? -1 : 1;
  const zone = side === "n" ? NORTH_ZONE : SOUTH_ZONE;
  const ends = roadBridges.filter((b) => b.x >= x0 && b.x <= x1 && pos.has(`br_${b.id}_${side}`));
  const xs = new Set<number>(ends.map((b) => b.x));
  for (let x = x0; x <= x1; x += 25) if (ends.every((b) => Math.abs(b.x - x) > 10)) xs.add(x);
  const ids: string[] = [];
  for (const x of [...xs].sort((a, b) => a - b)) {
    const br = ends.find((b) => b.x === x);
    if (br) {
      ids.push(`br_${br.id}_${side}`);
      continue;
    }
    const wig = side === "s" ? 3 * Math.sin(x * 0.013) + 2 * Math.sin(x * 0.031 + 1) : 1.5 * Math.sin(x * 0.02);
    const z = riverZAt(x) + sign * (BANK_ROAD + wig);
    if (side === "n" && !clearOfMotorway(x, z)) return []; // all or nothing: never run along the motorway
    const id = `br_${side}bank_${x < 0 ? "m" + -x : x}`;
    node(id, x, z, zone);
    ids.push(id);
  }
  for (let i = 1; i < ids.length; i++) edge(ids[i - 1], ids[i], "street");
  return ids;
}
// North: only between the Orbital Viaduct and Albert Bridge, where there's room below the motorway.
const north = pos.has("br_mw_n") && pos.has("br_alb_n") ? bankRoad("n", -700, -430) : [];
const south = bankRoad("s", -740, 300);

// 3) South links down to the suburbs, winding a little.
function link(prefix: string, from: string, pts: [number, number][], to: string, kind: RoadKind = "street") {
  let prev = from;
  pts.forEach(([x, z], i) => {
    const id = `${prefix}_${i}`;
    node(id, x, z, SOUTH_ZONE);
    edge(prev, id, kind);
    prev = id;
  });
  edge(prev, to, kind);
}
const nearestOn = (ids: string[], x: number) =>
  ids.reduce((best, id) => (Math.abs(pos.get(id)![0] - x) < Math.abs(pos.get(best)![0] - x) ? id : best), ids[0]);
{
  const w = nearestOn(south, -60);
  const [wx, wz] = pos.get(w)!;
  link("br_lnk_w", w, [[wx - 3, wz + 40], [-66, -470], [-63, -420], [-58, -375]], "sub_-1_1");
  const e = nearestOn(south, 60);
  const [ex, ez] = pos.get(e)!;
  link("br_lnk_e", e, [[ex + 4, ez + 40], [66, -480], [62, -430], [57, -380]], "sub_1_1");
}

// 4) East end of the south embankment: into Shoreditch's riverside road and the motorway coast road.
{
  const end = south[south.length - 1];
  const p = pos.get(end)!;
  const sh = nearest(p, shoreditch.nodes.filter((n) => n.id.startsWith("sh_")), 60, false);
  if (sh) edge(end, sh.id, "street");
  const cs = mwPos.get("mw_bridge_e_s");
  if (cs && Math.hypot(cs.x - p[0], cs.z - p[1]) < 60) edge(end, cs.id, "street");
}

// 5) Fallback: if Hampstead hasn't wired its connectors to anything outside itself yet, spur them onto the
// nearest motorway node so the north side stays connected. Switches itself off once Hampstead links up.
{
  const hpLinked = hampstead.edges.some((e) => !e.a.startsWith("hp_") || !e.b.startsWith("hp_"));
  if (!hpLinked) {
    for (const id of ["hp_link_south", "hp_link_village"]) {
      const n = hampstead.nodes.find((h) => h.id === id);
      if (!n) continue;
      const m = nearest([n.x, n.z], mwNodes, 40, true);
      if (m) edge(id, m.id, "street");
    }
  }
}

export const bridges: DistrictRoads = { nodes, edges };

export const BANK_ROADS = { north, south };
/** Position of any node referenced by this district (ours, motorway or Shoreditch). For tests. */
export const nodePos = extPos;
