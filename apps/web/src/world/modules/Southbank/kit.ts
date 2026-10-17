// Small three.js helpers: instanced meshes from layout lists, and the unit geometries everything shares.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Prop, RBox } from "./layout";

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();

export class Bag {
  objects: THREE.Object3D[] = [];
  private disposables: { dispose: () => void }[] = [];
  keep<T extends { dispose: () => void }>(x: T): T {
    this.disposables.push(x);
    return x;
  }
  add<T extends THREE.Object3D>(o: T): T {
    this.objects.push(o);
    return o;
  }
  dispose() {
    for (const o of this.objects) if (o instanceof THREE.InstancedMesh) o.dispose();
    for (const d of this.disposables) d.dispose();
  }
}

export interface InstOpts {
  cast?: boolean;
  receive?: boolean;
}

/** One InstancedMesh; `fill(i)` sets _p/_q/_s via the setter and returns the colour (or null for no colour). */
export function instanced(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  n: number,
  fill: (i: number, set: (x: number, y: number, z: number, sx: number, sy: number, sz: number, ry: number, rx?: number) => void) => string | null,
  opts: InstOpts = {},
) {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
  mesh.count = n;
  const set = (x: number, y: number, z: number, sx: number, sy: number, sz: number, ry: number, rx = 0) => {
    _p.set(x, y, z);
    _q.setFromEuler(_e.set(rx, ry, 0, "YXZ"));
    _s.set(sx, sy, sz);
  };
  for (let i = 0; i < n; i++) {
    const color = fill(i, set);
    mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
    if (color) mesh.setColorAt(i, _c.set(color));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = !!opts.cast;
  mesh.receiveShadow = opts.receive ?? true;
  mesh.computeBoundingSphere();
  return mesh;
}

/** Instanced rotated boxes (unit geometry base-anchored). */
export function boxes(geo: THREE.BufferGeometry, mat: THREE.Material, list: RBox[], opts: InstOpts = {}) {
  return instanced(geo, mat, list.length, (i, set) => {
    const b = list[i];
    set(b.x, b.y, b.z, b.w, b.h, b.d, b.ry);
    return b.color;
  }, opts);
}

/** Instanced props (uniform scale s, rotation ry). */
export function props(geo: THREE.BufferGeometry, mat: THREE.Material, list: Prop[], colored = true, y = 0, opts: InstOpts = {}) {
  return instanced(geo, mat, list.length, (i, set) => {
    const p = list[i];
    set(p.x, y, p.z, p.s, p.s, p.s, p.ry);
    return colored ? p.color : "#ffffff";
  }, opts);
}

export function unitBox() {
  return new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
}

/** Unit pitched-roof prism: base y 0..ridge y 1, ridge along x, footprint 1 x 1. */
export function prismGeometry() {
  const A = [-0.5, 0, -0.5], B = [0.5, 0, -0.5], C = [0.5, 0, 0.5], D = [-0.5, 0, 0.5];
  const R1 = [-0.5, 1, 0], R2 = [0.5, 1, 0];
  const tris = [A, R1, R2, A, R2, B, D, C, R2, D, R2, R1, A, D, R1, B, R2, C];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(tris.flat(), 3));
  g.computeVertexNormals();
  return g;
}

/** Paints every vertex of `g` one colour (for merged multi-colour props). */
export function paint(g: THREE.BufferGeometry, color: string) {
  const geo = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  geo.deleteAttribute("uv");
  return geo;
}

export function merge(parts: THREE.BufferGeometry[]) {
  const g = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  return g;
}
