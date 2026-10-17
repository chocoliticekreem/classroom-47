// Suburbs layout: pure, seeded data. Produces instanced "parts" (one per primitive) and text signs.
// Nothing here touches three.js so it can be unit tested.
import { ZONES } from "../../config";
import { ROAD_EDGES, ROAD_NODES } from "../../roads";

export type PoolName = "body" | "detail" | "roof" | "pyramid" | "cyl" | "foliage" | "winLit" | "winDark";

/** One primitive instance. Boxes/foliage are centred on y; roof, pyramid and cyl have their base at y. */
export interface Part {
  pool: PoolName;
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  ry: number;
  tilt: number; // rotation about the part's local x, applied after ry
  color: string;
}

export interface Sign {
  text: string;
  bg: string;
  fg: string;
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  ry: number; // plane faces local +z after this yaw
}

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface Layout {
  parts: Part[];
  signs: Sign[];
  lots: Rect[];
  reserved: Rect[];
}

export const CLEARANCE = 6; // metres from any road centre line

// ---------------------------------------------------------------------------------------------
// Helpers

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

type Rng = () => number;
const pick = <T,>(rng: Rng, arr: readonly T[]) => arr[Math.floor(rng() * arr.length)];
const range = (rng: Rng, a: number, b: number) => a + rng() * (b - a);

export interface Seg {
  ax: number;
  az: number;
  bx: number;
  bz: number;
}

/** Every road centre line in the world (used for the clearance check). */
export function allRoadSegments(): Seg[] {
  const out: Seg[] = [];
  for (const e of ROAD_EDGES.values()) {
    const a = ROAD_NODES.get(e.a);
    const b = ROAD_NODES.get(e.b);
    if (a && b) out.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z });
  }
  return out;
}

export function pointSegDist(px: number, pz: number, s: Seg) {
  const dx = s.bx - s.ax;
  const dz = s.bz - s.az;
  const len2 = dx * dx + dz * dz || 1;
  let t = ((px - s.ax) * dx + (pz - s.az) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = s.ax + dx * t - px;
  const qz = s.az + dz * t - pz;
  return Math.sqrt(qx * qx + qz * qz);
}

function pointRectDist(px: number, pz: number, r: Rect) {
  const dx = Math.max(r.minX - px, 0, px - r.maxX);
  const dz = Math.max(r.minZ - pz, 0, pz - r.maxZ);
  return Math.sqrt(dx * dx + dz * dz);
}

/** Approximate min distance between a segment and an axis-aligned rect (sampled every 0.5 m). */
export function segRectDist(s: Seg, r: Rect) {
  const len = Math.hypot(s.bx - s.ax, s.bz - s.az);
  const n = Math.max(1, Math.ceil(len / 0.5));
  let best = Infinity;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const d = pointRectDist(s.ax + (s.bx - s.ax) * t, s.az + (s.bz - s.az) * t, r);
    if (d < best) best = d;
  }
  return best;
}

const overlaps = (a: Rect, b: Rect, gap = 0) =>
  a.minX < b.maxX + gap && a.maxX > b.minX - gap && a.minZ < b.maxZ + gap && a.maxZ > b.minZ - gap;

const zone = ZONES.suburbs;
const inZone = (r: Rect) => r.minX >= zone.minX && r.maxX <= zone.maxX && r.minZ >= zone.minZ && r.maxZ <= zone.maxZ;

/**
 * A local frame on one side of a street. u runs along the street, v runs away from it.
 * Local x of every part maps to u, local z to v.
 */
class Frame {
  readonly ux: number;
  readonly uz: number;
  readonly ry: number;
  constructor(
    readonly out: Part[],
    readonly ox: number,
    readonly oz: number,
    readonly nx: number,
    readonly nz: number,
  ) {
    this.ux = nz;
    this.uz = -nx;
    this.ry = Math.atan2(nx, nz);
  }
  wx(u: number, v: number) {
    return this.ox + this.ux * u + this.nx * v;
  }
  wz(u: number, v: number) {
    return this.oz + this.uz * u + this.nz * v;
  }
  add(pool: PoolName, u: number, y: number, v: number, su: number, sy: number, sv: number, color: string, tilt = 0, ryExtra = 0) {
    this.out.push({ pool, x: this.wx(u, v), y, z: this.wz(u, v), sx: su, sy, sz: sv, ry: this.ry + ryExtra, tilt, color });
  }
  rect(u0: number, u1: number, v0: number, v1: number): Rect {
    const xs = [this.wx(u0, v0), this.wx(u1, v1)];
    const zs = [this.wz(u0, v0), this.wz(u1, v1)];
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
  }
  /** A sign plane at (u, y, v), facing -v (towards the street) unless `facing` given (radians added). */
  sign(signs: Sign[], text: string, bg: string, fg: string, u: number, y: number, v: number, w: number, h: number, facing = Math.PI) {
    signs.push({ text, bg, fg, x: this.wx(u, v), y, z: this.wz(u, v), w, h, ry: this.ry + facing });
  }
}

