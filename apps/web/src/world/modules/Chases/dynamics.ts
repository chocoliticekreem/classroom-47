// Pure physics and planning for pursuits: getaway route prediction, PIT contact geometry and outcome,
// a tiny rigid-body integrator (velocity, yaw rate, friction), 1-D collision momentum transfer,
// and roadblock placement. No three.js: unit-tested.
import { getEdge, getNode, neighbours } from "../../roads";

// --- Prediction ----------------------------------------------------------------------------------

/**
 * The node the getaway will reach after `seconds` at `speed` along its planned path (the first node at
 * or beyond that distance). Falls back to the last planned node. Used to cut it off rather than chase its tail.
 */
export function predictNode(path: readonly string[], idx: number, t: number, speed: number, seconds: number): string {
  const want = Math.max(0, speed * seconds);
  let d = (1 - t) * (getEdge(path[idx], path[idx + 1])?.length ?? 0);
  let k = idx + 1;
  while (d < want && k + 1 < path.length) {
    d += getEdge(path[k], path[k + 1])?.length ?? 0;
    k += 1;
  }
  return path[Math.min(k, path.length - 1)];
}

/** How far ahead (seconds) a unit should aim: about the time it needs to get there, within limits. */
export function interceptHorizon(distance: number, policeSpeed: number) {
  return Math.min(8, Math.max(1.5, distance / Math.max(policeSpeed, 5)));
}

// --- Rigid body ----------------------------------------------------------------------------------

export interface Body {
  x: number;
  z: number;
  h: number; // heading (0 = +z)
  vx: number; // world velocity m/s
  vz: number;
  w: number; // yaw rate rad/s
}

export const FRICTION = {
  slide: 7.5, // m/s² linear deceleration of a sliding car (tyres scrubbing)
  yawDamp: 1.5, // 1/s exponential yaw-rate decay
  yawDry: 0.8, // rad/s² constant yaw friction (so spins actually stop)
};

/** Integrate one step of a sliding/spinning car. Returns true once it has come to rest. */
export function stepBody(b: Body, dt: number): boolean {
  b.x += b.vx * dt;
  b.z += b.vz * dt;
  b.h += b.w * dt;
  const sp = Math.hypot(b.vx, b.vz);
  if (sp > 0) {
    const k = Math.max(0, sp - FRICTION.slide * dt) / sp;
    b.vx *= k;
    b.vz *= k;
  }
  b.w *= Math.exp(-FRICTION.yawDamp * dt);
  b.w = Math.sign(b.w) * Math.max(0, Math.abs(b.w) - FRICTION.yawDry * dt);
  return Math.hypot(b.vx, b.vz) < 0.25 && Math.abs(b.w) < 0.12;
}

// --- PIT manoeuvre --------------------------------------------------------------------------------

export interface CarState {
  x: number;
  z: number;
  h: number;
  speed: number;
}

export interface PitContact {
  along: number; // police position along the getaway's heading, relative to its centre (negative = behind)
  side: number; // signed lateral offset (positive = to the getaway's right)
  dist: number;
  angle: number; // heading difference, radians
  rel: number; // closing speed: police minus getaway
  alongside: boolean; // in the PIT window: nose at the getaway's rear quarter, close, same direction
}

export const PIT = { maxDist: 6, alongMin: -4.6, alongMax: 0.6, sideMin: 0.8, sideMax: 3.2, maxAngle: 0.45 };

export function pitContact(g: CarState, p: CarState): PitContact {
  const fx = Math.sin(g.h);
  const fz = Math.cos(g.h);
  const dx = p.x - g.x;
  const dz = p.z - g.z;
  const along = dx * fx + dz * fz;
  const side = dx * -fz + dz * fx; // projection on the right-hand vector (-fz, fx): positive = right
  const dist = Math.hypot(dx, dz);
  const angle = Math.abs(Math.atan2(Math.sin(p.h - g.h), Math.cos(p.h - g.h)));
  const rel = p.speed - g.speed;
  const alongside =
    dist <= PIT.maxDist && along >= PIT.alongMin && along <= PIT.alongMax &&
    Math.abs(side) >= PIT.sideMin && Math.abs(side) <= PIT.sideMax && angle <= PIT.maxAngle;
  return { along, side, dist, angle, rel, alongside };
}

