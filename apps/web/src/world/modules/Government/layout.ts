// Pure layout data for the government quarter (no three.js): building footprints, props, police posts and patrols.
// Everything is axis-aligned and seeded so the tests can check it sits in the zone and off the roads.
import { WIND, ZONES } from "../../config";
import { ROAD_EDGES, ROAD_NODES, getNode } from "../../roads";
import { GOV_CIRCUS } from "../../districts/government";

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
export interface Footprint extends Rect {
  id: string;
  h: number;
}
export interface Pt {
  x: number;
  z: number;
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

const R = (minX: number, maxX: number, minZ: number, maxZ: number): Rect => ({ minX, maxX, minZ, maxZ });

// ---- Buildings ----------------------------------------------------------------------------------------------

export const RES = {
  centreX: 299,
  main: R(286, 312, -201, -189),
  mainH: 14,
  wingW: R(276, 286, -198, -192),
  wingE: R(312, 322, -198, -192),
  wingH: 7,
  porticoS: { x: 299, z: -189, r: 5.5 }, // semicircular south portico
  porticoN: R(292, 306, -205, -201),
  mailroom: R(278, 285, -205, -201.5),
  lodgeW: R(285, 291, -126, -120),
  lodgeE: R(307, 313, -126, -120),
  /** Security fence round the grounds, with gate openings (x ranges) on the south and north sides. */
  fence: R(274, 324, -206, -123),
  southGate: [294, 304] as const,
  northGate: [281, 291] as const,
  flag: { x: 299, z: -195 },
};

export const HELIPAD = { x: 312, z: -139, r: 7 };
export const FOUNTAIN = { x: 304, z: -160, r: 5 };

export const MINISTRY = R(254, 272, -204, -160);
export const MINISTRY_H = 16;
export const PARLIAMENT = R(256, 272, -150, -120);
export const PARLIAMENT_H = 11;
export const DOME = { x: 264, z: -135, r: 5.5 };
export const CLOCK_TOWER = R(250.5, 255.5, -126, -121);
export const CLOCK_TOWER_H = 30;

/** Downing Street: the west terrace (No. 10, 11, 12; doors face east) and the east terrace (doors face west). */
export const TERRACE_W = R(249, 260.5, -236, -221);
export const TERRACE_E = R(271.5, 285, -236, -221);
export const TERRACE_H = 13;
/** Door z of each west-terrace house, north -> south: No. 12, No. 10 (middle), No. 11. */
export const NO10_DOOR = { x: 260.5, z: -228.5 };
export const DS_GATE = { z: -219.5, posts: [261.5, 270.5] as const };

export const EMBASSY = R(290, 314, -236, -225);
export const EMBASSY_H = 12;

export const MONUMENT = { x: GOV_CIRCUS.x, z: GOV_CIRCUS.z, plinth: 3, h: 20 };

export const HUTS: Footprint[] = [
  { id: "hut_embassy", minX: 286, maxX: 289, minZ: -232, maxZ: -228.5, h: 2.7 },
  { id: "hut_res_north", minX: 288, maxX: 290.5, minZ: -205.5, maxZ: -203, h: 2.7 },
  { id: "hut_ministry", minX: 252, maxX: 254, minZ: -168, maxZ: -165.5, h: 2.7 },
];

export const FOOTPRINTS: Footprint[] = [
  { id: "residence", ...RES.main, h: RES.mainH },
  { id: "res_wing_w", ...RES.wingW, h: RES.wingH },
  { id: "res_wing_e", ...RES.wingE, h: RES.wingH },
  { id: "res_portico_n", ...RES.porticoN, h: 13 },
  { id: "res_portico_s", minX: 299 - 5.5, maxX: 299 + 5.5, minZ: -189, maxZ: -189 + 5.5, h: 12 },
  { id: "res_mailroom", ...RES.mailroom, h: 4 },
  { id: "lodge_w", ...RES.lodgeW, h: 5 },
  { id: "lodge_e", ...RES.lodgeE, h: 5 },
  { id: "ministry", ...MINISTRY, h: MINISTRY_H },
  { id: "parliament", ...PARLIAMENT, h: PARLIAMENT_H },
  { id: "clock_tower", ...CLOCK_TOWER, h: CLOCK_TOWER_H },
  { id: "terrace_w", ...TERRACE_W, h: TERRACE_H },
  { id: "terrace_e", ...TERRACE_E, h: TERRACE_H - 1 },
  { id: "embassy", ...EMBASSY, h: EMBASSY_H },
  {
    id: "monument",
    minX: MONUMENT.x - MONUMENT.plinth / 2,
    maxX: MONUMENT.x + MONUMENT.plinth / 2,
    minZ: MONUMENT.z - MONUMENT.plinth / 2,
    maxZ: MONUMENT.z + MONUMENT.plinth / 2,
    h: MONUMENT.h,
  },
  ...HUTS,
];

// ---- Road clearance --------------------------------------------------------------------------------------------

const HALF_W = { street: 4, ramp: 4, highway: 6, country: 3 } as const;

/** Distance from a point to the nearest road EDGE (kerb line); negative = on the carriageway. */
export function roadClearance(x: number, z: number): number {
  let best = Infinity;
  for (const e of ROAD_EDGES.values()) {
    const a = ROAD_NODES.get(e.a)!;
    const b = ROAD_NODES.get(e.b)!;
    if (Math.min(a.x, b.x) - 30 > x || Math.max(a.x, b.x) + 30 < x || Math.min(a.z, b.z) - 30 > z || Math.max(a.z, b.z) + 30 < z) continue;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
    const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)) - HALF_W[e.kind];
    if (d < best) best = d;
  }
  return best;
}

