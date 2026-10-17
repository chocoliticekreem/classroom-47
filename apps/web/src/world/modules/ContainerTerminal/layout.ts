// Container terminal: static layout (pure, no three.js). World units are metres; the yard's containers lie
// with their long axis along x (the RMG rails), ship containers along z.
import { ZONES } from "../../config";
import { CT_BAY_X, CT_LANE_Z, CT_QUAY_X, CT_WEST_X } from "../../districts/containerTerminal";
import { mulberry32, type Box, type StackSpec } from "./yard";

export const ZONE = ZONES.containerTerminal;
export const CONTAINER = { w: 2.44, h: 2.6, l: 12.2 };
export const APRON_Y = 0.035;
/** The quay edge (Ground draws the sea wall and the terminal paving; we only add objects). */
export const QUAY_EDGE_X = 340;
export const COAST_ROAD_X = 336; // the motorway's coast road (mw_cs_*) runs under the STS cranes here

// ---------- brands (rows of the container atlas) ----------
export interface Brand {
  name: string;
  base: string;
  text: string;
  sub?: string;
  mark?: "star" | "wave" | "ring";
}
/** Row 0 is the plain box (tinted per instance). Fictional lines only. */
export const BRANDS: Brand[] = [
  { name: "", base: "#f4f4f2", text: "#333" },
  { name: "HAMYWAY", base: "#ff6a1a", text: "#ffffff", sub: "DELIVERY · LONDON" },
  { name: "MAERLIN", base: "#4bb4d6", text: "#ffffff", mark: "star" },
  { name: "EVERGLOW", base: "#2f7d4f", text: "#f2f0e8", sub: "MARINE" },
  { name: "KOSKA", base: "#2c5aa0", text: "#ffffff", mark: "wave" },
  { name: "SUDWIND", base: "#c8322b", text: "#ffffff" },
  { name: "ONEWAVE", base: "#c2185b", text: "#ffffff", mark: "ring" },
  { name: "HAMYWAY COLD", base: "#eef1f3", text: "#1d4f8a", sub: "REEFER · +4°C" },
];
export const BRAND_ROWS = BRANDS.length; // 8
export const REEFER_BRAND = 7;
export const TINTS = ["#b8382f", "#2e6fb7", "#3f8f4f", "#d9ab2a", "#2a9d8f", "#7e3b46", "#8a9199", "#c76b29", "#e6e6e2", "#2c3e75", "#6d4c8c", "#5c6b3a"];

// ---------- yard blocks ----------
const ROW_PITCH = 2.74;
export const BAY_X = [257.5, 270.5, 283.5, 296.5];

export interface BlockDef {
  id: number;
  kind: "rmg" | "reefer" | "rs" | "empties";
  rowsZ: number[];
  maxInit: number;
}

/** The three RMG blocks sit north of their truck lanes (CT_LANE_Z[0..2]). */
export const RMG_COUNT = 3;
export const RMG_ROWS = 8;
export function rmgRowZ(k: number, r: number) {
  return CT_LANE_Z[k] - 6.6 - r * ROW_PITCH;
}

export const BLOCKS: BlockDef[] = [
  ...[0, 1, 2].map((k) => ({
    id: k,
    kind: "rmg" as const,
    rowsZ: Array.from({ length: RMG_ROWS }, (_, r) => rmgRowZ(k, r)),
    maxInit: 5,
  })),
  { id: 3, kind: "reefer", rowsZ: Array.from({ length: 7 }, (_, r) => 257.4 + r * ROW_PITCH), maxInit: 3 },
  { id: 4, kind: "rs", rowsZ: Array.from({ length: 6 }, (_, r) => 288.6 + r * ROW_PITCH), maxInit: 4 },
  { id: 5, kind: "empties", rowsZ: Array.from({ length: 6 }, (_, r) => 316.2 + r * ROW_PITCH), maxInit: 5 },
];

/** Stacks driven by the scripted straddle carriers / reach stackers keep a fixed base height. */
export const SCRIPTED_SLOTS = {
  straddleA: { block: 4, bay: 3, row: 1, base: 1 },
  straddleB: { block: 4, bay: 3, row: 4, base: 1 },
  reachA: { block: 4, bays: [0, 1] as const, row: 0, base: [2, 1] as const },
  reachB: { block: 5, bays: [2, 3] as const, row: 5, base: [1, 2] as const },
};

