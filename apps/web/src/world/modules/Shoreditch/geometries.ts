// Shoreditch geometries: unit primitives (base at y = 0) and vertex-coloured props built in metres.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { PoolName } from "./layout";

const tmp = new THREE.Color();

function paint<T extends THREE.BufferGeometry>(g: T, hex: string): T {
  tmp.set(hex);
  const n = g.getAttribute("position").count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = tmp.r;
    arr[i * 3 + 1] = tmp.g;
    arr[i * 3 + 2] = tmp.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return g;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map((p) => {
    const q = p.index ? p.toNonIndexed() : p;
    // keep only the attributes every part has
    for (const k of Object.keys(q.attributes)) if (!["position", "normal", "color", "uv"].includes(k)) q.deleteAttribute(k);
    if (!q.getAttribute("uv")) q.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(q.getAttribute("position").count * 2), 2));
    return q;
  });
  const out = mergeGeometries(flat, false);
  for (const p of parts) p.dispose();
  for (const p of flat) p.dispose();
  if (!out) throw new Error("Shoreditch: geometry merge failed");
  return out;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, hex: string, rx = 0, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return paint(g, hex);
}

function cyl(rt: number, rb: number, h: number, x: number, y: number, z: number, hex: string, seg = 8) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  g.translate(x, y, z);
  return paint(g, hex);
}

export function prismGeometry() {
  // Triangular prism, ridge along x, base at y = 0, unit size.
  const A = [-0.5, 0, -0.5], B = [-0.5, 0, 0.5], C = [-0.5, 1, 0];
  const A2 = [0.5, 0, -0.5], B2 = [0.5, 0, 0.5], C2 = [0.5, 1, 0];
  const tris = [A, B, C, A2, C2, B2, B, B2, C2, B, C2, C, A, C, C2, A, C2, A2, A, A2, B2, A, B2, B];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(tris.flat(), 3));
  g.computeVertexNormals();
  return g;
}

/** Railway viaduct bay: 8 m long (x), 7.6 m tall, 9 m wide (z), with a round arch through it. */
export function archGeometry() {
  const s = new THREE.Shape();
  s.moveTo(-4, 0);
  s.lineTo(-3, 0);
  s.lineTo(-3, 3.4);
  s.absarc(0, 3.4, 3, Math.PI, 0, true);
  s.lineTo(3, 0);
  s.lineTo(4, 0);
  s.lineTo(4, 7.6);
  s.lineTo(-4, 7.6);
  s.lineTo(-4, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: 9, bevelEnabled: false, curveSegments: 10 });
  g.translate(0, 0, -4.5);
  g.computeVertexNormals();
  return g;
}

function treeGeometry() {
  return merge([
    cyl(0.14, 0.2, 2.4, 0, 1.2, 0, "#6b4a2b", 6),
    paint(new THREE.IcosahedronGeometry(1.5, 0).translate(0, 3.4, 0), "#4f8a3c"),
    paint(new THREE.IcosahedronGeometry(1.05, 0).translate(0.5, 4.5, 0.3), "#5f9e47"),
  ]);
}

function lampGeometry() {
  return merge([
    cyl(0.07, 0.1, 6, 0, 3, 0, "#ffffff", 6),
    box(0.1, 0.1, 1.2, 0, 5.85, 0.55, "#ffffff"),
  ]);
}

function craneGeometry() {
  // Iron wall crane: wall post, jib projecting along +z, diagonal brace, rope and hook. y = 0 at the jib.
  const brace = new THREE.BoxGeometry(0.16, 2.9, 0.16);
  brace.rotateX(-Math.atan2(2.0, 2.2));
  brace.translate(0, -1.0, 1.05);
  return merge([
    box(0.3, 3.2, 0.3, 0, -1.3, 0.15, "#ffffff"),
    box(0.22, 0.28, 2.7, 0, 0.15, 1.35, "#ffffff"),
    paint(brace, "#ffffff"),
    box(0.04, 1.8, 0.04, 0, -0.75, 2.55, "#ffffff"),
    box(0.3, 0.3, 0.3, 0, -1.75, 2.55, "#ffffff"),
    cyl(0.2, 0.2, 0.12, 0, 0.35, 2.55, "#ffffff"),
  ]);
}

function carGeometry() {
  return merge([
    box(1.8, 0.7, 4.2, 0, 0.6, 0, "#ffffff"),
    box(1.6, 0.6, 2.2, 0, 1.25, -0.2, "#2a3640"),
    box(0.4, 0.5, 0.7, 0.75, 0.3, 1.3, "#1a1a1a"),
    box(0.4, 0.5, 0.7, -0.75, 0.3, 1.3, "#1a1a1a"),
    box(0.4, 0.5, 0.7, 0.75, 0.3, -1.3, "#1a1a1a"),
    box(0.4, 0.5, 0.7, -0.75, 0.3, -1.3, "#1a1a1a"),
    box(1.5, 0.15, 0.05, 0, 0.75, 2.11, "#fff6d0"),
  ]);
}

