import * as THREE from "three";
import { GEOMETRY_BOUNDS, type TwinGeometry } from "../../config";
import {
  BITUMEN,
  GLASS_PLINTH,
  MAST,
  METAL_TRIM,
  PLANT,
  PLINTH_STONE,
  STONE_TRIM,
  chooseMaterial,
  roofColour,
  seededRandom,
  wallColour,
} from "./facades";
import { offsetRing, pointInRing, ringArea, type Footprint, type P2 } from "./footprint";
import { MeshBuilder, type Surface, type V3 } from "./meshBuilder";
import { resolveBuildings, type PlacedBuilding } from "./overlaps";

type Building = TwinGeometry["buildings"][number];

/** Shared with the facade shader: storey height and window bay width in metres, per style. */
export const STOREY = { masonry: 3.3, glass: 3.9 };
export const BAY = { masonry: 2.7, glass: 1.8 };
/** Shopfront bays are this much wider than the storeys above. */
export const SHOP_BAY_SCALE = 4 / 3;

const CHUNKS_PER_SIDE = 4;
const TALL_RIM_HEIGHT = 90;

function surface(colour: THREE.Color, seed: number, lit: number, style: number, tone = 1): Surface {
  return { r: colour.r * tone, g: colour.g * tone, b: colour.b * tone, seed, lit, style };
}

function outwardNormal(a: P2, b: P2): V3 {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[1] - a[1]) / len, 0, -(b[0] - a[0]) / len];
}

interface Look {
  glass: boolean;
  storey: number;
  bay: number;
  minH: number;
  seed: number;
  wall: Surface;
  trim: Surface;
  shop: Surface;
  roof: Surface;
  plant: Surface;
  light: Surface;
  mast: Surface;
}

/** Walls from y0 to y1; window bays are stretched so every wall holds a whole number of them. */
function addWalls(b: MeshBuilder, ring: P2[], y0: number, y1: number, look: Look, s: Surface, shop: boolean, rnd: () => number) {
  const bay = look.bay * (shop ? SHOP_BAY_SCALE : 1);
  const v0 = y0 - look.minH;
  const v1 = y1 - look.minH;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const c = ring[(i + 1) % ring.length];
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (len < 0.3) continue;
    const bays = Math.max(1, Math.round(len / bay));
    const u0 = Math.floor(rnd() * 64) * bay;
    const u1 = u0 + bays * bay;
    b.quad([a[0], y0, a[1]], [a[0], y1, a[1]], [c[0], y1, c[1]], [c[0], y0, c[1]], s, outwardNormal(a, c), [
      [u0, v0],
      [u0, v1],
      [u1, v1],
      [u1, v0],
    ]);
  }
}

/** Horizontal slab lip that sticks out of the facade between `inner` and `outer`, from y0 to y1. */
function addLedge(b: MeshBuilder, inner: P2[], outer: P2[], y0: number, y1: number, s: Surface, underside: boolean) {
  for (let i = 0; i < inner.length; i++) {
    const j = (i + 1) % inner.length;
    const n = outwardNormal(inner[i], inner[j]);
    b.quad([outer[i][0], y0, outer[i][1]], [outer[i][0], y1, outer[i][1]], [outer[j][0], y1, outer[j][1]], [outer[j][0], y0, outer[j][1]], s, n);
    b.quad([inner[i][0], y1, inner[i][1]], [outer[i][0], y1, outer[i][1]], [outer[j][0], y1, outer[j][1]], [inner[j][0], y1, inner[j][1]], s, [0, 1, 0]);
    if (underside) {
      b.quad([inner[i][0], y0, inner[i][1]], [outer[i][0], y0, outer[i][1]], [outer[j][0], y0, outer[j][1]], [inner[j][0], y0, inner[j][1]], s, [0, -1, 0]);
    }
  }
}

