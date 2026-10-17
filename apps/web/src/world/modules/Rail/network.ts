// The mainline railway: four lines out of the King's Hamyway terminus (an elevated trainshed north of the
// ring, St Pancras style: platforms on a brick undercroft at viaduct height) plus the goods line.
//
//   west    King's Hamyway -> Airport Parkway -> Old Town          (intercity, 3 trains)
//   north   King's Hamyway -> steel truss over the river -> Hampstead Heath   (intercity, 2 trains)
//   east    King's Hamyway -> level crossing -> Shoreditch (runs onto the Shoreditch module's viaduct)  (EMU)
//   freight Goods yard -> outside the ring (north and east) -> level crossing -> Thameside freight yard
//           between the container terminal and the industrial estate (3 long freight trains)
//
// Pure data + geometry maths, no three.js. Everything is derived once at load.
import { RIVER } from "../../config";
import { ROAD_EDGES, ROAD_NODES } from "../../roads";
import { buildSchedule, type Schedule, type Stop } from "./motion";
import { buildSpline, crossings, easedProfile, offsetPoint, poseAt, projectS, segDistance, smoothstep, type Pose, type Spline } from "./spline";

export const H = 7.9; // rail base (top of ballast) on viaducts; the Shoreditch viaduct deck is 7.6 + 0.3 ballast
export const DECK_TOP = H - 0.3;
export const GAUGE_HALF = 0.72;
export const TRACK_HALF = 2.25; // half the distance between the two running lines
export const ISLAND_HALF = 4.25; // tracks either side of a 5 m island platform
export const PLATFORM_HALF = 2.5;
export const PLATFORM_Y = H + 0.95;
export const DECK_HALF = TRACK_HALF + 2.9; // half width of a plain double-track viaduct deck

// ---- Rolling stock -----------------------------------------------------------------------------

export type CarType = "icNose" | "icCoach" | "emuNose" | "emuCoach" | "loco" | "flat" | "tank";
export interface CarSpec {
  type: CarType;
  len: number;
  flip: boolean; // nose / cab faces -s
}
export const GAP = 0.6;

const ic = (n: number): CarSpec[] => [
  { type: "icNose", len: 14, flip: false },
  ...Array.from({ length: n - 2 }, () => ({ type: "icCoach" as const, len: 13.5, flip: false })),
  { type: "icNose", len: 14, flip: true },
];
const emu: CarSpec[] = [
  { type: "emuNose", len: 10.8, flip: false },
  { type: "emuCoach", len: 10.8, flip: false },
  { type: "emuNose", len: 10.8, flip: true },
];
const freight = (wagon: "flat" | "tank"): CarSpec[] => [
  { type: "loco", len: 17, flip: false },
  ...Array.from({ length: 7 }, () => ({ type: wagon, len: 14, flip: false })),
  { type: "loco", len: 17, flip: true },
];

export function consistLength(c: readonly CarSpec[]) {
  return c.reduce((a, k) => a + k.len, 0) + GAP * (c.length - 1);
}

/** Centre of each car relative to the train centre, along +s (car 0 is at the +s end). */
export function carOffsets(c: readonly CarSpec[]): number[] {
  const L = consistLength(c);
  const out: number[] = [];
  let x = L / 2;
  for (const k of c) {
    out.push(x - k.len / 2);
    x -= k.len + GAP;
  }
  return out;
}

// ---- Line specs --------------------------------------------------------------------------------

type XZ = [number, number];

interface StationSpec {
  name: string;
  at: XZ | "start" | "end"; // platform centre for mid-line stations
  platform: number; // platform length
  dwell: number;
  island: boolean; // tracks spread round an island platform
  building?: boolean; // draw a station (Shoreditch draws its own)
  board?: boolean;
  hall?: 1 | -1; // which side of the line the street-level booking hall stands (+ = left of +s)
}

interface LineSpec {
  id: "west" | "north" | "east" | "freight";
  name: string;
  color: string;
  points: XZ[];
  radius: number | number[];
  heights: [XZ | "start" | "end" | number, number][]; // keys: world point, end, or arc length
  stations: StationSpec[];
  consists: CarSpec[][]; // one per train
  vmax: number;
  accel: number;
  catenary: boolean;
  undercroft: number; // s below which the terminus / goods-yard building carries the track
  singleFrom?: XZ; // track merges to single line, finishing here
  externalFrom?: XZ; // beyond here another module draws the structure and rails
  embankments?: [XZ, XZ][];
  phases?: number[]; // time shift of each train as a fraction of the cycle (default: evenly spread)
  freight: boolean;
}

