// Crane + yard machine logic (pure): the rail-mounted gantry (RMG) scheduler that loads/unloads trucks and
// shuffles boxes, and the scripted timelines for the ship-to-shore cranes, straddle carriers and reach stackers.
import {
  BAY_X,
  BLOCKS,
  CONTAINER,
  CT_LANE_Z,
  RMG,
  SCRIPTED_SLOTS,
  SHIP,
  STS,
  TRAILER_BED_Y,
  Track,
  clamp01,
  mod,
  rmgLegs,
  shipBob,
  shipRowX,
  smooth,
  type StsDef,
} from "./layout";
import { MAX_TIER, type Box, type Yard } from "./yard";

const H = CONTAINER.h;

// =====================================================================================================
// RMG
// =====================================================================================================

export interface RmgPoint {
  x: number;
  z: number;
  y: number; // container bottom
}

export type RmgEndRef = { kind: "stack"; stack: number } | { kind: "truck"; truckId: string };

export interface RmgRequest {
  truckId: string;
  kind: "load" | "unload";
  x: number; // trailer centre
  z: number;
  box?: Box; // unload: the box on the trailer
}

export interface RmgJob {
  kind: "load" | "unload" | "shuffle";
  truckId: string | null;
  from: RmgPoint;
  to: RmgPoint;
  fromRef: RmgEndRef;
  toRef: RmgEndRef;
  box: Box | null; // known up front for unloads, set at pick time otherwise
  steps: number[]; // durations of the 8 steps
  t: number; // elapsed
  picked: boolean;
  dropped: boolean;
  start: { gx: number; tz: number };
}

export type RmgEvent =
  | { type: "picked"; job: RmgJob }
  | { type: "dropped"; job: RmgJob }
  | { type: "failed"; truckId: string; kind: "load" | "unload" };

export interface RmgPose {
  gx: number; // gantry position along x
  tz: number; // trolley position along z
  sy: number; // spreader bottom
  carrying: boolean;
  sway: number; // spreader swing about z (gantry motion), radians
}

const IDLE_BEFORE_SHUFFLE = 2.2;

export class RmgSim {
  readonly pose: RmgPose;
  readonly queue: RmgRequest[] = [];
  job: RmgJob | null = null;
  private idle = 0;
  private readonly events: RmgEvent[] = [];
  /** Priority work when no truck is waiting (quay transfer moves): a stack-to-stack move, or null. */
  idleHook: (() => { from: number; to: number } | null) | null = null;

  constructor(
    readonly index: number,
    readonly block: number,
    private readonly yard: Yard,
  ) {
    const [a, b] = rmgLegs(index);
    this.pose = { gx: 262 + index * 12, tz: (a + b) / 2, sy: RMG.travelY, carrying: false, sway: 0 };
  }

  request(r: RmgRequest) {
    this.queue.push(r);
  }

  /** Drop any queued work for a truck (it left or crashed). The job in flight keeps going. */
  cancel(truckId: string) {
    for (let i = this.queue.length - 1; i >= 0; i--) if (this.queue[i].truckId === truckId) this.queue.splice(i, 1);
  }

  /** Requests waiting + the one being served. */
  load() {
    return this.queue.length + (this.job?.truckId ? 1 : 0);
  }

  /** True while the job in flight takes from or puts onto this stack. */
  touches(stack: number) {
    const j = this.job;
    if (!j) return false;
    return (j.fromRef.kind === "stack" && j.fromRef.stack === stack) || (j.toRef.kind === "stack" && j.toRef.stack === stack);
  }

  busyWith(truckId: string) {
    return this.job?.truckId === truckId || this.queue.some((q) => q.truckId === truckId);
  }