function scriptedBase(block: number, bay: number, row: number): number | null {
  const S = SCRIPTED_SLOTS;
  if (block === S.straddleA.block && bay === S.straddleA.bay && row === S.straddleA.row) return S.straddleA.base;
  if (block === S.straddleB.block && bay === S.straddleB.bay && row === S.straddleB.row) return S.straddleB.base;
  for (const r of [S.reachA, S.reachB]) {
    const i = (r.bays as readonly number[]).indexOf(bay);
    if (block === r.block && row === r.row && i >= 0) return r.base[i];
  }
  return null;
}

export function yardSpecs(seed = 7): StackSpec[] {
  const rand = mulberry32(seed);
  const out: StackSpec[] = [];
  for (const b of BLOCKS)
    b.rowsZ.forEach((z, row) =>
      BAY_X.forEach((x, bay) => {
        const fixed = scriptedBase(b.id, bay, row);
        let initial: number;
        if (fixed !== null) initial = fixed;
        else if (b.kind === "rmg") initial = 1 + Math.floor(rand() * 4.6); // 1..5, mostly 3-4
        else if (b.kind === "empties") initial = 3 + Math.floor(rand() * 3);
        else initial = 1 + Math.floor(rand() * b.maxInit);
        // keep the straddle/reach-stacker lanes readable: lower stacks next to the scripted ones
        out.push({ block: b.id, bay, row, x, z, reefer: b.kind === "reefer", initial: Math.min(5, initial) });
      }),
    );
  return out;
}

/** Deterministic box contents for a stack tier. */
export function makeYardBox(s: StackSpec, tier: number): Box {
  const r = mulberry32((s.block * 97 + s.bay * 31 + s.row * 7 + tier * 3 + 11) * 2654435761);
  r();
  if (s.reefer) return { brand: REEFER_BRAND, tint: 8 };
  const p = r();
  const brand = p < 0.12 ? 1 : p < 0.24 ? 2 : p < 0.33 ? 3 : p < 0.41 ? 4 : p < 0.47 ? 5 : p < 0.53 ? 6 : 0;
  return { brand, tint: Math.floor(r() * TINTS.length) };
}

// ---------- RMG cranes ----------
export const RMG = {
  girderY: 19.5, // underside of the top girder
  travelY: 16.2, // spreader bottom while travelling (clears a 5-high stack + a carried box)
  gantrySpeed: 3.2, // m/s along x
  trolleySpeed: 2.2, // m/s along z
  hoistSpeed: 2.6, // m/s
  latch: 0.8, // s
  minX: 252,
  maxX: 302,
};
export function rmgLegs(k: number): [number, number] {
  return [CT_LANE_Z[k] - 28.6, CT_LANE_Z[k] + 5.2];
}
export const TRAILER_BED_Y = 1.42; // container bottom when sitting on a skeletal trailer

// ---------- truck lanes / gate ----------
export { CT_BAY_X, CT_LANE_Z, CT_QUAY_X, CT_WEST_X };

// ---------- ship + STS cranes ----------
export const SHIP = { x: 354, beam: 24, zBow: 146, zStern: 304, deckY: 5.5, keelY: -5 };
export const SHIP_ROWS = 9;
export const SHIP_BAYS = 10;
export const shipRowX = (i: number) => SHIP.x + (i - (SHIP_ROWS - 1) / 2) * 2.62;
export const shipBayZ = (k: number) => 170 + k * 12.6;
/** Gentle bob/roll of the berthed ship (shared by the hull and anything resting on its deck). */
export function shipBob(tSec: number) {
  return Math.sin(tSec * 0.5 + 0.8) * 0.13 + Math.sin(tSec * 0.21 + 2.1) * 0.05;
}
export function shipRoll(tSec: number) {
  return Math.sin(tSec * 0.37 + 0.2) * 0.005;
}
export const STS = {
  legX: [324, 340] as const,
  legHalfZ: 8.5,
  boomY: 34,
  upY: 26,
  padX: 328.5,
  slotRow: 5,
};
export interface StsDef {
  bay: number; // ship bay it works
  z: number;
  shipStack: number; // boxes under the moving one in its ship slot
  offset: number; // seconds into the shared cycle at t = 0
}
export const STS_CRANES: StsDef[] = [
  { bay: 3, z: shipBayZ(3), shipStack: 3, offset: 0 },
  { bay: 7, z: shipBayZ(7), shipStack: 2, offset: 62 },
];