const TERMINUS_PLATFORM = 128;

export const TERMINUS = {
  name: "King's Hamyway",
  // platform islands (x) of the 8 platforms; platforms run z -462..-334, buffers at z -333
  islands: [-184, -168, -152, -136],
  buffersZ: -333,
  platformEndZ: -333 - TERMINUS_PLATFORM,
  shed: { minX: -197, maxX: -123, minZ: -470, maxZ: -330 },
  undercroft: { minX: -199, maxX: -79, minZ: -472, maxZ: -330 },
  hotel: { minX: -214, maxX: -112, minZ: -330, maxZ: -315 },
  clock: { x: -207, z: -322, w: 13, h: 64 },
  goodsYard: { minX: -120, maxX: -81, minZ: -472, maxZ: -330 },
} as const;

const LINE_SPECS: LineSpec[] = [
  {
    id: "west",
    name: "West Main Line",
    color: "#ff6a1a",
    points: [[-184, -333], [-184, -505], [-610, -505], [-610, -250]],
    radius: [35, 60],
    heights: [["start", H], [[-610, -458], H], [[-610, -362], 0], ["end", 0]],
    stations: [
      { name: TERMINUS.name, at: "start", platform: TERMINUS_PLATFORM, dwell: 22, island: true },
      { name: "Airport Parkway", at: [-500, -505], platform: 110, dwell: 13, island: true, building: true, board: true, hall: 1 },
      { name: "Old Town", at: "end", platform: 104, dwell: 22, island: true, building: true, board: true },
    ],
    consists: [ic(7), ic(7), ic(7)],
    vmax: 26,
    accel: 0.75,
    catenary: true,
    undercroft: 136,
    embankments: [[[-246, -505], [-438, -505]]],
    freight: false,
  },
  {
    id: "north",
    name: "Northern Heights Line",
    color: "#1c7ed6",
    points: [[-152, -333], [-152, -675], [-122, -718], [-122, -815]],
    radius: 50,
    heights: [["start", H], ["end", H]],
    stations: [
      { name: TERMINUS.name, at: "start", platform: TERMINUS_PLATFORM, dwell: 22, island: true },
      { name: "Hampstead Heath", at: "end", platform: 92, dwell: 22, island: true, building: true, board: true, hall: -1 },
    ],
    consists: [ic(6), ic(6)],
    vmax: 26,
    accel: 0.75,
    catenary: true,
    undercroft: 136,
    freight: false,
  },
  {
    id: "east",
    name: "Shoreditch Branch",
    color: "#e8a200",
    points: [[-136, -333], [-136, -525], [40, -525], [82, -507], [130, -508], [180, -506], [228, -503], [262, -501]],
    radius: [50, 60, 25, 200, 200, 200],
    heights: [["start", H], [134, H], [[-82, -525], 0], [[-52, -525], 0], [[48, -522], H], ["end", H]],
    stations: [
      { name: TERMINUS.name, at: "start", platform: TERMINUS_PLATFORM, dwell: 20, island: true },
      { name: "Shoreditch", at: "end", platform: 34, dwell: 18, island: false },
    ],
    consists: [emu],
    vmax: 18,
    accel: 0.9,
    catenary: true,
    undercroft: 136,
    singleFrom: [62, -514],
    externalFrom: [82, -507],
    freight: false,
  },
  {
    id: "freight",
    name: "Thameside Freight Line",
    color: "#7a8a99",
    points: [[-102, -467], [-102, -233], [233, -233], [233, 356], [298, 356]],
    radius: [45, 22, 25],
    heights: [["start", H], [[233, 112], H], [[233, 212], 0], ["end", 0]],
    stations: [
      { name: "King's Hamyway Goods", at: "start", platform: 140, dwell: 26, island: false },
      { name: "Thameside Freight Yard", at: "end", platform: 140, dwell: 30, island: false },
    ],
    consists: [freight("flat"), freight("tank"), freight("flat")],
    vmax: 13,
    accel: 0.45,
    catenary: false,
    undercroft: 139,
    freight: true,
  },
];

// ---- Derived lines -----------------------------------------------------------------------------

export type Style = "none" | "ground" | "viaduct" | "truss" | "embankment";

export interface Station {
  name: string;
  line: string;
  s: number; // platform centre
  s0: number;
  s1: number;
  island: boolean;
  building: boolean;
  board: boolean;
  elevated: boolean;
  hall: number;
}

