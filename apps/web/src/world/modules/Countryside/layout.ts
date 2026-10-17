// Pure layout for the Countryside module: fields, hedgerows, walls, farmsteads, hills, pastures,
// allotments, forests and the tree scatter across all open land. Seeded, so the city looks the
// same every load. Everything that must avoid roads checks the live road graph at load (district
// roads are merged into it), plus the motorway polyline in case its nodes aren't in yet.
import { HIGHWAY_RING, MOTORWAY, RIVER, WATER_X, WORLD_SIZE, ZONES, inBox, type Box } from "../../config";
import { ROAD_EDGES, ROAD_NODES } from "../../roads";

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

export type Seg = [ax: number, az: number, bx: number, bz: number];

export function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + dx * t - px;
  const qz = az + dz * t - pz;
  return Math.sqrt(qx * qx + qz * qz);
}

const polylineSegs = (pts: readonly [number, number][]): Seg[] =>
  pts.slice(1).map((p, i) => [pts[i][0], pts[i][1], p[0], p[1]]);

/** Every road edge as a centre-line segment (plus the motorway polyline), computed once. */
export const ROAD_SEGS: Seg[] = [
  ...[...ROAD_EDGES.values()].map((e): Seg => {
    const a = ROAD_NODES.get(e.a)!;
    const b = ROAD_NODES.get(e.b)!;
    return [a.x, a.z, b.x, b.z];
  }),
  ...polylineSegs(MOTORWAY.points),
];

export function roadDistanceExact(x: number, z: number, segs: readonly Seg[] = ROAD_SEGS) {
  let best = Infinity;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const d = distToSegment(x, z, s[0], s[1], s[2], s[3]);
    if (d < best) best = d;
  }
  return best;
}

// Spatial hash so the big-world scatter stays fast however many district roads there are.
// Distances up to REACH are exact; beyond that roadDistance() may return Infinity ("far").
const CELL = 32;
const REACH = 30;
const cellKey = (ix: number, iz: number) => (ix + 1000) * 4096 + (iz + 1000);
const roadCells = new Map<number, number[]>();
ROAD_SEGS.forEach((s, i) => {
  const x0 = Math.floor((Math.min(s[0], s[2]) - REACH) / CELL);
  const x1 = Math.floor((Math.max(s[0], s[2]) + REACH) / CELL);
  const z0 = Math.floor((Math.min(s[1], s[3]) - REACH) / CELL);
  const z1 = Math.floor((Math.max(s[1], s[3]) + REACH) / CELL);
  for (let ix = x0; ix <= x1; ix++)
    for (let iz = z0; iz <= z1; iz++) {
      // skip cells the segment doesn't come within REACH of
      const cx = (ix + 0.5) * CELL;
      const cz = (iz + 0.5) * CELL;
      if (distToSegment(cx, cz, s[0], s[1], s[2], s[3]) > REACH + CELL * 0.71) continue;
      const k = cellKey(ix, iz);
      const list = roadCells.get(k);
      if (list) list.push(i);
      else roadCells.set(k, [i]);
    }
});

/** Distance to the nearest road centre line. Exact up to 30 m; may be Infinity when farther. */
export function roadDistance(x: number, z: number) {
  const list = roadCells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (!list) return Infinity;
  let best = Infinity;
  for (let i = 0; i < list.length; i++) {
    const s = ROAD_SEGS[list[i]];
    const d = distToSegment(x, z, s[0], s[1], s[2], s[3]);
    if (d < best) best = d;
  }
  return best;
}

const RIVER_SEGS = polylineSegs(RIVER.points);
/** River channel half-width plus a 15 m bank margin. */
export const RIVER_CLEAR = RIVER.width / 2 + 15;
export function riverDistance(x: number, z: number) {
  return roadDistanceExact(x, z, RIVER_SEGS);
}

export const WORLD_HALF = WORLD_SIZE / 2 - 10;

/** Land that belongs to nobody's zone: in the world, out of the sea, off the river and its banks. */
export function openLand(x: number, z: number) {
  return (
    Math.abs(x) <= WORLD_HALF &&
    Math.abs(z) <= WORLD_HALF &&
    x <= WATER_X - 10 &&
    !inAirport(x, z) &&
    riverDistance(x, z) >= RIVER_CLEAR
  );
}

// --- Static farm features (positions checked against roads in layout.test.ts) ------------------