  update(dt: number, rand: () => number): readonly RmgEvent[] {
    this.events.length = 0;
    if (!this.job) {
      const req = this.queue.shift();
      const hook = req ? null : this.idleHook?.() ?? null;
      if (req) this.job = this.plan(req);
      else if (hook && this.yard.height(hook.from) > 0 && this.yard.height(hook.to) < MAX_TIER) {
        const from = this.stackPoint(hook.from, this.yard.height(hook.from) - 1);
        const to = this.stackPoint(hook.to, this.yard.height(hook.to));
        this.job = this.makeJob("shuffle", null, from, to, { kind: "stack", stack: hook.from }, { kind: "stack", stack: hook.to }, null);
      } else {
        this.idle += dt;
        if (this.idle > IDLE_BEFORE_SHUFFLE) {
          this.idle = 0;
          this.job = this.planShuffle(rand);
        }
      }
      if (!this.job) {
        this.pose.sway *= Math.exp(-dt * 2);
        return this.events;
      }
      this.idle = 0;
    }
    const j = this.job;
    j.t += dt;
    evalJob(j, this.pose);
    const tPick = j.steps[0] + j.steps[1] + j.steps[2];
    const tDrop = tPick + j.steps[3] + j.steps[4] + j.steps[5] + j.steps[6];
    if (!j.picked && j.t >= tPick) {
      j.picked = true;
      if (j.fromRef.kind === "stack") j.box = this.yard.pick(j.fromRef.stack);
      this.events.push({ type: "picked", job: j });
    }
    if (!j.dropped && j.t >= tDrop) {
      j.dropped = true;
      if (j.toRef.kind === "stack" && j.box) {
        if (!this.yard.place(j.toRef.stack, j.box)) {
          // full after all (shouldn't happen): put it anywhere with room
          const alt = this.yard.placeNear(this.block, j.to.x);
          if (alt !== null) this.yard.place(alt, j.box);
        }
      }
      this.events.push({ type: "dropped", job: j });
    }
    if (j.t >= j.steps.reduce((a, b) => a + b, 0)) {
      this.job = null;
      this.pose.carrying = false;
    }
    return this.events;
  }

  private stackPoint(id: number, tier: number): RmgPoint {
    const s = this.yard.stacks[id];
    return { x: s.x, z: s.z, y: tier * H };
  }

  private plan(r: RmgRequest): RmgJob | null {
    const truck: RmgPoint = { x: r.x, z: r.z, y: TRAILER_BED_Y };
    if (r.kind === "load") {
      const st = this.yard.pickNear(this.block, r.x);
      if (st === null) {
        this.events.push({ type: "failed", truckId: r.truckId, kind: "load" });
        return null;
      }
      const from = this.stackPoint(st, this.yard.height(st) - 1);
      return this.makeJob("load", r.truckId, from, truck, { kind: "stack", stack: st }, { kind: "truck", truckId: r.truckId }, null);
    }
    const st = this.yard.placeNear(this.block, r.x);
    if (st === null) {
      this.events.push({ type: "failed", truckId: r.truckId, kind: "unload" });
      return null;
    }
    const to = this.stackPoint(st, this.yard.height(st));
    return this.makeJob("unload", r.truckId, truck, to, { kind: "truck", truckId: r.truckId }, { kind: "stack", stack: st }, r.box ?? null);
  }

  private planShuffle(rand: () => number): RmgJob | null {
    const mv = this.yard.housekeep(this.block, rand);
    if (!mv) return null;
    const from = this.stackPoint(mv.from, this.yard.height(mv.from) - 1);
    const to = this.stackPoint(mv.to, this.yard.height(mv.to));
    return this.makeJob("shuffle", null, from, to, { kind: "stack", stack: mv.from }, { kind: "stack", stack: mv.to }, null);
  }

