// Container terminal: procedural geometry. Static multi-part objects are merged into one vertex-coloured
// geometry each (one draw call per kind, instanced where there are several).
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CT_GATE_X } from "../../districts/containerTerminal";
import { REACH } from "./cranes";
import {
  BAY_X,
  BLOCKS,
  CT_LANE_Z,
  CUSTOMS,
  GATE,
  LIGHT_MASTS,
  RMG,
  SHIP,
  SHIP_BAYS,
  STS,
  STS_CRANES,
  TRUCK,
  ZONE,
  rmgLegs,
  shipBayZ,
} from "./layout";

type Part = [THREE.BufferGeometry, string];

export function box(w: number, h: number, d: number, x: number, y: number, z: number) {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
}
const _up = new THREE.Vector3(0, 1, 0);
/** A square beam of thickness t between two points. */
export function beam(a: [number, number, number], b: [number, number, number], t: number) {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const dir = vb.clone().sub(va);
  const len = dir.length();
  const g = new THREE.BoxGeometry(t, len, t);
  const q = new THREE.Quaternion().setFromUnitVectors(_up, dir.normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(va.add(vb).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  return g;
}
function cyl(r: number, h: number, x: number, y: number, z: number, axis: "x" | "y" | "z" = "y", seg = 10) {
  const g = new THREE.CylinderGeometry(r, r, h, seg);
  if (axis === "x") g.rotateZ(Math.PI / 2);
  if (axis === "z") g.rotateX(Math.PI / 2);
  return g.translate(x, y, z);
}

export function mergeColored(parts: Part[]) {
  const col = new THREE.Color();
  const gs = parts.map(([g0, c]) => {
    const g = g0.index ? g0.toNonIndexed() : g0;
    for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal") g.deleteAttribute(k);
    col.set(c);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.toArray(arr, i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    return g;
  });
  const m = mergeGeometries(gs, false)!;
  for (const g of gs) g.dispose();
  m.computeBoundingSphere();
  return m;
}

const WHITE = "#f1efe8";
const DARK = "#2f3237";
const ORANGE = "#ff6a1a";
const YELLOW = "#f2c12e";
const RMG_BLUE = "#2563a8";
const STS_TEAL = "#1d8a8a";

// =====================================================================================================
// RMG (local: origin at the gantry centre on the lane centre line; rails along x; legs at the two rail z's)
// =====================================================================================================
export function rmgFrameGeometry() {
  const [za, zb] = rmgLegs(0).map((z) => z - CT_LANE_Z[0]);
  const gy = RMG.girderY;
  const p: Part[] = [];
  for (const z of [za, zb]) {
    p.push([box(9, 1.1, 1.4, 0, 0.75, z), RMG_BLUE]); // sill beam on the rail
    for (const sx of [-1, 1]) {
      p.push([box(1.6, 0.9, 1.2, sx * 3.6, 0.45, z), DARK]); // bogies
      p.push([beam([sx * 3.9, 1.2, z], [sx * 1.6, gy, z], 0.95), RMG_BLUE]);
    }
    p.push([box(4.2, 1.4, 1.6, 0, gy + 0.5, z), RMG_BLUE]); // portal head
    p.push([box(3.4, 0.5, 0.6, 0, gy * 0.55, z), RMG_BLUE]); // portal brace
  }
  // twin girders along z with a cantilever past the lane-side legs
  const z0 = za - 2.2;
  const z1 = zb + 2.4;
  for (const sx of [-1, 1]) {
    p.push([box(0.8, 1.9, z1 - z0, sx * 1.5, gy + 1.15, (z0 + z1) / 2), WHITE]);
    p.push([box(0.85, 0.35, z1 - z0, sx * 1.5, gy + 2.2, (z0 + z1) / 2), ORANGE]);
  }
  for (let z = z0 + 1; z < z1; z += 4.5) p.push([box(3.6, 0.3, 0.3, 0, gy + 2.1, z), WHITE]);
  // machinery house + walkway
  p.push([box(4, 2.6, 5, 0, gy + 3.4, za - 0.5), WHITE]);
  p.push([box(4.05, 0.5, 5.05, 0, gy + 4.4, za - 0.5), RMG_BLUE]);
  p.push([box(0.3, gy, 0.3, 2.6, gy / 2, za), YELLOW]); // ladder
  return mergeColored(p);
}
/** RMG trolley (rides on the girders, origin at its centre on the girder top). */
export function rmgTrolleyGeometry() {
  return mergeColored([
    [box(3.8, 1.3, 3.6, 0, 0.65, 0), "#d9dde2"],
    [box(3.9, 0.3, 3.7, 0, 1.4, 0), ORANGE],
    [box(1.6, 1.6, 1.8, 2.3, -0.6, 0.6), WHITE], // operator cab
    [box(1.65, 0.6, 1.85, 2.3, -0.5, 0.6), "#23313f"],
  ]);
}
/** Spreader with its long axis along x, bottom at y = 0. */
export function spreaderXGeometry() {
  return mergeColored([
    [box(12.5, 0.6, 2.7, 0, 0.3, 0), YELLOW],
    [box(3, 0.8, 2.1, 0, 1, 0), DARK],
    [box(0.45, 0.45, 3.0, 6.0, 0.55, 0), YELLOW],
    [box(0.45, 0.45, 3.0, -6.0, 0.55, 0), YELLOW],
  ]);
}
/** Spreader with its long axis along z (STS / straddle). */
export function spreaderZGeometry() {
  return spreaderXGeometry().rotateY(Math.PI / 2);
}
export function cableGeometry() {
  return new THREE.BoxGeometry(0.1, 1, 0.1).translate(0, 0.5, 0);
}

// =====================================================================================================
// STS crane (local: world x, z relative to the crane's z)
// =====================================================================================================
export function stsFrameGeometry() {
  const p: Part[] = [];
  const hz = STS.legHalfZ;
  const top = 29;
  const by = STS.boomY + 1.1;
  const [l0, l1] = STS.legX;
  for (const lx of STS.legX)
    for (const sz of [-1, 1]) {
      p.push([box(1.3, top, 1.3, lx, top / 2, sz * hz), STS_TEAL]);
      p.push([box(2.6, 1.3, 4.6, lx, 0.65, sz * hz), DARK]);
      p.push([box(1.45, 1, 1.45, lx, 17, sz * hz), WHITE]);
    }
  for (const lx of STS.legX) {
    p.push([box(1.6, 1.9, hz * 2 + 1.3, lx, top, 0), STS_TEAL]);
    p.push([beam([lx, 12, -hz], [lx, top - 1, hz], 0.6), STS_TEAL]);
    for (const sz of [-1, 1]) p.push([box(0.7, by - 1 - top, 0.7, lx, (by - 1 + top) / 2, sz * 4.6), STS_TEAL]);
  }
  const span = l1 - l0;
  for (const sz of [-1, 1]) {
    p.push([box(span + 1.3, 1.9, 1.6, (l0 + l1) / 2, top, sz * hz), STS_TEAL]);
    p.push([box(span, 0.9, 0.9, (l0 + l1) / 2, 18, sz * hz), STS_TEAL]); // above the straddle carriers
  }
  // boom: the fixed backreach over the apron; the outreach is a separate hinged mesh (stsBoomGeometry)
  const x0 = 306;
  const hx = STS_HINGE_X;
  for (const sz of [-1, 1]) p.push([box(hx - x0, 2.2, 0.9, (x0 + hx) / 2, by, sz * 1.7), WHITE]);
  for (let x = x0 + 2; x < hx; x += 6) p.push([box(0.4, 0.4, 3.4, x, by + 1.2, 0), WHITE]);
  p.push([box(12, 4.5, 7, 312, by + 3.4, 0), WHITE]);
  p.push([box(12.1, 0.9, 7.1, 312, by + 3, 0), ORANGE]);
  const apex: [number, number] = [(l0 + l1) / 2, 50];
  for (const sz of [-1, 1]) {
    for (const lx of STS.legX) p.push([beam([lx, by, sz * 4.6], [apex[0], apex[1], sz * 1.2], 1.0), WHITE]);
    p.push([beam([apex[0], apex[1], sz * 1.2], [x0 + 3, by + 1, sz * 1.7], 0.35), WHITE]);
  }
  p.push([box(2, 1.4, 3.8, apex[0], apex[1] + 0.4, 0), ORANGE]);
  return mergeColored(p);
}

/** Hinge of the outreach boom (world x; y = boom girder centre). */
export const STS_HINGE_X = 341;
export const STS_BOOM_LEN = 54;
/** Outreach boom, local origin at the hinge, extending along +x (rotate about z to raise it). */
export function stsBoomGeometry() {
  const p: Part[] = [];
  const L = STS_BOOM_LEN;
  for (const sz of [-1, 1]) p.push([box(L, 2.2, 0.9, L / 2, 0, sz * 1.7), WHITE]);
  for (let x = 2; x < L; x += 6) p.push([box(0.4, 0.4, 3.4, x, 1.2, 0), WHITE]);
  p.push([box(1.6, 3.2, 4.4, L, 0, 0), WHITE]);
  p.push([box(1.7, 0.6, 4.5, L, 1.5, 0), ORANGE]);
  // tie bars riding on the boom (the forestays' lower ends)
  for (const sz of [-1, 1]) p.push([beam([L - 2, 1, sz * 1.7], [L * 0.45, 7, sz * 1.4], 0.3), WHITE]);
  return mergeColored(p);
}
/** A small floodlight box under a spreader head. */
export function spreaderLampGeometry() {
  const parts = [box(0.9, 0.25, 0.9, -3.5, -0.15, 0), box(0.9, 0.25, 0.9, 3.5, -0.15, 0)];
  const m = mergeGeometries(parts.map((g) => g.toNonIndexed()), false)!;
  for (const g of parts) g.dispose();
  return m;
}
export function stsTrolleyGeometry() {
  const y = STS.boomY - 0.8;
  return mergeColored([
    [box(5, 1.6, 2.2, 0, y, 0), "#5b626b"],
    [box(2.6, 1.7, 2.4, -0.6, y - 1.75, 2.85), WHITE],
    [box(2.65, 0.7, 2.45, -0.6, y - 1.6, 2.85), "#23313f"],
    [box(2.9, 0.3, 2.7, -0.6, y - 0.75, 2.85), ORANGE],
  ]);
}

// =====================================================================================================
// Straddle carrier + reach stacker (local, forward +z)
// =====================================================================================================
export function straddleGeometry() {
  // a 1-over-3 straddle carrier: ~15 m tall, spreader travels up to ~11 m
  const Y = "#f0b21b";
  const p: Part[] = [];
  const top = 13.2;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      p.push([box(0.6, top - 1, 0.7, sx * 2.2, (top - 1) / 2 + 0.6, sz * 3.6), Y]);
      p.push([box(0.9, 1.2, 1.6, sx * 2.2, 0.6, sz * 3.6), "#222"]);
    }
    p.push([box(0.7, 1.1, 8.4, sx * 2.2, top, 0), Y]);
    p.push([box(0.5, 0.8, 7.6, sx * 2.2, 1.6, 0), Y]);
    p.push([box(0.4, 0.4, 7.6, sx * 2.2, top * 0.55, 0), Y]);
    p.push([box(1.4, 1.8, 3.2, sx * 2.2, top + 1.4, -1.4), "#d8d8d2"]);
  }
  for (const sz of [-1, 1]) p.push([box(5.1, 0.8, 0.8, 0, top + 0.2, sz * 3.6), Y]);
  p.push([box(1.8, 2.0, 1.8, -2.2, top + 1.7, 3.2), "#eeeeea"]);
  p.push([box(1.85, 0.8, 1.85, -2.2, top + 2.0, 3.2), "#23313f"]);
  p.push([box(0.4, 0.4, 0.4, 2.2, top + 0.9, 3.6), ORANGE]);
  return mergeColored(p);
}

export function reachBodyGeometry() {
  const R = "#e0401e";
  const p: Part[] = [
    [box(3.4, 1.2, 8.6, 0, 1.1, -0.6), R], // chassis
    [box(3.5, 1.4, 2.4, 0, 1.5, -4.2), "#2b2b2b"], // counterweight
    [box(1.8, 2.0, 2.0, -0.7, 2.7, -1.2), "#f2f2ee"], // cab
    [box(1.85, 0.9, 2.05, -0.7, 2.9, -1.2), "#23313f"],
    [box(1.9, 0.2, 2.1, -0.7, 3.75, -1.2), R],
    [box(1.2, 1.4, 2.6, 1.1, 2.2, -2.6), "#3b3f45"], // engine
    [box(0.2, 1.2, 0.2, 1.4, 3.5, -3.4), "#888"],
  ];
  for (const sx of [-1, 1])
    for (const z of [2.6, -3.6]) p.push([cyl(0.75, 0.7, sx * 1.6, 0.75, z, "x", 12), "#1c1c1c"]);
  return mergeColored(p);
}
/** Unit-length boom along +z from its pivot. */
export function reachBoomGeometry() {
  return mergeColored([
    [box(0.9, 0.9, 1, 0, 0, 0.5), "#e0401e"],
    [box(0.6, 0.6, 1, 0, 0.12, 0.5), "#c7c7c2"],
  ]);
}

// =====================================================================================================
// Lorry (local, forward +z, origin at the fifth wheel on the ground)
// =====================================================================================================
const PAINT = "#ffffff"; // tinted by the instance colour

export function cabGeometry() {
  const p: Part[] = [
    [box(0.9, 0.35, 6.2, 0, 1.0, 1.5), DARK], // chassis rails
    [box(2.0, 0.25, 1.4, 0, 1.25, 0), "#555a60"], // fifth wheel plate
    [box(2.5, 2.3, 2.3, 0, 2.35, 3.4), PAINT], // cab box
    [box(2.45, 0.6, 0.9, 0, 3.75, 3.0), PAINT], // roof fairing
    [box(2.52, 0.95, 0.08, 0, 2.95, 4.56), "#1c2a38"], // windscreen
    [box(0.08, 0.7, 1.0, 1.26, 2.95, 3.7), "#1c2a38"],
    [box(0.08, 0.7, 1.0, -1.26, 2.95, 3.7), "#1c2a38"],
    [box(2.6, 0.45, 0.35, 0, 1.15, 4.65), "#2a2a2a"], // bumper
    [box(0.5, 0.18, 0.06, 0.85, 1.6, 4.58), "#fff6c9"], // headlights
    [box(0.5, 0.18, 0.06, -0.85, 1.6, 4.58), "#fff6c9"],
    [box(1.4, 0.8, 0.06, 0, 1.95, 4.58), "#3a3f45"], // grille
    [box(2.4, 0.5, 1.0, 0, 1.25, 2.1), "#3a3f45"], // tanks / steps
    [cyl(0.12, 2.4, 1.1, 2.6, 2.05), "#c8ccd0"], // exhaust stacks
    [cyl(0.12, 2.4, -1.1, 2.6, 2.05), "#c8ccd0"],
  ];
  for (const z of [3.5, 0.5, -0.8])
    for (const sx of [-1, 1]) p.push([cyl(0.52, 0.5, sx * 1.05, 0.52, z, "x", 12), "#161616"]);
  return mergeColored(p);
}

export function trailerGeometry() {
  const L = TRUCK.trailerLen;
  const zf = 0.9;
  const zr = zf - L;
  const mid = (zf + zr) / 2;
  const p: Part[] = [
    [box(0.35, 0.42, L, 0.55, 1.05, mid), "#3d4248"], // main beams
    [box(0.35, 0.42, L, -0.55, 1.05, mid), "#3d4248"],
    [box(2.45, 0.22, 0.6, 0, 1.25, zf - 0.3), "#3d4248"], // front bolster
    [box(2.45, 0.22, 0.6, 0, 1.25, zr + 0.3), "#3d4248"], // rear bolster
    [box(2.45, 0.22, 0.4, 0, 1.25, mid), "#3d4248"],
    [box(2.5, 0.25, 0.2, 0, 0.95, zr + 0.05), "#c0392b"], // rear light bar
    [box(0.3, 0.15, 0.06, 1.0, 0.95, zr - 0.06), "#ff2a1a"],
    [box(0.3, 0.15, 0.06, -1.0, 0.95, zr - 0.06), "#ff2a1a"],
    [box(0.2, 0.9, 0.2, 0.9, 0.5, zf - 2.6), "#555"], // landing legs
    [box(0.2, 0.9, 0.2, -0.9, 0.5, zf - 2.6), "#555"],
    [box(2.5, 0.12, 3.6, 0, 1.18, zr + 2.1), "#2a2a2a"], // mudguards
  ];
  for (let a = 0; a < 3; a++)
    for (const sx of [-1, 1]) p.push([cyl(0.5, 0.55, sx * 1.0, 0.5, zr + 1.0 + a * 1.3, "x", 12), "#161616"]);
  // twist locks at the corners (orange)
  for (const z of [zf - 0.3, zr + 0.3]) for (const sx of [-1, 1]) p.push([box(0.2, 0.15, 0.2, sx * 1.1, 1.42, z), ORANGE]);
  return mergeColored(p);
}

// =====================================================================================================
// Ship (ship-local x relative to SHIP.x; z world)
// =====================================================================================================
function hullShape() {
  // shape X = local x, shape Y = -world z (rotateX(-PI/2) maps it back)
  const hw = SHIP.beam / 2;
  const s = new THREE.Shape();
  const stern = -SHIP.zStern;
  const bow = -SHIP.zBow;
  s.moveTo(-hw, stern + 3);
  s.quadraticCurveTo(-hw, stern, -hw + 3, stern);
  s.lineTo(hw - 3, stern);
  s.quadraticCurveTo(hw, stern, hw, stern + 3);
  s.lineTo(hw, bow - 24);
  s.quadraticCurveTo(hw - 1, bow - 8, 0, bow);
  s.quadraticCurveTo(-hw + 1, bow - 8, -hw, bow - 24);
  s.closePath();
  return s;
}
export function hullGeometry(y0: number, y1: number) {
  const g = new THREE.ExtrudeGeometry(hullShape(), { depth: y1 - y0, bevelEnabled: false, curveSegments: 8 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  g.computeVertexNormals();
  return g;
}
const DECKHOUSE_Z = 296;
export function superstructureGeometry() {
  const d = SHIP.deckY;
  const hz = DECKHOUSE_Z;
  const p: Part[] = [
    [box(21, 15, 9, 0, d + 7.5, hz), "#f3f1ea"],
    [box(28, 1.2, 4.2, 0, d + 14.4, hz - 2.6), "#f3f1ea"],
    [box(15, 2.4, 7, 0, d + 16.2, hz), "#f3f1ea"],
    [box(0.5, 7, 0.5, 0, d + 20.8, hz), "#3a3d42"],
    [box(4, 0.3, 0.3, 0, d + 23, hz), "#3a3d42"],
    [box(4.6, 9, 4.6, 0, d + 10, 302), "#4bb4d6"], // funnel in the MAERLIN blue
    [box(4.7, 1.1, 4.7, 0, d + 14.2, 302), "#1d1f22"],
    [box(12, 2.6, 5, 0, d + 1.3, SHIP.zBow + 8), "#2a3a55"], // forecastle
    [box(0.5, 10, 0.5, 0, d + 5, SHIP.zBow + 8), "#e8e6df"],
  ];
  for (let k = 0; k <= SHIP_BAYS; k++) p.push([box(21.5, 3, 0.3, 0, d + 1.5, shipBayZ(k) - 6.3), "#6c7480"]);
  for (let k = 0; k < SHIP_BAYS; k++) p.push([box(21, 0.5, 12.3, 0, d - 0.2, shipBayZ(k)), "#3f5f4d"]);
  return mergeColored(p);
}
export function shipWindowGeometry() {
  const d = SHIP.deckY;
  const hz = DECKHOUSE_Z;
  const parts: THREE.BufferGeometry[] = [];
  for (const y of [d + 3.2, d + 6.2, d + 9.2, d + 12.2]) {
    parts.push(box(18, 0.9, 0.12, 0, y, hz - 4.53));
    parts.push(box(0.12, 0.9, 7, -10.53, y, hz));
    parts.push(box(0.12, 0.9, 7, 10.53, y, hz));
  }
  parts.push(box(14, 1.2, 0.12, 0, d + 16.4, hz - 3.53));
  const m = mergeGeometries(parts.map((g) => g.toNonIndexed()), false)!;
  for (const g of parts) g.dispose();
  return m;
}

// =====================================================================================================
// Static site: rails, gate canopy + booths, customs shed + X-ray portal, fences, reefer racks, mast poles
// =====================================================================================================
export function siteGeometry() {
  const p: Part[] = [];
  const RAIL = "#4a4f55";
  // RMG rails (along x, at each leg line)
  for (let k = 0; k < 3; k++)
    for (const z of rmgLegs(k)) p.push([box(RMG.maxX - RMG.minX + 10, 0.16, 0.35, (RMG.minX + RMG.maxX) / 2, 0.08, z), RAIL]);
  // STS rails (along z)
  for (const x of STS.legX) p.push([box(0.35, 0.16, 200, x, 0.08, 232), RAIL]);
  // STS crane bumpers at the ends of the rails
  for (const x of STS.legX) for (const z of [132, 332]) p.push([box(1.2, 1.2, 1.2, x, 0.6, z), YELLOW]);

  // ---- gate canopy
  const [cx0, cx1] = GATE.canopyX;
  const [cz0, cz1] = GATE.canopyZ;
  const cy = GATE.canopyY;
  p.push([box(cx1 - cx0, 0.7, cz1 - cz0, (cx0 + cx1) / 2, cy + 0.35, (cz0 + cz1) / 2), "#e9e7e1"]);
  p.push([box(cx1 - cx0 + 0.2, 1.2, 0.25, (cx0 + cx1) / 2, cy + 0.2, cz0 - 0.1), ORANGE]); // fascia
  p.push([box(cx1 - cx0 + 0.2, 1.2, 0.25, (cx0 + cx1) / 2, cy + 0.2, cz1 + 0.1), ORANGE]);
  const islands = [CT_GATE_X[0] - 5.5, ...CT_GATE_X.map((x) => x + 5.5)];
  for (const ix of islands) {
    p.push([box(2.6, 0.25, cz1 - cz0 + 6, ix, 0.12, (cz0 + cz1) / 2), "#c9c4b8"]); // kerbed island
    for (const z of [cz0 + 1, cz1 - 1]) p.push([box(0.5, cy, 0.5, ix, cy / 2, z), "#9aa1a8"]);
  }
  // booths on the islands east of each lane (driver side)
  const b = GATE.booth;
  for (const x of CT_GATE_X) {
    const bx = x + 5.5;
    p.push([box(b.w, b.h, b.d, bx, b.h / 2 + 0.25, GATE.barrierZ - 4), "#f4f2ec"]);
    p.push([box(b.w + 0.05, 0.8, b.d - 0.6, bx, 1.9, GATE.barrierZ - 4), "#2c3e50"]); // glazing
    p.push([box(b.w + 0.3, 0.2, b.d + 0.3, bx, b.h + 0.35, GATE.barrierZ - 4), ORANGE]);
    p.push([box(0.5, 1.1, 0.5, bx - 0.9, 0.8, GATE.barrierZ), "#d8d8d8"]); // barrier post
    // OCR camera gantry
    p.push([box(0.25, 4.6, 0.25, bx - 1.2, 2.3, cz0 - 2), "#9aa1a8"]);
    p.push([box(1.2, 0.5, 0.6, bx - 1.6, 4.6, cz0 - 2), "#2a2d31"]);
  }
  // out-gate booth on the exit road
  const og = GATE.outGate;
  p.push([box(1.6, 2.6, 2.4, og.x, 1.3, og.z), "#f4f2ec"]);
  p.push([box(1.65, 0.8, 1.8, og.x, 1.9, og.z), "#2c3e50"]);
  p.push([box(1.9, 0.2, 2.7, og.x, 2.7, og.z), ORANGE]);
  p.push([box(0.5, 1.1, 0.5, og.x, 0.55, og.z + 2.6), "#d8d8d8"]);

  // ---- customs shed (open to the south) + X-ray portal
  const C = CUSTOMS;
  const cw = C.x1 - C.x0;
  const cd = C.z1 - C.z0;
  const ccx = (C.x0 + C.x1) / 2;
  const ccz = (C.z0 + C.z1) / 2;
  p.push([box(0.4, C.h, cd, C.x0, C.h / 2, ccz), "#c5ccd3"]);
  p.push([box(0.4, C.h, cd, C.x1, C.h / 2, ccz), "#c5ccd3"]);
  p.push([box(cw, C.h, 0.4, ccx, C.h / 2, C.z0), "#c5ccd3"]);
  p.push([box(cw + 1, 0.6, cd + 1, ccx, C.h + 0.3, ccz), "#5b6670"]);
  p.push([box(cw + 1.1, 1.0, 0.3, ccx, C.h - 0.8, C.z1 + 0.5), "#24427f"]);
  p.push([box(cw - 3, 0.12, cd - 2, ccx, 0.07, ccz), "#d9b23a"]); // inspection bay paint
  for (const sx of [-1, 1]) {
    p.push([box(1.1, 7.2, 1.1, C.laneX + sx * 5, 3.6, C.portalZ), "#2b2f35"]);
    p.push([box(1.3, 1.6, 1.4, C.laneX + sx * 5, 1.2, C.portalZ), "#3a4048"]); // detector cabinets
  }
  p.push([box(11.1, 1.3, 1.3, C.laneX, 7.6, C.portalZ), "#2b2f35"]);

  // ---- perimeter fence (west + south), posts and rails
  const FENCE = "#7c8389";
  const west = ZONE.minX + 1;
  for (const [z0, z1] of [[112, 220], [236, ZONE.maxZ - 0.5]] as [number, number][]) {
    p.push([box(0.08, 0.08, z1 - z0, west, 2.2, (z0 + z1) / 2), FENCE]);
    p.push([box(0.05, 1.8, z1 - z0, west, 1.2, (z0 + z1) / 2), "#9aa3ab"]);
    for (let z = z0; z <= z1; z += 6) p.push([box(0.12, 2.3, 0.12, west, 1.15, z), FENCE]);
  }
  for (const [x0, x1] of [[ZONE.minX + 1, 312]] as [number, number][]) {
    p.push([box(x1 - x0, 0.08, 0.08, (x0 + x1) / 2, 2.2, ZONE.maxZ - 0.5), FENCE]);
    p.push([box(x1 - x0, 1.8, 0.05, (x0 + x1) / 2, 1.2, ZONE.maxZ - 0.5), "#9aa3ab"]);
    for (let x = x0; x <= x1; x += 6) p.push([box(0.12, 2.3, 0.12, x, 1.15, ZONE.maxZ - 0.5), FENCE]);
  }

  // ---- reefer racks: walkway gantries between row pairs
  const reefer = BLOCKS.find((bl) => bl.kind === "reefer")!;
  for (let r = 1; r < reefer.rowsZ.length; r += 2) {
    const z = (reefer.rowsZ[r - 1] + reefer.rowsZ[r]) / 2 + 1.37;
    const x0 = BAY_X[0] - 6.6;
    const x1 = BAY_X[BAY_X.length - 1] + 6.6;
    p.push([box(x1 - x0, 0.25, 0.9, (x0 + x1) / 2, 8.2, z), "#9aa1a8"]);
    for (const x of [x0, ...BAY_X.slice(0, -1).map((bx) => bx + 6.5), x1]) p.push([box(0.25, 8.2, 0.25, x, 4.1, z), "#7d858d"]);
    p.push([box(x1 - x0, 0.6, 0.3, (x0 + x1) / 2, 6.6, z), "#2c5aa0"]); // cable trays
  }

  // ---- light mast poles
  for (const [x, z] of LIGHT_MASTS) p.push([cyl(0.32, 30, x, 15, z, "y", 6), "#8a9199"]);
  return mergeColored(p);
}

/** Barrier arm, pivot at the origin, extends along -x (4.6 m), red/white. */
export function barrierArmGeometry() {
  const p: Part[] = [];
  for (let i = 0; i < 6; i++) p.push([box(0.78, 0.14, 0.14, -0.4 - i * 0.78, 0, 0), i % 2 ? "#ffffff" : "#d62828"]);
  return mergeColored(p);
}

export function lampHeadGeometry() {
  const parts = [box(3.6, 0.3, 1.6, 0, 30.2, 0), box(1, 0.9, 1.1, -1.2, 29.7, 0), box(1, 0.9, 1.1, 1.2, 29.7, 0)];
  const m = mergeGeometries(parts.map((g) => g.toNonIndexed()), false)!;
  for (const g of parts) g.dispose();
  return m;
}

/** Positions of the STS cranes (for instancing). */
export const STS_Z = STS_CRANES.map((c) => c.z);

export { REACH };
