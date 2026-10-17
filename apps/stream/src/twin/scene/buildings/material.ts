import * as THREE from "three";
import { ATMOS } from "../palette";
import { BAY, SHOP_BAY_SCALE, STOREY } from "./massing";

/** Interior mapping is skipped beyond this camera distance; windows fall back to flat emissive. */
const INTERIOR_FADE_START = 170;
const INTERIOR_FADE_END = 250;

const uniforms = {
  uTwinGlow: { value: 1 },
  uTwinWet: { value: 0 },
  uTwinTime: { value: 0 },
  uTwinTop: { value: new THREE.Color() },
  uTwinHorizon: { value: new THREE.Color() },
  uTwinSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uTwinSunColor: { value: new THREE.Color() },
  uTwinSunDisc: { value: 0 },
};

const VERT_PARS = /* glsl */ `
attribute vec3 aTwin;
varying vec3 vTwinWorld;
varying vec3 vTwinNormal;
varying vec3 vTwinData;
varying vec2 vTwinUv;
`;

const VERT_BODY = /* glsl */ `
vTwinWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
vTwinNormal = normalize(mat3(modelMatrix) * objectNormal);
vTwinData = aTwin;
vTwinUv = uv;
`;

const FRAG_PARS = /* glsl */ `
varying vec3 vTwinWorld;
varying vec3 vTwinNormal;
varying vec3 vTwinData;
varying vec2 vTwinUv;
uniform float uTwinGlow;
uniform float uTwinWet;
uniform float uTwinTime;
uniform vec3 uTwinTop;
uniform vec3 uTwinHorizon;
uniform vec3 uTwinSunDir;
uniform vec3 uTwinSunColor;
uniform float uTwinSunDisc;

const float STOREY_M = ${STOREY.masonry.toFixed(2)};
const float STOREY_G = ${STOREY.glass.toFixed(2)};
const float BAY_M = ${BAY.masonry.toFixed(2)};
const float BAY_G = ${BAY.glass.toFixed(2)};
const float SHOP_SCALE = ${SHOP_BAY_SCALE.toFixed(4)};

float twHash(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}
`;

/**
 * Runs right after the vertex colour is applied. Style (aTwin.z): 0 solid, 1 masonry, 2 glass, 4 roof light,
 * 5 beacon, +0.5 shopfront. Window pane: fresnel sky reflection + a ray-vs-room-box interior.
 */
