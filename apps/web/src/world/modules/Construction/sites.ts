// Construction sites: where they go (clear of roads, zones, the river, the sea and the western hills)
// and how each one is laid out. Pure data, no three.js: unit-tested.
import { RIVER, WATER_X, ZONES, type Box } from "../../config";
import { ROAD_EDGES, ROAD_NODES, getNode, neighbours, type RoadKind } from "../../roads";
import { hillHeight, makeHills } from "../Countryside/layout";
import type { CranePlan } from "./crane";
import { boxAround, boxesOverlap, mulberry32, pointBoxDist, segBoxDist } from "./geom2d";
import type { DumpRun } from "./machines";

/** Drawn half widths of each road kind (Roads module). */
export const ROAD_HALF: Record<RoadKind, number> = { street: 4, highway: 6, ramp: 4, country: 3 };
export const ROAD_CLEARANCE = 10; // metres from the road's edge to the hoarding
export const ZONE_MARGIN = 4;
export const RIVER_CLEARANCE = 15;
export const SITE_GAP = 40; // between two sites' hoardings
export const FLOOR_H = 3.6;
export const SLAB_T = 0.35;
export const MAX_SITES = 7;
export const MIN_SITES = 5;

export interface Candidate {
  id: string;
  x: number;
  z: number;
  hx: number; // half extents in the site's local frame (before the quarter turn)
  hz: number;
  q: 0 | 1 | 2 | 3; // quarter turns about y
  floors: number;
  cranes: 1 | 2;
  glaze: number; // fraction of floors already glazed
}

/**
 * In priority order. Two half-built towers in the gaps between downtown and the ring, then sites in the
 * open land between the ring and the Layer 2 districts. Extras are fallbacks if district roads take a spot.
 */
export const CANDIDATES: readonly Candidate[] = [
  { id: "ne-corner", x: 189, z: -189, hx: 14.5, hz: 14.5, q: 0, floors: 15, cranes: 1, glaze: 0.35 },
  { id: "sw-corner", x: -189, z: 189, hx: 14.5, hz: 14.5, q: 2, floors: 12, cranes: 1, glaze: 0.45 },
  { id: "depot-east", x: 158, z: 300, hx: 32, hz: 25, q: 0, floors: 22, cranes: 2, glaze: 0.3 },
  { id: "north-gap", x: 0, z: -440, hx: 30, hz: 23, q: 2, floors: 19, cranes: 2, glaze: 0.25 },
  { id: "south-gap", x: 0, z: 420, hx: 29, hz: 24, q: 1, floors: 16, cranes: 2, glaze: 0.4 },
  { id: "airport-gap", x: -165, z: -290, hx: 24, hz: 20, q: 1, floors: 8, cranes: 1, glaze: 0.5 },
  { id: "west-gap", x: -300, z: 190, hx: 26, hz: 21, q: 3, floors: 12, cranes: 1, glaze: 0.3 },
  // fallbacks
  { id: "se-corner", x: 189, z: 189, hx: 14.5, hz: 14.5, q: 1, floors: 13, cranes: 1, glaze: 0.4 },
  { id: "far-southwest", x: -600, z: 430, hx: 30, hz: 25, q: 0, floors: 17, cranes: 2, glaze: 0.3 },
  { id: "south-rim", x: -200, z: 690, hx: 28, hz: 22, q: 2, floors: 14, cranes: 1, glaze: 0.35 },
  { id: "far-northwest", x: -650, z: -400, hx: 28, hz: 23, q: 1, floors: 15, cranes: 2, glaze: 0.3 },
];

// --- Clearance checks ---------------------------------------------------------------------------

/** Distance from the box to the nearest road edge (kerb), negative when a road runs through it. */
export function roadClearance(b: Box): number {
  let best = Infinity;
  for (const e of ROAD_EDGES.values()) {
    const a = getNode(e.a);
    const c = getNode(e.b);
    const d = segBoxDist(a.x, a.z, c.x, c.z, b) - ROAD_HALF[e.kind];
    if (d < best) best = d;
  }
  return best;
}

