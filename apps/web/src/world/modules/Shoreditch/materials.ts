// Shoreditch materials. The facade material draws every window, shopfront, loading door, curtain wall and
// container corrugation procedurally in the fragment shader (no textures, one draw call for all buildings),
// lit by `uNight`. Animated materials (people, boats, bulbs, neon, sculpture) move on the GPU via `uTime`.
import * as THREE from "three";

/** Buildings start this far below ground (no z-fighting with the paving); the shader measures floors from y = 0. */
export const FACADE_SINK = 0.5;

export interface Uniforms {
  uTime: { value: number };
  uNight: { value: number }; // 0 day .. 1 night
}

export function makeUniforms(): Uniforms {
  return { uTime: { value: 0 }, uNight: { value: 0 } };
}

const HASH = /* glsl */ `
float shHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
`;

/**
 * Facade shader for unit boxes (base at y = 0) with an instanced `aStyle` = (kind, seed, floorH, bayW).
 * kind 0 brick warehouse, 1 glass curtain wall, 2 flats, 3 shipping container, 4 railway-arch shopfront.
 * Local +z is the front (street) face.
 */
export function facadeMaterial(u: Uniforms): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.86, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = u.uNight;
    sh.vertexShader = sh.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
#define FACADE_SINK ${FACADE_SINK.toFixed(2)}
attribute vec4 aStyle;
varying vec4 vFac;
varying vec4 vStyle;
varying float vH;
varying float vFront;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
#ifdef USE_INSTANCING
vec3 shSc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
#else
vec3 shSc = vec3(1.0);
#endif
vec3 shPm = position * shSc;
vec3 shAn = abs(normal);
float shIsX = step(0.5, shAn.x);
float shW = mix(shSc.x, shSc.z, shIsX);
vFac = vec4(mix(shPm.x, shPm.z, shIsX) + shW * 0.5, shPm.y - FACADE_SINK, shW, step(0.5, shAn.y));
vStyle = aStyle;
vH = shSc.y - FACADE_SINK;
vFront = step(0.5, normal.z) + step(0.5, -normal.z) * 0.5;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uNight;
varying vec4 vFac;
varying vec4 vStyle;
varying float vH;
varying float vFront;
${HASH}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
float glassMask = 0.0;
vec3 shGlow = vec3(0.0);
{
  float kind = vStyle.x;
  float seed = vStyle.y;
  float fh = vStyle.z;
  float bw = vStyle.w;
  float u = vFac.x;
  float v = vFac.y;
  float W = vFac.z;
  vec3 base = diffuseColor.rgb;
  if (vFac.w > 0.5) {
    diffuseColor.rgb = kind > 2.5 ? base * 0.9 : (kind > 0.5 && kind < 1.5 ? vec3(0.62, 0.66, 0.7) : mix(base, vec3(0.3, 0.31, 0.33), 0.8));
  } else {
    float nb = max(1.0, floor((W - 1.2) / bw));
    float margin = (W - nb * bw) * 0.5;
    float bx = (u - margin) / bw;
    float bi = floor(bx);
    float fx = fract(bx);
    float inside = step(0.0, bx) * step(bx, nb);
    float fl = floor(v / fh);
    float fy = fract(v / fh);
    float floors = floor(vH / fh + 0.02);
    float topOk = step(v, floors * fh - 0.1);
    float cell = shHash(vec3(bi, fl, seed * 97.0 + vFront * 13.0));
    float on = step(cell, uNight * 0.62);
    vec3 warm = mix(vec3(1.0, 0.66, 0.32), vec3(1.0, 0.86, 0.58), shHash(vec3(bi + 3.0, fl, seed)));

    if (kind < 0.5) {
      // ---- Victorian brick warehouse
      float course = step(0.16, fract(v / 0.3));
      diffuseColor.rgb *= 0.9 + 0.1 * course;
      float band = (1.0 - step(0.07, fy)) * step(0.5, fl);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.84, 0.78, 0.66), band * 0.85);
      if (inside > 0.5 && topOk > 0.5) {
        float loophole = step(0.75, vFront) * (1.0 - step(0.5, abs(bi - floor(nb * 0.5)))) * step(0.5, fl);
        if (fl < 0.5) {
          if (vFront > 0.25 && fx > 0.08 && fx < 0.92 && fy < 0.84) {
            float shop = step(0.42, shHash(vec3(bi, 7.0, seed)));
            if (shop > 0.5) {
              float frame = max(step(fx, 0.12) + step(0.88, fx), step(0.72, fy) * step(fy, 0.76));
              frame = min(frame, 1.0);
              diffuseColor.rgb = mix(vec3(0.1, 0.13, 0.16), vec3(0.1, 0.1, 0.11), frame);
              glassMask = 1.0 - frame;
              shGlow += (1.0 - frame) * warm * (0.25 + uNight * 1.7);
            } else {
              vec3 paint = mix(vec3(0.13, 0.28, 0.25), vec3(0.42, 0.11, 0.09), shHash(vec3(bi, 9.0, seed)));
              diffuseColor.rgb = paint * (0.82 + 0.18 * step(0.5, fract(fx * 9.0)));
            }
          }
        } else if (loophole > 0.5) {
          if (fx > 0.16 && fx < 0.84 && fy > 0.04 && fy < 0.88)
            diffuseColor.rgb = vec3(0.32, 0.2, 0.11) * (0.82 + 0.18 * step(0.5, fract(fx * 6.0)));
        } else {
          float wx = (fx - 0.5) / 0.3;
          float wy = (fy - 0.2) / 0.62;
          float ay = max(wy - 0.8, 0.0) / 0.2;
          float win = step(abs(wx), 1.0) * step(0.0, wy) * step(wy, 1.0) * step(wx * wx + ay * ay, 1.0);
          if (win > 0.5) {
            float gb = max(step(0.88, fract((wx * 0.5 + 0.5) * 3.0)), step(0.9, fract(wy * 4.0)));
            diffuseColor.rgb = mix(vec3(0.11, 0.14, 0.17), vec3(0.85, 0.84, 0.8), gb);
            glassMask = 1.0 - gb;
            shGlow += (1.0 - gb) * on * warm * 1.5;
          } else if (abs(wx) < 1.15 && wy > -0.07 && wy < 0.0) {
            diffuseColor.rgb = vec3(0.82, 0.78, 0.7);
          }
        }
      }
    } else if (kind < 1.5) {
      // ---- glass curtain wall
      float mull = 1.0 - step(0.07, fract(u / bw));
      float spandrel = 1.0 - step(0.16, fy);
      float office = shHash(vec3(floor(bi / 4.0), fl, seed * 31.0 + vFront));
      float lit = step(office, uNight * 0.8);
      if (mull + spandrel > 0.5 || topOk < 0.5) {
        diffuseColor.rgb = vec3(0.5, 0.55, 0.6) * mix(1.0, 0.55, spandrel);
      } else {
        diffuseColor.rgb = mix(base * 0.55, vec3(0.78, 0.86, 0.95), 0.2 + 0.4 * fy);
        glassMask = 1.0;
        shGlow += lit * vec3(0.78, 0.88, 1.0) * 1.3;
      }
    } else if (kind < 2.5) {
      // ---- flats / modern
      if (inside > 0.5 && topOk > 0.5) {
        float ground = (1.0 - step(0.5, fl)) * step(0.75, vFront);
        float win = ground > 0.5
          ? step(0.06, fx) * step(fx, 0.94) * step(fy, 0.82)
          : step(0.12, fx) * step(fx, 0.88) * step(0.22, fy) * step(fy, 0.88);
        if (win > 0.5) {
          diffuseColor.rgb = vec3(0.13, 0.17, 0.21);
          glassMask = 1.0;
          shGlow += (ground > 0.5 ? (0.25 + uNight * 1.5) : on * 1.4) * warm;
        } else if (abs(fx - 0.5) < 0.42 && fy > 0.17 && fy < 0.22) {
          diffuseColor.rgb = base * 0.7;
        }
      }
    } else if (kind < 3.5) {
      // ---- shipping container: corrugated steel, shop hatch on the front, doors on the ends
      diffuseColor.rgb *= 0.8 + 0.2 * step(0.5, fract(u / 0.32));
      if (vFront > 0.75 && fx > 0.04 && fx < 0.96 && fy > 0.1 && fy < 0.86 && inside > 0.5) {
        diffuseColor.rgb = vec3(0.16, 0.12, 0.09);
        glassMask = 0.6;
        shGlow += warm * (0.3 + uNight * 1.6);
      } else if (vFront < 0.25 && abs(u - W * 0.5) < 0.04) {
        diffuseColor.rgb *= 0.5;
      }
    } else {
      // ---- railway arch shopfront: glazing with a frame grid and a door
      if (vFront > 0.25) {
        float fr = min(1.0, (1.0 - step(0.06, fract(u / 1.45))) + (1.0 - step(0.08, abs(v - 2.7))) + step(abs(u - W * 0.5), 0.6) * step(v, 2.6) * 0.0);
        diffuseColor.rgb = mix(vec3(0.12, 0.1, 0.09), base, fr);
        glassMask = 1.0 - fr;
        shGlow += (1.0 - fr) * warm * (0.4 + uNight * 2.0);
      }
    }
  }
}`,
      )
      .replace(
        "#include <metalnessmap_fragment>",
        `#include <metalnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.12, glassMask);