/** Clearance of a rectangle from all roads (sampled along its outline and interior). */
export function rectClearance(r: Rect): number {
  let best = Infinity;
  const nx = Math.max(2, Math.ceil((r.maxX - r.minX) / 1.5));
  const nz = Math.max(2, Math.ceil((r.maxZ - r.minZ) / 1.5));
  for (let i = 0; i <= nx; i++)
    for (let j = 0; j <= nz; j++) {
      const d = roadClearance(r.minX + ((r.maxX - r.minX) * i) / nx, r.minZ + ((r.maxZ - r.minZ) * j) / nz);
      if (d < best) best = d;
    }
  return best;
}

const inRect = (r: Rect, x: number, z: number, m = 0) => x >= r.minX - m && x <= r.maxX + m && z >= r.minZ - m && z <= r.maxZ + m;
const Z = ZONES.government;
const inZone = (x: number, z: number, m = 0) => x >= Z.minX + m && x <= Math.min(Z.maxX, 325) - m && z >= Z.minZ + m && z <= Z.maxZ - m;
const free = (x: number, z: number, clear: number, pad: number) =>
  inZone(x, z, 1) && roadClearance(x, z) >= clear && !FOOTPRINTS.some((f) => inRect(f, x, z, pad)) && Math.hypot(x - HELIPAD.x, z - HELIPAD.z) > HELIPAD.r + 3 && Math.hypot(x - FOUNTAIN.x, z - FOUNTAIN.z) > FOUNTAIN.r + 2;

/** Points either side of a polyline of road nodes, every `step` metres, `off` metres from the centre line. */
function alongside(ids: string[], step: number, off: number, phase = 0): (Pt & { side: number })[] {
  const out: (Pt & { side: number })[] = [];
  let carry = phase;
  for (let i = 1; i < ids.length; i++) {
    const a = getNode(ids[i - 1]);
    const b = getNode(ids[i]);
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const ux = (b.x - a.x) / len;
    const uz = (b.z - a.z) / len;
    let s = carry;
    for (; s < len; s += step) {
      for (const side of [-1, 1]) out.push({ x: a.x + ux * s - uz * off * side, z: a.z + uz * s + ux * off * side, side });
    }
    carry = s - len;
  }
  return out;
}

