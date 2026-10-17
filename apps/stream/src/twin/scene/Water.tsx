"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Ring } from "../config";
import { ATMOS } from "./palette";
import { useGeometry } from "./useGeometry";
import { ringToShape } from "./shapes";

const CALM = new THREE.Color("#0b1420");
const DAY = new THREE.Color("#1f86a8");
const RAINY = new THREE.Color("#06090e");

const SHORE_RES = 1024;
const SHORE_MAX_M = 48;

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
// same sky gradient Sky.tsx draws, animated normals, a sun/moon glint, sparse city-light glints and a shore-distance
// texture (deep mid-river, greener shallows, foam at the banks). Every detail layer is faded by the pixel footprint
// (fwidth), so nothing finer than a pixel ever reaches the output and the water cannot alias into moire.
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
uniform sampler2D uShore;
uniform vec4 uShoreRect;
varying vec3 vWorld;
#include <fog_pars_fragment>

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float fade(float k, float fp) {
  return 1.0 - smoothstep(0.3, 0.8, k * fp);
}

vec2 waveSlope(vec2 p, float t, float fp) {
  vec2 s = vec2(0.0);
  s += vec2(0.96, 0.28) * cos(dot(vec2(0.96, 0.28), p) * 0.28 + t * 0.8) * 0.098 * fade(0.28, fp);
  s += vec2(-0.5, 0.87) * cos(dot(vec2(-0.5, 0.87), p) * 0.51 + t * 1.1) * 0.102 * fade(0.51, fp);
  s += vec2(0.2, -0.98) * cos(dot(vec2(0.2, -0.98), p) * 1.1 + t * 1.6) * 0.11 * fade(1.1, fp);
  s += vec2(-0.85, -0.53) * cos(dot(vec2(-0.85, -0.53), p) * 2.3 + t * 2.2) * 0.115 * fade(2.3, fp);
  s += vec2(sin(p.x * 3.1 + t * 2.3 + sin(p.y * 2.7)), cos(p.y * 3.7 - t * 2.0 + sin(p.x * 2.2))) * 0.06 * fade(3.7, fp);
  return s;
}

