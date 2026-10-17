// 2D helpers on the ground plane (x, z) for the Shoreditch layout: oriented boxes, overlap and road clearance.
// Rotation follows three.js (about +y): local x -> (cos ry, -sin ry), local z -> (sin ry, cos ry).

export interface OBB {
  x: number;
  z: number;
  hw: number; // half size along local x
  hd: number; // half size along local z
  ry: number;
}

export interface Seg {
  ax: number;
  az: number;
  bx: number;
  bz: number;
}

/** Local (lx, lz) offset of an oriented frame -> world [x, z]. */
export function toWorld(o: { x: number; z: number; ry: number }, lx: number, lz: number): [number, number] {
  const c = Math.cos(o.ry);
  const s = Math.sin(o.ry);
  return [o.x + lx * c + lz * s, o.z - lx * s + lz * c];
}

/** World point -> local [lx, lz] of an oriented frame. */
export function toLocal(o: { x: number; z: number; ry: number }, x: number, z: number): [number, number] {
  const c = Math.cos(o.ry);
  const s = Math.sin(o.ry);
  const dx = x - o.x;
  const dz = z - o.z;
  return [dx * c - dz * s, dx * s + dz * c];
}

export function corners(b: OBB): [number, number][] {
  return [
    toWorld(b, -b.hw, -b.hd),
    toWorld(b, b.hw, -b.hd),
    toWorld(b, b.hw, b.hd),
    toWorld(b, -b.hw, b.hd),
  ];
}

/** Separating-axis test for two oriented boxes, with an optional gap that must stay between them. */
export function obbOverlap(a: OBB, b: OBB, gap = 0): boolean {
  const axes: [number, number][] = [
    [Math.cos(a.ry), -Math.sin(a.ry)],
    [Math.sin(a.ry), Math.cos(a.ry)],
    [Math.cos(b.ry), -Math.sin(b.ry)],
    [Math.sin(b.ry), Math.cos(b.ry)],
  ];
  const ca = corners(a);
  const cb = corners(b);
  for (const [ax, az] of axes) {
    let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
    for (const [x, z] of ca) {
      const p = x * ax + z * az;
      minA = Math.min(minA, p);
      maxA = Math.max(maxA, p);
    }
    for (const [x, z] of cb) {
      const p = x * ax + z * az;
      minB = Math.min(minB, p);
      maxB = Math.max(maxB, p);
    }
    if (maxA + gap <= minB || maxB + gap <= minA) return false;
  }
  return true;
}

export function pointSegDist(px: number, pz: number, s: Seg): number {
  const dx = s.bx - s.ax;
  const dz = s.bz - s.az;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - s.ax) * dx + (pz - s.az) * dz) / l2)) : 0;
  return Math.hypot(px - (s.ax + t * dx), pz - (s.az + t * dz));
}

function segsIntersect(a: Seg, b: Seg): boolean {
  const d = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number) => (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const d1 = d(b.ax, b.az, b.bx, b.bz, a.ax, a.az);
  const d2 = d(b.ax, b.az, b.bx, b.bz, a.bx, a.bz);
  const d3 = d(a.ax, a.az, a.bx, a.bz, b.ax, b.az);
  const d4 = d(a.ax, a.az, a.bx, a.bz, b.bx, b.bz);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Proper crossing of two segments (touching at shared endpoints does not count). */
export function segmentsCross(a: Seg, b: Seg): boolean {
  return segsIntersect(a, b);
}

export function pointInObb(b: OBB, x: number, z: number, pad = 0): boolean {
  const [lx, lz] = toLocal(b, x, z);
  return Math.abs(lx) <= b.hw + pad && Math.abs(lz) <= b.hd + pad;
}

/** Shortest distance between an oriented box and a segment (0 if they touch). */
export function obbSegDist(b: OBB, s: Seg): number {
  if (pointInObb(b, s.ax, s.az) || pointInObb(b, s.bx, s.bz)) return 0;
  const cs = corners(b);
  for (let i = 0; i < 4; i++) {
    const [x0, z0] = cs[i];
    const [x1, z1] = cs[(i + 1) % 4];
    if (segsIntersect(s, { ax: x0, az: z0, bx: x1, bz: z1 })) return 0;
  }
  let best = Infinity;
  for (const [x, z] of cs) best = Math.min(best, pointSegDist(x, z, s));
  for (const [px, pz] of [[s.ax, s.az], [s.bx, s.bz]] as const) {
    const [lx, lz] = toLocal(b, px, pz);
    const ex = Math.max(0, Math.abs(lx) - b.hw);
    const ez = Math.max(0, Math.abs(lz) - b.hd);
    best = Math.min(best, Math.hypot(ex, ez));
  }
  return best;
}

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
