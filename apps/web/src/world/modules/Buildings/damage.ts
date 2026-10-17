// Pure damage logic: which building groups a damage circle hits, and the collapse / rebuild timelines.
import type { CityLayout } from "./layout";
import { mulberry32 } from "./layout";

/** Ground footprint (axis-aligned rect) and height of one building group. */
export interface Footprint {
  g: number;
  x: number;
  z: number;
  w: number;
  d: number;
  top: number; // highest point incl. roof props / masts
  floors: number; // floors to rebuild, one step each
}

export function circleHitsRect(cx: number, cz: number, r: number, x: number, z: number, w: number, d: number): boolean {
  const nx = Math.max(x - w / 2, Math.min(cx, x + w / 2));
  const nz = Math.max(z - d / 2, Math.min(cz, z + d / 2));
  const dx = cx - nx;
  const dz = cz - nz;
  return dx * dx + dz * dz <= r * r;
}

/** Footprints indexed by group id (index 0 unused). */
export function groupFootprints(city: CityLayout): (Footprint | null)[] {
  const minX = new Array(city.groups + 1).fill(Infinity);
  const maxX = new Array(city.groups + 1).fill(-Infinity);
  const minZ = new Array(city.groups + 1).fill(Infinity);
  const maxZ = new Array(city.groups + 1).fill(-Infinity);
  const top = new Array(city.groups + 1).fill(0);
  const grow = (g: number, x: number, z: number, hw: number, hd: number) => {
    minX[g] = Math.min(minX[g], x - hw);
    maxX[g] = Math.max(maxX[g], x + hw);
    minZ[g] = Math.min(minZ[g], z - hd);
    maxZ[g] = Math.max(maxZ[g], z + hd);
  };
  for (const b of city.bodies) {
    grow(b.g, b.x, b.z, b.w / 2, b.d / 2);
    top[b.g] = Math.max(top[b.g], b.y + b.h);
  }
  for (const l of city.landmarks) {
    grow(l.g, l.x, l.z, l.r, l.r);
    top[l.g] = Math.max(top[l.g], l.h);
  }
  for (const t of [...city.trims, ...city.roofs, ...city.acs]) top[t.g] = Math.max(top[t.g], t.y + t.h);
  for (const a of city.antennas) top[a.g] = Math.max(top[a.g], a.y + a.h);
  const out: (Footprint | null)[] = [null];
  for (let g = 1; g <= city.groups; g++) {
    if (!Number.isFinite(minX[g])) {
      out.push(null);
      continue;
    }
    out.push({
      g,
      x: (minX[g] + maxX[g]) / 2,
      z: (minZ[g] + maxZ[g]) / 2,
      w: maxX[g] - minX[g],
      d: maxZ[g] - minZ[g],
      top: top[g],
      floors: Math.max(2, Math.min(24, Math.round(top[g] / 3.6))),
    });
  }
  return out;
}

export function groupsInCircle(fps: (Footprint | null)[], cx: number, cz: number, r: number): number[] {
  const hit: number[] = [];
  for (const f of fps) if (f && circleHitsRect(cx, cz, r, f.x, f.z, f.w, f.d)) hit.push(f.g);
  return hit;
}

// ---------------------------------------------------------------- collapse

export const COLLAPSE_S = 2.5;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Pose t seconds into a collapse. sink/tilt are 0..1 fractions; shake is a small sideways jitter in metres. */
export function collapsePose(t: number): { sink: number; tilt: number; shake: number; done: boolean } {
  const p = clamp01(t / COLLAPSE_S);
  // a short shudder, then an accelerating drop while it leans
  const drop = clamp01((p - 0.1) / 0.9);
  return {
    sink: drop * drop,
    tilt: smooth(0.05, 0.75, p),
    shake: p < 0.3 ? Math.sin(t * 70) * 0.25 * (1 - p / 0.3) : 0,
    done: t >= COLLAPSE_S,
  };
}

// ---------------------------------------------------------------- rebuild

/** Height fraction 0..1 of a rebuilding group, rising floor by floor: pause, then a quick lift per floor. */
export function rebuildFraction(t: number, dur: number, floors: number): number {
  if (t <= 0) return 0;
  if (t >= dur) return 1;
  const x = (t / dur) * floors;
  const k = Math.floor(x);
  return Math.min(1, (k + smooth(0.55, 1, x - k)) / floors);
}

export const REBUILD_MIN_S = 26;
export const REBUILD_MAX_S = 30;
export const REBUILD_STAGGER_S = 6;

/** Per-group delay and duration for a zone's rebuild (seeded by group id so it's stable). */
export function rebuildSchedule(g: number): { delay: number; dur: number } {
  const r = mulberry32(g * 7919 + 17);
  return { delay: r() * REBUILD_STAGGER_S, dur: REBUILD_MIN_S + r() * (REBUILD_MAX_S - REBUILD_MIN_S) };
}