const AVENUE = ["gov_av0", "gov_av1", "gov_av2", "gov_cc4"];
const AVENUE_E = ["gov_cc0", "gov_av3"];
const WHITEHALL = ["gov_av0", "gov_parliament", "gov_wh2", "gov_min_mail", "gov_wh4", "gov_er0"];

// ---- Props ---------------------------------------------------------------------------------------------------------

export interface FlagSpec extends Pt {
  base: number; // pole foot height (roof flags stand on the roof)
  pole: number; // pole top height
  w: number;
  h: number;
  design: number; // flag atlas cell
  phase: number;
}

function buildFlags(): FlagSpec[] {
  const rand = mulberry32(42);
  const flags: FlagSpec[] = [];
  // the Avenue: alternating national / city flags on tall poles both sides
  let k = 0;
  for (const p of [...alongside(AVENUE, 11, 6.2, 4), ...alongside(AVENUE_E, 10, 6.2, 3)]) {
    if (!free(p.x, p.z, 1.6, 1)) continue;
    flags.push({ x: p.x, z: p.z, base: 0, pole: 9, w: 2.6, h: 1.5, design: k++ % 2 === 0 ? 0 : 5, phase: rand() * 6.28 });
  }
  // residence roof, ministry, parliament, embassy row
  flags.push({ x: RES.flag.x, z: RES.flag.z, base: 15.4, pole: 23, w: 3.6, h: 2.1, design: 0, phase: 0.3 });
  flags.push({ x: 263, z: -182, base: MINISTRY_H, pole: MINISTRY_H + 7, w: 3, h: 1.8, design: 0, phase: 1.1 });
  flags.push({ x: 268, z: -124, base: PARLIAMENT_H, pole: PARLIAMENT_H + 8, w: 3, h: 1.8, design: 0, phase: 2.2 });
  [1, 2, 3, 4, 6, 7].forEach((design, i) =>
    flags.push({ x: 292.5 + i * 4, z: -223, base: 0, pole: 8, w: 2.2, h: 1.3, design, phase: rand() * 6.28 }),
  );
  return flags;
}

export const FLAGS = buildFlags();

/** Unit vector the flags stream towards (downwind). */
export const FLAG_DIR = (() => {
  const l = Math.hypot(WIND[0], WIND[1]);
  return { x: WIND[0] / l, z: WIND[1] / l };
})();

function buildTrees(): (Pt & { s: number })[] {
  const rand = mulberry32(7);
  const out: (Pt & { s: number })[] = [];
  const cand: Pt[] = [
    ...alongside(AVENUE, 11, 6.4, 9.5),
    ...alongside(WHITEHALL, 13, 6, 6),
    // inside the residence fence: west and east lawn edges, north lawn
    ...[-131, -141, -151, -161, -171, -181].map((z) => ({ x: 278, z })),
    ...[-150, -160, -170, -180].map((z) => ({ x: 320.5, z })),
    { x: 317, z: -186 },
    { x: 290, z: -128 },
    // garden between the Ministry and Parliament
    { x: 259, z: -155.5 },
    { x: 267, z: -155.5 },
  ];
  for (const p of cand) {
    if (!free(p.x, p.z, 2.4, 2.2)) continue;
    if (inRect(RES.fence, p.x, p.z, 1) && !inRect(RES.fence, p.x, p.z, -1)) continue; // not on the fence line
    if (out.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 5)) continue;
    out.push({ x: p.x, z: p.z, s: 0.85 + rand() * 0.35 });
  }
  return out;
}

export const TREES = buildTrees();

