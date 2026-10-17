// Low-poly geometry for the airport, all vertex-coloured so each prop family merges into one draw call.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { PlaneSpec } from "./flight";

const tmpColor = new THREE.Color();

export function paint<T extends THREE.BufferGeometry>(geo: T, hex: string): T {
  tmpColor.set(hex);
  const n = geo.getAttribute("position").count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = tmpColor.r;
    arr[i * 3 + 1] = tmpColor.g;
    arr[i * 3 + 2] = tmpColor.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Merge painted parts (indexed or not) into one non-indexed geometry with position/normal/color. */
export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const ready = parts.map((p) => {
    const g = p.index ? p.toNonIndexed() : p;
    for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal" && k !== "color") g.deleteAttribute(k);
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    return g;
  });
  const out = mergeGeometries(ready, false);
  for (const p of parts) p.dispose();
  if (!out) throw new Error("Airport: geometry merge failed");
  return out;
}

/** Axis-aligned box from its centre and size, painted. */
export function box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, hex: string, yaw = 0) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  if (yaw) g.rotateY(yaw);
  g.translate(cx, cy, cz);
  return paint(g, hex);
}

export function cyl(cx: number, cy: number, cz: number, r: number, h: number, hex: string, seg = 10, rTop = r) {
  const g = new THREE.CylinderGeometry(rTop, r, h, seg);
  g.translate(cx, cy, cz);
  return paint(g, hex);
}

/** Flat horizontal quad (x/z extents) at height y. */
export function quad(minX: number, maxX: number, minZ: number, maxZ: number, y: number, hex: string, yaw = 0) {
  const g = new THREE.PlaneGeometry(maxX - minX, maxZ - minZ);
  g.rotateX(-Math.PI / 2);
  if (yaw) g.rotateY(yaw);
  g.translate((minX + maxX) / 2, y, (minZ + maxZ) / 2);
  return paint(g, hex);
}

/** Thin strip on the ground between two points. */
export function strip(x0: number, z0: number, x1: number, z1: number, w: number, y: number, hex: string) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const g = new THREE.PlaneGeometry(w, len);
  g.rotateX(-Math.PI / 2);
  g.rotateY(Math.atan2(x1 - x0, z1 - z0));
  g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
  return paint(g, hex);
}

/** Box spanning two points (used for jet bridges and pipes). */
export function beam(a: THREE.Vector3, b: THREE.Vector3, w: number, h: number, hex: string) {
  const len = a.distanceTo(b);
  const g = new THREE.BoxGeometry(w, h, len);
  const m = new THREE.Matrix4().lookAt(a, b, new THREE.Vector3(0, 1, 0));
  g.applyMatrix4(m);
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return paint(g, hex);
}

// --- Airliner (faces +z, wheels at y = 0, ~22 m long, 21 m span) ---------------------

const FUS_R = 1.55;
const FUS_Y = 2.6;

