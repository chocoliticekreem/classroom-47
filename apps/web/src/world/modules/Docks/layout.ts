// Docks: static layout + pure animation timelines (no three.js here, so it is unit-testable).
import { ROAD_WIDTH, WATER_X, ZONES } from "../../config";
import { ROAD_EDGES, ROAD_NODES } from "../../roads";

// ---------- geometry constants ----------
export const CONTAINER = { w: 2.44, h: 2.6, l: 12.2 }; // 40 ft box, long axis along z

export const SHIP = {
  x: WATER_X + 14, // hull centre line
  beam: 24,
  zBow: -78,
  zStern: 76,
  deckY: 5.5, // top of the hull deck
  keelY: -5,
};
export const SHIP_ROWS = 8;
export const SHIP_BAYS = 8;
export const shipRowX = (i: number) => SHIP.x + (i - (SHIP_ROWS - 1) / 2) * 2.62;
export const shipBayZ = (k: number) => -54 + k * 12.8;

/** Ship bobbing, shared by the hull and anything the cranes rest on the deck. */
export function shipBob(tSec: number) {
  return Math.sin(tSec * 0.55) * 0.14 + Math.sin(tSec * 0.23 + 1.3) * 0.06;
}
export function shipRoll(tSec: number) {
  return Math.sin(tSec * 0.41 + 0.7) * 0.006;
}

// ---------- cranes ----------
export const CRANE_LEG_X = [325.5, 337.5] as const; // landside + waterside rail
export const CRANE_LEG_HALF_Z = 8.5;
export const CRANE_HOME_X = 331.5; // over the apron landing pad, between the legs
export const CRANE_SLOT_ROW = 3;
export const CRANE_BOOM_Y = 33; // underside of the boom girders
export const CRANE_UP_Y = 25; // spreader bottom when fully hoisted
export const CRANE_PERIOD = 52; // load + unload cycle, seconds
export const APRON_Y = 0.03;

export interface Crane {
  z: number;
  offset: number; // seconds into the cycle at t = 0
  shipStack: number; // containers already in the slot below the moving one
}
export const CRANES: Crane[] = [
  { z: shipBayZ(1), offset: 0, shipStack: 2 },
  { z: shipBayZ(4), offset: 17, shipStack: 3 },
  { z: shipBayZ(6), offset: 34, shipStack: 1 },
];

export interface CraneState {
  trolleyX: number;
  spreaderY: number; // spreader bottom (= container top when carrying)
  carrying: boolean;
  boxX: number;
  boxY: number; // container bottom
  sway: number; // spreader swing about the z axis, radians
}

const smooth = (u: number) => u * u * (3 - 2 * u);
const clamp01 = (u: number) => (u < 0 ? 0 : u > 1 ? 1 : u);
const mod = (a: number, n: number) => ((a % n) + n) % n;

const T_TRAVEL = 4.2;
const T_LOWER = 3.4;
const T_LATCH = 0.9;

