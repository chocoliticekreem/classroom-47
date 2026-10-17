// Docks: procedural geometry. Static multi-part objects are merged into one vertex-coloured
// geometry each, so a whole crane frame or ship superstructure is a single draw call.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  CRANE_BOOM_Y,
  CRANE_HOME_X,
  CRANE_LEG_HALF_Z,
  CRANE_LEG_X,
  SHIP,
  SHIP_BAYS,
  shipBayZ,
} from "./layout";

type Part = [THREE.BufferGeometry, string];

export function box(w: number, h: number, d: number, x: number, y: number, z: number) {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
}
const _up = new THREE.Vector3(0, 1, 0);
/** A square beam of thickness t between two points. */
export function beam(a: [number, number, number], b: [number, number, number], t: number) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const dir = vb.clone().sub(va);
  const len = dir.length();
  const g = new THREE.BoxGeometry(t, len, t);
  const q = new THREE.Quaternion().setFromUnitVectors(_up, dir.normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(va.add(vb).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  return g;
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
  m.computeBoundingSphere();
  return m;
}

// ---------- STS crane (world x, z relative to the crane) ----------
const LEG = "#c9392a";
const WHITE = "#efede6";
const DARK = "#3a3d42";
const ORANGE = "#ff6a1a";

export function craneFrameGeometry() {
  const p: Part[] = [];
  const hz = CRANE_LEG_HALF_Z;
  const top = 28.4; // portal top beams (kept below the trolley cab's path)
  const by = CRANE_BOOM_Y + 1.1; // boom girder centre
  for (const lx of CRANE_LEG_X)
    for (const sz of [-1, 1]) {
      p.push([box(1.3, top, 1.3, lx, top / 2, sz * hz), LEG]);
      p.push([box(2.6, 1.3, 4.4, lx, 0.65, sz * hz), DARK]);
      p.push([box(1.45, 1.1, 1.45, lx, 18, sz * hz), WHITE]);
    }
  for (const lx of CRANE_LEG_X) {
    p.push([box(1.6, 1.9, hz * 2 + 1.3, lx, top, 0), LEG]);
    p.push([beam([lx, 12, -hz], [lx, top - 1, hz], 0.6), LEG]);
    // posts carrying the boom, outside the trolley + cab envelope
    for (const sz of [-1, 1]) p.push([box(0.7, 33.7 - top, 0.7, lx, (33.7 + top) / 2, sz * 4.6), LEG]);
    p.push([box(1, 0.7, 10, lx, 33.35, 0), LEG]);
  }
  const span = CRANE_LEG_X[1] - CRANE_LEG_X[0];
  for (const sz of [-1, 1]) {
    p.push([box(span + 1.3, 1.9, 1.6, CRANE_HOME_X, top, sz * hz), LEG]);
    p.push([box(span, 1, 1, CRANE_HOME_X, 12, sz * hz), LEG]);
  }
  // boom: backreach x 299 -> outreach x 383
  const x0 = 299, x1 = 383;
  for (const sz of [-1, 1]) p.push([box(x1 - x0, 2.2, 0.9, (x0 + x1) / 2, by, sz * 1.7), WHITE]);
  for (let x = x0 + 2; x < x1; x += 6) p.push([box(0.4, 0.4, 3.4, x, by + 1.2, 0), WHITE]);
  p.push([box(1.6, 3.2, 4.4, x1, by, 0), WHITE]);
  // machinery house on the backreach
  p.push([box(12, 4.5, 7, 306, by + 3.4, 0), WHITE]);
  p.push([box(12.1, 0.9, 7.1, 306, by + 3, 0), ORANGE]);
  // A-frame apex + stays
  const apex: [number, number] = [CRANE_HOME_X, 48];
  for (const sz of [-1, 1]) {
    for (const lx of CRANE_LEG_X) p.push([beam([lx, 34, sz * 4.6], [apex[0], apex[1], sz * 1.2], 1.0), WHITE]);
    p.push([beam([apex[0], apex[1], sz * 1.2], [x1 - 1, by + 1, sz * 1.7], 0.35), WHITE]);
    p.push([beam([apex[0], apex[1], sz * 1.2], [x0 + 3, by + 1, sz * 1.7], 0.35), WHITE]);
    p.push([beam([apex[0], apex[1] - 6, sz * 1.4], [356, by + 1, sz * 1.7], 0.3), WHITE]);
  }
  p.push([box(2, 1.4, 3.8, apex[0], apex[1] + 0.4, 0), ORANGE]);
  return mergeColored(p);
}

/** Trolley + operator cab, origin at x = 0 (instance translates to trolleyX). */
export function trolleyGeometry() {
  const y = CRANE_BOOM_Y - 0.8;
  return mergeColored([
    [box(5, 1.6, 2.2, 0, y, 0), "#5b626b"],
    [box(1.2, 0.4, 2.2, -0.6, y - 1.0, 1.9), "#5b626b"],
    [box(2.6, 1.7, 2.4, -0.6, y - 1.75, 2.85), WHITE],
    [box(2.65, 0.7, 2.45, -0.6, y - 1.6, 2.85), "#23313f"],
    [box(2.9, 0.3, 2.7, -0.6, y - 0.75, 2.85), ORANGE],
  ]);
}
/** Spreader frame, bottom at y = 0. */
export function spreaderGeometry() {
  return mergeColored([
    [box(2.9, 0.7, 12.5, 0, 0.35, 0), "#f2c12e"],
    [box(2.2, 0.9, 3, 0, 1.15, 0), "#3a3d42"],
    [box(3.1, 0.5, 0.5, 0, 0.6, 6.0), "#f2c12e"],
    [box(3.1, 0.5, 0.5, 0, 0.6, -6.0), "#f2c12e"],
  ]);
}

// ---------- straddle carrier (local, forward +z) ----------
export function straddleGeometry() {
  const Y = "#f0b21b";
  const p: Part[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      p.push([box(0.6, 8.6, 0.7, sx * 2.2, 5.1, sz * 3.4), Y]);
      p.push([box(0.9, 1.2, 1.6, sx * 2.2, 0.6, sz * 3.4), "#222"]);
    }
    p.push([box(0.7, 1.1, 8.0, sx * 2.2, 9.6, 0), Y]);
    p.push([box(0.5, 0.8, 7.2, sx * 2.2, 1.6, 0), Y]); // lower sill
    p.push([box(1.4, 1.8, 3.2, sx * 2.2, 11, -1.4), "#d8d8d2"]); // engine pods
  }
  for (const sz of [-1, 1]) p.push([box(5.1, 0.8, 0.8, 0, 9.8, sz * 3.4), Y]);
  p.push([box(1.8, 2.0, 1.8, -2.2, 11.3, 3.0), "#eeeeea"]);
  p.push([box(1.85, 0.8, 1.85, -2.2, 11.6, 3.0), "#23313f"]);
  p.push([box(0.4, 0.4, 0.4, 2.2, 12.3, 3.4), ORANGE]);
  return mergeColored(p);
}

