// Shipping: GPU particle pools. Foam (wakes, bow waves, prop wash) and puffs (funnel smoke, tug exhaust, horn
// steam). Each pool is one InstancedMesh with a ShaderMaterial: the CPU only writes a particle when it is born
// (ring buffer); motion, growth and fading run in the vertex shader off one uTime uniform.
import * as THREE from "three";
import { WIND } from "../../config";

const FOAM_VERT = /* glsl */ `
attribute vec4 aA; // x, z, birth time, life
attribute vec4 aB; // drift dir x, z, drift speed, size
attribute vec2 aC; // stretch across, opacity
uniform float uTime;
uniform float uY;
varying vec2 vUv;
varying float vK;
varying float vOp;
varying float vSeed;
#include <common>
#include <fog_pars_vertex>
void main() {
  float age = uTime - aA.z;
  float k = age / max(aA.w, 0.001);
  float alive = step(0.0, k) * step(k, 1.0);
  vec2 d = aB.xy;
  vec2 c = aA.xy + d * aB.z * age * (1.0 - 0.45 * k);
  float s = aB.w * (0.6 + 1.9 * sqrt(max(k, 0.0))) * alive;
  vec2 side = vec2(d.y, -d.x);
  vec2 p = c + side * position.x * s * aC.x + d * position.z * s;
  vUv = position.xz + 0.5;
  vK = clamp(k, 0.0, 1.0);
  vOp = aC.y;
  vSeed = fract(aA.z * 7.31);
  vec4 mvPosition = viewMatrix * vec4(p.x, uY, p.y, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FOAM_FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vK;
varying float vOp;
varying float vSeed;
#include <common>
#include <fog_pars_fragment>
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec2 q = vUv - 0.5;
  float r = length(q) * 2.0;
  float n = vn(vUv * 5.0 + vSeed * 17.0) * 0.6 + vn(vUv * 11.0 - vSeed * 5.0) * 0.4;
  // foam breaks up into lace as it ages
  float lace = smoothstep(0.25 + 0.5 * vK, 0.75 + 0.2 * vK, n);
  float a = smoothstep(1.0, 0.3, r) * (1.0 - vK) * (1.0 - vK) * vOp * mix(1.0, lace, 0.35 + 0.5 * vK);
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(0.93, 0.96, 0.98), a);
  #include <fog_fragment>
}
`;

