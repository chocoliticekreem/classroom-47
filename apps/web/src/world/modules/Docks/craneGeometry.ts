// Docks STS crane geometry split for a hinged boom: the fixed frame (legs, portal, backreach,
// A-frame) and the outreach boom, which pivots at HINGE and is raised when no ship is working.
import * as THREE from "three";
import { box, beam, mergeColored } from "./geometry";
import { CRANE_BOOM_Y, CRANE_HOME_X, CRANE_LEG_HALF_Z, CRANE_LEG_X } from "./layout";

type Part = [THREE.BufferGeometry, string];
const LEG = "#c9392a";
const WHITE = "#efede6";
const DARK = "#3a3d42";
const ORANGE = "#ff6a1a";

export const BOOM_Y = CRANE_BOOM_Y + 1.1; // girder centre line
export const HINGE_X = 338.6;
export const BOOM_LEN = 44.5; // hinge -> tip (x 383 when lowered)
export const APEX: [number, number] = [CRANE_HOME_X, 48];
export const BOOM_RAISED = 1.25; // radians

export function craneFixedGeometry() {
  const p: Part[] = [];
  const hz = CRANE_LEG_HALF_Z;
  const top = 28.4;
  for (const lx of CRANE_LEG_X)
    for (const sz of [-1, 1]) {
      p.push([box(1.3, top, 1.3, lx, top / 2, sz * hz), LEG]);
      p.push([box(2.6, 1.3, 4.4, lx, 0.65, sz * hz), DARK]);
      for (const wz of [-1.4, 0, 1.4]) p.push([box(2.7, 0.9, 0.9, lx, 0.45, sz * hz + wz), "#1b1c1f"]);
      p.push([box(1.45, 1.1, 1.45, lx, 18, sz * hz), WHITE]);
    }
  for (const lx of CRANE_LEG_X) {
    p.push([box(1.6, 1.9, hz * 2 + 1.3, lx, top, 0), LEG]);
    p.push([beam([lx, 12, -hz], [lx, top - 1, hz], 0.6), LEG]);
    p.push([beam([lx, 12, hz], [lx, top - 1, -hz], 0.6), LEG]);
    for (const sz of [-1, 1]) p.push([box(0.7, 33.7 - top, 0.7, lx, (33.7 + top) / 2, sz * 4.6), LEG]);
    p.push([box(1, 0.7, 10, lx, 33.35, 0), LEG]);
  }
  const span = CRANE_LEG_X[1] - CRANE_LEG_X[0];
  for (const sz of [-1, 1]) {
    p.push([box(span + 1.3, 1.9, 1.6, CRANE_HOME_X, top, sz * hz), LEG]);
    p.push([box(span, 1, 1, CRANE_HOME_X, 12, sz * hz), LEG]);
  }
  // backreach girders up to the hinge
  const x0 = 299;
  for (const sz of [-1, 1]) p.push([box(HINGE_X - x0, 2.2, 0.9, (x0 + HINGE_X) / 2, BOOM_Y, sz * 1.7), WHITE]);
  for (let x = x0 + 2; x < HINGE_X - 1; x += 6) p.push([box(0.4, 0.4, 3.4, x, BOOM_Y + 1.2, 0), WHITE]);
  for (const sz of [-1, 1]) p.push([box(1.4, 1.4, 1.2, HINGE_X, BOOM_Y, sz * 2.5), DARK]);
  // machinery house + operator walkway
  p.push([box(12, 4.5, 7, 306, BOOM_Y + 3.4, 0), WHITE]);
  p.push([box(12.1, 0.9, 7.1, 306, BOOM_Y + 3, 0), ORANGE]);
  p.push([box(36, 0.2, 1.2, 320, BOOM_Y - 1.2, 2.6), "#7a7f86"]);
  // A-frame + backstays
  for (const sz of [-1, 1]) {
    for (const lx of CRANE_LEG_X) p.push([beam([lx, 34, sz * 4.6], [APEX[0], APEX[1], sz * 1.2], 1.0), WHITE]);
    p.push([beam([APEX[0], APEX[1], sz * 1.2], [x0 + 3, BOOM_Y + 1, sz * 1.7], 0.35), WHITE]);
  }
  p.push([box(2, 1.4, 3.8, APEX[0], APEX[1] + 0.4, 0), ORANGE]);
  return mergeColored(p);
}