// ---------------------------------------------------------------------------------------------
// Palettes

const PASTELS = ["#f4d3c4", "#cfe8d8", "#f7e6a8", "#cfdcf2", "#f2c6d2", "#efe7da", "#dcd0ef", "#bfe3e6"];
const BRICKS = ["#b5553c", "#a0482f", "#c46a4a", "#8d3f2c", "#b86b4b"];
const ROOFS = ["#4a4f5a", "#5a5f6b", "#a4482e", "#b85a3a", "#6b4a3a", "#3e434d"];
const DOORS = ["#e0302a", "#2050c8", "#f5c400", "#1e8a4c", "#0fa3a3", "#7a3bb8", "#ff6a1a", "#111827", "#e84a8a"];
const LAWNS = ["#7cbf5a", "#86c463", "#73b552"];
const HEDGE = "#3f7f3a";
const WHITE = "#f4f1ea";
const CARS = ["#c8202a", "#1f5fae", "#f4f4f4", "#222428", "#9aa3ad", "#2f8a57", "#f2b705", "#ff6a1a"];
const BINS = ["#2f6b3a", "#26292e", "#2d5aa8", "#6b4a2b"];
const FOLIAGE = ["#5aa64a", "#4c9a45", "#6bb352", "#3f8a3f", "#7bbf55"];
const TRUNK = "#6b4a2f";
const BRICK_DARK = "#7a3a28";
const STONE = "#b9b2a6";
const TARMAC = "#6f7378";
const PAVING = "#cfc8bb";
const GLASS = "#3d4f63";

// ---------------------------------------------------------------------------------------------
// Small furniture

function tree(f: Frame, rng: Rng, u: number, v: number, scale = 1, foliage?: string) {
  const h = (1.6 + rng() * 0.8) * scale;
  const r = (1.0 + rng() * 0.35) * scale;
  f.add("cyl", u, 0, v, 0.3 * scale, h, 0.3 * scale, TRUNK);
  f.add("foliage", u, h + r * 0.7, v, r * 2, r * 2.1, r * 2, foliage ?? pick(rng, FOLIAGE));
  if (rng() < 0.5) f.add("foliage", u + r * 0.3, h + r * 1.5, v - r * 0.2, r * 1.3, r * 1.3, r * 1.3, foliage ?? pick(rng, FOLIAGE));
}

function car(f: Frame, rng: Rng, u: number, v: number) {
  const c = pick(rng, CARS);
  f.add("detail", u, 0.65, v, 1.8, 0.75, 4.1, c);
  f.add("detail", u, 1.27, v + 0.2, 1.6, 0.55, 2.1, GLASS);
  f.add("detail", u, 1.58, v + 0.2, 1.62, 0.1, 1.9, c);
  for (const du of [-0.82, 0.82]) for (const dv of [-1.3, 1.3]) f.add("detail", u + du, 0.32, v + dv, 0.3, 0.64, 0.64, "#1b1d22");
  f.add("detail", u, 0.68, v - 2.06, 1.4, 0.18, 0.04, "#fff6c8"); // headlights strip
}

function bin(f: Frame, u: number, v: number, color: string) {
  f.add("detail", u, 0.5, v, 0.6, 1.0, 0.7, color);
  f.add("detail", u, 1.04, v - 0.03, 0.64, 0.08, 0.78, color === "#26292e" ? "#3a3d44" : "#1f2a22");
}

/** A front boundary between u0 and u1 at v (hedge, picket fence or low brick wall). */
function boundary(f: Frame, kind: number, u0: number, u1: number, v: number) {
  const len = u1 - u0;
  if (len < 0.3) return;
  const mid = (u0 + u1) / 2;
  if (kind === 0) {
    f.add("detail", mid, 0.5, v, len, 1.0, 0.7, HEDGE);
  } else if (kind === 1) {
    f.add("detail", mid, 0.35, v, len, 0.08, 0.06, WHITE);
    f.add("detail", mid, 0.72, v, len, 0.08, 0.06, WHITE);
    const n = Math.max(1, Math.floor(len / 0.32));
    for (let i = 0; i <= n; i++) f.add("detail", u0 + (len * i) / n, 0.5, v + 0.04, 0.09, 1.0, 0.04, WHITE);
  } else {
    f.add("detail", mid, 0.35, v, len, 0.7, 0.35, pick(mulberry32(Math.round(mid * 97)), BRICKS));
    f.add("detail", mid, 0.74, v, len + 0.05, 0.08, 0.45, "#d8d2c6");
  }
}

