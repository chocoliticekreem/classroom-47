// Billboard particle pool: fixed size, struct-of-arrays, zero allocation per frame. One draw call per pool.
// Used for tyre smoke, engine smoke, the black crash plume, foam arcs (normal blending) and fire/sparks (additive).
import * as THREE from "three";

export interface Spawn {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  s0: number;
  s1: number;
  a: number;
  r: number;
  g: number;
  b: number;
  gravity: number; // m/s^2 down (negative = rises)
  drag: number;
}

export const spawnArgs = (): Spawn => ({
  x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, s0: 1, s1: 1, a: 1, r: 1, g: 1, b: 1, gravity: 0, drag: 0,
});

export class Pool {
  readonly n: number;
  readonly pos: Float32Array;
  readonly params: Float32Array; // size, alpha, rotation
  readonly color: Float32Array;
  private vel: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private phys: Float32Array;
  private spin: Float32Array;
  private cursor = 0;
  live = 0;

  constructor(n: number) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.params = new Float32Array(n * 3);
    this.color = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.age = new Float32Array(n).fill(1);
    this.life = new Float32Array(n).fill(0);
    this.size = new Float32Array(n * 2);
    this.alpha = new Float32Array(n);
    this.phys = new Float32Array(n * 2);
    this.spin = new Float32Array(n);
    for (let i = 0; i < n; i++) this.pos[i * 3 + 1] = -9999;
  }

  spawn(s: Spawn) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.n;
    const i3 = i * 3;
    this.pos[i3] = s.x;
    this.pos[i3 + 1] = s.y;
    this.pos[i3 + 2] = s.z;
    this.vel[i3] = s.vx;
    this.vel[i3 + 1] = s.vy;
    this.vel[i3 + 2] = s.vz;
    this.age[i] = 0;
    this.life[i] = s.life;
    this.size[i * 2] = s.s0;
    this.size[i * 2 + 1] = s.s1;
    this.alpha[i] = s.a;
    this.color[i3] = s.r;
    this.color[i3 + 1] = s.g;
    this.color[i3 + 2] = s.b;
    this.phys[i * 2] = s.gravity;
    this.phys[i * 2 + 1] = s.drag;
    this.spin[i] = (Math.random() - 0.5) * 1.2;
    this.params[i3 + 2] = Math.random() * 6.28;
  }

  update(dt: number) {
    let live = 0;
    for (let i = 0; i < this.n; i++) {
      const i3 = i * 3;
      if (this.age[i] >= this.life[i]) {
        this.params[i3 + 1] = 0;
        this.params[i3] = 0;
        continue;
      }
      live++;
      this.age[i] += dt;
      const k = Math.min(1, this.age[i] / this.life[i]);
      const drag = Math.max(0, 1 - this.phys[i * 2 + 1] * dt);
      this.vel[i3] *= drag;
      this.vel[i3 + 1] = this.vel[i3 + 1] * drag - this.phys[i * 2] * dt;
      this.vel[i3 + 2] *= drag;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.pos[i3 + 1] < 0.1 && this.phys[i * 2] > 0) {
        this.pos[i3 + 1] = 0.1;
        this.vel[i3] *= 0.5;
        this.vel[i3 + 1] = 0;
        this.vel[i3 + 2] *= 0.5;
      }
      this.params[i3] = this.size[i * 2] + (this.size[i * 2 + 1] - this.size[i * 2]) * k;
      // quick fade in, long fade out
      const fade = Math.min(1, k * 8) * (1 - k * k);
      this.params[i3 + 1] = this.alpha[i] * fade;
      this.params[i3 + 2] += this.spin[i] * dt;
    }
    this.live = live;
  }
}

const VERT = /* glsl */ `
attribute vec3 aPos;
attribute vec3 aParams;
attribute vec3 aColor;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
varying float vSeed;
void main() {
  vUv = uv;
  vAlpha = aParams.y;
  vColor = aColor;
  vSeed = aParams.z;
  vec4 mv = modelViewMatrix * vec4(aPos, 1.0);
  float c = cos(aParams.z);
  float s = sin(aParams.z);
  vec2 p = vec2(position.x * c - position.y * s, position.x * s + position.y * c);
  mv.xy += p * aParams.x;
  gl_Position = projectionMatrix * mv;
}
`;

const SMOKE_FRAG = /* glsl */ `
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
varying float vSeed;
void main() {
  vec2 q = vUv - 0.5;
  float d = length(q) * 2.0;
  float lumps = sin(q.x * 12.0 + vSeed * 3.0) * sin(q.y * 10.0 - vSeed * 2.0) * 0.18;
  float a = smoothstep(1.0, 0.3, d + lumps) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor * (0.8 + 0.4 * vUv.y), a);
}
`;

const GLOW_FRAG = /* glsl */ `
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float body = pow(max(0.0, 1.0 - d), 1.6);
  float core = pow(max(0.0, 1.0 - d * 1.7), 3.0);
  float a = body * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4((vColor * body + vec3(1.0, 0.92, 0.75) * core) * vAlpha, 1.0);
}
`;

export function poolMesh(pool: Pool, additive: boolean): THREE.Mesh {
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute("position", base.getAttribute("position"));
  geo.setAttribute("uv", base.getAttribute("uv"));
  for (const [name, arr] of [
    ["aPos", pool.pos],
    ["aParams", pool.params],
    ["aColor", pool.color],
  ] as const) {
    const a = new THREE.InstancedBufferAttribute(arr, 3);
    a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(name, a);
  }
  geo.instanceCount = pool.n;
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: additive ? GLOW_FRAG : SMOKE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = additive ? 12 : 10;
  return mesh;
}

export function markDirty(mesh: THREE.Mesh) {
  const g = mesh.geometry;
  for (const n of ["aPos", "aParams", "aColor"]) (g.getAttribute(n) as THREE.InstancedBufferAttribute).needsUpdate = true;
}