/** Vertical fins that physically protrude from the facade at bay boundaries. */
function addPilasters(
  b: MeshBuilder,
  ring: P2[],
  y0: number,
  y1: number,
  bay: number,
  step: number,
  halfWidth: number,
  depth: number,
  s: Surface,
) {
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const c = ring[(i + 1) % ring.length];
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (len < 4.5) continue;
    const bays = Math.max(1, Math.round(len / bay));
    const dx = (c[0] - a[0]) / len;
    const dz = (c[1] - a[1]) / len;
    const n = outwardNormal(a, c);
    for (let k = step; k < bays; k += step) {
      const along = (k / bays) * len;
      const px = a[0] + dx * along;
      const pz = a[1] + dz * along;
      const lx = px - dx * halfWidth;
      const lz = pz - dz * halfWidth;
      const rx = px + dx * halfWidth;
      const rz = pz + dz * halfWidth;
      const ox = n[0] * depth;
      const oz = n[2] * depth;
      b.quad([lx + ox, y0, lz + oz], [lx + ox, y1, lz + oz], [rx + ox, y1, rz + oz], [rx + ox, y0, rz + oz], s, n);
      b.quad([lx, y0, lz], [lx, y1, lz], [lx + ox, y1, lz + oz], [lx + ox, y0, lz + oz], s, [-dx, 0, -dz]);
      b.quad([rx, y0, rz], [rx, y1, rz], [rx + ox, y1, rz + oz], [rx + ox, y0, rz + oz], s, [dx, 0, dz]);
    }
  }
}

/** Cornice, parapet and flat roof for the top of a tier. Returns the walkable roof ring. */
function addFlatRoof(b: MeshBuilder, ring: P2[], y: number, look: Look, small: boolean, rim: boolean): P2[] {
  const outer = offsetRing(ring, small ? 0.15 : 0.28);
  const inner = offsetRing(ring, -0.35);
  const top = y + (small ? 0.4 : 0.55);
  const lipLow = y - (small ? 0.2 : 0.5);
  const lightLow = top - 0.3;
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    const n = outwardNormal(ring[i], ring[j]);
    const oa: V3 = [outer[i][0], 0, outer[i][1]];
    const ob: V3 = [outer[j][0], 0, outer[j][1]];
    b.quad([oa[0], lipLow, oa[2]], [oa[0], lightLow, oa[2]], [ob[0], lightLow, ob[2]], [ob[0], lipLow, ob[2]], look.trim, n);
    b.quad([oa[0], lightLow, oa[2]], [oa[0], top, oa[2]], [ob[0], top, ob[2]], [ob[0], lightLow, ob[2]], rim ? look.light : look.trim, n);
    b.quad([outer[i][0], top, outer[i][1]], [inner[i][0], top, inner[i][1]], [inner[j][0], top, inner[j][1]], [outer[j][0], top, outer[j][1]], look.trim, [0, 1, 0]);
    b.quad([inner[i][0], y, inner[i][1]], [inner[i][0], top, inner[i][1]], [inner[j][0], top, inner[j][1]], [inner[j][0], y, inner[j][1]], look.roof, [-n[0], 0, -n[2]]);
    if (!small) {
      b.quad([ring[i][0], lipLow, ring[i][1]], [outer[i][0], lipLow, outer[i][1]], [outer[j][0], lipLow, outer[j][1]], [ring[j][0], lipLow, ring[j][1]], look.trim, [0, -1, 0]);
    }
  }
  b.cap(inner, y, look.roof);
  return inner;
}

/** Truncated hip roof: eaves overhang the wall, slopes climb to a flat (or ridge-thin) top. Null when the footprint can't take it. */
function addHippedRoof(b: MeshBuilder, ring: P2[], y: number, run: number, rise: number, look: Look, slope: Surface): P2[] | null {
  const eave = offsetRing(ring, 0.35);
  const top = offsetRing(ring, -run);
  if (ringArea(top) < 0.5) return null;
  const yRidge = y + rise;
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    const n = outwardNormal(ring[i], ring[j]);
    b.quad(
      [eave[i][0], y - 0.15, eave[i][1]],
      [top[i][0], yRidge, top[i][1]],
      [top[j][0], yRidge, top[j][1]],
      [eave[j][0], y - 0.15, eave[j][1]],
      slope,
      [n[0], 1, n[2]],
    );
  }
  b.cap(top, yRidge, slope);
  return top;
}

