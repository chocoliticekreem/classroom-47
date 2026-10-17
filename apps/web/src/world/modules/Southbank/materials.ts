// Shared materials and GPU-animated shaders for Southbank. One `uTime` uniform drives every walker,
// the stadium crowd's Mexican wave, the lake shimmer and the pigeons: one uniform write per frame.
import * as THREE from "three";
import { GRIDS, type TexKind } from "./textures";

export const uTime = { value: 0 };

// Per-instance window UVs: tile the facade texture by the instance's real size (columns x floors) so
// windows keep their size on any box, and shift the pattern per building. Works for rotated instances.
const FACADE_UV = /* glsl */ `
#include <uv_vertex>
#ifdef USE_INSTANCING
{
  vec3 fScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  vec3 fPos = instanceMatrix[3].xyz;
  vec2 fFace = abs(normal.x) > 0.5 ? vec2(fScale.z, fScale.y) : vec2(fScale.x, fScale.y);
  float fCols = max(1.0, floor(fFace.x / uGrid.x + 0.5));
  float fFloors = max(1.0, floor(fFace.y / uGrid.y + 0.5));
  float fh = fract(sin(dot(fPos.xz + normal.xz * 3.7, vec2(12.9898, 78.233))) * 43758.5453);
  vec2 fOff = vec2(floor(fh * uGrid.z) / uGrid.z, floor(fract(fh * 7.13) * uGrid.w) / uGrid.w);
  vec2 fUv = uv * vec2(fCols / uGrid.z, fFloors / uGrid.w) + fOff;
  if (abs(normal.y) > 0.5) fUv = vec2(0.5 / (uGrid.z * 32.0), 0.5 / (uGrid.w * 32.0));
  #ifdef USE_MAP
  vMapUv = fUv;
  #endif
  #ifdef USE_EMISSIVEMAP
  vEmissiveMapUv = fUv;
  #endif
}
#endif
`;

export function facadeMaterial(kind: TexKind, map: THREE.Texture, emissive: THREE.Texture, roughness: number, metalness = 0) {
  const g = GRIDS[kind];
  const m = new THREE.MeshStandardMaterial({
    map,
    emissiveMap: emissive,
    emissive: new THREE.Color("#ffffff"),
    emissiveIntensity: 0,
    roughness,
    metalness,
    flatShading: true,
  });
  const grid = new THREE.Vector4(g.colW, g.floorH, g.nx, g.ny);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uGrid = { value: grid };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform vec4 uGrid;")
      .replace("#include <uv_vertex>", FACADE_UV);
  };
  m.customProgramCacheKey = () => "sb-facade";
  return m;
}

/** Stripe mask (map red channel) picks between cream and the instance colour. */
export function stripeMaterial(stripes: THREE.Texture) {
  const m = new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.85, flatShading: true });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#if defined( USE_COLOR )
  diffuseColor.rgb = mix(vec3(0.97, 0.94, 0.86), vColor.rgb, diffuseColor.r);
#endif`,
    );
  };
  m.customProgramCacheKey = () => "sb-stripe";
  return m;
}

// Vertex colour white = take the instance colour (clothes), otherwise keep the vertex colour (skin, legs).
const PICK_COLOR = /* glsl */ `
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR )
  vColor = vec4( 1.0 );
#endif
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
  vColor.rgb = color.rgb;
#endif
#ifdef USE_INSTANCING_COLOR
  if ( color.r > 0.99 && color.g > 0.99 && color.b > 0.99 ) vColor.rgb = instanceColor.rgb;
#endif
`;

/**
 * Walkers: the instance matrix is just the start point. Per-instance aWalk = (dirX, dirZ, len, speed),
 * aPhase. The shader walks there and back along dir, turns round at each end, and bobs.
 */
export function walkerMaterial() {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uTime;\nattribute vec4 aWalk;\nattribute float aPhase;",
      )
      .replace("#include <color_vertex>", PICK_COLOR)
      .replace(
        "#include <beginnormal_vertex>",
        /* glsl */ `
float wLen = max(aWalk.z, 0.001);
float wU = fract(uTime * aWalk.w / (2.0 * wLen) + aPhase);
float wS = wU < 0.5 ? wU * 2.0 : 2.0 - wU * 2.0;
vec2 wD = aWalk.xy * (wU < 0.5 ? 1.0 : -1.0);
vec3 objectNormal = vec3(normal.x * wD.y + normal.z * wD.x, normal.y, -normal.x * wD.x + normal.z * wD.y);
#ifdef USE_TANGENT
vec3 objectTangent = vec3( tangent.xyz );
#endif`,
      )
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `
float wBob = aWalk.w > 0.0 ? abs(sin(uTime * 7.0 + aPhase * 40.0)) * 0.08 : 0.0;
vec3 transformed = vec3(position.x * wD.y + position.z * wD.x, position.y + wBob, -position.x * wD.x + position.z * wD.y)
  + vec3(aWalk.x, 0.0, aWalk.y) * (wS * aWalk.z);`,
      );
  };
  m.customProgramCacheKey = () => "sb-walker";
  return m;
}

/** Stadium crowd: static specks that jump, with a Mexican wave running round the bowl (aPhase = angle). */
export function crowdMaterial() {
  const m = new THREE.MeshLambertMaterial();
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;\nattribute float aPhase;")
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `
vec3 transformed = vec3(position);
float cw = mod(uTime * 0.9, 6.2831853);
float cd = abs(mod(aPhase - cw + 3.14159265, 6.2831853) - 3.14159265);
float cJump = (1.0 - smoothstep(0.0, 0.45, cd)) * 1.4 + max(0.0, sin(uTime * 5.0 + aPhase * 97.0)) * 0.12;
transformed.y += cJump;
transformed.y *= 1.0 + (1.0 - smoothstep(0.0, 0.45, cd)) * 0.6;`,
      );
  };
  m.customProgramCacheKey = () => "sb-crowd";
  return m;
}

/** Lake water: gentle animated ripple shading. */
export function waterMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: "#3f7fa6", roughness: 0.15, metalness: 0.25, polygonOffset: true, polygonOffsetFactor: -1 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWPos;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;\nvarying vec3 vWPos;")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
float rp = sin(vWPos.x * 0.9 + uTime * 1.3) * sin(vWPos.z * 1.1 - uTime * 1.1);
diffuseColor.rgb += vec3(0.08, 0.1, 0.1) * smoothstep(0.55, 1.0, rp);`,
      );
  };
  m.customProgramCacheKey = () => "sb-water";
  return m;
}
