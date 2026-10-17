// Pure crash rules for the Collisions module: closing speed, crash vs. slow overlap, impulse, and the
// rate limiter / dedupe gate. No three.js, no React: unit-tested.
import type { VehicleKind } from "../../registry";

export const CRASH_CLOSING = 3.5; // m/s: overlapping while closing faster than this is a crash (a 3 m/s U-turn nudge is not)
export const CRASH_FAST = 5; // m/s: ...or hitting a stopped vehicle while going this fast
export const MIN_INTERVAL_MS = 20_000;
export const MAX_ACTIVE = 3;
export const PAIR_MEMORY_MS = 60_000;

export interface Body {
  x: number;
  z: number;
  h: number; // heading, 0 = +z
  speed: number;
  stopped: boolean;
}

/** How fast A and B approach each other along the line between them (> 0 = closing), m/s. */
export function closingSpeed(a: Body, b: Body): number {
  let nx = b.x - a.x;
  let nz = b.z - a.z;
  const len = Math.hypot(nx, nz);
  if (len < 1e-6) return Math.abs(a.speed - b.speed) + Math.min(a.speed, b.speed);
  nx /= len;
  nz /= len;
  const va = (a.stopped ? 0 : a.speed);
  const vb = (b.stopped ? 0 : b.speed);
  const rvx = Math.sin(a.h) * va - Math.sin(b.h) * vb;
  const rvz = Math.cos(a.h) * va - Math.cos(b.h) * vb;
  return rvx * nx + rvz * nz;
}

export function isCrash(a: Body, b: Body): boolean {
  if (a.stopped && b.stopped) return false;
  if (closingSpeed(a, b) > CRASH_CLOSING) return true;
  const va = a.stopped ? 0 : a.speed;
  const vb = b.stopped ? 0 : b.speed;
  return (a.stopped && vb > CRASH_FAST) || (b.stopped && va > CRASH_FAST);
}

export function mass(kind: VehicleKind): number {
  switch (kind) {
    case "truck": case "fire": case "roadworks": return 12;
    case "bus": return 11;
    case "tow": return 7;
    case "van": case "ambulance": return 3;
    default: return 1.4;
  }
}

/**
 * Velocity change (m/s, world x/z) for A and B in an inelastic impact along unit normal n (A -> B),
 * restitution e. Heavier vehicles barely move; a car hit by a lorry flies.
 */
export function impulse(a: Body, ma: number, b: Body, mb: number, nx: number, nz: number, e = 0.35) {
  const va = a.stopped ? 0 : a.speed;
  const vb = b.stopped ? 0 : b.speed;
  const rv = (Math.sin(a.h) * va - Math.sin(b.h) * vb) * nx + (Math.cos(a.h) * va - Math.cos(b.h) * vb) * nz;
  const j = Math.max(0, rv) * (1 + e) / (1 / ma + 1 / mb);
  return { ax: (-j / ma) * nx, az: (-j / ma) * nz, bx: (j / mb) * nx, bz: (j / mb) * nz };
}

export function pairKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Rate limit (one new crash per interval), cap on active crashes, and pair dedupe. */
export class CrashGate {
  private last = -Infinity;
  private seen = new Map<string, number>();
  suppressed = 0;

  constructor(readonly minIntervalMs = MIN_INTERVAL_MS, readonly maxActive = MAX_ACTIVE, readonly pairMemoryMs = PAIR_MEMORY_MS) {}

  /** Has this pair already crashed recently? */
  isDuplicate(key: string, now: number) {
    const t = this.seen.get(key);
    return t !== undefined && now - t < this.pairMemoryMs;
  }

  /** May a new crash for `key` happen now, with `active` crashes still on the map? */
  allows(key: string, now: number, active: number): boolean {
    if (this.isDuplicate(key, now)) return false;
    if (now - this.last < this.minIntervalMs || active >= this.maxActive) {
      this.suppressed++;
      return false;
    }
    return true;
  }

  commit(key: string, now: number) {
    this.last = now;
    this.seen.set(key, now);
    if (this.seen.size > 64) for (const [k, t] of this.seen) if (now - t >= this.pairMemoryMs) this.seen.delete(k);
  }
}

const NAMES: Record<VehicleKind, string> = {
  car: "car", taxi: "black cab", bus: "bus", van: "van", truck: "lorry", police: "police car",
  ambulance: "ambulance", fire: "fire engine", roadworks: "roadworks lorry", tow: "tow truck",
  cyclist: "cyclist", motorcade: "motorcade car",
};

/** One HUD line, e.g. "Lorry hgv-4 ploughed into a stopped car car-12 at 31 mph". */
export function crashNote(aKind: VehicleKind, aId: string, bKind: VehicleKind, bId: string, closing: number, bStopped: boolean): string {
  const mph = Math.max(5, Math.round(closing * 2.237));
  const verb = mph > 40 ? "ploughed into" : mph > 20 ? "slammed into" : "ran into";
  const a = NAMES[aKind];
  const b = NAMES[bKind];
  const art = bStopped ? "a stopped" : /^[aeiou]/.test(b) ? "an" : "a";
  return `${a[0].toUpperCase()}${a.slice(1)} ${aId} ${verb} ${art} ${b} ${bId} at ${mph} mph`;
}
