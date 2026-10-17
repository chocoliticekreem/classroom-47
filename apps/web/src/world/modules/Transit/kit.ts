// Small three.js helpers shared by Transit's buses, metro and people. Everything is instanced.
import * as THREE from "three";

export function std(color: string, extra: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true, ...extra });
}

export function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, count: number, dynamic = false) {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
  m.matrixAutoUpdate = false;
  if (dynamic) {
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
  }
  return m;
}

export function finishStatic(m: THREE.InstancedMesh) {
  m.instanceMatrix.needsUpdate = true;
  if (m.instanceColor) m.instanceColor.needsUpdate = true;
  m.computeBoundingSphere();
  m.computeBoundingBox();
  return m;
}

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

/** Local transform: translate (x,y,z), yaw ry, scale (sx,sy,sz). */
export function local(x: number, y: number, z: number, ry = 0, sx = 1, sy = 1, sz = 1, out = new THREE.Matrix4()) {
  _p.set(x, y, z);
  _q.setFromEuler(_e.set(0, ry, 0));
  _s.set(sx, sy, sz);
  return out.compose(_p, _q, _s);
}

/** World frame at (x, y, z) facing heading h (0 = +z), optional roll about the forward axis. */
export function frame(x: number, y: number, z: number, h: number, out: THREE.Matrix4, roll = 0) {
  _p.set(x, y, z);
  _q.setFromEuler(_e.set(0, h, roll, "YXZ"));
  _s.set(1, 1, 1);
  return out.compose(_p, _q, _s);
}

export const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * A set of instanced parts that all move with one parent per "vehicle": instance k*L+j of a part
 * is parent[k] * locals[j]. One draw call per part, however many vehicles.
 */
export class Rig {
  readonly parts: { mesh: THREE.InstancedMesh; locals: THREE.Matrix4[] }[] = [];
  private readonly tmp = new THREE.Matrix4();
  constructor(readonly count: number) {}

  part(geo: THREE.BufferGeometry, mat: THREE.Material, locals: THREE.Matrix4[], shadow = false) {
    const mesh = instanced(geo, mat, this.count * locals.length, true);
    mesh.castShadow = shadow;
    this.parts.push({ mesh, locals });
    return mesh;
  }

  set(k: number, parent: THREE.Matrix4) {
    for (const { mesh, locals } of this.parts) {
      const L = locals.length;
      for (let j = 0; j < L; j++) mesh.setMatrixAt(k * L + j, this.tmp.multiplyMatrices(parent, locals[j]));
    }
  }

  hide(k: number, mesh: THREE.InstancedMesh) {
    const p = this.parts.find((x) => x.mesh === mesh);
    if (!p) return;
    for (let j = 0; j < p.locals.length; j++) mesh.setMatrixAt(k * p.locals.length + j, ZERO);
  }

  commit() {
    for (const { mesh } of this.parts) mesh.instanceMatrix.needsUpdate = true;
  }

  get meshes() {
    return this.parts.map((p) => p.mesh);
  }
}

/** Unit staircase: 1 wide (x), rises 1 (y) over a run of 1 (+z), base at origin. Scale per instance. */
export function stairsGeometry(steps = 14) {
  const geos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < steps; i++) {
    const h = (i + 1) / steps;
    const g = new THREE.BoxGeometry(1, h, 1 / steps);
    g.translate(0, h / 2, (i + 0.5) / steps);
    geos.push(g);
  }
  const merged = mergeBoxes(geos);
  geos.forEach((g) => g.dispose());
  return merged;
}

/** Merge non-indexed-compatible box geometries (position/normal/uv, indexed). */
export function mergeBoxes(geos: THREE.BufferGeometry[]) {
  let vCount = 0, iCount = 0;
  for (const g of geos) {
    vCount += g.attributes.position.count;
    iCount += g.index!.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const idx = new Uint32Array(iCount);
  let vo = 0, io = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array as Float32Array, vo * 3);
    nor.set(g.attributes.normal.array as Float32Array, vo * 3);
    uv.set(g.attributes.uv.array as Float32Array, vo * 2);
    const gi = g.index!.array;
    for (let k = 0; k < gi.length; k++) idx[io + k] = gi[k] + vo;
    vo += g.attributes.position.count;
    io += gi.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/** 0 by day, 1 at night, ramps through dusk/dawn. */
export function nightLevel(hour: number) {
  if (hour >= 19 || hour < 5.5) return 1;
  if (hour >= 17.5) return (hour - 17.5) / 1.5;
  if (hour < 7) return 1 - (hour - 5.5) / 1.5;
  return 0;
}