metalnessFactor = mix(metalnessFactor, 0.25, glassMask);`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
totalEmissiveRadiance += shGlow;`,
      );
  };
  m.customProgramCacheKey = () => "shoreditch-facade";
  return m;
}

/** Walking / standing people: instanced attribute aWalk = (range, speed, phase). Geometry faces +z. */
export function peopleMaterial(u: Uniforms, opts: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.85, ...opts });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = u.uTime;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>\nuniform float uTime;\nattribute vec3 aWalk;`)
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
{
  float walking = step(0.01, aWalk.x);
  float ph = uTime * aWalk.y / max(aWalk.x, 0.5) + aWalk.z;
  float dir = walking > 0.5 ? (cos(ph) >= 0.0 ? 1.0 : -1.0) : 1.0;
  transformed.xz *= dir;
  transformed.z += sin(ph) * aWalk.x * walking;
  transformed.y += abs(sin(uTime * 7.0 + aWalk.z * 3.0)) * 0.07 * walking;
  transformed.x += (1.0 - walking) * sin(uTime * 1.3 + aWalk.z * 5.0) * 0.06 * position.y;
}`,
      );
  };
  m.customProgramCacheKey = () => `shoreditch-people-${opts.vertexColors ? 1 : 0}`;
  return m;
}

/** Moored boats bob and roll gently; phase from the instance position. */
export function boatMaterial(u: Uniforms): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.55, vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = u.uTime;
    sh.vertexShader = sh.vertexShader.replace("#include <common>", `#include <common>\nuniform float uTime;`).replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
