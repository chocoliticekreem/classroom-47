// Industrial: static layout of the estate (pure data + small pure helpers, unit tested).
// Plots (see districts/industrial.ts for the roads that frame them):
//   NW power station + warehouses, NE oil refinery, SW steelworks, SE chemicals / recycling / scrapyard / rail sidings.
import { ZONES } from "../../config";

export type V2 = [number, number];
export type V3 = [number, number, number];

/** Axis-aligned footprint, centre + full size. */
export interface Rect {
  x: number;
  z: number;
  w: number; // along x
  d: number; // along z
}
export interface Circle {
  x: number;
  z: number;
  r: number;
}

// ---------- seeded randomness ----------
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Power station (Battersea-style) ----------
export const POWER = {
  hall: { x: 140, z: 446, w: 64, d: 42 } satisfies Rect,
  hallH: 26,
  towerSize: 12,
  towerH: 34,
  chimneyH: 40, // chimney from towerH up to towerH + chimneyH
  chimneyR: 2.9, // base radius (tapers to ~0.82 at the top)
};
export const CHIMNEYS: V2[] = [
  [POWER.hall.x - POWER.hall.w / 2 + 6, POWER.hall.z - POWER.hall.d / 2 + 6],
  [POWER.hall.x + POWER.hall.w / 2 - 6, POWER.hall.z - POWER.hall.d / 2 + 6],
  [POWER.hall.x - POWER.hall.w / 2 + 6, POWER.hall.z + POWER.hall.d / 2 - 6],
  [POWER.hall.x + POWER.hall.w / 2 - 6, POWER.hall.z + POWER.hall.d / 2 - 6],
];
export const CHIMNEY_TOP = POWER.towerH + POWER.chimneyH;
export const COAL_PILE: Circle = { x: 126, z: 490, r: 10 };

// ---------- Steelworks ----------
export const STEEL = {
  furnace: { x: 150, z: 595, r: 8, h: 36 },
  stoves: [
    { x: 124, z: 580, r: 5, h: 30 },
    { x: 124, z: 595, r: 5, h: 30 },
    { x: 124, z: 610, r: 5, h: 30 },
  ],
  casthouse: { x: 170, z: 600, w: 16, d: 14 } satisfies Rect,
  casthouseH: 11,
  castFloorH: 5, // the east half of the casthouse is an open, raised cast floor
  pour: [180, 5, 600] as V3, // molten iron spills off the runner into the ladle here (sparks, flicker light)
  ladle: { x: 182.5, z: 600 },
  stack: { x: 180, z: 630, r: 3, h: 60 },
  mill: { x: 140, z: 630, w: 44, d: 14 } satisfies Rect,
  millH: 12,
  ore: { x: 112, z: 546, r: 12 } satisfies Circle,
  conveyor: { from: [120, 2, 552] as V3, to: [146, 35, 589] as V3, width: 2.2 },
};

// ---------- Oil refinery ----------
export const REFINERY = {
  columns: [
    { x: 250, z: 414, r: 3.2, h: 44 },
    { x: 262, z: 414, r: 2.6, h: 36 },
    { x: 256, z: 428, r: 4, h: 30 },
  ],
  spheres: [
    { x: 288, z: 404, r: 6 },
    { x: 302, z: 404, r: 6 },
    { x: 288, z: 420, r: 6 },
    { x: 302, z: 420, r: 6 },
  ],
  tanks: [
    { x: 244, z: 480, r: 9, h: 11 },
    { x: 266, z: 480, r: 9, h: 11 },
    { x: 288, z: 480, r: 9, h: 11 },
  ],
  flare: { x: 305, z: 467, h: 58 },
  racks: [
    { x: 279, z: 444, w: 76, d: 4 },
    { x: 278, z: 432, w: 4, d: 62 },
  ] satisfies Rect[],
  control: { x: 234, z: 400, w: 16, d: 12 } satisfies Rect,
};

// ---------- Chemical plant + cooling towers ----------
export const COOLING_TOWERS = [
  { x: 296, z: 540, rBase: 14, rWaist: 8.2, rTop: 9.4, h: 42 },
  { x: 296, z: 578, rBase: 13, rWaist: 7.6, rTop: 8.8, h: 38 },
];
export const CHEM = {
  building: { x: 262, z: 568, w: 18, d: 12 } satisfies Rect,
  tanks: [
    { x: 270, z: 528, r: 4.5, h: 12 },
    { x: 270, z: 545, r: 4.5, h: 14 },
  ],
  stack: { x: 252, z: 568, r: 1.3, h: 30 },
};

