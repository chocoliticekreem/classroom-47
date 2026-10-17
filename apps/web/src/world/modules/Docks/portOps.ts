// Docks port operations: a small time-stepped simulation of three STS cranes working the ship at
// berth "docks" (berths.ts contract) and two straddle carriers moving boxes between the cranes'
// landing spots on the quay and two buffer blocks at the ends of the apron.
// Pure logic (no three.js / React): `stepPortOps(ops, berth, dt)` mutates `ops` and the berth.
//
//   discharge: deck top box -> crane -> quay landing spot -> carrier -> yard block (stacks grow)
//   load:      yard block -> carrier -> landing spot -> crane -> empty deck slot (until ~60% full)
//
// Cranes keep >= 2 bays apart, never lower onto the quay while a carrier is under them, and
// carriers never enter a crane's landing zone while it is locked. No public roads are used:
// everything runs on the apron lane between the crane rails (x = 331.5).
import { deckIndex, deckSlotPosition, type BerthState } from "../../berths";

// ---------- tunables ----------
export const HOME_X = 331.5; // trolley parking position over the quay landing spot / carrier lane
export const LANE_X = 331.5;
export const UP_Y = 25; // spreader bottom when fully hoisted
export const APRON_Y = 0.03;
export const BOX_H = 2.6;
export const DECK_Y = 5.5;
export const BAY_PITCH = 12.6;
export const DISCHARGE_PER_CRANE = 3;
export const LOAD_MIN_PER_CRANE = 2;
export const LOAD_MAX_PER_CRANE = 4;
export const LOAD_TARGET_FILL = 0.6;
export const CRANE_BAYS: number[][] = [
  [0, 1, 2],
  [3, 4, 5, 6],
  [7, 8, 9],
];
export const PARK_Z = [-44, 0, 44];
export const BOOM_TIME = 7; // seconds to raise or lower a boom
export const LOCK_R = 11; // carriers stay this far (centre to centre, along z) from a locked crane
export const BLOCK_Z = 73.8; // buffer block row centre (|z|), beyond the cranes' travel
export const BLOCK_COLS = [327.5, 331.5, 335.5];
export const BLOCK_TIERS = 3;
export const BLOCK_INITIAL = 1; // boxes per column at start
export const CARRIER_LIFT = 8.4; // carried box bottom
export const CARRIER_SPEED = 9;
export const CARRIER_ACCEL = 3.5;
export const GANTRY_SPEED = 2.5;
export const PARK_CARRIER_Z = 70; // idle carriers straddle the middle block column
export const TROLLEY_SPEED = 5;

const T_LOWER = 4.2;
const T_HOIST = 4.0;
const T_LATCH = 0.9;
const T_LIFT = 2.2;

export interface Box {
  color: string;
  brand?: string;
}

type Num = () => number;
type Step =
  | { k: "gantry"; z1: number; z0?: number; t?: number; dur?: number }
  | { k: "trolley"; x1: () => number; x0?: number; t?: number; dur?: number }
  | { k: "lower"; to: Num; y0?: number; t?: number; dur: number }
  | { k: "hoist"; from: Num; t?: number; dur: number }
  | { k: "hold"; follow: Num; t?: number; dur: number }
  | { k: "wait"; until: () => boolean; t?: number; timeout?: number; onTimeout?: () => void }
  | { k: "act"; fn: () => void };

export interface CraneOp {
  id: number;
  z: number;
  trolleyX: number;
  spreaderY: number;
  sway: number;
  boom: number; // 0 = lowered (working), 1 = raised
  box: Box | null;
  mode: "idle" | "discharge" | "load" | "done";
  bay: number | null; // bay it is positioned at (or heading to)
  steps: Step[];
  discharged: number;
  loaded: number;
  wantBox: boolean;
  locked: boolean; // spreader working the quay spot: carriers keep out
  waitedForBay: number;
  reqAt: number; // when the current import (box on spot) or export request (wantBox) was raised
  spot: { z: number; box: Box | null; kind: "import" | "export" };
}

