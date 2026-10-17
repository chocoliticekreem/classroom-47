// Cheap stylised sea: analytic sine-wave normals, shallow-to-deep gradient, sky fresnel,
// sun glint, animated swash foam along the shoreline. Fragment-only, one draw call, fog-aware.
import * as THREE from "three";
import { WATER_X } from "../../config";
import { MOUTH_N, MOUTH_SHORE_INSET, QUAY_N, QUAY_S, SHORE_INSET } from "./noise";

const vertexShader = /* glsl */ `
varying vec3 vWorld;
#include <common>
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform float uWaterX;
uniform float uQuayN;
uniform float uQuayS;
uniform float uMouthN;
uniform float uMouthInset;
uniform float uInset;
uniform float uDay;
uniform float uSunset;
uniform vec3 uSunDir;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uFoam;
uniform vec3 uSky;
uniform vec3 uSunsetCol;
uniform vec3 uHorizon;
varying vec3 vWorld;
#include <common>
#include <fog_pars_fragment>

float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}

// Mirrors shoreX() in noise.ts.
float shoreX(float z) {
  if (z >= uQuayN && z <= uQuayS) return uWaterX;
  if (z >= uMouthN && z < uQuayN) return uWaterX - uMouthInset;
  float e = z < uMouthN ? uMouthN - z : z - uQuayS;
  float m = smoothstep(0.0, 60.0, e);
  return uWaterX - uInset + m * (2.6 * sin(z * 0.031) + 1.2 * sin(z * 0.097 + 1.3));
}

// Gradient of a single travelling sine wave a*sin(k*dot(d,p) + w*t).
vec2 wave(vec2 p, vec2 d, float k, float a, float w) {
  return d * (a * k * cos(k * dot(d, p) + w * uTime));
}

void main() {
  vec2 p = vWorld.xz;
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 v = toCam / dist;

  // Analytic wave normal. Waves roll in towards the shore (-x). Detail fades with distance (cheap AA).
  float detail = 1.0 - smoothstep(150.0, 900.0, dist);
  vec2 g = vec2(0.0);
  g += wave(p, normalize(vec2(-1.0, 0.25)), 0.18, 0.55, 1.3);
  g += wave(p, normalize(vec2(-0.8, -0.6)), 0.29, 0.30, 1.7);
  g += wave(p, normalize(vec2(-0.3, 1.0)), 0.47, 0.16, 2.3) * detail;
  g += wave(p, normalize(vec2(0.6, -1.0)), 0.83, 0.07, 3.1) * detail;
  g += wave(p, normalize(vec2(-1.0, -0.1)), 1.37, 0.035, 4.2) * detail;
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));

  // Distance offshore drives the shallow -> deep gradient.
  float d = vWorld.x - shoreX(vWorld.z);
  float depthT = smoothstep(0.0, 80.0, d) ;
  vec3 col = mix(uShallow, uDeep, depthT);
  // Gentle large-scale tint patches so open water isn't uniform.
  col *= 0.92 + 0.16 * vnoise(p * 0.012 + vec2(uTime * 0.01, 0.0));
  // Crest brightening.
  col += (n.x * 0.5 + 0.15) * 0.06;

  // Sky reflection (fresnel), warmed at sunset.
  float fres = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 4.0);
  vec3 refl = mix(uSky, uSunsetCol, uSunset * 0.75);
  col = mix(col, refl, clamp(0.06 + fres * 0.8, 0.0, 1.0));

  // Day/night dimming.
  col *= mix(0.18, 1.0, uDay);

  // Sun glint.
  vec3 hv = normalize(uSunDir + v);
  float spec = pow(max(dot(n, hv), 0.0), 220.0) * 2.2 * uDay;
  col += spec * mix(vec3(1.0, 0.98, 0.92), uSunsetCol, uSunset);

  // Foam: a pulsing swash band on the shore plus incoming foam lines, broken up by noise.
  float fn = vnoise(p * 0.45 + vec2(uTime * 0.35, uTime * 0.12));
  float fn2 = vnoise(p * 1.7 - vec2(uTime * 0.2, 0.0));
  float swash = d - 0.9 * (0.5 + 0.5 * sin(uTime * 0.9 + vWorld.z * 0.045));
  float edge = 1.0 - smoothstep(0.2, 1.4 + 1.6 * fn, swash);
  float lines = smoothstep(0.78, 0.98, sin(d * 0.75 - uTime * 1.4 + fn * 2.5));
  lines *= (1.0 - smoothstep(2.0, 12.0, d)) * smoothstep(0.35, 0.65, fn2);
  float foam = clamp(edge + lines * 0.8, 0.0, 1.0) * step(-1.0, d);
  col = mix(col, uFoam * mix(0.3, 1.0, uDay), foam * 0.92);

  // Haze into the horizon.
  col = mix(col, uHorizon, smoothstep(500.0, 3300.0, dist) * 0.9);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export function createWaterMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uWaterX: { value: WATER_X },
        uQuayN: { value: QUAY_N },
        uQuayS: { value: QUAY_S },
        uMouthN: { value: MOUTH_N },
        uMouthInset: { value: MOUTH_SHORE_INSET },
        uInset: { value: SHORE_INSET },
        uDay: { value: 1 },
        uSunset: { value: 0 },
        uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.4).normalize() },
        uShallow: { value: new THREE.Color("#3cc4c4") },
        uDeep: { value: new THREE.Color("#1b5f9e") },
        uFoam: { value: new THREE.Color("#f4fbff") },
        uSky: { value: new THREE.Color("#c4e2f6") },
        uSunsetCol: { value: new THREE.Color("#ffad72") },
        uHorizon: { value: new THREE.Color("#a9c7e8") },
      },
    ]),
  });
}

const TILT = (30 * Math.PI) / 180;

/**
 * Update the time-of-day uniforms in place (no allocation). Sun rises east (+x) at 06:00, sets west at 20:00,
 * leaning south (+z), matching the Sky module's convention.
 */
export function applyTimeOfDay(mat: THREE.ShaderMaterial, hour: number) {
  const h = ((hour % 24) + 24) % 24;
  const phi = (Math.PI * (h - 6)) / 14;
  const elev = h >= 6 && h <= 20 ? Math.sin(phi) : -0.3;
  const u = mat.uniforms;
  (u.uSunDir.value as THREE.Vector3).set(Math.cos(phi), Math.max(0.04, elev * Math.cos(TILT)), Math.max(0.04, elev) * Math.sin(TILT)).normalize();
  const day = THREE.MathUtils.smoothstep(elev, -0.12, 0.3);
  u.uDay.value = day;
  u.uSunset.value = THREE.MathUtils.smoothstep(elev, -0.15, 0.05) * (1 - THREE.MathUtils.smoothstep(elev, 0.12, 0.45));
}

/** Per-frame update: advance the wave clock, follow the time of day, and match the scene fog colour if any. */
export function tickWater(mat: THREE.ShaderMaterial, dt: number, hour: number, fogColor: THREE.Color | null) {
  mat.uniforms.uTime.value += dt;
  applyTimeOfDay(mat, hour);
  if (fogColor) (mat.uniforms.uHorizon.value as THREE.Color).copy(fogColor);
}
