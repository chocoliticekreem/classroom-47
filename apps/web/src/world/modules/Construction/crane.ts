// Tower crane work cycle (pure, unit-tested). A crane picks a load up at the laydown area, hoists it
// clear, slews + trolleys over the tower, lowers it onto the top slab, releases, and goes back empty.
//
// Angle convention matches three.js rotation.y: a jib at slew angle θ points along (cos θ, -sin θ)
// in world x/z. So east (+x) is 0, north (-z) is +PI/2, south (+z) is -PI/2.
import { wrapPi } from "./geom2d";

export interface HookPoint {
  x: number;
  z: number;
  y: number; // hook height when the load sits here
}

export interface CranePlan {
  cx: number; // mast centre
  cz: number;
  pick: HookPoint;
  drop: HookPoint;
  clearY: number; // travel height of the hook between pick and drop
  hoistV: number; // m/s
  slewV: number; // rad/s
  trolleyV: number; // m/s
  attachS: number; // rigging time at the pick
  releaseS: number; // unhooking time at the drop
}

export const PHASES = ["attach", "hoist", "slewOut", "lower", "release", "rise", "slewBack", "descend"] as const;
export type Phase = (typeof PHASES)[number];

export interface CraneState {
  slew: number; // radians
  radius: number; // trolley distance from the mast
  hookY: number;
  loaded: boolean; // load hangs from the hook
  placed: boolean; // load sits on the drop spot (after release, until the hook is back at the pick)
  phase: Phase;
}

export function slewAngle(dx: number, dz: number) {
  return Math.atan2(-dz, dx);
}

/** World x/z of a point `r` metres out along a jib at angle `slew` from (cx, cz). */
export function jibPoint(cx: number, cz: number, slew: number, r: number): [number, number] {
  return [cx + Math.cos(slew) * r, cz - Math.sin(slew) * r];
}

const smooth = (u: number) => u * u * (3 - 2 * u);

export interface Derived {
  pickA: number;
  pickR: number;
  dropA: number;
  dropR: number;
  dA: number; // signed shortest slew from pick to drop
  durations: number[]; // per phase
  cycle: number;
}

export function derive(p: CranePlan): Derived {
  const pickA = slewAngle(p.pick.x - p.cx, p.pick.z - p.cz);
  const dropA = slewAngle(p.drop.x - p.cx, p.drop.z - p.cz);
  const pickR = Math.hypot(p.pick.x - p.cx, p.pick.z - p.cz);
  const dropR = Math.hypot(p.drop.x - p.cx, p.drop.z - p.cz);
  const dA = wrapPi(dropA - pickA);
  const travel = Math.max(Math.abs(dA) / p.slewV, Math.abs(dropR - pickR) / p.trolleyV, 2);
  const up1 = Math.max((p.clearY - p.pick.y) / p.hoistV, 0.5);
  const down1 = Math.max((p.clearY - p.drop.y) / p.hoistV, 0.5);
  const durations = [p.attachS, up1, travel, down1, p.releaseS, down1 * 0.8, travel * 0.85, up1 * 0.8];
  return { pickA, pickR, dropA, dropR, dA, durations, cycle: durations.reduce((s, d) => s + d, 0) };
}

/** Crane pose at time `t` seconds (any value; the cycle repeats). */
export function craneAt(p: CranePlan, d: Derived, t: number, out: CraneState): CraneState {
  let u = ((t % d.cycle) + d.cycle) % d.cycle;
  let i = 0;
  while (i < d.durations.length - 1 && u >= d.durations[i]) {
    u -= d.durations[i];
    i++;
  }
  const k = Math.min(1, u / d.durations[i]);
  const e = smooth(k);
  out.phase = PHASES[i];
  switch (out.phase) {
    case "attach":
      out.slew = d.pickA;
      out.radius = d.pickR;
      out.hookY = p.pick.y;
      break;
    case "hoist":
      out.slew = d.pickA;
      out.radius = d.pickR;
      out.hookY = p.pick.y + (p.clearY - p.pick.y) * e;
      break;
    case "slewOut":
      out.slew = d.pickA + d.dA * e;
      out.radius = d.pickR + (d.dropR - d.pickR) * e;
      out.hookY = p.clearY;
      break;
    case "lower":
      out.slew = d.pickA + d.dA;
      out.radius = d.dropR;
      out.hookY = p.clearY + (p.drop.y - p.clearY) * e;
      break;
    case "release":
      out.slew = d.pickA + d.dA;
      out.radius = d.dropR;
      out.hookY = p.drop.y;
      break;
    case "rise":
      out.slew = d.pickA + d.dA;
      out.radius = d.dropR;
      out.hookY = p.drop.y + (p.clearY - p.drop.y) * e;
      break;
    case "slewBack":
      out.slew = d.pickA + d.dA * (1 - e);
      out.radius = d.dropR + (d.pickR - d.dropR) * e;
      out.hookY = p.clearY;
      break;
    case "descend":
      out.slew = d.pickA;
      out.radius = d.pickR;
      out.hookY = p.clearY + (p.pick.y - p.clearY) * e;
      break;
  }
  out.loaded = i <= 4;
  out.placed = i >= 5;
  return out;
}

export function newCraneState(): CraneState {
  return { slew: 0, radius: 0, hookY: 0, loaded: false, placed: false, phase: "attach" };
}