function sailboatGeometry() {
  // Hull along +z (bow), waterline at y = 0.
  const bow = new THREE.BoxGeometry(2.0, 1.1, 2.0);
  bow.rotateY(Math.PI / 4);
  bow.scale(1, 1, 1.4);
  bow.translate(0, 0.25, 3.6);
  const sail = new THREE.BufferGeometry();
  sail.setAttribute("position", new THREE.Float32BufferAttribute([0, 2.4, 3.0, 0, 11.5, 0.2, 0, 2.4, 0.2], 3));
  sail.computeVertexNormals();
  return merge([
    box(2.6, 1.1, 7, 0, 0.25, -0.6, "#ffffff"),
    paint(bow, "#ffffff"),
    box(2.64, 0.18, 7.02, 0, 0.55, -0.6, "#1d3557"),
    box(1.8, 0.7, 2.6, 0, 1.15, -0.8, "#f1f1f1"),
    box(1.82, 0.25, 2.62, 0, 1.2, -0.8, "#22303a"),
    cyl(0.07, 0.09, 11, 0, 6.2, 0.2, "#c7ccd1", 5),
    box(0.12, 0.12, 4.0, 0, 2.3, -1.8, "#c7ccd1"),
    box(0.35, 0.35, 3.8, 0, 2.55, -1.8, "#2563a6"), // furled mainsail cover
    paint(sail, "#f6f6f2"), // jib
  ]);
}

function motorboatGeometry() {
  const bow = new THREE.BoxGeometry(2.4, 1.3, 2.4);
  bow.rotateY(Math.PI / 4);
  bow.scale(1, 1, 1.5);
  bow.translate(0, 0.35, 4.2);
  return merge([
    box(3.2, 1.3, 8, 0, 0.35, -0.6, "#ffffff"),
    paint(bow, "#ffffff"),
    box(3.24, 0.22, 8.02, 0, 0.2, -0.6, "#22303a"),
    box(2.6, 1.0, 4.6, 0, 1.5, -1.0, "#f4f4f4"),
    box(2.64, 0.4, 4.0, 0, 1.6, -0.8, "#1b2733"),
    box(2.0, 0.6, 2.2, 0, 2.3, -1.6, "#f4f4f4"),
    box(1.6, 0.06, 2.6, 0, 2.95, -1.6, "#2a9d8f"),
    cyl(0.05, 0.05, 1.4, 0, 3.4, -2.2, "#c7ccd1", 5),
  ]);
}

export function personBodyGeometry() {
  return merge([
    box(0.16, 0.82, 0.2, -0.1, 0.41, 0, "#3a3a44"),
    box(0.16, 0.82, 0.2, 0.1, 0.41, 0, "#3a3a44"),
    box(0.46, 0.62, 0.26, 0, 1.12, 0, "#ffffff"),
  ]);
}

export function personHeadGeometry() {
  const g = new THREE.BoxGeometry(0.24, 0.26, 0.24);
  g.translate(0, 1.58, 0);
  return g;
}

/** One overground carriage, 16 m long along z, floor at y = 0 (on the rails). */
export function trainCarGeometry() {
  const parts = [
    box(2.8, 3.0, 16, 0, 1.9, 0, "#f4f4f4"),
    box(2.84, 0.45, 16.02, 0, 0.75, 0, "#ff6a1a"),
    box(2.84, 0.9, 15.2, 0, 2.3, 0, "#1d2733"),
    box(2.4, 0.3, 15.4, 0, 3.5, 0, "#9aa1a8"),
    box(2.2, 0.6, 2.4, 0, 0.3, -5.5, "#222"),
    box(2.2, 0.6, 2.4, 0, 0.3, 5.5, "#222"),
    box(2.0, 2.0, 0.06, 0, 2.0, 8.02, "#ff6a1a"),
    box(2.0, 2.0, 0.06, 0, 2.0, -8.02, "#ff6a1a"),
  ];
  return merge(parts);
}

/** The Silicon Roundabout sculpture: a spire of twisted rings with an `aH` (0..1 height) attribute. */
export function sculptureGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const N = 14;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const r = 4.2 * (1 - t) + 0.9;
    const g = new THREE.TorusGeometry(r, 0.22, 6, 28);
    g.rotateX(Math.PI / 2 + 0.5 * Math.sin(i * 0.9));
    g.rotateY(i * 0.45);
    g.translate(0, 1.8 + t * 19, 0);
    parts.push(g);
  }
  const mast = new THREE.CylinderGeometry(0.16, 0.45, 23, 8);
  mast.translate(0, 11.5, 0);
  parts.push(mast);
  const top = new THREE.OctahedronGeometry(1.1, 0);
  top.translate(0, 23.5, 0);
  parts.push(top);
  const flat = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  for (const p of flat) for (const k of Object.keys(p.attributes)) if (!["position", "normal"].includes(k)) p.deleteAttribute(k);
  const out = mergeGeometries(flat, false)!;
  for (const p of parts) p.dispose();
  const pos = out.getAttribute("position");
  const h = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) h[i] = pos.getY(i) / 24;
  out.setAttribute("aH", new THREE.BufferAttribute(h, 1));
  return out;
}

export function makePoolGeometries(): Record<PoolName, THREE.BufferGeometry> {
  const unitBox = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const cylG = new THREE.CylinderGeometry(0.5, 0.5, 1, 10).translate(0, 0.5, 0);
  const coneG = new THREE.ConeGeometry(0.5, 1, 10).translate(0, 0.5, 0);
  const rock = new THREE.DodecahedronGeometry(0.5, 0).translate(0, 0.5, 0);
  const bulb = new THREE.IcosahedronGeometry(0.5, 0);
  return {
    box: unitBox,
    prism: prismGeometry(),
    cyl: cylG,
    cone: coneG,
    rock,
    tree: treeGeometry(),
    lamp: lampGeometry(),
    lampHead: unitBox,
    crane: craneGeometry(),
    car: carGeometry(),
    bulb,
    glow: bulb,
    sailboat: sailboatGeometry(),
    motorboat: motorboatGeometry(),
    arch: archGeometry(),
  };
}
