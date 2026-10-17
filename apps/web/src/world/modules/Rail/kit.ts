// Small three.js toolkit for the railway: a vertex-coloured mesh builder (boxes, sweeps along the track,
// arbitrary quads), instanced-mesh helpers and canvas textures. All static geometry is merged.
import * as THREE from "three";

export class Builder {
  pos: number[] = [];
  col: number[] = [];
  uv: number[] | null = null;
  private c = new THREE.Color();

  private push(x: number, y: number, z: number, color: THREE.Color) {
    this.pos.push(x, y, z);
    this.col.push(color.r, color.g, color.b);
  }

  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, color: string | THREE.Color) {
    const k = typeof color === "string" ? this.c.set(color) : color;
    this.push(a.x, a.y, a.z, k);
    this.push(b.x, b.y, b.z, k);
    this.push(c.x, c.y, c.z, k);
  }

  /** Quad a-b-c-d (counter-clockwise seen from the front). */
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color: string | THREE.Color) {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  }

  /** Oriented box: centre (x, y, z), size (sx along local x, sy, sz along local z), yaw about y. */
  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number, color: string, pitch = 0) {
    const m = _m.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(pitch, yaw, 0, "YXZ")), _s.set(sx, sy, sz));
    this.geometry(UNIT_BOX, m, color);
  }

  /** Append a (non-indexed or indexed) geometry transformed by m, flat colour. */
  geometry(g: THREE.BufferGeometry, m: THREE.Matrix4, color: string | THREE.Color) {
    const k = typeof color === "string" ? this.c.set(color).clone() : color;
    const p = g.attributes.position;
    const idx = g.index;
    const n = idx ? idx.count : p.count;
    for (let i = 0; i < n; i++) {
      const j = idx ? idx.getX(i) : i;
      _v.fromBufferAttribute(p, j).applyMatrix4(m);
      this.push(_v.x, _v.y, _v.z, k);
    }
  }

  /**
   * Sweep a cross-section along sampled track points. `profile(i)` returns [lateral(left +), up] pairs
   * (the same count every time) relative to the sample; consecutive points form the faces (loop if closed).
   */
  sweep(
    pts: readonly SweepPoint[],
    profile: (i: number) => readonly (readonly [number, number])[],
    color: string | ((i: number) => string),
    closed = false,
  ) {
    let prev: THREE.Vector3[] | null = null;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const lx = Math.cos(p.h), lz = -Math.sin(p.h);
      const ring = profile(i).map(([u, v]) => new THREE.Vector3(p.x + lx * u, p.y + v, p.z + lz * u));
      if (prev) {
        const col = typeof color === "string" ? color : color(i);
        const n = ring.length;
        const segs = closed ? n : n - 1;
        for (let k = 0; k < segs; k++) {
          const k2 = (k + 1) % n;
          this.quad(prev[k], ring[k], ring[k2], prev[k2], col);
        }
      }
      prev = ring;
    }
  }

  get empty() {
    return this.pos.length === 0;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

export interface SweepPoint {
  x: number;
  y: number;
  z: number;
  h: number;
}

const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

export const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

export function vcMat(extra: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true, ...extra });
}

export function stdMat(color: string, extra: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true, ...extra });
}

export function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, count: number, dynamic = false) {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
  m.matrixAutoUpdate = false;
  m.count = count;
  if (dynamic) {
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
  }
  return m;
}

export function finish(m: THREE.InstancedMesh) {
  m.instanceMatrix.needsUpdate = true;
  if (m.instanceColor) m.instanceColor.needsUpdate = true;
  m.computeBoundingSphere();
  m.computeBoundingBox();
  return m;
}

export function staticMesh(geo: THREE.BufferGeometry, mat: THREE.Material, cast = false, receive = true) {
  const m = new THREE.Mesh(geo, mat);
  m.matrixAutoUpdate = false;
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

/** Matrix for a unit box stretched from point a to point b with cross-section (w, d). */
export function beamMatrix(ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number, d: number, out: THREE.Matrix4) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dy, dz) || 1e-6;
  _v.set(dx / len, dy / len, dz / len);
  _q.setFromUnitVectors(Y_UP, _v);
  return out.compose(_s.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), _q, _p2.set(w, len, d));
}
const Y_UP = new THREE.Vector3(0, 1, 0);
const _p2 = new THREE.Vector3();

export function compose(x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number, out: THREE.Matrix4, pitch = 0, roll = 0) {
  return out.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(pitch, yaw, roll, "YXZ")), _s.set(sx, sy, sz));
}

export const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

// ---- Canvas textures (no fonts or images from the network) -------------------------------------------

export function canvasTexture(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  draw(cv.getContext("2d")!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function fitFont(c: CanvasRenderingContext2D, text: string, maxW: number, size: number, weight = "bold") {
  let s = size;
  c.font = `${weight} ${s}px Helvetica, Arial, sans-serif`;
  while (c.measureText(text).width > maxW && s > 8) {
    s -= 2;
    c.font = `${weight} ${s}px Helvetica, Arial, sans-serif`;
  }
}

/** British Rail double arrow, drawn in a w x h box at (x, y). */
export function railArrows(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  c.save();
  c.translate(x, y);
  c.scale(w / 100, h / 60);
  c.strokeStyle = color;
  c.lineWidth = 7;
  c.lineCap = "butt";
  c.beginPath();
  c.moveTo(5, 20);
  c.lineTo(95, 20);
  c.moveTo(5, 40);
  c.lineTo(95, 40);
  c.moveTo(30, 2);
  c.lineTo(65, 30);
  c.lineTo(35, 58);
  c.moveTo(70, 2);
  c.lineTo(35, 30);
  c.lineTo(65, 58);
  c.stroke();
  c.restore();
}

/** 0 by day, 1 at night, ramps through dusk/dawn (same curve the other modules use). */
export function nightLevel(hour: number) {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 19 || h < 5.5) return 1;
  if (h >= 17.5) return (h - 17.5) / 1.5;
  if (h < 7) return 1 - (h - 5.5) / 1.5;
  return 0;
}

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
