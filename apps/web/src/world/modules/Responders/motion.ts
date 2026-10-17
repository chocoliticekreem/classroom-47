// Pure route following: move a cursor along a Route by a distance in metres.
import { stopSpeed, vehicleNear, type Lookahead } from "../DeliveryFleet/lookahead";
import type { Route, UnitRole } from "./dispatch";

export interface Cursor {
  seg: number; // leg index: nodes[seg] -> nodes[seg + 1]
  t: number; // 0..1 along that leg
}

export interface StepResult {
  arrived: boolean;
  /** Node index where the unit had to stop because the next leg can't be entered (re-plan from there). */
  blockedAt: number | null;
}

type LenFn = (a: string, b: string) => number;

/** Mutates `cur`. `canEnter(a, b)` is asked before each new leg after the first. */
export function advance(
  route: Route,
  cur: Cursor,
  metres: number,
  edgeLength: LenFn,
  canEnter: (a: string, b: string) => boolean,
): StepResult {
  const last = route.nodes.length - 2;
  if (last < 0) return { arrived: true, blockedAt: null };
  let left = metres;
  for (let guard = 0; guard < 64; guard++) {
    const a = route.nodes[cur.seg];
    const b = route.nodes[cur.seg + 1];
    const len = Math.max(0.01, edgeLength(a, b));
    const endT = cur.seg === last ? route.stopT : 1;
    const remain = endT - cur.t;
    const dT = left / len;
    if (dT < remain) {
      cur.t += dT;
      return { arrived: false, blockedAt: null };
    }
    left -= Math.max(0, remain) * len;
    cur.t = endT;
    if (cur.seg >= last) return { arrived: true, blockedAt: null };
    if (!canEnter(route.nodes[cur.seg + 1], route.nodes[cur.seg + 2])) return { arrived: false, blockedAt: cur.seg + 1 };
    cur.seg += 1;
    cur.t = 0;
    if (left <= 0) return { arrived: false, blockedAt: null };
  }
  return { arrived: false, blockedAt: null };
}

/** Metres left to the stop point. */
export function remainingMetres(route: Route, cur: Cursor, edgeLength: LenFn) {
  const last = route.nodes.length - 2;
  if (last < 0) return 0;
  let m = 0;
  for (let s = cur.seg; s <= last; s++) {
    const len = edgeLength(route.nodes[s], route.nodes[s + 1]);
    const from = s === cur.seg ? cur.t : 0;
    const to = s === last ? route.stopT : 1;
    m += Math.max(0, to - from) * len;
  }
  return m;
}

// --- look-ahead braking ---------------------------------------------------------------------------

/** Body size per unit (centre to front bumper, half-width) for the look-ahead ray and corridor. */
export const UNIT_SIZE: Record<UnitRole, { halfLength: number; halfWidth: number }> = {
  police: { halfLength: 2.3, halfWidth: 0.95 },
  ambulance: { halfLength: 2.9, halfWidth: 1.1 },
  fire: { halfLength: 4.2, halfWidth: 1.3 },
  tow: { halfLength: 3.6, halfWidth: 1.25 },
};
/** Blues on: look only half as far past the stopping distance (they press on; everyone else yields). */
export const BLUES_BUFFER = 2.5;
/** Braking the look-ahead plans with (the units brake at up to 14 m/s²). */
export const UNIT_BRAKE = 6;
/** Hits on vehicles this close to the unit's own incident are the scene itself (the wreck, other units). */
export const SCENE_R = 30;
export const JUNCTION_R = 10;

export interface LookContext {
  /** Incident position: hits on vehicles near it are expected (we're driving up to them), not obstacles. */
  scene: { x: number; z: number } | null;
  /** Give way at the line (`toLine` metres away) to a vehicle sitting in the junction at (x, z); null with blues on. */
  junction: { x: number; z: number; toLine: number } | null;
}

/** Speed target after the look-ahead raycast: the more cautious of `target` and stopping short of the hit. */
export function lookTarget(target: number, look: Lookahead, ctx: LookContext): number {
  if (!look.hitId) return target;
  if (ctx.scene && vehicleNear(look.hitId, ctx.scene.x, ctx.scene.z, SCENE_R)) return target;
  let room = look.room;
  const j = ctx.junction;
  if (j && j.toLine > 0 && j.toLine < room && look.hitInJunction(j.x, j.z, JUNCTION_R)) room = j.toLine;
  return Math.min(target, stopSpeed(room, UNIT_BRAKE));
}

/** Ease towards the target speed: +6 m/s² on the throttle, up to -14 m/s² on the brakes. */
export function approachSpeed(speed: number, target: number, dt: number) {
  return speed + Math.max(-14 * dt, Math.min(6 * dt, target - speed));
}
