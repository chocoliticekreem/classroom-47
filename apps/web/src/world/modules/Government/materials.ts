// Materials for the government quarter. A few shared uniforms drive everything: uTime (flags, police patrols,
// fountain) and uNight (floodlit facades, windows, lamps, signs), so per frame it's two uniform writes.
import { Color, DoubleSide, MeshStandardMaterial, Vector2, type Texture } from "three";
import { FLAG_DIR } from "./layout";

export interface Uniforms {
  uTime: { value: number };
  uNight: { value: number };
}

export const newUniforms = (): Uniforms => ({ uTime: { value: 0 }, uNight: { value: 0 } });

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

export function makeMaterials(U: Uniforms, flagAtlas: Texture, signAtlas: Texture) {
  const solid = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.82 });

  // White stone facades, floodlit from the ground at night (bright at the foot, fading up the walls)
  const facade = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.72 });
  facade.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = U.uNight;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vGovY;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGovY = position.y;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uNight;\nvarying float vGovY;")
      .replace(
        EMISSIVE_HOOK,
        `${EMISSIVE_HOOK}\ntotalEmissiveRadiance += vColor.rgb * vec3(1.0, 0.93, 0.8) * uNight * (0.16 + 0.62 * exp(-max(vGovY, 0.0) / 9.0));`,
      );
  };
  facade.customProgramCacheKey = () => "gov-facade";

  // Windows: per-vertex aLit says how brightly each one glows at night
  const windows = new MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.2 });
  windows.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = U.uNight;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aLit;\nvarying float vLit;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLit = aLit;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uNight;\nvarying float vLit;")
      .replace(EMISSIVE_HOOK, `${EMISSIVE_HOOK}\ntotalEmissiveRadiance += vec3(1.0, 0.8, 0.5) * vLit * uNight * 1.6;`);
  };
  windows.customProgramCacheKey = () => "gov-windows";

  // Lamps, lanterns, clock faces, helipad lights: the vertex colour is the light colour
  const glow = new MeshStandardMaterial({ vertexColors: true, color: new Color("#777777"), roughness: 0.4 });
  glow.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = U.uNight;
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uNight;")
      .replace(EMISSIVE_HOOK, `${EMISSIVE_HOOK}\ntotalEmissiveRadiance += vColor.rgb * (0.15 + uNight * 2.0);`);
  };
  glow.customProgramCacheKey = () => "gov-glow";

  // flat ground layers at y 0.006..0.016: above the meadow, below the roads (0.02+, which also pull forward)
  const ground = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  const water = new MeshStandardMaterial({ vertexColors: true, roughness: 0.12, metalness: 0.2 });

  // Signs: the atlas, glowing softly at night
  const signs = new MeshStandardMaterial({ map: signAtlas, roughness: 0.6 });
  signs.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = U.uNight;
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uNight;")
      .replace(EMISSIVE_HOOK, `${EMISSIVE_HOOK}\ntotalEmissiveRadiance += diffuseColor.rgb * uNight * 0.75;`);
  };
  signs.customProgramCacheKey = () => "gov-signs";

  // Flags: atlas-mapped cloth rippling downwind. aWave = (u along the flag 0..1, phase, flag width)
  const flags = new MeshStandardMaterial({ map: flagAtlas, side: DoubleSide, roughness: 0.75 });
  flags.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime;
    sh.uniforms.uNight = U.uNight;
    sh.uniforms.uFlagN = { value: new Vector2(-FLAG_DIR.z, FLAG_DIR.x) };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;\nuniform vec2 uFlagN;\nattribute vec3 aWave;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
float fu = aWave.x;
float fw = sin(uTime * 5.2 - fu * 7.0 + aWave.y) * 0.13 * aWave.z * fu + sin(uTime * 8.3 - fu * 11.0 + aWave.y * 1.7) * 0.04 * aWave.z * fu;
transformed.xz += uFlagN * fw;
transformed.y += sin(uTime * 3.1 - fu * 4.0 + aWave.y) * 0.05 * aWave.z * fu;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uNight;")
      .replace(EMISSIVE_HOOK, `${EMISSIVE_HOOK}\ntotalEmissiveRadiance += diffuseColor.rgb * uNight * 0.45;`);
  };
  flags.customProgramCacheKey = () => "gov-flags";

  // Armed police: instanced, but positions come from the shader. aSeg = beat a -> b (a == b: a fixed post),
  // aMeta = (walk speed, phase, facing for posts)
  const police = new MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  police.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;\nattribute vec4 aSeg;\nattribute vec3 aMeta;")
      .replace(
        "#include <beginnormal_vertex>",
        `float pLen = distance(aSeg.xy, aSeg.zw);
vec2 pPos = aSeg.xy;
float pAng = aMeta.z + sin(uTime * 0.25 + aMeta.y * 6.0) * 0.35;
float pBob = 0.0;
if (pLen > 0.01) {
  float pT = fract(aMeta.y + uTime * aMeta.x / (2.0 * pLen));
  float pU = smoothstep(0.0, 1.0, 1.0 - abs(2.0 * pT - 1.0));
  pPos = mix(aSeg.xy, aSeg.zw, pU);
  vec2 pDir = (aSeg.zw - aSeg.xy) * (pT < 0.5 ? 1.0 : -1.0);
  pAng = atan(pDir.x, pDir.y);
  pBob = abs(sin(uTime * 7.0 + aMeta.y * 40.0)) * 0.05;
}
float pC = cos(pAng);
float pS = sin(pAng);
vec3 objectNormal = vec3(normal.x * pC + normal.z * pS, normal.y, -normal.x * pS + normal.z * pC);
#ifdef USE_TANGENT
vec3 objectTangent = vec3(tangent.xyz);
#endif`,
      )
      .replace(
        "#include <begin_vertex>",
        `vec3 transformed = vec3(position.x * pC + position.z * pS, position.y + pBob, -position.x * pS + position.z * pC);
transformed.xz += pPos;`,
      );
  };
  police.customProgramCacheKey = () => "gov-police";

  // Fountain jets: translucent water columns that pulse
  const jet = new MeshStandardMaterial({ color: "#d9f1ff", roughness: 0.1, transparent: true, opacity: 0.72, depthWrite: false });
  jet.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime;
    sh.uniforms.uNight = U.uNight;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;\nattribute vec2 aJet;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
float jk = 0.8 + 0.2 * sin(uTime * 2.6 + aJet.y);
transformed.y = aJet.x + (transformed.y - aJet.x) * jk;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uNight;")
      .replace(EMISSIVE_HOOK, `${EMISSIVE_HOOK}\ntotalEmissiveRadiance += vec3(0.55, 0.75, 1.0) * uNight * 0.9;`);
  };
  jet.customProgramCacheKey = () => "gov-jet";

  const iron = new MeshStandardMaterial({ color: "#1b1b1b", roughness: 0.55, metalness: 0.4 });

  return { solid, facade, windows, glow, ground, water, signs, flags, police, jet, iron };
}

export type GovMaterials = ReturnType<typeof makeMaterials>;
