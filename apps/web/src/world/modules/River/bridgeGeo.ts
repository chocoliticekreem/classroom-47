// Bridge structures. Every bridge runs north-south (along z) at its x; the road surface itself is drawn by
// the Roads module (vehicles drive at y = 0), so here we build everything around it: sidewalks, parapets,
// towers, cables, arches, piers, lamps. Static parts merge into one vertex-coloured geometry; Tower Bridge's
// bascule leaves and the wobbly footbridge are separate so they can move.
import * as THREE from "three";
import { ABUT, BRIDGES, type BridgeSpec } from "../../districts/bridges";
import { GeoBuilder } from "./builder";
import { GAPS } from "./gaps";
import { HALF_W, centreZ } from "./path";

export interface LightPoint {
  x: number;
  y: number;
  z: number;
  s: number;
}

export interface BridgeBuild {
  /** All static structure, vertex coloured. */
  geometry: THREE.BufferGeometry;
  /** Fairy lights / lanterns that glow at night. */
  lights: LightPoint[];
  /** Footbridge (separate mesh: wobble shader), in world coords. */
  foot: THREE.BufferGeometry;
  footSpan: { x: number; z0: number; z1: number };
  /** Tower Bridge leaf geometry in hinge-local space (extends along +z from the hinge), and hinges. */
  leaf: THREE.BufferGeometry;
  tower: { x: number; c: number; hingeN: number; hingeS: number; leafLen: number; leafHalfW: number };
  /** Coast Lift Bridge: the span (local to (x, 0, c)) rises vertically between four lattice towers. */
  liftSpan: THREE.BufferGeometry;
  lift: { x: number; c: number; half: number; halfW: number; maxY: number };
  /** Where boats are hidden (they're "under" the deck): [x0, x1, z0, z1] per bridge. */
  footprints: [number, number, number, number][];
}

const PORTLAND = "#d3c7ab";
const PORTLAND_DK = "#b8ab8e";
const SLATE = "#4a5663";
const TB_BLUE = "#5b9bd5";
const TB_BLUE_DK = "#3f78ad";
const PAVE = "#bdb6a8";
const PARAPET = "#d9d3c4";

function sidesAndParapets(B: GeoBuilder, b: BridgeSpec, c: number, opts: { parapet?: string; fascia?: string; walk?: string; z0?: number; z1?: number; roadHalf?: number } = {}) {
  const z0 = opts.z0 ?? c - ABUT;
  const z1 = opts.z1 ?? c + ABUT;
  const len = z1 - z0;
  const zc = (z0 + z1) / 2;
  const roadHalf = opts.roadHalf ?? 4.15;
  const hw = b.halfWidth;
  const walkW = hw - roadHalf - 0.4;
  for (const sx of [-1, 1]) {
    // sidewalk
    if (walkW > 0.3) B.box(b.x + sx * (roadHalf + walkW / 2), 0.11, zc, walkW, 0.22, len, opts.walk ?? PAVE);
    // parapet
    B.box(b.x + sx * (hw - 0.2), 0.65, zc, 0.4, 1.3, len, opts.parapet ?? PARAPET);
    // fascia / edge girder
    B.box(b.x + sx * (hw + 0.12), 0.15, zc, 0.25, 0.75, len, opts.fascia ?? "#8d8a84");
  }
  // abutment blocks where the deck meets each embankment wall
  for (const sz of [-1, 1]) {
    const z = c + sz * (HALF_W + 0.7);
    for (const sx of [-1, 1]) B.box(b.x + sx * (hw + 0.9), 1.4, z, 1.6, 2.8, 2.6, PORTLAND_DK);
  }
}

/** Quadratic bezier helper (y-z plane at fixed x). */
function bez(p0: number[], p1: number[], p2: number[], t: number): [number, number] {
  const u = 1 - t;
  return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]];
}

/** A chain/cable as beam segments along a quadratic bezier in (z, y) at x; returns sampled points. */
function chain(B: GeoBuilder, x: number, p0: number[], p1: number[], p2: number[], thick: number, color: string, segs = 12) {
  const pts: [number, number][] = [];
  for (let k = 0; k <= segs; k++) pts.push(bez(p0, p1, p2, k / segs));
  for (let k = 0; k < segs; k++) B.beam(x, pts[k][1], pts[k][0], x, pts[k + 1][1], pts[k + 1][0], thick, thick, color);
  return pts;
}

