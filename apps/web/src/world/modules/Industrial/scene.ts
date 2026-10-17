// Industrial: builds every static part of the estate into a handful of merged geometries (one draw call each).
import * as THREE from "three";
import {
  AVIATION_LIGHTS,
  BARRIERS,
  CHEM,
  CHIMNEYS,
  COAL_PILE,
  COOLING_TOWERS,
  FENCES,
  POWER,
  RAIL,
  RECYCLING,
  REFINERY,
  SCRAP,
  STEEL,
  WAREHOUSES,
  YARD_LIGHTS,
  ZONE,
  rng,
  type V2,
  type V3,
} from "./layout";
import { Kit, coolingTowerShell, flutedChimney, jitter, trs } from "./kit";

export interface IndustrialScene {
  solid: THREE.BufferGeometry; // vertex-coloured, flat shaded
  shells: THREE.BufferGeometry; // cooling towers (double sided)
  windows: THREE.BufferGeometry; // glow at night
  glow: THREE.BufferGeometry; // molten iron, tapping hole (flickers)
  lampHeads: THREE.BufferGeometry;
  pools: THREE.BufferGeometry; // sodium light pools on the ground (additive)
  aviation: THREE.BufferGeometry;
  fence: THREE.BufferGeometry; // uv: chain-link
  hazard: THREE.BufferGeometry; // uv: hazard stripes
  ground: THREE.BufferGeometry; // uv + colour: gritty yard surface
  belt: THREE.BufferGeometry; // uv: conveyor belt (scrolls)
  flame: THREE.BufferGeometry; // uv: flare flame (shader), local frame: place at the flare tip
  sign: THREE.BufferGeometry; // uv: power station sign
  craneUpper: THREE.BufferGeometry; // scrap crane cab + jib, local frame (jib along +z)
  magnet: THREE.BufferGeometry;
  cable: THREE.BufferGeometry; // unit height, hangs down from y = 0
  wreck: THREE.BufferGeometry;
}

const BRICK = "#8d4b36";
const BRICK_DARK = "#713a2a";
const STONE = "#cdbfa6";
const WHITE = "#efeee9";
const DARK_STEEL = "#4b5056";
const RUST = "#7a4a34";
const CONCRETE = "#a8a49b";
const GLASS = "#26303a";
/** Flat yard pads sit here (above Ground's zone paint at ~0.008); their material also pulls forward with polygonOffset. */
export const PAD_Y = 0.08;
const CAR_COLOURS = ["#9b2d24", "#2c4f7c", "#c9c3b5", "#3c3f44", "#6b7a3a", "#b98a2e", "#5a2e4a", "#7f8a92", "#2e6b5a"];

/** Triangular prism (pitched roof) of width w (x), rise h, length d (z); base at y = 0. */
function roofPrism(w: number, h: number, d: number) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(0, h);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
  g.translate(0, 0, -d / 2);
  return g;
}