void main() {
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  float fp = max(length(dFdx(vWorld.xz)), length(dFdy(vWorld.xz)));

  float shore = texture2D(uShore, (vWorld.xz - uShoreRect.xy) / uShoreRect.z).r * uShoreRect.w;

  vec2 s = waveSlope(vWorld.xz, uTime, fp) * mix(0.6, 1.3, uWet);
  vec3 N = normalize(vec3(-s.x, 1.0, -s.y));

  float cosT = clamp(dot(N, V), 0.0, 1.0);
  float fresnel = 0.08 + 0.92 * pow(1.0 - cosT, 5.0);

  vec3 R = reflect(-V, N);
  float h = clamp(R.y, 0.0, 1.0);
  vec3 sky = mix(uHorizon, uTop, pow(h, 0.45));
  sky += uGlow * 0.3 * exp(-h * 5.0);

  float deep = smoothstep(4.0, 42.0, shore);
  vec3 shallow = uBody * vec3(0.5, 0.75, 0.55) + uHorizon * 0.03;
  vec3 mid = uBody * vec3(0.15, 0.3, 0.34) + uHorizon * 0.02;
  vec3 body = mix(shallow, mid, deep) * (0.8 + 0.4 * max(dot(N, uSunDir), 0.0));
  vec3 col = mix(body, sky, fresnel);

  float cosSun = max(dot(R, uSunDir), 0.0);
  float streak = pow(cosSun, 360.0) * 5.0 + pow(cosSun, 50.0) * 0.5 + pow(cosSun, 8.0) * 0.04;
  col += uSunColor * streak * (1.0 - uCloud * 0.85) * (0.3 + 0.7 * fresnel);

  // Sparse glints: tiny cells, alive only while a cell is both lit and bigger than a pixel.
  float cell = 3.0;
  vec2 q = vWorld.xz / cell;
  vec2 f = fract(q) - 0.5;
  float seed = hash21(floor(q));
  float sparkleOn = step(0.93, hash21(floor(q) + floor(uTime * 1.5 + seed * 5.0)));
  float sparkle = sparkleOn * smoothstep(0.3, 0.0, length(f)) * (1.0 - smoothstep(0.1, 0.4, fp / cell));
  col += uSunColor * sparkle * pow(cosSun, 4.0) * 2.0 * (1.0 - uCloud);

  // Night: warm/cool lamp glints on the same footprint-faded cells, plus a soft far-field glow so distant water is not dead.
  vec2 lq = (vWorld.xz + N.xz * 10.0) / 6.0;
  vec2 lf = fract(lq) - 0.5;
  float lseed = hash21(floor(lq) + 17.0);
  float lamp = step(0.9, lseed) * smoothstep(0.4, 0.0, length(lf * vec2(1.0, 0.5))) * (1.0 - smoothstep(0.1, 0.35, fp / 6.0));
  vec3 lampCol = mix(vec3(1.0, 0.62, 0.3), vec3(0.55, 0.75, 1.0), step(0.6, fract(lseed * 7.0)));
  float twinkle = 0.6 + 0.4 * sin(uTime * 1.6 + lseed * 40.0);
  col += lampCol * lamp * twinkle * uLights * (0.5 + 1.5 * fresnel) * 1.4;
  float farGlow = 0.5 + 0.5 * sin(vWorld.x * 0.045 + uTime * 0.3) * sin(vWorld.z * 0.06 - uTime * 0.2);
  col += uGlow * uLights * 0.22 * fresnel * farGlow;

  // Soft foam fringe where the water meets the bank; hides the hard polygon edge.
  float wobble = 0.5 + 0.5 * sin(vWorld.x * 0.9 + uTime * 0.7) * sin(vWorld.z * 0.8 - uTime * 0.5);
  float foam = (1.0 - smoothstep(0.3, 2.2 + wobble * 1.8, shore)) * (0.5 + 0.5 * wobble);
  vec3 foamCol = uHorizon * 0.9 + vec3(0.1);
  col = mix(col, foamCol, foam * 0.8 * (1.0 - uWet * 0.4));

  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}`;

/** Rasterises the water rings and turns them into a distance-to-bank field (0 at the bank, 1 at SHORE_MAX_M). */
function buildShore(water: Ring[]) {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const ring of water) {
    for (const [x, z] of ring) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
  }
  const pad = 8;
  const size = Math.max(maxX - minX, maxZ - minZ) + pad * 2;
  const x0 = minX - pad;
  const z0 = minZ - pad;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SHORE_RES;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  for (const ring of water) {
    if (ring.length < 3) continue;
    ctx.beginPath();
    ring.forEach(([x, z], i) => {
      const px = ((x - x0) / size) * SHORE_RES;
      const py = ((z - z0) / size) * SHORE_RES;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fill();
  }
  const rgba = ctx.getImageData(0, 0, SHORE_RES, SHORE_RES).data;
  const dist = new Float32Array(SHORE_RES * SHORE_RES);
  for (let i = 0; i < dist.length; i++) dist[i] = rgba[i * 4] > 127 ? 1e6 : 0;
  const D = Math.SQRT2;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= SHORE_RES || y >= SHORE_RES ? 0 : dist[y * SHORE_RES + x]);
  for (let y = 0; y < SHORE_RES; y++) {
    for (let x = 0; x < SHORE_RES; x++) {
      const i = y * SHORE_RES + x;
      dist[i] = Math.min(dist[i], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + D, at(x + 1, y - 1) + D);
    }
  }
  for (let y = SHORE_RES - 1; y >= 0; y--) {
    for (let x = SHORE_RES - 1; x >= 0; x--) {
      const i = y * SHORE_RES + x;
      dist[i] = Math.min(dist[i], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + D, at(x - 1, y + 1) + D);
    }
  }
  const metresPerTexel = size / SHORE_RES;
  const data = new Uint8Array(dist.length);
  for (let i = 0; i < dist.length; i++) data[i] = Math.min(255, Math.round(((dist[i] * metresPerTexel) / SHORE_MAX_M) * 255));
  const texture = new THREE.DataTexture(data, SHORE_RES, SHORE_RES, THREE.RedFormat, THREE.UnsignedByteType);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return { texture, rect: new THREE.Vector4(x0, z0, size, SHORE_MAX_M) };
}

export function Water() {
  const { water } = useGeometry();
  const material = useRef<THREE.ShaderMaterial>(null);

  const shore = useMemo(() => buildShore(water.filter((ring) => ring.length >= 3)), [water]);
  useEffect(() => () => shore.texture.dispose(), [shore]);

  const uniforms = useMemo(
    () => ({
      ...THREE.UniformsUtils.merge([
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
          uShoreRect: { value: shore.rect },
        },
      ]),
      uShore: { value: shore.texture },
    }),
    [shore],
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