function window_(f: Frame, rng: Rng, u: number, y: number, vFace: number, w: number, h: number, back = false, litChance = 0.6) {
  const s = back ? 1 : -1;
  f.add("detail", u, y, vFace + s * 0.03, w + 0.22, h + 0.22, 0.08, WHITE);
  f.add(rng() < litChance ? "winLit" : "winDark", u, y, vFace + s * 0.07, w, h, 0.08, GLASS);
}

// ---------------------------------------------------------------------------------------------
// Houses

interface HouseOpts {
  semi: boolean;
  L: number;
  garden: number;
  hd: number;
  D: number;
}

const i0 = (a: string, b: string, uc: number) => (uc <= 0 ? a : b);

function houseOpts(rng: Rng, compact: boolean): HouseOpts {
  const semi = rng() < 0.45;
  const L = semi ? range(rng, 17, 18.5) : range(rng, 11.5, 13);
  const garden = compact ? 3.4 : range(rng, 4, 5);
  const hd = compact ? 6.8 : range(rng, 7, 8);
  const D = garden + hd + (compact ? 1.4 : 2.5);
  return { semi, L, garden, hd, D };
}

function house(f: Frame, rng: Rng, o: HouseOpts) {
  const { semi, L, garden, hd, D } = o;
  const H = range(rng, 5.3, 5.9);
  const vF = garden;
  const vB = garden + hd;
  const vc = (vF + vB) / 2;
  const brick = rng() < 0.4;
  const wallA = brick ? pick(rng, BRICKS) : pick(rng, PASTELS);
  const wallB = semi && rng() < 0.6 ? (brick ? pick(rng, BRICKS) : pick(rng, PASTELS)) : wallA;
  const roofC = pick(rng, ROOFS);
  const fenceKind = Math.floor(rng() * 3);
  const driveW = 2.9;

  // Lawn and garden path
  f.add("detail", 0, 0.03, D / 2, L - 0.1, 0.06, D - 0.1, pick(rng, LAWNS));

  // Units: [centreU, width, doorSide (+1 door toward +u)]
  const units: [number, number, number][] = [];
  const drives: number[] = [];
  let bodyC: number;
  let bodyW: number;
  if (semi) {
    const hw = (L - 2 * driveW - 1.0) / 2;
    bodyW = hw * 2;
    bodyC = 0;
    units.push([-hw / 2, hw, -1], [hw / 2, hw, 1]);
    drives.push(-(L / 2 - 0.2 - driveW / 2), L / 2 - 0.2 - driveW / 2);
  } else {
    const side = rng() < 0.5 ? -1 : 1; // driveway side
    bodyW = Math.min(L - driveW - 1.2, range(rng, 7, 8.2));
    bodyC = -side * (L / 2 - 0.6 - bodyW / 2);
    units.push([bodyC, bodyW, side]);
    drives.push(side * (L / 2 - 0.25 - driveW / 2));
  }

  // Body (one per unit so semis can be painted differently)
  units.forEach(([uc, w], i) => f.add("body", uc, H / 2, vc, w, H, hd, i === 0 ? wallA : wallB));
  // Roof
  if (!semi && rng() < 0.35) {
    f.add("pyramid", bodyC, H, vc, bodyW + 0.7, 2.4, hd + 0.7, roofC);
  } else {
    f.add("roof", bodyC, H, vc, bodyW + 0.5, 2.6, hd + 0.8, roofC);
  }
  // Chimneys
  const chimC = brick ? BRICK_DARK : pick(rng, BRICKS);
  const chimneyAt = (u: number, w: number) => {
    f.add("detail", u, H + 1.5, vc + 0.9, w, 3.0, 0.8, chimC);
    f.add("cyl", u - w / 4, H + 3.0, vc + 0.9, 0.25, 0.35, 0.25, "#b85a3a");
    if (w > 1) f.add("cyl", u + w / 4, H + 3.0, vc + 0.9, 0.25, 0.35, 0.25, "#b85a3a");
  };
  if (semi) chimneyAt(0, 1.4);
  else chimneyAt(bodyC - (units[0][2] * (bodyW / 2 - 0.8)), 0.8);

  // Doors, windows, paths
  const pathUs: number[] = [];
  for (const [uc, w, ds] of units) {
    const du = uc + ds * (w / 2 - 1.0);
    const doorC = pick(rng, DOORS);
    f.add("detail", du, 1.1, vF - 0.06, 1.0, 2.1, 0.14, doorC);
    f.add("detail", du, 2.35, vF - 0.35, 1.5, 0.12, 0.7, WHITE); // canopy
    f.add("detail", du, 0.1, vF - 0.35, 1.4, 0.2, 0.7, "#d8d2c6"); // step
    f.add("detail", du, 0.06, vF / 2, 1.1, 0.07, vF, PAVING); // garden path
    pathUs.push(du);
    // ground floor bay window on the other side, upstairs pair
    const bu = uc - ds * (w / 4 + 0.1);
    if (rng() < 0.5) {
      f.add("detail", bu, 1.0, vF - 0.45, 2.2, 2.0, 0.9, i0(wallA, wallB, uc));
      window_(f, rng, bu, 1.45, vF - 0.9, 1.8, 1.2);
    } else {
      window_(f, rng, bu, 1.5, vF, 1.7, 1.3);
    }
    window_(f, rng, uc - w / 4, H - 1.6, vF, 1.1, 1.2);
    window_(f, rng, uc + w / 4, H - 1.6, vF, 1.1, 1.2);
    window_(f, rng, uc - w / 4, H - 1.6, vB, 1.1, 1.2, true);
    window_(f, rng, uc + w / 4, H - 1.6, vB, 1.0, 1.0, true, 0.35);
    window_(f, rng, uc, 1.5, vB, 1.6, 1.3, true, 0.4);
  }

  // Driveways, cars, bins
  for (const dU of drives) {
    f.add("detail", dU, 0.05, (vF + hd * 0.6) / 2, driveW, 0.1, vF + hd * 0.6, "#8d8f93");
    if (rng() < 0.4) car(f, rng, dU, 2.7 + rng() * 0.6);
    const toward = -Math.sign(dU); // bins sit on the house side of the drive
    const nb = 1 + Math.floor(rng() * 3);
    for (let b = 0; b < nb; b++) bin(f, dU + toward * (driveW / 2 + 0.45 + b * 0.72), vF - 0.75, BINS[(b + Math.floor(rng() * 4)) % 4]);
  }

  // Front boundary: from lot edges to drive edges, with gaps for paths.
  const cuts: [number, number][] = drives.map((d) => [d - driveW / 2, d + driveW / 2]);
  for (const p of pathUs) cuts.push([p - 0.65, p + 0.65]);
  cuts.sort((a, b) => a[0] - b[0]);
  let cur = -L / 2 + 0.1;
  for (const [a, b] of cuts) {
    if (a > cur) boundary(f, fenceKind, cur, a, 0.5);
    cur = Math.max(cur, b);
  }
  if (cur < L / 2 - 0.1) boundary(f, fenceKind, cur, L / 2 - 0.1, 0.5);

  // Trees: front garden (on the side away from the drive when detached), back garden
  if (rng() < 0.55) {
    const tu = semi ? (rng() < 0.5 ? -1.5 : 1.5) : bodyC + (rng() < 0.5 ? -1 : 1) * (bodyW / 2 - 1.8);
    if (Math.abs(tu) < L / 2 - 1.4) tree(f, rng, tu, Math.max(1.6, vF * 0.45), 0.85);
  }
  if (D - vB > 2.2 && rng() < 0.6) tree(f, rng, range(rng, -L / 2 + 1.8, L / 2 - 1.8), vB + (D - vB) / 2 + 0.2, 0.8);
}

