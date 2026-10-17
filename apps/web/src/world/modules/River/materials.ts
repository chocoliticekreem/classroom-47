// GPU-side tricks for the River module, all as onBeforeCompile patches on MeshStandardMaterial so they keep
// scene lighting, fog and shadows:
//  - boatMaterial: hides boat fragments inside bridge footprints so boats appear to slip UNDER the decks
//    (bridges sit at road level, y = 0, because vehicles drive at y = 0).
//  - walkerMaterial: pedestrians walking the promenades and the footbridge, positioned entirely in the
//    vertex shader from a path texture: one uniform update per frame for hundreds of people.
//  - wobbleMaterial: the "wobbly" footbridge sways sideways.
import * as THREE from "three";
import { PATH } from "./path";

export const MAX_FOOTPRINTS = 12;

export function boatMaterial(footprints: [number, number, number, number][]): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.05, flatShading: true });
  const fp: THREE.Vector4[] = [];
  for (let i = 0; i < MAX_FOOTPRINTS; i++) {
    const f = footprints[i];
    fp.push(f ? new THREE.Vector4(f[0], f[1], f[2], f[3]) : new THREE.Vector4(1e9, -1e9, 0, 0));
  }
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uFoot = { value: fp };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vBoatW;")
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
  vec4 bw = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  bw = instanceMatrix * bw;
  #endif
  vBoatW = (modelMatrix * bw).xz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec2 vBoatW;\nuniform vec4 uFoot[${MAX_FOOTPRINTS}];`)
      .replace(
        "void main() {",
        `void main() {
  for (int i = 0; i < ${MAX_FOOTPRINTS}; i++) {
    vec4 f = uFoot[i];
    if (vBoatW.x > f.x && vBoatW.x < f.y && vBoatW.y > f.z && vBoatW.y < f.w) discard;
  }`,
      );
  };
  m.customProgramCacheKey = () => "river-boat";
  return m;
}

/** Path texture: one texel per path sample: (x, z, tx, tz). */
export function pathTexture(): THREE.DataTexture {
  const data = new Float32Array(PATH.count * 4);
  for (let i = 0; i < PATH.count; i++) {
    data[i * 4] = PATH.x[i];
    data[i * 4 + 1] = PATH.z[i];
    data[i * 4 + 2] = PATH.tx[i];
    data[i * 4 + 3] = PATH.tz[i];
  }
  const t = new THREE.DataTexture(data, PATH.count, 1, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

export interface WalkerUniforms {
  uTime: { value: number };
  uWobble: { value: number };
}

/**
 * Walkers. Per-instance attribute aWalk = (s0, speed, lateral, mode):
 *   mode 0: promenade: arc length s wraps in [uRange.x, uRange.y], placed `lateral` m right of the flow.
 *   mode 1: footbridge: z wraps in [uFootSpan.y, uFootSpan.z] at x = uFootSpan.x + lateral, deck y = uFootSpan.w.
 * Instance matrices stay identity; everything happens in the vertex shader.
 */
export function walkerMaterial(
  tex: THREE.DataTexture,
  range: [number, number],
  foot: { x: number; z0: number; z1: number; y: number },
  shared: WalkerUniforms,
): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uWobble = shared.uWobble;
    shader.uniforms.uPath = { value: tex };
    shader.uniforms.uCount = { value: PATH.count };
    shader.uniforms.uStep = { value: PATH.length / (PATH.count - 1) };
    shader.uniforms.uRange = { value: new THREE.Vector2(range[0], range[1]) };
    shader.uniforms.uFootSpan = { value: new THREE.Vector4(foot.x, foot.z0, foot.z1, foot.y) };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute vec4 aWalk;
uniform float uTime;
uniform float uWobble;
uniform sampler2D uPath;
uniform float uCount;
uniform float uStep;
uniform vec2 uRange;
uniform vec4 uFootSpan;
vec4 pathAt(float s) {
  float f = clamp(s / uStep, 0.0, uCount - 1.001);
  int i = int(floor(f));
  vec4 a = texelFetch(uPath, ivec2(i, 0), 0);
  vec4 b = texelFetch(uPath, ivec2(i + 1, 0), 0);
  return mix(a, b, fract(f));
}`,
      )
      .replace(
        "#include <beginnormal_vertex>",
        `vec3 wOrigin; float wYaw; float wScale;
{
  float speed = aWalk.y;
  if (aWalk.w < 0.5) {
    float span = uRange.y - uRange.x;
    float s = uRange.x + mod(aWalk.x + speed * uTime, span);
    vec4 p = pathAt(s);
    vec2 t = normalize(p.zw);
    vec2 n = vec2(-t.y, t.x);
    wOrigin = vec3(p.x + n.x * aWalk.z, 0.0, p.y + n.y * aWalk.z);
    vec2 d = speed >= 0.0 ? t : -t;
    wYaw = atan(d.x, d.y);
    wScale = smoothstep(uRange.x, uRange.x + 12.0, s) * (1.0 - smoothstep(uRange.y - 12.0, uRange.y, s));
  } else {
    float L = uFootSpan.z - uFootSpan.y;
    float z = uFootSpan.y + mod(aWalk.x + speed * uTime, L);
    float u = (z - uFootSpan.y) / L;
    float sway = uWobble * sin(uTime * 1.7) * sin(3.14159 * u);
    wOrigin = vec3(uFootSpan.x + aWalk.z + sway, uFootSpan.w, z);
    wYaw = speed >= 0.0 ? 0.0 : 3.14159;
    wScale = smoothstep(0.0, 0.04, u) * (1.0 - smoothstep(0.96, 1.0, u));
  }
}
float wc = cos(wYaw); float wsn = sin(wYaw);
mat3 wRot = mat3(wc, 0.0, -wsn, 0.0, 1.0, 0.0, wsn, 0.0, wc);
vec3 objectNormal = wRot * vec3(normal);
#ifdef USE_TANGENT
vec3 objectTangent = vec3(tangent.xyz);
#endif`,
      )
      .replace(
        "#include <begin_vertex>",
        `vec3 transformed = wRot * (vec3(position) * wScale);
transformed.y += abs(sin(uTime * 7.5 + aWalk.x)) * 0.07 * wScale;
transformed += wOrigin;`,
      );
  };
  m.customProgramCacheKey = () => "river-walker";
  return m;
}

/** Footbridge deck: vertex colours + a lateral sway that peaks mid-span. Geometry is in world coords. */
export function wobbleMaterial(foot: { z0: number; z1: number }, shared: WalkerUniforms): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.35, flatShading: true });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uWobble = shared.uWobble;
    shader.uniforms.uSpan = { value: new THREE.Vector2(foot.z0, foot.z1) };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;\nuniform float uWobble;\nuniform vec2 uSpan;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
  float wu = clamp((transformed.z - uSpan.x) / (uSpan.y - uSpan.x), 0.0, 1.0);
  transformed.x += uWobble * sin(uTime * 1.7) * sin(3.14159 * wu);`,
      );
  };
  m.customProgramCacheKey = () => "river-wobble";
  return m;
}