export interface Circle {
  x: number;
  z: number;
  r: number;
}

export const FARM = {
  yard: { x: -304, z: 2, r: 20 },
  farmhouse: { x: -318, z: -8, rot: 0.15 },
  barn: { x: -292, z: 10, rot: -0.1 },
  silo: { x: -296, z: -10 },
  pond: { x: -307, z: 42, r: 8 },
  windmill: { x: -262, z: 104 },
  tractor: { x: -303, z: 14, rot: 0.9 },
} as const;

/** Far south-west farmland, between Old Town / Southbank and the motorway. */
export const FARMLAND_SW: Box = { minX: -862, maxX: -452, minZ: 296, maxZ: 742 };

/** Wind turbine spots: four in the old fields, two on the western hills, three in the SW farmland. */
export const TURBINE_SPOTS: [number, number][] = [
  [-352, -110],
  [-350, -58],
  [-352, 58],
  [-350, 110],
  [-385, -175],
  [-382, 182],
  [-842, 420],
  [-842, 520],
  [-842, 620],
];

/** The airport (runway along x) plus a 20 m clear margin: no trees, hills or props in here. */
export const AIRPORT_MARGIN = 20;
export function inAirport(x: number, z: number, pad = 0) {
  return inBox(ZONES.airport, x, z, AIRPORT_MARGIN + pad);
}

/** Tall props (wind turbines) must stay out of the airport's quadrant. */
export const tallPropAllowed = (x: number, z: number) => !(x < -200 && z < -200);

// every zone except ours; the airport is handled separately with a wider margin
const OTHER_ZONES: Box[] = Object.entries(ZONES)
  .filter(([name]) => name !== "countryside" && name !== "airport")
  .map(([, b]) => b);

const inOtherZone = (x: number, z: number, margin: number) => OTHER_ZONES.some((b) => inBox(b, x, z, margin));

/** Farmsteads in the SW farmland. Candidates are dropped if a road or zone gets in the way. */
export interface Farmstead {
  x: number;
  z: number;
  rot: number;
}
const FARMSTEAD_CANDIDATES: Farmstead[] = [
  { x: -760, z: 400, rot: 0.3 },
  { x: -560, z: 660, rot: -0.4 },
  { x: -640, z: 500, rot: 1.2 },
  { x: -520, z: 380, rot: 0.1 },
];
const FARMSTEAD_R = 24;

export function makeFarmsteads(): Farmstead[] {
  return FARMSTEAD_CANDIDATES.filter(
    (f) => roadDistanceExact(f.x, f.z) > FARMSTEAD_R + 6 && !inOtherZone(f.x, f.z, FARMSTEAD_R) && openLand(f.x, f.z),
  ).slice(0, 3);
}

// --- Hills along the far west edge of the old countryside --------------------------------------

/** An ellipsoid hill centred on the ground: horizontal radius r, peak height h. */
export interface Hill {
  x: number;
  z: number;
  r: number;
  h: number;
}

function circleTouchesBox(x: number, z: number, r: number, b: Box, m: number) {
  const cx = Math.max(b.minX - m, Math.min(x, b.maxX + m));
  const cz = Math.max(b.minZ - m, Math.min(z, b.maxZ + m));
  return (x - cx) ** 2 + (z - cz) ** 2 < r * r;
}

function hillAllowed(h: Hill) {
  if (circleTouchesBox(h.x, h.z, h.r, ZONES.airport, AIRPORT_MARGIN)) return false;
  if (OTHER_ZONES.some((b) => circleTouchesBox(h.x, h.z, h.r, b, 6))) return false;
  if (circleTouchesBox(h.x, h.z, h.r, FARMLAND_SW, 0)) return false;
  if (roadDistanceExact(h.x, h.z) < h.r + 3) return false;
  return riverDistance(h.x, h.z) > h.r + RIVER_CLEAR;
}

export function makeHills(seed = 7): Hill[] {
  const rand = mulberry32(seed);
  const hills: Hill[] = [];
  // front row: edge stays west of x = -357 so the farm lane at x = -345 is clear
  for (let z = -410; z <= 410; z += 38 + rand() * 14) {
    const r = 26 + rand() * 18;
    const x = -357 - r - rand() * 10;
    const h = { x, z, r, h: 9 + rand() * 13 };
    if (hillAllowed(h)) hills.push(h);
  }
  // back row: bigger, further out
  for (let z = -440; z <= 440; z += 60 + rand() * 25) {
    const r = 50 + rand() * 30;
    const h = { x: -400 - r * 0.45 - rand() * 20, z, r, h: 22 + rand() * 20 };
    if (hillAllowed(h)) hills.push(h);
  }
  return hills;
}

