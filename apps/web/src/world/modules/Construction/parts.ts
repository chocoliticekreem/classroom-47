// Low-poly vertex-coloured parts for the moving machines. Client only. Each returns a BufferGeometry
// built with Batch; local frames are documented per part so the animation code can pivot them.
import * as THREE from "three";
import { Batch } from "./kit";

export const CRANE_COLOURS = { red: "#d22f27", yellow: "#f2b705" } as const;
const WHITE = "#f2f2ee";
const DARK = "#2b2d31";
const STEEL = "#7d828a";
const CONCRETE = "#a7a7a0";
const GLASS = "#22313d";
const ORANGE = "#ff6a1a";

/** Apex (tower head) height above the slewing ring. */
export const APEX_Y = 9;

/**
 * Slewing part of a tower crane. Origin = top of the mast; jib along +x, counter-jib along -x.
 * Lights: apex (0, APEX_Y + 0.3, 0), jib tip (jib, 2.7, 0), counter-jib tail (-cj, 2.2, 0).
 */
export function craneHead(jib: number, cj: number, colour: "red" | "yellow"): THREE.BufferGeometry {
  const b = new Batch();
  const main = CRANE_COLOURS[colour];
  const band = (x: number) => (colour === "red" && Math.floor(x / 4) % 2 === 1 ? WHITE : main);
  // slewing ring + platform
  b.box(0, 0.4, 0, 2.8, 0.8, 2.8, DARK);
  // cab on the jib side
  b.box(1.4, 1.3, 1.9, 2.2, 2.0, 1.6, WHITE);
  b.box(2.52, 1.5, 1.9, 0.06, 1.1, 1.3, GLASS);
  // tower head (apex)
  for (const [x, z] of [[0.9, 0.9], [0.9, -0.9], [-0.9, 0.9], [-0.9, -0.9]]) b.member(x, 0.8, z, 0, APEX_Y, 0, 0.22, main);
  b.member(-0.6, 4.5, 0, 0.6, 4.5, 0, 0.14, main);
  b.box(0, APEX_Y, 0, 0.5, 0.5, 0.5, main);
  // jib: triangular lattice
  const y0 = 0.8;
  const y1 = 2.4;
  const w = 0.8;
  const step = 2;
  b.member(1.4, y0, w, jib, y0, w, 0.18, main);
  b.member(1.4, y0, -w, jib, y0, -w, 0.18, main);
  b.member(1.4, y1, 0, jib - 0.6, y1, 0, 0.18, main);
  for (let x = 1.4; x < jib - 0.1; x += step) {
    const x2 = Math.min(jib, x + step);
    const c = band(x);
    b.member(x, y0, w, x2, y1, 0, 0.1, c);
    b.member(x, y0, -w, x2, y1, 0, 0.1, c);
    b.member(x, y0, w, x, y0, -w, 0.1, c);
    b.member(x2, y1, 0, x2, y0, w, 0.08, c);
    b.member(x2, y1, 0, x2, y0, -w, 0.08, c);
  }
  b.box(jib, 1.6, 0, 0.3, 2.2, 1.8, main);
  // counter-jib: flat frame with walkway, railing and counterweights
  b.member(-1.4, y0, 0.9, -cj, y0, 0.9, 0.2, main);
  b.member(-1.4, y0, -0.9, -cj, y0, -0.9, 0.2, main);
  b.member(-1.4, 1.8, 0.95, -cj, 1.8, 0.95, 0.06, main);
  b.member(-1.4, 1.8, -0.95, -cj, 1.8, -0.95, 0.06, main);
  for (let x = -1.4; x > -cj; x -= 2) b.member(x, y0, 0.9, x, y0, -0.9, 0.12, band(-x));
  b.box((-1.4 - cj) / 2, y0 + 0.12, 0, cj - 1.4, 0.08, 1.4, STEEL);
  b.box(-cj * 0.45, y0 + 0.75, 0, 1.6, 1.3, 1.2, "#3f6fa0"); // hoist winch
  for (let i = 0; i < 3; i++) b.box(-cj + 0.7 + i * 1.05, 0.0, 0, 0.95, 2.4, 2.1, CONCRETE);
  // pendant ties from the apex
  b.member(0, APEX_Y, 0, jib * 0.62, y1, 0, 0.07, STEEL);
  b.member(0, APEX_Y, 0, jib * 0.3, y1, 0, 0.07, STEEL);
  b.member(0, APEX_Y, 0.1, -cj + 0.4, y0, 0.9, 0.07, STEEL);
  b.member(0, APEX_Y, -0.1, -cj + 0.4, y0, -0.9, 0.07, STEEL);
  return b.build();
}