const PUFF_VERT = /* glsl */ `
attribute vec4 aA; // x, y, z, birth
attribute vec4 aB; // vx, vy, vz, life
attribute vec4 aC; // r, g, b, size
uniform float uTime;
uniform vec3 uWind;
uniform vec3 uSun;
varying vec3 vCol;
varying float vA;
#include <common>
#include <fog_pars_vertex>
void main() {
  float age = uTime - aA.w;
  float k = age / max(aB.w, 0.001);
  float alive = step(0.0, k) * step(k, 1.0);
  float kk = clamp(k, 0.0, 1.0);
  // buoyant rise slows, wind takes over
  vec3 c = aA.xyz + aB.xyz * (age * (1.0 - 0.5 * kk)) + uWind * age * 0.8 + vec3(0.0, 1.2 * age, 0.0);
  float s = aC.w * (0.5 + 2.2 * sqrt(kk)) * alive;
  vec3 p = c + position * s;
  float l = 0.62 + 0.38 * max(dot(normal, uSun), 0.0);
  vCol = aC.rgb * l;
  vA = smoothstep(0.0, 0.06, kk) * pow(1.0 - kk, 1.4) * 0.75;
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const PUFF_FRAG = /* glsl */ `
varying vec3 vCol;
varying float vA;
#include <common>
#include <fog_pars_fragment>
void main() {
  if (vA < 0.01) discard;
  gl_FragColor = vec4(vCol, vA);
  #include <fog_fragment>
}
`;

class Pool {
  mesh: THREE.InstancedMesh;
  protected next = 0;
  protected lo = Infinity;
  protected hi = -1;
  protected attrs: THREE.InstancedBufferAttribute[];
  readonly size: number;
  constructor(geo: THREE.BufferGeometry, mat: THREE.ShaderMaterial, size: number, layout: [string, number][], birth: number) {
    this.size = size;
    this.attrs = layout.map(([name, n]) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(size * n), n);
      a.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(name, a);
      return a;
    });
    // everything starts long dead
    const a0 = this.attrs[0];
    for (let i = 0; i < size; i++) a0.array[i * a0.itemSize + birth] = -1e6;
    this.mesh = new THREE.InstancedMesh(geo, mat, size);
    this.mesh.frustumCulled = false;
    const id = new THREE.Matrix4();
    for (let i = 0; i < size; i++) this.mesh.setMatrixAt(i, id);
  }
  protected take() {
    const i = this.next;
    this.next = (this.next + 1) % this.size;
    if (i < this.lo) this.lo = i;
    if (i > this.hi) this.hi = i;
    return i;
  }
  /** Upload only the slots written this frame. */
  flush() {
    if (this.hi < 0) return;
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      a.addUpdateRange(this.lo * a.itemSize, (this.hi - this.lo + 1) * a.itemSize);
      a.needsUpdate = true;
    }
    this.lo = Infinity;
    this.hi = -1;
  }
  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}

export class Foam extends Pool {
  mat: THREE.ShaderMaterial;
  constructor(size = 1800, seaY = -0.17) {
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      vertexShader: FOAM_VERT,
      fragmentShader: FOAM_FRAG,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uY: { value: seaY } }]),
      transparent: true,
      depthWrite: false,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    super(geo, mat, size, [["aA", 4], ["aB", 4], ["aC", 2]], 2);
    this.mat = mat;
    this.mesh.renderOrder = 2;
  }
  emit(x: number, z: number, t: number, life: number, dx: number, dz: number, speed: number, size: number, stretch = 1, opacity = 0.6) {
    const i = this.take();
    const [A, B, C] = this.attrs;
    A.array[i * 4] = x;
    A.array[i * 4 + 1] = z;
    A.array[i * 4 + 2] = t;
    A.array[i * 4 + 3] = life;
    B.array[i * 4] = dx;
    B.array[i * 4 + 1] = dz;
    B.array[i * 4 + 2] = speed;
    B.array[i * 4 + 3] = size;
    C.array[i * 2] = stretch;
    C.array[i * 2 + 1] = opacity;
  }
}

export class Puffs extends Pool {
  mat: THREE.ShaderMaterial;
  constructor(size = 900) {
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const sun = new THREE.Vector3(0.4, 0.85, 0.3).normalize();
    const mat = new THREE.ShaderMaterial({
      vertexShader: PUFF_VERT,
      fragmentShader: PUFF_FRAG,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { uTime: { value: 0 }, uWind: { value: new THREE.Vector3(WIND[0], 0, WIND[1]) }, uSun: { value: sun } },
      ]),
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    super(geo, mat, size, [["aA", 4], ["aB", 4], ["aC", 4]], 3);
    this.mat = mat;
    this.mesh.renderOrder = 3;
  }
  emit(x: number, y: number, z: number, t: number, vx: number, vy: number, vz: number, life: number, color: THREE.Color, size: number) {
    const i = this.take();
    const [A, B, C] = this.attrs;
    A.array[i * 4] = x;
    A.array[i * 4 + 1] = y;
    A.array[i * 4 + 2] = z;
    A.array[i * 4 + 3] = t;
    B.array[i * 4] = vx;
    B.array[i * 4 + 1] = vy;
    B.array[i * 4 + 2] = vz;
    B.array[i * 4 + 3] = life;
    C.array[i * 4] = color.r;
    C.array[i * 4 + 1] = color.g;
    C.array[i * 4 + 2] = color.b;
    C.array[i * 4 + 3] = size;
  }
}