export function hillHeight(hills: readonly Hill[], x: number, z: number) {
  let y = 0;
  for (const h of hills) {
    const d2 = ((x - h.x) ** 2 + (z - h.z) ** 2) / (h.r * h.r);
    if (d2 < 1) y = Math.max(y, h.h * Math.sqrt(1 - d2));
  }
  return y;
}

// --- Wind turbines ----------------------------------------------------------------------------

export interface Turbine {
  x: number;
  z: number;
  y: number; // base height (on a hill or 0)
  scale: number;
  phase: number;
}

export function makeTurbines(hills: readonly Hill[]): Turbine[] {
  return TURBINE_SPOTS.filter(
    ([x, z]) => roadDistanceExact(x, z) > 10 && tallPropAllowed(x, z) && !inAirport(x, z, 20) && openLand(x, z),
  ).map(([x, z], i) => ({
    x,
    z,
    y: Math.max(0, hillHeight(hills, x, z) - 0.6),
    scale: (x < -380 && Math.abs(z) > 150) || x < -800 ? 1.1 : 1,
    phase: i * 1.7,
  }));
}

// --- Fields, hedgerows, dry-stone walls ---------------------------------------------------------

export type Crop = "wheat" | "rapeseed" | "grass" | "barley" | "veg" | "ploughed" | "stubble";

export const CROP_COLORS: Record<Crop, [string, string]> = {
  wheat: ["#e9c35a", "#dcb049"],
  rapeseed: ["#f5d91e", "#e8c814"],
  grass: ["#7dc457", "#74bb4f"],
  barley: ["#c9d36a", "#b7c25b"],
  veg: ["#4f9e3a", "#7b5a3c"],
  ploughed: ["#8a5f3c", "#77502f"],
  stubble: ["#e2cf8a", "#d6c27a"],
};
export const CROP_HEIGHT: Record<Crop, [number, number]> = {
  wheat: [0.55, 0.5],
  rapeseed: [0.5, 0.45],
  grass: [0.07, 0.07],
  barley: [0.45, 0.42],
  veg: [0.35, 0.1],
  ploughed: [0.16, 0.08],
  stubble: [0.1, 0.1],
};

export interface Stripe {
  x: number;
  z: number;
  sx: number;
  sz: number;
  h: number;
  color: string;
}

export interface LinePiece {
  x: number;
  z: number;
  len: number;
  alongX: boolean;
  kind: "hedge" | "wall";
}

export interface Plot extends Box {
  crop: Crop;
  okArea: number; // count of clear sample points (how much of the plot is usable)
}

export interface TreeSpot {
  x: number;
  y: number;
  z: number;
  species: 0 | 1 | 2; // 0 round oak, 1 conifer, 2 poplar
  scale: number;
  rot: number;
  shade: number; // 0..1 colour variation
}

export interface Pasture {
  box: Box;
  animal: "sheep" | "cow";
  count: number;
  spots: [number, number][];
}

export interface FieldLayout {
  plots: Plot[];
  stripes: Stripe[];
  pieces: LinePiece[];
  hedgeTrees: TreeSpot[];
  pastures: Pasture[];
  bales: { x: number; z: number; rot: number }[];
  yard: Stripe[];
}

const inCircles = (cs: readonly Circle[], x: number, z: number, pad = 0) =>
  cs.some((c) => (x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + pad) ** 2);

/** Walk a line in `step` increments, returning runs where ok() holds. */
function runs(from: number, to: number, step: number, ok: (t: number) => boolean) {
  const out: [number, number][] = [];
  let start: number | null = null;
  for (let t = from; t <= to + 1e-6; t += step) {
    const good = ok(t);
    if (good && start === null) start = t;
    if (!good && start !== null) {
      out.push([start, t - step]);
      start = null;
    }
  }
  if (start !== null) out.push([start, to]);
  return out;
}

interface FieldOpts {
  region: Box;
  plotW: number;
  plotD: number;
  gap: number;
  exclusions: Circle[];
  /** extra land check (zones, river) */
  landOk: (x: number, z: number) => boolean;
  pastures: { animal: "sheep" | "cow"; count: number }[];
  yard?: Circle;
  pieceLen: number;
  seed: number;
}

