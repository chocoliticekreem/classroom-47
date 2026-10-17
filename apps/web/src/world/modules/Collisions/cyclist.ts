// Pure rules and state for cyclist hits (Collisions module): what counts as a hit, the rate limit,
// the plain HUD note, the knocked-off bike / rider tumble (rigid-body spin and slide), the crowd
// that gathers, and the shared record of each live hit (read by Responders, who kneel by the rider
// and carry them to the ambulance). No React, no three.js rendering.
import type { VehicleKind } from "../../registry";
import { closingSpeed, type Body } from "./rules";

/** A car/van/truck overlapping a cyclist closing faster than this (m/s) is a hit. */
export const HIT_CLOSING = 2;
/** At or above this closing speed (m/s, ~20 mph) the vehicle is damaged too: it needs a tow. */
export const DAMAGE_CLOSING = 9;
/** At most one cyclist hit per minute. */
export const CYCLIST_INTERVAL_MS = 60_000;
/** Cyclist hits still on the map at once (a staged request is refused beyond this). */
export const MAX_ACTIVE_HITS = 2;
/** Nobody responded: the scene clears itself after this long (keeps the demo flowing). */
export const SELF_CLEAR_MS = 120_000;
export const CROWD_N = 5;
/** After a cyclist hit is cleared, the bike and crowd fade out over this long, then the record goes. */
export const FADE_MS = 6000;

/** Vehicles that can hit a cyclist (emergency units, the motorcade and other bikes can't). */
export const HITTERS: ReadonlySet<VehicleKind> = new Set<VehicleKind>(["car", "taxi", "van", "truck", "bus"]);

/** Is this vehicle-vs-cyclist overlap a hit? The vehicle must be moving and closing faster than HIT_CLOSING. */
export function isCyclistHit(vehicle: Body, bike: Body): boolean {
  if (vehicle.stopped || vehicle.speed < 1) return false;
  return closingSpeed(vehicle, bike) > HIT_CLOSING;
}

/** Rate limit: one cyclist hit per interval (staged requests skip the interval but count towards it). */
export class CyclistGate {
  private last = -Infinity;
  suppressed = 0;
  constructor(readonly minIntervalMs = CYCLIST_INTERVAL_MS, readonly maxActive = MAX_ACTIVE_HITS) {}

  allows(now: number, active: number, staged = false): boolean {
    if (active >= this.maxActive || (!staged && now - this.last < this.minIntervalMs)) {
      this.suppressed++;
      return false;
    }
    return true;
  }

  commit(now: number) {
    this.last = now;
  }
}

const NAMES: Partial<Record<VehicleKind, string>> = { car: "car", taxi: "black cab", van: "van", truck: "lorry", bus: "bus" };

/** Hamyway's own fleet: DeliveryFleet ids "V-07" (vans) and "T-03" (trucks). */
export function isRivet(id: string) {
  return /^[VT]-\d+/.test(id);
}

/**
 * One plain HUD line. Hamyway vehicles are named ("Van V-07 hit a cyclist on Fleet St"), so the case
 * the agent gets is clearly about a Hamyway driver; anyone else is "A black cab hit a cyclist on ...".
 */
export function cyclistHitNote(kind: VehicleKind, id: string, road: string): string {
  if (isRivet(id)) return `${kind === "truck" ? "Truck" : "Van"} ${id} hit a cyclist on ${road}`;
  const n = NAMES[kind] ?? "vehicle";
  return `A ${n} hit a cyclist on ${road}`;
}

// --- Tumble: a tiny rigid body (spin + slide) --------------------------------------------------------

export interface Tumble {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  yawRate: number;
  roll: number; // about the body's forward axis; settles at ±PI/2 (on its side)
  rollRate: number;
  rest: boolean;
}

const G = 18;
const FRICTION = 7; // m/s² sliding on tarmac
const BOUNCE = 0.25;

export function newTumble(): Tumble {
  return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, yawRate: 0, roll: 0, rollRate: 0, rest: false };
}

/**
 * Throw a body from (x, z) heading `h` along the vehicle's direction `vh` at `speed` (m/s), with
 * `up` m/s upwards, spin `spin` rad/s (sign picks the side it lands on) and `lat` m/s sideways.
 */
export function launch(t: Tumble, x: number, z: number, h: number, vh: number, speed: number, up: number, spin: number, lat: number) {
  const fx = Math.sin(vh);
  const fz = Math.cos(vh);
  t.x = x;
  t.y = 0;
  t.z = z;
  t.vx = fx * speed + fz * lat; // lateral (fz, -fx) = right of the vehicle
  t.vz = fz * speed - fx * lat;
  t.vy = up;
  t.yaw = h;
  t.yawRate = spin * 0.8;
  t.roll = 0;
  t.rollRate = spin;
  t.rest = false;
}

