// Static depot layout: everything that never moves, as instance lists.
// Depot zone: x -60..60, z 240..330. Roads (keep clear): (0,220)->(0,255) gate, gate->(-40,300), gate->(40,300),
// and (-40,300)->(40,300). Roads are 8 m wide. The warehouse sits south of the yard road (z >= 314).
import type { ForkliftRoute } from "./logic";

export type Vec3 = [number, number, number];
export interface Item {
  p: Vec3;
  s: Vec3;
  r?: Vec3;
  c?: string;
}

export const ORANGE = "#ff6a1a";
const DARK = "#3a3f47";
const METAL = "#8e96a0";
const YELLOW = "#ffc21a";
const WOOD = "#b98a55";
const BLACK = "#1d1e22";
const WHITE = "#f1f1ee";
const CARDBOARD = ["#c89b63", "#d4a96f", "#a87b47", "#c08a52", ORANGE, "#ece6d8"];

export const WH = { minX: -56, maxX: 56, front: 314, back: 328.5, h: 12 };
export const DOCK_H = 1.2;
export const BAYS = [-44, -35, -26, -17, 17, 26, 35, 44];
export const OPEN_BAYS = new Set([-44, -26, 17, 35, 44]);
export const GATE = { x: 0, z: 255 };
export const BARRIER = { pivotX: 5.4, y: 1.0, z: 249.5, length: 9.8 };
export const CONVEYOR = { minX: -8.3, maxX: 8.3, z: 309.3, y: 1.01 };
const RACK_X = 55.6;
const RACK_Z0 = 270;
const SLOT = 2.6;
const RACK_LEVELS = [0, 1.57, 3.07];

export const FORKLIFT_ROUTES: ForkliftRoute[] = [
  // west: outdoor rack -> bay -44
  {
    pick: { x: -52.6, z: RACK_Z0 + SLOT * 4.5 },
    pickFace: { x: -1, z: 0 },
    drop: { x: -44, z: 311.2 },
    dropFace: { x: 0, z: 1 },
    mids: [{ x: -50.1, z: 300 }, { x: -47.5, z: 305.5 }],
  },
  // east: outdoor rack -> bay 44
  {
    pick: { x: 52.6, z: RACK_Z0 + SLOT * 6.5 },
    pickFace: { x: 1, z: 0 },
    drop: { x: 44, z: 311.2 },
    dropFace: { x: 0, z: 1 },
    mids: [{ x: 50.1, z: 300 }, { x: 47.5, z: 305.5 }],
  },
  // apron: bay 17 -> bay 35 (cross-docking)
  {
    pick: { x: 17, z: 311.2 },
    pickFace: { x: 0, z: 1 },
    drop: { x: 35, z: 311.2 },
    dropFace: { x: 0, z: 1 },
    mids: [{ x: 20, z: 307 }, { x: 32, z: 307 }],
  },
];

export const MASTS: [number, number][] = [
  [-30, 266],
  [30, 266],
  [-58.4, 302],
  [58.4, 302],
  [0, 277],
];

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DepotLayout {
  solid: Item[]; // per-instance colored boxes
  cyl: Item[]; // per-instance colored cylinders
  doors: Item[]; // closed roller doors
  interior: Item[]; // warm-lit open bay interiors
  lamps: Item[]; // emissive lamp heads, wall packs, gatehouse windows
  signs: Item[]; // "HAMYWAY DELIVERY" planes
  livery: Item[]; // trailer side planes
  fence: Item[]; // translucent mesh panels
  pools: Item[]; // ground light pools (flat unit discs scaled in x/z)
}

