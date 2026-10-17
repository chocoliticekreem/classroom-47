// Industrial smoke: GPU particle plumes. Every particle's position, size and opacity is a pure function of
// (time, its spawn point, its seeds, the wind). `particleAt` below is the CPU reference used by tests;
// SMOKE_VERTEX implements the same formula in GLSL, so the CPU only updates uTime each frame.
//
// Plume model per particle (age a in seconds, life L, u = a / L):
//   rise:   y = y0 + (top - y0) * (1 - e^(-a / TAU_RISE))                      (buoyant rise that levels off)
//   drift:  xz = spawn + W * (a - TAU_WIND * (1 - e^(-a / TAU_WIND)))          (starts still, bends over to wind speed)
//   spread: disc offset * sigma(a), sigma = s0 + SPREAD_K * spread * a^0.85    (plume widens downwind)
//   size:   size0 + growth * a;  alpha = opacity * fadeIn(u) * (1 - fadeOut(u))
import { WIND } from "../../config";
import {
  CHIMNEYS,
  CHIMNEY_TOP,
  CHEM,
  COOLING_TOWERS,
  REFINERY,
  STEEL,
  rng,
  type V3,
} from "./layout";

export const WIND_SCALE = 2.2; // smoke drifts faster than "real" wind so motion reads from the aerial camera
export const SMOKE_WIND: [number, number] = [WIND[0] * WIND_SCALE, WIND[1] * WIND_SCALE];
export const TAU_RISE = 9;
export const TAU_WIND = 5;
export const SPREAD_K = 1.15;

export type SmokeKind = "dark" | "steam" | "black" | "furnace";

export interface Emitter {
  name: string;
  kind: SmokeKind;
  pos: V3; // stack top
  top: number; // plume levels off at this height (m)
  glow: number; // 0..1 orange underlight at night (furnaces, flare)
  scale: number; // overall size multiplier
}

export const EMITTERS: Emitter[] = [
  ...CHIMNEYS.map(([x, z], i): Emitter => ({
    name: `power ${i}`,
    kind: "dark",
    pos: [x, CHIMNEY_TOP + 0.5, z],
    top: 104 + i * 4,
    glow: 0.15,
    scale: 1.15,
  })),
  { name: "steel stack", kind: "dark", pos: [STEEL.stack.x, STEEL.stack.h + 0.5, STEEL.stack.z], top: 96, glow: 0.8, scale: 1 },
  { name: "blast furnace", kind: "furnace", pos: [STEEL.furnace.x, STEEL.furnace.h + 6, STEEL.furnace.z], top: 78, glow: 1, scale: 0.9 },
  ...COOLING_TOWERS.map((t, i): Emitter => ({
    name: `cooling ${i}`,
    kind: "steam",
    pos: [t.x, t.h - 2, t.z],
    top: 74 + i * 6,
    glow: 0,
    scale: 1.6,
  })),
  { name: "flare", kind: "black", pos: [REFINERY.flare.x, REFINERY.flare.h + 6, REFINERY.flare.z], top: 92, glow: 1, scale: 0.85 },
  { name: "chem stack", kind: "steam", pos: [CHEM.stack.x, CHEM.stack.h + 0.5, CHEM.stack.z], top: 60, glow: 0, scale: 0.6 },
];

/** Per-kind particle groups: a dense short-lived "near" plume plus a sparse, long "trail" that streams over the city. */
interface GroupSpec {
  count: number;
  life: number;
  size0: number;
  growth: number;
  opacity: number;
  spread: number;
  fadeIn: number; // u at which the particle reaches full opacity
  fadeOut: number; // u at which it starts fading
}
export const KIND_GROUPS: Record<SmokeKind, { near: GroupSpec; trail: GroupSpec; color: string; haze: string }> = {
  dark: {
    color: "#4a4a4e",
    haze: "#8e8c8a",
    near: { count: 44, life: 16, size0: 4.5, growth: 1.1, opacity: 0.62, spread: 1, fadeIn: 0.04, fadeOut: 0.55 },
    trail: { count: 70, life: 96, size0: 9, growth: 0.62, opacity: 0.3, spread: 1, fadeIn: 0.1, fadeOut: 0.62 },
  },
  furnace: {
    color: "#5a4a40",
    haze: "#958a80",
    near: { count: 36, life: 14, size0: 5, growth: 1.2, opacity: 0.58, spread: 1.2, fadeIn: 0.04, fadeOut: 0.5 },
    trail: { count: 50, life: 90, size0: 9, growth: 0.6, opacity: 0.26, spread: 1.1, fadeIn: 0.1, fadeOut: 0.6 },
  },
  black: {
    color: "#1d1b1a",
    haze: "#6f6c6a",
    near: { count: 34, life: 12, size0: 3.5, growth: 1.2, opacity: 0.7, spread: 0.9, fadeIn: 0.03, fadeOut: 0.5 },
    trail: { count: 46, life: 88, size0: 8, growth: 0.6, opacity: 0.28, spread: 1, fadeIn: 0.1, fadeOut: 0.6 },
  },
  steam: {
    color: "#f4f4f1",
    haze: "#e2e4e6",
    near: { count: 40, life: 14, size0: 6, growth: 1.3, opacity: 0.55, spread: 1.3, fadeIn: 0.04, fadeOut: 0.45 },
    trail: { count: 40, life: 84, size0: 12, growth: 0.62, opacity: 0.2, spread: 1.2, fadeIn: 0.12, fadeOut: 0.5 },
  },
};