export function riverClearance(b: Box): number {
  let best = Infinity;
  const p = RIVER.points;
  for (let i = 0; i + 1 < p.length; i++) best = Math.min(best, segBoxDist(p[i][0], p[i][1], p[i + 1][0], p[i + 1][1], b));
  return best - RIVER.width / 2;
}

let hillsCache: ReturnType<typeof makeHills> | null = null;
export function onHill(b: Box): boolean {
  hillsCache ??= makeHills();
  for (let i = 0; i <= 4; i++)
    for (let j = 0; j <= 4; j++) {
      const x = b.minX + ((b.maxX - b.minX) * i) / 4;
      const z = b.minZ + ((b.maxZ - b.minZ) * j) / 4;
      if (hillHeight(hillsCache, x, z) > 0) return true;
    }
  return false;
}

export function inAnyZone(b: Box, margin = ZONE_MARGIN): boolean {
  return Object.values(ZONES).some((z) => boxesOverlap(b, z, margin));
}

/** Why a box can't host a site, or null when it's fine. */
export function siteProblem(b: Box): string | null {
  if (inAnyZone(b)) return "zone";
  if (b.maxX > WATER_X - 10) return "sea";
  if (riverClearance(b) < RIVER_CLEARANCE) return "river";
  if (roadClearance(b) < ROAD_CLEARANCE) return "road";
  if (onHill(b)) return "hill";
  return null;
}

export function worldHalf(c: Candidate): [number, number] {
  return c.q % 2 === 0 ? [c.hx, c.hz] : [c.hz, c.hx];
}

const NUDGES: readonly [number, number][] = [[0, 0]];
for (const r of [8, 16, 24])
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]])
    (NUDGES as [number, number][]).push([dx * r, dz * r]);

/** Pick up to MAX_SITES clear spots from the candidates, nudging each up to 24 m to dodge new roads. */
export function pickSites(candidates: readonly Candidate[] = CANDIDATES, max = MAX_SITES): Candidate[] {
  const out: Candidate[] = [];
  const taken: Box[] = [];
  for (const c of candidates) {
    if (out.length >= max) break;
    const [wx, wz] = worldHalf(c);
    for (const [dx, dz] of NUDGES) {
      const b = boxAround(c.x + dx, c.z + dz, wx, wz);
      if (taken.some((t) => boxesOverlap(t, b, SITE_GAP))) continue;
      if (siteProblem(b)) continue;
      out.push({ ...c, x: c.x + dx, z: c.z + dz });
      taken.push(b);
      break;
    }
  }
  return out;
}

// --- Layout -----------------------------------------------------------------------------------------

