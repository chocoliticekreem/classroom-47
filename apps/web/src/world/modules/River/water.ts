// The river surface: a ribbon along the smoothed centre line with a flow-aware shader (ripples and
// streaks advected downstream, bank foam, boat wakes, sky tint/sunset/night by timeOfDay, lamp
// reflections at night, fades out into the sea at the mouth). One draw call, one uniform update per frame.
import * as THREE from "three";
import { BANK_X1, HALF_W, PATH, STEP, WATER_FADE, WATER_X0, centreZ, sAtX } from "./path";

export const WATER_Y = 0.012;
export const MAX_WAKES = 12;

const vertexShader = /* glsl */ `
attribute vec2 aRiver; // (arc length s, across -1..1)
varying vec2 vRiver;
varying vec3 vWorld;
#include <common>
#include <fog_pars_vertex>
void main() {
  vRiver = aRiver;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform float uDay;
uniform float uSunset;
uniform float uNight;
uniform float uHalfW;
uniform float uFadeX0;
uniform float uFadeX1;
uniform vec3 uSunDir;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uFoam;
uniform vec3 uSky;
uniform vec3 uSunsetCol;
uniform vec3 uHorizon;
uniform vec4 uWakes[${MAX_WAKES}]; // xz position, xz unit heading (zero = unused)
uniform float uWakeLen[${MAX_WAKES}];
varying vec2 vRiver;
varying vec3 vWorld;
#include <common>
#include <fog_pars_fragment>

float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec2 wave(vec2 p, vec2 d, float k, float a, float w) { return d * (a * k * cos(k * dot(d, p) - w * uTime)); }

void main() {
  float across = vRiver.y;            // -1 north bank .. +1 south bank
  float side = across * uHalfW;       // metres from the centre line
  float flow = 1.0 - across * across; // fastest mid-stream
  vec2 q = vec2(vRiver.x - uTime * (0.6 + 1.6 * flow), side); // flow-advected coords (along, across)

  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 v = toCam / dist;
  float detail = 1.0 - smoothstep(180.0, 1000.0, dist);

  // Ripples in the river frame: mostly crossing the flow, travelling downstream.
  vec2 g = vec2(0.0);
  g += wave(q, normalize(vec2(1.0, 0.35)), 0.33, 0.22, 1.1);
  g += wave(q, normalize(vec2(0.8, -0.6)), 0.52, 0.14, 1.6);
  g += wave(q, normalize(vec2(0.2, 1.0)), 0.9, 0.07, 2.4) * detail;
  g += wave(q, normalize(vec2(-0.5, 0.9)), 1.6, 0.03, 3.3) * detail;
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y)); // (approx: river frame ~ world frame for shading)

  // Base colour: murky-teal Thames, lighter towards the banks; long flow streaks.
  vec3 col = mix(uDeep, uShallow, smoothstep(0.35, 1.0, abs(across)));
  float streak = vnoise(vec2(q.x * 0.035, q.y * 0.55));
  col *= 0.9 + 0.2 * streak;
  col += (n.x * 0.5 + 0.1) * 0.05;
  // Embankment shade right under the walls.
  col *= 1.0 - 0.28 * smoothstep(0.86, 1.0, abs(across));

  // Sky reflection (fresnel), warm at sunset.
  float fres = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 4.0);
  vec3 refl = mix(uSky, uSunsetCol, uSunset * 0.8);
  col = mix(col, refl, clamp(0.08 + fres * 0.75, 0.0, 1.0));
  col *= mix(0.16, 1.0, uDay);

  // Sun glint.
  vec3 hv = normalize(uSunDir + v);
  col += pow(max(dot(n, hv), 0.0), 200.0) * 2.0 * uDay * mix(vec3(1.0, 0.97, 0.9), uSunsetCol, uSunset);

  // Lamp light reflected off the water at night: warm broken streaks along both banks.
  float lampBand = smoothstep(0.55, 0.95, abs(across));
  float shimmer = vnoise(vec2(vWorld.x * 0.28 + sin(uTime * 0.7) * 0.6, q.y * 2.2 + uTime * 0.9));
  float lampPos = smoothstep(0.55, 1.0, 0.5 + 0.5 * sin(vRiver.x * 0.26));
  col += vec3(1.0, 0.72, 0.38) * uNight * lampBand * lampPos * smoothstep(0.45, 0.85, shimmer) * 0.55;

  // Foam at the banks: a lapping band broken up by noise.
  float fn = vnoise(vec2(q.x * 0.6, q.y * 1.5) + vec2(0.0, uTime * 0.25));
  float edge = abs(across) - 0.93 - 0.03 * sin(uTime * 1.3 + vRiver.x * 0.21);
  float foam = smoothstep(-0.02, 0.05, edge) * smoothstep(0.25, 0.7, fn);

  // Boat wakes: a white wash right behind each boat plus a V of diverging lines.
  for (int i = 0; i < ${MAX_WAKES}; i++) {
    vec4 w = uWakes[i];
    if (dot(w.zw, w.zw) < 0.5) continue;
    vec2 rel = vWorld.xz - w.xy;
    float back = -dot(rel, w.zw);              // distance behind the boat
    float lat = abs(rel.x * w.w - rel.y * w.z); // distance off the track
    float L = uWakeLen[i];
    if (back < -3.0 || back > L) continue;
    float fade = 1.0 - smoothstep(0.0, L, back);
    float wash = (1.0 - smoothstep(0.6, 2.2 + back * 0.05, lat)) * smoothstep(-3.0, 1.0, back);
    float vline = abs(lat - back * 0.36);
    float kelvin = (1.0 - smoothstep(0.15, 0.9 + back * 0.03, vline)) * smoothstep(1.0, 6.0, back);
    float bn = vnoise(vWorld.xz * 0.9 + uTime);
    foam += (wash * (0.6 + 0.4 * bn) + kelvin * 0.75) * fade;
  }
  col = mix(col, uFoam * mix(0.3, 1.0, uDay), clamp(foam, 0.0, 1.0) * 0.85);

  col = mix(col, uHorizon, smoothstep(600.0, 3300.0, dist) * 0.9);
  float alpha = 1.0 - smoothstep(uFadeX0, uFadeX1, vWorld.x);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export function createRiverMaterial(): THREE.ShaderMaterial {
  const wakes: THREE.Vector4[] = [];
  for (let i = 0; i < MAX_WAKES; i++) wakes.push(new THREE.Vector4(0, 0, 0, 0));
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    fog: true,
    transparent: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uDay: { value: 1 },
        uSunset: { value: 0 },
        uNight: { value: 0 },
        uHalfW: { value: HALF_W },
        uFadeX0: { value: BANK_X1 - 4 },
        uFadeX1: { value: BANK_X1 + WATER_FADE },
        uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.4).normalize() },
        uShallow: { value: new THREE.Color("#4a9a9a") },
        uDeep: { value: new THREE.Color("#1f5a72") },
        uFoam: { value: new THREE.Color("#eef7f6") },
        uSky: { value: new THREE.Color("#c4e2f6") },
        uSunsetCol: { value: new THREE.Color("#ffab70") },
        uHorizon: { value: new THREE.Color("#a9c7e8") },
        uWakes: { value: wakes },
        uWakeLen: { value: new Array(MAX_WAKES).fill(40) },
      },
    ]),
  });
}

const TILT = (30 * Math.PI) / 180;
/** Time-of-day uniforms (same sun convention as Sky/Ground: rises east 06:00, sets west 20:00). */
export function applyRiverTime(mat: THREE.ShaderMaterial, hour: number) {
  const h = ((hour % 24) + 24) % 24;
  const phi = (Math.PI * (h - 6)) / 14;
  const elev = h >= 6 && h <= 20 ? Math.sin(phi) : -0.3;
  const u = mat.uniforms;
  (u.uSunDir.value as THREE.Vector3)
    .set(Math.cos(phi), Math.max(0.04, elev * Math.cos(TILT)), Math.max(0.04, elev) * Math.sin(TILT))
    .normalize();
  const day = THREE.MathUtils.smoothstep(elev, -0.12, 0.3);
  u.uDay.value = day;
  u.uSunset.value = THREE.MathUtils.smoothstep(elev, -0.15, 0.05) * (1 - THREE.MathUtils.smoothstep(elev, 0.12, 0.45));
  u.uNight.value = 1 - THREE.MathUtils.smoothstep(elev, -0.1, 0.12);
}

/** 0 at day, 1 at night: same curve the water uses, for lamps and bridge lights. */
export function nightAmount(hour: number) {
  const h = ((hour % 24) + 24) % 24;
  const elev = h >= 6 && h <= 20 ? Math.sin((Math.PI * (h - 6)) / 14) : -0.3;
  return 1 - THREE.MathUtils.smoothstep(elev, -0.1, 0.12);
}

/** The ribbon: 3 vertices across (north bank, centre, south bank) per path sample. */
export function riverRibbon(): THREE.BufferGeometry {
  const x0 = WATER_X0;
  const x1 = BANK_X1 + WATER_FADE + 6;
  const idx: number[] = [];
  for (let i = 0; i < PATH.count; i++) if (PATH.x[i] >= x0 && PATH.x[i] <= x1) idx.push(i);
  const across = [-1, 0, 1];
  const pos = new Float32Array(idx.length * 3 * 3);
  const riv = new Float32Array(idx.length * 3 * 2);
  const W = HALF_W + 0.8; // tuck under the walls
  idx.forEach((i, r) => {
    const nx = -PATH.tz[i];
    const nz = PATH.tx[i];
    across.forEach((a, k) => {
      const o = (r * 3 + k) * 3;
      pos[o] = PATH.x[i] + nx * a * W;
      pos[o + 1] = WATER_Y;
      pos[o + 2] = PATH.z[i] + nz * a * W;
      riv[(r * 3 + k) * 2] = i * STEP;
      riv[(r * 3 + k) * 2 + 1] = (a * W) / HALF_W;
    });
  });
  const index: number[] = [];
  for (let r = 0; r + 1 < idx.length; r++)
    for (let k = 0; k < 2; k++) {
      const a = r * 3 + k;
      const b = a + 1;
      const c = a + 3;
      const d = a + 4;
      index.push(a, b, c, b, d, c);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aRiver", new THREE.BufferAttribute(riv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** A rectangle of water at height y covering x0..x1, z0..z1 (used to hide the road in the raised bascule gap). */
export function waterPatch(x0: number, x1: number, z0: number, z1: number, y: number): THREE.BufferGeometry {
  const nx = 3;
  const nz = 10;
  const pos: number[] = [];
  const riv: number[] = [];
  for (let j = 0; j <= nz; j++)
    for (let i = 0; i <= nx; i++) {
      const x = x0 + ((x1 - x0) * i) / nx;
      const z = z0 + ((z1 - z0) * j) / nz;
      pos.push(x, y, z);
      riv.push(sAtX(x), (z - centreZ(x)) / HALF_W);
    }
  const index: number[] = [];
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      index.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aRiver", new THREE.Float32BufferAttribute(riv, 2));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}