function addPrism(b: MeshBuilder, cx: number, cz: number, r0: number, y0: number, r1: number, y1: number, segments: number, s: Surface) {
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const mid = (a0 + a1) / 2;
    b.quad(
      [cx + Math.cos(a0) * r0, y0, cz + Math.sin(a0) * r0],
      [cx + Math.cos(a0) * r1, y1, cz + Math.sin(a0) * r1],
      [cx + Math.cos(a1) * r1, y1, cz + Math.sin(a1) * r1],
      [cx + Math.cos(a1) * r0, y0, cz + Math.sin(a1) * r0],
      s,
      [Math.cos(mid), 0, Math.sin(mid)],
    );
  }
}

function addRoofClutter(b: MeshBuilder, roof: P2[], y: number, fp: Footprint, height: number, mast: boolean, look: Look, rnd: () => number) {
  const area = ringArea(roof);
  if (area < 12) return;
  const safe = offsetRing(roof, -0.6);
  if (ringArea(safe) < 4) return;
  const tall = height > 60;
  const count = tall ? 1 + Math.floor(rnd() * 2) : height > 12 ? Math.floor(rnd() * (1 + Math.min(3, area / 200))) : rnd() < 0.3 ? 1 : 0;
  const bbox = safe.reduce(
    (m, [x, z]) => [Math.min(m[0], x), Math.max(m[1], x), Math.min(m[2], z), Math.max(m[3], z)],
    [Infinity, -Infinity, Infinity, -Infinity],
  );
  for (let n = 0; n < count; n++) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const hw = (1.6 + rnd() * (tall ? 3.5 : 3)) / 2;
      const hd = (1.4 + rnd() * 3) / 2;
      const x = bbox[0] + rnd() * (bbox[1] - bbox[0]);
      const z = bbox[2] + rnd() * (bbox[3] - bbox[2]);
      const reach = Math.hypot(hw, hd);
      const fits = [
        [reach, 0],
        [-reach, 0],
        [0, reach],
        [0, -reach],
        [0, 0],
      ].every(([ox, oz]) => pointInRing(x + ox, z + oz, safe));
      if (!fits) continue;
      b.box(x, z, fp.ax, fp.az, hw, hd, y, y + 1.1 + rnd() * (tall ? 1.8 : 1.5), look.plant);
      break;
    }
  }
  if (height > 12 && height < 70 && rnd() < 0.15) {
    const x = (bbox[0] + bbox[1]) / 2;
    const z = (bbox[2] + bbox[3]) / 2;
    if (pointInRing(x, z, safe) && pointInRing(x + 1.6, z, safe) && pointInRing(x - 1.6, z, safe)) {
      b.box(x, z, fp.ax, fp.az, 0.6, 0.6, y, y + 0.9, look.plant);
      addPrism(b, x, z, 1.3, y + 0.9, 1.3, y + 3.3, 8, look.plant);
      const lid: P2[] = Array.from({ length: 8 }, (_, i) => [x + Math.cos((i / 8) * Math.PI * 2) * 1.3, z + Math.sin((i / 8) * Math.PI * 2) * 1.3]);
      b.cap(lid, y + 3.3, look.plant);
    }
  }
  if (mast && height >= 120 && rnd() < (height >= 200 ? 0.8 : 0.3) && pointInRing(fp.cx, fp.cz, safe)) {
    const mastHeight = 7 + rnd() * 9;
    addPrism(b, fp.cx, fp.cz, 0.5, y, 0.25, y + mastHeight * 0.4, 6, look.mast);
    addPrism(b, fp.cx, fp.cz, 0.25, y + mastHeight * 0.4, 0.08, y + mastHeight, 6, look.mast);
    if (height >= 150) {
      b.box(fp.cx, fp.cz, 1, 0, 0.3, 0.3, y + mastHeight, y + mastHeight + 0.6, { ...look.light, style: 5 });
    }
  }
}

interface Tier {
  ring: P2[];
  from: number;
  to: number;
}

