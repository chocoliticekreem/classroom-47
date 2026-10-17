// Hampstead terrain: pure height field for the heath (gentle low-poly hills), ponds and heath paths.
// Roads stay flat at y = 0: the height is masked to 0 near every Hampstead road and at the heath edges.
import { hampstead } from "../../districts/hampstead";

export interface Seg {
  ax: number;
  az: number;
  bx: number;
  bz: number;
}

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface Pond {
  x: number;
  z: number;
  rx: number;
  rz: number;
  swim: boolean; // bathing pond: swimmers, a jetty and a lifeguard hut
  name: string;
}

/** The heath: no roads inside, hills, ponds, paths. */
export const HEATH: Rect = { minX: -386, maxX: -24, minZ: -926, maxZ: -742 };

export const PONDS: Pond[] = [
  { x: -300, z: -770, rx: 26, rz: 12, swim: true, name: "Mixed Bathing Pond" },
  { x: -72, z: -808, rx: 13, rz: 24, swim: true, name: "Ladies' Pond" },
  { x: -150, z: -762, rx: 17, rz: 9, swim: false, name: "Hampstead No. 1 Pond" },
  { x: -250, z: -903, rx: 14, rz: 9, swim: false, name: "Model Boating Pond" },
];

export const VIEWPOINT = { x: -190, z: -846 }; // Parliament Hill: bench, telescope, kites
export const OBSERVATORY = { x: -334, z: -884 };

interface Hill {
  x: number;
  z: number;
  h: number;
  s: number; // gaussian sigma
}

const HILLS: Hill[] = [
  { x: VIEWPOINT.x, z: VIEWPOINT.z, h: 15, s: 32 },
  { x: OBSERVATORY.x, z: OBSERVATORY.z, h: 11, s: 24 },
  { x: -268, z: -830, h: 6, s: 26 },
  { x: -100, z: -880, h: 8, s: 28 },
  { x: -215, z: -790, h: 3.5, s: 20 },
  { x: -130, z: -910, h: 4, s: 18 },
  { x: -360, z: -800, h: 5, s: 22 },
  { x: -40, z: -880, h: 4, s: 16 },
];

/** Paths across the heath (desire lines). People stroll along them. */
export const PATHS: [number, number][][] = [
  [[-34, -750], [-80, -770], [-120, -800], [-160, -830], [VIEWPOINT.x, VIEWPOINT.z], [-230, -862], [-275, -878], [OBSERVATORY.x + 12, OBSERVATORY.z]],
  [[-378, -750], [-340, -780], [-300, -795], [-245, -815], [VIEWPOINT.x, VIEWPOINT.z]],
  [[VIEWPOINT.x, VIEWPOINT.z], [-175, -880], [-160, -920]],
  [[-40, -918], [-80, -895], [-110, -860], [-125, -820], [-160, -790], [-190, -750]],
  [[-380, -918], [-330, -910], [-280, -925]],
];

export function pointSegDist(x: number, z: number, s: Seg) {
  const dx = s.bx - s.ax;
  const dz = s.bz - s.az;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / l2));
  return Math.hypot(x - (s.ax + dx * t), z - (s.az + dz * t));
}

/** Centre lines of every Hampstead road (from the district file, so it never drifts). */
export function hampsteadSegments(): Seg[] {
  const at = new Map(hampstead.nodes.map((n) => [n.id, n]));
  const out: Seg[] = [];
  for (const e of hampstead.edges) {
    const a = at.get(e.a);
    const b = at.get(e.b);
    if (a && b) out.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z });
  }
  return out;
}

const SEGS = hampsteadSegments();
const PATH_SEGS: Seg[] = PATHS.flatMap((p) =>
  p.slice(1).map((q, i) => ({ ax: p[i][0], az: p[i][1], bx: q[0], bz: q[1] })),
);

export function roadDistance(x: number, z: number, segs: Seg[] = SEGS) {
  let d = Infinity;
  for (const s of segs) {
    const v = pointSegDist(x, z, s);
    if (v < d) d = v;
  }
  return d;
}

export function pathDistance(x: number, z: number) {
  return roadDistance(x, z, PATH_SEGS);
}

/** Ellipse "radius units" from the pond centre: < 1 inside the water. */
export function pondMetric(p: Pond, x: number, z: number) {
  return Math.hypot((x - p.x) / p.rx, (z - p.z) / p.rz);
}

export function inPond(x: number, z: number, margin = 0) {
  return PONDS.some((p) => Math.hypot((x - p.x) / (p.rx + margin), (z - p.z) / (p.rz + margin)) < 1);
}

const smooth = (e0: number, e1: number, v: number) => {
  const t = Math.max(0, Math.min(1, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Height of the ground at (x, z). 0 outside the heath, near roads and in/around ponds. */
export function heightAt(x: number, z: number) {
  if (x <= HEATH.minX || x >= HEATH.maxX || z <= HEATH.minZ || z >= HEATH.maxZ) return 0;
  const edge = Math.min(x - HEATH.minX, HEATH.maxX - x, z - HEATH.minZ, HEATH.maxZ - z);
  let mask = smooth(0, 22, edge);
  if (mask <= 0) return 0;
  mask *= smooth(9, 26, roadDistance(x, z));
  if (mask <= 0) return 0;
  for (const p of PONDS) {
    const m = pondMetric(p, x, z);
    mask *= smooth(1.15, 1.9, m);
  }
  if (mask <= 0) return 0;
  let h = 0;
  for (const hl of HILLS) {
    const d2 = (x - hl.x) ** 2 + (z - hl.z) ** 2;
    h += hl.h * Math.exp(-d2 / (2 * hl.s * hl.s));
  }
  h += 0.9 + 0.7 * Math.sin(x * 0.071) * Math.cos(z * 0.093) + 0.4 * Math.sin((x + z) * 0.13);
  return Math.max(0, h * mask);
}

/** The heath mesh and everything standing on it sit this far above the height field (clear of Ground's grass). */
export const LIFT = 0.08;

/** Where feet, trunks and benches go: the drawn surface (height field + LIFT). */
export function surfaceAt(x: number, z: number) {
  return heightAt(x, z) + LIFT;
}

/** Small helper for things that span a footprint: the lowest ground under a disc. */
export function minHeightAround(x: number, z: number, r: number) {
  let m = heightAt(x, z);
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    m = Math.min(m, heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r));
  }
  return m;
}