function buildLamps(): Pt[] {
  const out: Pt[] = [];
  for (const p of [...alongside(AVENUE, 11, 5.2, 9.5), ...alongside(WHITEHALL, 18, 5.2, 3), ...alongside(["gov_res_gate", "gov_rd1", "gov_rd2", "gov_rd3", "gov_res_porch"], 12, 5.2, 4)]) {
    if (!free(p.x, p.z, 0.9, 0.8)) continue;
    if (FLAGS.some((f) => Math.hypot(f.x - p.x, f.z - p.z) < 3)) continue;
    if (TREES.some((t) => Math.hypot(t.x - p.x, t.z - p.z) < 2.5)) continue;
    out.push(p);
  }
  return out;
}

export const LAMPS = buildLamps();

function row(x0: number, z0: number, x1: number, z1: number, step: number): Pt[] {
  const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / step));
  return Array.from({ length: n + 1 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / n, z: z0 + ((z1 - z0) * i) / n }));
}

/** Anti-vehicle bollards: outside the residence's south fence, the Downing Street mouth, the embassy, Parliament, the Ministry mailroom. */
export const BOLLARDS: Pt[] = [
  ...row(275.5, -119.5, 283.5, -119.5, 1.6),
  ...row(314.5, -119.5, 322.5, -119.5, 1.6),
  ...row(291, -221, 313, -221, 2),
  ...row(250.4, -146, 250.4, -128, 1.8),
  ...row(251.8, -186, 251.8, -169, 1.7),
].filter((p) => roadClearance(p.x, p.z) >= 0.4);

/**
 * Armed police. a -> b is a patrol beat (walked back and forth); a == b is a fixed post facing `face`
 * (radians about y, 0 = facing +z / south).
 */
export interface Officer {
  a: Pt;
  b: Pt;
  face: number;
}
const post = (x: number, z: number, face: number): Officer => ({ a: { x, z }, b: { x, z }, face });
const beat = (x0: number, z0: number, x1: number, z1: number): Officer => ({ a: { x: x0, z: z0 }, b: { x: x1, z: z1 }, face: 0 });
const S = 0;
const N = Math.PI;
const W = -Math.PI / 2;
const E = Math.PI / 2;

export const POLICE: Officer[] = [
  // residence south gate
  post(293.2, -124.6, S), post(304.8, -124.6, S), post(305.5, -129.5, S - 0.3),
  // residence north (mailroom) gate
  post(283, -208.6, N), post(289, -208.6, N),
  // south portico and helipad
  post(292.5, -182, S), post(305.5, -182, S), post(304, -133, E - 0.5), post(320, -148, W + 0.4),
  // Downing Street gate, and outside No. 10
  post(259, -219.4, N), post(273, -219.4, N), post(261.4, -227, E), post(261.4, -230.2, E),
  // embassy
  post(293.6, -222.2, S), post(310.6, -222.2, S),
  // Parliament and the Ministry mailroom
  post(250.3, -137.5, W), post(251.8, -175.5, W),
  // patrol beats: the residence lawn (inside the fence), the Avenue pavement, Whitehall
  beat(277.5, -134, 277.5, -186), beat(321, -130, 321, -186), beat(264, -114.5, 284, -116), beat(252, -200, 252, -188),
];

/** Lamps along the residence fence top / gate piers glow at night. */
export const GATE_PIERS: Pt[] = [
  { x: RES.southGate[0], z: RES.fence.maxZ },
  { x: RES.southGate[1], z: RES.fence.maxZ },
  { x: RES.northGate[0], z: RES.fence.minZ },
  { x: RES.northGate[1], z: RES.fence.minZ },
];

export const LAWN_RECTS: Rect[] = [
  R(RES.fence.minX, RES.fence.maxX, RES.fence.minZ, RES.fence.maxZ),
  R(256, 270, -158, -152), // Ministry / Parliament garden
];
/** Stone paving under the whole quarter (roads draw on top). */
export const PAVE_RECT: Rect = R(Z.minX + 2, 325, Z.minZ, Z.maxZ);