function planTiers(fp: Footprint, ring: P2[], floors: number, height: number, rnd: () => number): Tier[] {
  const single: Tier[] = [{ ring, from: 0, to: floors }];
  if (height < 45 || fp.width < 14 || floors < 8) return single;
  const step = Math.min(2.4, fp.width * 0.09);
  const cuts: number[] = [];
  const insets: number[] = [];
  if (height >= TALL_RIM_HEIGHT && fp.width >= 22 && rnd() < 0.7) {
    cuts.push(Math.round(floors * 0.62), Math.round(floors * 0.86));
    insets.push(step, step * 2);
  } else if (rnd() < 0.8) {
    cuts.push(Math.round(floors * 0.78));
    insets.push(step);
  }
  const tiers: Tier[] = [];
  let from = 0;
  let current = ring;
  const bounds = [...cuts, floors];
  bounds.forEach((to, i) => {
    if (to - from < 2) return;
    tiers.push({ ring: current, from, to });
    from = to;
    if (i < insets.length) {
      const next = offsetRing(ring, -insets[i]);
      current = ringArea(next) > fp.area * 0.45 ? next : current;
    }
  });
  return tiers.length ? tiers : single;
}

function addBuilding(b: MeshBuilder, placed: PlacedBuilding) {
  const { fp, minHeight: minH, height, part } = placed;
  const rnd = seededRandom(placed.lookSeed);
  const seed = rnd();
  const lookHeight = placed.lookHeight;
  const material = chooseMaterial(lookHeight, rnd());
  const glass = material === "glass";
  const storey = glass ? STOREY.glass : STOREY.masonry;
  const bay = glass ? BAY.glass : BAY.masonry;
  const floors = Math.max(1, part ? Math.ceil((height - minH) / storey - 0.2) : Math.round((height - minH) / storey));

  const lit = (glass ? 0.38 : lookHeight > 60 ? 0.26 : lookHeight > 25 ? 0.17 : 0.11) * (0.55 + rnd() * 0.9);
  const style = glass ? 2 : 1;
  const wallTone = wallColour(material, placed.colour, rnd, new THREE.Color());
  const trimTone = glass ? METAL_TRIM : new THREE.Color().copy(STONE_TRIM).lerp(wallTone, 0.25);
  const shopTone = glass ? GLASS_PLINTH : new THREE.Color().copy(PLINTH_STONE).lerp(wallTone, 0.35);
  const pitched =
    !part &&
    !glass &&
    height <= 14 &&
    floors <= 3 &&
    fp.convex &&
    fp.pts.length <= 8 &&
    fp.area < 600 &&
    fp.area / (fp.length * fp.width) > 0.8 &&
    rnd() < (height <= 9 ? 0.6 : 0.3);
  const mansard = !part && !pitched && !glass && floors >= 4 && floors <= 9 && fp.pts.length <= 12 && fp.width >= 9 && rnd() < 0.18;
  const roofTone = roofColour(pitched || mansard, rnd, new THREE.Color());

  const look: Look = {
    glass,
    storey,
    bay,
    minH,
    seed,
    wall: surface(wallTone, seed, lit, style),
    trim: surface(trimTone, seed, 0, 0, 0.9 + rnd() * 0.2),
    shop: surface(shopTone, seed, 0.55 + rnd() * 0.3, style + 0.5),
    roof: surface(roofTone, seed, 0, 0),
    plant: surface(PLANT, seed, 0, 0, 0.8 + rnd() * 0.4),
    light: surface(BITUMEN, seed, 0, 4),
    mast: surface(MAST, seed, 0, 0),
  };
  const slope = surface(roofTone, seed, 0, 0, 1.1);

  const base = offsetRing(fp.pts, 0.01 + Math.floor(seed * 6) * 0.025);
  const tiers = part ? [{ ring: base, from: 0, to: floors }] : planTiers(fp, base, floors, height, rnd);
  const plinth = !part && minH < 1 && floors >= 2 && (height > 40 || (height > 8 && rnd() < 0.6));
  const ledgeEvery = glass ? 4 : floors <= 6 ? 1 : floors <= 12 ? 2 : 3;
  const pilasterStep = glass ? (lookHeight > 40 ? 2 : 0) : rnd() < 0.55 && floors >= 3 ? 1 + Math.floor(rnd() * 2) : 0;
  const rim = lookHeight >= TALL_RIM_HEIGHT;

  let roofRing: P2[] | null = null;
  let roofY = minH;
  for (const [index, tier] of tiers.entries()) {
    const yBase = minH + tier.from * storey;
    const yTop = minH + tier.to * storey;
    const first = index === 0;
    let yWall = yBase;
    if (first && plinth) {
      const plinthRing = offsetRing(tier.ring, 0.22);
      const lipRing = offsetRing(tier.ring, 0.3);
      yWall = yBase + storey;
      addWalls(b, plinthRing, yBase, yWall, look, look.shop, true, rnd);
      addLedge(b, tier.ring, lipRing, yWall - 0.05, yWall + 0.12, look.trim, false);
    }
    addWalls(b, tier.ring, yWall, yTop, look, look.wall, false, rnd);

    const ledgeRing = offsetRing(tier.ring, glass ? 0.12 : 0.15);
    for (let f = tier.from + 1; f < tier.to; f++) {
      if (f % ledgeEvery !== 0 || (first && plinth && f === 1)) continue;
      const y = minH + f * storey;
      addLedge(b, tier.ring, ledgeRing, y - 0.11, y + 0.11, look.trim, false);
    }
    if (pilasterStep > 0) {
      addPilasters(b, tier.ring, yWall, yTop - 0.4, bay, pilasterStep, glass ? 0.07 : 0.2, glass ? 0.3 : 0.26, look.trim);
    }

    const last = index === tiers.length - 1;
    if (last && (pitched || mansard)) {
      const run = pitched ? Math.min(0.44 * fp.width, 5) : Math.min(1.8, fp.width * 0.3);
      const top = addHippedRoof(b, tier.ring, yTop, run, run * (pitched ? 0.62 : 1.35), look, slope);
      if (top) {
        const rise = run * (pitched ? 0.62 : 1.35);
        roofRing = top;
        roofY = yTop + rise;
        if (pitched && rnd() < 0.6 && pointInRing(fp.cx, fp.cz, top)) {
          b.box(fp.cx, fp.cz, fp.ax, fp.az, 0.35, 0.35, yTop + rise * 0.5, yTop + rise + 1.3, look.plant);
        }
        continue;
      }
    }
    if (last && placed.roof !== "open") {
      if (placed.roof === "partial") b.cap(tier.ring, yTop, look.roof);
      continue;
    }
    const small = height < 12;
    const inner = addFlatRoof(b, tier.ring, yTop, look, small, rim);
    if (last) {
      roofRing = inner;
      roofY = yTop;
    }
  }

  if (roofRing) addRoofClutter(b, roofRing, roofY, fp, lookHeight, placed.carriesMast, look, rnd);
}

