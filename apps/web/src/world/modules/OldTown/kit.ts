// Low-poly part templates and a merger that bakes many parts into one vertex-coloured geometry
// (one draw call per material). Optional per-vertex scalar `aLit` drives window glow at night.
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  Float32BufferAttribute,
  IcosahedronGeometry,
  Matrix3,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three";

export interface Template {
  pos: Float32Array;
  nor: Float32Array;
}

export function template(geo: BufferGeometry): Template {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeVertexNormals();
  const t = {
    pos: (g.getAttribute("position").array as Float32Array).slice(),
    nor: (g.getAttribute("normal").array as Float32Array).slice(),
  };
  if (g !== geo) g.dispose();
  geo.dispose();
  return t;
}

function fromTris(tris: number[]): Template {
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(tris, 3));
  return template(g);
}

/** Gable roof: unit footprint (x, z in -0.5..0.5), ridge along x at y = 1. */
function prism(): Template {
  const a = [-0.5, 0, 0.5], b = [0.5, 0, 0.5], c = [0.5, 0, -0.5], d = [-0.5, 0, -0.5];
  const e = [-0.5, 1, 0], f = [0.5, 1, 0];
  return fromTris([
    ...a, ...b, ...f, ...a, ...f, ...e, // front slope
    ...c, ...d, ...e, ...c, ...e, ...f, // back slope
    ...d, ...a, ...e, // west gable
    ...b, ...c, ...f, // east gable
  ]);
}

/** Hipped roof: ridge shortened to x in -0.25..0.25. */
function hip(): Template {
  const a = [-0.5, 0, 0.5], b = [0.5, 0, 0.5], c = [0.5, 0, -0.5], d = [-0.5, 0, -0.5];
  const e = [-0.25, 1, 0], f = [0.25, 1, 0];
  return fromTris([
    ...a, ...b, ...f, ...a, ...f, ...e,
    ...c, ...d, ...e, ...c, ...e, ...f,
    ...d, ...a, ...e,
    ...b, ...c, ...f,
  ]);
}

/** Mansard: steep lower slopes to a flat top inset to z in -0.28..0.28, vertical ends. */
function mansard(): Template {
  const a = [-0.5, 0, 0.5], b = [0.5, 0, 0.5], c = [0.5, 0, -0.5], d = [-0.5, 0, -0.5];
  const e = [-0.5, 1, 0.28], f = [0.5, 1, 0.28], g = [0.5, 1, -0.28], h = [-0.5, 1, -0.28];
  return fromTris([
    ...a, ...b, ...f, ...a, ...f, ...e, // front
    ...c, ...d, ...h, ...c, ...h, ...g, // back
    ...e, ...f, ...g, ...e, ...g, ...h, // top
    ...d, ...a, ...e, ...d, ...e, ...h, // west end
    ...b, ...c, ...g, ...b, ...g, ...f, // east end
  ]);
}

export const T = {
  box: template(new BoxGeometry(1, 1, 1)), // centred
  prism: prism(),
  hip: hip(),
  mansard: mansard(),
  plane: template(new PlaneGeometry(1, 1)), // faces +z
  cyl8: template(new CylinderGeometry(0.5, 0.5, 1, 8)),
  cyl16: template(new CylinderGeometry(0.5, 0.5, 1, 16)),
  cone4: template(new ConeGeometry(0.5, 1, 4)),
  cone8: template(new ConeGeometry(0.5, 1, 8)),
  frustum12: template(new CylinderGeometry(0.3, 0.5, 1, 12)),
  dome: template(new SphereGeometry(0.5, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 2, 1)), // unit-high hemisphere, base at y = 0
  sphere: template(new SphereGeometry(0.5, 10, 6)),
  blob: template(new IcosahedronGeometry(0.5, 1)),
  blob0: template(new IcosahedronGeometry(0.5, 0)),
};

const _m = new Matrix4();
const _n = new Matrix3();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();
const _v = new Vector3();
const _c = new Color();

export class GeoBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private lit: number[] | null;
  readonly frame = new Matrix4();
  /** Current aLit value applied to added parts (only when built with lit = true). */
  litValue = 0;

  constructor(withLit = false) {
    this.lit = withLit ? [] : null;
  }

  get vertexCount() {
    return this.pos.length / 3;
  }

  setFrame(x = 0, y = 0, z = 0, ry = 0) {
    _e.set(0, ry, 0, "YXZ");
    this.frame.compose(_p.set(x, y, z), _q.setFromEuler(_e), _s.set(1, 1, 1));
    return this;
  }

  /** Template at position / size / rotation (YXZ euler), in the current frame. */
  add(t: Template, color: string | Color, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) {
    _e.set(rx, ry, rz, "YXZ");
    _q.setFromEuler(_e);
    _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz)).premultiply(this.frame);
    this.addMatrix(t, color, _m);
  }

  /** Box from a base: (x, y0, z) is the centre of the bottom face. A base at y0 = 0 is sunk to -0.5. */
  box(color: string | Color, x: number, y0: number, z: number, sx: number, sy: number, sz: number, ry = 0) {
    if (y0 === 0) {
      y0 = -0.5; // bases sink into the ground: no gap or flicker at the foot of walls
      sy += 0.5;
    }
    this.add(T.box, color, x, y0 + sy / 2, z, sx, sy, sz, ry);
  }

  addMatrix(t: Template, color: string | Color, m: Matrix4) {
    _n.getNormalMatrix(m);
    if (typeof color === "string") _c.set(color);
    else _c.copy(color);
    const { pos, nor } = t;
    for (let i = 0; i < pos.length; i += 3) {
      _v.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(m);
      this.pos.push(_v.x, _v.y, _v.z);
      _v.set(nor[i], nor[i + 1], nor[i + 2]).applyMatrix3(_n).normalize();
      this.nor.push(_v.x, _v.y, _v.z);
      this.col.push(_c.r, _c.g, _c.b);
      if (this.lit) this.lit.push(this.litValue);
    }
  }

  build(): BufferGeometry | null {
    if (!this.pos.length) return null;
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new Float32BufferAttribute(this.nor, 3));
    g.setAttribute("color", new Float32BufferAttribute(this.col, 3));
    if (this.lit) g.setAttribute("aLit", new Float32BufferAttribute(this.lit, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Deterministic colour variation (r in 0..1). */
export function jitter(hex: string, r: number, amount = 0.06) {
  return new Color(hex).offsetHSL((r - 0.5) * amount * 0.3, (r - 0.5) * amount, (r - 0.5) * amount);
}

export const pick = <T,>(arr: readonly T[], r: number) => arr[Math.min(arr.length - 1, Math.floor(r * arr.length))];
