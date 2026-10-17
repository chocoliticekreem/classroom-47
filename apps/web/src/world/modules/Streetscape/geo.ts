// Merged, vertex-coloured prop geometries (one draw call per prop kind when instanced).
// Local frame: y up, +z is the prop's "front" (sign face, lamp arm, car nose, ad face).
import {
  BoxGeometry,
  BufferAttribute,
  Color,
  CylinderGeometry,
  IcosahedronGeometry,
  PlaneGeometry,
  type BufferGeometry,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { BILLBOARD } from "./placement";

const tmp = new Color();

export function paint<T extends BufferGeometry>(geo: T, hex: string): T {
  tmp.set(hex);
  const n = geo.getAttribute("position").count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = tmp.r;
    arr[i * 3 + 1] = tmp.g;
    arr[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute("color", new BufferAttribute(arr, 3));
  return geo;
}

/** Merge painted parts (drops uvs so mixed primitives always merge). */
export function merge(parts: BufferGeometry[]): BufferGeometry {
  const ready = parts.map((p) => {
    const g = p.index ? p.toNonIndexed() : p;
    if (g.getAttribute("uv")) g.deleteAttribute("uv");
    return g;
  });
  const out = mergeGeometries(ready, false);
  for (const p of parts) p.dispose();
  for (const p of ready) p.dispose();
  if (!out) throw new Error("Streetscape: geometry merge failed");
  return out;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, hex: string) {
  return paint(new BoxGeometry(w, h, d).translate(x, y, z), hex);
}
function cyl(rt: number, rb: number, h: number, x: number, y: number, z: number, hex: string, seg = 8) {
  return paint(new CylinderGeometry(rt, rb, h, seg).translate(x, y, z), hex);
}
function blob(r: number, x: number, y: number, z: number, hex: string, sy = 1) {
  return paint(new IcosahedronGeometry(r, 0).scale(1, sy, 1).translate(x, y, z), hex);
}

/** London plane: pale mottled trunk, broad lumpy crown. */
export function treeGeometry() {
  return merge([
    cyl(0.2, 0.28, 3.4, 0, 1.7, 0, "#9c9078", 6),
    cyl(0.1, 0.14, 1.6, 0.5, 3.6, 0.2, "#8f8470", 5).rotateZ(-0.35),
    blob(2.4, 0, 5.6, 0, "#5a8f3e", 0.85),
    blob(1.8, 1.3, 5.0, 0.6, "#4f8536", 0.9),
    blob(1.7, -1.2, 5.3, -0.5, "#679b48", 0.9),
    blob(1.5, 0.2, 6.9, -0.3, "#6aa24a", 0.9),
  ]);
}

/** Lamp column at the back of the pavement; the arm reaches +z over the kerb. Head glass is separate. */
export function lampGeometry() {
  return merge([
    cyl(0.16, 0.2, 0.6, 0, 0.3, 0, "#2b3036"),
    cyl(0.07, 0.1, 7.6, 0, 3.8, 0, "#3a4047", 6),
    box(0.08, 0.08, 1.7, 0, 7.55, 0.85, "#3a4047"),
    box(0.5, 0.14, 0.8, 0, 7.5, 1.6, "#2b3036"),
  ]);
}
export function lampGlassGeometry() {
  return paint(new BoxGeometry(0.4, 0.06, 0.66).translate(0, 7.41, 1.6), "#fff1c9");
}

export function binGeometry() {
  return merge([cyl(0.3, 0.27, 0.95, 0, 0.48, 0, "#2d3e2f"), cyl(0.33, 0.33, 0.1, 0, 0.98, 0, "#c9a227")]);
}

export function bollardGeometry() {
  return merge([cyl(0.1, 0.12, 0.95, 0, 0.48, 0, "#1d1f22", 6), cyl(0.105, 0.105, 0.08, 0, 0.82, 0, "#e9e4d6", 6)]);
}

/** Hatchback: white body (tinted per instance), dark glass and wheels. */
export function carGeometry() {
  const parts: BufferGeometry[] = [
    box(1.8, 0.62, 4.1, 0, 0.6, 0, "#ffffff"),
    box(1.62, 0.56, 2.2, 0, 1.18, -0.25, "#26303a"),
    box(1.58, 0.07, 2.0, 0, 1.49, -0.25, "#ffffff"),
    box(1.82, 0.16, 0.2, 0, 0.42, 2.05, "#2b2b2b"),
    box(1.82, 0.16, 0.2, 0, 0.42, -2.05, "#2b2b2b"),
    box(0.3, 0.12, 0.05, -0.6, 0.72, 2.06, "#fff7d6"),
    box(0.3, 0.12, 0.05, 0.6, 0.72, 2.06, "#fff7d6"),
    box(0.3, 0.12, 0.05, -0.6, 0.72, -2.06, "#b3121b"),
    box(0.3, 0.12, 0.05, 0.6, 0.72, -2.06, "#b3121b"),
  ];
  // wheels: axle along x
  for (const sx of [-0.82, 0.82])
    for (const sz of [-1.3, 1.3]) parts.push(paint(new CylinderGeometry(0.32, 0.32, 0.24, 8).rotateZ(Math.PI / 2).translate(sx, 0.32, sz), "#16181b"));
  return merge(parts);
}

/** Sign post with a round grey back plate at 2.25 m; the face is a separate textured plane. */
export function signPostGeometry() {
  return merge([
    cyl(0.045, 0.05, 2.6, 0, 1.3, 0, "#8d949b", 5),
    paint(new CylinderGeometry(0.4, 0.4, 0.03, 14).rotateX(Math.PI / 2).translate(0, 2.25, -0.02), "#7c8288"),
  ]);
}
export function poleGeometry(h: number) {
  return paint(new CylinderGeometry(0.045, 0.05, h, 5).translate(0, h / 2, 0), "#8d949b");
}

/** Textured plane with uv remapped to a sub-rectangle of an atlas (u0, v0, u1, v1 in 0..1, v up). */
export function atlasPlane(w: number, h: number, rect: [number, number, number, number]) {
  const g = new PlaneGeometry(w, h);
  const uv = g.getAttribute("uv");
  const [u0, v0, u1, v1] = rect;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  return g;
}

/** Free-standing neon pylon: pole and a dark box; the glowing faces are separate planes. */
export function neonPylonGeometry() {
  return merge([
    cyl(0.08, 0.1, 4.2, 0, 2.1, 0, "#2a2d33", 6),
    box(2.6, 0.82, 0.24, 0, 4.55, 0, "#15121a"),
  ]);
}

export function shrubGeometry() {
  return merge([blob(1, 0, 0.55, 0, "#ffffff", 0.7), blob(0.7, 0.6, 0.45, 0.3, "#f2f2f2", 0.7)]);
}

/** Roadside billboard: two steel legs, a deep frame, a catwalk. The ad itself is a separate plane at z = +0.22. */
export function billboardGeometry() {
  const { width: w, height: h, legs } = BILLBOARD;
  return merge([
    box(0.45, legs + h * 0.6, 0.45, -w * 0.28, (legs + h * 0.6) / 2, -0.2, "#5d646c"),
    box(0.45, legs + h * 0.6, 0.45, w * 0.28, (legs + h * 0.6) / 2, -0.2, "#5d646c"),
    box(w + 0.4, h + 0.4, 0.4, 0, legs + h / 2, 0, "#e8e6df"),
    box(w + 0.2, h + 0.2, 0.06, 0, legs + h / 2, -0.23, "#9aa1a8"),
    box(w, 0.08, 1.0, 0, legs - 0.05, 0.6, "#4a5058"),
    box(w, 0.4, 0.04, 0, legs + 0.25, 1.08, "#4a5058"),
    box(0.25, 0.25, 0.6, -w * 0.3, legs - 0.2, 1.0, "#2b2f35"),
    box(0.25, 0.25, 0.6, w * 0.3, legs - 0.2, 1.0, "#2b2f35"),
  ]);
}