export interface LevelCrossing {
  id: string;
  line: string;
  s: number;
  x: number;
  z: number;
  roadHeading: number; // heading of the main crossed road (rotation about y)
  roadHalf: number; // half width of that road
  edges: string[]; // road edges closed while the crossing is down
  note: string;
}

export interface RoadSpanInfo {
  s: number;
  key: string;
  half: number;
}

export interface Line {
  id: LineSpec["id"];
  name: string;
  color: string;
  spec: LineSpec;
  sp: Spline;
  L: number;
  heightKeys: [number, number][];
  stops: Stop[];
  stations: Station[];
  trainLen: number;
  schedule: Schedule;
  consists: CarSpec[][];
  phase: number[]; // time shift per train
  a: [number, number]; // crossover used by "out" trains leaving s = 0
  b: [number, number]; // crossover used by "back" trains leaving s = L
  halfZones: { s0: number; s1: number; half: number }[]; // track spacing overrides (islands, single line)
  singleS: number; // >= this: single track (Infinity: never)
  externalS: number; // >= this: another module draws structure and rails
  roadCrossings: RoadSpanInfo[];
  levelCrossings: LevelCrossing[];
  riverS: [number, number] | null; // truss bridge span
  embS: [number, number][]; // embankment runs
}

export const ROAD_HALF: Record<string, number> = { street: 4, highway: 6.5, ramp: 5, country: 3 };

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

const _p: Pose = { x: 0, z: 0, h: 0 };

function buildLine(spec: LineSpec): Line {
  const sp = buildSpline(spec.points, spec.radius, 0.5);
  const L = sp.length;
  const sOf = (k: XZ | "start" | "end" | number) => (k === "start" ? 0 : k === "end" ? L : typeof k === "number" ? k : projectS(sp, k[0], k[1]));
  const heightKeys = spec.heights.map(([k, h]) => [sOf(k), h] as [number, number]).sort((a, b) => a[0] - b[0]);
  const trainLen = Math.max(...spec.consists.map(consistLength));

  // stations and stops
  const stations: Station[] = [];
  const stops: Stop[] = [];
  for (const st of spec.stations) {
    let s0: number, s1: number, stopS: number;
    if (st.at === "start") {
      s0 = 1;
      s1 = 1 + st.platform;
      stopS = trainLen / 2 + 3;
    } else if (st.at === "end") {
      s1 = L - 1;
      s0 = s1 - st.platform;
      stopS = L - trainLen / 2 - 3;
    } else {
      const c = projectS(sp, st.at[0], st.at[1]);
      s0 = c - st.platform / 2;
      s1 = c + st.platform / 2;
      stopS = c;
    }
    stops.push({ s: stopS, dwell: st.dwell });
    stations.push({
      name: st.name,
      line: spec.id,
      s: (s0 + s1) / 2,
      s0,
      s1,
      island: st.island,
      building: !!st.building,
      board: !!st.board,
      elevated: easedProfile(heightKeys, (s0 + s1) / 2) > 1,
      hall: st.hall ?? 1,
    });
  }

  // track spacing zones
  const halfZones: Line["halfZones"] = [];
  for (const st of stations) if (st.island) halfZones.push({ s0: st.s0 - 4, s1: st.s1 + 4, half: ISLAND_HALF });
  const singleS = spec.singleFrom ? projectS(sp, spec.singleFrom[0], spec.singleFrom[1]) : Infinity;
  const externalS = spec.externalFrom ? projectS(sp, spec.externalFrom[0], spec.externalFrom[1]) : Infinity;

  // crossovers just beyond the end stops
  const startFront = stops[0].s + trainLen / 2;
  const endRear = stops[stops.length - 1].s - trainLen / 2;
  const a: [number, number] = [Math.max(startFront, stations[0].s1) + 10, Math.max(startFront, stations[0].s1) + 52];
  const bEnd = Math.min(endRear, stations[stations.length - 1].s0) - 10;
  const b: [number, number] = [bEnd - 42, bEnd];

  const schedule = buildSchedule(stops, spec.vmax, spec.accel);
  const n = spec.consists.length;
  const phase = spec.consists.map((_, i) => (spec.phases ? spec.phases[i] : i / n) * schedule.cycle);

  // roads crossed, level crossings
  const heightAt = (s: number) => easedProfile(heightKeys, s);
  const roadCrossings: RoadSpanInfo[] = [];
  const lcAt: { s: number; key: string; kind: string; ax: number; az: number; bx: number; bz: number }[] = [];
  for (const e of ROAD_EDGES.values()) {
    const na = ROAD_NODES.get(e.a)!;
    const nb = ROAD_NODES.get(e.b)!;
    for (const c of crossings(sp, na.x, na.z, nb.x, nb.z)) {
      if (c.s >= externalS) continue;
      roadCrossings.push({ s: c.s, key: e.key, half: ROAD_HALF[e.kind] ?? 4 });
      if (heightAt(c.s) < 0.5) lcAt.push({ s: c.s, key: e.key, kind: e.kind, ax: na.x, az: na.z, bx: nb.x, bz: nb.z });
    }
  }
  roadCrossings.sort((p, q) => p.s - q.s);
  const levelCrossings: LevelCrossing[] = [];
  for (const c of lcAt.sort((p, q) => p.s - q.s)) {
    if (levelCrossings.some((l) => Math.abs(l.s - c.s) < 12)) continue;
    poseAt(sp, c.s, _p);
    const edges = [c.key];
    for (const e of ROAD_EDGES.values()) {
      if (e.key === c.key) continue;
      const na = ROAD_NODES.get(e.a)!;
      const nb = ROAD_NODES.get(e.b)!;
      if (segDistance(_p.x, _p.z, na.x, na.z, nb.x, nb.z) < TRACK_HALF + 3) edges.push(e.key);
    }
    levelCrossings.push({
      id: `${spec.id}-lc${levelCrossings.length + 1}`,
      line: spec.id,
      s: c.s,
      x: _p.x,
      z: _p.z,
      roadHeading: Math.atan2(c.bx - c.ax, c.bz - c.az),
      roadHalf: ROAD_HALF[c.kind] ?? 4,
      edges,
      note: "Level crossing closed",
    });
  }

  // river span (truss bridge)
  let riverS: [number, number] | null = null;
  for (let s = 0; s <= L; s += 1) {
    poseAt(sp, s, _p);
    if (Math.abs(_p.z - riverZAt(_p.x)) < RIVER.width / 2 + 9) {
      if (!riverS) riverS = [s, s];
      else riverS[1] = s;
    }
  }

  return {
    id: spec.id,
    name: spec.name,
    color: spec.color,
    spec,
    sp,
    L,
    heightKeys,
    stops,
    stations,
    trainLen,
    schedule,
    consists: spec.consists,
    phase,
    a,
    b,
    halfZones,
    singleS,
    externalS,
    roadCrossings,
    levelCrossings,
    riverS,
    embS: (spec.embankments ?? []).map(([p, q]) => {
      const s0 = projectS(sp, p[0], p[1]);
      const s1 = projectS(sp, q[0], q[1]);
      return [Math.min(s0, s1), Math.max(s0, s1)] as [number, number];
    }),
  };
}