/** y on a polyline of (z, y) points at z. */
function yOn(pts: [number, number][], z: number) {
  for (let k = 0; k + 1 < pts.length; k++) {
    const [za, ya] = pts[k];
    const [zb, yb] = pts[k + 1];
    if ((z - za) * (z - zb) <= 0) return ya + ((yb - ya) * (z - za)) / (zb - za || 1);
  }
  return pts[pts.length - 1][1];
}

function hangers(B: GeoBuilder, x: number, pts: [number, number][], z0: number, z1: number, step: number, deckY: number, color: string) {
  const lo = Math.min(z0, z1);
  const hi = Math.max(z0, z1);
  for (let z = lo + step / 2; z < hi; z += step) {
    const y = yOn(pts, z);
    if (y - deckY > 0.4) B.beam(x, deckY, z, x, y, z, 0.07, 0.07, color);
  }
}

function lightsAlong(out: LightPoint[], x: number, pts: [number, number][], every: number, s = 0.35) {
  let acc = 0;
  for (let k = 0; k + 1 < pts.length; k++) {
    const [za, ya] = pts[k];
    const [zb, yb] = pts[k + 1];
    const L = Math.hypot(zb - za, yb - ya);
    for (let d = every - acc; d < L; d += every) {
      const t = d / L;
      out.push({ x, y: ya + (yb - ya) * t + 0.3, z: za + (zb - za) * t, s });
    }
    acc = (acc + L) % every;
  }
}

// ---- styles -------------------------------------------------------------------------------------

function viaduct(B: GeoBuilder, L: LightPoint[], b: BridgeSpec, c: number) {
  sidesAndParapets(B, b, c, { parapet: "#c9c6be", fascia: "#9a978f", walk: "#a9a59c", roadHalf: 6.6 });
  // heavy box-girder fascia and pier noses poking out of the water on both sides
  for (const sx of [-1, 1]) B.box(b.x + sx * (b.halfWidth + 0.5), -0.1, c, 0.6, 1.2, 2 * ABUT, "#8e8b84");
  for (const dz of [-24, -8, 8, 24]) {
    for (const sx of [-1, 1]) {
      B.box(b.x + sx * (b.halfWidth + 1.4), 0.5, c + dz, 2.0, 1.0, 3.4, "#8e8b84");
      B.cone(b.x + sx * (b.halfWidth + 2.6), 0.5, c + dz, 1.7, 1.0, "#8e8b84", 4);
    }
  }
  // tall motorway lighting columns down the central reservation
  for (let dz = -36; dz <= 36; dz += 18) {
    B.cyl(b.x, 6, c + dz, 0.14, 0.2, 12, "#8c949c", 6);
    B.box(b.x, 11.9, c + dz, 5, 0.15, 0.2, "#8c949c");
    L.push({ x: b.x - 2.4, y: 11.6, z: c + dz, s: 0.6 }, { x: b.x + 2.4, y: 11.6, z: c + dz, s: 0.6 });
  }
}