/** Outreach boom in hinge-local coordinates (x along the boom from the hinge, y = 0 at girder centre). */
export function boomGeometry() {
  const p: Part[] = [];
  for (const sz of [-1, 1]) p.push([box(BOOM_LEN, 2.2, 0.9, BOOM_LEN / 2, 0, sz * 1.7), WHITE]);
  for (let x = 2; x < BOOM_LEN; x += 6) p.push([box(0.4, 0.4, 3.4, x, 1.2, 0), WHITE]);
  for (let x = 5; x < BOOM_LEN; x += 6) p.push([beam([x - 3, 1.1, 1.7], [x + 3, -1.1, 1.7], 0.25), WHITE]);
  p.push([box(1.6, 3.2, 4.4, BOOM_LEN, 0, 0), WHITE]);
  p.push([box(1.7, 0.6, 4.5, BOOM_LEN, 1.4, 0), ORANGE]);
  return mergeColored(p);
}

/** Lashing-crew figure (no vest): legs, arms, head, hard hat. ~1.8 m tall, feet at y = 0. */
export function crewBodyGeometry() {
  return mergeColored([
    [box(0.22, 0.85, 0.22, -0.12, 0.43, 0), "#26303d"],
    [box(0.22, 0.85, 0.22, 0.12, 0.43, 0), "#26303d"],
    [box(0.15, 0.6, 0.15, -0.32, 1.15, 0), "#26303d"],
    [box(0.15, 0.6, 0.15, 0.32, 1.15, 0), "#26303d"],
    [box(0.24, 0.26, 0.24, 0, 1.58, 0), "#d7a27c"],
    [box(0.3, 0.12, 0.3, 0, 1.76, 0), "#f4f4f0"],
  ]);
}
export function crewVestGeometry() {
  return box(0.52, 0.66, 0.3, 0, 1.18, 0);
}

/** Downward light cone, apex at y = 0, unit length (scale y to size). */
export function coneGeometry(radius: number) {
  return new THREE.CylinderGeometry(0.4, radius, 1, 14, 1, true).translate(0, -0.5, 0);
}

/** Quay lamp post: pole + arm reaching landward, base at 0. */
export function quayPostGeometry() {
  return mergeColored([
    [new THREE.CylinderGeometry(0.12, 0.18, 10, 6).translate(0, 5, 0), "#4b5058"],
    [box(1.8, 0.14, 0.14, -0.9, 9.9, 0), "#4b5058"],
  ]);
}
export function quayLampGeometry() {
  return box(0.8, 0.25, 0.45, -1.7, 9.8, 0);
}
/** Spreader work lights: two small lamps at the spreader ends (spreader-local). */
export function spreaderLampGeometry() {
  const a = box(0.5, 0.3, 0.5, 0, 1.75, 5.5).toNonIndexed();
  const b = box(0.5, 0.3, 0.5, 0, 1.75, -5.5).toNonIndexed();
  const g = new THREE.BufferGeometry();
  const pa = a.attributes.position.array as Float32Array, pb = b.attributes.position.array as Float32Array;
  const na = a.attributes.normal.array as Float32Array, nb = b.attributes.normal.array as Float32Array;
  const pos = new Float32Array(pa.length + pb.length);
  pos.set(pa);
  pos.set(pb, pa.length);
  const nor = new Float32Array(na.length + nb.length);
  nor.set(na);
  nor.set(nb, na.length);
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  return g;
}
