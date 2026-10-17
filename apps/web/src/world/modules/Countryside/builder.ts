// Merges many small low-poly parts into one vertex-coloured geometry (one draw call).
import { BufferGeometry, Color, Euler, Float32BufferAttribute, Matrix3, Matrix4, Quaternion, Vector3 } from "three";

interface Template {
  pos: Float32Array;
  nor: Float32Array;
}

export function template(geo: BufferGeometry): Template {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeVertexNormals();
  const t = { pos: (g.getAttribute("position").array as Float32Array).slice(), nor: (g.getAttribute("normal").array as Float32Array).slice() };
  if (g !== geo) g.dispose();
  geo.dispose();
  return t;
}

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
  /** Parent transform for add(): set it to place parts in a building's local frame. */
  readonly frame = new Matrix4();

  setFrame(x = 0, y = 0, z = 0, ry = 0) {
    _e.set(0, ry, 0, "YXZ");
    this.frame.compose(_p.set(x, y, z), _q.setFromEuler(_e), _s.set(1, 1, 1));
    return this;
  }

  /** Add a template at position/rotation(y-x-z euler)/scale with a colour. */
  add(
    t: Template,
    color: string | Color,
    x: number,
    y: number,
    z: number,
    sx = 1,
    sy = 1,
    sz = 1,
    ry = 0,
    rx = 0,
    rz = 0,
  ) {
    _e.set(rx, ry, rz, "YXZ");
    _q.setFromEuler(_e);
    _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz)).premultiply(this.frame);
    this.addMatrix(t, color, _m);
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
    }
  }

  build() {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new Float32BufferAttribute(this.nor, 3));
    g.setAttribute("color", new Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Slightly vary a hex colour (deterministic given r in 0..1). */
export function jitter(hex: string, r: number, amount = 0.06) {
  return new Color(hex).offsetHSL((r - 0.5) * amount * 0.4, (r - 0.5) * amount, (r - 0.5) * amount);
}