export interface CarrierOp {
  id: number;
  side: -1 | 1; // -1 = north (z < 0), 1 = south
  z: number;
  x: number;
  yaw: number;
  v: number;
  col: number; // lane offset target column (x) used near the block
  box: Box | null;
  boxY: number;
  steps: CStep[];
  job: string | null;
}
type CStep =
  | { k: "drive"; z: number; col: number }
  | { k: "lift"; y0: number; y1: number; t?: number; dur: number }
  | { k: "act"; fn: () => void };

export interface PortOps {
  cranes: CraneOp[];
  carriers: CarrierOp[];
  blocks: Record<"-1" | "1", Box[][]>; // per side: columns of stacked boxes (bottom first)
  callId: number; // phaseStartedAt of the call being worked
  working: boolean;
  t: number;
  rand: () => number;
}

const TINTS = ["#c0392b", "#2e6fb7", "#3f8f4f", "#e0b52c", "#2a9d8f", "#8e3b46", "#8a9199", "#c76b29", "#e6e6e2", "#2c3e75", "#6d4c8c"];
export const EXPORT_BRANDS = ["HAMYWAY", "HAMSTER LINE", "NORTHWIND", "KESTREL"];

function mulberry(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function randomBox(r: () => number): Box {
  const p = r();
  if (p < 0.3) return { color: "#ff6a1a", brand: "HAMYWAY" };
  if (p < 0.4) return { color: "#1f8a7a", brand: "HAMSTER LINE" };
  return { color: TINTS[Math.floor(r() * TINTS.length)] };
}

export function createPortOps(seed = 7): PortOps {
  const rand = mulberry(seed);
  const block = () => BLOCK_COLS.map(() => Array.from({ length: BLOCK_INITIAL }, () => randomBox(rand)));
  return {
    cranes: PARK_Z.map((z, id) => ({
      id, z, trolleyX: HOME_X, spreaderY: UP_Y, sway: 0, boom: 1, box: null, mode: "idle", bay: null, steps: [],
      discharged: 0, loaded: 0, wantBox: false, locked: false, waitedForBay: 0, reqAt: 0,
      spot: { z, box: null, kind: "import" },
    })),
    carriers: ([-1, 1] as const).map((side, id) => ({
      id, side, z: side * 58, x: LANE_X, yaw: 0, v: 0, col: LANE_X, box: null, boxY: CARRIER_LIFT, steps: [], job: null,
    })),
    blocks: { "-1": block(), "1": block() },
    callId: -1,
    working: false,
    t: 0,
    rand,
  };
}

// ---------- helpers ----------
const smooth = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
export const bayZ = (b: BerthState, bay: number) => b.z + (bay - (b.bays - 1) / 2) * BAY_PITCH;
const sideOf = (z: number): -1 | 1 => (z < 0 ? -1 : 1);

/** Highest occupied tier in a deck stack, or -1. */
export function topTier(b: BerthState, bay: number, row: number) {
  for (let t = b.tiers - 1; t >= 0; t--) if (b.deck[deckIndex(b, bay, row, t)].color) return t;
  return -1;
}
export function deckFill(b: BerthState) {
  let n = 0;
  for (const s of b.deck) if (s.color) n++;
  return n / b.deck.length;
}
function bayBoxes(b: BerthState, bay: number) {
  let n = 0;
  for (let r = 0; r < b.rows; r++) n += topTier(b, bay, r) + 1;
  return n;
}
function bayHasRoom(b: BerthState, bay: number) {
  for (let r = 0; r < b.rows; r++) if (topTier(b, bay, r) < b.tiers - 1) return true;
  return false;
}
/** Row to discharge from: the tallest stack, landside first on ties. */
function dischargeRow(b: BerthState, bay: number) {
  let best = -1, bt = -1;
  for (let r = 0; r < b.rows; r++) {
    const t = topTier(b, bay, r);
    if (t > bt) {
      bt = t;
      best = r;
    }
  }
  return bt < 0 ? -1 : best;
}
/** Row to load into: the lowest stack, landside first on ties. */
function loadRow(b: BerthState, bay: number) {
  let best = -1, bt = Infinity;
  for (let r = 0; r < b.rows; r++) {
    const t = topTier(b, bay, r);
    if (t < b.tiers - 1 && t < bt) {
      bt = t;
      best = r;
    }
  }
  return best;
}
const blockCount = (ops: PortOps, side: -1 | 1) => ops.blocks[side].reduce((a, c) => a + c.length, 0);
const blockCap = () => BLOCK_COLS.length * BLOCK_TIERS;

function bayPos(b: BerthState, c: CraneOp) {
  return (c.z - b.z) / BAY_PITCH + (b.bays - 1) / 2;
}
/** A crane may work `bay` if every other crane is (and is heading) at least 2 bays away. */
export function bayAllowed(ops: PortOps, b: BerthState, c: CraneOp, bay: number) {
  for (const o of ops.cranes) {
    if (o === c) continue;
    if (Math.abs(bay - bayPos(b, o)) < 2 - 1e-6) return false;
    if (o.bay !== null && Math.abs(bay - o.bay) < 2) return false;
  }
  return true;
}
function carrierNear(ops: PortOps, z: number) {
  return ops.carriers.some((k) => Math.abs(k.z - z) < LOCK_R);
}

// ---------- crane planning ----------
function inboundImports(ops: PortOps, side: -1 | 1) {
  let n = 0;
  for (const c of ops.cranes) {
    if (c.spot.box && c.spot.kind === "import" && sideOf(c.spot.z) === side) n++;
    if (c.box && c.mode === "discharge" && sideOf(c.z) === side) n++;
  }
  for (const k of ops.carriers) if (k.side === side && k.box && k.job === "import") n++;
  return n;
}
function pendingExports(ops: PortOps, side: -1 | 1) {
  return ops.cranes.filter((c) => c.wantBox && !c.spot.box && sideOf(c.z) === side).length;
}

function planDischarge(ops: PortOps, b: BerthState, c: CraneOp): Step[] | null {
  if (c.discharged >= DISCHARGE_PER_CRANE) return null;
  const bays = CRANE_BAYS[c.id].filter((bay) => bayBoxes(b, bay) > 0);
  if (bays.length === 0) return null;
  // prefer the bay we're at, then the rest in order
  bays.sort((p, q) => (p === c.bay ? -1 : q === c.bay ? 1 : p - q));
  const bay = bays.find((x) => bayAllowed(ops, b, c, x));
  if (bay === undefined) return [];
  const side = sideOf(bayZ(b, bay));
  if (blockCount(ops, side) + inboundImports(ops, side) >= blockCap()) return null; // yard full on that side
  const row = dischargeRow(b, bay);
  c.bay = bay;
  const steps: Step[] = [];
  if (Math.abs(c.z - bayZ(b, bay)) > 0.05) steps.push({ k: "gantry", z1: bayZ(b, bay) });
  let tier = -1;
  const top = () => deckSlotPosition(b, bay, row, Math.max(0, tier), DECK_Y).y + BOX_H / 2;
  steps.push(
    { k: "act", fn: () => (tier = topTier(b, bay, row)) },
    { k: "trolley", x1: () => deckSlotPosition(b, bay, row, 0, DECK_Y).x },
    { k: "lower", to: top, dur: T_LOWER },
    { k: "hold", follow: top, dur: T_LATCH },
    {
      k: "act",
      fn: () => {
        const slot = b.deck[deckIndex(b, bay, row, tier)];
        c.box = slot.color ? { color: slot.color, brand: slot.brand } : randomBox(ops.rand);
        slot.color = null;
        slot.brand = undefined;
        c.discharged++;
        b.discharged++;
      },
    },
    { k: "hoist", from: top, dur: T_HOIST },
    { k: "trolley", x1: () => HOME_X },
    ...placeOnSpot(ops, c, "import"),
  );
  return steps;
}

function placeOnSpot(ops: PortOps, c: CraneOp, kind: "import" | "export"): Step[] {
  return [
    {
      k: "wait",
      until: () => {
        if (c.spot.box || carrierNear(ops, c.z)) return false;
        c.locked = true;
        return true;
      },
    },
    { k: "lower", to: () => APRON_Y + BOX_H, dur: T_LOWER },
    { k: "hold", follow: () => APRON_Y + BOX_H, dur: T_LATCH },
    {
      k: "act",
      fn: () => {
        c.spot = { z: c.z, box: c.box, kind };
        c.box = null;
        c.reqAt = ops.t;
      },
    },
    { k: "hoist", from: () => APRON_Y + BOX_H, dur: T_HOIST },
    { k: "act", fn: () => (c.locked = false) },
  ];
}

function wantsToLoad(ops: PortOps, b: BerthState, c: CraneOp) {
  if (c.loaded >= LOAD_MAX_PER_CRANE) return false;
  return c.loaded < LOAD_MIN_PER_CRANE || deckFill(b) < LOAD_TARGET_FILL;
}

function planLoad(ops: PortOps, b: BerthState, c: CraneOp): Step[] | null {
  if (!wantsToLoad(ops, b, c)) return null;
  const bays = CRANE_BAYS[c.id].filter((bay) => bayHasRoom(b, bay));
  if (bays.length === 0) return null;
  bays.sort((p, q) => (p === c.bay ? -1 : q === c.bay ? 1 : bayBoxes(b, p) - bayBoxes(b, q)));
  const bay = bays.find((x) => bayAllowed(ops, b, c, x));
  if (bay === undefined) return [];
  const side = sideOf(bayZ(b, bay));
  if (blockCount(ops, side) - pendingExports(ops, side) <= 0) return null; // nothing to export on that side
  c.bay = bay;
  const steps: Step[] = [];
  if (Math.abs(c.z - bayZ(b, bay)) > 0.05) steps.push({ k: "gantry", z1: bayZ(b, bay) });
  let row = -1, tier = 0;
  const slotTop = () => deckSlotPosition(b, bay, Math.max(0, row), tier, DECK_Y).y + BOX_H / 2;
  steps.push(
    {
      k: "act",
      fn: () => {
        c.wantBox = true;
        c.reqAt = ops.t;
      },
    },
    {
      k: "wait",
      until: () => {
        if (!c.spot.box || c.spot.kind !== "export" || carrierNear(ops, c.z)) return false;
        c.locked = true;
        return true;
      },
      timeout: 10,
      onTimeout: () => {
        // only give up if no carrier has the job and the yard on this side has run dry
        if (ops.carriers.some((k) => k.job === `exp${c.id}`) || c.spot.box || blockCount(ops, sideOf(c.z)) > 0) {
          const w = c.steps[0];
          if (w && w.k === "wait") w.t = 0;
          return;
        }
        c.wantBox = false;
        c.mode = "done";
        c.steps = [];
      },
    },
    { k: "lower", to: () => APRON_Y + BOX_H, dur: T_LOWER },
    { k: "hold", follow: () => APRON_Y + BOX_H, dur: T_LATCH },
    {
      k: "act",
      fn: () => {
        c.box = c.spot.box;
        c.spot = { ...c.spot, box: null };
        c.wantBox = false;
      },
    },
    { k: "hoist", from: () => APRON_Y + BOX_H, dur: T_HOIST },
    { k: "act", fn: () => (c.locked = false) },
    {
      k: "act",
      fn: () => {
        row = loadRow(b, bay);
        tier = row < 0 ? 0 : topTier(b, bay, row) + 1;
      },
    },
    { k: "trolley", x1: () => deckSlotPosition(b, bay, Math.max(0, row), 0, DECK_Y).x },
    { k: "lower", to: slotTop, dur: T_LOWER },
    { k: "hold", follow: slotTop, dur: T_LATCH },
    {
      k: "act",
      fn: () => {
        if (row >= 0 && c.box) {
          const slot = b.deck[deckIndex(b, bay, row, tier)];
          slot.color = c.box.color;
          slot.brand = c.box.brand;
          c.loaded++;
          b.loaded++;
        }
        c.box = null;
      },
    },
    { k: "hoist", from: slotTop, dur: T_HOIST },
    { k: "trolley", x1: () => HOME_X },
  );
  return steps;
}

function plan(ops: PortOps, b: BerthState, c: CraneOp) {
  if (c.mode === "idle") c.mode = "discharge";
  if (c.mode === "discharge") {
    const s = planDischarge(ops, b, c);
    if (s === null) c.mode = "load";
    else return s;
  }
  if (c.mode === "load") {
    const s = planLoad(ops, b, c);
    if (s === null) {
      c.mode = "done";
      c.bay = null;
    } else return s;
  }
  return null;
}

// ---------- step runners ----------
function runCrane(ops: PortOps, b: BerthState, c: CraneOp, dt: number) {
  let budget = dt;
  for (let guard = 0; guard < 16 && budget > 0; guard++) {
    const s = c.steps[0];
    if (!s) return;
    if (s.k === "act") {
      s.fn();
      c.steps.shift();
      continue;
    }
    s.t = (s.t ?? 0) + budget;
    let done = false;
    let over = 0;
    switch (s.k) {
      case "gantry": {
        if (s.z0 === undefined) {
          s.z0 = c.z;
          s.dur = Math.max(2, Math.abs(s.z1 - s.z0) / GANTRY_SPEED);
        }
        const u = Math.min(1, s.t / s.dur!);
        c.z = s.z0 + (s.z1 - s.z0) * smooth(u);
        done = u >= 1;
        over = s.t - s.dur!;
        break;
      }
      case "trolley": {
        if (s.x0 === undefined) {
          s.x0 = c.trolleyX;
          s.dur = Math.max(1.6, Math.abs(s.x1() - s.x0) / TROLLEY_SPEED);
        }
        const x1 = s.x1();
        const u = Math.min(1, s.t / s.dur!);
        c.trolleyX = s.x0 + (x1 - s.x0) * smooth(u);
        c.sway = Math.sin(u * Math.PI * 2) * (c.box ? 0.035 : 0.05) * Math.sign(x1 - s.x0);
        done = u >= 1;
        if (done) c.sway = 0;
        over = s.t - s.dur!;
        break;
      }
      case "lower": {
        if (s.y0 === undefined) s.y0 = c.spreaderY;
        const u = Math.min(1, s.t / s.dur);
        c.spreaderY = s.y0 + (s.to() - s.y0) * smooth(u);
        done = u >= 1;
        over = s.t - s.dur;
        break;
      }
      case "hoist": {
        const u = Math.min(1, s.t / s.dur);
        c.spreaderY = s.from() + (UP_Y - s.from()) * smooth(u);
        done = u >= 1;
        over = s.t - s.dur;
        break;
      }
      case "hold": {
        c.spreaderY = s.follow();
        done = s.t >= s.dur;
        over = s.t - s.dur;
        break;
      }
      case "wait": {
        if (s.until()) {
          done = true;
          over = 0;
        } else if (s.timeout !== undefined && s.t > s.timeout) {
          s.onTimeout?.();
          return;
        } else return;
        break;
      }
    }
    if (!done) return;
    c.steps.shift();
    budget = Math.max(0, over);
  }
}

function laneX(z: number, col: number) {
  const k = smooth((Math.abs(z) - 62) / 7);
  return LANE_X + (col - LANE_X) * k;
}

function runCarrier(ops: PortOps, k: CarrierOp, dt: number) {
  for (let guard = 0; guard < 8; guard++) {
    const s = k.steps[0];
    if (!s) {
      k.job = null;
      k.v = 0;
      return;
    }
    if (s.k === "act") {
      s.fn();
      k.steps.shift();
      continue;
    }
    if (s.k === "lift") {
      s.t = (s.t ?? 0) + dt;
      const u = Math.min(1, s.t / s.dur);
      k.boxY = s.y0 + (s.y1 - s.y0) * smooth(u);
      if (u < 1) return;
      k.steps.shift();
      return;
    }
    // drive along the lane, stopping short of locked crane zones
    k.col = s.col;
    let target = s.z;
    for (const c of ops.cranes) {
      if (!c.locked) continue;
      const lo = c.z - LOCK_R, hi = c.z + LOCK_R;
      if (k.z <= lo && target > lo) target = Math.min(target, lo);
      if (k.z >= hi && target < hi) target = Math.max(target, hi);
    }
    const d = target - k.z;
    const dist = Math.abs(d);
    const vmax = Math.min(CARRIER_SPEED, Math.sqrt(2 * CARRIER_ACCEL * dist));
    k.v = Math.min(vmax, k.v + CARRIER_ACCEL * dt);
    const stepZ = Math.min(dist, k.v * dt);
    const px = k.x, pz = k.z;
    k.z += Math.sign(d) * stepZ;
    k.x = laneX(k.z, k.col);
    if (stepZ > 1e-4) k.yaw = Math.atan2(k.x - px, Math.abs(k.z - pz)) * Math.sign(k.z - pz || 1);
    if (Math.abs(s.z - k.z) < 1e-3) {
      k.z = s.z;
      k.v = 0;
      k.steps.shift();
      continue;
    }
    return;
  }
}

function assignCarrier(ops: PortOps, k: CarrierOp) {
  const side = k.side;
  const blk = ops.blocks[side];
  // leave the block lane offset before changing column (|z| <= 62 means back on the centre lane)
  const exitIfInBlock = (): CStep[] =>
    Math.abs(k.z) > 62 && k.col !== LANE_X ? [{ k: "drive", z: side * 60, col: k.col }] : [];
  // 1. imports waiting on a spot on my side
  // Serve requests oldest first so neither imports nor exports starve.
  const oldest = (xs: CraneOp[]) => xs.reduce<CraneOp | null>((a, c) => (!a || c.reqAt < a.reqAt ? c : a), null);
  const impCol = blk.reduce((best, s, i) => (s.length < blk[best].length ? i : best), 1);
  let imp = oldest(
    ops.cranes.filter(
      (c) => c.spot.box && c.spot.kind === "import" && sideOf(c.spot.z) === side && !ops.carriers.some((o) => o.job === `imp${c.id}`),
    ),
  );
  if (imp && blk[impCol].length >= BLOCK_TIERS) imp = null; // block full: wait for an export to free space
  let exp = oldest(
    ops.cranes.filter(
      (c) => c.wantBox && !c.spot.box && sideOf(c.z) === side && !ops.carriers.some((o) => o.job === `exp${c.id}`),
    ),
  );
  if (exp && blockCount(ops, side) === 0) exp = null;
  if (imp && exp) {
    if (exp.reqAt < imp.reqAt) imp = null;
    else exp = null;
  }
  if (imp) {
    const col = impCol;
    const z = imp.spot.z;
    k.job = `imp${imp.id}`;
    k.steps = [
      ...exitIfInBlock(),
      { k: "drive", z, col: LANE_X },
      { k: "lift", y0: CARRIER_LIFT, y1: APRON_Y, dur: T_LIFT },
      {
        k: "act",
        fn: () => {
          k.box = imp.spot.box;
          k.boxY = APRON_Y;
          imp.spot = { ...imp.spot, box: null };
          k.job = "import";
        },
      },
      { k: "lift", y0: APRON_Y, y1: CARRIER_LIFT, dur: T_LIFT },
      { k: "drive", z: side * BLOCK_Z, col: BLOCK_COLS[col] },
      { k: "lift", y0: CARRIER_LIFT, y1: APRON_Y + blk[col].length * BOX_H, dur: T_LIFT },
      {
        k: "act",
        fn: () => {
          if (k.box) blk[col].push(k.box);
          k.box = null;
        },
      },
      { k: "lift", y0: APRON_Y + blk[col].length * BOX_H, y1: CARRIER_LIFT, dur: T_LIFT },
      { k: "drive", z: side * 58, col: BLOCK_COLS[col] },
    ];
    return;
  }
  // 2. a crane on my side wants an export box
  if (exp) {
    const col = blk.reduce((best, s, i) => (s.length > blk[best].length ? i : best), 1);
    k.job = `exp${exp.id}`;
    const fromY = APRON_Y + (blk[col].length - 1) * BOX_H;
    k.steps = [
      ...exitIfInBlock(),
      { k: "drive", z: side * BLOCK_Z, col: BLOCK_COLS[col] },
      { k: "lift", y0: CARRIER_LIFT, y1: fromY, dur: T_LIFT },
      {
        k: "act",
        fn: () => {
          k.box = blk[col].pop() ?? randomBox(ops.rand);
          k.boxY = fromY;
        },
      },
      { k: "lift", y0: fromY, y1: CARRIER_LIFT, dur: T_LIFT },
      { k: "drive", z: side * 58, col: BLOCK_COLS[col] },
      { k: "drive", z: exp.z, col: LANE_X },
      { k: "lift", y0: CARRIER_LIFT, y1: APRON_Y, dur: T_LIFT },
      {
        k: "act",
        fn: () => {
          exp.spot = { z: exp.z, box: k.box, kind: "export" };
          k.box = null;
        },
      },
      { k: "lift", y0: APRON_Y, y1: CARRIER_LIFT, dur: T_LIFT },
      // back off out of the crane's zone (towards my block)
      { k: "drive", z: exp.z + side * (LOCK_R + 1.5), col: LANE_X },
    ];
    return;
  }
  // 3. an export box left on a spot nobody wants any more (call ended): take it back to the yard
  const stray = ops.cranes.find(
    (c) =>
      c.spot.box && c.spot.kind === "export" && !c.wantBox && !c.locked && sideOf(c.spot.z) === side &&
      !ops.carriers.some((o) => o.job === `imp${c.id}`),
  );
  if (stray) {
    stray.spot = { ...stray.spot, kind: "import" };
    return assignCarrier(ops, k);
  }
  // 4. nothing to do: park at the block end, out of every crane's way
  if (Math.abs(k.z - side * PARK_CARRIER_Z) > 0.5) {
    k.job = "park";
    k.steps = [...exitIfInBlock(), { k: "drive", z: side * PARK_CARRIER_Z, col: LANE_X }];
  }
}

// ---------- main step ----------
export function stepPortOps(ops: PortOps, b: BerthState, dt: number) {
  ops.t += dt;
  // a new call begins when the berth enters "working" with a new phaseStartedAt
  const working = b.phase === "working";
  if (working && b.phaseStartedAt !== ops.callId) {
    ops.callId = b.phaseStartedAt;
    b.craneDone = false;
    b.discharged = 0;
    b.loaded = 0;
    for (const c of ops.cranes) {
      c.mode = "idle";
      c.discharged = 0;
      c.loaded = 0;
      c.wantBox = false;
      c.waitedForBay = 0;
    }
  }
  ops.working = working;

  const allDone = ops.cranes.every((c) => c.mode === "done" && c.steps.length === 0 && !c.box);
  for (const c of ops.cranes) {
    // booms: down while working, up otherwise (and once the call is finished)
    const wantUp = !working || (allDone && b.craneDone);
    c.boom = Math.min(1, Math.max(0, c.boom + (wantUp ? dt : -dt) / BOOM_TIME));

    if (c.steps.length === 0) {
      if (working && c.boom === 0 && c.mode !== "done") {
        const s = plan(ops, b, c);
        if (s && s.length) {
          c.steps = s;
          c.waitedForBay = 0;
        } else if (s) {
          // waiting for another crane to clear the bay; give up eventually
          c.waitedForBay += dt;
          if (c.waitedForBay > 20) c.mode = c.mode === "discharge" ? "load" : "done";
        }
      } else if (!working && c.box) {
        // ship left mid-move: put the box down on the quay so a carrier clears it
        c.steps = [{ k: "trolley", x1: () => HOME_X }, ...placeOnSpot(ops, c, "import")];
      } else if (!working && c.mode !== "idle") {
        c.mode = "idle";
        c.bay = null;
      }
    } else if (!working && c.wantBox) {
      // ship gone while waiting for an export box: stop waiting
      c.wantBox = false;
      c.steps = [];
      c.locked = false;
      c.mode = "idle";
    }
    runCrane(ops, b, c, dt);
  }

  for (const k of ops.carriers) {
    if (k.steps.length === 0) assignCarrier(ops, k);
    runCarrier(ops, k, dt);
  }

  if (working && !b.craneDone && ops.cranes.every((c) => c.mode === "done" && c.steps.length === 0 && !c.box)) {
    b.craneDone = true;
  }
}