function suspension(B: GeoBuilder, L: LightPoint[], b: BridgeSpec, c: number) {
  sidesAndParapets(B, b, c, { parapet: "#f1ece0", fascia: "#e3a3b4" });
  const TOWER = "#f0e6d8";
  const PINK = "#e3a3b4";
  const towerZ = [c - 21, c + 21];
  const top = 22;
  for (const tz of towerZ) {
    for (const sx of [-1, 1]) {
      const x = b.x + sx * (b.halfWidth + 0.6);
      B.box(x, 0.4, tz, 2.6, 0.8, 4.2, "#9a9284"); // pier
      B.box(x, top / 2, tz, 1.1, top, 1.6, TOWER);
      B.box(x, top / 2, tz, 1.25, top * 0.25, 1.75, PINK);
      B.cone(x, top + 1.2, tz, 1.1, 2.4, PINK, 4);
      L.push({ x, y: top + 2.6, z: tz, s: 0.5 });
    }
    for (const y of [top - 4, top - 1]) B.box(b.x, y, tz, 2 * b.halfWidth + 1.2, 0.7, 0.9, PINK);
  }
  for (const sx of [-1, 1]) {
    const x = b.x + sx * (b.halfWidth + 0.6);
    const anchorN = [c - ABUT + 1, 1.4];
    const anchorS = [c + ABUT - 1, 1.4];
    const tN = [towerZ[0], top - 0.5];
    const tS = [towerZ[1], top - 0.5];
    const main = chain(B, x, tN, [c, 0.2], tS, 0.28, "#f6f1e6", 14);
    const sideN = chain(B, x, anchorN, [(anchorN[0] + tN[0]) / 2, 6], tN, 0.26, "#f6f1e6", 6);
    const sideS = chain(B, x, tS, [(anchorS[0] + tS[0]) / 2, 6], anchorS, 0.26, "#f6f1e6", 6);
    // Albert Bridge also has straight stays fanning from the tower tops
    for (const tz of towerZ) for (const dz of [-14, -9, 9, 14]) B.beam(x, top - 1.5, tz, x, 0.4, tz + dz, 0.08, 0.08, "#f6f1e6");
    hangers(B, x, main, towerZ[0], towerZ[1], 2.5, 0.3, "#f6f1e6");
    hangers(B, x, sideN, anchorN[0], tN[0], 2.5, 0.3, "#f6f1e6");
    hangers(B, x, sideS, tS[0], anchorS[0], 2.5, 0.3, "#f6f1e6");
    lightsAlong(L, x, main, 2.2, 0.28);
    lightsAlong(L, x, sideN, 2.2, 0.28);
    lightsAlong(L, x, sideS, 2.2, 0.28);
  }
}

function arch(B: GeoBuilder, L: LightPoint[], b: BridgeSpec, c: number) {
  sidesAndParapets(B, b, c, { parapet: "#c43f2a", fascia: "#a83322" });
  const RED = "#d0452c";
  const span = HALF_W + 2;
  const apex = 21;
  const pts: [number, number][] = [];
  for (let k = 0; k <= 16; k++) {
    const t = -1 + (2 * k) / 16;
    pts.push([c + t * span, apex * (1 - t * t) + 0.3]);
  }
  for (const sx of [-1, 1]) {
    const x = b.x + sx * (b.halfWidth + 0.3);
    for (let k = 0; k < 16; k++) B.beam(x, pts[k][1], pts[k][0], x, pts[k + 1][1], pts[k + 1][0], 0.9, 1.4, RED);
    hangers(B, x, pts, c - span, c + span, 4, 0.4, "#e8e4dc");
    lightsAlong(L, x + sx * 0.5, pts, 2.6, 0.3);
    // springing blocks on the banks
    for (const sz of [-1, 1]) B.box(x, 0.8, c + sz * span, 2.2, 1.6, 3, "#9a9284");
  }
  // wind bracing between the two arch ribs, near the crown
  for (let k = 3; k <= 13; k += 2) {
    const [z, y] = pts[k];
    if (y < 11) continue;
    B.box(b.x, y + 0.2, z, 2 * b.halfWidth + 0.6, 0.45, 0.45, RED);
    if (k + 2 <= 13) B.beam(b.x - b.halfWidth, y + 0.2, z, b.x + b.halfWidth, pts[k + 2][1] + 0.2, pts[k + 2][0], 0.25, 0.25, RED);
  }
}