  private makeJob(
    kind: RmgJob["kind"], truckId: string | null, from: RmgPoint, to: RmgPoint, fromRef: RmgEndRef, toRef: RmgEndRef, box: Box | null,
  ): RmgJob {
    const p = this.pose;
    const move = (ax: number, az: number, bx: number, bz: number) =>
      Math.max(Math.abs(bx - ax) / RMG.gantrySpeed, Math.abs(bz - az) / RMG.trolleySpeed) + 0.6;
    const hoist = (y: number) => Math.abs(RMG.travelY - (y + H)) / RMG.hoistSpeed + 0.3;
    const steps = [
      move(p.gx, p.tz, from.x, from.z),
      hoist(from.y),
      RMG.latch,
      hoist(from.y),
      move(from.x, from.z, to.x, to.z),
      hoist(to.y),
      RMG.latch,
      hoist(to.y),
    ];
    return { kind, truckId, from, to, fromRef, toRef, box, steps, t: 0, picked: false, dropped: false, start: { gx: p.gx, tz: p.tz } };
  }
}

/** Pose of an RMG at the job's elapsed time. */
export function evalJob(j: RmgJob, out: RmgPose) {
  let u = j.t;
  const s = j.steps;
  const top = RMG.travelY;
  const moveTo = (ax: number, az: number, bx: number, bz: number, d: number, k: number, carrying: boolean) => {
    const e = smooth(clamp01(k / d));
    out.gx = ax + (bx - ax) * e;
    out.tz = az + (bz - az) * e;
    out.sy = top;
    out.carrying = carrying;
    out.sway = Math.abs(bx - ax) > 0.5 ? Math.sin(clamp01(k / d) * Math.PI * 2) * (carrying ? 0.03 : 0.045) * Math.sign(bx - ax) : 0;
  };
  const hoist = (x: number, z: number, y0: number, y1: number, d: number, k: number, carrying: boolean) => {
    out.gx = x;
    out.tz = z;
    out.sy = y0 + (y1 - y0) * smooth(clamp01(k / d));
    out.carrying = carrying;
    out.sway *= 0.9;
  };
  const { from: f, to: t } = j;
  if (u < s[0]) return moveTo(j.start.gx, j.start.tz, f.x, f.z, s[0], u, false);
  u -= s[0];
  if (u < s[1]) return hoist(f.x, f.z, top, f.y + H, s[1], u, false);
  u -= s[1];
  if (u < s[2]) return hoist(f.x, f.z, f.y + H, f.y + H, s[2], u, false);
  u -= s[2];
  if (u < s[3]) return hoist(f.x, f.z, f.y + H, top, s[3], u, true);
  u -= s[3];
  if (u < s[4]) return moveTo(f.x, f.z, t.x, t.z, s[4], u, true);
  u -= s[4];
  if (u < s[5]) return hoist(t.x, t.z, top, t.y + H, s[5], u, true);
  u -= s[5];
  if (u < s[6]) return hoist(t.x, t.z, t.y + H, t.y + H, s[6], u, false);
  u -= s[6];
  return hoist(t.x, t.z, t.y + H, top, s[7], u, false);
}

// =====================================================================================================
// STS crane + straddle carrier pairs (scripted, period STS_PERIOD)
// =====================================================================================================

export const STS_PERIOD = 124;
const T_TRAVEL = 4.2;
const T_LOWER = 3.4;
const T_LATCH = 0.9;
const MOVE_DUR = T_TRAVEL * 3 + T_LOWER * 4 + T_LATCH * 2; // 28.0 s

export interface HoistState {
  trolleyX: number;
  spreaderY: number;
  carrying: boolean;
  boxX: number;
  boxY: number;
}

/** One pick-and-place by an STS trolley: home -> from, lift, -> to, lower, -> home. u in seconds. */
export function stsMove(u: number, home: number, fx: number, fy: number, tx: number, ty: number, top: number, o: HoistState) {
  const steps: [number, number, number, number, number, boolean, boolean][] = [
    [T_TRAVEL, home, fx, top, top, false, false],
    [T_LOWER, fx, fx, top, fy + H, false, false],
    [T_LATCH, fx, fx, fy + H, fy + H, false, false],
    [T_LOWER, fx, fx, fy + H, top, true, false],
    [T_TRAVEL, fx, tx, top, top, true, false],
    [T_LOWER, tx, tx, top, ty + H, true, false],
    [T_LATCH, tx, tx, ty + H, ty + H, false, true],
    [T_LOWER, tx, tx, ty + H, top, false, true],
    [T_TRAVEL, tx, home, top, top, false, true],
  ];
  for (const [d, x0, x1, y0, y1, carrying, atTo] of steps) {
    if (u < d) {
      const k = smooth(clamp01(u / d));
      o.trolleyX = x0 + (x1 - x0) * k;
      o.spreaderY = y0 + (y1 - y0) * k;
      o.carrying = carrying;
      o.boxX = carrying ? o.trolleyX : atTo ? tx : fx;
      o.boxY = carrying ? o.spreaderY - H : atTo ? ty : fy;
      return o;
    }
    u -= d;
  }
  o.trolleyX = home;
  o.spreaderY = top;
  o.carrying = false;
  o.boxX = tx;
  o.boxY = ty;
  return o;
}