export interface Rect {
  name: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface Tower {
  x: number;
  z: number;
  yaw: number;
  w: number; // along local x
  d: number; // along local z
  floors: number;
  glazed: number; // floors [0, glazed) have curtain walling
  screenFrom: number; // floors [screenFrom, floors] are wrapped in scaffold + netting
  topY: number; // top of the highest slab
  coreW: number;
  coreD: number;
}

export interface CraneSpec {
  x: number;
  z: number;
  mastH: number; // jib underside
  jib: number;
  counterJib: number;
  colour: "red" | "yellow";
  internal: boolean; // climbs inside the tower
  load: "beam" | "bucket";
  plan: CranePlan;
  offset: number; // seconds into the cycle at t = 0
}

export interface Placed {
  x: number;
  z: number;
  yaw: number;
}

export interface Pile extends Placed {
  kind: "beams" | "rebar" | "buckets";
}

export interface Worker extends Placed {
  y: number;
}

export interface Gate {
  x: number; // centre of the gap in the hoarding
  z: number;
  nx: number; // outward normal
  nz: number;
  tx: number; // along the fence
  tz: number;
  width: number;
}

export interface Pad {
  x: number;
  z: number;
  h: number; // heading of a parked mixer (nose towards the site)
}

export interface SiteLayout {
  id: string;
  spec: Candidate;
  box: Box; // world AABB of the hoarding
  yaw: number;
  tower: Tower;
  cranes: CraneSpec[];
  cabins: (Placed & { level: number; colour: string })[];
  piles: Pile[];
  pit: { x: number; z: number; r: number };
  mound: { x: number; z: number; r: number };
  excavator: { x: number; z: number; digYaw: number; dumpYaw: number; offset: number };
  dump: DumpRun & { offset: number };
  hoist: Placed & { top: number; offset: number };
  floodlights: Placed[];
  workers: Worker[];
  groundWorkers: Worker[];
  gate: Gate;
  pads: Pad[];
  gateNode: string; // road node the mixers aim for
  approachNode: string; // a neighbour of gateNode, for spawning
  footprints: Rect[]; // local-frame footprints, for overlap tests
  local: { hx: number; hz: number };
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function rect(name: string, cx: number, cz: number, hx: number, hz: number): Rect {
  return { name, minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz };
}

/** Nearest road node that isn't on the ring or motorway (mixers park off a quiet street). */
export function gateNodeFor(x: number, z: number): string {
  let best = "";
  let bestD = Infinity;
  for (const n of ROAD_NODES.values()) {
    if (n.zone === "highway" || n.id.startsWith("mw_") || n.id.startsWith("h_") || n.id.startsWith("br_")) continue;
    if (neighbours(n.id).length === 0) continue;
    const d = Math.hypot(n.x - x, n.z - z);
    if (d < bestD) {
      bestD = d;
      best = n.id;
    }
  }
  return best;
}

export function layoutSite(spec: Candidate, seed = 1): SiteLayout {
  const rand = mulberry32(seed * 7919 + 17);
  const yaw = (spec.q * Math.PI) / 2;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  // local -> world (rotation about y by yaw, same as three.js rotation.y)
  const wx = (lx: number, lz: number) => spec.x + lx * cy + lz * sy;
  const wz = (lx: number, lz: number) => spec.z - lx * sy + lz * cy;
  const P = (lx: number, lz: number, ly = 0) => ({ x: wx(lx, lz), z: wz(lx, lz), y: ly });
  const H = spec.hx;
  const D = spec.hz;
  const [whx, whz] = worldHalf(spec);
  const box = boxAround(spec.x, spec.z, whx, whz);
  const footprints: Rect[] = [];

  // Tower in the local north-west corner.
  const tw = clamp(H * 0.72, 10, 24);
  const td = clamp(D * 0.8, 10, 20);
  const tlx = -H + 2.5 + tw / 2;
  const tlz = -D + 2.5 + td / 2;
  const topY = spec.floors * FLOOR_H;
  const glazed = Math.max(1, Math.floor(spec.floors * spec.glaze));
  const screenFrom = Math.max(glazed + 1, spec.floors - 3);
  const tower: Tower = {
    ...P(tlx, tlz), yaw, w: tw, d: td, floors: spec.floors, glazed, screenFrom, topY,
    coreW: tw * 0.28, coreD: td * 0.3,
  };
  footprints.push(rect("tower", tlx, tlz, tw / 2 + 1.3, td / 2 + 1.3)); // incl. scaffold

  // External crane east of the tower.
  const c1x = tlx + tw / 2 + 4;
  const c1z = tlz;
  footprints.push(rect("crane", c1x, c1z, 2.5, 2.5));

  // East strip: cabins at the north fence, laydown below them.
  const ex0 = c1x + 3;
  const ex1 = H - 1.5;
  const ecx = (ex0 + ex1) / 2;
  const cabins: SiteLayout["cabins"] = [];
  const cabinLen = 6;
  const perRow = Math.max(1, Math.floor((ex1 - ex0) / (cabinLen + 0.4)));
  const cabinZ0 = -D + 2.6;
  const colours = ["#2d5fa8", "#e8e4da", "#2d5fa8"];
  for (let i = 0; i < perRow; i++) {
    const lx = ex0 + (cabinLen + 0.4) * i + cabinLen / 2 + ((ex1 - ex0) - perRow * (cabinLen + 0.4)) / 2;
    cabins.push({ ...P(lx, cabinZ0), yaw, level: 0, colour: colours[i % 3] });
    cabins.push({ ...P(lx, cabinZ0), yaw, level: 1, colour: colours[(i + 1) % 3] });
    if (D > 18) cabins.push({ ...P(lx, cabinZ0 + 2.8), yaw, level: 0, colour: "#e8e4da" });
  }
  const cabinDepth = D > 18 ? 5.4 : 2.6;
  footprints.push({ name: "cabins", minX: ex0, maxX: ex1, minZ: -D + 1.2, maxZ: -D + 1.3 + cabinDepth });
  const layZ0 = -D + 1.3 + cabinDepth + 1;
  const layZ1 = tlz + td / 2 + 1.3;
  const layZ = (layZ0 + layZ1) / 2;
  const load: CraneSpec["load"] = rand() < 0.5 ? "beam" : "bucket";
  const piles: Pile[] = [{ ...P(ecx, layZ), yaw, kind: load === "beam" ? "beams" : "buckets" }];
  footprints.push(rect("laydown", ecx, layZ, Math.min(3.4, (ex1 - ex0) / 2), Math.min(2, (layZ1 - layZ0) / 2)));

  // South half: excavation pit (west), excavator on its rim, dump-truck lane along the south fence.
  const sz0 = tlz + td / 2 + 1.3; // first free z south of the tower + scaffold
  const pitR = clamp(D * 0.26, 3.5, 6.5);
  const pit = { ...P(-H + 1.8 + pitR, D - 1.6 - pitR), r: pitR };
  const pitL = { x: -H + 1.8 + pitR, z: D - 1.6 - pitR };
  footprints.push(rect("pit", pitL.x, pitL.z, pitR, pitR));
  const excL = { x: pitL.x + pitR + 2.3, z: Math.max(sz0 + 2.3, pitL.z - pitR * 0.5) };
  footprints.push(rect("excavator", excL.x, excL.z, 2.2, 2.2));
  const laneZ = D - 2.2;
  const aL = { x: excL.x + 3.5, z: laneZ };
  const bL = { x: Math.max(aL.x + 4, H - 5.5), z: laneZ };
  footprints.push({ name: "dumpLane", minX: aL.x - 3.6, maxX: bL.x + 3.6, minZ: laneZ - 1.4, maxZ: laneZ + 1.4 });
  const head = (fx: number, fz: number, tx: number, tz: number) => Math.atan2(wx(tx, tz) - wx(fx, fz), wz(tx, tz) - wz(fx, fz));
  const excavator = {
    ...P(excL.x, excL.z),
    digYaw: head(excL.x, excL.z, pitL.x, pitL.z),
    dumpYaw: head(excL.x, excL.z, aL.x - 1.2, aL.z),
    offset: rand() * 7,
  };
  const A = P(aL.x, aL.z);
  const B = P(bL.x, bL.z);
  const dump = { ax: A.x, az: A.z, bx: B.x, bz: B.z, offset: rand() * 20 };
  const mound = { ...P(bL.x + 1, laneZ - 3.6), r: 2.4 };

  // Rebar in the south-east pocket between the excavator and the east fence.
  const rx0 = excL.x + 2.6;
  const rx1 = H - 1.5;
  const rz0 = sz0 + 0.5;
  const rz1 = laneZ - 4.3;
  const rebarL = { x: (rx0 + rx1) / 2, z: (rz0 + rz1) / 2 };
  if (rz1 - rz0 > 1.6 && rx1 - rx0 > 3) {
    piles.push({ ...P(rebarL.x, rebarL.z), yaw, kind: "rebar" });
    footprints.push(rect("rebar", rebarL.x, rebarL.z, Math.min(2.6, (rx1 - rx0) / 2), Math.min(1, (rz1 - rz0) / 2)));
  }

  // Cranes.
  const cranes: CraneSpec[] = [];
  const dropAt = (lx: number, lz: number, h: number) => P(lx, lz, topY + SLAB_T + h);
  const pickY = load === "beam" ? 1.4 : 1.8;
  const c2 = spec.cranes === 2;
  const mast2 = topY + 12;
  const mast1 = c2 ? mast2 + 13 : topY + 14;
  const c1 = P(c1x, c1z);
  const jib1 = clamp(Math.max(H, D) * 1.45 + 8, 28, 55);
  cranes.push({
    x: c1.x, z: c1.z, mastH: mast1, jib: jib1, counterJib: jib1 * 0.32,
    colour: rand() < 0.5 ? "red" : "yellow", internal: false, load,
    plan: {
      cx: c1.x, cz: c1.z,
      pick: P(ecx, layZ, pickY),
      drop: dropAt(tlx + tw * (rand() * 0.3 - 0.05), tlz + td * (rand() * 0.5 - 0.25), load === "beam" ? 1.1 : 1.6),
      clearY: topY + 5, hoistV: 3.2, slewV: 0.2 + rand() * 0.08, trolleyV: 1.5, attachS: 4 + rand() * 2, releaseS: 3.5,
    },
    offset: rand() * 40,
  });
  if (c2) {
    // Internal climbing crane near the tower's west face; works the west half and the south yard.
    const c2x = tlx - tw * 0.3;
    const c2z = tlz + td * 0.22;
    const p2 = P(c2x, c2z);
    const jib2 = clamp(tw * 1.25, 20, 34);
    const pick2L = { x: excL.x, z: Math.min(laneZ - 3.8, excL.z + 3.6) }; // the yard beside the excavator
    const pick2 = Math.hypot(pick2L.x - c2x, pick2L.z - c2z) < jib2 - 2 ? pick2L : { x: c2x, z: c2z + jib2 * 0.6 };
    cranes.push({
      x: p2.x, z: p2.z, mastH: mast2, jib: jib2, counterJib: jib2 * 0.3,
      colour: cranes[0].colour === "red" ? "yellow" : "red", internal: true, load: "bucket",
      plan: {
        cx: p2.x, cz: p2.z,
        pick: P(pick2.x, pick2.z, 1.8),
        drop: dropAt(tlx - tw * 0.38, tlz - td * 0.25, 1.6),
        clearY: topY + 4.5, hoistV: 3, slewV: 0.18 + rand() * 0.06, trolleyV: 1.4, attachS: 5, releaseS: 4,
      },
      offset: rand() * 40,
    });
    piles.push({ ...P(pick2.x, pick2.z), yaw, kind: "buckets" });
  }

  // Hoist on the tower's south face, floodlights at two fence corners.
  const hoist = { ...P(tlx + tw * 0.25, tlz + td / 2 + 1.6), yaw, top: topY + 1, offset: rand() * 30 };
  const floodlights = [P(H - 1, D - 1), P(-H + 1, -D + 1)].map((p) => ({ ...p, yaw }));

  // Workers on the top slab (hammering formwork) and down in the yard.
  const workers: Worker[] = [];
  const nTop = H > 20 ? 9 : 6;
  for (let i = 0, tries = 0; i < nTop && tries < 200; tries++) {
    const lx = tlx + (rand() - 0.5) * (tw - 2.4);
    const lz = tlz + (rand() - 0.5) * (td - 2.4);
    if (Math.abs(lx - tlx) < tower.coreW / 2 + 0.8 && Math.abs(lz - tlz) < tower.coreD / 2 + 0.8) continue;
    if (c2 && Math.hypot(lx - (tlx - tw * 0.3), lz - (tlz + td * 0.22)) < 2.2) continue;
    workers.push({ ...P(lx, lz, topY + SLAB_T), yaw: rand() * Math.PI * 2 });
    i++;
  }
  const groundWorkers: Worker[] = [];
  const near = [
    [ecx - 3.6, layZ + 1.8], [ecx + 2.5, layZ + 2.2], [rebarL.x - 1.5, rebarL.z + 1.5], [excL.x - 2.5, excL.z + 3],
  ];
  for (const [lx, lz] of near)
    if (Math.abs(lx) < H - 1 && Math.abs(lz) < D - 1) groundWorkers.push({ ...P(lx, lz, 0), yaw: rand() * Math.PI * 2 });

  // Gate: on the side of the hoarding facing the nearest quiet road node; mixers pour from a pad outside it.
  const gateNode = gateNodeFor(spec.x, spec.z);
  const gn = getNode(gateNode);
  const gate = gateFor(box, gn.x, gn.z);
  const pads: Pad[] = [];
  const h = Math.atan2(-gate.nx, -gate.nz);
  for (const off of [-4.8, 4.8])
    pads.push({ x: gate.x + gate.nx * 5.5 + gate.tx * off, z: gate.z + gate.nz * 5.5 + gate.tz * off, h });
  let approachNode = neighbours(gateNode)[0];
  let bestD = Infinity;
  for (const nb of neighbours(gateNode)) {
    const n = getNode(nb);
    const d = pointBoxDist(n.x, n.z, box);
    if (d < bestD) {
      bestD = d;
      approachNode = nb;
    }
  }

  return {
    id: spec.id, spec, box, yaw, tower, cranes, cabins, piles, pit, mound, excavator, dump, hoist, floodlights,
    workers, groundWorkers, gate, pads, gateNode, approachNode, footprints, local: { hx: H, hz: D },
  };
}

/** The gap in the hoarding nearest to (px, pz), kept 7 m away from the corners. */
export function gateFor(b: Box, px: number, pz: number): Gate {
  const sides = [
    { d: Math.abs(pz - b.minZ) + Math.max(0, b.minX - px, px - b.maxX), nx: 0, nz: -1 },
    { d: Math.abs(pz - b.maxZ) + Math.max(0, b.minX - px, px - b.maxX), nx: 0, nz: 1 },
    { d: Math.abs(px - b.minX) + Math.max(0, b.minZ - pz, pz - b.maxZ), nx: -1, nz: 0 },
    { d: Math.abs(px - b.maxX) + Math.max(0, b.minZ - pz, pz - b.maxZ), nx: 1, nz: 0 },
  ];
  // only sides that face the point
  const facing = sides.filter((s) =>
    s.nx < 0 ? px < b.minX : s.nx > 0 ? px > b.maxX : s.nz < 0 ? pz < b.minZ : pz > b.maxZ,
  );
  const s = (facing.length ? facing : sides).sort((a, c) => a.d - c.d)[0];
  const width = 10;
  if (s.nz !== 0) {
    const x = clamp(px, b.minX + 8, b.maxX - 8);
    return { x, z: s.nz < 0 ? b.minZ : b.maxZ, nx: 0, nz: s.nz, tx: 1, tz: 0, width };
  }
  const z = clamp(pz, b.minZ + 8, b.maxZ - 8);
  return { x: s.nx < 0 ? b.minX : b.maxX, z, nx: s.nx, nz: 0, tx: 0, tz: 1, width };
}

let cache: SiteLayout[] | null = null;
/** The city's construction sites (computed once, against the live road graph). */
export function getSites(): SiteLayout[] {
  cache ??= pickSites().map((c, i) => layoutSite(c, i + 1));
  return cache;
}