function layFields(o: FieldOpts): FieldLayout {
  const rand = mulberry32(o.seed);
  const { region, plotW, plotD, gap } = o;
  const cols = Math.floor((region.maxX - region.minX - 4 + gap) / (plotW + gap));
  const rows = Math.floor((region.maxZ - region.minZ - 4 + gap) / (plotD + gap));
  const clear = (x: number, z: number, roadPad = 7) =>
    roadDistance(x, z) >= roadPad && !inCircles(o.exclusions, x, z) && o.landOk(x, z);

  const crops: Crop[] = ["wheat", "rapeseed", "barley", "veg", "ploughed", "wheat", "grass", "rapeseed", "barley"];
  const plots: Plot[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const minX = region.minX + 2 + c * (plotW + gap);
      const minZ = region.minZ + 2 + r * (plotD + gap);
      let okArea = 0;
      for (let x = minX + 1; x < minX + plotW; x += 2) for (let z = minZ + 1; z < minZ + plotD; z += 2) if (clear(x, z)) okArea++;
      plots.push({ minX, maxX: minX + plotW, minZ, maxZ: minZ + plotD, crop: crops[Math.floor(rand() * crops.length)], okArea });
    }
  const fullArea = Math.ceil(plotW / 2) * Math.ceil(plotD / 2);

  // Pastures: the emptiest-of-roads plots (fully clear ones first)
  const ranked = [...plots].sort((a, b) => b.okArea - a.okArea);
  const pastureIdx = ranked.slice(0, o.pastures.length);
  pastureIdx.forEach((p) => (p.crop = "grass"));
  // one harvested field with round bales
  const stubble = ranked.find((p) => !pastureIdx.includes(p) && p.okArea > fullArea * 0.55);
  if (stubble) stubble.crop = "stubble";

  const stripes: Stripe[] = [];
  const W = 2.5;
  for (const p of plots) {
    if (p.okArea < 8) continue;
    const alongX = rand() < 0.5;
    const [c0, c1] = CROP_COLORS[p.crop];
    const [h0, h1] = CROP_HEIGHT[p.crop];
    const across = alongX ? p.maxZ - p.minZ : p.maxX - p.minX;
    const n = Math.floor(across / W);
    for (let k = 0; k < n; k++) {
      const off = (alongX ? p.minZ : p.minX) + (k + 0.5) * W;
      const lo = alongX ? p.minX : p.minZ;
      const hi = alongX ? p.maxX : p.maxZ;
      for (const [a, b] of runs(lo + 0.5, hi - 0.5, 1, (t) => (alongX ? clear(t, off) : clear(off, t)))) {
        const len = b - a + 1;
        if (len < 3) continue;
        const mid = (a + b) / 2;
        const even = k % 2 === 0;
        stripes.push({
          x: alongX ? mid : off,
          z: alongX ? off : mid,
          sx: alongX ? len : W,
          sz: alongX ? W : len,
          h: even ? h0 : h1,
          color: even ? c0 : c1,
        });
      }
    }
  }

  // Hedges and walls on grid lines in the gaps between plots
  const pieces: LinePiece[] = [];
  const hedgeTrees: TreeSpot[] = [];
  const L = o.pieceLen;
  const line = (alongX: boolean, fixed: number, t0: number, t1: number, kind: LinePiece["kind"]) => {
    for (const [a, b] of runs(t0, t1, L, (t) => (alongX ? clear(t, fixed, 6.5) : clear(fixed, t, 6.5)))) {
      for (let t = a; t <= b; t += L) {
        const [x, z] = alongX ? [t, fixed] : [fixed, t];
        pieces.push({ x, z, len: L + 0.1, alongX, kind });
        if (kind === "hedge" && rand() < 0.07 * (L / 2.5))
          hedgeTrees.push({ x, y: 0, z, species: 0, scale: 0.9 + rand() * 0.5, rot: rand() * 6.28, shade: rand() });
      }
    }
  };
  const g2 = gap / 2;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const p = plots[r * cols + c];
      const isPasture = pastureIdx.includes(p);
      const kind = (): LinePiece["kind"] => (isPasture || rand() < 0.3 ? "wall" : "hedge");
      line(false, p.minX - g2, p.minZ - g2, p.maxZ + g2, kind());
      line(true, p.minZ - g2, p.minX - g2, p.maxX + g2, kind());
      if (c === cols - 1) line(false, p.maxX + g2, p.minZ - g2, p.maxZ + g2, kind());
      if (r === rows - 1) line(true, p.maxZ + g2, p.minX - g2, p.maxX + g2, kind());
    }

  const pastures: Pasture[] = pastureIdx.map((p, i) => {
    const spots: [number, number][] = [];
    for (let k = 0; k < 400 && spots.length < 60; k++) {
      const x = p.minX + 2 + rand() * (p.maxX - p.minX - 4);
      const z = p.minZ + 2 + rand() * (p.maxZ - p.minZ - 4);
      if (clear(x, z, 8)) spots.push([x, z]);
    }
    return { box: { minX: p.minX, maxX: p.maxX, minZ: p.minZ, maxZ: p.maxZ }, ...o.pastures[i], spots };
  });

  const bales: FieldLayout["bales"] = [];
  if (stubble)
    for (let k = 0; k < 60 && bales.length < 12; k++) {
      const x = stubble.minX + 3 + rand() * (stubble.maxX - stubble.minX - 6);
      const z = stubble.minZ + 3 + rand() * (stubble.maxZ - stubble.minZ - 6);
      if (clear(x, z, 8) && bales.every((b) => (b.x - x) ** 2 + (b.z - z) ** 2 > 16)) bales.push({ x, z, rot: rand() * 3.14 });
    }

  // Gravel farmyard inside the yard circle, kept off the lanes
  const yard: Stripe[] = [];
  const Y = o.yard;
  if (Y)
    for (let z = Y.z - Y.r + 1; z < Y.z + Y.r; z += 2) {
      for (const [a, b] of runs(Y.x - Y.r, Y.x + Y.r, 1, (x) => (x - Y.x) ** 2 + (z - Y.z) ** 2 < Y.r * Y.r && roadDistance(x, z) >= 5.5)) {
        if (b - a < 1) continue;
        yard.push({ x: (a + b) / 2, z, sx: b - a + 1, sz: 2, h: 0.05, color: "#b49d72" });
      }
    }

  return { plots, stripes, pieces, hedgeTrees, pastures: pastures.filter((p) => p.spots.length > 10), bales, yard };
}

