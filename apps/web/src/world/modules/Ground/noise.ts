// Pure helpers for the Ground module: seeded RNG, value noise, and the coastline shape.
// The water shader (water.ts) mirrors shoreX() in GLSL, so keep the two in sync.
import { RIVER, WATER_X, ZONES } from "../../config";

/** Small fast seeded RNG returning [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(ix: number, iy: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed + 1, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** 2D value noise in [0, 1). */
export function valueNoise(x: number, y: number, seed = 0): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** Fractal value noise normalised to [0, 1). */
export function fbm(x: number, y: number, octaves = 4, seed = 0): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * f, y * f, seed + i * 17);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

/** z where the river polyline crosses x (linear interpolation; clamps beyond the ends). */
export function riverZAt(x: number): number {
  const pts = RIVER.points;
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [x0, z0] = pts[i - 1];
    const [x1, z1] = pts[i];
    if (x <= x1) return z0 + ((z1 - z0) * (x - x0)) / (x1 - x0);
  }
  return pts[pts.length - 1][1];
}

const MOUTH_Z = riverZAt(WATER_X);
/** River mouth on the coast: no beach, no quay, open water. */
export const MOUTH_N = MOUTH_Z - RIVER.width / 2 - 5; // -660
export const MOUTH_S = MOUTH_Z + RIVER.width / 2 + 5; // -580
/** A straight sea wall (quay / embankment) runs from the river mouth south past the industrial zone. */
export const QUAY_N = MOUTH_S;
export const QUAY_S = Math.max(ZONES.industrial.maxZ, ZONES.containerTerminal.maxZ, ZONES.docks.maxZ) + 20; // 680
/** How far inland of WATER_X the beach waterline sits. */
export const SHORE_INSET = 6;
/** In the river mouth the "shore" for foam purposes is tucked under the land so no foam line crosses the river. */
export const MOUTH_SHORE_INSET = 40;
/** Sea level. Slightly below the ground so the land reads as sitting above the water. */
export const WATER_Y = -0.25;

/** The waterline x for a given z: straight sea wall in the middle, river mouth, wobbly beaches north and south. */
export function shoreX(z: number): number {
  if (z >= QUAY_N && z <= QUAY_S) return WATER_X;
  if (z >= MOUTH_N && z < QUAY_N) return WATER_X - MOUTH_SHORE_INSET;
  const e = z < MOUTH_N ? MOUTH_N - z : z - QUAY_S;
  const m = smoothstep(0, 60, e);
  return WATER_X - SHORE_INSET + m * (2.6 * Math.sin(z * 0.031) + 1.2 * Math.sin(z * 0.097 + 1.3));
}

/**
 * Offset a polyline sideways by `half` on each side with mitred joins.
 * Returns [left, right] point lists (left = +normal where normal = (-dz, dx) of the travel direction).
 */
export function ribbonEdges(points: [number, number][], half: number): [[number, number][], [number, number][]] {
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(n - 1, i + 1)];
    const cur = points[i];
    const d0 = norm(cur[0] - prev[0], cur[1] - prev[1]);
    const d1 = norm(next[0] - cur[0], next[1] - cur[1]);
    const a = i === 0 ? d1 : d0;
    const b = i === n - 1 ? d0 : d1;
    let tx = a[0] + b[0];
    let tz = a[1] + b[1];
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    // Miter normal and its length so the strip keeps its width through the bend.
    const nx = -tz;
    const nz = tx;
    const cos = Math.max(0.35, nx * -b[1] + nz * b[0]);
    const k = half / cos;
    left.push([cur[0] + nx * k, cur[1] + nz * k]);
    right.push([cur[0] - nx * k, cur[1] - nz * k]);
  }
  return [left, right];
}

function norm(x: number, z: number): [number, number] {
  const l = Math.hypot(x, z) || 1;
  return [x / l, z / l];
}