function stone(B: GeoBuilder, L: LightPoint[], b: BridgeSpec, c: number) {
  const GREEN = "#3f7d5c";
  sidesAndParapets(B, b, c, { parapet: GREEN, fascia: "#5c8f73" });
  // five shallow arches: piers with pointed cutwaters both sides
  for (const dz of [-21, -7, 7, 21]) {
    for (const sx of [-1, 1]) {
      B.box(b.x + sx * (b.halfWidth + 0.9), 0.55, c + dz, 1.8, 1.1, 3.6, PORTLAND_DK);
      B.cone(b.x + sx * (b.halfWidth + 2.3), 0.55, c + dz, 1.8, 1.1, PORTLAND_DK, 4);
    }
  }
  // arch spandrel trim along the fascia: shallow arcs painted on (little stone blocks)
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 5; k++) {
      const z0 = c - 35 + k * 14;
      for (let q = 1; q < 7; q++) {
        const t = q / 7;
        const y = 0.05 + 0.5 * Math.sin(Math.PI * t);
        B.box(b.x + sx * (b.halfWidth + 0.27), y, z0 + t * 14, 0.08, 0.14, 1.6, "#e2d9b8");
      }
    }
  }
  // Gothic triple-lantern lamp standards along both parapets
  for (let dz = -40; dz <= 40; dz += 10) {
    for (const sx of [-1, 1]) {
      const x = b.x + sx * (b.halfWidth - 0.2);
      B.cyl(x, 2.6, c + dz, 0.09, 0.18, 4.0, "#26412f", 6);
      B.box(x, 4.2, c + dz, 0.12, 0.12, 1.6, "#26412f");
      L.push({ x, y: 4.85, z: c + dz, s: 0.45 }, { x, y: 4.35, z: c + dz - 0.75, s: 0.38 }, { x, y: 4.35, z: c + dz + 0.75, s: 0.38 });
    }
  }
}

function towerBridge(B: GeoBuilder, L: LightPoint[], b: BridgeSpec, c: number) {
  const x = b.x;
  const leafEdge = 15; // bascule leaves meet at c; towers' inner faces at c +- 15
  const tD = 10; // tower depth along z
  const tW = 9.6; // tower half width in x
  const portal = 6.1; // portal half width
  const bodyH = 44;
  // side spans: outside the towers to the abutments
  sidesAndParapets(B, b, c, { parapet: TB_BLUE, fascia: TB_BLUE_DK, z0: c - ABUT, z1: c - leafEdge - tD });
  sidesAndParapets(B, b, c, { parapet: TB_BLUE, fascia: TB_BLUE_DK, z0: c + leafEdge + tD, z1: c + ABUT });
  for (const sz of [-1, 1]) {
    const zc = c + sz * (leafEdge + tD / 2);
    // pier in the river
    B.box(x, 0.4, zc, 2 * tW + 4, 0.8, tD + 5, "#9a9284");
    B.cone(x, 0.4, zc + sz * 0, tW + 1, 0.8, "#9a9284", 4, Math.PI / 4);
    // legs either side of the road portal
    for (const sx of [-1, 1]) {
      const lx = x + sx * (portal + (tW - portal) / 2);
      B.box(lx, bodyH / 2, zc, tW - portal, bodyH, tD, PORTLAND);
      // corner turrets
      for (const tz of [-1, 1]) {
        const cx = x + sx * (tW - 0.4);
        const cz = zc + tz * (tD / 2 - 0.4);
        B.box(cx, (bodyH + 6) / 2, cz, 2.6, bodyH + 6, 2.6, PORTLAND_DK);
        B.cone(cx, bodyH + 6 + 2.6, cz, 2.0, 5.2, SLATE, 4);
        B.cyl(cx, bodyH + 6 + 5.6, cz, 0.06, 0.06, 1.2, "#d4af37", 4);
        L.push({ x: cx, y: bodyH + 6.3, z: cz, s: 0.5 });
      }
      // arched windows (dark slits) on the outer faces
      for (const wy of [14, 22, 30, 38]) {
        B.box(x + sx * (tW + 0.05), wy, zc, 0.12, 3.2, 1.6, "#2a3440");
        L.push({ x: x + sx * (tW + 0.2), y: wy, z: zc, s: 0.32 });
      }
    }
    // lintel over the portal and the upper body
    B.box(x, (bodyH + 9) / 2, zc, 2 * portal, bodyH - 9, tD, PORTLAND);
    // gothic pointed arch trim over the portal, both faces
    for (const fz of [-1, 1]) B.box(x, 8.4, zc + fz * (tD / 2 + 0.05), 2 * portal - 0.6, 0.8, 0.15, PORTLAND_DK);
    // big central slate spire
    B.cone(x, bodyH + 5, zc, tW - 1.5, 10, SLATE, 4);
    B.cyl(x, bodyH + 11, zc, 0.1, 0.1, 2, "#d4af37", 4);
    // the portal ceiling soffit, dark so the opening reads
    B.box(x, 8.9, zc, 2 * portal - 0.1, 0.2, tD - 0.2, "#4a4236");
  }
  // high-level walkways between the tower tops (blue lattice)
  for (const sx of [-1, 1]) {
    const wx = x + sx * 5.4;
    B.box(wx, bodyH - 3, c, 3.2, 4.2, 2 * leafEdge, TB_BLUE);
    for (let k = -6; k <= 6; k++) B.box(wx + sx * 1.62, bodyH - 3, c + k * 2.2, 0.06, 3.2, 1.2, "#2b4c6e");
    // light strips along the walkways
    for (let k = -7; k <= 7; k++) L.push({ x: wx + sx * 1.7, y: bodyH - 0.8, z: c + k * 2, s: 0.22 });
  }
  // suspension chains on the side spans: tower top -> dips -> shore pylon
  for (const sz of [-1, 1]) {
    const tz = c + sz * (leafEdge + tD);
    const pz = c + sz * (ABUT + 2);
    for (const sx of [-1, 1]) {
      const cx = x + sx * (b.halfWidth + 0.2);
      // shore pylon
      B.box(cx, 6, pz, 2.4, 12, 2.4, PORTLAND);
      B.cone(cx, 13.3, pz, 1.8, 2.6, SLATE, 4);
      L.push({ x: cx, y: 12.4, z: pz, s: 0.45 });
      const pts = chain(B, cx, [tz, 30], [(tz + pz) / 2, -4], [pz, 11], 0.7, TB_BLUE, 12);
      hangers(B, cx, pts, tz, pz, 2.2, 0.5, TB_BLUE_DK);
      lightsAlong(L, cx + sx * 0.4, pts, 1.8, 0.26);
    }
  }
}