export interface BuildingChunk {
  geometry: THREE.BufferGeometry;
  triangles: number;
}

/** Builds merged geometry for every building, bucketed into a grid so frustum culling still works. */
export function buildBuildingChunks(buildings: Building[]): BuildingChunk[] {
  const builders = Array.from({ length: CHUNKS_PER_SIDE * CHUNKS_PER_SIDE }, () => new MeshBuilder());
  const cellX = (GEOMETRY_BOUNDS.xMax - GEOMETRY_BOUNDS.xMin) / CHUNKS_PER_SIDE;
  const cellZ = (GEOMETRY_BOUNDS.zMax - GEOMETRY_BOUNDS.zMin) / CHUNKS_PER_SIDE;
  for (const placed of resolveBuildings(buildings)) {
    const { fp } = placed;
    const cx = Math.min(CHUNKS_PER_SIDE - 1, Math.max(0, Math.floor((fp.cx - GEOMETRY_BOUNDS.xMin) / cellX)));
    const cz = Math.min(CHUNKS_PER_SIDE - 1, Math.max(0, Math.floor((fp.cz - GEOMETRY_BOUNDS.zMin) / cellZ)));
    addBuilding(builders[cz * CHUNKS_PER_SIDE + cx], placed);
  }
  return builders
    .filter((builder) => builder.vertexCount > 0)
    .map((builder) => ({ geometry: builder.build(), triangles: builder.triangles }));
}
