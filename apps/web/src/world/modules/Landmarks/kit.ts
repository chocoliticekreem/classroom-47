// Kit: collect many small primitives (each with a flat colour) and bake them into ONE
// vertex-coloured BufferGeometry, so a whole landmark costs one draw call per material.
import {
  BoxGeometry,
  BufferAttribute,
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  ExtrudeGeometry,
  Matrix4,
  Quaternion,
  RingGeometry,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type V3 = readonly [number, number, number];

const _m = new Matrix4();
const _f = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();
const _c = new Color();
const _up = new Vector3(0, 1, 0);
const _d = new Vector3();

export class Kit {
  private parts: BufferGeometry[] = [];
  private frame = new Matrix4();

  /** Run fn with a local frame (translate, then rotate about Y) stacked on the current one. */
  at(x: number, y: number, z: number, ry: number, fn: () => void) {
    const saved = this.frame.clone();
    _f.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(0, ry, 0)), _s.set(1, 1, 1));
    this.frame.multiply(_f);
    fn();
    this.frame.copy(saved);
  }

  addQ(geo: BufferGeometry, color: string, pos: V3, q: Quaternion, scale: V3 = [1, 1, 1]) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    if (g.getAttribute("uv")) g.deleteAttribute("uv");
    _m.compose(_p.set(pos[0], pos[1], pos[2]), q, _s.set(scale[0], scale[1], scale[2]));
    _m.premultiply(this.frame);
    g.applyMatrix4(_m);
    const n = g.getAttribute("position").count;
    const arr = new Float32Array(n * 3);
    _c.set(color);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = _c.r;
      arr[i * 3 + 1] = _c.g;
      arr[i * 3 + 2] = _c.b;
    }
    g.setAttribute("color", new BufferAttribute(arr, 3));
    this.parts.push(g);
  }

  add(geo: BufferGeometry, color: string, pos: V3, rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]) {
    _q.setFromEuler(_e.set(rot[0], rot[1], rot[2]));
    this.addQ(geo, color, pos, _q, scale);
  }

  /** Axis-aligned box by extents (in the current frame). */
  slab(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: string) {
    this.add(new BoxGeometry(x1 - x0, y1 - y0, z1 - z0), color, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]);
  }

  /** Box by centre and size, optional Y rotation. */
  box(w: number, h: number, d: number, x: number, y: number, z: number, color: string, ry = 0) {
    this.add(new BoxGeometry(w, h, d), color, [x, y, z], [0, ry, 0]);
  }

  cyl(rt: number, rb: number, h: number, seg: number, pos: V3, color: string, rot: V3 = [0, 0, 0], scale?: V3) {
    this.add(new CylinderGeometry(rt, rb, h, seg), color, pos, rot, scale);
  }

  /** Square frustum aligned to the axes (CylinderGeometry with 4 segments turned 45 deg). rt/rb are half-widths. */
  frustum(rt: number, rb: number, h: number, pos: V3, color: string, scale?: V3) {
    const k = Math.SQRT2;
    this.add(new CylinderGeometry(rt * k, rb * k, h, 4, 1, false, Math.PI / 4), color, pos, [0, 0, 0], scale);
  }

  cone(r: number, h: number, seg: number, pos: V3, color: string, rot: V3 = [0, 0, 0]) {
    this.add(new ConeGeometry(r, h, seg), color, pos, rot);
  }

  sphere(r: number, ws: number, hs: number, pos: V3, color: string, scale?: V3) {
    this.add(new SphereGeometry(r, ws, hs), color, pos, [0, 0, 0], scale);
  }

  dome(r: number, ws: number, hs: number, pos: V3, color: string, scale?: V3) {
    this.add(new SphereGeometry(r, ws, hs, 0, Math.PI * 2, 0, Math.PI / 2), color, pos, [0, 0, 0], scale);
  }

  torus(r: number, tube: number, rs: number, ts: number, pos: V3, color: string, rot: V3 = [0, 0, 0]) {
    this.add(new TorusGeometry(r, tube, rs, ts), color, pos, rot);
  }

  /** Flat ring lying on the ground plane at height y. */
  ring(inner: number, outer: number, seg: number, x: number, y: number, z: number, color: string) {
    this.add(new RingGeometry(inner, outer, seg), color, [x, y, z], [-Math.PI / 2, 0, 0]);
  }

  /** Gable-roof prism: triangle (half base, height) extruded along X for `len`. */
  prism(half: number, h: number, len: number, pos: V3, color: string, ry = 0) {
    const s = new Shape();
    s.moveTo(-half, 0);
    s.lineTo(half, 0);
    s.lineTo(0, h);
    s.closePath();
    const g = new ExtrudeGeometry(s, { depth: len, bevelEnabled: false });
    g.translate(0, 0, -len / 2);
    this.add(g, color, pos, [0, Math.PI / 2 + ry, 0]);
  }

  /** Round beam from a to b. */
  beam(a: V3, b: V3, r: number, color: string, seg = 6) {
    _d.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = _d.length();
    const q = new Quaternion().setFromUnitVectors(_up, _d.normalize());
    this.addQ(new CylinderGeometry(r, r, len, seg), color, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], q);
  }

  build(): BufferGeometry | null {
    if (!this.parts.length) return null;
    const merged = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    merged?.computeBoundingSphere();
    return merged;
  }
}

/** Run fn inside the same local frame on several kits at once. */
export function atAll(kits: Kit[], x: number, y: number, z: number, ry: number, fn: () => void) {
  if (!kits.length) return fn();
  kits[0].at(x, y, z, ry, () => atAll(kits.slice(1), x, y, z, ry, fn));
}

/** The three kits every landmark bakes: solid (lit), glow (self-lit) and glass (lit windows at night). */
export interface Kits {
  solid: Kit;
  glow: Kit;
  glass: Kit;
}
export const newKits = (): Kits => ({ solid: new Kit(), glow: new Kit(), glass: new Kit() });
export const allKits = (k: Kits) => [k.solid, k.glow, k.glass];