/** Trolley, origin on the jib's bottom chords. */
export function trolley() {
  const b = new Batch();
  b.box(0, 0.2, 0, 1.3, 0.5, 1.9, DARK);
  b.box(0, -0.15, 0, 0.6, 0.3, 0.6, STEEL);
  return b.build();
}

/** Hook block, origin at the hook point (bottom); block above it. */
export function hookBlock() {
  const b = new Batch();
  b.box(0, 0.75, 0, 0.7, 0.9, 0.45, "#f2b705");
  b.box(0, 0.15, 0, 0.12, 0.3, 0.12, DARK);
  return b.build();
}

/** Bundle of steel beams on two slings; origin at the hook point. */
export function beamLoad() {
  const b = new Batch();
  for (let i = -1; i <= 1; i++) {
    b.box(0, -0.9, i * 0.32, 6, 0.36, 0.22, "#a0402a");
    b.box(0, -0.9, i * 0.32, 6, 0.06, 0.32, "#8a3522");
  }
  b.member(0, 0, 0, -2.4, -0.72, 0, 0.05, DARK);
  b.member(0, 0, 0, 2.4, -0.72, 0, 0.05, DARK);
  return b.build();
}

/** Concrete skip with a bail; origin at the hook point. */
export function bucketLoad() {
  const b = new Batch();
  const cone = new THREE.CylinderGeometry(0.75, 0.45, 1.3, 10);
  b.place(cone, 0, -1.05, 0, "#8d8f93");
  b.box(0, -0.42, 0, 1.6, 0.14, 0.14, ORANGE);
  b.member(-0.75, -0.45, 0, 0, 0, 0, 0.06, DARK);
  b.member(0.75, -0.45, 0, 0, 0, 0, 0.06, DARK);
  b.box(0.3, -1.85, 0, 0.3, 0.3, 0.3, DARK); // gate lever
  cone.dispose();
  return b.build();
}

/** Unit cable (1 m long, hangs from y 0 down to y -1). Scale y to the length. */
export function cable() {
  const b = new Batch();
  b.box(0, -0.5, 0, 0.07, 1, 0.07, "#1b1b1b");
  return b.build();
}

// --- Excavator: base (tracks), upper (cab + body), boom, stick, bucket ---------------------------

export const EXC = {
  upperY: 1.05,
  boomPivot: [0.45, 1.0, 1.1] as const, // in the upper frame (above upperY)
  boomLen: 4.6,
  stickLen: 3.0,
} as const;
const EXC_YELLOW = "#f0b323";

export function excBase() {
  const b = new Batch();
  for (const x of [-1.2, 1.2]) {
    b.box(x, 0.45, 0, 0.7, 0.9, 4.0, DARK);
    b.box(x, 0.45, 2.0, 0.66, 0.6, 0.4, "#3a3c40");
    b.box(x, 0.45, -2.0, 0.66, 0.6, 0.4, "#3a3c40");
  }
  b.box(0, 0.8, 0, 1.8, 0.5, 2.2, "#4a4c50");
  return b.build();
}

/** Upper structure: origin at the slew ring, facing +z. */
export function excUpper() {
  const b = new Batch();
  b.box(0, 0.5, -0.3, 2.6, 1.0, 3.2, EXC_YELLOW);
  b.box(0, 0.6, -1.85, 2.6, 1.2, 0.6, "#3a3c40"); // counterweight
  b.box(-0.65, 1.55, 0.6, 1.1, 1.3, 1.4, EXC_YELLOW); // cab
  b.box(-0.65, 1.65, 1.31, 0.95, 0.9, 0.04, GLASS);
  b.box(-1.21, 1.65, 0.6, 0.04, 0.9, 1.1, GLASS);
  b.box(0.55, 1.15, -0.8, 0.12, 0.6, 0.12, DARK); // exhaust
  return b.build();
}