function sweep(g: THREE.BufferGeometry, axis: "x" | "y", from: number, k: number, sign = 1) {
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const a = axis === "x" ? Math.abs(p.getX(i)) : p.getY(i);
    p.setZ(i, p.getZ(i) - Math.max(0, a - from) * k * sign);
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

function wing(side: 1 | -1, hex: string, tipHex: string): THREE.BufferGeometry[] {
  const span = 9.2;
  const g = new THREE.BoxGeometry(span, 0.32, 4.4);
  g.translate(side * (span / 2 + 1.1), 1.85, 1.2);
  sweep(g, "x", 1.1, 0.42);
  // taper: pull the trailing edge forward toward the tip
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const t = Math.min(1, Math.max(0, (Math.abs(p.getX(i)) - 1.1) / span));
    const z = p.getZ(i);
    const mid = 1.2 - (Math.abs(p.getX(i)) - 1.1) * 0.42;
    p.setZ(i, mid + (z - mid) * (1 - 0.55 * t));
  }
  g.computeVertexNormals();
  const tipX = side * (span + 1.1);
  const tipZ = 1.2 - span * 0.42;
  const winglet = new THREE.BoxGeometry(0.18, 1.3, 1.2);
  winglet.translate(tipX, 2.4, tipZ - 0.3);
  const eng = new THREE.CylinderGeometry(0.72, 0.62, 3.1, 10);
  eng.rotateX(Math.PI / 2);
  eng.translate(side * 5.0, 1.1, 2.6);
  const intake = new THREE.CylinderGeometry(0.6, 0.6, 0.08, 10);
  intake.rotateX(Math.PI / 2);
  intake.translate(side * 5.0, 1.1, 4.17);
  const pylon = new THREE.BoxGeometry(0.22, 0.6, 1.8);
  pylon.translate(side * 5.0, 1.6, 2.2);
  return [paint(g, hex), paint(winglet, tipHex), paint(eng, "#c3c9d1"), paint(intake, "#2a2f36"), paint(pylon, "#c3c9d1")];
}

export interface PlaneParts {
  front: THREE.BufferGeometry[];
  rear: THREE.BufferGeometry[];
  wingL: THREE.BufferGeometry[]; // left = +x
  wingR: THREE.BufferGeometry[];
  gear: THREE.BufferGeometry[];
}

export function planeParts(spec: PlaneSpec): PlaneParts {
  const body = spec.body;
  const tail = spec.tail;
  const accent = spec.cargo ? "#ffffff" : tail;
  const wingHex = "#d9dee4";

  const front: THREE.BufferGeometry[] = [];
  const fFus = new THREE.CylinderGeometry(FUS_R, FUS_R, 8.6, 12);
  fFus.rotateX(Math.PI / 2);
  fFus.translate(0, FUS_Y, 4.3);
  const nose = new THREE.SphereGeometry(FUS_R, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  nose.rotateX(Math.PI / 2);
  nose.scale(1, 0.92, 1.9);
  nose.translate(0, FUS_Y - 0.1, 8.6);
  const cockpit = new THREE.BoxGeometry(2.0, 0.42, 1.0);
  cockpit.rotateX(-0.45);
  cockpit.translate(0, FUS_Y + 0.75, 9.6);
  front.push(paint(fFus, body), paint(nose, body), paint(cockpit, "#1b2633"));

  const rear: THREE.BufferGeometry[] = [];
  const rFus = new THREE.CylinderGeometry(FUS_R, FUS_R, 8.4, 12);
  rFus.rotateX(Math.PI / 2);
  rFus.translate(0, FUS_Y, -4.2);
  const tailCone = new THREE.CylinderGeometry(FUS_R, 0.35, 5.2, 12);
  tailCone.rotateX(-Math.PI / 2);
  tailCone.translate(0, FUS_Y + 0.55, -11);
  // upsweep the tail cone's underside
  const tp = tailCone.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < tp.count; i++) {
    const k = Math.max(0, (-tp.getZ(i) - 8.4) / 5.2);
    if (tp.getY(i) < FUS_Y + 0.55) tp.setY(i, tp.getY(i) + k * 0.9);
  }
  tailCone.computeVertexNormals();
  const fin = new THREE.BoxGeometry(0.26, 4.4, 3.4);
  fin.translate(0, FUS_Y + 1.4 + 2.2, -11.4);
  sweep(fin, "y", FUS_Y + 1.4, 0.62);
  rear.push(paint(rFus, body), paint(tailCone, body), paint(fin, tail));
  for (const s of [1, -1]) {
    const stab = new THREE.BoxGeometry(3.6, 0.2, 2.0);
    stab.translate(s * 2.4, FUS_Y + 0.75, -11.6);
    sweep(stab, "x", 0.6, 0.5);
    rear.push(paint(stab, wingHex));
  }

  // livery: window strip (passenger) or a cargo door + band; belly cheatline in the accent colour
  for (const s of [1, -1]) {
    if (!spec.cargo) {
      const win = new THREE.BoxGeometry(0.06, 0.3, 7.4);
      win.translate(s * (FUS_R - 0.01), FUS_Y + 0.35, 4.0);
      front.push(paint(win, "#22324a"));
      const win2 = win.clone();
      win2.translate(0, 0, -8.6);
      rear.push(paint(win2, "#22324a"));
    }
    const line = new THREE.BoxGeometry(0.06, 0.22, 8.4);
    line.translate(s * (FUS_R - 0.02), FUS_Y - 0.45, 4.2);
    front.push(paint(line, accent));
    const line2 = line.clone();
    line2.translate(0, 0, -8.4);
    rear.push(paint(line2, accent));
  }
  if (spec.cargo) {
    const door = new THREE.BoxGeometry(0.07, 1.4, 2.6);
    door.translate(FUS_R - 0.02, FUS_Y + 0.2, 5.6);
    front.push(paint(door, "#e25a12"));
  }

  const gear: THREE.BufferGeometry[] = [];
  const legs: [number, number][] = [
    [0, 7.6],
    [2.1, -0.4],
    [-2.1, -0.4],
  ];
  for (const [x, z] of legs) {
    gear.push(cyl(x, 0.9, z, 0.1, 1.2, "#8a9099", 6));
    const wheel = new THREE.CylinderGeometry(0.42, 0.42, x === 0 ? 0.35 : 0.7, 10);
    wheel.rotateZ(Math.PI / 2);
    wheel.translate(x, 0.42, z);
    gear.push(paint(wheel, "#1d1f22"));
  }

  return { front, rear, wingL: wing(1, wingHex, accent), wingR: wing(-1, wingHex, accent), gear };
}