/** Chance a PIT attempt works: better when matched speed / slightly faster and well aligned. */
export function pitChance(c: PitContact): number {
  if (!c.alongside) return 0;
  const speedTerm = c.rel < -2 ? 0.15 : c.rel > 6 ? 0.4 : 0.75 - Math.abs(c.rel - 1.5) * 0.08;
  const angleTerm = 1 - c.angle / PIT.maxAngle;
  return Math.max(0.05, Math.min(0.95, speedTerm * (0.55 + 0.45 * angleTerm)));
}

/**
 * The getaway's body right after a successful PIT: it keeps its momentum, gets pushed away from the
 * police side, and spins the other way round (the rear is shoved sideways).
 */
export function pitImpulse(g: CarState, c: PitContact): Body {
  const fx = Math.sin(g.h);
  const fz = Math.cos(g.h);
  const away = c.side > 0 ? -1 : 1; // pushed towards the side away from the police car
  const rx = -fz; // getaway's right-hand vector
  const rz = fx;
  const push = 2 + Math.max(0, c.rel) * 0.4;
  // rear shoved towards `away`: the nose swings towards the police side (a positive yaw rate turns left)
  const w = away * Math.min(5, 2.2 + Math.max(0, c.rel) * 0.25 + g.speed * 0.07);
  return { x: g.x, z: g.z, h: g.h, vx: fx * g.speed + rx * away * push, vz: fz * g.speed + rz * away * push, w };
}

// --- Collisions -------------------------------------------------------------------------------

export const MASS: Record<string, number> = {
  car: 1400, taxi: 1500, van: 2400, police: 1600, ambulance: 3500, tow: 6000, fire: 12000, roadworks: 7000, truck: 14000, bus: 12000,
};

/**
 * 1-D partially elastic collision along the striker's heading: masses m1/m2, speeds v1/v2 (m/s, same axis).
 * Returns the speeds after impact. restitution 0 = they move together, 1 = bounce.
 */
export function collide(m1: number, v1: number, m2: number, v2: number, restitution = 0.2): [number, number] {
  const p = m1 * v1 + m2 * v2;
  const v1n = (p + m2 * restitution * (v2 - v1)) / (m1 + m2);
  const v2n = (p + m1 * restitution * (v1 - v2)) / (m1 + m2);
  return [v1n, v2n];
}

/** Can the striker still stop (or slow to the obstacle's speed) before reaching it, braking at `decel`? */
export function canStop(speed: number, obstacleSpeed: number, dist: number, decel = 11): boolean {
  const rel = speed - obstacleSpeed;
  if (rel <= 0) return true;
  return (rel * rel) / (2 * decel) <= Math.max(0, dist);
}

// --- Roadblock --------------------------------------------------------------------------------

export interface Roadblock {
  node: string; // the junction
  from: string; // getaway's approach node
  exit: string; // the road it planned to take (blocked)
  slots: { x: number; z: number; h: number }[]; // two police cars parked across the exit
}

/**
 * A junction on the getaway's planned route between minM and maxM ahead (one with a real choice of
 * roads, so the getaway can swerve away), with two police cars parked across the exit it planned to take.
 */
export function roadblockSite(path: readonly string[], idx: number, t: number, minM = 90, maxM = 260): Roadblock | null {
  let d = (1 - t) * (getEdge(path[idx], path[idx + 1])?.length ?? 0);
  for (let k = idx + 1; k + 1 < path.length && d <= maxM; k++) {
    const node = path[k];
    if (d >= minM && neighbours(node).length >= 3) {
      const exit = path[k + 1];
      const n = getNode(node);
      const e = getNode(exit);
      const len = Math.hypot(e.x - n.x, e.z - n.z) || 1;
      if (len < 16) return null;
      const dx = (e.x - n.x) / len;
      const dz = (e.z - n.z) / len;
      const cx = n.x + dx * 8;
      const cz = n.z + dz * 8;
      const across = Math.atan2(-dz, dx); // perpendicular to the road
      const rx = -dz;
      const rz = dx;
      return {
        node, from: path[k - 1], exit,
        slots: [
          { x: cx + rx * 2.1 - dx * 0.8, z: cz + rz * 2.1 - dz * 0.8, h: across + 0.35 },
          { x: cx - rx * 2.1 + dx * 0.8, z: cz - rz * 2.1 + dz * 0.8, h: across + Math.PI - 0.35 },
        ],
      };
    }
    d += getEdge(path[k], path[k + 1])?.length ?? 0;
  }
  return null;
}
