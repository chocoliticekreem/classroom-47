// Tiny helper that merges many primitives into ONE vertex-coloured BufferGeometry (one draw call).
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

export class GeoBuilder {
  private parts: THREE.BufferGeometry[] = [];

  /** Add a geometry (consumed), transformed by m, painted `color`. */
  add(g: THREE.BufferGeometry, color: THREE.ColorRepresentation, m?: THREE.Matrix4) {
    const ng = g.index ? g.toNonIndexed() : g;
    if (ng !== g) g.dispose();
    for (const k of Object.keys(ng.attributes)) if (k !== "position" && k !== "normal") ng.deleteAttribute(k);
    if (m) ng.applyMatrix4(m);
    if (!ng.getAttribute("normal")) ng.computeVertexNormals();
    _c.set(color);
    const n = ng.getAttribute("position").count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = _c.r;
      col[i * 3 + 1] = _c.g;
      col[i * 3 + 2] = _c.b;
    }
    ng.setAttribute("color", new THREE.BufferAttribute(col, 3));
    this.parts.push(ng);
    return this;
  }

  /** Axis-aligned-in-local box centred at (x,y,z), rotated by yaw about y (and optional pitch about local x). */
  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, color: THREE.ColorRepresentation, yaw = 0, pitch = 0, roll = 0) {
    return this.add(new THREE.BoxGeometry(sx, sy, sz), color, tf(x, y, z, yaw, pitch, roll));
  }

  cyl(x: number, y: number, z: number, rTop: number, rBot: number, h: number, color: THREE.ColorRepresentation, seg = 8, yaw = 0, pitch = 0, roll = 0) {
    return this.add(new THREE.CylinderGeometry(rTop, rBot, h, seg), color, tf(x, y, z, yaw, pitch, roll));
  }

  cone(x: number, y: number, z: number, r: number, h: number, color: THREE.ColorRepresentation, seg = 4, yaw = Math.PI / 4) {
    return this.add(new THREE.ConeGeometry(r, h, seg), color, tf(x, y, z, yaw));
  }

  /** A box stretched between two 3D points (beams, cables, struts). */
  beam(ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number, h: number, color: THREE.ColorRepresentation) {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.hypot(dx, dy, dz) || 0.001;
    const g = new THREE.BoxGeometry(w, h, len);
    const dir = new THREE.Vector3(dx, dy, dz).normalize();
    _q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    _m.compose(_p.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), _q, _s.set(1, 1, 1));
    return this.add(g, color, _m.clone());
  }

  /** A quad from 4 corners (counter-clockwise seen from the front). */
  quad(a: number[], b: number[], c: number[], d: number[], color: THREE.ColorRepresentation) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([...a, ...b, ...c, ...a, ...c, ...d]), 3));
    g.computeVertexNormals();
    return this.add(g, color);
  }

  get size() {
    return this.parts.length;
  }

  build(): THREE.BufferGeometry {
    if (!this.parts.length) return new THREE.BufferGeometry();
    const g = mergeGeometries(this.parts, false)!;
    for (const p of this.parts) p.dispose();
    this.parts = [];
    g.computeBoundingSphere();
    return g;
  }
}

export function tf(x: number, y: number, z: number, yaw = 0, pitch = 0, roll = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(pitch, yaw, roll, "YXZ");
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(_e), new THREE.Vector3(sx, sy, sz));
}

/** Small seeded RNG. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