export interface PairState {
  sts: HoistState; // the active hoist (trolley/spreader)
  boxA: { x: number; y: number; z: number; h: number }; // the box that goes ship -> yard -> ship
  boxB: { x: number; y: number; z: number; h: number }; // the restow box (ship -> ship)
  straddle: { x: number; z: number; h: number; lift: number }; // lift = spreader (box bottom) height
}

export function newPairState(): PairState {
  return {
    sts: { trolleyX: 0, spreaderY: 0, carrying: false, boxX: 0, boxY: 0 },
    boxA: { x: 0, y: 0, z: 0, h: 0 },
    boxB: { x: 0, y: 0, z: 0, h: 0 },
    straddle: { x: 0, z: 0, h: 0, lift: 0 },
  };
}

const STRADDLE_LIFT = 3.4;
const STRADDLE_SPEED = 5.2;
const STS_HOME = 332;

/** The straddle carrier's track for a crane: wait point (north of the pad) -> pad -> yard slot. */
export function straddleTrack(def: StsDef, which: "straddleA" | "straddleB") {
  const slot = SCRIPTED_SLOTS[which];
  const sx = BAY_X[slot.bay];
  const sz = BLOCKS[slot.block].rowsZ[slot.row];
  const pad = STS.padX;
  return new Track([
    [pad, def.z - 22],
    [pad, def.z - 6],
    [pad, def.z],
    [pad, def.z + 10],
    [319, def.z + 20],
    [319, sz - 12],
    [316, sz - 3],
    [308, sz],
    [sx + 6, sz],
    [sx, sz],
  ]);
}

export function slotPoint(which: "straddleA" | "straddleB") {
  const slot = SCRIPTED_SLOTS[which];
  return { x: BAY_X[slot.bay], z: BLOCKS[slot.block].rowsZ[slot.row], y: slot.base * H };
}

/** Arc length on the straddle track where it sits over the pad. */
function padS(tr: Track) {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < tr.cum.length; i++) {
    const d = Math.abs(tr.zs[i] - (tr.zs[0] + 22)) + Math.abs(tr.xs[i] - STS.padX);
    if (d < bd) {
      bd = d;
      best = tr.cum[i];
    }
  }
  return best;
}

const _pose = { x: 0, z: 0, h: 0 };

/**
 * STS + straddle carrier cycle. Times (s): 0 unload A ship->pad, 28 restow B, 22 straddle drives in and lifts A,
 * carries it to the yard slot, dwells, brings it back to the pad by ~96, backs out; 96 STS loads A pad->ship.
 */