// ---------------------------------------------------------------------------------------------
// Special buildings (hand placed)

const SHOPS = [
  { name: "HAMYWAY PARCELS", bg: "#ff6a1a", fg: "#ffffff", awning: "#ff6a1a" },
  { name: "BAKERY", bg: "#f3d9a4", fg: "#6b3a1a", awning: "#c8463a" },
  { name: "FISH & CHIPS", bg: "#1f5fae", fg: "#ffffff", awning: "#1f5fae" },
  { name: "NEWSAGENT", bg: "#c8202a", fg: "#ffffff", awning: "#2f8a57" },
  { name: "FLORIST", bg: "#2f8a57", fg: "#ffffff", awning: "#e84a8a" },
];

function parade(out: Part[], signs: Sign[], rng: Rng): Rect {
  // North side of the z=-260 street, east of the x=0 link. u = +x, v = +z.
  const f = new Frame(out, 0, -260 + 6.2, 0, 1);
  const unitW = 9;
  const vF = 2.5;
  const depth = 10;
  const H = 7.2;
  SHOPS.forEach((s, i) => {
    const uc = 13 + i * unitW;
    const wall = i % 2 === 0 ? pick(rng, BRICKS) : pick(rng, ["#efe7da", "#f4d3c4", "#e9dcc0"]);
    f.add("body", uc, H / 2, vF + depth / 2, unitW - 0.05, H, depth, wall);
    f.add("detail", uc, H + 0.3, vF + depth / 2, unitW, 0.6, depth, "#4a4f5a"); // flat roof + parapet
    f.add("detail", uc, H + 0.6, vF + 0.2, unitW, 0.5, 0.4, WHITE);
    // Shopfront
    f.add("detail", uc, 1.8, vF - 0.05, unitW - 0.6, 3.6, 0.12, s.bg);
    f.add("winLit", uc - 0.9, 1.75, vF - 0.14, unitW - 3.4, 2.3, 0.08, GLASS);
    f.add("detail", uc + unitW / 2 - 1.5, 1.2, vF - 0.14, 1.1, 2.3, 0.1, "#2b2f36");
    f.add("detail", uc, 0.3, vF - 0.16, unitW - 0.6, 0.6, 0.1, "#2b2f36");
    // Striped awning, sloping down towards the street
    const strips = 6;
    for (let k = 0; k < strips; k++) {
      const w = (unitW - 0.6) / strips;
      f.add("detail", uc - (unitW - 0.6) / 2 + w * (k + 0.5), 3.15, vF - 1.05, w, 0.1, 2.2, k % 2 ? WHITE : s.awning, -0.35);
    }
    f.add("detail", uc, 2.75, vF - 2.08, unitW - 0.6, 0.35, 0.06, s.awning); // valance
    f.sign(signs, s.name, s.bg, s.fg, uc, 4.05, vF - 0.14, unitW - 1.0, 0.9);
    // Flat above
    window_(f, rng, uc - 2.1, 5.6, vF, 1.3, 1.4, false, 0.7);
    window_(f, rng, uc + 2.1, 5.6, vF, 1.3, 1.4, false, 0.7);
    window_(f, rng, uc, 4.4, vF + depth, 1.3, 1.3, true, 0.5);
  });
  // Red phone box and a bench at the west end of the parade
  f.add("body", 7.1, 1.3, 0.9, 1.0, 2.6, 1.0, "#d21f26");
  f.add("winLit", 7.1, 1.4, 0.36, 0.7, 1.5, 0.06, "#f4e6c8");
  f.add("detail", 7.1, 2.68, 0.9, 1.1, 0.16, 1.1, "#b3171d");
  return f.rect(6.4, 13 + 4 * unitW + unitW / 2 + 0.2, 0, vF + depth + 0.5);
}