const turbineCircles = (r: number): Circle[] => TURBINE_SPOTS.map(([x, z]) => ({ x, z, r }));

/** Exclusion circles for crops and trees in the old countryside (farm, pond, windmill, turbines). */
export const FARM_EXCLUSIONS: Circle[] = [
  ...turbineCircles(3),
  { x: FARM.yard.x, z: FARM.yard.z, r: FARM.yard.r },
  { x: FARM.pond.x, z: FARM.pond.z, r: FARM.pond.r + 3 },
  { x: FARM.windmill.x, z: FARM.windmill.z, r: 7 },
];

/** The original countryside zone's fields. */
export function makeFields(seed = 11): FieldLayout {
  return layFields({
    region: ZONES.countryside,
    plotW: 26,
    plotD: 35,
    gap: 4,
    exclusions: FARM_EXCLUSIONS,
    landOk: () => true,
    pastures: [
      { animal: "sheep", count: 12 },
      { animal: "cow", count: 9 },
      { animal: "sheep", count: 12 },
    ],
    yard: FARM.yard,
    pieceLen: 2.5,
    seed,
  });
}

/** Bigger fields across the far south-west farmland, around a few farmsteads. */
export function makeSouthWestFields(farmsteads: readonly Farmstead[], seed = 31): FieldLayout {
  const f = layFields({
    region: FARMLAND_SW,
    plotW: 38,
    plotD: 46,
    gap: 5,
    exclusions: [...turbineCircles(3), ...farmsteads.map((s) => ({ x: s.x, z: s.z, r: FARMSTEAD_R }))],
    landOk: (x, z) => !inOtherZone(x, z, 6) && openLand(x, z),
    pastures: [
      { animal: "sheep", count: 10 },
      { animal: "cow", count: 8 },
      { animal: "sheep", count: 10 },
    ],
    pieceLen: 4,
    seed,
  });
  // gravel yards around each farmstead
  for (const s of farmsteads) {
    const R = FARMSTEAD_R - 4;
    for (let z = s.z - R + 1; z < s.z + R; z += 2)
      for (const [a, b] of runs(s.x - R, s.x + R, 1, (x) => (x - s.x) ** 2 + (z - s.z) ** 2 < R * R && roadDistance(x, z) >= 5.5))
        if (b - a >= 1) f.yard.push({ x: (a + b) / 2, z, sx: b - a + 1, sz: 2, h: 0.05, color: "#b49d72" });
  }
  return f;
}

