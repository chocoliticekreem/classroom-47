// GPU crowd animation. Each instance's position along its looping path is computed in the vertex shader
// from uTime and a float texture of path samples; limbs swing by vertex deformation; facing comes from the
// path tangent. The CPU only advances uTime. Patched into MeshStandardMaterial (flat shading) so the crowd
// is lit like the rest of the city.
import { DataTexture, DoubleSide, FloatType, MeshStandardMaterial, NearestFilter, RGBAFormat, Vector2 } from "three";
import type { PackedPaths } from "./paths";

export type Variant = "person" | "umbrella" | "dog";

export interface CrowdUniforms {
  uTime: { value: number };
  uPathTex: { value: DataTexture };
  uHeadTex: { value: DataTexture };
  uFade: { value: Vector2 };
  [k: string]: { value: unknown };
}

function floatTex(data: Float32Array, w: number, h: number) {
  const t = new DataTexture(data, w, h, RGBAFormat, FloatType);
  t.minFilter = NearestFilter;
  t.magFilter = NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/** Shared uniforms for all crowd materials. Fade: people shrink away between x and y metres from the camera. */
export function crowdUniforms(p: PackedPaths, fadeNear = 620, fadeFar = 900): CrowdUniforms {
  return {
    uTime: { value: 0 },
    uPathTex: { value: floatTex(p.points, p.width, p.height) },
    uHeadTex: { value: floatTex(p.heads, p.headWidth, p.headHeight) },
    uFade: { value: new Vector2(fadeNear, fadeFar) },
  };
}

const COMMON = /* glsl */ `
uniform float uTime;
uniform highp sampler2D uPathTex;
uniform highp sampler2D uHeadTex;
uniform vec2 uFade;
attribute vec4 aWalk;
attribute vec4 aLook;
attribute vec4 aShirt;
attribute vec4 aPants;
attribute float aPart;
varying vec3 vCrowdColor;

vec2 crowdPt(float idx) {
  int w = textureSize(uPathTex, 0).x;
  int i = int(idx + 0.5);
  return texelFetch(uPathTex, ivec2(i % w, i / w), 0).xy;
}

// World xz, yaw (0 = +z), ground y and the distance walked so far.
void crowdPlace(out vec2 xz, out float yaw, out float baseY, out float walked) {
  if (aWalk.x < -0.5) { xz = aWalk.yz; yaw = aWalk.w; baseY = aLook.x; walked = 0.0; return; }
  int hw = textureSize(uHeadTex, 0).x;
  int pid = int(aWalk.x + 0.5);
  vec4 h = texelFetch(uHeadTex, ivec2(pid % hw, pid / hw), 0); // first texel, count, length, ground y
  float cnt = h.y;
  float L = h.z;
  float s = mod(aWalk.y + aWalk.z * uTime, L);
  float f = s / (L / cnt);
  float i0 = floor(f);
  float t = f - i0;
  i0 = mod(i0, cnt);
  float i1 = mod(i0 + 1.0, cnt);
  vec2 p0 = crowdPt(h.x + i0);
  vec2 p1 = crowdPt(h.x + i1);
  vec2 pa = crowdPt(h.x + mod(i0 - 1.0 + cnt, cnt));
  vec2 pb = crowdPt(h.x + mod(i0 + 2.0, cnt));
  vec2 d = mix(p1 - pa, pb - p0, t) * sign(aWalk.z); // smoothed tangent, flipped for walkers going backwards
  if (dot(d, d) < 1e-6) d = vec2(0.0, 1.0);
  d = normalize(d);
  xz = mix(p0, p1, t) + vec2(-d.y, d.x) * aLook.x;
  yaw = atan(d.x, d.y);
  baseY = h.w;
  walked = abs(aWalk.z) * uTime;
}

vec3 crowdRotX(vec3 p, float pivotY, float pivotZ, float a) {
  float c = cos(a), s = sin(a);
  vec2 q = vec2(p.y - pivotY, p.z - pivotZ);
  return vec3(p.x, pivotY + q.x * c - q.y * s, pivotZ + q.x * s + q.y * c);
}
`;

const PERSON = /* glsl */ `
vec3 crowdDeform(vec3 p, float walked) {
  float kind = aLook.y;
  float jog = step(0.5, kind) * step(kind, 1.5);
  float loiter = step(4.5, kind);
  float umb = step(1.5, kind) * step(kind, 2.5);
  float w = walked / mix(1.45, 2.3, jog) * 6.2831853 + aWalk.w;
  float sw = sin(w);
  float amp = mix(0.42, 0.85, jog) * (1.0 - loiter);
  float part = aPart;
  // legs
  if (part > 1.5 && part < 3.5) p = crowdRotX(p, 0.9, 0.0, sw * amp * (part < 2.5 ? 1.0 : -1.0));
  // arms swing opposite; umbrella holders raise the right arm; loiterers gesture now and then
  if (part > 3.5 && part < 5.5) {
    float side = part < 4.5 ? -1.0 : 1.0;
    float a = sw * amp * 0.9 * side;
    if (part > 4.5) a = mix(a, -0.75, umb);
    float talk = loiter * step(0.6, sin(uTime * 0.35 + aLook.w)) * (-0.5 - 0.35 * sin(uTime * 3.0 + aLook.w * 2.0));
    a += part > 4.5 ? talk : 0.0;
    a += jog * -0.5; // bent-ish, carried forward
    p = crowdRotX(p, 1.4, 0.0, a);
  }
  // head nods while chatting
  if ((part > 0.5 && part < 1.5) || part > 5.5) p = crowdRotX(p, 1.45, 0.0, loiter * 0.12 * sin(uTime * 1.7 + aLook.w));
  // forward lean for joggers, shift weight for loiterers
  p.z += p.y * (jog * 0.14);
  p.x += p.y * loiter * 0.03 * sin(uTime * 0.6 + aLook.w);
  // bob: two steps per stride
  p.y += abs(sw) * mix(0.05, 0.12, jog) * (1.0 - loiter);

  vec3 skin = mix(vec3(0.92, 0.66, 0.46), vec3(0.09, 0.04, 0.02), aShirt.w * aShirt.w);
  vec3 hair = mix(vec3(0.015, 0.012, 0.01), vec3(0.5, 0.28, 0.08), aPants.w * aPants.w);
  vCrowdColor = part < 0.5 || (part > 3.5 && part < 5.5) ? aShirt.rgb
              : part < 1.5 ? skin
              : part < 3.5 ? aPants.rgb
              : hair;
  return p;
}
`;

const UMBRELLA = /* glsl */ `
vec3 crowdDeform(vec3 p, float walked) {
  float w = walked / 1.45 * 6.2831853 + aWalk.w;
  p.y += abs(sin(w)) * 0.05;
  vCrowdColor = aPart < 0.5 ? aShirt.rgb : vec3(0.02);
  return p;
}
`;

const DOG = /* glsl */ `
vec3 crowdDeform(vec3 p, float walked) {
  float w = walked / 0.75 * 6.2831853 + aWalk.w;
  float sw = sin(w);
  if (aPart > 1.5) p.z += (0.26 - p.y) * sw * 0.9 * (aPart < 2.5 ? 1.0 : -1.0);
  p.y += abs(sw) * 0.03;
  if (aPart > 0.5 && aPart < 1.5) p.y += 0.02 * sin(w * 0.5);
  vCrowdColor = aPart > 0.5 && aPart < 1.5 ? aShirt.rgb * 0.8 : aShirt.rgb;
  return p;
}
`;

const PLACE = /* glsl */ `
  vec2 cXZ; float cYaw; float cBaseY; float cWalked;
  crowdPlace(cXZ, cYaw, cBaseY, cWalked);
  vec3 transformed = crowdDeform(vec3(position), cWalked);
  float cDist = distance(cameraPosition, vec3(cXZ.x, cBaseY, cXZ.y));
  transformed *= aLook.z * (1.0 - smoothstep(uFade.x, uFade.y, cDist));
  float cC = cos(cYaw), cS = sin(cYaw);
  transformed = vec3(transformed.x * cC + transformed.z * cS, transformed.y, -transformed.x * cS + transformed.z * cC);
  transformed += vec3(cXZ.x, cBaseY, cXZ.y);
`;

const BODY: Record<Variant, string> = { person: PERSON, umbrella: UMBRELLA, dog: DOG };

export function crowdMaterial(variant: Variant, uniforms: CrowdUniforms) {
  const m = new MeshStandardMaterial({ roughness: 0.85, metalness: 0, flatShading: true });
  if (variant === "umbrella") m.side = DoubleSide;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${COMMON}\n${BODY[variant]}`)
      .replace("#include <begin_vertex>", PLACE);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vCrowdColor;")
      .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= vCrowdColor;");
  };
  m.customProgramCacheKey = () => `crowd-${variant}`;
  return m;
}