// ---------- ship ----------
function hullShape() {
  // shape X = world x - SHIP.x, shape Y = -world z (see rotateX below)
  const hw = SHIP.beam / 2;
  const s = new THREE.Shape();
  const stern = -SHIP.zStern, bow = -SHIP.zBow;
  s.moveTo(-hw, stern + 3);
  s.quadraticCurveTo(-hw, stern, -hw + 3, stern);
  s.lineTo(hw - 3, stern);
  s.quadraticCurveTo(hw, stern, hw, stern + 3);
  s.lineTo(hw, bow - 22);
  s.quadraticCurveTo(hw - 1, bow - 8, 0, bow);
  s.quadraticCurveTo(-hw + 1, bow - 8, -hw, bow - 22);
  s.closePath();
  return s;
}
/** Hull band from y0 to y1 (ship-local coords: x relative to SHIP.x). Groups: 0 caps, 1 sides. */
export function hullGeometry(y0: number, y1: number, inset = 0) {
  const g = new THREE.ExtrudeGeometry(hullShape(), { depth: y1 - y0, bevelEnabled: false, curveSegments: 8 });
  g.rotateX(-Math.PI / 2);
  if (inset) g.scale(1 - inset, 1, 1 - inset * 0.3);
  g.translate(0, y0, 0);
  g.computeVertexNormals();
  return g;
}