export function craneAt(tSec: number, c: Crane, out?: CraneState): CraneState {
  const o = out ?? { trolleyX: 0, spreaderY: 0, carrying: false, boxX: 0, boxY: 0, sway: 0 };
  const t = mod(tSec + c.offset, CRANE_PERIOD);
  const half = CRANE_PERIOD / 2;
  const unloading = t < half;
  let u = unloading ? t : t - half;

  const shipX = shipRowX(CRANE_SLOT_ROW);
  const shipY = SHIP.deckY + c.shipStack * CONTAINER.h + shipBob(tSec);
  const H = CRANE_HOME_X;
  const fx = unloading ? shipX : H, fy = unloading ? shipY : APRON_Y;
  const tx = unloading ? H : shipX, ty = unloading ? APRON_Y : shipY;
  const top = CRANE_UP_Y;
  const h = CONTAINER.h;
  const travel = (a: number, b: number) => (Math.abs(a - b) < 0.01 ? 0 : T_TRAVEL);

  // Steps: [duration, trolley from, trolley to, spreader from, spreader to, carrying, boxAtTo]
  const steps: [number, number, number, number, number, boolean, boolean][] = [
    [travel(H, fx), H, fx, top, top, false, false],
    [T_LOWER, fx, fx, top, fy + h, false, false],
    [T_LATCH, fx, fx, fy + h, fy + h, false, false],
    [T_LOWER, fx, fx, fy + h, top, true, false],
    [travel(fx, tx), fx, tx, top, top, true, false],
    [T_LOWER, tx, tx, top, ty + h, true, false],
    [T_LATCH, tx, tx, ty + h, ty + h, false, true],
    [T_LOWER, tx, tx, ty + h, top, false, true],
    [travel(tx, H), tx, H, top, top, false, true],
  ];
  o.sway = 0;
  for (const [d, x0, x1, y0, y1, carrying, atTo] of steps) {
    if (d > 0 && u < d) {
      const k = smooth(clamp01(u / d));
      o.trolleyX = x0 + (x1 - x0) * k;
      o.spreaderY = y0 + (y1 - y0) * k;
      o.carrying = carrying;
      if (x0 !== x1) o.sway = Math.sin((u / d) * Math.PI * 2) * (carrying ? 0.035 : 0.05) * Math.sign(x1 - x0);
      if (carrying) {
        o.boxX = o.trolleyX;
        o.boxY = o.spreaderY - h;
      } else {
        o.boxX = atTo ? tx : fx;
        o.boxY = atTo ? ty : fy;
      }
      return o;
    }
    u -= d;
  }
  // idle at home, box delivered
  o.trolleyX = H;
  o.spreaderY = top;
  o.carrying = false;
  o.boxX = tx;
  o.boxY = ty;
  return o;
}

// ---------- straddle carrier ----------
export const STRADDLE = { cx: 291, cz: 0, hx: 9, hz: 16, rc: 5, speed: 5, pause: 2.8, lift: 3.4 };
export const STRADDLE_HALF = { w: 2.4, l: 4.2, r: 5.2 };

type Seg = { len: number; at: (s: number) => [number, number, number] }; // x, z, yaw
function straight(x0: number, z0: number, x1: number, z1: number): Seg {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const yaw = Math.atan2(x1 - x0, z1 - z0);
  return { len, at: (s) => [x0 + ((x1 - x0) * s) / len, z0 + ((z1 - z0) * s) / len, yaw] };
}
function arc(cx: number, cz: number, r: number, a0: number, a1: number): Seg {
  const len = Math.abs(a1 - a0) * r;
  const dir = Math.sign(a1 - a0);
  return {
    len,
    at: (s) => {
      const a = a0 + (dir * s) / r;
      const tx = -Math.sin(a) * dir, tz = Math.cos(a) * dir;
      return [cx + Math.cos(a) * r, cz + Math.sin(a) * r, Math.atan2(tx, tz)];
    },
  };
}
const { cx: SCX, cz: SCZ, hx: SHX, hz: SHZ, rc: SRC } = STRADDLE;
const LOOP: Seg[] = [
  straight(SCX + SHX, SCZ, SCX + SHX, SCZ + SHZ - SRC),
  arc(SCX + SHX - SRC, SCZ + SHZ - SRC, SRC, 0, Math.PI / 2),
  straight(SCX + SHX - SRC, SCZ + SHZ, SCX - SHX + SRC, SCZ + SHZ),
  arc(SCX - SHX + SRC, SCZ + SHZ - SRC, SRC, Math.PI / 2, Math.PI),
  straight(SCX - SHX, SCZ + SHZ - SRC, SCX - SHX, SCZ - SHZ + SRC),
  arc(SCX - SHX + SRC, SCZ - SHZ + SRC, SRC, Math.PI, Math.PI * 1.5),
  straight(SCX - SHX + SRC, SCZ - SHZ, SCX + SHX - SRC, SCZ - SHZ),
  arc(SCX + SHX - SRC, SCZ - SHZ + SRC, SRC, Math.PI * 1.5, Math.PI * 2),
  straight(SCX + SHX, SCZ - SHZ + SRC, SCX + SHX, SCZ),
];
const LOOP_LEN = LOOP.reduce((a, s) => a + s.len, 0);
function loopAt(s: number): [number, number, number] {
  let r = mod(s, LOOP_LEN);
  for (const seg of LOOP) {
    if (r <= seg.len) return seg.at(r);
    r -= seg.len;
  }
  return LOOP[0].at(0);
}
export const STRADDLE_SPOTS = { A: loopAt(0), B: loopAt(LOOP_LEN / 2) };
const HALF_DRIVE = LOOP_LEN / 2 / STRADDLE.speed;
const VISIT = STRADDLE.pause + HALF_DRIVE;
// Visits alternate A, B, A, B, A, B. Box: picked at A (v0), dropped at B (v1), picked at B (v3), dropped at A (v4).
export const STRADDLE_PERIOD = VISIT * 6;