function pub(out: Part[], signs: Sign[], rng: Rng): Rect {
  // North side of z=-260, west of the x=0 link (corner pub). u = +x, v = +z.
  const f = new Frame(out, 0, -260 + 6.2, 0, 1);
  const u0 = -21;
  const u1 = -7.6;
  const uc = (u0 + u1) / 2;
  const w = u1 - u0;
  const vF = 1.5;
  const d = 10;
  const H = 7;
  f.add("body", uc, H / 2, vF + d / 2, w, H, d, "#9a4430");
  f.add("pyramid", uc, H, vF + d / 2, w + 0.8, 3.0, d + 0.8, "#3e434d");
  f.add("detail", u0 + 2, H + 2.2, vF + d / 2, 1.0, 3.2, 1.0, BRICK_DARK);
  f.add("detail", u1 - 2, H + 2.2, vF + d / 2, 1.0, 3.2, 1.0, BRICK_DARK);
  // Green ground-floor frontage on the street side and the link side
  const green = "#1f4d3a";
  f.add("detail", uc, 1.75, vF - 0.08, w + 0.1, 3.5, 0.16, green);
  f.add("detail", u1 + 0.08, 1.75, vF + d / 2, 0.16, 3.5, d + 0.1, green);
  f.add("detail", uc, 3.65, vF - 0.18, w + 0.3, 0.35, 0.3, "#d4b25a"); // gold fascia
  for (const k of [-4.5, -1.5, 3]) f.add("winLit", uc + k, 1.8, vF - 0.2, 2.2, 1.9, 0.08, "#4a3a2a");
  for (const k of [-2.5, 2.5]) f.add("winLit", u1 + 0.2, 1.8, vF + d / 2 + k, 0.08, 1.9, 2.4, "#4a3a2a");
  f.add("detail", uc + 0.8, 1.15, vF - 0.2, 1.1, 2.3, 0.08, "#5a2a1a"); // door
  for (const k of [-4, 0, 4]) window_(f, rng, uc + k, 5.3, vF, 1.2, 1.4, false, 0.8);
  f.sign(signs, "THE CROWN", "#1f4d3a", "#f2d27a", uc, 4.3, vF - 0.1, 6.5, 0.8);
  // Hanging sign on a post at the corner, readable from the street in both directions
  f.add("cyl", u1 + 0.9, 0, 0.9, 0.18, 4.4, 0.18, "#222");
  f.add("detail", u1 + 0.9, 4.25, 0.9, 0.08, 0.08, 1.6, "#222");
  f.sign(signs, "THE CROWN", "#7a1f2a", "#f2d27a", u1 + 0.95, 3.3, 0.9, 1.5, 1.1, Math.PI / 2);
  f.sign(signs, "THE CROWN", "#7a1f2a", "#f2d27a", u1 + 0.85, 3.3, 0.9, 1.5, 1.1, -Math.PI / 2);
  f.add("detail", u1 + 0.9, 3.3, 0.9, 0.06, 1.15, 1.55, "#7a1f2a");
  // Beer garden: picnic tables and parasols
  for (const [tu, tv] of [[-27, 3.5], [-27, 8], [-23.5, 5.5], [-23.5, 10]] as const) {
    f.add("detail", tu, 0.75, tv, 1.8, 0.08, 0.8, "#9a6a3a");
    f.add("detail", tu, 0.45, tv - 0.75, 1.8, 0.06, 0.3, "#9a6a3a");
    f.add("detail", tu, 0.45, tv + 0.75, 1.8, 0.06, 0.3, "#9a6a3a");
    f.add("detail", tu, 0.38, tv, 0.1, 0.75, 1.6, "#7a5230");
    f.add("cyl", tu, 0.8, tv, 0.06, 1.6, 0.06, "#ddd");
    f.add("pyramid", tu, 2.2, tv, 2.2, 0.6, 2.2, rng() < 0.5 ? "#c8202a" : "#f4f1ea");
  }
  boundary(f, 1, -29.5, u0 - 0.2, 0.5);
  f.add("detail", -25, 0.03, 7, 9, 0.06, 13, "#8fbf6a");
  return f.rect(-30, u1 + 1.6, 0, vF + d + 0.6);
}

