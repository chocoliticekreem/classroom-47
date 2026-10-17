"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { ATMOS } from "./palette";
import { useGeometry } from "./useGeometry";
import { ringToShape } from "./shapes";

const CALM = new THREE.Color("#0b1420");
const DAY = new THREE.Color("#1f86a8");
const RAINY = new THREE.Color("#06090e");

const VERT = /* glsl */ `
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

// Why: no planar reflection pass. The river is one flat plane, so the mirror image is replaced by a fresnel mix of the
// same sky gradient Sky.tsx draws, animated normals, a sun/moon glint and hashed city-light sparkles. Costs one cheap draw.
const FRAG = /* glsl */ `
uniform vec3 uBody;
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uTime;
uniform float uWet;
uniform float uCloud;
uniform float uLights;
varying vec3 vWorld;
#include <fog_pars_fragment>

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// Why: each wave fades out once it is finer than a pixel, otherwise the fresnel term aliases into moire stripes.
vec2 waveSlope(vec2 p, float t, float detail, float dist) {
  float w2 = 1.0 - 0.8 * smoothstep(300.0, 900.0, dist);
  float w3 = 1.0 - smoothstep(80.0, 350.0, dist);
  float w4 = 1.0 - smoothstep(30.0, 140.0, dist);
  vec2 s = vec2(0.0);
  s += vec2(0.96, 0.28) * cos(dot(vec2(0.96, 0.28), p) * 0.28 + t * 0.8) * 0.098;
  s += vec2(-0.5, 0.87) * cos(dot(vec2(-0.5, 0.87), p) * 0.51 + t * 1.1) * 0.102 * w2;
  s += vec2(0.2, -0.98) * cos(dot(vec2(0.2, -0.98), p) * 1.1 + t * 1.6) * 0.11 * w3;
  s += vec2(-0.85, -0.53) * cos(dot(vec2(-0.85, -0.53), p) * 2.3 + t * 2.2) * 0.115 * w4;
  s += detail * w4 * vec2(sin(p.x * 3.1 + t * 2.3 + sin(p.y * 2.7)), cos(p.y * 3.7 - t * 2.0 + sin(p.x * 2.2)));
  return s;
}

void main() {
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;

  float detail = 0.05 + 0.12 * uWet;
  vec2 s = waveSlope(vWorld.xz, uTime, detail, dist) * mix(0.7, 1.4, uWet);
  vec3 N = normalize(vec3(-s.x, 1.0, -s.y));

  float cosT = clamp(dot(N, V), 0.0, 1.0);
  float fresnel = 0.16 + 0.84 * pow(1.0 - cosT, 4.0);

  vec3 R = reflect(-V, N);
  float h = clamp(R.y, 0.0, 1.0);
  vec3 sky = mix(uHorizon, uTop, pow(h, 0.45));
  sky += uGlow * 0.35 * exp(-h * 5.0);

  vec3 body = (uBody * 0.5 + uHorizon * 0.04) * (0.75 + 0.5 * max(dot(N, uSunDir), 0.0));
  vec3 col = mix(body, sky, fresnel);

  float cosSun = max(dot(R, uSunDir), 0.0);
  float glint = pow(cosSun, 1400.0) * 20.0 + pow(cosSun, 180.0) * 1.5 + pow(cosSun, 18.0) * 0.12;
  col += uSunColor * glint * (1.0 - uCloud * 0.8) * (0.4 + 0.6 * fresnel);

  vec2 q = (vWorld.xz + N.xz * 14.0) / 7.0;
  vec2 id = floor(q);
  vec2 f = fract(q) - 0.5;
  float seed = hash21(id);
  float spot = smoothstep(0.5, 0.0, length(f * vec2(1.0, 0.45)));
  float twinkle = 0.6 + 0.4 * sin(uTime * 1.6 + seed * 40.0);
  vec3 lamp = mix(vec3(1.0, 0.62, 0.3), vec3(0.55, 0.75, 1.0), step(0.6, fract(seed * 7.0)));
  float reach = 1.0 - smoothstep(600.0, 1400.0, dist);
  col += lamp * step(0.8, seed) * spot * spot * twinkle * uLights * (0.4 + 1.6 * fresnel) * 1.6 * reach;

  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}`;

export function Water() {
  const { water } = useGeometry();
  const material = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(
    () =>
      THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uBody: { value: new THREE.Color(CALM) },
          uTop: { value: new THREE.Color() },
          uHorizon: { value: new THREE.Color() },
          uGlow: { value: new THREE.Color() },
          uSunDir: { value: new THREE.Vector3(0, 1, 0) },
          uSunColor: { value: new THREE.Color() },
          uTime: { value: 0 },
          uWet: { value: 0 },
          uCloud: { value: 0 },
          uLights: { value: 1 },
        },
      ]),
    [],
  );

  useFrame(({ clock }) => {
    const m = material.current;
    if (!m) return;
    const u = m.uniforms;
    u.uBody.value
      .copy(CALM)
      .lerp(DAY, ATMOS.windowGlow < 0.5 ? 1 - ATMOS.windowGlow : 0)
      .lerp(RAINY, ATMOS.wet * 0.7);
    u.uTop.value.copy(ATMOS.skyTop);
    u.uHorizon.value.copy(ATMOS.skyHorizon);
    u.uGlow.value.copy(ATMOS.glow);
    u.uSunDir.value.copy(ATMOS.sunDir);
    u.uSunColor.value.copy(ATMOS.sunColor);
    u.uTime.value = clock.elapsedTime;
    u.uWet.value = ATMOS.wet;
    u.uCloud.value = ATMOS.cloud;
    u.uLights.value = ATMOS.windowGlow;
  });

  const geometry = useMemo(() => {
    const parts = water
      .filter((ring) => ring.length >= 3)
      .map((ring) => {
        const g = new THREE.ShapeGeometry(ringToShape(ring));
        g.rotateX(-Math.PI / 2);
        return g;
      });
    return parts.length ? mergeGeometries(parts) : null;
  }, [water]);
  useEffect(() => () => geometry?.dispose(), [geometry]);

  if (!geometry) return null;
  return (
    <mesh geometry={geometry} position={[0, 0.08, 0]}>
      <shaderMaterial ref={material} uniforms={uniforms} vertexShader={VERT} fragmentShader={FRAG} fog />
    </mesh>
  );
}