/** Boom: from its pivot along +z. */
export function excBoom() {
  const b = new Batch();
  b.box(0, 0, EXC.boomLen / 2, 0.45, 0.6, EXC.boomLen, EXC_YELLOW);
  b.member(0, -0.45, 0.6, 0, -0.1, 2.4, 0.18, STEEL); // ram
  return b.build();
}

export function excStick() {
  const b = new Batch();
  b.box(0, 0, EXC.stickLen / 2, 0.36, 0.45, EXC.stickLen, EXC_YELLOW);
  b.member(0, 0.3, -0.3, 0, 0.3, 1.6, 0.14, STEEL);
  return b.build();
}

export function excBucket() {
  const b = new Batch();
  b.box(0, -0.25, 0.55, 1.1, 0.7, 0.9, "#3a3c40");
  b.box(0, -0.62, 1.05, 1.1, 0.1, 0.3, STEEL);
  return b.build();
}

// --- Site dump truck (articulated hauler style), facing +z ---------------------------------------

export const DUMP_HINGE = [0, 1.45, -2.9] as const;

export function dumpChassis() {
  const b = new Batch();
  const wheel = new THREE.CylinderGeometry(0.75, 0.75, 0.6, 12).rotateZ(Math.PI / 2);
  for (const z of [2.3, -1.3, -2.7]) for (const x of [-1.15, 1.15]) b.place(wheel, x, 0.75, z, "#1e1f22");
  b.box(0, 1.0, -0.6, 1.6, 0.45, 5.6, DARK);
  b.box(0, 1.55, 2.4, 2.2, 1.0, 1.6, EXC_YELLOW); // engine
  b.box(0, 2.45, 2.1, 1.7, 1.0, 1.1, EXC_YELLOW); // cab
  b.box(0, 2.5, 2.66, 1.45, 0.65, 0.04, GLASS);
  wheel.dispose();
  return b.build();
}

/** Bed: origin at the rear hinge, extends forward (+z). */
export function dumpBed() {
  const b = new Batch();
  b.box(0, 0.25, 2.15, 2.3, 0.2, 4.3, EXC_YELLOW);
  b.box(-1.1, 0.75, 2.15, 0.12, 1.0, 4.3, EXC_YELLOW);
  b.box(1.1, 0.75, 2.15, 0.12, 1.0, 4.3, EXC_YELLOW);
  b.box(0, 0.9, 4.25, 2.3, 1.3, 0.12, EXC_YELLOW);
  b.box(0, 0.6, 2.0, 1.9, 0.5, 3.6, "#6b4f36"); // spoil
  return b.build();
}

// --- Hoist cage, workers ---------------------------------------------------------------------------

export function hoistCage() {
  const b = new Batch();
  b.box(0, 1.15, 0, 2.4, 2.3, 1.6, ORANGE);
  b.box(0, 1.3, 0.81, 2.0, 1.4, 0.04, GLASS);
  return b.build();
}

/**
 * Worker in hi-vis, ~1.8 m, facing +z. Vertices of the hammer arm carry aFlag = 1 (the shader swings
 * them about the shoulder at WORKER_SHOULDER).
 */
export const WORKER_SHOULDER = [0.27, 1.38, 0] as const;
export function workerGeometry() {
  const b = new Batch();
  const legs = "#2a3550";
  b.box(-0.11, 0.42, 0, 0.17, 0.84, 0.22, legs);
  b.box(0.11, 0.42, 0, 0.17, 0.84, 0.22, legs);
  b.box(0, 1.12, 0, 0.48, 0.6, 0.28, "#d7f20f"); // hi-vis vest
  b.box(0, 1.05, 0, 0.5, 0.07, 0.3, "#d8dde2"); // reflective band
  b.box(0, 1.25, 0, 0.5, 0.06, 0.3, "#d8dde2");
  b.box(-0.29, 1.12, 0.05, 0.11, 0.55, 0.13, "#d7f20f"); // left arm
  b.box(0, 1.58, 0, 0.22, 0.24, 0.22, "#d9a47e"); // head
  b.box(0, 1.73, 0.02, 0.28, 0.1, 0.3, "#ffffff"); // hard hat
  b.flag = 1;
  const [sx, sy] = WORKER_SHOULDER;
  b.box(sx, sy - 0.28, 0, 0.11, 0.56, 0.13, "#d7f20f"); // right arm hangs from the shoulder
  b.box(sx, sy - 0.62, 0.08, 0.05, 0.05, 0.38, "#6b4a2a"); // hammer shaft, forward
  b.box(sx, sy - 0.62, 0.28, 0.1, 0.12, 0.1, "#3a3c40"); // head
  b.flag = 0;
  return b.build(true);
}