export function superstructureGeometry() {
  const d = SHIP.deckY;
  const hz = 52; // deckhouse centre z
  const p: Part[] = [
    [box(21, 14, 10, 0, d + 7, hz), "#f3f1ea"],
    [box(28, 1.2, 4.5, 0, d + 13.4, hz - 3), "#f3f1ea"],
    [box(15, 2.4, 8, 0, d + 15.2, hz), "#f3f1ea"],
    [box(0.5, 7, 0.5, 0, d + 19.8, hz), "#3a3d42"],
    [box(4, 0.3, 0.3, 0, d + 22, hz), "#3a3d42"],
    [box(4.6, 9, 5.2, 0, d + 10, 62.5), ORANGE],
    [box(4.7, 1.1, 5.3, 0, d + 14.2, 62.5), "#1d1f22"],
    [box(4.7, 1.0, 5.3, 0, d + 9, 62.5), "#ffffff"],
    // forecastle + bow mast
    [box(12, 2.6, 5, 0, d + 1.3, -66), "#2a3a55"],
    [box(0.5, 10, 0.5, 0, d + 5, -66), "#e8e6df"],
    // stern deck
    [box(20, 1.8, 10, 0, d + 0.9, 68.5), "#2a3a55"],
  ];
  // lashing bridges between bays
  for (let k = 0; k <= SHIP_BAYS; k++) p.push([box(21.5, 3, 0.3, 0, d + 1.5, shipBayZ(k) - 6.4), "#6c7480"]);
  // hatch covers
  for (let k = 0; k < SHIP_BAYS; k++) p.push([box(21, 0.5, 12.4, 0, d - 0.2, shipBayZ(k)), "#3f5f4d"]);
  return mergeColored(p);
}

/** Window bands on the deckhouse (emissive at night). */
export function shipWindowGeometry() {
  const d = SHIP.deckY;
  const hz = 52;
  const parts: THREE.BufferGeometry[] = [];
  for (const y of [d + 3.2, d + 6.2, d + 9.2, d + 12]) {
    parts.push(box(18, 0.9, 0.12, 0, y, hz - 5.03));
    parts.push(box(18, 0.9, 0.12, 0, y, hz + 5.03));
    parts.push(box(0.12, 0.9, 8, -10.53, y, hz));
    parts.push(box(0.12, 0.9, 8, 10.53, y, hz));
  }
  parts.push(box(14, 1.2, 0.12, 0, d + 15.4, hz - 4.03));
  return mergeGeometries(parts.map((g) => g.toNonIndexed()), false)!;
}

/** Shed: walls, gable roof, roller doors; centred at origin. */
export function shedGeometry(w: number, d: number, h: number, wall: string) {
  const p: Part[] = [[box(w, h, d, 0, h / 2, 0), wall]];
  const roof = new THREE.Shape();
  roof.moveTo(-d / 2 - 0.6, 0);
  roof.lineTo(0, 3.2);
  roof.lineTo(d / 2 + 0.6, 0);
  roof.closePath();
  const rg = new THREE.ExtrudeGeometry(roof, { depth: w + 1, bevelEnabled: false });
  rg.translate(0, 0, -(w + 1) / 2);
  rg.rotateY(Math.PI / 2);
  rg.translate(0, h, 0);
  p.push([rg, "#5d6873"]);
  // roller doors on both long faces + orange band
  for (const sz of [-1, 1]) {
    for (let i = -2; i <= 2; i++) p.push([box(4.4, 5.2, 0.15, i * 6.5, 2.6, sz * (d / 2 + 0.05)), "#7f8790"]);
    p.push([box(w + 0.1, 0.8, 0.2, 0, h - 0.8, sz * (d / 2 + 0.05)), ORANGE]);
  }
  return mergeColored(p);
}
