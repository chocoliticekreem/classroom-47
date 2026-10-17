// Timelines for the river: the tall ship that sails in from the sea and back out again (one passage
// every 90 s), the Tower Bridge bascules that lift for it, and the looping routes of river boats.
// Everything is a pure function of time so it's testable and costs nothing per frame.
import { BRIDGES } from "../../districts/bridges";
import { sAtX } from "./path";

export const TOWER_X = BRIDGES.find((b) => b.style === "tower")!.x;
export const COAST_X = BRIDGES.find((b) => b.style === "lift")!.x;
export const SHIP_PERIOD = 180; // in + out
export const SHIP_VMAX = 10; // m/s
export const SHIP_RAMP = 8; // s to accelerate / brake
export const SEA_X = 620;
/** Seconds into the cycle when the ship leaves its mooring (spaces the two passages ~90 s apart). */
export const DEPART = 114;
export const MOOR_X = 112;

export const S_SEA = sAtX(SEA_X);
export const S_MOOR = sAtX(MOOR_X);
export const S_TOWER = sAtX(TOWER_X);
export const S_COAST = sAtX(COAST_X);

/** Distance covered after t seconds of a trapezoid speed profile over total distance D. */
export function travel(t: number, D: number, vmax = SHIP_VMAX, ramp = SHIP_RAMP): number {
  const a = vmax / ramp;
  const T = D / vmax + ramp;
  if (t <= 0) return 0;
  if (t >= T) return D;
  if (t < ramp) return 0.5 * a * t * t;
  if (t > T - ramp) {
    const r = T - t;
    return D - 0.5 * a * r * r;
  }
  return 0.5 * a * ramp * ramp + vmax * (t - ramp);
}

/** Inverse of travel(): time at which distance d is reached. */
export function travelTime(d: number, D: number, vmax = SHIP_VMAX, ramp = SHIP_RAMP): number {
  const a = vmax / ramp;
  const T = D / vmax + ramp;
  const dr = 0.5 * a * ramp * ramp;
  if (d <= dr) return Math.sqrt((2 * d) / a);
  if (d >= D - dr) return T - Math.sqrt((2 * (D - d)) / a);
  return ramp + (d - dr) / vmax;
}

const D_SHIP = S_SEA - S_MOOR;
const passTimes = (sBridge: number) => [travelTime(S_SEA - sBridge, D_SHIP), DEPART + travelTime(sBridge - S_MOOR, D_SHIP)];
/** Seconds into the cycle when the ship's centre is under Tower Bridge, inbound and outbound. */
export const PASS_TIMES = passTimes(S_TOWER);
/** Same for the Coast Lift Bridge at the river mouth. */
export const COAST_PASS_TIMES = passTimes(S_COAST);

export interface ShipState {
  s: number; // arc length along the river path
  dir: 1 | -1; // +1 = downstream (east, out to sea)
  speed: number;
}

const mod = (t: number, p: number) => ((t % p) + p) % p;

export function shipAt(tSec: number, out: ShipState): ShipState {
  const t = mod(tSec, SHIP_PERIOD);
  if (t < DEPART) {
    const d = travel(t, D_SHIP);
    out.s = S_SEA - d;
    out.dir = -1;
    out.speed = travel(t + 0.05, D_SHIP) - d > 1e-6 ? (travel(t + 0.05, D_SHIP) - d) / 0.05 : 0;
  } else {
    const d = travel(t - DEPART, D_SHIP);
    out.s = S_MOOR + d;
    out.dir = 1;
    out.speed = (travel(t - DEPART + 0.05, D_SHIP) - d) / 0.05;
  }
  return out;
}

// Bascule choreography around each passage time (seconds relative to the ship's centre at the bridge).
export const CLOSE_AT = -24; // barriers down, road closed
export const RAISE = [-19, -10] as const; // leaves rise
export const LOWER = [10, 19] as const; // leaves come down
export const OPEN_AT = 22; // road reopens
export const MAX_LIFT_DEG = 78;

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export interface BasculeState {
  lift: number; // 0 = down, 1 = fully raised
  closed: boolean; // road closed to traffic
}

export function basculeAt(tSec: number, out: BasculeState, passes: readonly number[] = PASS_TIMES): BasculeState {
  const t = mod(tSec, SHIP_PERIOD);
  let lift = 0;
  let closed = false;
  for (const p of passes) {
    for (const wrap of [-SHIP_PERIOD, 0, SHIP_PERIOD]) {
      const r = t - (p + wrap);
      if (r < CLOSE_AT - 1 || r > OPEN_AT + 1) continue;
      if (r >= CLOSE_AT && r <= OPEN_AT) closed = true;
      lift = Math.max(lift, smooth(RAISE[0], RAISE[1], r) * (1 - smooth(LOWER[0], LOWER[1], r)));
    }
  }
  out.lift = lift;
  out.closed = closed;
  return out;
}

// ---- River boats: closed loops (out along one lane, U-turn, back along the other) ----------------

export interface LoopPose {
  s: number; // arc length along the river
  lat: number; // lateral offset, + = right of the flow (south side)
  ds: number; // heading in the (s, lat) frame
  dl: number;
}

export function loopLength(sa: number, sb: number, lane: number) {
  return 2 * (sb - sa) + 2 * Math.PI * lane;
}

/** Pose at distance u along a loop between sa and sb on lanes +-lane. Downstream on the + lane (right of flow). */
export function loopPose(u: number, sa: number, sb: number, lane: number, out: LoopPose): LoopPose {
  const run = sb - sa;
  const turn = Math.PI * lane;
  const L = 2 * run + 2 * turn;
  let v = mod(u, L);
  if (v < run) {
    out.s = sa + v;
    out.lat = lane;
    out.ds = 1;
    out.dl = 0;
    return out;
  }
  v -= run;
  if (v < turn) {
    const th = v / lane; // 0..pi
    out.s = sb + lane * Math.sin(th);
    out.lat = lane * Math.cos(th);
    out.ds = Math.cos(th);
    out.dl = -Math.sin(th);
    return out;
  }
  v -= turn;
  if (v < run) {
    out.s = sb - v;
    out.lat = -lane;
    out.ds = -1;
    out.dl = 0;
    return out;
  }
  v -= run;
  const th = v / lane;
  out.s = sa - lane * Math.sin(th);
  out.lat = -lane * Math.cos(th);
  out.ds = -Math.cos(th);
  out.dl = Math.sin(th);
  return out;
}