export function pairAt(tSec: number, def: StsDef, track: Track, slot: { x: number; z: number; y: number }, o: PairState) {
  const t = mod(tSec + def.offset, STS_PERIOD);
  const cycle = Math.floor((tSec + def.offset) / STS_PERIOD);
  const bob = shipBob(tSec);
  const shipA = { x: shipRowX(STS.slotRow), y: SHIP.deckY + def.shipStack * H + bob };
  const rowB = cycle % 2 === 0 ? 1 : 7;
  const rowC = cycle % 2 === 0 ? 7 : 1;
  const shipB = { x: shipRowX(rowB), y: SHIP.deckY + 2 * H + bob };
  const shipC = { x: shipRowX(rowC), y: SHIP.deckY + 2 * H + bob };
  const pad = { x: STS.padX, y: 0.03 };
  const top = STS.upY;
  const s = o.sts;

  // ---- STS hoist
  // box B rests at shipB until the restow, then at shipC
  o.boxB.z = def.z;
  o.boxB.h = 0;
  if (t < MOVE_DUR) {
    stsMove(t, STS_HOME, shipA.x, shipA.y, pad.x, pad.y, top, s);
    o.boxB.x = shipB.x;
    o.boxB.y = shipB.y;
  } else if (t < MOVE_DUR * 2) {
    stsMove(t - MOVE_DUR, STS_HOME, shipB.x, shipB.y, shipC.x, shipC.y, top, s);
    o.boxB.x = s.boxX;
    o.boxB.y = s.boxY;
  } else if (t >= 96) {
    stsMove(t - 96, STS_HOME, pad.x, pad.y, shipA.x, shipA.y, top, s);
    o.boxB.x = shipC.x;
    o.boxB.y = shipC.y;
  } else {
    s.trolleyX = STS_HOME;
    s.spreaderY = top;
    s.carrying = false;
    o.boxB.x = shipC.x;
    o.boxB.y = shipC.y;
  }

  // ---- straddle (drives forward to the slot and reverses back, so it never spins on the spot)
  const L = track.length;
  const sPad = padS(track);
  const st = o.straddle;
  const drive = (t0: number, s0: number, s1: number) => {
    const d = Math.abs(s1 - s0) / STRADDLE_SPEED;
    return s0 + (s1 - s0) * smooth(clamp01((t - t0) / d));
  };
  const dPadSlot = (L - sPad) / STRADDLE_SPEED;
  const tIn = 22;
  const tAtPad = tIn + sPad / STRADDLE_SPEED;
  const tLifted = tAtPad + 3;
  const tAtSlot = tLifted + dPadSlot;
  const tDropped = tAtSlot + 2.6;
  const tPick2 = tDropped + 7;
  const tLifted2 = tPick2 + 2.6;
  const tBack = tLifted2 + dPadSlot;
  const tDown = tBack + 2.6;
  let sArc = 0;
  let lift = STRADDLE_LIFT;
  let carrying = false;
  let inSlot = false;
  if (t < tIn) sArc = 0;
  else if (t < tAtPad) sArc = drive(tIn, 0, sPad);
  else if (t < tLifted) {
    sArc = sPad;
    const k = clamp01((t - tAtPad) / 3);
    // lower (first half) then lift with the box (second half)
    lift = k < 0.5 ? STRADDLE_LIFT + (pad.y - STRADDLE_LIFT) * smooth(k * 2) : pad.y + (STRADDLE_LIFT - pad.y) * smooth(k * 2 - 1);
    carrying = k >= 0.5;
  } else if (t < tAtSlot) {
    sArc = drive(tLifted, sPad, L);
    carrying = true;
  } else if (t < tDropped) {
    sArc = L;
    const k = clamp01((t - tAtSlot) / 2.6);
    lift = STRADDLE_LIFT + (slot.y - STRADDLE_LIFT) * smooth(k);
    carrying = k < 1;
  } else if (t < tPick2) {
    sArc = L;
    inSlot = true;
    lift = Math.min(STRADDLE_LIFT, slot.y + H + 0.6);
  } else if (t < tLifted2) {
    sArc = L;
    const k = clamp01((t - tPick2) / 2.6);
    lift = slot.y + (STRADDLE_LIFT - slot.y) * smooth(k);
    carrying = true;
  } else if (t < tBack) {
    sArc = drive(tLifted2, L, sPad);
    carrying = true;
  } else if (t < tDown) {
    sArc = sPad;
    const k = clamp01((t - tBack) / 2.6);
    lift = STRADDLE_LIFT + (pad.y - STRADDLE_LIFT) * smooth(k);
    carrying = k < 1;
  } else sArc = drive(tDown, sPad, 0);
  if (t >= tDropped && t < tPick2) inSlot = true;
  track.at(sArc, _pose);
  st.x = _pose.x;
  st.z = _pose.z;
  st.h = _pose.h;
  st.lift = carrying ? lift : Math.max(lift, slot.y + H + 0.6);
  if (!carrying && t >= tAtPad && t < tLifted) st.lift = lift;
  if (!carrying && t >= tAtSlot && t < tDropped) st.lift = lift;
  if (!carrying && t >= tBack && t < tDown) st.lift = lift;

  const A = o.boxA;
  if (carrying) {
    A.x = st.x;
    A.z = st.z;
    A.y = lift;
    A.h = st.h;
  } else if (inSlot) {
    A.x = slot.x;
    A.z = slot.z;
    A.y = slot.y;
    A.h = Math.PI / 2;
  } else if (t < MOVE_DUR || t >= 96) {
    if (t < MOVE_DUR) stsMove(t, STS_HOME, shipA.x, shipA.y, pad.x, pad.y, top, _hs);
    else stsMove(t - 96, STS_HOME, pad.x, pad.y, shipA.x, shipA.y, top, _hs);
    A.x = _hs.boxX;
    A.y = _hs.boxY;
    A.z = def.z;
    A.h = 0;
  } else {
    A.x = pad.x;
    A.z = def.z;
    A.y = pad.y;
    A.h = 0;
  }
  return o;
}

