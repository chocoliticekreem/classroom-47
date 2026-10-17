// Materials for the Old Town. Night lighting is driven by a few shared uniforms (set when the hour changes),
// and crowds and the castle flag animate on the GPU from one uTime uniform.
import { Color, DoubleSide, MeshStandardMaterial } from "three";

export interface Uniforms {
  uTime: { value: number };
  uNight: { value: number };
}

export function newUniforms(): Uniforms {
  return { uTime: { value: 0 }, uNight: { value: 0 } };
}

/** Per frame: advance the animation clock (dt = 0 when paused) and follow the hour of day. */
export function tickUniforms(U: Uniforms, dt: number, hour: number) {
  U.uTime.value += dt;
  U.uNight.value = nightLevel(hour);
}

/** 0 by day, 1 at night: fades 17:45-19:15 and 05:45-07:15. */
export function nightLevel(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 19.25 || h < 5.75) return 1;
  if (h >= 17.75) return (h - 17.75) / 1.5;
  if (h < 7.25) return 1 - (h - 5.75) / 1.5;
  return 0;
}

const EMISSIVE_HOOK = "#include <emissivemap_fragment>";

export function makeMaterials(U: Uniforms) {
  const solid = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 });

  // Landmarks: same look, plus warm floodlighting at night
  const stone = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8 });
  stone.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = U.uNight;
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uNight;")
      .replace(EMISSIVE_HOOK, `${EMISSIVE_HOOK}\ntotalEmissiveRadiance += vColor.rgb * vec3(1.0, 0.82, 0.6) * uNight * 0.32;`);
  };
  stone.customProgramCacheKey = () => "oldtown-stone";

  // House windows: per-window aLit says how brightly (if at all) it glows at night
  const windows = new MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.15 });
  windows.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = U.uNight;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aLit;\nvarying float vLit;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLit = aLit;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uNight;\nvarying float vLit;")
      .replace(EMISSIVE_HOOK, `${EMISSIVE_HOOK}\ntotalEmissiveRadiance += vec3(1.0, 0.72, 0.38) * vLit * uNight * 1.7;`);
  };
  windows.customProgramCacheKey = () => "oldtown-windows";

  // Lamps, stained glass, clock faces: their vertex colour is the light colour
  const glow = new MeshStandardMaterial({ vertexColors: true, color: new Color("#6a6a6a"), roughness: 0.4 });
  glow.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = U.uNight;
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uNight;")
      .replace(EMISSIVE_HOOK, `${EMISSIVE_HOOK}\ntotalEmissiveRadiance += vColor.rgb * (0.12 + uNight * 1.8);`);
  };
  glow.customProgramCacheKey = () => "oldtown-glow";

  const flat = (roughness: number, metalness = 0) =>
    new MeshStandardMaterial({
      vertexColors: true,
      roughness,
      metalness,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
  const pave = flat(0.95);
  const lawn = flat(0.95);
  const water = flat(0.18, 0.15);

  // Pedestrians: each instance walks back and forth along its own segment (aSeg) entirely on the GPU
  const people = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  people.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime;
    sh.vertexShader = sh.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uTime;
attribute vec4 aSeg;
attribute vec2 aMeta;
attribute vec3 aShirt;
attribute float aLit;`,
      )
      .replace(
        "#include <beginnormal_vertex>",
        `float pLen = max(distance(aSeg.xy, aSeg.zw), 0.01);
float pT = fract(aMeta.y + uTime * aMeta.x / (2.0 * pLen));
float pU = 1.0 - abs(2.0 * pT - 1.0);
vec2 pPos = mix(aSeg.xy, aSeg.zw, pU);
vec2 pDir = normalize(aSeg.zw - aSeg.xy + vec2(1e-4)) * (pT < 0.5 ? 1.0 : -1.0);
float pC = pDir.y;
float pS = pDir.x;
vec3 objectNormal = vec3(normal.x * pC + normal.z * pS, normal.y, -normal.x * pS + normal.z * pC);
#ifdef USE_TANGENT
vec3 objectTangent = vec3(tangent.xyz);
#endif`,
      )
      .replace(
        "#include <begin_vertex>",
        `vec3 transformed = vec3(position.x * pC + position.z * pS, position.y + abs(sin(uTime * 9.0 + aMeta.y * 40.0)) * 0.06, -position.x * pS + position.z * pC);
transformed.xz += pPos;`,
      )
      .replace("#include <color_vertex>", "#include <color_vertex>\nvColor.rgb *= mix(vec3(1.0), aShirt, aLit);");
  };
  people.customProgramCacheKey = () => "oldtown-people";

  // Castle flag: St George's cross rippling in the wind
  const flag = new MeshStandardMaterial({ vertexColors: true, side: DoubleSide, roughness: 0.7 });
  flag.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
float fw = clamp(position.x / 3.2, 0.0, 1.0);
transformed.z += sin(uTime * 6.0 - fw * 6.0) * 0.32 * fw;
transformed.y += sin(uTime * 4.0 - fw * 4.0) * 0.08 * fw;`,
      );
  };
  flag.customProgramCacheKey = () => "oldtown-flag";

  const iron = new MeshStandardMaterial({ color: "#1b1b1b", roughness: 0.6, metalness: 0.4 });

  return { solid, stone, windows, glow, pave, lawn, water, people, flag, iron };
}

export type OldTownMaterials = ReturnType<typeof makeMaterials>;