export function buildLayout(): DepotLayout {
  const L: DepotLayout = { solid: [], cyl: [], doors: [], interior: [], lamps: [], signs: [], livery: [], fence: [], pools: [] };
  const box = (p: Vec3, s: Vec3, c: string, r?: Vec3) => L.solid.push({ p, s, c, r });
  const cyl = (p: Vec3, s: Vec3, c: string, r?: Vec3) => L.cyl.push({ p, s, c, r });
  const rand = rng(1042);
  const parcelColor = () => CARDBOARD[Math.floor(rand() * CARDBOARD.length)];

  // ---------- Warehouse ----------
  const cz = (WH.front + WH.back) / 2;
  const depth = WH.back - WH.front;
  const width = WH.maxX - WH.minX;
  box([0, DOCK_H / 2, WH.front - 0.05], [width + 0.1, DOCK_H, 0.2], "#50555e"); // dock wall band
  box([0, WH.h - 0.25, WH.front - 0.1], [width + 0.3, 0.5, 0.3], ORANGE); // top band
  for (const sx of [-1, 1]) {
    box([sx * (WH.maxX + 0.05), WH.h - 0.25, cz], [0.3, 0.5, depth + 0.2], ORANGE);
    for (const z of [WH.front, WH.back]) box([sx * WH.maxX, WH.h / 2, z], [0.7, WH.h + 0.1, 0.7], ORANGE);
    // side and back cladding ribs
    for (let z = WH.front + 2; z < WH.back - 1; z += 2.5) box([sx * (WH.maxX + 0.08), WH.h / 2 - 0.3, z], [0.15, WH.h - 1, 0.15], "#c3c7cc");
  }
  for (let x = WH.minX + 2; x < WH.maxX - 1; x += 3) box([x, WH.h / 2 - 0.3, WH.back + 0.08], [0.15, WH.h - 1, 0.15], "#c3c7cc");
  // roof units
  for (const [x, z] of [[-40, 317.5], [40, 317.5], [-24, 326], [24, 326], [-48, 325.5]] as const) {
    box([x, WH.h + 0.6, z], [3.2, 1.2, 2.2], "#b9bec5");
    box([x, WH.h + 1.25, z], [2.6, 0.1, 1.6], DARK);
  }
  for (let x = -52; x <= 52; x += 13) cyl([x, WH.h + 0.5, 320], [0.6, 1, 0.6], "#a3aab3");
  // fascia sign (front, facing north)
  box([0, 9.0, WH.front - 0.07], [32.8, 5.4, 0.12], DARK);
  L.signs.push({ p: [0, 9.0, WH.front - 0.14], s: [32, 5, 1], r: [0, Math.PI, 0] });
  // rooftop billboard (both sides)
  const bbZ = 324.5;
  box([0, WH.h + 5.75, bbZ], [48.8, 7.9, 0.4], DARK);
  L.signs.push({ p: [0, WH.h + 5.75, bbZ - 0.22], s: [48, 7.5, 1], r: [0, Math.PI, 0] });
  L.signs.push({ p: [0, WH.h + 5.75, bbZ + 0.22], s: [48, 7.5, 1] });
  for (let x = -22; x <= 22; x += 11) {
    box([x, WH.h + 1, bbZ], [0.35, 2, 0.35], DARK);
    box([x, WH.h + 1.1, bbZ + 1.3], [0.25, 0.25, 2.8], DARK, [0.75, 0, 0]);
  }
  for (const x of [-24, -8, 8, 24]) L.lamps.push({ p: [x, WH.h + 10.1, bbZ - 0.9], s: [1.6, 0.25, 0.5] }); // billboard floodlights
  // canopy over the dock run
  for (const sx of [-1, 1]) box([sx * 30.5, 6.3, WH.front - 1.4], [30, 0.25, 2.8], DARK);
  // bays
  for (const bx of BAYS) {
    const open = OPEN_BAYS.has(bx);
    box([bx, DOCK_H + 2.2, WH.front - 0.07], [4.9, 4.7, 0.14], "#2b2f35"); // frame / shelter
    if (open) {
      L.interior.push({ p: [bx, DOCK_H + 2.2, WH.front - 0.16], s: [4.2, 4.3, 0.04] });
      box([bx, DOCK_H + 4.25, WH.front - 0.45], [4.5, 0.55, 0.6], METAL); // rolled-up door drum
      // parcels just inside (silhouettes against the light)
      box([bx - 1.2, DOCK_H + 0.45, WH.front - 0.25], [1.0, 0.9, 0.1], "#6b4a2b");
      box([bx + 1.1, DOCK_H + 0.35, WH.front - 0.25], [0.8, 0.7, 0.1], "#6b4a2b");
      L.pools.push({ p: [bx, 0.07, WH.front - 4.5], s: [3.6, 1, 5] });
    } else {
      L.doors.push({ p: [bx, DOCK_H + 2.2, WH.front - 0.16], s: [4.2, 4.3, 0.05] });
    }
    box([bx, DOCK_H - 0.04, WH.front - 1.0], [3.2, 0.12, 2.0], METAL); // dock leveller
    box([bx, DOCK_H - 0.1, WH.front - 2.0], [3.2, 0.06, 0.1], YELLOW); // leveller lip
    for (const sx of [-1, 1]) {
      box([bx + sx * 1.95, 0.8, WH.front - 0.3], [0.4, 0.6, 0.4], BLACK); // bumpers
      cyl([bx + sx * 2.7, 0.55, WH.front - 2.6], [0.28, 1.1, 0.28], YELLOW); // bollards
      box([bx + sx * 2.3, 0.03, WH.front - 5.5], [0.15, 0.02, 6.5], YELLOW); // guide lines
    }
    L.lamps.push({ p: [bx, 6.0, WH.front - 0.6], s: [0.8, 0.12, 0.4] }); // wall pack under canopy
  }

  // ---------- Conveyor (external sortation line) ----------
  const cLen = CONVEYOR.maxX - CONVEYOR.minX;
  for (const sx of [-1, 1]) {
    box([sx * 9.6, 1.5, 311.2], [2.6, 3.0, 5.6], ORANGE); // tunnel into the building
    box([sx * 9.6, 3.05, 311.2], [2.8, 0.12, 5.8], DARK);
    box([sx * 8.28, 1.3, CONVEYOR.z], [0.05, 1.0, 1.3], "#121316"); // mouth
  }
  box([0, 0.8, CONVEYOR.z], [cLen, 0.3, 1.3], DARK);
  box([0, 0.98, CONVEYOR.z], [cLen, 0.06, 1.05], "#202226");
  for (const sz of [-1, 1]) box([0, 1.12, CONVEYOR.z + sz * 0.62], [cLen, 0.12, 0.08], YELLOW);
  for (let x = -7; x <= 7; x += 3.5) for (const sz of [-1, 1]) box([x, 0.35, CONVEYOR.z + sz * 0.5], [0.12, 0.7, 0.12], DARK);

  // ---------- Pallets & parcels ----------
  const pallet = (x: number, y: number, z: number, rotY = 0, layers = 1) => {
    box([x, y + 0.075, z], [1.2, 0.15, 1.0], WOOD, [0, rotY, 0]);
    let top = y + 0.15;
    for (let l = 0; l < layers; l++) {
      const h = 0.5 + rand() * 0.55;
      box([x, top + h / 2, z], [1.1 - rand() * 0.15, h, 0.9 - rand() * 0.1], parcelColor(), [0, rotY + (rand() - 0.5) * 0.08, 0]);
      top += h;
    }
    if (rand() > 0.5) {
      const h = 0.3 + rand() * 0.2;
      box([x + (rand() - 0.5) * 0.4, top + h / 2, z + (rand() - 0.5) * 0.3], [0.45, h, 0.4], parcelColor(), [0, rand() * 1.5, 0]);
    }
  };
  // outdoor racks (west and east) with pallets
  for (const sx of [-1, 1]) {
    const rx = sx * RACK_X;
    const zEnd = RACK_Z0 + SLOT * 10;
    for (let z = RACK_Z0; z <= zEnd + 0.01; z += SLOT)
      for (const dx of [-0.6, 0.6]) box([rx + dx, 2.4, z], [0.12, 4.8, 0.12], "#2f6db5");
    for (const y of [1.5, 3.0, 4.5]) for (const dx of [-0.6, 0.6]) box([rx + dx, y, (RACK_Z0 + zEnd) / 2], [0.1, 0.14, zEnd - RACK_Z0], ORANGE);
    const pickSlot = sx < 0 ? 4 : 6;
    for (let k = 0; k < 10; k++) {
      for (let li = 0; li < RACK_LEVELS.length; li++) {
        if (k === pickSlot && li === 1) continue;
        if (rand() < 0.18) continue;
        pallet(rx, RACK_LEVELS[li], RACK_Z0 + SLOT * (k + 0.5), Math.PI / 2, 1);
      }
    }
  }
  // apron staging stacks
  for (const [x, z] of [[-30.5, 306.8], [-21.5, 306.8], [-39.5, 307], [39.6, 306.6]] as const) {
    pallet(x, 0, z, rand() * 0.3, 1 + Math.floor(rand() * 2));
  }
  // stacks of empty pallets near the trailer park
  for (const [x, z] of [[-34, 250], [-34, 252], [34, 250], [-31.5, 250]] as const) {
    const n = 5 + Math.floor(rand() * 6);
    for (let i = 0; i < n; i++) box([x, 0.075 + i * 0.15, z], [1.2, 0.14, 1.0], i % 3 === 2 ? "#a77a48" : WOOD, [0, (rand() - 0.5) * 0.1, 0]);
  }
  // roll cages of parcels by the conveyor ends
  for (const [x, z] of [[-12.5, 307.6], [12.5, 307.6], [12.5, 305.9]] as const) {
    box([x, 0.95, z], [1.0, 1.7, 0.8], "#9aa3ad");
    box([x, 0.9, z], [0.9, 1.4, 0.7], parcelColor());
  }

  // ---------- Trailer park ----------
  const trailer = (x: number, cab: boolean) => {
    const z0 = 251.5;
    const len = 13.6;
    const zc = z0 + len / 2;
    box([x, 2.75, zc], [2.5, 2.8, len], WHITE);
    box([x, 4.17, zc], [2.52, 0.06, len + 0.02], ORANGE);
    box([x, 1.15, zc], [2.2, 0.3, len - 0.2], DARK);
    for (const sx of [-1, 1]) {
      box([x + sx * 0.8, 0.6, z0 + 2.2], [0.15, 1.2, 0.15], DARK);
      box([x + sx * 0.9, 1.25, z0 + len + 0.02], [0.35, 0.15, 0.05], "#d6242b");
      for (const wz of [z0 + len - 3.6, z0 + len - 2.3]) cyl([x + sx * 1.0, 0.5, wz], [1.0, 0.45, 1.0], BLACK, [0, 0, Math.PI / 2]);
      L.livery.push({ p: [x + sx * 1.262, 2.75, zc], s: [len - 0.2, 2.75, 1], r: [0, (sx * Math.PI) / 2, 0] });
    }
    box([x, 2.75, z0 + len + 0.01], [2.4, 2.7, 0.04], "#dcdcd8"); // rear doors
    if (cab) {
      box([x, 1.9, z0 - 2.6], [2.5, 2.6, 2.4], ORANGE);
      box([x, 2.5, z0 - 3.82], [2.2, 1.0, 0.05], "#2a3a4a");
      box([x, 3.4, z0 - 2.2], [2.3, 0.5, 1.6], ORANGE); // roof fairing
      box([x, 0.75, z0 - 1.2], [2.2, 0.4, 5.0], DARK);
      for (const sx of [-1, 1]) {
        cyl([x + sx * 1.0, 0.5, z0 - 2.9], [1.0, 0.45, 1.0], BLACK, [0, 0, Math.PI / 2]);
        cyl([x + sx * 1.0, 0.5, z0 + 0.6], [1.0, 0.45, 1.0], BLACK, [0, 0, Math.PI / 2]);
      }
      L.lamps.push({ p: [x - 0.85, 1.1, z0 - 3.83], s: [0.35, 0.2, 0.04] });
      L.lamps.push({ p: [x + 0.85, 1.1, z0 - 3.83], s: [0.35, 0.2, 0.04] });
    }
  };
  for (const x of [-54, -48, -42]) trailer(x, x === -48);
  for (const x of [42, 48, 54]) trailer(x, x === 42);

  // ---------- Grass island flags ----------
  for (const [i, x] of [-6, 0, 6].entries()) {
    cyl([x, 4, 292], [0.14, 8, 0.14], WHITE);
    box([x + 1.05, 7.2, 292], [2.0, 1.2, 0.04], i === 1 ? WHITE : ORANGE);
  }

  // ---------- Light masts ----------
  for (const [x, z] of MASTS) {
    cyl([x, 7, z], [0.4, 14, 0.4], METAL);
    box([x, 14.1, z], [3.4, 0.22, 0.22], DARK);
    for (const sx of [-1, 1]) L.lamps.push({ p: [x + sx * 1.1, 13.9, z], s: [1.4, 0.3, 0.9] });
    L.pools.push({ p: [x, 0.07, z], s: [11, 1, 11] });
  }

  // ---------- Gatehouse & barrier ----------
  const gx = 9.5;
  const gz = 248.5;
  box([gx, 1.6, gz], [3.6, 3.2, 4], "#eef0f2");
  box([gx, 3.35, gz], [4.4, 0.3, 4.8], ORANGE);
  box([gx + 1.82, 1.1, gz + 0.9], [0.04, 2.2, 1.0], DARK);
  L.lamps.push({ p: [gx - 1.82, 2.0, gz], s: [0.04, 1.1, 3.2] });
  L.lamps.push({ p: [gx, 2.0, gz - 2.02], s: [2.8, 1.1, 0.04] });
  L.lamps.push({ p: [gx, 2.0, gz + 2.02], s: [2.8, 1.1, 0.04] });
  box([BARRIER.pivotX, 0.5, BARRIER.z], [0.5, 1.0, 0.5], YELLOW);
  box([BARRIER.pivotX + 0.05, BARRIER.y, BARRIER.z], [0.7, 0.45, 0.75], DARK);
  box([BARRIER.pivotX - BARRIER.length + 0.1, 0.45, BARRIER.z], [0.2, 0.9, 0.2], YELLOW);
  // speed bumps either side of the barrier
  for (const z of [246.5, 252.5]) box([0, 0.06, z], [7.6, 0.1, 0.5], YELLOW);
  // entrance sign
  const sx0 = -12;
  const sz0 = 246.2;
  for (const dx of [-3.6, 3.6]) box([sx0 + dx, 1.4, sz0], [0.25, 2.8, 0.25], ORANGE);
  box([sx0, 2.6, sz0], [8.2, 1.45, 0.12], DARK);
  L.signs.push({ p: [sx0, 2.6, sz0 - 0.07], s: [8, 1.25, 1], r: [0, Math.PI, 0] });
  L.signs.push({ p: [sx0, 2.6, sz0 + 0.07], s: [8, 1.25, 1] });

  // ---------- Perimeter fence ----------
  const fenceSeg = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const ry = Math.atan2(-(z1 - z0), x1 - x0);
    const mx = (x0 + x1) / 2;
    const mz = (z0 + z1) / 2;
    const n = Math.max(1, Math.round(len / 3));
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      box([x0 + (x1 - x0) * u, 1.1, z0 + (z1 - z0) * u], [0.12, 2.2, 0.12], "#6f7782");
    }
    box([mx, 2.15, mz], [len, 0.08, 0.08], "#6f7782", [0, ry, 0]);
    box([mx, 0.15, mz], [len, 0.08, 0.08], "#6f7782", [0, ry, 0]);
    L.fence.push({ p: [mx, 1.15, mz], s: [len, 1.95, 0.03], r: [0, ry, 0] });
  };
  fenceSeg(-60, 243, -6, 243);
  fenceSeg(6, 243, 60, 243);
  fenceSeg(-60, 243, -60, 330);
  fenceSeg(60, 243, 60, 330);
  fenceSeg(-60, 330, 60, 330);

  return L;
}