const _hs: HoistState = { trolleyX: 0, spreaderY: 0, carrying: false, boxX: 0, boxY: 0 };

// =====================================================================================================
// Reach stackers (scripted shuffles between two stacks facing a yard lane)
// =====================================================================================================

export const REACH_PERIOD = 46;
export interface ReachDef {
  laneZ: number; // body centre line while working
  face: 1 | -1; // +1: block is south (+z) of the lane
  xs: [number, number];
  baseH: [number, number]; // static stack heights under the moving box
  rowZ: number;
  offset: number;
}
export function reachDefs(): ReachDef[] {
  const a = SCRIPTED_SLOTS.reachA;
  const b = SCRIPTED_SLOTS.reachB;
  return [
    { laneZ: CT_LANE_Z[3] + 0.5, face: 1, xs: [BAY_X[a.bays[0]], BAY_X[a.bays[1]]], baseH: [a.base[0], a.base[1]], rowZ: BLOCKS[a.block].rowsZ[a.row], offset: 0 },
    { laneZ: CT_LANE_Z[4] - 0.5, face: -1, xs: [BAY_X[b.bays[0]], BAY_X[b.bays[1]]], baseH: [b.base[0], b.base[1]], rowZ: BLOCKS[b.block].rowsZ[b.row], offset: 17 },
  ];
}

export interface ReachState {
  x: number;
  z: number;
  h: number;
  boomAngle: number; // radians above horizontal
  boomLen: number; // pivot -> tip
  boxX: number;
  boxY: number;
  boxZ: number;
  boxH: number;
  carrying: boolean;
}
export function newReachState(): ReachState {
  return { x: 0, z: 0, h: 0, boomAngle: 0, boomLen: 0, boxX: 0, boxY: 0, boxZ: 0, boxH: Math.PI / 2, carrying: false };
}

/** Reach stacker geometry: boom pivot height and its offset behind the body centre. */
export const REACH = { pivotY: 3.1, pivotBack: 2.4, bodyToFace: 5.8 };