function pointInPoly(x: number, z: number, poly: V2[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Height of the scrap crane pedestal; the slewing upper's local frame starts here. */
export const CRANE_BASE_H = 5.2;

export function buildIndustrial(): IndustrialScene {
  const r = rng(2026);
  const solid = new Kit();
  const shells = new Kit();
  const windows = new Kit();
  const glow = new Kit();
  const lampHeads = new Kit();
  const pools = new Kit();
  const aviation = new Kit();
  const fence = new Kit(true);
  const hazard = new Kit(true);
  const ground = new Kit(true);
  const belt = new Kit(true);

  // ---------------------------------------------------------------- yards: concrete pads inside the fenced plots
  // (Ground already paints the zone; these sit at y = PAD_Y, only where every corner is inside a fence, so they never
  // touch a road.) Oily, darker cells around the coal / ore piles and in the scrapyard.
  {
    const C = 5;
    const plot = new THREE.Color("#8c887f");
    const stain = new THREE.Color("#3f3c38");
    const col = new THREE.Color();
    for (let x = ZONE.minX; x < ZONE.maxX; x += C)
      for (let z = ZONE.minZ; z < ZONE.maxZ; z += C) {
        const fence = FENCES.find((f) =>
          [[x, z], [x + C, z], [x, z + C], [x + C, z + C]].every(([px, pz]) => pointInPoly(px, pz, f)),
        );
        if (!fence) continue;
        const cx = x + C / 2;
        const cz = z + C / 2;
        col.copy(plot);
        const nearPile = [COAL_PILE, STEEL.ore].some((p) => Math.hypot(cx - p.x, cz - p.z) < p.r + 6);
        if (nearPile) col.lerp(stain, 0.55);
        if (fence === FENCES[3] && r() < 0.35) col.lerp(stain, 0.4 + r() * 0.3);
        col.offsetHSL(0, 0, (r() - 0.5) * 0.06);
        const g = new THREE.PlaneGeometry(C, C).rotateX(-Math.PI / 2);
        const uv = g.getAttribute("uv");
        for (let i = 0; i < uv.count; i++) uv.setXY(i, (x + uv.getX(i) * C) / 9, (z + (1 - uv.getY(i)) * C) / 9);
        ground.add(g, col, trs(cx, PAD_Y, cz));
      }
  }

  // ---------------------------------------------------------------- power station (Battersea-style)
  {
    const { hall, hallH, towerSize, towerH, chimneyH, chimneyR } = POWER;
    const x0 = hall.x - hall.w / 2;
    const x1 = hall.x + hall.w / 2;
    const z0 = hall.z - hall.d / 2;
    const z1 = hall.z + hall.d / 2;
    solid.box(hall.w - 2, hallH, hall.d - 2, BRICK, hall.x, 0, hall.z);
    solid.box(hall.w - 4, 1.2, hall.d - 4, "#4d3227", hall.x, hallH, hall.z);
    // central boiler house rises above the turbine halls
    solid.box(30, 8, hall.d - 14, BRICK_DARK, hall.x, hallH, hall.z);
    solid.box(31, 0.8, hall.d - 13, STONE, hall.x, hallH + 8, hall.z);
    // pilasters + tall window slots on the long faces
    for (let x = x0 + 14; x <= x1 - 14; x += 4) {
      for (const [z, s] of [[z0 + 1, -1], [z1 - 1, 1]] as const) {
        solid.box(1, hallH - 2, 0.8, BRICK_DARK, x, 0, z + s * 0.2);
        windows.box(1.9, 13, 0.3, GLASS, x + 2, 6, z + s * 0.12);
      }
    }
    for (let z = z0 + 14; z <= z1 - 14; z += 4) {
      for (const [x, s] of [[x0 + 1, -1], [x1 - 1, 1]] as const) {
        solid.box(0.8, hallH - 2, 1, BRICK_DARK, x + s * 0.2, 0, z);
        windows.box(0.3, 13, 1.9, GLASS, x + s * 0.12, 6, z + 2);
      }
    }
    // stone cornice
    solid.box(hall.w - 1.2, 0.8, 0.8, STONE, hall.x, hallH - 0.8, z0 + 0.6);
    solid.box(hall.w - 1.2, 0.8, 0.8, STONE, hall.x, hallH - 0.8, z1 - 0.6);
    // corner towers with stepped tops, plinths and the four white fluted chimneys
    for (const [cx, cz] of CHIMNEYS) {
      solid.box(towerSize, towerH, towerSize, BRICK, cx, 0, cz);
      for (let k = 0; k < 3; k++) solid.box(towerSize + 0.6 - k * 1.6, 0.9, towerSize + 0.6 - k * 1.6, STONE, cx, towerH + k * 0.9, cz);
      solid.box(7, 2, 7, WHITE, cx, towerH + 2.7, cz);
      solid.add(flutedChimney(chimneyR, chimneyR * 0.82, chimneyH - 4.7), WHITE, trs(cx, towerH + 4.7, cz));
      solid.cyl(chimneyR * 0.92, chimneyR * 0.92, 0.9, "#d9d7d0", cx, towerH + chimneyH - 0.9, cz, 24);
      solid.cyl(chimneyR * 0.7, chimneyR * 0.7, 0.2, "#1c1b1a", cx, towerH + chimneyH - 0.05, cz, 16);
      // vertical pilaster windows on the tower
      windows.box(1.4, 18, 0.3, GLASS, cx, 10, cz + (cz < hall.z ? -towerSize / 2 - 0.1 : towerSize / 2 + 0.1));
    }
    // coal pile + feed conveyor gantry
    solid.add(new THREE.ConeGeometry(COAL_PILE.r, 6, 10), "#1f1e1d", trs(COAL_PILE.x, 2.7, COAL_PILE.z));
    solid.beam([COAL_PILE.x + 4, 5, COAL_PILE.z - 6], [hall.x - 6, hallH - 2, z1 - 1], 1.6, DARK_STEEL);
    for (const t of [0.3, 0.65]) {
      const x = COAL_PILE.x + 4 + (hall.x - 6 - COAL_PILE.x - 4) * t;
      const z = COAL_PILE.z - 6 + (z1 - 1 - COAL_PILE.z + 6) * t;
      const y = 5 + (hallH - 2 - 5) * t;
      solid.beam([x, 0, z], [x, y, z], 0.5, DARK_STEEL);
    }
    // transformers beside the hall
    for (let k = 0; k < 4; k++) solid.box(3, 3.4, 2.4, "#5b6a5d", 104 + 0, 0, 432 + k * 9);
  }

  // ---------------------------------------------------------------- warehouses
  for (const w of WAREHOUSES) {
    solid.box(w.w, w.h, w.d, w.color, w.x, 0, w.z);
    solid.add(roofPrism(w.w + 0.6, 2.4, w.d + 0.6), jitter("#5d6064", r), trs(w.x, w.h, w.z));
    // roller doors facing the spine (east)
    for (let z = w.z - w.d / 2 + 4; z <= w.z + w.d / 2 - 4; z += 6.5) {
      solid.box(0.3, 4.2, 4, "#c9cbc7", w.x + w.w / 2 + 0.12, 0, z);
      solid.box(0.25, 0.4, 4.6, "#f2c230", w.x + w.w / 2 + 0.2, 4.3, z);
    }
    windows.box(0.3, 1.2, w.d - 4, GLASS, w.x - w.w / 2 - 0.1, w.h - 2.5, w.z);
  }

  // ---------------------------------------------------------------- oil refinery
  {
    for (const c of REFINERY.columns) {
      solid.cyl(c.r, c.r, c.h, "#d8dbde", c.x, 0, c.z, 14);
      solid.add(new THREE.SphereGeometry(c.r, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), "#d8dbde", trs(c.x, c.h, c.z));
      for (let y = 6; y < c.h - 2; y += 6.5) solid.cyl(c.r + 0.9, c.r + 0.9, 0.35, "#3d4247", c.x, y, c.z, 14);
      solid.beam([c.x + c.r + 0.5, 0, c.z], [c.x + c.r + 0.5, c.h - 1, c.z], 0.5, "#c0392b", true);
      solid.box(2.5, 1.2, 2.5, "#3d4247", c.x, 0, c.z);
    }
    for (const s of REFINERY.spheres) {
      solid.add(new THREE.SphereGeometry(s.r, 16, 10), "#f1f0eb", trs(s.x, s.r + 2.6, s.z));
      solid.cyl(s.r + 0.08, s.r + 0.08, 0.4, "#c9c7c0", s.x, s.r + 2.4, s.z, 16);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        solid.beam([s.x + Math.cos(a) * s.r * 0.85, 0, s.z + Math.sin(a) * s.r * 0.85], [s.x + Math.cos(a) * s.r * 0.95, s.r + 2.6, s.z + Math.sin(a) * s.r * 0.95], 0.45, DARK_STEEL);
      }
    }
    for (const t of REFINERY.tanks) {
      solid.cyl(t.r + 1.8, t.r + 1.8, 0.6, CONCRETE, t.x, 0, t.z, 20);
      solid.cyl(t.r, t.r, t.h, "#ecebe4", t.x, 0.6, t.z, 20);
      solid.add(new THREE.ConeGeometry(t.r + 0.2, 1.4, 20), "#cfccc3", trs(t.x, 0.6 + t.h + 0.7, t.z));
      solid.cyl(t.r + 0.05, t.r + 0.05, 1.1, "#c0392b", t.x, 0.6 + t.h * 0.6, t.z, 20);
    }
    // pipe racks: portal frames + bundles of coloured pipes
    const PIPE_COLS = ["#9aa1a8", "#c0392b", "#e3b23c", "#5f7f9a", "#3d4247"];
    for (const rk of REFINERY.racks) {
      const alongX = rk.w > rk.d;
      const len = alongX ? rk.w : rk.d;
      const H = 6.5;
      for (let s = -len / 2; s <= len / 2 + 0.01; s += 6) {
        const px = alongX ? rk.x + s : rk.x;
        const pz = alongX ? rk.z : rk.z + s;
        const ox = alongX ? 0 : 1.7;
        const oz = alongX ? 1.7 : 0;
        solid.beam([px - ox, 0, pz - oz], [px - ox, H, pz - oz], 0.35, DARK_STEEL);
        solid.beam([px + ox, 0, pz + oz], [px + ox, H, pz + oz], 0.35, DARK_STEEL);
        solid.beam([px - ox, H, pz - oz], [px + ox, H, pz + oz], 0.3, DARK_STEEL);
        solid.beam([px - ox, H - 2.4, pz - oz], [px + ox, H - 2.4, pz + oz], 0.3, DARK_STEEL);
      }
      PIPE_COLS.forEach((c, k) => {
        const off = -1.4 + k * 0.7;
        const y = k % 2 ? H + 0.35 : H - 2.05;
        const a: V3 = alongX ? [rk.x - len / 2, y, rk.z + off] : [rk.x + off, y, rk.z - len / 2];
        const b: V3 = alongX ? [rk.x + len / 2, y, rk.z + off] : [rk.x + off, y, rk.z + len / 2];
        solid.beam(a, b, 0.55, c, true);
      });
    }
    // pipes from the columns to the racks
    for (const c of REFINERY.columns) solid.beam([c.x, c.h * 0.5, c.z], [276, 6.9, c.z < 420 ? 420 : 430], 0.5, "#9aa1a8", true);
    // flare stack: tapering lattice + red/white tip
    const f = REFINERY.flare;
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      solid.beam([f.x + sx * 2.2, 0, f.z + sz * 2.2], [f.x + sx * 0.7, f.h - 6, f.z + sz * 0.7], 0.35, DARK_STEEL);
    }
    for (let y = 6; y < f.h - 6; y += 6) {
      const w = 2.2 - (1.5 * y) / (f.h - 6);
      solid.box(w * 2 + 0.3, 0.25, w * 2 + 0.3, DARK_STEEL, f.x, y, f.z);
    }
    solid.cyl(0.55, 0.55, f.h, "#8a8f94", f.x, 0, f.z, 8);
    for (let k = 0; k < 3; k++) solid.cyl(0.62, 0.62, 2, k % 2 ? WHITE : "#c0392b", f.x, f.h - 6 + k * 2, f.z, 8);
    solid.cyl(0.9, 0.7, 0.8, "#2a2a2a", f.x, f.h, f.z, 8);
    // control room
    const cr = REFINERY.control;
    solid.box(cr.w, 5, cr.d, "#c4c8c2", cr.x, 0, cr.z);
    solid.box(cr.w + 0.4, 0.5, cr.d + 0.4, "#5d6064", cr.x, 5, cr.z);
    windows.box(cr.w - 2, 1.4, 0.3, GLASS, cr.x, 2.2, cr.z - cr.d / 2 - 0.1);
    windows.box(cr.w - 2, 1.4, 0.3, GLASS, cr.x, 2.2, cr.z + cr.d / 2 + 0.1);
  }

  // ---------------------------------------------------------------- steelworks
  {
    const fu = STEEL.furnace;
    solid.cyl(fu.r * 0.8, fu.r, 22, RUST, fu.x, 0, fu.z, 16);
    solid.cyl(fu.r * 0.5, fu.r * 0.8, 10, "#5e4237", fu.x, 22, fu.z, 16);
    solid.cyl(fu.r * 0.45, fu.r * 0.5, 4, DARK_STEEL, fu.x, 32, fu.z, 12);
    solid.add(new THREE.TorusGeometry(fu.r + 1.4, 0.6, 6, 18).rotateX(Math.PI / 2), DARK_STEEL, trs(fu.x, 12, fu.z));
    // tuyeres glow ring + tapping hole
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      glow.box(0.6, 0.6, 0.6, "#ffffff", fu.x + Math.cos(a) * (fu.r + 0.05), 6, fu.z + Math.sin(a) * (fu.r + 0.05));
    }
    glow.box(1.4, 1.6, 1.6, "#ffffff", fu.x + fu.r - 0.3, 3, fu.z);
    // steel frame cage + top uptakes
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      solid.beam([fu.x + sx * 10, 0, fu.z + sz * 10], [fu.x + sx * 6, fu.h + 4, fu.z + sz * 6], 0.8, DARK_STEEL);
      solid.beam([fu.x, fu.h + 2, fu.z], [fu.x + sx * 3, fu.h + 7, fu.z + sz * 3], 1.2, "#5e4237", true);
    }
    for (let y = 8; y < fu.h; y += 9) {
      const w = 10 - (4 * y) / (fu.h + 4);
      solid.box(w * 2, 0.5, w * 2, DARK_STEEL, fu.x, y, fu.z);
    }
    // downcomer to the dust catcher, gas main to the stack
    solid.cyl(3, 3, 14, "#6a5a50", 168, 0, 622, 12);
    solid.add(new THREE.ConeGeometry(3, 3, 12), "#6a5a50", trs(168, 15.5, 622));
    solid.beam([fu.x + 2, fu.h + 6, fu.z + 2], [168, 17, 622], 1.6, "#5e4237", true);
    solid.beam([168, 8, 625], [STEEL.stack.x - 2, 8, STEEL.stack.z], 1.4, "#5e4237", true);
    // hot-blast stoves + hot-blast main
    for (const s of STEEL.stoves) {
      solid.cyl(s.r, s.r, s.h - s.r, "#8d9095", s.x, 0, s.z, 14);
      solid.add(new THREE.SphereGeometry(s.r, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2), "#8d9095", trs(s.x, s.h - s.r, s.z));
    }
    solid.beam([124 + 5, 14, 578], [124 + 5, 14, 612], 1.4, "#5e4237", true);
    solid.beam([129, 14, 595], [fu.x - fu.r, 14, fu.z], 1.4, "#5e4237", true);
    // casthouse (west half roofed) + open raised cast floor with the runner (east half)
    const ch = STEEL.casthouse;
    const roofX = ch.x - ch.w / 4;
    solid.box(ch.w / 2, STEEL.casthouseH, ch.d, "#6f5a4e", roofX, 0, ch.z);
    solid.add(roofPrism(ch.w / 2 + 0.6, 2.5, ch.d + 0.6), "#4a4440", trs(roofX, STEEL.casthouseH, ch.z));
    const floorX = ch.x + ch.w / 4;
    solid.box(ch.w / 2, STEEL.castFloorH, ch.d, "#4a4642", floorX, 0, ch.z);
    const [px, py, pz] = STEEL.pour;
    glow.box(px - (fu.x + fu.r), 0.35, 1.1, "#ffffff", (px + fu.x + fu.r) / 2, py, pz);
    glow.box(0.5, py - 3.2, 0.5, "#ffffff", px + 0.6, 3.2, pz); // molten stream into the ladle
    // ladle car + molten top
    const ld = STEEL.ladle;
    solid.box(4.4, 1, 6, DARK_STEEL, ld.x + 1.2, 0, ld.z);
    solid.cyl(2.2, 1.8, 2.4, "#2f2b28", ld.x + 1.2, 1, ld.z, 12);
    glow.cyl(1.95, 1.95, 0.15, "#ffffff", ld.x + 1.2, 3.3, ld.z, 12);
    // steel stack with red/white bands
    const st = STEEL.stack;
    solid.cyl(st.r * 0.72, st.r, st.h, "#8c8c88", st.x, 0, st.z, 14);
    for (let k = 0; k < 2; k++) solid.cyl(st.r * 0.76, st.r * 0.76, 2.4, "#c0392b", st.x, st.h - 3 - k * 6, st.z, 14);
    solid.cyl(st.r * 0.55, st.r * 0.55, 0.1, "#141414", st.x, st.h + 0.02, st.z, 12);
    // rolling mill shed
    const ml = STEEL.mill;
    solid.box(ml.w, STEEL.millH, ml.d, "#6a7480", ml.x, 0, ml.z);
    solid.add(roofPrism(ml.d + 0.8, 2.6, ml.w + 0.8), "#4f565e", trs(ml.x, STEEL.millH, ml.z, Math.PI / 2));
    windows.box(ml.w - 4, 1.5, 0.3, GLASS, ml.x, STEEL.millH - 3, ml.z - ml.d / 2 - 0.1);
    windows.box(ml.w - 4, 1.5, 0.3, GLASS, ml.x, STEEL.millH - 3, ml.z + ml.d / 2 + 0.1);
    // ore and coke piles
    solid.add(new THREE.ConeGeometry(STEEL.ore.r, 7, 12), "#8a4b2e", trs(STEEL.ore.x, 3.2, STEEL.ore.z));
    solid.add(new THREE.ConeGeometry(6, 4, 10), "#262422", trs(108, 1.7, 568));
    // conveyor: belt (scrolling texture) + truss, legs and rails
    const { from, to, width } = STEEL.conveyor;
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const dz = to[2] - from[2];
    const len = Math.hypot(dx, dy, dz);
    const bg = new THREE.BoxGeometry(width, 0.25, len);
    const uv = bg.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * (len / 8));
    const yaw = Math.atan2(dx, dz);
    const pitch = -Math.atan2(dy, Math.hypot(dx, dz));
    belt.add(bg, "#ffffff", trs((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2, yaw, 1, 1, 1, pitch));
    for (const side of [-1, 1]) {
      const ox = Math.cos(yaw) * side * (width / 2 + 0.2);
      const oz = -Math.sin(yaw) * side * (width / 2 + 0.2);
      solid.beam([from[0] + ox, from[1] + 0.6, from[2] + oz], [to[0] + ox, to[1] + 0.6, to[2] + oz], 0.3, "#e3b23c");
    }
    for (let t = 0.12; t < 0.95; t += 0.16) {
      const x = from[0] + dx * t;
      const y = from[1] + dy * t;
      const z = from[2] + dz * t;
      solid.beam([x, 0, z], [x, y - 0.2, z], 0.45, DARK_STEEL);
    }
  }

  // ---------------------------------------------------------------- cooling towers + chemical plant
  {
    for (const t of COOLING_TOWERS) {
      const { outer, inner } = coolingTowerShell(t.rBase, t.rWaist, t.rTop, t.h);
      shells.add(outer, "#c7c3ba", trs(t.x, 0, t.z));
      shells.add(inner, "#6e6b65", trs(t.x, 0, t.z));
      shells.add(new THREE.CircleGeometry(t.rWaist, 20).rotateX(-Math.PI / 2), "#4a5a5e", trs(t.x, 3, t.z));
      // weathering band at the rim
      solid.add(new THREE.TorusGeometry(t.rTop - 0.1, 0.3, 4, 28).rotateX(Math.PI / 2), "#a9a49a", trs(t.x, t.h, t.z));
    }
    const b = CHEM.building;
    solid.box(b.w, 9, b.d, "#b9bec4", b.x, 0, b.z);
    solid.box(b.w + 0.4, 0.5, b.d + 0.4, "#6c7278", b.x, 9, b.z);
    for (let k = 0; k < 3; k++) solid.box(2, 1.6, 2, "#8a9096", b.x - 5 + k * 5, 9.5, b.z);
    windows.box(b.w - 3, 1.3, 0.3, GLASS, b.x, 5, b.z - b.d / 2 - 0.1);
    windows.box(b.w - 3, 1.3, 0.3, GLASS, b.x, 5, b.z + b.d / 2 + 0.1);
    for (const t of CHEM.tanks) {
      solid.cyl(t.r, t.r, t.h, "#d3d9de", t.x, 0, t.z, 16);
      solid.add(new THREE.SphereGeometry(t.r, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2), "#2f6db0", trs(t.x, t.h, t.z));
      solid.beam([t.x, t.h * 0.7, t.z], [b.x + b.w / 2, 7, b.z - 3], 0.5, "#e3b23c", true);
    }
    const s = CHEM.stack;
    solid.cyl(s.r * 0.8, s.r, s.h, "#b4b4b0", s.x, 0, s.z, 10);
    solid.cyl(s.r * 0.86, s.r * 0.86, 1.2, "#c0392b", s.x, s.h - 2, s.z, 10);
    // pipe from the chem building to the cooling towers
    solid.beam([b.x + b.w / 2, 4, b.z], [COOLING_TOWERS[1].x - 10, 4, COOLING_TOWERS[1].z], 0.8, "#9aa1a8", true);
  }

  // ---------------------------------------------------------------- recycling plant
  {
    const s = RECYCLING.shed;
    solid.box(s.w, RECYCLING.shedH, s.d, "#2f7d5b", s.x, 0, s.z);
    solid.add(roofPrism(s.d + 0.8, 2.4, s.w + 0.8), "#2a4d40", trs(s.x, RECYCLING.shedH, s.z, Math.PI / 2));
    solid.box(6, 6, 0.3, "#2a2a2a", s.x - 6, 0, s.z + s.d / 2 + 0.1);
    solid.box(6, 6, 0.3, "#2a2a2a", s.x + 6, 0, s.z + s.d / 2 + 0.1);
    windows.box(s.w - 4, 1.2, 0.3, GLASS, s.x, RECYCLING.shedH - 2.5, s.z - s.d / 2 - 0.1);
    solid.beam([s.x + s.w / 2 - 2, 9, s.z], [s.x + s.w / 2 + 6, 2, s.z + 14], 1.4, DARK_STEEL);
    const BALES = ["#5c87c9", "#c9a35c", "#9aa0a6", "#6aa84f", "#b8b4a8"];
    const bl = RECYCLING.bales;
    for (let i = 0; i < 6; i++)
      for (let j = 0; j < 3; j++) {
        const n = 1 + Math.floor(r() * 3);
        const c = BALES[Math.floor(r() * BALES.length)];
        for (let k = 0; k < n; k++)
          solid.box(1.5, 1.4, 1.5, jitter(c, r), bl.x - bl.w / 2 + 2 + i * 3.6, k * 1.42, bl.z - bl.d / 2 + 2.5 + j * 4.2, (r() - 0.5) * 0.2);
      }
  }

  // ---------------------------------------------------------------- scrapyard
  {
    const y = SCRAP.yard;
    const cr = SCRAP.crane;
    const cu = SCRAP.crusher;
    const crushed = (x: number, yy: number, z: number, yaw: number) =>
      solid.box(4.2, 1.05, 1.9, jitter(CAR_COLOURS[Math.floor(r() * CAR_COLOURS.length)], r, 0.06).multiplyScalar(0.85), x, yy, z, yaw);
    for (let x = y.x - y.w / 2 + 4; x < y.x + y.w / 2 - 3; x += 5.2)
      for (let z = y.z - y.d / 2 + 4; z < y.z + y.d / 2 - 2; z += 3.1) {
        if (Math.hypot(x - cr.x, z - cr.z) < 6) continue;
        if (Math.abs(x - cu.x) < cu.w / 2 + 3 && Math.abs(z - cu.z) < cu.d / 2 + 3) continue;
        if (r() < 0.22) continue;
        const n = 1 + Math.floor(r() * r() * 5);
        for (let k = 0; k < n; k++) crushed(x + (r() - 0.5) * 0.6, k * 1.06, z, (r() - 0.5) * 0.25);
      }
    // un-crushed wrecks waiting at the pick pile
    for (let k = 0; k < 3; k++) {
      const x = 243 + k * 2.4;
      const z = 624 + (k % 2) * 2;
      const c = CAR_COLOURS[Math.floor(r() * CAR_COLOURS.length)];
      solid.box(4.2, 1.1, 1.9, c, x, 0, z, 0.3 * k);
      solid.box(2.2, 0.8, 1.7, c, x, 1.1, z, 0.3 * k);
    }
    // crusher (baler)
    solid.box(cu.w, 3.4, cu.d, "#c8a02a", cu.x, 0, cu.z);
    solid.box(cu.w - 1.5, 0.3, cu.d - 1.5, "#2a2a2a", cu.x, 3.4, cu.z);
    solid.box(2, 5, 2, "#c8a02a", cu.x + cu.w / 2 + 1, 0, cu.z);
    // crane base (the slewing upper is animated)
    solid.box(5, 1.2, 5, DARK_STEEL, cr.x, 0, cr.z);
    solid.cyl(1.4, 1.8, 4, "#e3b23c", cr.x, 1.2, cr.z, 10);
  }

  // ---------------------------------------------------------------- rail sidings with tank wagons
  {
    const WAGONS = ["#1d1d1d", "#e8e8e8", "#3b5f8a", "#1d1d1d", "#7a3a2a", "#e8e8e8"];
    let wi = 0;
    for (const tx of RAIL.tracksX) {
      const len = RAIL.z1 - RAIL.z0;
      const zc = (RAIL.z0 + RAIL.z1) / 2;
      solid.box(3.4, 0.22, len, "#7a756d", tx, 0, zc);
      for (let z = RAIL.z0 + 0.4; z < RAIL.z1; z += 0.8) solid.box(2.5, 0.14, 0.24, "#4e3b2c", tx, 0.22, z);
      for (const o of [-0.72, 0.72]) solid.box(0.1, 0.16, len, "#9aa0a6", tx + o, 0.36, zc);
      solid.box(2.6, 1.2, 0.8, "#c0392b", tx, 0.2, RAIL.z1 - 0.4); // buffer stop
      for (let k = 0; k < 2; k++) {
        const wz = RAIL.z0 + 2 + RAIL.wagon.len / 2 + k * (RAIL.wagon.len + 1.4);
        const c = WAGONS[wi++ % WAGONS.length];
        solid.box(2.5, 0.5, RAIL.wagon.len, "#2b2b2b", tx, 0.9, wz);
        for (const bz of [-1, 1]) solid.box(2.1, 0.6, 2.2, "#1a1a1a", tx, 0.35, wz + bz * (RAIL.wagon.len / 2 - 1.8));
        solid.add(
          new THREE.CylinderGeometry(RAIL.wagon.r, RAIL.wagon.r, RAIL.wagon.len - 1.2, 14).rotateX(Math.PI / 2),
          c,
          trs(tx, 1.4 + RAIL.wagon.r, wz),
        );
        solid.box(1.2, 0.5, 1.2, "#555555", tx, 1.4 + RAIL.wagon.r * 2 - 0.1, wz);
      }
    }
  }

  // ---------------------------------------------------------------- fences (chain-link) + posts
  for (const f of FENCES) {
    for (let i = 1; i < f.length; i++) {
      const [ax, az] = f[i - 1];
      const [bx, bz] = f[i];
      const len = Math.hypot(bx - ax, bz - az);
      const H = 2.4;
      const g = new THREE.PlaneGeometry(len, H);
      const uv = g.getAttribute("uv");
      for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * (len / H));
      fence.add(g, "#ffffff", trs((ax + bx) / 2, H / 2, (az + bz) / 2, -Math.atan2(bz - az, bx - ax)));
      const n = Math.max(1, Math.round(len / 3));
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        solid.cyl(0.06, 0.06, H + 0.2, "#8b9096", ax + (bx - ax) * t, 0, az + (bz - az) * t, 4);
      }
    }
  }

  // ---------------------------------------------------------------- hazard barriers
  for (const [x, z, len, yaw] of BARRIERS) {
    const g = new THREE.BoxGeometry(len, 0.5, 0.25);
    const uv = g.getAttribute("uv");
    for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * (len / 2));
    hazard.add(g, "#ffffff", trs(x, 0.85, z, yaw));
    for (const s of [-1, 1]) {
      const lx = x + Math.cos(yaw) * s * (len / 2 - 0.3);
      const lz = z - Math.sin(yaw) * s * (len / 2 - 0.3);
      solid.box(0.14, 0.7, 0.14, "#2a2a2a", lx, 0, lz);
    }
  }

  // ---------------------------------------------------------------- sodium yard lights
  for (const [x, z] of YARD_LIGHTS) {
    solid.cyl(0.14, 0.2, 12, "#6e7378", x, 0, z, 6);
    lampHeads.box(1.5, 0.4, 0.8, "#ffd9a0", x, 12, z);
    pools.add(new THREE.CircleGeometry(12, 20).rotateX(-Math.PI / 2), "#ffae4a", trs(x, 0.14, z));
  }

  // ---------------------------------------------------------------- aviation lights
  for (const [x, y, z] of AVIATION_LIGHTS) aviation.add(new THREE.SphereGeometry(0.55, 8, 6), "#ff2a1a", trs(x, y, z));

  // ---------------------------------------------------------------- flare flame (3 crossed planes, shader)
  const flameKit = new Kit(true);
  for (let k = 0; k < 3; k++)
    flameKit.add(new THREE.PlaneGeometry(4.5, 13).translate(0, 6.5, 0), "#ffffff", trs(0, 0, 0, (k * Math.PI) / 3));

  // ---------------------------------------------------------------- sign on the power station's north face
  const signKit = new Kit(true);
  signKit.add(new THREE.PlaneGeometry(34, 4.2).rotateY(Math.PI), "#ffffff", trs(POWER.hall.x, 19.5, POWER.hall.z - POWER.hall.d / 2 - 0.15));

  // ---------------------------------------------------------------- scrap crane (animated parts, local frames)
  const upper = new Kit();
  const cr = SCRAP.crane;
  upper.box(3.6, 2.8, 4, "#e3b23c", 0, 0, -0.6);
  upper.box(3.2, 1.6, 2.2, "#2a2a2a", 0, 0.3, -3.6); // counterweight
  upper.box(1.4, 1.4, 0.2, GLASS, 0.8, 1.2, 1.45);
  upper.beam([0, 2.6, 0.6], [0, cr.h - CRANE_BASE_H, cr.jib], 0.7, "#e3b23c");
  upper.beam([0, 3.8, -1.5], [0, cr.h - CRANE_BASE_H + 0.3, cr.jib - 1], 0.18, DARK_STEEL);
  const magnet = new Kit();
  magnet.cyl(1.25, 1.25, 0.6, "#2b2b2b", 0, -0.6, 0, 14);
  magnet.cyl(0.25, 0.25, 0.6, "#555555", 0, 0, 0, 6);
  const cable = new Kit();
  cable.box(0.08, 1, 0.08, "#222222", 0, -1, 0);
  const wreck = new Kit();
  wreck.box(4.2, 1.1, 1.9, "#7b2e2a", 0, -2.4, 0);
  wreck.box(2.2, 0.7, 1.7, "#7b2e2a", 0.2, -1.3, 0);

  return {
    solid: solid.build(),
    shells: shells.build(),
    windows: windows.build(),
    glow: glow.build(),
    lampHeads: lampHeads.build(),
    pools: pools.build(),
    aviation: aviation.build(),
    fence: fence.build(),
    hazard: hazard.build(),
    ground: ground.build(),
    belt: belt.build(),
    flame: flameKit.build(),
    sign: signKit.build(),
    craneUpper: upper.build(),
    magnet: magnet.build(),
    cable: cable.build(),
    wreck: wreck.build(),
  };
}