export interface StraddleState {
  x: number;
  z: number;
  yaw: number;
  boxX: number;
  boxZ: number;
  boxY: number;
  boxYaw: number;
}
export function straddleAt(tSec: number, out?: StraddleState): StraddleState {
  const o = out ?? { x: 0, z: 0, yaw: 0, boxX: 0, boxZ: 0, boxY: 0, boxYaw: 0 };
  const t = mod(tSec, STRADDLE_PERIOD);
  const v = Math.floor(t / VISIT);
  const u = t - v * VISIT;
  const startS = (v * LOOP_LEN) / 2;
  const driving = u > STRADDLE.pause;
  const s = driving ? startS + (LOOP_LEN / 2) * smooth(clamp01((u - STRADDLE.pause) / HALF_DRIVE)) : startS;
  const [x, z, yaw] = loopAt(s);
  o.x = x;
  o.z = z;
  o.yaw = yaw;
  const pk = smooth(clamp01(u / STRADDLE.pause)); // progress of the lift/lower during the pause
  // Which visit carries the box out of this stop, and where it rests otherwise.
  const carriedOut = v === 0 || v === 3;
  const droppedIn = v === 1 || v === 4;
  if (carriedOut) {
    o.boxY = driving ? STRADDLE.lift : STRADDLE.lift * pk;
    o.boxX = x;
    o.boxZ = z;
    o.boxYaw = yaw;
  } else if (droppedIn && !driving) {
    o.boxY = STRADDLE.lift * (1 - pk);
    o.boxX = x;
    o.boxZ = z;
    o.boxYaw = yaw;
  } else {
    const atB = v === 1 || v === 2;
    const spot = atB ? STRADDLE_SPOTS.B : STRADDLE_SPOTS.A;
    o.boxX = spot[0];
    o.boxZ = spot[1];
    o.boxY = 0;
    o.boxYaw = spot[2];
  }
  o.boxY += APRON_Y;
  return o;
}

// ---------- roads ----------
const half = ROAD_WIDTH / 2;
const SEGS: [number, number, number, number][] = [];
for (const e of ROAD_EDGES.values()) {
  const a = ROAD_NODES.get(e.a)!, b = ROAD_NODES.get(e.b)!;
  if (Math.max(a.x, b.x) < ZONES.docks.minX - 30) continue;
  SEGS.push([a.x, a.z, b.x, b.z]);
}
/** Distance from (x, z) to the nearest road edge (negative = on the road). */
export function roadClearance(x: number, z: number) {
  let best = Infinity;
  for (const [ax, az, bx, bz] of SEGS) {
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz;
    const k = l2 === 0 ? 0 : clamp01(((x - ax) * dx + (z - az) * dz) / l2);
    const d = Math.hypot(x - ax - dx * k, z - az - dz * k);
    if (d < best) best = d;
  }
  return best - half;
}
/** True if an axis-aligned rect (centre, half sizes) keeps `margin` metres from every road. */
export function rectClearOfRoads(cx: number, cz: number, hw: number, hd: number, margin: number) {
  const nx = Math.max(2, Math.ceil((hw * 2) / 1)), nz = Math.max(2, Math.ceil((hd * 2) / 1));
  for (let i = 0; i <= nx; i++)
    for (let j = 0; j <= nz; j++) {
      const x = cx - hw + (2 * hw * i) / nx, z = cz - hd + (2 * hd * j) / nz;
      if (roadClearance(x, z) < margin) return false;
    }
  return true;
}