const ORANGE = "#e2672a";
const ORANGE_DK = "#b94f1c";
export const LIFT_HALF = 37; // half length of the lifting span
export const LIFT_MAX_Y = 46;

/** Coast Lift Bridge towers: four orange lattice towers either side of the channel, linked high up. */
function liftTowers(B: GeoBuilder, L: LightPoint[], b: BridgeSpec, c: number) {
  const H = LIFT_MAX_Y + 12;
  sidesAndParapets(B, b, c, { parapet: "#c9c6be", fascia: ORANGE_DK, roadHalf: 6.6, z0: c - ABUT, z1: c - LIFT_HALF - 0.5 });
  sidesAndParapets(B, b, c, { parapet: "#c9c6be", fascia: ORANGE_DK, roadHalf: 6.6, z0: c + LIFT_HALF + 0.5, z1: c + ABUT });
  for (const sz of [-1, 1]) {
    const tz = c + sz * (LIFT_HALF + 2.2);
    B.box(b.x, 0.5, tz, 2 * b.halfWidth + 8, 1.0, 6.5, "#8e8b84"); // pier
    for (const sx of [-1, 1]) {
      const tx = b.x + sx * (b.halfWidth + 1.6);
      // four corner chords of a lattice tower + cross bracing
      for (const ox of [-1, 1])
        for (const oz of [-1, 1]) B.box(tx + ox * 1.1, H / 2, tz + oz * 1.4, 0.35, H, 0.35, ORANGE);
      for (let y = 3; y < H; y += 4.5) {
        B.box(tx, y, tz - 1.4, 2.2, 0.18, 0.18, ORANGE_DK);
        B.box(tx, y, tz + 1.4, 2.2, 0.18, 0.18, ORANGE_DK);
        B.beam(tx - 1.1, y, tz - 1.4, tx + 1.1, y + 4.5, tz - 1.4, 0.12, 0.12, ORANGE_DK);
        B.beam(tx - 1.1, y, tz + 1.4, tx + 1.1, y + 4.5, tz + 1.4, 0.12, 0.12, ORANGE_DK);
        B.box(tx - 1.1, y, tz, 0.18, 0.18, 2.8, ORANGE_DK);
        B.box(tx + 1.1, y, tz, 0.18, 0.18, 2.8, ORANGE_DK);
      }
      // machinery house + sheave on top
      B.box(tx, H + 1.2, tz, 3.4, 2.4, 4.2, "#e9e5db");
      B.cyl(tx, H + 2.6, tz, 1.4, 1.4, 0.5, "#3a3d42", 10, 0, 0, Math.PI / 2);
      L.push({ x: tx, y: H + 3.2, z: tz, s: 0.6 }); // aviation light
    }
    // portal girder between each pair of towers
    B.box(b.x, H - 0.5, tz, 2 * b.halfWidth + 5, 1.6, 1.2, ORANGE);
    for (let k = -4; k <= 4; k++) L.push({ x: b.x + k * 2.2, y: H + 0.5, z: tz, s: 0.25 });
  }
}