// ---------- Recycling + scrapyard ----------
export const RECYCLING = {
  shed: { x: 234, z: 538, w: 30, d: 18 } satisfies Rect,
  shedH: 11,
  bales: { x: 232, z: 566, w: 24, d: 14 } satisfies Rect,
};
export const SCRAP = {
  yard: { x: 246, z: 620, w: 58, d: 44 } satisfies Rect,
  crane: { x: 262, z: 620, jib: 16, h: 13 },
  crusher: { x: 258, z: 605, w: 9, d: 6 } satisfies Rect,
};

// ---------- Rail sidings ----------
export const RAIL = {
  tracksX: [284, 295, 306],
  z0: 600,
  z1: 630,
  wagon: { len: 11, r: 1.45 },
};

// ---------- Warehouses ----------
export const WAREHOUSES: (Rect & { h: number; color: string })[] = [
  { x: 188, z: 410, w: 18, d: 30, h: 10, color: "#6e7d86" },
  { x: 188, z: 450, w: 18, d: 32, h: 12, color: "#8a6d55" },
  { x: 187, z: 484, w: 16, d: 14, h: 8, color: "#5f6e5a" },
];

// ---------- Fences (chain-link polylines; gaps are gates) ----------
export const FENCES: V2[][] = [
  // power station plot (gate on the north side for the access road)
  [[160, 394], [106, 394], [100, 403], [100, 505], [176, 505], [176, 394], [174, 394]],
  // refinery (gate on the west side at the cul-de-sac)
  [[220, 446], [220, 390], [312, 390], [312, 487], [306, 494], [220, 494], [220, 459]],
  // steelworks (gate on the east side at the cul-de-sac)
  [[198, 564], [198, 534], [188, 524], [100, 524], [101, 622], [116, 640], [198, 640], [198, 579]],
  // scrapyard (gate on the north side at the cul-de-sac end)
  [[250, 597], [216, 597], [216, 644], [276, 644], [276, 597], [262, 597]],
  // chemical plant + cooling towers
  [[280, 512], [314, 512], [314, 594], [280, 594], [280, 512]],
];

// ---------- Yard lights (sodium) ----------
export const YARD_LIGHTS: V2[] = [
  [178, 386], [232, 387], [300, 388], [216, 470], [216, 425], [200, 395], [200, 470], [104, 470],
  [104, 420], [190, 526], [192, 610], [103, 560], [130, 642], [216, 528], [216, 575], [280, 590],
  [276, 512], [311, 556], [311, 598], [278, 640], [212, 640], [244, 498], [300, 498], [160, 507],
];

// ---------- Hazard-striped barriers (x, z, length, yaw) ----------
export const BARRIERS: [number, number, number, number][] = [
  [166, 420, 7, 0], // power access end
  [241, 452, 7, Math.PI / 2], // refinery gate
  [171, 572, 7, Math.PI / 2], // steelworks gate
  [261, 586, 7, Math.PI / 2], // scrapyard cul-de-sac end
  [195, 388, 5, 0], // north gate, either side of the spine
  [217, 388, 5, 0],
  [193, 642, 5, 0], // south gate
  [213, 642, 5, 0],
];

// ---------- Aviation lights (blinking red) ----------
export const AVIATION_LIGHTS: V3[] = [
  ...CHIMNEYS.map(([x, z]): V3 => [x, CHIMNEY_TOP + 0.9, z]),
  [STEEL.stack.x, STEEL.stack.h + 0.8, STEEL.stack.z],
  [REFINERY.flare.x + 1.6, REFINERY.flare.h - 2, REFINERY.flare.z],
  [REFINERY.columns[0].x, REFINERY.columns[0].h + 1.5, REFINERY.columns[0].z],
  [STEEL.furnace.x, STEEL.furnace.h + 7, STEEL.furnace.z],
  ...COOLING_TOWERS.flatMap((t): V3[] =>
    [0, 1, 2].map((k): V3 => [t.x + Math.cos(k * 2.094) * t.rTop, t.h + 0.6, t.z + Math.sin(k * 2.094) * t.rTop]),
  ),
];