const FRAG_FACADE = /* glsl */ `
float twGlass = 0.0;
vec3 twEmit = vec3(0.0);
{
  float seed = vTwinData.x;
  float litRatio = vTwinData.y;
  float styleRaw = vTwinData.z;
  float style = floor(styleRaw + 0.01);
  float shop = step(0.25, fract(styleRaw));
  vec3 n = normalize(vTwinNormal);
  vec3 toFrag = vTwinWorld - cameraPosition;
  float dist = length(toFrag);
  vec3 vd = toFrag / dist;
  float y = vTwinWorld.y;
  float wall = 1.0 - smoothstep(0.35, 0.6, abs(n.y));
  float isGlass = step(1.5, style) * step(style, 2.5);
  float isMasonry = step(0.5, style) * step(style, 1.5);
  float hasWin = wall * step(0.5, style) * step(style, 2.5);

  float storey = mix(STOREY_M, STOREY_G, isGlass);
  float bay = mix(BAY_M, BAY_G, isGlass) * mix(1.0, SHOP_SCALE, shop);
  vec2 g = vec2(vTwinUv.x / bay, vTwinUv.y / storey);
  vec2 cell = floor(g);
  vec2 f = g - cell;
  vec2 fw = fwidth(g) + 1e-4;

  vec2 lo = mix(mix(vec2(0.2, 0.22), vec2(0.04, 0.06), isGlass), vec2(0.06, 0.08), shop);
  vec2 hi = mix(mix(vec2(0.8, 0.8), vec2(0.96, 0.88), isGlass), vec2(0.94, 0.86), shop);
  vec2 e0 = smoothstep(lo - fw, lo + fw, f);
  vec2 e1 = 1.0 - smoothstep(hi - fw, hi + fw, f);
  float inWin = e0.x * e0.y * e1.x * e1.y * hasWin;

  float r1 = twHash(vec3(cell, seed * 91.0));
  float r2 = twHash(vec3(cell + 7.0, seed));
  float r3 = twHash(vec3(cell + 13.0, seed * 3.7));
  float r4 = twHash(vec3(cell + 29.0, seed * 5.3));
  float floorRoll = twHash(vec3(cell.y, seed * 17.0, 3.0));
  float litFlag = step(mix(r1, floorRoll, 0.55 * isGlass), litRatio);
  float farK = smoothstep(0.35, 0.9, max(fw.x, fw.y));
  float litCell = mix(litFlag, litRatio, farK);

  vec3 warm = vec3(1.0, 0.72, 0.42);
  vec3 cool = vec3(0.62, 0.78, 1.0);
  vec3 lightCol = mix(warm, cool, step(0.68 - 0.3 * isGlass, r2));
  float strength = 1.4 + 1.8 * r3;
  float roomStrength = 1.0 + 1.4 * r3;

  vec3 refl = reflect(vd, n);
  vec3 sky = mix(uTwinHorizon, uTwinTop, pow(clamp(refl.y, 0.0, 1.0), 0.7));
  sky = mix(sky, uTwinHorizon * 0.25 + 0.01, smoothstep(0.0, -0.25, refl.y) * 0.8);
  float glint = pow(max(dot(refl, uTwinSunDir), 0.0), 120.0) * uTwinSunDisc;
  float ndv = clamp(dot(-vd, n), 0.0, 1.0);
  float f0 = mix(0.04, 0.16, isGlass);
  float fres = min(1.0, (f0 + (1.0 - f0) * pow(1.0 - ndv, 5.0)) * (1.0 + 0.7 * uTwinWet));
  float lowFade = mix(0.45, 1.0, smoothstep(2.0, 40.0, y));
  vec3 reflected = (mix(sky, vec3(dot(sky, vec3(0.33))), 0.5) * (0.75 + 0.5 * r3) * lowFade + glint * uTwinSunColor * 4.0) * fres;

  vec3 interior = lightCol * strength * 0.55 * uTwinGlow * litCell;
  float nearK = (1.0 - smoothstep(${INTERIOR_FADE_START.toFixed(1)}, ${INTERIOR_FADE_END.toFixed(1)}, dist)) * inWin;
  if (nearK > 0.01) {
    vec3 tangent = vec3(-n.z, 0.0, n.x);
    vec3 r = vec3(dot(toFrag, tangent), toFrag.y, dot(toFrag, -n));
    r /= max(r.z, 0.05);
    float depthM = 3.0 + 3.0 * r4;
    vec2 size = vec2(bay, storey);
    vec2 p = f * size;
    vec2 sgn = vec2(r.x < 0.0 ? -1.0 : 1.0, r.y < 0.0 ? -1.0 : 1.0);
    vec2 inv = sgn / (abs(r.xy) + 1e-4);
    vec2 tXY = max(-p * inv, (size - p) * inv);
    float tSide = min(tXY.x, tXY.y);
    float t = min(tSide, depthM);
    vec3 hit = vec3(p + r.xy * t, t);
    float isBack = step(depthM, tSide);
    float isSide = (1.0 - isBack) * step(tXY.x, tXY.y);
    float isFloorCeil = 1.0 - isBack - isSide;
    float isCeil = isFloorCeil * step(0.0, r.y);
    float isFloor = isFloorCeil - isCeil;

    vec3 paint = mix(vec3(0.9, 0.85, 0.75), vec3(0.55, 0.65, 0.8), step(0.6, r4)) * (0.7 + 0.3 * r3) * 0.55;
    vec3 surf = mix(paint, vec3(0.32, 0.22, 0.15), isFloor);
    vec2 bw = vec2(hit.x / size.x, hit.y / size.y);
    float furnW = 0.25 + 0.3 * r2;
    float furnX = 0.1 + (0.8 - furnW) * r3;
    float furn = step(furnX, bw.x) * step(bw.x, furnX + furnW) * step(bw.y, 0.18 + 0.14 * r4) * isBack;
    float table = step(abs(hit.x / size.x - furnX - furnW * 0.5), furnW * 0.5) * step(abs(hit.z / depthM - 0.5), 0.25) * isFloor;
    surf *= 1.0 - 0.7 * max(furn, table);
    float faceLight = isBack + 0.7 * isSide + 1.15 * isCeil + 0.55 * isFloor;
    surf *= faceLight * (1.0 - 0.65 * hit.z / depthM);

    float lamp = isCeil * (1.0 - smoothstep(0.0, 0.35, length(vec2(hit.x / size.x - 0.5, hit.z / depthM - 0.5))));
    float screen = step(0.82, r3) * isBack * step(0.55, bw.y) * step(bw.y, 0.75) * step(0.3, bw.x) * step(bw.x, 0.7);
    vec3 litRoom = (surf * mix(vec3(1.0), lightCol, 0.85) + lamp * lightCol * 0.9) * roomStrength * uTwinGlow + screen * cool * 2.2 * uTwinGlow;
    vec3 dayRoom = surf * mix(uTwinHorizon, vec3(0.5), 0.5) * 0.45 * (1.0 - uTwinGlow) + surf * vec3(0.012, 0.016, 0.03) * uTwinGlow;
    vec3 room = mix(dayRoom, litRoom, litFlag);

    float wy = (f.y - lo.y) / (hi.y - lo.y);
    float blind = step(0.78, r4) * step(1.0 - (0.3 + 0.7 * r3), wy);
    vec3 blindCol = mix(vec3(0.6, 0.58, 0.52) * uTwinHorizon * 0.45 * (1.0 - uTwinGlow), lightCol * strength * 0.5 * uTwinGlow, litFlag);
    room = mix(room, blindCol, blind);

    float reveal = smoothstep(0.0, 0.18, min(min(f.x - lo.x, hi.x - f.x) * bay, min(f.y - lo.y, hi.y - f.y) * storey));
    room *= mix(mix(0.35, 1.0, reveal), 1.0, 0.75 * isGlass);
    interior = mix(interior, room, 1.0 - farK);
    interior = mix(lightCol * strength * 0.55 * uTwinGlow * litCell, interior, 1.0 - smoothstep(${INTERIOR_FADE_START.toFixed(1)}, ${INTERIOR_FADE_END.toFixed(1)}, dist));
  }
  twEmit += (interior + reflected) * inWin;
  twEmit += reflected * (hasWin - inWin) * isGlass * 0.4;
  twEmit += sky * fres * uTwinWet * 0.35 * wall * (1.0 - hasWin);
  twGlass = inWin;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.012, 0.02, 0.032) + diffuseColor.rgb * 0.18 * isGlass, inWin);

  float brickV = vTwinUv.y / 0.225;
  float brickRow = floor(brickV);
  float brickU = vTwinUv.x / 0.215 + 0.5 * mod(brickRow, 2.0);
  float brickFade = (1.0 - smoothstep(0.2, 0.45, fwidth(brickV))) * isMasonry * wall * (1.0 - inWin);
  float mortar = smoothstep(0.93, 0.97, fract(brickV)) + smoothstep(0.95, 0.985, fract(brickU));
  float brickTone = twHash(vec3(floor(brickU), brickRow, seed * 11.0));
  diffuseColor.rgb *= 1.0 + brickFade * (0.14 * (brickTone - 0.5) - 0.22 * clamp(mortar, 0.0, 1.0));

  float rim = step(3.5, style) * step(style, 4.5);
  twEmit += vec3(0.55, 0.8, 1.6) * rim * 1.4 * uTwinGlow;
  float beacon = step(4.5, style);
  twEmit += vec3(3.0, 0.15, 0.1) * beacon * (0.3 + 0.7 * step(0.0, sin(uTwinTime * 2.4))) * (0.4 + 0.6 * uTwinGlow);

  diffuseColor.rgb *= mix(0.55, 1.0, smoothstep(0.0, 14.0, y));
  twEmit += vec3(0.5, 0.36, 0.22) * wall * (1.0 - smoothstep(0.0, 9.0, y)) * 0.14 * uTwinGlow;
  diffuseColor.rgb *= mix(0.94, 1.06, seed) * mix(1.0, 0.72, uTwinWet);
}
`;