/** The lifting span in local coords centred on (x, 0, c): deck at road level plus a Warren truss each side. */
function liftSpanGeometry(halfW: number) {
  const B = new GeoBuilder();
  const len = 2 * LIFT_HALF;
  B.box(0, -0.35, 0, 2 * halfW, 0.88, len, "#33353c"); // deck, top at 0.09
  B.box(0, 0.35, 0, 0.5, 0.6, len, "#c9c6be"); // central barrier
  for (const sx of [-1, 1]) {
    for (let z = -LIFT_HALF + 2; z < LIFT_HALF - 2; z += 4) B.box(sx * 3.05, 0.1, z + 1, 0.15, 0.02, 2, "#f4f3ee");
    const tx = sx * (halfW + 0.2);
    B.box(tx, 4.2, 0, 0.5, 0.5, len, ORANGE); // top chord
    B.box(tx, 0.3, 0, 0.5, 0.6, len, ORANGE); // bottom chord
    for (let k = 0; k < 12; k++) {
      const z0 = -LIFT_HALF + (k * len) / 12;
      const z1 = -LIFT_HALF + ((k + 1) * len) / 12;
      if (k % 2) B.beam(tx, 0.4, z0, tx, 4.2, z1, 0.3, 0.3, ORANGE_DK);
      else B.beam(tx, 4.2, z0, tx, 0.4, z1, 0.3, 0.3, ORANGE_DK);
    }
  }
  for (let z = -LIFT_HALF + 3; z < LIFT_HALF; z += 6) B.box(0, 4.3, z, 2 * halfW + 0.4, 0.25, 0.3, ORANGE_DK);
  return B.build();
}

/** The wobbly footbridge: low aluminium deck, Y-arm piers, cables sagging alongside. World coords. */
function footbridge(b: BridgeSpec, c: number, L: LightPoint[]) {
  const B = new GeoBuilder();
  const z0 = c - HALF_W - 14;
  const z1 = c + HALF_W + 14;
  const deckY = 0.85;
  const ALU = "#cfd6dc";
  B.box(b.x, deckY - 0.12, c, 2 * b.halfWidth, 0.24, z1 - z0, "#9aa3ab");
  B.box(b.x, deckY + 0.01, c, 2 * b.halfWidth - 0.4, 0.04, z1 - z0, "#d9d0bd");
  for (const sx of [-1, 1]) {
    B.box(b.x + sx * (b.halfWidth - 0.05), deckY + 0.55, c, 0.1, 1.1, z1 - z0, "#e9eef2"); // glass-ish balustrade
    // cables either side, sagging between the arm tips and the abutments
    const cx = b.x + sx * (b.halfWidth + 3.6);
    const pts: [number, number][] = [];
    const towers = [z0, c - 26, c + 26, z1];
    for (let k = 0; k + 1 < towers.length; k++) {
      const seg = chain(B, cx, [towers[k], 2.6], [(towers[k] + towers[k + 1]) / 2, 0.7], [towers[k + 1], 2.6], 0.22, ALU, 8);
      pts.push(...seg);
    }
    lightsAlong(L, cx, pts, 3.2, 0.22);
    // transverse arms every 8 m tying the cables to the deck
    for (let z = z0 + 4; z < z1; z += 8) B.box(b.x + sx * (b.halfWidth + 1.8), deckY - 0.05, z, 3.6, 0.18, 0.3, ALU);
  }
  // Y-shaped piers
  for (const pz of [c - 26, c + 26]) {
    B.box(b.x, 0.4, pz, 2.4, 0.8, 3.0, "#9a9284");
    for (const sx of [-1, 1]) B.beam(b.x, 0.5, pz, b.x + sx * (b.halfWidth + 3.6), 2.6, pz, 0.6, 0.6, ALU);
  }
  // ramps down onto the promenades
  for (const sz of [-1, 1]) B.box(b.x, deckY / 2, sz > 0 ? z1 + 2 : z0 - 2, 2 * b.halfWidth, deckY, 4, "#bdb6a8");
  return { geo: B.build(), z0: z0 - 4, z1: z1 + 4 };
}