/** Every solid footprint, for overlap / road-clearance tests. */
export function footprints(): { name: string; rect?: Rect; circle?: Circle }[] {
  const out: { name: string; rect?: Rect; circle?: Circle }[] = [
    { name: "power hall", rect: POWER.hall },
    { name: "coal", circle: COAL_PILE },
    { name: "casthouse", rect: STEEL.casthouse },
    { name: "mill", rect: STEEL.mill },
    { name: "ore", circle: STEEL.ore },
    { name: "furnace", circle: STEEL.furnace },
    { name: "steel stack", circle: STEEL.stack },
    { name: "refinery control", rect: REFINERY.control },
    { name: "flare", circle: { ...REFINERY.flare, r: 2.5 } },
    { name: "chem building", rect: CHEM.building },
    { name: "recycling", rect: RECYCLING.shed },
    { name: "bales", rect: RECYCLING.bales },
    { name: "scrapyard", rect: SCRAP.yard },
    ...STEEL.stoves.map((c, i) => ({ name: `stove ${i}`, circle: c })),
    ...REFINERY.columns.map((c, i) => ({ name: `column ${i}`, circle: c })),
    ...REFINERY.spheres.map((c, i) => ({ name: `sphere ${i}`, circle: c })),
    ...REFINERY.tanks.map((c, i) => ({ name: `tank ${i}`, circle: c })),
    ...REFINERY.racks.map((r, i) => ({ name: `rack ${i}`, rect: r })),
    ...COOLING_TOWERS.map((t, i) => ({ name: `cooling ${i}`, circle: { x: t.x, z: t.z, r: t.rBase } })),
    ...CHEM.tanks.map((c, i) => ({ name: `chem tank ${i}`, circle: c })),
    ...WAREHOUSES.map((w, i) => ({ name: `warehouse ${i}`, rect: w })),
    ...RAIL.tracksX.map((x, i) => ({ name: `track ${i}`, rect: { x, z: (RAIL.z0 + RAIL.z1) / 2, w: 3.4, d: RAIL.z1 - RAIL.z0 } })),
  ];
  return out;
}

export const ZONE = ZONES.industrial;

// ---------- time helpers ----------
export const mod = (a: number, n: number) => ((a % n) + n) % n;
const smooth = (t: number) => t * t * (3 - 2 * t);

/** 0 by day, 1 at night, ramps through dusk (17-19) and dawn (5.5-7). */
export function nightFactor(hour: number) {
  const h = mod(hour, 24);
  if (h >= 19 || h <= 5.5) return 1;
  if (h >= 17) return (h - 17) / 2;
  if (h < 7) return 1 - (h - 5.5) / 1.5;
  return 0;
}

/** Aviation lights: a 0.25 s flash every 1.5 s. */
export function aviationOn(t: number) {
  return mod(t, 1.5) < 0.25;
}

/** Furnace flicker in ~0.6..1.15, smooth pseudo-noise from a few sines. */
export function furnaceFlicker(t: number) {
  return 0.85 + 0.12 * Math.sin(t * 7.3) + 0.08 * Math.sin(t * 13.1 + 1.7) + 0.06 * Math.sin(t * 23.7 + 0.4);
}

// ---------- scrapyard crane timeline ----------
export const CRANE_PERIOD = 16;
export const CRANE_PICK_YAW = -1.37; // jib over the wreck piles (west). Jib tip = crane + (sin yaw, cos yaw) * jib
export const CRANE_DROP_YAW = -2.88; // jib over the crusher (north)
export interface CraneState {
  yaw: number;
  cable: number; // cable length below the jib tip, metres
  carrying: boolean;
}
/** Slew to the piles, lower, grab, hoist, slew back, lower into the crusher, release, hoist. */
export function craneAt(t: number, out: CraneState): CraneState {
  const p = mod(t, CRANE_PERIOD);
  const up = 3;
  const down = 11;
  const lerp = (a: number, b: number, u: number) => a + (b - a) * smooth(Math.min(1, Math.max(0, u)));
  if (p < 3.5) {
    out.yaw = lerp(CRANE_DROP_YAW, CRANE_PICK_YAW, p / 3.5);
    out.cable = up;
    out.carrying = false;
  } else if (p < 5.5) {
    out.yaw = CRANE_PICK_YAW;
    out.cable = lerp(up, down, (p - 3.5) / 2);
    out.carrying = false;
  } else if (p < 6.2) {
    out.yaw = CRANE_PICK_YAW;
    out.cable = down;
    out.carrying = p > 5.9;
  } else if (p < 8.2) {
    out.yaw = CRANE_PICK_YAW;
    out.cable = lerp(down, up, (p - 6.2) / 2);
    out.carrying = true;
  } else if (p < 11.7) {
    out.yaw = lerp(CRANE_PICK_YAW, CRANE_DROP_YAW, (p - 8.2) / 3.5);
    out.cable = up;
    out.carrying = true;
  } else if (p < 13.2) {
    out.yaw = CRANE_DROP_YAW;
    out.cable = lerp(up, down - 3, (p - 11.7) / 1.5);
    out.carrying = p < 13.0;
  } else {
    out.yaw = CRANE_DROP_YAW;
    out.cable = lerp(down - 3, up, (p - 13.2) / 2.8);
    out.carrying = false;
  }
  return out;
}