export const LINES: readonly Line[] = LINE_SPECS.map(buildLine);
export const lineById = (id: string) => LINES.find((l) => l.id === id)!;

// ---- Per-line geometry helpers -----------------------------------------------------------------

export function heightAt(line: Line, s: number): number {
  return easedProfile(line.heightKeys, s);
}

/** Half the spacing between the two tracks at s. */
export function halfSpacing(line: Line, s: number): number {
  let half = TRACK_HALF;
  for (const z of line.halfZones) {
    const w = smoothstep(z.s0 - 34, z.s0, s) * (1 - smoothstep(z.s1, z.s1 + 34, s));
    half = Math.max(half, TRACK_HALF + (z.half - TRACK_HALF) * w);
  }
  if (Number.isFinite(line.singleS)) half *= 1 - smoothstep(line.singleS - 48, line.singleS, s);
  return half;
}

/** Height of the rail top above the rail base: lower on the Shoreditch module's viaduct (its rails are thinner). */
export function railTop(line: Line, s: number): number {
  if (!Number.isFinite(line.externalS)) return 0.33;
  return 0.33 - 0.17 * smoothstep(line.externalS - 10, line.externalS, s);
}

/** Lateral offset (left of +s) of the track a train travelling in `dir` uses at s. */
export function trackLateral(line: Line, s: number, dir: number): number {
  const half = halfSpacing(line, s);
  const [c0, c1] = dir > 0 ? line.a : line.b;
  return half * (-1 + 2 * smoothstep(c0, c1, s));
}

export interface TrackPoint {
  x: number;
  y: number;
  z: number;
  h: number;
}