/** Forklift parts in the forklift's local frame (+z = forks). `lift`: rides the fork carriage; `load`: only when loaded. */
export interface Part extends Item {
  lift?: boolean;
  load?: boolean;
}

export const FORKLIFT_BOXES: Part[] = [
  { p: [0, 0.72, -0.1], s: [1.2, 0.85, 1.9], c: ORANGE },
  { p: [0, 0.75, -1.15], s: [1.25, 0.9, 0.5], c: "#2b2f35" },
  { p: [0, 1.3, -0.45], s: [0.6, 0.3, 0.5], c: BLACK },
  { p: [0, 1.75, -0.35], s: [0.48, 0.62, 0.36], c: "#ffd23f" }, // hi-vis driver
  { p: [0, 2.2, -0.33], s: [0.28, 0.28, 0.28], c: "#e0b48f" },
  { p: [0, 2.5, -0.1], s: [1.2, 0.08, 1.45], c: "#2b2f35" },
  { p: [0.55, 1.85, 0.55], s: [0.08, 1.3, 0.08], c: "#2b2f35" },
  { p: [-0.55, 1.85, 0.55], s: [0.08, 1.3, 0.08], c: "#2b2f35" },
  { p: [0.55, 1.85, -0.75], s: [0.08, 1.3, 0.08], c: "#2b2f35" },
  { p: [-0.55, 1.85, -0.75], s: [0.08, 1.3, 0.08], c: "#2b2f35" },
  { p: [0.4, 1.4, 0.98], s: [0.12, 2.5, 0.12], c: "#4a4f57" },
  { p: [-0.4, 1.4, 0.98], s: [0.12, 2.5, 0.12], c: "#4a4f57" },
  { p: [0, 0.45, 1.08], s: [1.0, 0.5, 0.08], c: "#2b2f35", lift: true },
  { p: [0.25, 0.22, 1.65], s: [0.12, 0.05, 1.1], c: "#4a4f57", lift: true },
  { p: [-0.25, 0.22, 1.65], s: [0.12, 0.05, 1.1], c: "#4a4f57", lift: true },
  { p: [0, 0.32, 1.7], s: [1.1, 0.14, 1.0], c: WOOD, lift: true, load: true },
  { p: [0, 0.8, 1.7], s: [1.0, 0.82, 0.9], c: "#c89b63", lift: true, load: true },
  { p: [0, 1.32, 1.6], s: [0.5, 0.22, 0.4], c: ORANGE, lift: true, load: true },
  { p: [0, 2.6, -0.6], s: [0.18, 0.12, 0.18], c: "#ffb020" }, // beacon
];

export const FORKLIFT_WHEELS: Part[] = [
  { p: [0.6, 0.32, 0.55], s: [0.64, 0.25, 0.64], r: [0, 0, Math.PI / 2] },
  { p: [-0.6, 0.32, 0.55], s: [0.64, 0.25, 0.64], r: [0, 0, Math.PI / 2] },
  { p: [0.6, 0.28, -0.8], s: [0.56, 0.22, 0.56], r: [0, 0, Math.PI / 2] },
  { p: [-0.6, 0.28, -0.8], s: [0.56, 0.22, 0.56], r: [0, 0, Math.PI / 2] },
];

export const PARCEL_COLORS = CARDBOARD;