// --- Allotments on the city fringe --------------------------------------------------------------

export interface AllotmentPlot {
  x: number;
  z: number;
  w: number; // along x
  d: number; // along z
  crop: number; // 0..1, picks a veg colour
  shed: string | null; // shed colour, or none
  rowsAlongX: boolean;
}

export interface Allotments {
  sites: Box[];
  plots: AllotmentPlot[];
  hedges: LinePiece[];
}

const ALLOTMENT_SITES: [number, number][] = [
  [-300, 185],
  [-420, 190],
  [-165, -300],
  [150, 300],
];

export function makeAllotments(seed = 53): Allotments {
  const rand = mulberry32(seed);
  const W = 50;
  const D = 34;
  const sites: Box[] = [];
  const plots: AllotmentPlot[] = [];
  const hedges: LinePiece[] = [];
  const sheds = ["#3f7f5a", "#4f6fa0", "#8a5a3a", "#b04a3a", "#6b8f3a", "#d8c9a8"];
  const ok = (x: number, z: number) =>
    roadDistance(x, z) >= 7.5 && !inOtherZone(x, z, 4) && !inBox(ZONES.countryside, x, z, 4) && openLand(x, z);
  for (const [cx, cz] of ALLOTMENT_SITES) {
    const site = { minX: cx - W / 2, maxX: cx + W / 2, minZ: cz - D / 2, maxZ: cz + D / 2 };
    const before = plots.length;
    for (let x = site.minX + 3; x + 5 <= site.maxX - 2; x += 6.2)
      for (let z = site.minZ + 3; z + 9 <= site.maxZ - 2; z += 10.4) {
        const pc: [number, number][] = [
          [x, z],
          [x + 5, z],
          [x, z + 9],
          [x + 5, z + 9],
          [x + 2.5, z + 4.5],
        ];
        if (!pc.every(([px, pz]) => ok(px, pz))) continue;
        plots.push({
          x: x + 2.5,
          z: z + 4.5,
          w: 5,
          d: 9,
          crop: rand(),
          shed: rand() < 0.35 ? sheds[Math.floor(rand() * sheds.length)] : null,
          rowsAlongX: rand() < 0.5,
        });
      }
    if (plots.length - before < 6) {
      plots.length = before;
      continue;
    }
    sites.push(site);
    // a low hedge round the site, gapped where roads pass
    const edge = (alongX: boolean, fixed: number, t0: number, t1: number) => {
      for (const [a, b] of runs(t0, t1, 3, (t) => (alongX ? ok(t, fixed) : ok(fixed, t))))
        for (let t = a; t <= b; t += 3) hedges.push({ x: alongX ? t : fixed, z: alongX ? fixed : t, len: 3.1, alongX, kind: "hedge" });
    };
    edge(true, site.minZ, site.minX, site.maxX);
    edge(true, site.maxZ, site.minX, site.maxX);
    edge(false, site.minX, site.minZ, site.maxZ);
    edge(false, site.maxX, site.minZ, site.maxZ);
  }
  return { sites, plots, hedges };
}

// --- Forests and the tree scatter across all open land ------------------------------------------

export interface Forest {
  name: string;
  x: number;
  z: number;
  rx: number;
  rz: number;
  conifer: number; // share of conifers
}

export const FORESTS: Forest[] = [
  { name: "west", x: -992, z: 40, rx: 92, rz: 430, conifer: 0.7 }, // far west, beyond Old Town and the motorway
  { name: "south", x: -260, z: 935, rx: 340, rz: 120, conifer: 0.55 }, // far south, beyond the motorway
  { name: "northwest", x: -700, z: -400, rx: 190, rz: 122, conifer: 0.75 }, // between the airport and the river
];

export interface TreeOpts {
  max?: number;
  extraBoxes?: Box[];
}