/** Advance a tumble by dt: ballistic flight, bounce, slide with friction, spin settling onto its side. */
export function stepTumble(t: Tumble, dt: number) {
  if (t.rest) return;
  t.vy -= G * dt;
  t.x += t.vx * dt;
  t.y += t.vy * dt;
  t.z += t.vz * dt;
  t.yaw += t.yawRate * dt;
  t.roll += t.rollRate * dt;
  if (t.y <= 0) {
    t.y = 0;
    if (t.vy < -1.5) t.vy = -t.vy * BOUNCE;
    else t.vy = 0;
    // sliding: friction against the velocity, spin dies, roll settles to the nearest side
    const sp = Math.hypot(t.vx, t.vz);
    if (sp > 0) {
      const k = Math.max(0, sp - FRICTION * dt) / sp;
      t.vx *= k;
      t.vz *= k;
    }
    t.yawRate *= Math.exp(-4 * dt);
    const side = t.roll >= 0 ? Math.PI / 2 : -Math.PI / 2;
    const target = side + Math.round((t.roll - side) / (2 * Math.PI)) * 2 * Math.PI;
    t.rollRate = (target - t.roll) * 8;
    if (sp < 0.05 && t.vy === 0 && Math.abs(target - t.roll) < 0.02) {
      t.roll = target;
      t.vx = t.vz = t.rollRate = t.yawRate = 0;
      t.rest = true;
    }
  }
}

/** Where a launched tumble comes to rest (simulated at 60 Hz, up to `maxS` seconds). Doesn't touch `t`. */
export function restPoint(t: Tumble, maxS = 6): { x: number; z: number } {
  const c = { ...t };
  for (let i = 0; i < maxS * 60 && !c.rest; i++) stepTumble(c, 1 / 60);
  return { x: c.x, z: c.z };
}

// --- The live hit record (shared with Responders) ----------------------------------------------------

export interface CyclistHit {
  incidentId: string;
  vehicleId: string;
  cyclistId: string;
  edgeKey: string;
  /** The vehicle was damaged (fast hit): Responders sends a tow as well. */
  damaged: boolean;
  /** Where the rider ends up (the incident point). */
  x: number;
  z: number;
  bike: Tumble;
  rider: Tumble;
  jersey: number; // colour index
  /** Responders: set while the paramedics carry the rider to the ambulance (stretcher pose). */
  carry: { x: number; y: number; z: number; h: number } | null;
  /** Responders: the rider is in the ambulance (hide them). */
  loaded: boolean;
  createdAt: number; // performance.now() ms
  clearedAt: number | null; // when the incident was cleared (bike and crowd fade out)
  crowd: Crowd;
}

export interface Crowd {
  n: number;
  x: Float32Array;
  z: Float32Array;
  h: Float32Array;
  sx: Float32Array; // where they came from (the pavement)
  sz: Float32Array;
  tx: Float32Array; // where they stand to watch
  tz: Float32Array;
  speed: Float32Array;
  delay: Float32Array; // seconds before they notice
  colour: Uint8Array;
}

/** A few onlookers walking in from the pavements on both sides to a loose ring around the rider. */
export function makeCrowd(x: number, z: number, roadHeading: number, rand: () => number, n = CROWD_N): Crowd {
  const c: Crowd = {
    n,
    x: new Float32Array(n), z: new Float32Array(n), h: new Float32Array(n),
    sx: new Float32Array(n), sz: new Float32Array(n), tx: new Float32Array(n), tz: new Float32Array(n),
    speed: new Float32Array(n), delay: new Float32Array(n), colour: new Uint8Array(n),
  };
  const fx = Math.sin(roadHeading);
  const fz = Math.cos(roadHeading);
  for (let i = 0; i < n; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const along = (rand() - 0.5) * 14;
    const off = 6.5 + rand() * 2.5; // pavement, beyond the kerb
    c.sx[i] = x + fx * along + fz * off * side;
    c.sz[i] = z + fz * along - fx * off * side;
    // ring around the rider, leaving the road ahead / behind clearer for the ambulance crew
    const a = (i / n) * Math.PI * 2 + rand() * 0.6;
    const r = 2.6 + rand() * 0.9;
    c.tx[i] = x + Math.cos(a) * r;
    c.tz[i] = z + Math.sin(a) * r;
    c.x[i] = c.sx[i];
    c.z[i] = c.sz[i];
    c.h[i] = Math.atan2(c.tx[i] - c.sx[i], c.tz[i] - c.sz[i]);
    c.speed[i] = 1.3 + rand() * 0.6;
    c.delay[i] = 0.4 + rand() * 2.2;
    c.colour[i] = Math.floor(rand() * 8);
  }
  return c;
}

/**
 * Walk the crowd: in towards the rider (after a short delay), or back out to the pavement once the
 * scene is cleared. `age` = seconds since the hit. Faces the rider while watching.
 */
export function stepCrowd(c: Crowd, dt: number, age: number, leaving: boolean, rx: number, rz: number) {
  for (let i = 0; i < c.n; i++) {
    if (!leaving && age < c.delay[i]) continue;
    const gx = leaving ? c.sx[i] : c.tx[i];
    const gz = leaving ? c.sz[i] : c.tz[i];
    const dx = gx - c.x[i];
    const dz = gz - c.z[i];
    const d = Math.hypot(dx, dz);
    const step = c.speed[i] * dt;
    if (d > step) {
      c.x[i] += (dx / d) * step;
      c.z[i] += (dz / d) * step;
      c.h[i] = Math.atan2(dx, dz);
    } else {
      c.x[i] = gx;
      c.z[i] = gz;
      if (!leaving) c.h[i] = Math.atan2(rx - c.x[i], rz - c.z[i]);
    }
  }
}

/** Live hits by incident id. Collisions writes; Responders reads and sets carry / loaded. */
export const cyclistHits = new Map<string, CyclistHit>();
