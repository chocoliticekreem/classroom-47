// Fireworks over the river: one THREE.Points draw call. Every particle belongs to a burst; bursts fire in a
// rolling sequence, each cycle at a new (hashed) spot, height and colour. The CPU only advances uTime.
import * as THREE from "three";

export const FIREWORKS = { bursts: 14, perBurst: 140, interval: 0.85, rise: 1.1, life: 2.6 };

const VERT = /* glsl */ `
uniform float uTime;
uniform float uFade;
uniform vec3 uCentre;
attribute vec4 aSeed; // burst index, dir.xyz (unit)
varying vec3 vColor;
varying float vAlpha;

float hash(float n) { return fract(sin(n) * 43758.5453123); }

vec3 palette(float h) {
  if (h < 0.17) return vec3(1.0, 0.25, 0.2);
  if (h < 0.34) return vec3(1.0, 0.85, 0.3);
  if (h < 0.5) return vec3(0.35, 0.6, 1.0);
  if (h < 0.67) return vec3(0.4, 1.0, 0.5);
  if (h < 0.84) return vec3(1.0, 0.4, 0.9);
  return vec3(1.0, 1.0, 1.0);
}

void main() {
  float B = ${FIREWORKS.bursts.toFixed(1)};
  float period = B * ${FIREWORKS.interval.toFixed(3)};
  float k = aSeed.x;
  float local = uTime - k * ${FIREWORKS.interval.toFixed(3)};
  float cycle = floor(local / period);
  float tt = local - cycle * period; // time since this burst's launch
  float id = k + cycle * 31.0;
  vec3 at = uCentre + vec3((hash(id) - 0.5) * 150.0, 55.0 + hash(id + 1.7) * 55.0, (hash(id + 3.1) - 0.5) * 40.0);
  vec3 pos;
  float alpha;
  float size;
  float rise = ${FIREWORKS.rise.toFixed(2)};
  float life = ${FIREWORKS.life.toFixed(2)};
  vColor = palette(hash(id + 5.3));
  if (local < 0.0 || tt > rise + life) {
    pos = vec3(0.0, -1000.0, 0.0); alpha = 0.0; size = 0.0;
  } else if (tt < rise) {
    // the rocket: a short streak of sparks climbing to the burst point
    float f = tt / rise;
    float trail = fract(aSeed.y * 7.13 + aSeed.z * 3.7) * 0.12;
    vec3 base = vec3(at.x, uCentre.y, at.z);
    pos = mix(base, at, clamp(f - trail, 0.0, 1.0));
    alpha = (1.0 - trail * 6.0) * step(0.0, f - trail);
    size = 1.1;
    vColor = vec3(1.0, 0.8, 0.5);
  } else {
    float e = tt - rise;
    float sp = 26.0 * (0.75 + 0.25 * fract(aSeed.w * 13.1));
    float drag = (1.0 - exp(-e * 1.6)) / 1.6;
    pos = at + aSeed.yzw * sp * drag + vec3(0.0, -4.9 * e * e * 0.55, 0.0);
    alpha = 1.0 - smoothstep(life * 0.45, life, e);
    alpha *= 0.75 + 0.25 * sin(e * 40.0 + aSeed.y * 20.0); // crackle
    size = 1.6 * (1.0 - e / life * 0.5);
    vColor = mix(vec3(1.0), vColor, smoothstep(0.0, 0.25, e));
  }
  vAlpha = alpha * uFade;
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = size * 380.0 / max(1.0, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = dot(d, d) * 4.0;
  if (r > 1.0) discard;
  float a = vAlpha * (1.0 - r);
  gl_FragColor = vec4(vColor * a * 2.2, a);
}`;

export class Fireworks {
  readonly points: THREE.Points;
  private mat: THREE.ShaderMaterial;
  private geo: THREE.BufferGeometry;
  private fade = 0;
  active = false;

  constructor() {
    const n = FIREWORKS.bursts * FIREWORKS.perBurst;
    const seed = new Float32Array(n * 4);
    let r = 12345;
    const rnd = () => {
      r = (r * 16807) % 2147483647;
      return r / 2147483647;
    };
    for (let i = 0; i < n; i++) {
      // uniform direction on a sphere
      const u = rnd() * 2 - 1;
      const th = rnd() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      seed[i * 4] = Math.floor(i / FIREWORKS.perBurst);
      seed[i * 4 + 1] = s * Math.cos(th);
      seed[i * 4 + 2] = u;
      seed[i * 4 + 3] = s * Math.sin(th);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uFade: { value: 0 }, uCentre: { value: new THREE.Vector3() } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.name = "events-fireworks";
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  start(x: number, y: number, z: number) {
    (this.mat.uniforms.uCentre.value as THREE.Vector3).set(x, y, z);
    this.mat.uniforms.uTime.value = 0;
    this.active = true;
    this.points.visible = true;
  }

  stop() {
    this.active = false;
  }

  tick(dt: number) {
    if (!this.points.visible) return;
    this.mat.uniforms.uTime.value += dt;
    this.fade = this.active ? Math.min(1, this.fade + dt) : Math.max(0, this.fade - dt * 0.5);
    this.mat.uniforms.uFade.value = this.fade;
    if (!this.active && this.fade <= 0) this.points.visible = false;
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}