/** One particle's constant inputs (also the per-instance attributes of the GPU mesh). */
export interface Particle {
  spawn: V3;
  top: number;
  life: number;
  phase: number; // 0..1, offsets this particle's age along its life
  size0: number;
  growth: number;
  opacity: number;
  spread: number;
  fadeIn: number;
  fadeOut: number;
  glow: number;
  seed: [number, number, number, number]; // 0..1 each
  color: string;
  haze: string;
}

/** Every smoke particle, deterministic (seeded). */
export function buildParticles(emitters: Emitter[] = EMITTERS, seed = 7): Particle[] {
  const r = rng(seed);
  const out: Particle[] = [];
  for (const e of emitters) {
    const k = KIND_GROUPS[e.kind];
    for (const g of [k.near, k.trail]) {
      const n = Math.round(g.count * Math.min(1.3, Math.max(0.6, e.scale)));
      for (let i = 0; i < n; i++) {
        out.push({
          spawn: e.pos,
          top: e.top,
          life: g.life * (0.9 + 0.2 * r()),
          phase: (i + 0.5 * r()) / n,
          size0: g.size0 * e.scale,
          growth: g.growth * e.scale,
          opacity: g.opacity,
          spread: g.spread * e.scale,
          fadeIn: g.fadeIn,
          fadeOut: g.fadeOut,
          glow: e.glow,
          seed: [r(), r(), r(), r()],
          color: k.color,
          haze: k.haze,
        });
      }
    }
  }
  return out;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface ParticleState {
  x: number;
  y: number;
  z: number;
  size: number;
  alpha: number;
  age: number;
}

/** CPU reference of the vertex shader (keep in sync with SMOKE_VERTEX). */
export function particleAt(p: Particle, time: number, out: ParticleState, wind: [number, number] = SMOKE_WIND): ParticleState {
  const age = (((time + p.phase * p.life) % p.life) + p.life) % p.life;
  const u = age / p.life;
  const [r1, r2, r3, r4] = p.seed;
  const rise = 1 - Math.exp(-age / TAU_RISE);
  const bend = age - TAU_WIND * (1 - Math.exp(-age / TAU_WIND));
  const sigma = 0.8 + SPREAD_K * p.spread * Math.pow(age, 0.85);
  const ang = r1 * 6.2831853;
  const rad = Math.sqrt(r2);
  const wob = Math.sin(time * 0.23 + r4 * 6.2831853 + age * 0.17) * sigma * 0.25;
  out.x = p.spawn[0] + wind[0] * bend + Math.cos(ang) * rad * sigma + wob;
  out.z = p.spawn[2] + wind[1] * bend + Math.sin(ang) * rad * sigma - wob;
  out.y = p.spawn[1] + (p.top - p.spawn[1]) * rise + (r3 - 0.5) * sigma * 0.55 * rise;
  out.size = p.size0 + p.growth * age;
  out.alpha = p.opacity * smoothstep(0, p.fadeIn, u) * (1 - smoothstep(p.fadeOut, 1, u));
  out.age = age;
  return out;
}

// ---------- GLSL ----------
export const SMOKE_VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
uniform float uTime;
uniform vec2 uWind;
attribute vec3 aSpawn;
attribute vec4 aLife;   // life, phase, top, glow
attribute vec4 aShape;  // size0, growth, spread, opacity
attribute vec4 aFade;   // fadeIn, fadeOut, -, -
attribute vec4 aSeed;
attribute vec3 aColor;
attribute vec3 aHaze;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
varying float vGlow;
varying float vRot;
void main() {
  float life = aLife.x;
  float age = mod(uTime + aLife.y * life, life);
  float u = age / life;
  float rise = 1.0 - exp(-age / ${TAU_RISE.toFixed(1)});
  float bend = age - ${TAU_WIND.toFixed(1)} * (1.0 - exp(-age / ${TAU_WIND.toFixed(1)}));
  float sigma = 0.8 + ${SPREAD_K.toFixed(3)} * aShape.z * pow(max(age, 1e-4), 0.85);
  float ang = aSeed.x * 6.2831853;
  float rad = sqrt(aSeed.y);
  float wob = sin(uTime * 0.23 + aSeed.w * 6.2831853 + age * 0.17) * sigma * 0.25;
  vec3 c;
  c.x = aSpawn.x + uWind.x * bend + cos(ang) * rad * sigma + wob;
  c.z = aSpawn.z + uWind.y * bend + sin(ang) * rad * sigma - wob;
  c.y = aSpawn.y + (aLife.z - aSpawn.y) * rise + (aSeed.z - 0.5) * sigma * 0.55 * rise;
  float size = aShape.x + aShape.y * age;
  vAlpha = aShape.w * smoothstep(0.0, aFade.x, u) * (1.0 - smoothstep(aFade.y, 1.0, u));
  vColor = mix(aColor, aHaze, smoothstep(0.0, 0.45, u));
  vGlow = aLife.w * exp(-age / 9.0);
  vRot = aSeed.w * 6.2831853 + age * (aSeed.x - 0.5) * 0.08;
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(c, 1.0);
  mvPosition.xy += position.xy * size;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

export const SMOKE_FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform sampler2D uMap;
uniform float uDay;     // 1 by day, ~0.3 at night
uniform float uNight;   // 0 by day, 1 at night
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
varying float vGlow;
varying float vRot;
void main() {
  vec2 p = vUv - 0.5;
  float cs = cos(vRot), sn = sin(vRot);
  p = vec2(cs * p.x - sn * p.y, sn * p.x + cs * p.y) + 0.5;
  float a = texture2D(uMap, p).a * vAlpha;
  if (a < 0.004) discard;
  // cheap volume: lit from above, darker underside
  vec3 col = vColor * mix(0.78, 1.08, vUv.y) * uDay;
  // furnaces and the flare light the plume from below at night; the city's sodium glow tints the haze
  col += vec3(1.0, 0.42, 0.12) * vGlow * uNight * (1.15 - vUv.y * 0.6);
  col += vec3(0.32, 0.17, 0.08) * uNight * 0.35;
  gl_FragColor = vec4(col, a);
  #include <fog_fragment>
}
`;

// ---------- sparks (steelworks pour) ----------
export const SPARK_COUNT = 240;
export const SPARK_GRAVITY = 9.8;

export interface Spark {
  life: number;
  phase: number;
  vel: V3;
  seed: number;
}
export function buildSparks(seed = 11): Spark[] {
  const r = rng(seed);
  return Array.from({ length: SPARK_COUNT }, (_, i) => {
    const ang = r() * Math.PI * 2;
    const out = 1.5 + r() * 4.5;
    return {
      life: 0.7 + r() * 1.1,
      phase: (i + r()) / SPARK_COUNT,
      vel: [Math.cos(ang) * out, 4 + r() * 7, Math.sin(ang) * out] as V3,
      seed: r(),
    };
  });
}
/** CPU reference of the spark shader: ballistic arc from the pour point. */
export function sparkAt(s: Spark, origin: V3, time: number): { x: number; y: number; z: number; age: number } {
  const age = (((time + s.phase * s.life) % s.life) + s.life) % s.life;
  return {
    x: origin[0] + s.vel[0] * age,
    y: Math.max(0.05, origin[1] + s.vel[1] * age - 0.5 * SPARK_GRAVITY * age * age),
    z: origin[2] + s.vel[2] * age,
    age,
  };
}

export const SPARK_VERTEX = /* glsl */ `
uniform float uTime;
uniform vec3 uOrigin;
uniform float uScale;
attribute vec3 aVel;
attribute vec3 aLife; // life, phase, seed
varying float vT;
void main() {
  float life = aLife.x;
  float age = mod(uTime + aLife.y * life, life);
  vec3 p = uOrigin + aVel * age;
  p.y = max(0.05, uOrigin.y + aVel.y * age - ${(0.5 * SPARK_GRAVITY).toFixed(2)} * age * age);
  vT = age / life;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = min(10.0, uScale * (0.35 + 0.25 * aLife.z) * (1.0 - vT * 0.6) / max(1.0, -mv.z));
  gl_Position = projectionMatrix * mv;
}
`;
export const SPARK_FRAGMENT = /* glsl */ `
varying float vT;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = (1.0 - smoothstep(0.0, 0.5, length(d))) * (1.0 - vT);
  vec3 col = mix(vec3(1.0, 0.95, 0.7), vec3(1.0, 0.35, 0.05), vT);
  gl_FragColor = vec4(col * 2.2 * a, a);
}
`;

// ---------- flare flame ----------
export const FLAME_VERTEX = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position;
  float k = uv.y * uv.y;
  p.x += sin(uTime * 9.0 + uv.y * 5.0) * 0.6 * k + sin(uTime * 2.1) * 1.2 * k;
  p.z += cos(uTime * 7.0 + uv.y * 4.0) * 0.5 * k;
  p.y *= 0.85 + 0.2 * sin(uTime * 11.0) * sin(uTime * 3.7 + 1.0); // local frame: base at y = 0
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;
export const FLAME_FRAGMENT = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
void main() {
  float x = abs(vUv.x - 0.5) * 2.0;
  float y = vUv.y;
  float width = (1.0 - y) * (0.55 + 0.45 * sin(y * 3.14159));
  float n = 0.5 + 0.5 * sin(y * 18.0 - uTime * 14.0 + vUv.x * 6.0);
  float body = (1.0 - smoothstep(width * 0.35, width, x)) * (1.0 - smoothstep(0.55, 1.0, y + n * 0.12));
  vec3 col = mix(vec3(1.0, 0.95, 0.65), vec3(1.0, 0.38, 0.05), smoothstep(0.05, 0.75, y + x * 0.3));
  gl_FragColor = vec4(col * 2.4 * body, body);
}
`;
