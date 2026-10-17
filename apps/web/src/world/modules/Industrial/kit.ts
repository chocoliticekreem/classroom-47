// Industrial: merge many low-poly parts into a few vertex-coloured (or UV-mapped) geometries, one draw call each.
import * as THREE from "three";

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();
const _c = new THREE.Color();

export function trs(x: number, y: number, z: number, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) {
  _e.set(rx, ry, rz, "YXZ");
  return _m.compose(_p.set(x, y, z), _q.setFromEuler(_e), _s.set(sx, sy, sz));
}

/** Vertex-coloured merged geometry (position, normal, color). Optional uv channel when `uv` is set. */
export class Kit {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private uvs: number[] = [];
  constructor(private readonly uv = false) {}

  /** Add a geometry (consumed: it is disposed) transformed by `m`, tinted `color`. */
  add(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, m?: THREE.Matrix4) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    const P = g.getAttribute("position");
    const N = g.getAttribute("normal");
    const U = g.getAttribute("uv");
    _c.set(color);
    if (m) _nm.getNormalMatrix(m);
    for (let i = 0; i < P.count; i++) {
      _v.fromBufferAttribute(P, i);
      _n.fromBufferAttribute(N, i);
      if (m) {
        _v.applyMatrix4(m);
        _n.applyMatrix3(_nm).normalize();
      }
      this.pos.push(_v.x, _v.y, _v.z);
      this.nor.push(_n.x, _n.y, _n.z);
      this.col.push(_c.r, _c.g, _c.b);
      if (this.uv) this.uvs.push(U ? U.getX(i) : 0, U ? U.getY(i) : 0);
    }
    if (g !== geo) g.dispose();
    geo.dispose();
    return this;
  }

  /** Box standing on y. Anything standing on the ground (y = 0) is sunk to y = -0.5 so no face is coplanar with it. */
  box(w: number, h: number, d: number, color: THREE.ColorRepresentation, x: number, y: number, z: number, ry = 0) {
    if (Math.abs(y) < 1e-3) {
      h += 0.5 + y;
      y = -0.5;
    }
    return this.add(new THREE.BoxGeometry(w, h, d), color, trs(x, y + h / 2, z, ry));
  }
  /** Cylinder standing on y (base at y; ground-standing ones are sunk to -0.5 like box()). */
  cyl(rTop: number, rBot: number, h: number, color: THREE.ColorRepresentation, x: number, y: number, z: number, seg = 12) {
    if (Math.abs(y) < 1e-3) {
      h += 0.5 + y;
      y = -0.5;
    }
    return this.add(new THREE.CylinderGeometry(rTop, rBot, h, seg), color, trs(x, y + h / 2, z));
  }
  /** Beam between two points (square section). */
  beam(a: [number, number, number], b: [number, number, number], t: number, color: THREE.ColorRepresentation, round = false) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    const geo = round ? new THREE.CylinderGeometry(t / 2, t / 2, len, 8) : new THREE.BoxGeometry(t, len, t);
    _v.set(dx, dy, dz).normalize();
    _q.setFromUnitVectors(_n.set(0, 1, 0), _v);
    _m.compose(_p.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _q, _s.set(1, 1, 1));
    return this.add(geo, color, _m);
  }

  get empty() {
    return this.pos.length === 0;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    if (this.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uvs, 2));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Battersea-style fluted chimney: tapered cylinder whose radius ripples with 16 flutes. Base at y = 0. */
export function flutedChimney(rBot: number, rTop: number, h: number) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, 48, 6, true);
  const p = g.getAttribute("position");
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const a = Math.atan2(z, x);
    const k = 1 + 0.045 * Math.cos(a * 16);
    p.setXYZ(i, x * k, p.getY(i) + h / 2, z * k);
  }
  g.computeVertexNormals();
  return g;
}

/** Hyperboloid cooling tower shell (outer + darker inner wall), base at y = 0. */
export function coolingTowerShell(rBase: number, rWaist: number, rTop: number, h: number) {
  const waist = h * 0.72;
  const pts: THREE.Vector2[] = [];
  const N = 14;
  for (let i = 0; i <= N; i++) {
    const y = (h * i) / N;
    const r =
      y < waist
        ? rWaist + (rBase - rWaist) * Math.pow((waist - y) / waist, 1.7)
        : rWaist + (rTop - rWaist) * Math.pow((y - waist) / (h - waist), 1.4);
    pts.push(new THREE.Vector2(r, y));
  }
  const outer = new THREE.LatheGeometry(pts, 28);
  const inner = new THREE.LatheGeometry(
    pts.map((v) => new THREE.Vector2(v.x - 0.35, v.y)).reverse(),
    28,
  );
  return { outer, inner };
}

/** Random lightness jitter around a base colour. */
export function jitter(hex: string, r: () => number, amount = 0.08) {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0, hsl.l + (r() - 0.5) * amount * 2)));
  return c;
}