function church(out: Part[], signs: Sign[], rng: Rng): Rect {
  // West block, facing the x=-60 street. n = +x, so u = -z, v = +x.
  const zc = -302;
  const f = new Frame(out, -60 + 6.2, zc, 1, 0);
  const tv0 = 2;
  const ts = 4.6;
  const nave0 = tv0 + ts;
  const naveL = 15;
  const naveW = 8.6;
  const naveH = 6.5;
  // Tower and spire
  f.add("body", 0, 6.5, tv0 + ts / 2, ts, 13, ts, STONE);
  f.add("detail", 0, 13.2, tv0 + ts / 2, ts + 0.4, 0.4, ts + 0.4, "#a39c90");
  f.add("pyramid", 0, 13.4, tv0 + ts / 2, ts - 0.3, 10, ts - 0.3, "#5a6270");
  f.add("detail", 0, 24.2, tv0 + ts / 2, 0.15, 1.6, 0.15, "#d4b25a"); // cross
  f.add("detail", 0, 24.4, tv0 + ts / 2, 0.9, 0.15, 0.15, "#d4b25a");
  f.add("detail", 0, 1.4, tv0 - 0.06, 1.6, 2.8, 0.14, "#5a2a1a"); // door
  f.add("winLit", 0, 7.5, tv0 - 0.06, 0.9, 2.2, 0.1, "#2a3a6a");
  f.add("detail", 0, 10.4, tv0 - 0.08, 1.5, 1.5, 0.1, WHITE); // clock face
  f.add("detail", 0.2, 10.5, tv0 - 0.14, 0.12, 0.7, 0.04, "#222");
  f.add("detail", -0.15, 10.3, tv0 - 0.14, 0.5, 0.1, 0.04, "#222");
  // Nave, ridge along v
  const nvc = nave0 + naveL / 2;
  f.add("body", 0, naveH / 2, nvc, naveW, naveH, naveL, STONE);
  f.add("roof", 0, naveH, nvc, naveL + 0.6, 3.6, naveW + 0.8, "#4a4f5a", 0, Math.PI / 2);
  for (const k of [-5, -1.5, 2, 5.5]) {
    f.add("winLit", -naveW / 2 - 0.06, 3.4, nvc + k, 0.1, 2.8, 0.9, "#3a2a6a");
    f.add("winLit", naveW / 2 + 0.06, 3.4, nvc + k, 0.1, 2.8, 0.9, "#6a2a3a");
  }
  f.add("winLit", 0, 4.2, nave0 + naveL + 0.06, 2.0, 2.0, 0.1, "#6a3a2a"); // rose window
  // Churchyard: gravestones, yews, low stone wall
  for (const side of [-1, 1])
    for (let v = 4; v <= 20; v += 3)
      for (const off of [6.4, 8.6, 10.6]) {
        if (rng() < 0.25) continue;
        f.add("detail", side * off + (rng() - 0.5) * 0.3, 0.45, v + rng() * 0.6, 0.7, 0.9, 0.18, rng() < 0.5 ? "#9a968e" : "#b3aea4");
      }
  tree(f, rng, -10.3, 1.9, 1.0, "#2f5f32");
  tree(f, rng, 10.3, 1.9, 1.0, "#2f5f32");
  tree(f, rng, 9, 22.5, 1.1, "#3f7a3a");
  f.add("detail", -6.6, 0.4, 0.4, 10.8, 0.8, 0.45, STONE);
  f.add("detail", 6.6, 0.4, 0.4, 10.8, 0.8, 0.45, STONE);
  f.add("detail", 0, 0.06, (0.4 + tv0) / 2 + 0.2, 2.2, 0.08, tv0, PAVING);
  f.add("detail", 0, 0.03, 12, 23.6, 0.06, 24, "#7fb562");
  void signs;
  return f.rect(-12, 12, 0, 24.3);
}

