// Low-poly part templates and a merger that bakes many parts into one vertex-coloured geometry (one draw call per
// material). Optional per-vertex scalar `aLit` drives window glow at night.
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

/** Gable / pediment: unit footprint (x, z in -0.5..0.5), ridge along x at y = 1. */
function prism(): Template {
  const a = [-0.5, 0, 0.5], b = [0.5, 0, 0.5], c = [0.5, 0, -0.5], d = [-0.5, 0, -0.5];
  const e = [-0.5, 1, 0], f = [0.5, 1, 0];
  return fromTris([...a, ...b, ...f, ...a, ...f, ...e, ...c, ...d, ...e, ...c, ...e, ...f, ...d, ...a, ...e, ...b, ...c, ...f]);
}

/** Hipped roof: ridge shortened to x in -0.3..0.3. */
function hip(): Template {
  const a = [-0.5, 0, 0.5], b = [0.5, 0, 0.5], c = [0.5, 0, -0.5], d = [-0.5, 0, -0.5];
  const e = [-0.3, 1, 0], f = [0.3, 1, 0];
  return fromTris([...a, ...b, ...f, ...a, ...f, ...e, ...c, ...d, ...e, ...c, ...e, ...f, ...d, ...a, ...e, ...b, ...c, ...f]);
}

/** Pediment facing +z: triangle in the x-y plane, depth along z (-0.5..0.5), apex at y = 1. */
function pediment(): Template {
  const a = [-0.5, 0, 0.5], b = [0.5, 0, 0.5], c = [0, 1, 0.5];
  const d = [-0.5, 0, -0.5], e = [0.5, 0, -0.5], f = [0, 1, -0.5];
  return fromTris([...a, ...b, ...c, ...e, ...d, ...f, ...b, ...e, ...f, ...b, ...f, ...c, ...d, ...a, ...c, ...d, ...c, ...f]);
}

export const T = {
  box: template(new BoxGeometry(1, 1, 1)),
  prism: prism(),
  hip: hip(),
  pediment: pediment(),
  cyl8: template(new CylinderGeometry(0.5, 0.5, 1, 8)),
  cyl12: template(new CylinderGeometry(0.5, 0.5, 1, 12)),
  cyl24: template(new CylinderGeometry(0.5, 0.5, 1, 24)),
  halfCyl: template(new CylinderGeometry(0.5, 0.5, 1, 12, 1, false, -Math.PI / 2, Math.PI)), // +z half
  cone8: template(new ConeGeometry(0.5, 1, 8)),
  cone4: template(new ConeGeometry(0.5, 1, 4)),
  dome: template(new SphereGeometry(0.5, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 2, 1)), // unit-high, base y = 0
  sphere: template(new SphereGeometry(0.5, 10, 6)),
  blob: template(new IcosahedronGeometry(0.5, 1)),
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
  litValue = 0;

  constructor(withLit = false) {
    this.lit = withLit ? [] : null;
  }

  get vertexCount() {
    return this.pos.length / 3;
  }

  /** Template at centre position / size / rotation (YXZ euler). */
  add(t: Template, color: string | Color, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) {
    _e.set(rx, ry, rz, "YXZ");
    _q.setFromEuler(_e);
    _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
    this.addMatrix(t, color, _m);
  }

  /** Box standing on y0 (bottom-face centre at x, y0, z). A base at y0 = 0 is sunk to -0.3. */
  box(color: string | Color, x: number, y0: number, z: number, sx: number, sy: number, sz: number, ry = 0) {
    if (y0 === 0) {
      y0 = -0.3;
      sy += 0.3;
    }
    this.add(T.box, color, x, y0 + sy / 2, z, sx, sy, sz, ry);
  }

  /** Axis-aligned box from min/max corners. */
  boxMinMax(color: string | Color, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    this.box(color, (x0 + x1) / 2, y0, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0);
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

/** Flat textured quads (signs): vertical, facing direction `ry` (0 = facing +z), UVs into an atlas cell. */
export class QuadBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private uv: number[] = [];

  quad(x: number, y: number, z: number, w: number, h: number, ry: number, u0: number, v0: number, u1: number, v1: number) {
    const cx = Math.cos(ry);
    const sx = -Math.sin(ry); // local +x in world (rotation about y)
    const nx = Math.sin(ry);
    const nz = Math.cos(ry);
    const hx = (w / 2) * cx;
    const hz = (w / 2) * sx;
    const p = [
      [x - hx, y - h / 2, z - hz, u0, v0],
      [x + hx, y - h / 2, z + hz, u1, v0],
      [x + hx, y + h / 2, z + hz, u1, v1],
      [x - hx, y + h / 2, z - hz, u0, v1],
    ];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      this.pos.push(p[i][0], p[i][1], p[i][2]);
      this.nor.push(nx, 0, nz);
      this.uv.push(p[i][3], p[i][4]);
    }
  }

  build(): BufferGeometry | null {
    if (!this.pos.length) return null;
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new Float32BufferAttribute(this.nor, 3));
    g.setAttribute("uv", new Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    return g;
  }
}

/** Deterministic colour variation (r in 0..1). */
export function jitter(hex: string, r: number, amount = 0.06) {
  return new Color(hex).offsetHSL((r - 0.5) * amount * 0.3, (r - 0.5) * amount, (r - 0.5) * amount);
}