/** One bascule leaf in hinge-local space: extends along +z from the hinge, deck top at y 0.09. */
function leafGeometry(len: number, halfW: number) {
  const B = new GeoBuilder();
  B.box(0, -0.25, len / 2, 2 * halfW, 0.68, len, "#3a3d45"); // asphalt deck (top at 0.09)
  for (let z = 1; z < len - 1; z += 3) B.box(0, 0.1, z + 0.75, 0.15, 0.02, 1.5, "#f4f3ee");
  for (const sx of [-1, 1]) {
    B.box(sx * (halfW - 1), 0.17, len / 2, 2, 0.16, len, PAVE); // footways
    B.box(sx * (halfW + 0.15), 0.55, len / 2, 0.35, 1.5, len, TB_BLUE); // side girders / parapets
    for (let z = 1.5; z < len; z += 2.5) B.box(sx * (halfW + 0.36), 0.55, z, 0.06, 1.2, 0.18, TB_BLUE_DK);
  }
  // underside counterweight box at the hinge
  B.box(0, -1.4, 1.2, 2 * halfW - 1, 1.8, 2.4, "#5a6068");
  return B.build();
}

export function buildBridges(): BridgeBuild {
  const B = new GeoBuilder();
  const lights: LightPoint[] = [];
  const footprints: BridgeBuild["footprints"] = [];
  let foot: { geo: THREE.BufferGeometry; z0: number; z1: number } | null = null;
  let footX = 0;
  let tower: BridgeBuild["tower"] | null = null;
  let lift: BridgeBuild["lift"] | null = null;
  for (const b of BRIDGES) {
    const c = centreZ(b.x);
    const pad = { viaduct: 5, suspension: 2.5, arch: 2.5, footbridge: 5, stone: 5, tower: 5, lift: 4 }[b.style];
    footprints.push([b.x - b.halfWidth - pad, b.x + b.halfWidth + pad, c - HALF_W - 6, c + HALF_W + 6]);
    switch (b.style) {
      case "viaduct":
        viaduct(B, lights, b, c);
        break;
      case "suspension":
        suspension(B, lights, b, c);
        break;
      case "arch":
        arch(B, lights, b, c);
        break;
      case "stone":
        stone(B, lights, b, c);
        break;
      case "footbridge":
        foot = footbridge(b, c, lights);
        footX = b.x;
        break;
      case "lift":
        liftTowers(B, lights, b, c);
        lift = { x: b.x, c, half: LIFT_HALF, halfW: b.halfWidth - 0.6, maxY: LIFT_MAX_Y };
        break;
      case "tower":
        towerBridge(B, lights, b, c);
        tower = { x: b.x, c, hingeN: c - 15, hingeS: c + 15, leafLen: 15, leafHalfW: 5.9 };
        break;
    }
  }
  for (const [x0, x1] of GAPS) {
    if (BRIDGES.some((b) => b.x >= x0 && b.x <= x1)) continue;
    const cz = centreZ((x0 + x1) / 2);
    footprints.push([x0, x1, cz - HALF_W - 30, cz + HALF_W + 30]);
  }
  const t = tower!;
  return {
    geometry: B.build(),
    lights,
    foot: foot!.geo,
    footSpan: { x: footX, z0: foot!.z0, z1: foot!.z1 },
    leaf: leafGeometry(t.leafLen, t.leafHalfW),
    tower: t,
    liftSpan: liftSpanGeometry(lift!.halfW + 0.6),
    lift: lift!,
    footprints,
  };
}