function school(out: Part[], signs: Sign[], rng: Rng): Rect {
  // East block, facing the z=-320 street. n = +z, so u = +x, v = +z.
  const f = new Frame(out, 0, -320 + 6.2, 0, 1);
  const bu0 = 27;
  const bu1 = 53.5;
  const buc = (bu0 + bu1) / 2;
  const bw = bu1 - bu0;
  const vF = 1.8;
  const bd = 10;
  const H = 7.4;
  const brick = "#d9b56b";
  f.add("body", buc, H / 2, vF + bd / 2, bw, H, bd, brick);
  f.add("detail", buc, H + 0.25, vF + bd / 2, bw + 0.3, 0.5, bd + 0.3, "#5a6270");
  f.add("detail", buc, 3.7, vF - 0.05, bw + 0.05, 0.3, 0.12, "#1f5fae"); // blue band
  for (let k = 0; k < 7; k++) {
    const u = bu0 + 2 + k * 3.7;
    if (Math.abs(u - 34) < 1.5) continue;
    window_(f, rng, u, 1.9, vF, 2.4, 1.5, false, 0.35);
    window_(f, rng, u, 5.5, vF, 2.4, 1.5, false, 0.35);
    window_(f, rng, u, 1.9, vF + bd, 2.4, 1.5, true, 0.3);
    window_(f, rng, u, 5.5, vF + bd, 2.4, 1.5, true, 0.3);
  }
  f.add("detail", 34, 1.25, vF - 0.08, 2.4, 2.5, 0.14, "#f5c400"); // entrance doors
  f.add("detail", 34, 2.9, vF - 0.9, 3.6, 0.16, 1.8, "#1f5fae"); // canopy
  f.add("cyl", 32.4, 0, vF - 1.6, 0.12, 2.9, 0.12, "#ddd");
  f.add("cyl", 35.6, 0, vF - 1.6, 0.12, 2.9, 0.12, "#ddd");
  f.sign(signs, "ELMFIELD PRIMARY", "#1f5fae", "#ffffff", 42.5, 4.6, vF - 0.1, 11, 1.0);
  f.add("detail", 34, 0.06, vF / 2, 2.6, 0.08, vF, PAVING);
  // Playground (tarmac with painted games)
  const pu0 = 6.4;
  const pu1 = 25.5;
  const puc = (pu0 + pu1) / 2;
  f.add("detail", puc, 0.04, 13, pu1 - pu0, 0.08, 24.6, TARMAC);
  for (let k = 0; k < 6; k++) f.add("detail", 10, 0.1, 4 + k * 1.1, 1.0, 0.03, 1.0, k % 2 ? "#f5c400" : "#ffffff");
  f.add("detail", 11.1, 0.1, 8.4, 1.0, 0.03, 1.0, "#ffffff");
  f.add("detail", 8.9, 0.1, 8.4, 1.0, 0.03, 1.0, "#f5c400");
  // Painted court lines
  f.add("detail", 19, 0.1, 15, 9, 0.03, 0.12, "#ffffff");
  f.add("detail", 19, 0.1, 22, 9, 0.03, 0.12, "#ffffff");
  f.add("detail", 14.5, 0.1, 18.5, 0.12, 0.03, 7, "#ffffff");
  f.add("detail", 23.5, 0.1, 18.5, 0.12, 0.03, 7, "#ffffff");
  // Basketball hoop
  f.add("cyl", 19, 0, 23.2, 0.15, 3.2, 0.15, "#333");
  f.add("detail", 19, 3.4, 23.1, 1.8, 1.1, 0.08, WHITE);
  f.add("detail", 19, 3.05, 22.75, 0.6, 0.05, 0.6, "#ff6a1a");
  // Climbing frame: coloured poles and bars
  const cf = ["#c8202a", "#f5c400", "#1f5fae", "#2f8a57"];
  const cu = 11;
  const cv = 15;
  [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]].forEach(([a, b], i) => f.add("cyl", cu + a, 0, cv + b, 0.16, 2.6, 0.16, cf[i]));
  for (const y of [1.2, 2.5]) {
    f.add("detail", cu, y, cv - 1.5, 3.1, 0.12, 0.12, cf[0]);
    f.add("detail", cu, y, cv + 1.5, 3.1, 0.12, 0.12, cf[2]);
    f.add("detail", cu - 1.5, y, cv, 0.12, 0.12, 3.1, cf[1]);
    f.add("detail", cu + 1.5, y, cv, 0.12, 0.12, 3.1, cf[3]);
  }
  f.add("detail", cu, 2.6, cv, 3.1, 0.12, 3.1, "#f5c400");
  f.add("detail", cu + 1.5 + 1.4, 1.3, cv, 0.9, 0.1, 3.2, "#c8202a", -0.75, -Math.PI / 2);
  // Field with goalposts behind the building
  f.add("detail", buc, 0.03, (vF + bd + 25.3) / 2 + 0.3, bw, 0.06, 25.3 - vF - bd - 0.6, "#78c25a");
  f.add("detail", buc - 9, 1.1, 18.8, 0.12, 2.2, 3.5, WHITE);
  f.add("detail", buc + 9, 1.1, 18.8, 0.12, 2.2, 3.5, WHITE);
  f.add("detail", buc - 9, 2.2, 18.8, 0.14, 0.14, 3.6, WHITE);
  f.add("detail", buc + 9, 2.2, 18.8, 0.14, 0.14, 3.6, WHITE);
  // Green railings around the playground
  const rail = "#2e6b3e";
  f.add("detail", puc, 0.9, 0.4, pu1 - pu0, 0.08, 0.08, rail);
  f.add("detail", puc, 0.3, 0.4, pu1 - pu0, 0.08, 0.08, rail);
  f.add("detail", pu0 + 0.05, 0.9, 13, 0.08, 0.08, 25, rail);
  f.add("detail", pu0 + 0.05, 0.3, 13, 0.08, 0.08, 25, rail);
  for (let u = pu0; u <= pu1; u += 0.9) f.add("detail", u, 0.6, 0.4, 0.06, 1.2, 0.06, rail);
  for (let v = 0.4; v <= 25.4; v += 0.9) f.add("detail", pu0 + 0.05, 0.6, v, 0.06, 1.2, 0.06, rail);
  tree(f, rng, 23.5, 3.5, 1.0);
  return f.rect(6, 54, 0, 25.6);
}