/** World point on the given lateral track position. */
export function trackPoint(line: Line, s: number, lat: number, out: TrackPoint): TrackPoint {
  offsetPoint(line.sp, s, lat, _p);
  out.x = _p.x;
  out.z = _p.z;
  out.h = _p.h;
  out.y = heightAt(line, s);
  return out;
}

const STYLE_EPS = 0.3;

export function styleAt(line: Line, s: number): Style {
  if (s < line.spec.undercroft || s >= line.externalS) return "none";
  if (heightAt(line, s) < STYLE_EPS) return "ground";
  if (line.riverS && s >= line.riverS[0] && s <= line.riverS[1]) return "truss";
  for (const [s0, s1] of line.embS) if (s >= s0 && s <= s1) return "embankment";
  return "viaduct";
}

/** Contiguous runs of one style. */
export function styleRuns(line: Line, step = 1): { style: Style; s0: number; s1: number }[] {
  const runs: { style: Style; s0: number; s1: number }[] = [];
  for (let s = 0; s <= line.L; s += step) {
    const st = styleAt(line, s);
    const last = runs[runs.length - 1];
    if (last && last.style === st) last.s1 = Math.min(line.L, s + step);
    else runs.push({ style: st, s0: s, s1: Math.min(line.L, s + step) });
  }
  return runs;
}

/** All road segments as [ax, az, bx, bz, half]. */
export const ROAD_SEGS: [number, number, number, number, number][] = [...ROAD_EDGES.values()].map((e) => {
  const a = ROAD_NODES.get(e.a)!;
  const b = ROAD_NODES.get(e.b)!;
  return [a.x, a.z, b.x, b.z, ROAD_HALF[e.kind] ?? 4];
});

/** Clearance from (x, z) to the nearest road surface edge (negative = on a road). */
export function roadClearance(x: number, z: number): number {
  let best = Infinity;
  for (const [ax, az, bx, bz, half] of ROAD_SEGS) {
    if (x < Math.min(ax, bx) - 40 || x > Math.max(ax, bx) + 40 || z < Math.min(az, bz) - 40 || z > Math.max(az, bz) + 40) continue;
    best = Math.min(best, segDistance(x, z, ax, az, bx, bz) - half);
  }
  return best;
}

const PIER_SPACING = 13;
const PIER_HALF_LEN = 1.1;

export interface Pier {
  s: number;
}

export interface Span {
  s0: number;
  s1: number;
  girder: boolean; // steel span (over a road or too long for an arch)
}

/** Pier sites (arc lengths) along one viaduct run, nudged off roads, and the spans between them. */
export function viaductLayout(line: Line, s0: number, s1: number): { piers: number[]; spans: Span[] } {
  const pierOk = (s: number) => {
    const half = halfSpacing(line, s) + 3;
    for (const along of [-PIER_HALF_LEN, 0, PIER_HALF_LEN])
      for (const lat of [-half, 0, half]) {
        offsetPoint(line.sp, s + along, lat, _p);
        if (roadClearance(_p.x, _p.z) < 1.2) return false;
      }
    return true;
  };
  const piers: number[] = [s0];
  for (let s = s0 + PIER_SPACING; s < s1 - PIER_SPACING * 0.6; s += PIER_SPACING) {
    for (const off of [0, 2, -2, 4, -4, 6, -6]) {
      const ss = s + off;
      if (ss <= piers[piers.length - 1] + 6 || ss >= s1 - 4) continue;
      if (pierOk(ss)) {
        piers.push(ss);
        s = ss;
        break;
      }
    }
  }
  piers.push(s1);
  const spans: Span[] = [];
  for (let i = 0; i < piers.length - 1; i++) {
    const a = piers[i];
    const b = piers[i + 1];
    let overRoad = false;
    for (const r of line.roadCrossings) if (r.s > a - r.half && r.s < b + r.half) overRoad = true;
    spans.push({ s0: a, s1: b, girder: overRoad || b - a > 19 });
  }
  return { piers, spans };
}

// ---- Signals and catenary ------------------------------------------------------------------------

export interface SignalSite {
  line: string;
  s: number;
  dir: number; // protects trains travelling this way
  blockEnd: number; // s where its block ends (next signal or line end)
}

