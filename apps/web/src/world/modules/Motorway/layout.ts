// Pure placement logic for the Motorway module: where columns, gantries, signs, verges, trees, the viaduct and the
// service area go. No React, no three.js, so it is cheap to unit test.
import { RIVER, ZONES, inBox } from "../../config";
import { MW_JUNCTIONS, MW_MAIN, type Junction } from "../../districts/motorway";
import { ROAD_EDGES, getNode } from "../../roads";

// ---------------------------------------------------------------------------------------------------------
// River helpers

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az;
  const L2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2));
  return Math.hypot(ax + dx * t - px, az + dz * t - pz);
}

/** Distance from (x, z) to the river centre line. */
export function distToRiver(x: number, z: number) {
  const p = RIVER.points;
  let d = Infinity;
  for (let i = 0; i < p.length - 1; i++) d = Math.min(d, segDist(x, z, p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]));
  return d;
}

function cross(ax: number, az: number, bx: number, bz: number, cx: number, cz: number) {
  return (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
}

/** Does the segment a-b cross the river centre line? */
export function crossesRiver(a: { x: number; z: number }, b: { x: number; z: number }) {
  const p = RIVER.points;
  for (let i = 0; i < p.length - 1; i++) {
    const [cx, cz] = p[i];
    const [dx, dz] = p[i + 1];
    const d1 = cross(a.x, a.z, b.x, b.z, cx, cz);
    const d2 = cross(a.x, a.z, b.x, b.z, dx, dz);
    const d3 = cross(cx, cz, dx, dz, a.x, a.z);
    const d4 = cross(cx, cz, dx, dz, b.x, b.z);
    if (d1 * d2 < 0 && d3 * d4 < 0) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------------------

export function nightFactor(hour: number) {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 19 || h <= 5.5) return 1;
  if (h >= 17) return (h - 17) / 2;
  if (h < 7) return 1 - (h - 5.5) / 1.5;
  return 0;
}

/** Small seeded PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Seg {
  a: string;
  b: string;
  ax: number;
  az: number;
  bx: number;
  bz: number;
  len: number;
  /** unit direction a -> b */
  dx: number;
  dz: number;
  /** unit right-hand vector of travel a -> b (three.js, y up): (-dz, dx). The a->b carriageway is at -right. */
  rx: number;
  rz: number;
}

function seg(a: string, b: string): Seg {
  const na = getNode(a), nb = getNode(b);
  const len = Math.hypot(nb.x - na.x, nb.z - na.z) || 1;
  const dx = (nb.x - na.x) / len, dz = (nb.z - na.z) / len;
  return { a, b, ax: na.x, az: na.z, bx: nb.x, bz: nb.z, len, dx, dz, rx: -dz, rz: dx };
}

export const MAIN_SEGS: Seg[] = MW_MAIN.slice(1).map((id, i) => seg(MW_MAIN[i], id));

/** Main-carriageway edges carried over the river on the viaduct. */
export const VIADUCT: Seg[] = (() => {
  const crossing = MAIN_SEGS.map((s) => crossesRiver({ x: s.ax, z: s.az }, { x: s.bx, z: s.bz }));
  // the crossing edge plus its neighbours, so the deck reaches dry land on both banks
  return MAIN_SEGS.filter((_, i) => crossing[i] || crossing[i - 1] || crossing[i + 1]);
})();
const onViaduct = (x: number, z: number) => distToRiver(x, z) < RIVER.width / 2 + 22;

/** Lighting columns in the central reservation: at every node and edge midpoint. yaw = edge heading. */
export const COLUMNS: { x: number; z: number; yaw: number; rx: number; rz: number }[] = MAIN_SEGS.flatMap((s, i) => {
  const out = [{ x: s.ax + s.dx * s.len * 0.5, z: s.az + s.dz * s.len * 0.5, yaw: Math.atan2(s.dx, s.dz), rx: s.rx, rz: s.rz }];
  if (i > 0) out.unshift({ x: s.ax, z: s.az, yaw: Math.atan2(s.dx, s.dz), rx: s.rx, rz: s.rz });
  return out;
});

// ---------------------------------------------------------------------------------------------------------
// Gantries

export interface Panel {
  x: number;
  y: number;
  z: number;
  /** rotation about y so the panel's front (+z of a PlaneGeometry) faces approaching traffic */
  yaw: number;
}

export interface GantrySite {
  x: number;
  z: number;
  /** unit vector across the road (the legs sit at +-LEG_OFFSET along it) */
  rx: number;
  rz: number;
  panels: Panel[];
  junction?: Junction;
}

export const LEG_OFFSET = 8.4;
const PANEL_Y = 7.4;

/** Panel over the carriageway carrying traffic along `s` (a -> b), facing it. */
function panelFor(x: number, z: number, s: Seg, dir: 1 | -1): Panel {
  // traffic along dir*d drives on the left: offset -dir*right
  const o = -dir * 3.1;
  return {
    x: x + s.rx * o - s.dx * dir * 0.6,
    y: PANEL_Y,
    z: z + s.rz * o - s.dz * dir * 0.6,
    yaw: Math.atan2(-s.dx * dir, -s.dz * dir),
  };
}

/** Junction sign gantries: ~100 m before each junction, one per approaching carriageway. */
export const JUNCTION_GANTRIES: GantrySite[] = (() => {
  const out: GantrySite[] = [];
  for (const j of MW_JUNCTIONS) {
    const k = MW_MAIN.indexOf(j.id);
    for (const dir of [1, -1] as const) {
      const g = k - 2 * dir; // gantry node
      if (g < 0 || g >= MW_MAIN.length) continue;
      const s = dir === 1 ? MAIN_SEGS[g] : MAIN_SEGS[g - 1]; // the edge from the gantry towards the junction (a->b = +d)
      if (!s) continue;
      const n = getNode(MW_MAIN[g]);
      if (onViaduct(n.x, n.z)) continue;
      out.push({ x: n.x, z: n.z, rx: s.rx, rz: s.rz, panels: [panelFor(n.x, n.z, s, dir)], junction: j });
    }
  }
  return out;
})();

/** Smart-motorway variable speed signs: both carriageways, spread around the loop away from other gantries. */
export const VMS_GANTRIES: GantrySite[] = (() => {
  const taken = new Set(JUNCTION_GANTRIES.map((g) => `${g.x},${g.z}`));
  const out: GantrySite[] = [];
  const N = MW_MAIN.length;
  for (const f of [0.14, 0.33, 0.52, 0.7, 0.88]) {
    for (let off = 0; off < 6; off++) {
      const k = Math.round(N * f) + off;
      const s = MAIN_SEGS[k];
      if (!s) break;
      const near = [-1, 0, 1].some((d) => {
        const id = MW_MAIN[k + d];
        if (!id) return false;
        const n = getNode(id);
        return taken.has(`${n.x},${n.z}`) || id.startsWith("mw_j_");
      });
      if (near || onViaduct(s.ax, s.az)) continue;
      out.push({ x: s.ax, z: s.az, rx: s.rx, rz: s.rz, panels: [panelFor(s.ax, s.az, s, 1), panelFor(s.ax, s.az, s, -1)] });
      break;
    }
  }
  return out;
})();

// ---------------------------------------------------------------------------------------------------------
// Roadside: SOS phones, marker posts, verges, trees

const OTHER_ROADS = [...ROAD_EDGES.values()]
  .filter((e) => !(MW_MAIN.includes(e.a) && MW_MAIN.includes(e.b)))
  .map((e) => {
    const a = getNode(e.a), b = getNode(e.b);
    return [a.x, a.z, b.x, b.z, e.kind === "highway" ? 6 : e.kind === "country" ? 3 : 4] as const;
  });
function clearOfRoads(x: number, z: number, margin: number) {
  for (const [ax, az, bx, bz, half] of OTHER_ROADS) {
    if (Math.abs(x - ax) > 200 && Math.abs(x - bx) > 200) continue;
    if (segDist(x, z, ax, az, bx, bz) < half + margin) return false;
  }
  return true;
}

export interface Post {
  x: number;
  z: number;
  yaw: number;
}

/** SOS phones every ~4 edges on both hard shoulders, marker posts every half edge. */
export const SOS: Post[] = [];
export const MARKERS: Post[] = [];
MAIN_SEGS.forEach((s, i) => {
  const yaw = Math.atan2(s.dx, s.dz);
  for (const side of [1, -1]) {
    for (const t of [0.25, 0.75]) {
      const x = s.ax + s.dx * s.len * t + s.rx * side * 7.3;
      const z = s.az + s.dz * s.len * t + s.rz * side * 7.3;
      if (clearOfRoads(x, z, 1) && !onViaduct(x, z)) MARKERS.push({ x, z, yaw: yaw + (side > 0 ? -Math.PI / 2 : Math.PI / 2) });
    }
    if (i % 4 === 2) {
      const x = s.ax + s.dx * s.len * 0.5 + s.rx * side * 7.9;
      const z = s.az + s.dz * s.len * 0.5 + s.rz * side * 7.9;
      if (clearOfRoads(x, z, 1.5) && !onViaduct(x, z)) SOS.push({ x, z, yaw: yaw + (side > 0 ? -Math.PI / 2 : Math.PI / 2) });
    }
  }
});

export interface Verge {
  x: number;
  z: number;
  yaw: number;
  len: number;
  side: 1 | -1;
}

/** Grassy embankment strips along both sides of the main carriageway, broken at junctions and the viaduct. */
export const VERGES: Verge[] = [];
MAIN_SEGS.forEach((s) => {
  for (const side of [1, -1] as const) {
    const ok = [0, 0.5, 1].every((t) => {
      const x = s.ax + s.dx * s.len * t + s.rx * side * 12;
      const z = s.az + s.dz * s.len * t + s.rz * side * 12;
      return clearOfRoads(x, z, 5) && !onViaduct(x, z);
    });
    if (!ok) continue;
    VERGES.push({
      x: (s.ax + s.bx) / 2 + s.rx * side * 12,
      z: (s.az + s.bz) / 2 + s.rz * side * 12,
      yaw: Math.atan2(s.dx, s.dz),
      len: s.len + 2,
      side,
    });
  }
});

export interface Tree {
  x: number;
  z: number;
  s: number; // scale
  c: number; // colour index 0..1
}

export const SERVICES_BOX = { minX: -790, maxX: -640, minZ: 388, maxZ: 558 };
const ZONE_BOXES = Object.values(ZONES);

/** Trees on the embankments (outside every district zone, off the water, clear of all other roads). */
export const TREES: Tree[] = (() => {
  const r = rng(2525);
  const out: Tree[] = [];
  for (const s of MAIN_SEGS) {
    for (const side of [1, -1]) {
      const n = 2 + Math.floor(r() * 4);
      for (let k = 0; k < n; k++) {
        const t = r();
        const off = 12 + r() * 14;
        const x = s.ax + s.dx * s.len * t + s.rx * side * off;
        const z = s.az + s.dz * s.len * t + s.rz * side * off;
        if (Math.abs(x) > 1090 || Math.abs(z) > 1090) continue;
        if (distToRiver(x, z) < RIVER.width / 2 + 6) continue;
        if (!clearOfRoads(x, z, 4)) continue;
        if (ZONE_BOXES.some((b) => inBox(b, x, z, 2))) continue;
        if (inBox(SERVICES_BOX, x, z, 6)) continue;
        out.push({ x, z, s: 0.7 + r() * 0.7, c: r() });
      }
    }
  }
  // a few around the service area perimeter
  for (let k = 0; k < 40; k++) {
    const t = k / 40;
    const per = 2 * (SERVICES_BOX.maxX - SERVICES_BOX.minX) + 2 * (SERVICES_BOX.maxZ - SERVICES_BOX.minZ);
    let d = t * per;
    const w = SERVICES_BOX.maxX - SERVICES_BOX.minX, h = SERVICES_BOX.maxZ - SERVICES_BOX.minZ;
    let x: number, z: number;
    if (d < w) [x, z] = [SERVICES_BOX.minX + d, SERVICES_BOX.minZ - 6];
    else if ((d -= w) < h) [x, z] = [SERVICES_BOX.maxX + 6, SERVICES_BOX.minZ + d];
    else if ((d -= h) < w) [x, z] = [SERVICES_BOX.maxX - d, SERVICES_BOX.maxZ + 6];
    else [x, z] = [SERVICES_BOX.minX - 6, SERVICES_BOX.maxZ - (d - w)];
    if (!clearOfRoads(x, z, 4)) continue;
    out.push({ x, z, s: 0.8 + r() * 0.5, c: r() });
  }
  return out;
})();

// ---------------------------------------------------------------------------------------------------------
// Service area (around the mw_svc_* roads)


export const SERVICES = {
  canopy: { x: -730, z: 412, w: 36, d: 18, h: 5.6 },
  pumps: [-744, -732, -720].flatMap((x) => [
    { x, z: 406 },
    { x, z: 418 },
  ]),
  kiosk: { x: -730, z: 394, w: 18, d: 8, h: 4.2 },
  totem: { x: -770, z: 400 },
  foodCourt: { x: -692, z: 452, w: 46, d: 20, h: 7.5 },
  carPark: { minX: -745, maxX: -652, minZ: 464, maxZ: 492 },
  lorryPark: { minX: -786, maxX: -684, minZ: 503, maxZ: 554 },
};

/** Parked cars: two rows facing the car-park road (z = 478). */
export const PARKED_CARS: Post[] = (() => {
  const r = rng(77);
  const out: Post[] = [];
  for (let x = -740; x <= -656; x += 3.4) {
    if (r() < 0.78) out.push({ x, z: 468.5, yaw: 0 });
    if (r() < 0.6) out.push({ x, z: 487.5, yaw: Math.PI });
  }
  return out;
})();

/** Parked lorries: angled rows either side of the lorry-park road (z = 528). */
export const PARKED_LORRIES: Post[] = (() => {
  const r = rng(91);
  const out: Post[] = [];
  for (let x = -776; x <= -694; x += 7.5) {
    if (r() < 0.8) out.push({ x, z: 514, yaw: 0.35 });
    if (r() < 0.7) out.push({ x: x + 3, z: 543, yaw: Math.PI + 0.35 });
  }
  return out;
})();