// --- Concrete mixer truck, facing +z -----------------------------------------------------------------

export const MIXER = { half: 4.4, drumC: [0, 2.35, -0.8] as const, drumTilt: 0.22 } as const;

export function mixerBody() {
  const b = new Batch();
  const wheel = new THREE.CylinderGeometry(0.55, 0.55, 0.45, 12).rotateZ(Math.PI / 2);
  for (const z of [3.0, -1.5, -2.8]) for (const x of [-1.05, 1.05]) b.place(wheel, x, 0.55, z, "#1b1c1e");
  b.box(0, 0.95, -0.2, 1.3, 0.35, 8.0, DARK); // chassis
  b.box(0, 1.75, 3.35, 2.4, 2.0, 1.7, "#f4f4f0"); // cab
  b.box(0, 2.15, 4.21, 2.1, 0.8, 0.04, GLASS);
  b.box(0, 1.1, 4.22, 2.2, 0.45, 0.06, "#cfcfcf"); // grille
  b.box(0, 2.78, 3.35, 2.4, 0.08, 1.7, ORANGE); // roof stripe
  b.box(1.21, 1.6, 3.35, 0.02, 0.35, 1.5, ORANGE);
  b.box(-1.21, 1.6, 3.35, 0.02, 0.35, 1.5, ORANGE);
  b.box(0, 1.6, 2.3, 2.3, 1.2, 0.3, DARK);
  // drum cradle, water tank, chute
  b.box(0, 1.45, 1.6, 1.6, 0.7, 0.3, STEEL);
  b.box(0, 1.6, -3.2, 1.8, 1.0, 0.3, STEEL);
  b.place(new THREE.CylinderGeometry(0.32, 0.32, 1.2, 8).rotateZ(Math.PI / 2), 0, 2.0, 2.0, "#4a7ab8");
  b.member(0, 3.1, -3.4, 0, 1.6, -4.4, 0.35, STEEL);
  b.box(0, 1.25, -4.1, 2.25, 0.5, 0.25, "#3a3c40"); // rear bumper
  wheel.dispose();
  return b.build();
}

/** Drum along +z (front closed end at +z), with an orange/white spiral so its rotation reads. */
export function mixerDrum() {
  const pts = [
    [0.42, -2.5], [0.62, -2.15], [1.0, -1.4], [1.22, -0.4], [1.22, 0.6], [1.0, 1.7], [0.55, 2.45], [0.15, 2.7],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const lathe = new THREE.LatheGeometry(pts, 14).toNonIndexed();
  lathe.computeVertexNormals();
  const p = lathe.getAttribute("position");
  const cols: number[] = [];
  const o = new THREE.Color(ORANGE);
  const w = new THREE.Color("#f2f2ee");
  // colour per triangle (flat) from its centroid
  for (let i = 0; i < p.count; i += 3) {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let k = 0; k < 3; k++) {
      cx += p.getX(i + k);
      cy += p.getY(i + k);
      cz += p.getZ(i + k);
    }
    const phi = Math.atan2(cz, cx);
    const c = Math.sin(phi * 2 + (cy / 3) * 1.6 * Math.PI) > 0.2 ? o : w;
    for (let k = 0; k < 3; k++) cols.push(c.r, c.g, c.b);
  }
  lathe.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
  lathe.rotateX(Math.PI / 2); // lathe axis y -> z (y = +2.7 end becomes +z front)
  lathe.computeBoundingSphere();
  return lathe;
}