// ---------- buildings, lights ----------
export interface Shed {
  x: number;
  z: number;
  w: number; // along x
  d: number; // along z
  h: number;
  color: string;
  sign: string;
}
export const SHEDS: Shed[] = [
  { x: 263, z: -68, w: 36, d: 18, h: 9, color: "#c8ccd2", sign: "HAMYWAY DELIVERY" },
  { x: 263, z: 68, w: 36, d: 18, h: 9, color: "#b8c4b0", sign: "BONDED STORE 7" },
];
export const LIGHT_TOWERS = [
  { x: 246, z: -40 },
  { x: 246, z: 40 },
  { x: 290, z: -74 },
  { x: 290, z: 74 },
  { x: 276, z: 0 },
  { x: 320, z: -30 },
  { x: 320, z: 32 },
];

// ---------- yard ----------
export interface Stack {
  x: number;
  z: number;
  tiers: number;
  short: boolean; // 20 ft box
  seed: number;
}
function rand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const docksRand = rand;

function overlaps(ax: number, az: number, ahw: number, ahd: number, bx: number, bz: number, bhw: number, bhd: number) {
  return Math.abs(ax - bx) < ahw + bhw && Math.abs(az - bz) < ahd + bhd;
}

let cachedSlots: Stack[] | null = null;
export function yardSlots(): Stack[] {
  if (cachedSlots) return cachedSlots;
  const r = rand(1337);
  const out: Stack[] = [];
  const zb = ZONES.docks;
  const pitchX = CONTAINER.w + 0.35;
  const pitchZ = CONTAINER.l + 1.0;
  for (let i = 0; ; i++) {
    const x = zb.minX + 2.5 + i * pitchX;
    if (x > 321) break;
    if (i % 6 === 5) continue; // aisle every 5 rows
    for (let j = 0; ; j++) {
      const z = zb.minZ + 1.5 + CONTAINER.l / 2 + j * pitchZ;
      if (z + CONTAINER.l / 2 > zb.maxZ - 1) break;
      const short = r() < 0.22;
      const hw = CONTAINER.w / 2, hd = (short ? CONTAINER.l / 2 : CONTAINER.l) / 2;
      if (!rectClearOfRoads(x, z, hw, hd, 1.5)) continue;
      if (SHEDS.some((s) => overlaps(x, z, hw, hd, s.x, s.z, s.w / 2 + 3, s.d / 2 + 2))) continue;
      if (LIGHT_TOWERS.some((t) => overlaps(x, z, hw, hd, t.x, t.z, 1.6, 1.6))) continue;
      // straddle carrier corridor (the loop interior is filled explicitly below)
      if (overlaps(x, z, hw, hd, SCX, SCZ, SHX + 4, SHZ + 4)) continue;
      // crane legs
      if (CRANES.some((c) => overlaps(x, z, hw, hd, CRANE_LEG_X[0], c.z, 2, CRANE_LEG_HALF_Z + 2))) continue;
      const tiers = 1 + Math.floor(r() * r() * 4.2);
      if (r() < 0.12) continue; // a few gaps make it read as a working yard
      out.push({ x, z, tiers: Math.min(tiers, 4), short, seed: Math.floor(r() * 1e9) });
    }
  }
  // Inside the straddle loop: one neat row
  for (const z of [-7, 7]) out.push({ x: SCX - 1.5, z, tiers: 2, short: true, seed: Math.floor(r() * 1e9) });
  out.push({ x: SCX + 1.5, z: 0, tiers: 1, short: false, seed: Math.floor(r() * 1e9) });
  cachedSlots = out;
  return out;
}

/** 0 by day, 1 at night, ramps through dusk (17-19) and dawn (5.5-7). */
export function nightFactor(hour: number) {
  const h = mod(hour, 24);
  if (h >= 19 || h <= 5.5) return 1;
  if (h >= 17) return (h - 17) / 2;
  if (h < 7) return 1 - (h - 5.5) / 1.5;
  return 0;
}