export function planeGeometry(spec: PlaneSpec) {
  const p = planeParts(spec);
  return merge([...p.front, ...p.rear, ...p.wingL, ...p.wingR, ...p.gear]);
}

/** Broken airframe: nose section, tail section, one detached wing. */
export function wreckGeometries(spec: PlaneSpec) {
  const p = planeParts(spec);
  for (const g of p.gear) g.dispose();
  return { front: merge(p.front), rear: merge([...p.rear, ...p.wingR]), wing: merge(p.wingL) };
}

/** Plane-local light positions: navL (red, +x tip), navR (green), tail, beacon, strobeL, strobeR, landing L/R. */
export const PLANE_LIGHTS: readonly { x: number; y: number; z: number; color: string; size: number }[] = [
  { x: 10.3, y: 1.9, z: -2.9, color: "#ff2a2a", size: 0.55 },
  { x: -10.3, y: 1.9, z: -2.9, color: "#2aff6a", size: 0.55 },
  { x: 0, y: 3.4, z: -13.4, color: "#ffffff", size: 0.5 },
  { x: 0, y: 4.25, z: 0, color: "#ff3b2a", size: 0.5 },
  { x: 10.3, y: 2.0, z: -3.4, color: "#ffffff", size: 0.75 },
  { x: -10.3, y: 2.0, z: -3.4, color: "#ffffff", size: 0.75 },
  { x: 2.0, y: 1.7, z: 1.9, color: "#fff6d8", size: 0.8 },
  { x: -2.0, y: 1.7, z: 1.9, color: "#fff6d8", size: 0.8 },
];

// --- Vehicles (face +z, wheels at y = 0) ---------------------------------------------------

function wheels(xs: number, zs: number[], r: number, w: number) {
  const out: THREE.BufferGeometry[] = [];
  for (const z of zs)
    for (const s of [1, -1]) {
      const g = new THREE.CylinderGeometry(r, r, w, 10);
      g.rotateZ(Math.PI / 2);
      g.translate(s * xs, r, z);
      out.push(paint(g, "#1b1c1f"));
    }
  return out;
}

