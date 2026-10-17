// Shipping: tug + pilot boat choreography. A tug's "slot" is a pose relative to the ship it is working
// (towing ahead, trailing astern, standing by / pushing / pulling on the seaward side). Boats steer towards
// their slot with simple kinematics (turn-rate + speed limits) and lock on once they are there.
import { lerpAngle, wrapAngle } from "./lanes";

export type TugStage = "escort" | "standby" | "standoff" | "push" | "pull" | "home";

export interface ShipPose {
  x: number;
  z: number;
  heading: number;
  half: number; // half length
  beam: number;
}

export interface Slot {
  x: number;
  z: number;
  heading: number;
  /** Towline from the tug's stern to a ship point (ship-local x,z), or null. */
  line: [number, number] | null;
  /** 0..1 how hard the tug is working (prop wash + smoke). */
  effort: number;
}

export const TUG_HALF = 14; // half length of a tug (m)

/** Ship-local (lx, lz) to world, three.js rotation.y convention (bow = local +z). */
export function toWorld(p: ShipPose, lx: number, lz: number, out: { x: number; z: number }) {
  const c = Math.cos(p.heading), s = Math.sin(p.heading);
  out.x = p.x + lx * c + lz * s;
  out.z = p.z - lx * s + lz * c;
  return out;
}

const _w = { x: 0, z: 0 };

/**
 * The slot for tug `role` (0 = forward tug, 1 = aft tug) at a stage. `seaSide` is the ship-local x sign of the
 * seaward side (for a ship moored bow-north against a quay to the west, seaward = world +x = local -x, so -1).
 */
export function tugSlot(role: 0 | 1, stage: TugStage, ship: ShipPose, seaSide: number, out: Slot): Slot {
  const along = (role === 0 ? 1 : -1) * ship.half * 0.55;
  out.line = null;
  out.effort = 0.25;
  switch (stage) {
    case "escort": {
      // forward tug tows ahead on a long line; aft tug trails on a short line as a brake/steering tug
      const lz = role === 0 ? ship.half + TUG_HALF + 38 : -(ship.half + TUG_HALF + 22);
      toWorld(ship, 0, lz, _w);
      out.x = _w.x;
      out.z = _w.z;
      out.heading = ship.heading;
      out.line = role === 0 ? [0, ship.half - 3] : [0, -ship.half + 2];
      out.effort = role === 0 ? 0.7 : 0.35;
      break;
    }
    case "standby":
    case "push": {
      const gap = stage === "push" ? 0.6 : 9;
      toWorld(ship, seaSide * (ship.beam / 2 + gap + TUG_HALF), along, _w);
      out.x = _w.x;
      out.z = _w.z;
      // bow pointing at the hull: local direction (-seaSide, 0)
      out.heading = wrapAngle(ship.heading + (seaSide > 0 ? -Math.PI / 2 : Math.PI / 2));
      out.effort = stage === "push" ? 1 : 0.3;
      break;
    }
    case "standoff":
    case "pull": {
      toWorld(ship, seaSide * (ship.beam / 2 + 32 + TUG_HALF), along, _w);
      out.x = _w.x;
      out.z = _w.z;
      // bow pointing away from the hull
      out.heading = wrapAngle(ship.heading + (seaSide > 0 ? Math.PI / 2 : -Math.PI / 2));
      out.line = stage === "pull" ? [seaSide * (ship.beam / 2 - 0.5), along] : null;
      out.effort = stage === "pull" ? 1 : 0.15;
      break;
    }
    case "home":
      out.effort = 0.1;
      break;
  }
  return out;
}

export interface Boat {
  x: number;
  z: number;
  heading: number;
  speed: number;
  /** Locked onto its slot (follows it rigidly). */
  locked: boolean;
}

/**
 * Steer a boat towards a target pose. Far away it sails bow-first along its heading (turn-rate limited, speed
 * limited, brakes on arrival); close in it crabs onto the slot and takes the slot's heading; once there it locks.
 */
export function steer(b: Boat, tx: number, tz: number, th: number, dt: number, tvx = 0, tvz = 0, vmax = 12, turn = 0.7) {
  const dx = tx - b.x, dz = tz - b.z;
  const d = Math.hypot(dx, dz);
  if (b.locked) {
    if (d > 6) b.locked = false;
    else {
      const k = Math.min(1, dt * 6);
      const px = b.x, pz = b.z;
      b.x += dx * k + tvx * dt * (1 - k);
      b.z += dz * k + tvz * dt * (1 - k);
      b.heading = lerpAngle(b.heading, th, Math.min(1, dt * 3));
      b.speed = dt > 0 ? Math.hypot(b.x - px, b.z - pz) / dt : 0;
      return;
    }
  }
  if (d < 2.5 && Math.abs(wrapAngle(th - b.heading)) < 0.3) {
    b.locked = true;
    b.speed = 0;
    return;
  }
  if (d > 30) {
    const bearing = Math.atan2(dx, dz);
    const err = wrapAngle(bearing - b.heading);
    b.heading += Math.max(-turn * dt, Math.min(turn * dt, err));
    const want = Math.min(vmax, Math.sqrt(2 * 0.8 * d) + 1) * Math.max(0.25, Math.cos(err));
    b.speed += Math.max(-2 * dt, Math.min(1.5 * dt, want - b.speed));
    b.x += Math.sin(b.heading) * b.speed * dt;
    b.z += Math.cos(b.heading) * b.speed * dt;
  } else {
    // close in: ride along with the slot (feed-forward) and crab onto it, easing into its heading
    const want = Math.min(vmax * 0.5, 0.6 + d * 0.4);
    const step = Math.min(d, want * dt);
    const px = b.x, pz = b.z;
    b.x += tvx * dt + (dx / (d || 1)) * step;
    b.z += tvz * dt + (dz / (d || 1)) * step;
    b.speed = dt > 0 ? Math.hypot(b.x - px, b.z - pz) / dt : 0;
    const f = 1 - d / 30;
    b.heading = lerpAngle(b.heading, f > 0.5 ? th : Math.atan2(dx, dz), Math.min(1, dt * 1.2));
  }
}