export function makeFacadeMaterial() {
  const mat = new THREE.MeshStandardMaterial({
    color: "#ffffff",
    roughness: 0.85,
    metalness: 0,
    vertexColors: true,
  });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERT_PARS}`)
      .replace("#include <worldpos_vertex>", `#include <worldpos_vertex>\n${VERT_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAG_PARS}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${FRAG_FACADE}`)
      .replace(
        "#include <roughnessmap_fragment>",
        "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.1, twGlass) * mix(1.0, 0.5, uTwinWet);",
      )
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += twEmit;");
  };
  return mat;
}

/** Copies the live atmosphere into the facade shader; call once per frame. */
export function updateFacadeUniforms(time: number) {
  uniforms.uTwinGlow.value = ATMOS.windowGlow;
  uniforms.uTwinWet.value = ATMOS.wet;
  uniforms.uTwinTime.value = time;
  uniforms.uTwinTop.value.copy(ATMOS.skyTop);
  uniforms.uTwinHorizon.value.copy(ATMOS.skyHorizon);
  uniforms.uTwinSunDir.value.copy(ATMOS.sunDir);
  uniforms.uTwinSunColor.value.copy(ATMOS.sunColor);
  uniforms.uTwinSunDisc.value = ATMOS.sunDisc;
}