export function signalSites(line: Line): SignalSite[] {
  const out: SignalSite[] = [];
  for (const dir of [1, -1]) {
    const pts: number[] = [];
    // departure signal at every station, then roughly every 230 m
    for (const st of line.stops) pts.push(st.s + dir * (line.trainLen / 2 + 8));
    const sorted = pts.filter((s) => s > 4 && s < line.L - 4).sort((p, q) => p - q);
    const all: number[] = [];
    for (let i = 0; i < sorted.length; i++) {
      all.push(sorted[i]);
      const next = i + 1 < sorted.length ? sorted[i + 1] : dir > 0 ? line.L : sorted[i];
      if (dir > 0) for (let s = sorted[i] + 230; s < next - 80; s += 230) all.push(s);
    }
    if (dir < 0) {
      const extra: number[] = [];
      for (let i = sorted.length - 1; i >= 0; i--) {
        const prev = i > 0 ? sorted[i - 1] : 0;
        for (let s = sorted[i] - 230; s > prev + 80; s -= 230) extra.push(s);
      }
      all.push(...extra);
    }
    const list = all.filter((s) => s < line.externalS - 10 && s > line.spec.undercroft - 2).sort((p, q) => (dir > 0 ? p - q : q - p));
    for (let i = 0; i < list.length; i++) out.push({ line: line.id, s: list[i], dir, blockEnd: i + 1 < list.length ? list[i + 1] : dir > 0 ? line.L : 0 });
  }
  return out;
}

/** Overhead line gantry sites (arc lengths). */
export function gantrySites(line: Line): number[] {
  if (!line.spec.catenary) return [];
  const out: number[] = [];
  const end = Math.min(line.L - 3, line.externalS - 2);
  for (let s = line.spec.undercroft + 8; s < end; s += 48) {
    if (line.riverS && s > line.riverS[0] - 4 && s < line.riverS[1] + 4) continue; // the truss carries the wires
    const lc = line.levelCrossings.find((c) => Math.abs(c.s - s) < 14);
    out.push(lc ? lc.s + (s < lc.s ? -14 : 14) : s);
  }
  return out;
}

// ---- Keep-out boxes for other modules (trees, props) -----------------------------------------------

/** Axis-aligned boxes covering the railway's footprint (for Countryside's tree scatter etc.). */
export function railKeepOut(margin = 3): { minX: number; maxX: number; minZ: number; maxZ: number }[] {
  const boxes: { minX: number; maxX: number; minZ: number; maxZ: number }[] = [];
  const u = TERMINUS.undercroft;
  boxes.push({ minX: u.minX - margin, maxX: u.maxX + margin, minZ: u.minZ - margin, maxZ: u.maxZ + margin });
  const ht = TERMINUS.hotel;
  boxes.push({ minX: ht.minX - margin, maxX: ht.maxX + margin, minZ: ht.minZ - margin, maxZ: ht.maxZ + 7 + margin }); // + entrance porch
  for (const line of LINES) {
    const end = Math.min(line.L, line.externalS);
    for (let s = 0; s < end; s += 20) {
      const s1 = Math.min(end, s + 20);
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const ss of [s, (s + s1) / 2, s1]) {
        const half = halfSpacing(line, ss) + 6 + (styleAt(line, ss) === "embankment" ? heightAt(line, ss) * 1.4 : 0);
        for (const lat of [-half, half]) {
          offsetPoint(line.sp, ss, lat, _p);
          minX = Math.min(minX, _p.x);
          maxX = Math.max(maxX, _p.x);
          minZ = Math.min(minZ, _p.z);
          maxZ = Math.max(maxZ, _p.z);
        }
      }
      boxes.push({ minX: minX - margin, maxX: maxX + margin, minZ: minZ - margin, maxZ: maxZ + margin });
    }
  }
  return boxes;
}

/** True when (x, z) is on (or within `margin` of) the railway. Cheap enough for scatter tests. */
export function onRailway(x: number, z: number, margin = 3): boolean {
  for (const b of KEEP_OUT) if (x >= b.minX - margin && x <= b.maxX + margin && z >= b.minZ - margin && z <= b.maxZ + margin) return true;
  return false;
}
const KEEP_OUT = railKeepOut(0);

/** Centre-line polylines for the minimap (sampled every 10 m). */
export const RAIL_POLYLINES: { id: string; color: string; points: [number, number][] }[] = LINES.map((l) => {
  const pts: [number, number][] = [];
  for (let s = 0; s <= l.L; s += 10) {
    poseAt(l.sp, s, _p);
    pts.push([Math.round(_p.x * 10) / 10, Math.round(_p.z * 10) / 10]);
  }
  return { id: l.id, color: l.color, points: pts };
});