export function makeTrees(hills: readonly Hill[], turbines: readonly Turbine[], seed = 23, opts: TreeOpts = {}): TreeSpot[] {
  const max = opts.max ?? 7600;
  const rand = mulberry32(seed);
  const R = HIGHWAY_RING;
  const trees: TreeSpot[] = [];
  const cell = 4;
  const grid = new Set<number>();
  const key = (cx: number, cz: number) => (cx + 1000) * 4096 + (cz + 1000);
  const crowded = (x: number, z: number) => {
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) if (grid.has(key(cx + i, cz + j))) return true;
    return false;
  };
  const tCircles: Circle[] = turbines.map((t) => ({ x: t.x, z: t.z, r: 5 }));
  const reserved = [FARMLAND_SW, ...(opts.extraBoxes ?? [])];
  const cs = ZONES.countryside;
  const allowed = (x: number, z: number) =>
    openLand(x, z) &&
    !inBox(cs, x, z, 2) &&
    !inOtherZone(x, z, 8) &&
    !reserved.some((b) => inBox(b, x, z, 3)) &&
    !inCircles(tCircles, x, z) &&
    !inCircles(FARM_EXCLUSIONS, x, z) &&
    roadDistance(x, z) >= 9;
  const place = (x: number, z: number, species: TreeSpot["species"], scale: number) => {
    const y = Math.max(0, hillHeight(hills, x, z) - 0.6);
    trees.push({ x, y, z, species, scale, rot: rand() * Math.PI * 2, shade: rand() });
    grid.add(key(Math.floor(x / cell), Math.floor(z / cell)));
  };

  // 1. Verge line just inside the highway ring
  const inset = R - 13;
  for (let side = 0; side < 4; side++) {
    for (let t = -inset + 4; t <= inset - 4; t += 9) {
      const tt = t + (rand() - 0.5) * 2;
      const [x, z] =
        side === 0 ? [tt, -inset] : side === 1 ? [inset, tt] : side === 2 ? [tt, inset] : [-inset, tt];
      if (roadDistance(x, z) < 9 || inBox(ZONES.downtown, x, z, 8) || !openLand(x, z) || crowded(x, z)) continue;
      if (reserved.some((b) => inBox(b, x, z, 3))) continue;
      place(x, z, rand() < 0.55 ? 2 : 0, 0.85 + rand() * 0.3);
    }
  }

  // 2. Dense forests on the outer edges: a jittered 7 m grid inside a wobbly ellipse
  for (const f of FORESTS) {
    for (let gx = f.x - f.rx; gx <= f.x + f.rx; gx += 7)
      for (let gz = f.z - f.rz; gz <= f.z + f.rz; gz += 7) {
        if (trees.length >= max) break;
        const x = gx + (rand() - 0.5) * 5;
        const z = gz + (rand() - 0.5) * 5;
        const ang = Math.atan2((z - f.z) / f.rz, (x - f.x) / f.rx);
        const wobble = 0.82 + 0.12 * Math.sin(ang * 3 + f.x) + 0.08 * Math.sin(ang * 7 + f.z);
        const d = Math.hypot((x - f.x) / f.rx, (z - f.z) / f.rz);
        if (d > wobble) continue;
        if (d > wobble - 0.12 && rand() < 0.5) continue; // ragged edge
        if (rand() < 0.06) continue; // clearings
        if (crowded(x, z) || !allowed(x, z)) continue;
        place(x, z, rand() < f.conifer ? 1 : rand() < 0.85 ? 0 : 2, 0.85 + rand() * 0.55);
      }
  }

  // 3. Clumpy woodland + scattered singles over all other open land outside the ring
  for (let i = 0; i < 160000 && trees.length < max; i++) {
    const x = -WORLD_HALF + rand() * WORLD_HALF * 2;
    const z = -WORLD_HALF + rand() * WORLD_HALF * 2;
    if (Math.abs(x) < R + 9 && Math.abs(z) < R + 9) continue;
    const n = 0.5 + 0.5 * Math.sin(x * 0.029 + Math.sin(z * 0.021) * 2.2) * Math.cos(z * 0.026 - 1.1 + Math.sin(x * 0.013));
    if (rand() > 0.02 + 0.75 * n * n * n) continue;
    if (crowded(x, z) || !allowed(x, z)) continue;
    const onHill = hillHeight(hills, x, z) > 1;
    const r = rand();
    const species: TreeSpot["species"] = onHill || z < -700 ? (r < 0.65 ? 1 : 0) : r < 0.6 ? 0 : r < 0.85 ? 1 : 2;
    place(x, z, species, 0.75 + rand() * 0.6);
  }
  return trees;
}