function nozzle() {
  const n = new THREE.CylinderGeometry(0.13, 0.16, 1.7, 6);
  n.rotateX(Math.PI / 2 - 0.45);
  n.translate(0, 3.55, 4.3);
  return paint(n, "#e8e8e8");
}

/** Airport crash tender (big 6-wheeler with a roof foam monitor). */
export function tenderGeometry() {
  return merge([
    box(0, 1.9, -0.6, 3.0, 2.6, 7.6, "#d92b1f"),
    box(0, 1.6, 3.9, 3.0, 2.0, 2.2, "#d92b1f"),
    box(0, 2.15, 4.95, 2.7, 0.9, 0.1, "#1b2633"), // windscreen
    box(1.51, 1.55, -0.6, 0.04, 0.35, 7.6, "#ffd21a"),
    box(-1.51, 1.55, -0.6, 0.04, 0.35, 7.6, "#ffd21a"),
    box(0, 3.25, -0.6, 2.6, 0.1, 7.2, "#c7ccd2"),
    box(0, 3.0, 3.6, 0.9, 0.5, 0.9, "#30343a"), // monitor base
    nozzle(),
    ...wheels(1.45, [3.6, -1.2, -3.2], 0.62, 0.5),
  ]);
}

export function ambulanceGeometry() {
  return merge([
    box(0, 1.55, -0.5, 2.3, 2.4, 4.6, "#f7f7f2"),
    box(0, 1.15, 2.5, 2.2, 1.6, 1.5, "#f7f7f2"),
    box(0, 1.6, 3.27, 2.0, 0.6, 0.05, "#1b2633"),
    // battenburg band
    box(1.16, 1.05, -0.5, 0.04, 0.5, 4.6, "#c8e000"),
    box(-1.16, 1.05, -0.5, 0.04, 0.5, 4.6, "#c8e000"),
    box(1.17, 1.05, 0.4, 0.04, 0.5, 0.9, "#1e5bd6"),
    box(-1.17, 1.05, -1.4, 0.04, 0.5, 0.9, "#1e5bd6"),
    box(0, 2.78, -0.5, 1.6, 0.06, 0.4, "#e01b24"),
    ...wheels(1.08, [2.2, -1.8], 0.42, 0.35),
  ]);
}

export function tugGeometry() {
  return merge([
    box(0, 0.65, 0, 2.3, 0.9, 4.2, "#f4c20d"),
    box(0, 1.45, -0.9, 1.6, 0.8, 1.4, "#2c3138"),
    box(0, 0.5, 2.2, 0.6, 0.3, 0.5, "#30343a"),
    ...wheels(1.1, [1.3, -1.3], 0.38, 0.4),
  ]);
}

/** Little evacuee: a body and a head (white so instance colours tint it). */
export function personGeometry() {
  const body = new THREE.CylinderGeometry(0.2, 0.26, 0.95, 6);
  body.translate(0, 0.48, 0);
  const head = new THREE.SphereGeometry(0.17, 6, 4);
  head.translate(0, 1.13, 0);
  return merge([paint(body, "#ffffff"), paint(head, "#ffffff")]);
}

/** Inflated evacuation slide, from the door sill (origin) out along +x and down to the ground. */
export function slideGeometry(drop: number, run: number) {
  const len = Math.hypot(drop, run);
  const g = new THREE.BoxGeometry(len, 0.3, 1.5);
  g.translate(len / 2, 0, 0);
  g.rotateZ(-Math.atan2(drop, run));
  const rail = new THREE.BoxGeometry(len, 0.45, 0.25);
  rail.translate(len / 2, 0.15, 0.7);
  rail.rotateZ(-Math.atan2(drop, run));
  const rail2 = rail.clone();
  rail2.translate(0, 0, -1.4);
  return merge([paint(g, "#ffcc1a"), paint(rail, "#f59e0b"), paint(rail2, "#f59e0b")]);
}
