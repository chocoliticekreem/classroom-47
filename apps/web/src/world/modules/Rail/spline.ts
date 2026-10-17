// Track centre lines: a polyline with circular fillets at every corner, resampled at a fixed arc-length
// step so pose lookups are O(1). Lateral offsets are measured to the LEFT of increasing s (UK: trains run
// on the left, so the "out" track is the + side).

export interface Spline {
  xs: Float32Array;
  zs: Float32Array;
  hs: Float32Array; // heading, rotation about y (0 = facing +z)
  step: number;
  length: number;
}

export interface Pose {
  x: number;
  z: number;
  h: number;
}

/** Fillet radius per corner: one number for all, or one per interior point. */
export function buildSpline(points: readonly (readonly [number, number])[], radius: number | readonly number[], step = 0.5): Spline {
  const raw: [number, number][] = [[points[0][0], points[0][1]]];
  for (let i = 1; i < points.length - 1; i++) {
    const r = typeof radius === "number" ? radius : radius[i - 1] ?? radius[radius.length - 1];
    const [px, pz] = points[i - 1];
    const [cx, cz] = points[i];
    const [nx, nz] = points[i + 1];
    const l1 = Math.hypot(cx - px, cz - pz);
    const l2 = Math.hypot(nx - cx, nz - cz);
    const ux = (cx - px) / l1, uz = (cz - pz) / l1;
    const vx = (nx - cx) / l2, vz = (nz - cz) / l2;
    const turn = Math.acos(Math.max(-1, Math.min(1, ux * vx + uz * vz)));
    if (turn < 1e-4) {
      raw.push([cx, cz]);
      continue;
    }
    const d = Math.min(r * Math.tan(turn / 2), l1 / 2, l2 / 2);
    const rr = d / Math.tan(turn / 2);
    const t1x = cx - ux * d, t1z = cz - uz * d;
    const side = Math.sign(ux * vz - uz * vx) || 1; // +1: turning toward +left in (x,z) math sense
    const ox = -uz * side, oz = ux * side;
    const ccx = t1x + ox * rr, ccz = t1z + oz * rr;
    const a0 = Math.atan2(t1z - ccz, t1x - ccx);
    const segs = Math.max(4, Math.ceil((turn * rr) / (step * 0.5)));
    for (let k = 0; k <= segs; k++) {
      const a = a0 + side * turn * (k / segs);
      raw.push([ccx + Math.cos(a) * rr, ccz + Math.sin(a) * rr]);
    }
  }
  raw.push([points[points.length - 1][0], points[points.length - 1][1]]);

  const cum = [0];
  for (let i = 1; i < raw.length; i++) cum.push(cum[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
  const length = cum[cum.length - 1];
  const n = Math.floor(length / step) + 2;
  const xs = new Float32Array(n), zs = new Float32Array(n), hs = new Float32Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const s = Math.min(i * step, length);
    while (j < raw.length - 2 && cum[j + 1] < s) j++;
    while (j < raw.length - 2 && cum[j + 1] - cum[j] < 1e-9) j++;
    const segLen = cum[j + 1] - cum[j] || 1;
    const u = (s - cum[j]) / segLen;
    const [ax, az] = raw[j];
    const [bx, bz] = raw[j + 1];
    xs[i] = ax + (bx - ax) * u;
    zs[i] = az + (bz - az) * u;
  }
  // headings from central differences of the resampled points (smooth through arc vertices)
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    hs[i] = Math.atan2(xs[b] - xs[a], zs[b] - zs[a]);
  }
  return { xs, zs, hs, step, length };
}

/** Pose on the centre line at arc length s (clamped to the ends). */
export function poseAt(sp: Spline, s: number, out: Pose): Pose {
  const f = Math.max(0, Math.min(sp.length, s)) / sp.step;
  const i = Math.min(sp.xs.length - 2, Math.floor(f));
  const u = f - i;
  out.x = sp.xs[i] + (sp.xs[i + 1] - sp.xs[i]) * u;
  out.z = sp.zs[i] + (sp.zs[i + 1] - sp.zs[i]) * u;
  let dh = sp.hs[i + 1] - sp.hs[i];
  if (dh > Math.PI) dh -= 2 * Math.PI;
  if (dh < -Math.PI) dh += 2 * Math.PI;
  out.h = sp.hs[i] + dh * u;
  return out;
}

/** Point `lat` metres to the LEFT of the centre line at s (left of travel toward increasing s). */
export function offsetPoint(sp: Spline, s: number, lat: number, out: Pose): Pose {
  poseAt(sp, s, out);
  // forward = (sin h, cos h); left (three.js, y up, looking down) = (cos h, -sin h)
  out.x += Math.cos(out.h) * lat;
  out.z -= Math.sin(out.h) * lat;
  return out;
}

/** Arc length of the sample nearest (x, z). */
export function projectS(sp: Spline, x: number, z: number): number {
  let best = Infinity;
  let bi = 0;
  for (let i = 0; i < sp.xs.length; i++) {
    const d = (sp.xs[i] - x) ** 2 + (sp.zs[i] - z) ** 2;
    if (d < best) {
      best = d;
      bi = i;
    }
  }
  return Math.min(bi * sp.step, sp.length);
}

/** Distance from (x, z) to the centre line. */
export function distanceTo(sp: Spline, x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < sp.xs.length; i++) best = Math.min(best, (sp.xs[i] - x) ** 2 + (sp.zs[i] - z) ** 2);
  return Math.sqrt(best);
}

/**
 * Where the centre line crosses the segment a -> b. Returns arc lengths s on the spline and u (0..1) on the
 * segment, plus the crossing angle (radians between the two directions, 0..pi/2).
 */
export function crossings(sp: Spline, ax: number, az: number, bx: number, bz: number): { s: number; u: number; angle: number }[] {
  const out: { s: number; u: number; angle: number }[] = [];
  const minX = Math.min(ax, bx), maxX = Math.max(ax, bx), minZ = Math.min(az, bz), maxZ = Math.max(az, bz);
  const ex = bx - ax, ez = bz - az;
  const el = Math.hypot(ex, ez) || 1;
  for (let i = 0; i < sp.xs.length - 1; i++) {
    const px = sp.xs[i], pz = sp.zs[i], qx = sp.xs[i + 1], qz = sp.zs[i + 1];
    if (Math.max(px, qx) < minX || Math.min(px, qx) > maxX || Math.max(pz, qz) < minZ || Math.min(pz, qz) > maxZ) continue;
    const rx = qx - px, rz = qz - pz;
    const den = rx * ez - rz * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((ax - px) * ez - (az - pz) * ex) / den;
    const u = ((ax - px) * rz - (az - pz) * rx) / den;
    if (t < 0 || t >= 1 || u < 0 || u > 1) continue;
    const rl = Math.hypot(rx, rz) || 1;
    const cos = Math.abs((rx * ex + rz * ez) / (rl * el));
    out.push({ s: Math.min(sp.length, (i + t) * sp.step), u, angle: Math.acos(Math.min(1, cos)) });
  }
  return out;
}

/** Distance from point p to segment a-b. */
export function segDistance(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

export const smoothstep = (e0: number, e1: number, x: number) => {
  if (e1 === e0) return x < e0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Piecewise profile through (s, value) keys with smoothstep easing between keys (flat at every key). */
export function easedProfile(keys: readonly (readonly [number, number])[], s: number): number {
  if (s <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [s1, v1] = keys[i];
    if (s <= s1) {
      const [s0, v0] = keys[i - 1];
      return v0 + (v1 - v0) * smoothstep(s0, s1, s);
    }
  }
  return keys[keys.length - 1][1];
}