export function reachAt(tSec: number, d: ReachDef, o: ReachState) {
  const t = mod(tSec + d.offset, REACH_PERIOD);
  const half = REACH_PERIOD / 2;
  const forward = t < half;
  const u = forward ? t : t - half;
  const [i0, i1] = forward ? [0, 1] : [1, 0];
  const x0 = d.xs[i0];
  const x1 = d.xs[i1];
  const y0 = d.baseH[i0] * H; // box bottom when resting on stack i0
  const y1 = d.baseH[i1] * H;
  const faceH = d.face > 0 ? 0 : Math.PI;
  const workZ = d.laneZ; // body centre while working
  const backZ = d.laneZ - d.face * 3.5;
  const dirX = Math.sign(x1 - x0) || 1;
  const travelH = dirX > 0 ? Math.PI / 2 : -Math.PI / 2;
  // body pose
  let x = x0;
  let z = workZ;
  let h = faceH;
  let carry = false;
  let boxY = y0;
  let reachZ = d.rowZ; // where the spreader is (z)
  const lerp = (a: number, b: number, k: number) => a + (b - a) * smooth(clamp01(k));
  const lowY = (y: number) => y + H; // spreader bottom on the box top
  let sprY = lowY(y0) + 1.5;
  if (u < 3) {
    sprY = lerp(lowY(y0) + 2, lowY(y0), u / 3);
  } else if (u < 4) {
    sprY = lowY(y0);
  } else if (u < 6) {
    carry = true;
    sprY = lerp(lowY(y0), lowY(y0) + 1.2, (u - 4) / 2);
  } else if (u < 8) {
    carry = true;
    z = lerp(workZ, backZ, (u - 6) / 2);
    sprY = lowY(y0) + 1.2;
  } else if (u < 9.5) {
    carry = true;
    z = backZ;
    h = lerpAngle(faceH, travelH, (u - 8) / 1.5);
    sprY = lowY(y0) + 1.2;
  } else if (u < 14) {
    carry = true;
    z = backZ;
    h = travelH;
    x = lerp(x0, x1, (u - 9.5) / 4.5);
    sprY = lerp(lowY(y0) + 1.2, lowY(y1) + 1.2, (u - 9.5) / 4.5);
  } else if (u < 15.5) {
    carry = true;
    x = x1;
    z = backZ;
    h = lerpAngle(travelH, faceH, (u - 14) / 1.5);
    sprY = lowY(y1) + 1.2;
  } else if (u < 17.5) {
    carry = true;
    x = x1;
    z = lerp(backZ, workZ, (u - 15.5) / 2);
    sprY = lowY(y1) + 1.2;
  } else if (u < 19.5) {
    carry = true;
    x = x1;
    sprY = lerp(lowY(y1) + 1.2, lowY(y1), (u - 17.5) / 2);
  } else if (u < 20.5) {
    x = x1;
    sprY = lowY(y1);
    boxY = y1;
  } else {
    x = x1;
    sprY = lerp(lowY(y1), lowY(y1) + 2, (u - 20.5) / 1.5);
    boxY = y1;
  }
  if (u >= 20.5) boxY = y1;
  // spreader position in world: in front of the body along its heading
  const fx = Math.sin(h);
  const fz = Math.cos(h);
  const reachDist = h === faceH ? Math.abs(reachZ - z) : REACH.bodyToFace + 0.6;
  const sx = x + fx * reachDist;
  const sz = z + fz * reachDist;
  reachZ = sz;
  // boom from the pivot (behind the body centre) to the spreader top
  const px = x - fx * REACH.pivotBack;
  const pz = z - fz * REACH.pivotBack;
  const horiz = Math.hypot(sx - px, sz - pz);
  const vert = sprY + 0.9 - REACH.pivotY;
  o.x = x;
  o.z = z;
  o.h = h;
  o.boomAngle = Math.atan2(vert, horiz);
  o.boomLen = Math.hypot(horiz, vert);
  o.carrying = carry;
  if (carry) {
    o.boxX = sx;
    o.boxZ = reachZ;
    o.boxY = sprY - H;
    o.boxH = h + Math.PI / 2;
  } else {
    const restX = u >= 20.5 || (u >= 19.5 && !carry) ? x1 : x0;
    o.boxX = restX;
    o.boxZ = d.rowZ;
    o.boxY = boxY;
    o.boxH = Math.PI / 2;
  }
  return o;
}

function lerpAngle(a: number, b: number, k: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * smooth(clamp01(k));
}

export { MAX_TIER };