#ifdef USE_INSTANCING
{
  float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.61;
  transformed.y += sin(uTime * 1.1 + ph) * 0.12;
  transformed.x += transformed.y * sin(uTime * 0.9 + ph) * 0.035;
}
#endif`,
    );
  };
  m.customProgramCacheKey = () => "shoreditch-boat";
  return m;
}

/** Festoon bulbs and beacons: unlit, twinkling, bright enough to bloom at night (uBright). */
export function bulbMaterial(u: Uniforms, bright: { value: number }): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ toneMapped: false });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = u.uTime;
    sh.uniforms.uBright = bright;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>\nvarying float vPh;`)
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
#ifdef USE_INSTANCING
vPh = instanceMatrix[3].x * 1.7 + instanceMatrix[3].z * 0.9;
#else
vPh = 0.0;
#endif`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\nuniform float uTime;\nuniform float uBright;\nvarying float vPh;`)
      .replace("#include <color_fragment>", `#include <color_fragment>\ndiffuseColor.rgb *= uBright * (0.78 + 0.22 * sin(uTime * 2.6 + vPh));`);
  };
  m.customProgramCacheKey = () => "shoreditch-bulb";
  return m;
}

/** Neon signs: atlas map, unlit, a few flicker (vertex attribute aFlick). */
export function neonMaterial(u: Uniforms, map: THREE.Texture, bright: { value: number }): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ map, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = u.uTime;
    sh.uniforms.uBright = bright;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>\nattribute float aFlick;\nvarying float vFlick;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvFlick = aFlick;`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\nuniform float uTime;\nuniform float uBright;\nvarying float vFlick;`)
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
{
  float glowing = dot(diffuseColor.rgb, vec3(0.33));
  float fl = vFlick > 0.0 ? step(0.18, fract(sin(floor(uTime * 8.0) + vFlick * 91.7) * 43758.5)) : 1.0;
  diffuseColor.rgb *= mix(1.0, uBright * fl, smoothstep(0.08, 0.3, glowing));
}`,
      );
  };
  m.customProgramCacheKey = () => "shoreditch-neon";
  return m;
}

/** Silicon Roundabout sculpture: hue cycles up the rings (vertex attribute aH = height 0..1). */
export function sculptureMaterial(u: Uniforms): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: "#d9e2ea", roughness: 0.3, metalness: 0.6 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = u.uTime;
    sh.uniforms.uNight = u.uNight;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>\nattribute float aH;\nvarying float vHh;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvHh = aH;`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\nuniform float uTime;\nuniform float uNight;\nvarying float vHh;`)
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
{
  float hcy = fract(vHh * 0.8 - uTime * 0.12);
  vec3 hue = clamp(abs(mod(hcy * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  float pulse = 0.75 + 0.25 * sin(uTime * 2.0 - vHh * 9.0);
  totalEmissiveRadiance += hue * pulse * (0.7 + uNight * 2.2);
}`,
      );
  };
  m.customProgramCacheKey = () => "shoreditch-sculpture";
  return m;
}