// ---------- light masts ----------
export const LIGHT_MASTS: [number, number][] = [
  [CT_WEST_X - 6, 150], [CT_WEST_X - 6, 228], [CT_WEST_X - 6, 300],
  [323, 180], [323, 236], [323, 300],
  [300, 120], [246, 122],
];

// ---------- gate ----------
export const GATE = {
  canopyZ: [113, 127] as const,
  canopyX: [249, 296] as const,
  canopyY: 6.2,
  booth: { w: 1.6, d: 3.2, h: 2.6 },
  barrierZ: 124,
  outGate: { x: 304.6, z: 329 }, // booth; the barrier post stands just south of it on the exit road kerb
};
export const CUSTOMS = { x0: 312.5, x1: 325.5, z0: 104, z1: 126, h: 9, portalZ: 129.5, laneX: 319 };

export const TRUCK = {
  cabLen: 6.2,
  trailerLen: 13.4,
  kingpin: 4.6, // distance behind the cab front of the fifth wheel
  axleBack: 11.6, // fifth wheel -> trailer rear axle group
  length: 18.2, // bumper to bumper
};

/** 0 by day, 1 at night, ramps through dusk (17-19) and dawn (5.5-7). */
export function nightFactor(hour: number) {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 19 || h <= 5.5) return 1;
  if (h >= 17) return (h - 17) / 2;
  if (h < 7) return 1 - (h - 5.5) / 1.5;
  return 0;
}

// ---------- polyline track (for scripted machines) ----------
export class Track {
  readonly xs: number[] = [];
  readonly zs: number[] = [];
  readonly cum: number[] = [];
  readonly length: number;
  constructor(points: readonly [number, number][], smoothPasses = 2) {
    let pts = points.map((p) => [p[0], p[1]] as [number, number]);
    for (let k = 0; k < smoothPasses; k++) pts = chaikin(pts);
    let acc = 0;
    pts.forEach(([x, z], i) => {
      if (i > 0) acc += Math.hypot(x - this.xs[i - 1], z - this.zs[i - 1]);
      this.xs.push(x);
      this.zs.push(z);
      this.cum.push(acc);
    });
    this.length = acc;
  }
  /** Pose at arc length s (clamped). Heading: rotation about y, 0 = facing +z. */
  at(s: number, out: { x: number; z: number; h: number }, reverse = false) {
    const L = this.length;
    const d = Math.max(0, Math.min(L, reverse ? L - s : s));
    let lo = 0;
    let hi = this.cum.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (this.cum[m] <= d) lo = m;
      else hi = m;
    }
    const seg = this.cum[hi] - this.cum[lo] || 1;
    const u = (d - this.cum[lo]) / seg;
    const dx = this.xs[hi] - this.xs[lo];
    const dz = this.zs[hi] - this.zs[lo];
    out.x = this.xs[lo] + dx * u;
    out.z = this.zs[lo] + dz * u;
    out.h = Math.atan2(reverse ? -dx : dx, reverse ? -dz : dz);
    return out;
  }
}

function chaikin(p: [number, number][]): [number, number][] {
  if (p.length < 3) return p;
  const out: [number, number][] = [p[0]];
  for (let i = 0; i < p.length - 1; i++) {
    const [ax, az] = p[i];
    const [bx, bz] = p[i + 1];
    if (i > 0) out.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25]);
    if (i < p.length - 2) out.push([ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
  }
  out.push(p[p.length - 1]);
  return out;
}

export const smooth = (u: number) => u * u * (3 - 2 * u);
export const clamp01 = (u: number) => (u < 0 ? 0 : u > 1 ? 1 : u);
export const mod = (a: number, n: number) => ((a % n) + n) % n;
