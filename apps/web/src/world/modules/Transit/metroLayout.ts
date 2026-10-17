// Elevated metro: two lines on viaducts above downtown roads. Track geometry (polyline with
// filleted corners, sampled by arc length), stations, and where the pillars go.
import { ROAD_NODES } from "../../roads";

export interface MetroStation {
  name: string;
  x: number;
  z: number;
}

export interface MetroLine {
  id: "red" | "blue";
  color: string;
  height: number; // top of the viaduct beam
  radius: number; // corner fillet radius
  points: [number, number][];
  stations: MetroStation[];
}

// Red: east-west above the z = -40 road, out past the grid toward the docks.
// Blue: north-south above x = -80, curving east at the south end toward the depot. It runs higher so it clears red.
export const METRO_LINES: readonly MetroLine[] = [
  {
    id: "red",
    color: "#e1251b",
    height: 8.5,
    radius: 20,
    points: [[-158, -40], [207, -40]],
    stations: [
      { name: "Hamyway Cross", x: -140, z: -40 },
      { name: "Bank", x: -20, z: -40 },
      { name: "Canary Wharf", x: 100, z: -40 },
      { name: "Docklands", x: 188, z: -40 },
    ],
  },
  {
    id: "blue",
    color: "#1c5fd6",
    height: 14,
    radius: 26,
    points: [[-80, -207], [-80, 190], [-12, 190]],
    stations: [
      { name: "Northgate", x: -80, z: -188 },
      { name: "Angel", x: -80, z: -100 },
      { name: "Elephant & Castle", x: -80, z: 20 },
      { name: "Kennington", x: -80, z: 100 },
      { name: "Depot Yard", x: -38, z: 190 },
    ],
  },
];

export interface Track {
  xs: Float32Array;
  zs: Float32Array;
  hs: Float32Array; // heading (rotation about y, 0 = +z)
  step: number;
  length: number;
}

export interface TrackPose {
  x: number;
  z: number;
  h: number;
}

/** Sample a polyline with circular fillets of radius r at every corner, every `step` metres. */
export function buildTrack(points: readonly [number, number][], r: number, step = 0.5): Track {
  // dense raw path
  const raw: [number, number][] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const [px, pz] = points[i - 1];
    const [cx, cz] = points[i];
    const [nx, nz] = points[i + 1];
    const l1 = Math.hypot(cx - px, cz - pz), l2 = Math.hypot(nx - cx, nz - cz);
    const ux = (cx - px) / l1, uz = (cz - pz) / l1;
    const vx = (nx - cx) / l2, vz = (nz - cz) / l2;
    const turn = Math.acos(Math.max(-1, Math.min(1, ux * vx + uz * vz)));
    const d = Math.min(r * Math.tan(turn / 2), l1 / 2, l2 / 2);
    const rr = d / Math.tan(turn / 2 || 1e-6);
    const t1x = cx - ux * d, t1z = cz - uz * d;
    // centre: from the first tangent point, perpendicular toward the inside of the turn
    const side = Math.sign(ux * vz - uz * vx) || 1;
    const ox = -uz * side, oz = ux * side;
    const ccx = t1x + ox * rr, ccz = t1z + oz * rr;
    const a0 = Math.atan2(t1z - ccz, t1x - ccx);
    const segs = Math.max(4, Math.ceil(((turn * rr) / step) * 2));
    for (let k = 0; k <= segs; k++) {
      const a = a0 + side * turn * (k / segs);
      raw.push([ccx + Math.cos(a) * rr, ccz + Math.sin(a) * rr]);
    }
  }
  raw.push(points[points.length - 1]);
  // cumulative length
  const cum = [0];
  for (let i = 1; i < raw.length; i++) cum.push(cum[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
  const length = cum[cum.length - 1];
  const n = Math.floor(length / step) + 2;
  const xs = new Float32Array(n), zs = new Float32Array(n), hs = new Float32Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const s = Math.min(i * step, length);
    while (j < raw.length - 2 && cum[j + 1] < s) j++;
    const segLen = cum[j + 1] - cum[j] || 1;
    const u = (s - cum[j]) / segLen;
    const [ax, az] = raw[j];
    const [bx, bz] = raw[j + 1];
    xs[i] = ax + (bx - ax) * u;
    zs[i] = az + (bz - az) * u;
    hs[i] = Math.atan2(bx - ax, bz - az);
  }
  return { xs, zs, hs, step, length };
}

/** Pose at arc length s (clamped). */
export function trackPose(t: Track, s: number, out: TrackPose): TrackPose {
  const f = Math.max(0, Math.min(t.length, s)) / t.step;
  const i = Math.min(t.xs.length - 2, Math.floor(f));
  const u = f - i;
  out.x = t.xs[i] + (t.xs[i + 1] - t.xs[i]) * u;
  out.z = t.zs[i] + (t.zs[i + 1] - t.zs[i]) * u;
  let dh = t.hs[i + 1] - t.hs[i];
  if (dh > Math.PI) dh -= 2 * Math.PI;
  if (dh < -Math.PI) dh += 2 * Math.PI;
  out.h = t.hs[i] + dh * u;
  return out;
}

/** Arc length of the sample nearest (x, z). */
export function projectS(t: Track, x: number, z: number): number {
  let best = Infinity, bi = 0;
  for (let i = 0; i < t.xs.length; i++) {
    const d = (t.xs[i] - x) ** 2 + (t.zs[i] - z) ** 2;
    if (d < best) {
      best = d;
      bi = i;
    }
  }
  return Math.min(bi * t.step, t.length);
}

/** Pillar positions (arc lengths) about every `spacing` m, nudged so none stands within 7.5 m of a road junction. */
export function pillarSites(t: Track, spacing: number): number[] {
  const out: number[] = [];
  const p: TrackPose = { x: 0, z: 0, h: 0 };
  const clear = (s: number) => {
    trackPose(t, s, p);
    for (const n of ROAD_NODES.values()) if (Math.hypot(n.x - p.x, n.z - p.z) < 8) return false;
    return true;
  };
  for (let s = 2; s <= t.length - 1; s += spacing) {
    for (const off of [0, 3, -3, 6, -6, 9, -9]) {
      const ss = s + off;
      if (ss < 1 || ss > t.length - 1) continue;
      if (clear(ss)) {
        out.push(ss);
        break;
      }
    }
  }
  return out;
}