// ---------------------------------------------------------------------------------------------
// The layout

/** Internal suburb streets, axis aligned. */
function suburbStreets(): Seg[] {
  const out: Seg[] = [];
  for (const e of ROAD_EDGES.values()) {
    const a = ROAD_NODES.get(e.a);
    const b = ROAD_NODES.get(e.b);
    if (!a || !b || a.zone !== "suburbs" || b.zone !== "suburbs") continue;
    out.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z });
  }
  // horizontal streets first so the long frontages get the corner lots
  out.sort((p, q) => Number(p.az !== p.bz) - Number(q.az !== q.bz) || p.az - q.az || p.ax - q.ax);
  return out;
}

export function buildLayout(seed = 1337): Layout {
  const rng = mulberry32(seed);
  const parts: Part[] = [];
  const signs: Sign[] = [];
  const lots: Rect[] = [];
  const roads = allRoadSegments();
  const clear = (r: Rect) => roads.every((s) => segRectDist(s, r) >= CLEARANCE);

  const reserved = [parade(parts, signs, rng), pub(parts, signs, rng), church(parts, signs, rng), school(parts, signs, rng)];
  const taken = (r: Rect) => reserved.some((q) => overlaps(q, r, 0.3)) || lots.some((q) => overlaps(q, r, 0.2));

  for (const s of suburbStreets()) {
    const len = Math.hypot(s.bx - s.ax, s.bz - s.az);
    const dx = (s.bx - s.ax) / len;
    const dz = (s.bz - s.az) / len;
    for (const side of [1, -1]) {
      const nx = -dz * side;
      const nz = dx * side;
      let t = 0;
      while (t < len) {
        let placed = false;
        for (const compact of [false, true]) {
          const o = houseOpts(rng, compact);
          const cx = s.ax + dx * (t + o.L / 2);
          const cz = s.az + dz * (t + o.L / 2);
          if (t + o.L > len + 6) break;
          const f = new Frame(parts, cx + nx * (CLEARANCE + 0.2), cz + nz * (CLEARANCE + 0.2), nx, nz);
          const r = f.rect(-o.L / 2, o.L / 2, 0, o.D);
          if (!inZone(r) || taken(r) || !clear(r)) continue;
          house(f, rng, o);
          lots.push(r);
          t += o.L + 0.4;
          placed = true;
          break;
        }
        if (!placed) t += 1;
      }
    }
  }

  // Fill leftover back-garden space with trees.
  const treeF = new Frame(parts, 0, 0, 0, 1);
  for (let i = 0; i < 260; i++) {
    const x = range(rng, zone.minX + 2, zone.maxX - 2);
    const z = range(rng, zone.minZ + 2, zone.maxZ - 2);
    const r = { minX: x - 2.2, maxX: x + 2.2, minZ: z - 2.2, maxZ: z + 2.2 };
    if (taken(r) || !clear(r)) continue;
    tree(treeF, rng, x, z, range(rng, 0.9, 1.3));
    lots.push(r);
  }

  return { parts, signs, lots, reserved };
}

/** 0 (day) .. 1 (full night) window glow for an hour of the day. */
export function glowForHour(h: number) {
  const hr = ((Math.floor(h) % 24) + 24) % 24;
  if (hr >= 20 || hr < 6) return 1;
  if (hr === 19 || hr === 6) return 0.7;
  if (hr === 18 || hr === 7) return 0.3;
  return 0;
}
