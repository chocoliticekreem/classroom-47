// Tiny 2D helpers for site placement (pure, no three.js).
import type { Box } from "../../config";

export function pointSegDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}

export function pointBoxDist(px: number, pz: number, b: Box) {
  const dx = Math.max(b.minX - px, 0, px - b.maxX);
  const dz = Math.max(b.minZ - pz, 0, pz - b.maxZ);
  return Math.hypot(dx, dz);
}

function cross(ax: number, az: number, bx: number, bz: number, cx: number, cz: number) {
  return (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
}

export function segsIntersect(
  ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number,
) {
  const d1 = cross(cx, cz, dx, dz, ax, az);
  const d2 = cross(cx, cz, dx, dz, bx, bz);
  const d3 = cross(ax, az, bx, bz, cx, cz);
  const d4 = cross(ax, az, bx, bz, dx, dz);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Shortest distance between segment a-b and an axis-aligned box (0 when they touch or overlap). */
export function segBoxDist(ax: number, az: number, bx: number, bz: number, r: Box) {
  const inside = (x: number, z: number) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
  if (inside(ax, az) || inside(bx, bz)) return 0;
  const cs: [number, number][] = [
    [r.minX, r.minZ], [r.maxX, r.minZ], [r.maxX, r.maxZ], [r.minX, r.maxZ],
  ];
  for (let i = 0; i < 4; i++) {
    const [cx, cz] = cs[i];
    const [dx, dz] = cs[(i + 1) % 4];
    if (segsIntersect(ax, az, bx, bz, cx, cz, dx, dz)) return 0;
  }
  let d = Math.min(pointBoxDist(ax, az, r), pointBoxDist(bx, bz, r));
  for (const [cx, cz] of cs) d = Math.min(d, pointSegDist(cx, cz, ax, az, bx, bz));
  return d;
}

export function boxesOverlap(a: Box, b: Box, margin = 0) {
  return a.minX - margin < b.maxX && a.maxX + margin > b.minX && a.minZ - margin < b.maxZ && a.maxZ + margin > b.minZ;
}

export function boxAround(x: number, z: number, hx: number, hz: number): Box {
  return { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz };
}

/** Wrap an angle into (-PI, PI]. */
export function wrapPi(a: number) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Deterministic PRNG. */
export function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
