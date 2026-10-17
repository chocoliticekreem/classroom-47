// Roadworks truck speed control: queue behind the lane leader, brake for anything the look-ahead ray
// hits, give way at the line to a vehicle sitting in the junction, and ease the speed towards the target.
// Pure (no React); Roadworks.tsx calls these from its per-frame drive().
import { stopSpeed, type Lookahead } from "../DeliveryFleet/lookahead";

export const RW_HALF_LEN = 3.4; // centre to front bumper
export const RW_HALF_W = 1.25;
export const RW_BRAKE = 4; // braking the look-ahead plans with (the truck can brake far harder)
export const RW_STOP_LINE = 6; // metres before a junction node where we wait to give way
export const RW_JUNCTION_R = 10; // a vehicle this close to the node counts as "in the junction"
const ACCEL = 6;
const BRAKE = 14;

/** Lane queue: stop within 8 m of the leader, close in on it between 8 and 18 m. */
export function queueWant(want: number, gap: number, leaderSpeed: number) {
  if (gap < 8) return 0;
  if (gap < 18) return Math.min(want, leaderSpeed + (gap - 8) * 0.5);
  return want;
}

/**
 * Look-ahead cap: slow so we can stop short of whatever the ray hit; if it's in the junction ahead
 * (`node`), wait at the line `toLine` metres away instead. The more cautious of this and `want` wins.
 */
export function lookWant(want: number, look: Lookahead, toLine: number, node: { x: number; z: number } | null) {
  if (!look.hitId) return want;
  let room = look.room;
  if (node && toLine > 0 && toLine < room && look.hitInJunction(node.x, node.z, RW_JUNCTION_R)) room = toLine;
  return Math.min(want, stopSpeed(room, RW_BRAKE));
}

/** Ease the speed towards `want` (gentle on the throttle, firm on the brakes). */
export function approachSpeed(speed: number, want: number, dt: number) {
  const a = want > speed ? ACCEL : BRAKE;
  return speed + Math.max(-a * dt, Math.min(a * dt, want - speed));
}
