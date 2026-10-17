"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { TwinGeometry } from "../config";
import { ATMOS } from "./palette";
import { useGeometry } from "./useGeometry";
import { ringToShape } from "./shapes";

type Building = TwinGeometry["buildings"][number];

const BANDS: { max: number; lit: number }[] = [
  { max: 25, lit: 0.1 },
  { max: 90, lit: 0.17 },
  { max: Infinity, lit: 0.34 },
];

function hash(n: number) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Extrude one footprint; vertex colour carries per-building data (seed, lit ratio, top height). */
function extrude(b: Building, index: number, lit: number): THREE.BufferGeometry | null {
  if (b.ring.length < 3) return null;
  const depth = Math.max(b.height - b.minHeight, 2);
  const geo = new THREE.ExtrudeGeometry(ringToShape(b.ring), { depth, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, b.minHeight, 0);
  const count = geo.attributes.position.count;
  const data = new Float32Array(count * 3);
  const seed = hash(index);
  for (let i = 0; i < count; i++) {
    data[i * 3] = seed;
    data[i * 3 + 1] = lit;
    data[i * 3 + 2] = b.height / 300;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(data, 3));
  geo.deleteAttribute("uv");
  return geo;
}

const VERT_PARS = /* glsl */ `
varying vec3 vTwinWorld;
varying vec3 vTwinNormal;
`;

const VERT_BODY = /* glsl */ `
vTwinWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
vTwinNormal = normalize(mat3(modelMatrix) * objectNormal);
`;

const FRAG_PARS = /* glsl */ `
varying vec3 vTwinWorld;
varying vec3 vTwinNormal;
uniform float uTwinGlow;
uniform float uTwinWet;
float twinHash(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}
`;

const FRAG_WINDOWS = /* glsl */ `
{
  float seed = vColor.r;
  float litRatio = vColor.g;
  float top = vColor.b * 300.0;
  vec3 n = normalize(vTwinNormal);
  float wall = 1.0 - smoothstep(0.3, 0.6, abs(n.y));
  vec2 tangent = normalize(vec2(-n.z, n.x) + 1e-4);
  float u = dot(vTwinWorld.xz, tangent) + seed * 37.0;
  float v = vTwinWorld.y;
  vec2 cell = floor(vec2(u / 2.6, v / 3.3));
  vec2 f = fract(vec2(u / 2.6, v / 3.3));
  float inWin = step(0.28, f.x) * step(f.x, 0.72) * step(0.34, f.y) * step(f.y, 0.74);
  float belowRoof = step(v, top - 1.2);
  float r = twinHash(vec3(cell, seed * 91.0));
  float lit = step(r, litRatio) * inWin * wall * belowRoof;
  float warmth = twinHash(vec3(cell + 7.0, seed));
  vec3 warm = vec3(1.0, 0.72, 0.42);
  vec3 cool = vec3(0.62, 0.78, 1.0);
  vec3 winColor = mix(warm, cool, step(0.68 - clamp(top / 400.0, 0.0, 0.4), warmth));
  float strength = 1.4 + 1.8 * twinHash(vec3(cell + 3.0, seed));
  totalEmissiveRadiance += winColor * lit * strength * uTwinGlow;

  float rim = wall * smoothstep(top - 0.9, top - 0.4, v) * step(v, top + 0.1);
  vec3 rimColor = top > 90.0 ? vec3(0.55, 0.8, 1.6) : vec3(0.5, 0.45, 0.4);
  totalEmissiveRadiance += rimColor * rim * (top > 90.0 ? 1.4 : 0.35) * uTwinGlow;

  float ao = mix(0.55, 1.0, smoothstep(0.0, 14.0, v));
  diffuseColor.rgb *= ao;
  float street = wall * (1.0 - smoothstep(0.0, 9.0, v));
  totalEmissiveRadiance += vec3(0.5, 0.36, 0.22) * street * 0.14 * uTwinGlow;
  diffuseColor.rgb *= mix(0.85, 1.15, seed) * mix(1.0, 0.72, uTwinWet);
  float crown = (1.0 - wall) * step(90.0, top);
  totalEmissiveRadiance += vec3(0.25, 0.4, 0.8) * crown * 0.35 * uTwinGlow;
}
`;

const glowUniform = { value: 1 };
const wetUniform = { value: 0 };

function makeMaterial() {
  const mat = new THREE.MeshStandardMaterial({
    color: "#1b2230",
    roughness: 0.85,
    metalness: 0.15,
    vertexColors: true,
    emissive: "#000000",
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTwinGlow = glowUniform;
    shader.uniforms.uTwinWet = wetUniform;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERT_PARS}`)
      .replace("#include <worldpos_vertex>", `#include <worldpos_vertex>\n${VERT_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAG_PARS}`)
      .replace("#include <color_fragment>", "")
      .replace(
        "#include <roughnessmap_fragment>",
        "#include <roughnessmap_fragment>\nroughnessFactor *= mix(1.0, 0.5, uTwinWet);",
      )
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n${FRAG_WINDOWS}`);
  };
  return mat;
}

export function Buildings() {
  const { buildings } = useGeometry();

  const geometries = useMemo(() => {
    const groups: THREE.BufferGeometry[][] = BANDS.map(() => []);
    buildings.forEach((b, i) => {
      const band = BANDS.findIndex((band) => b.height <= band.max);
      const g = extrude(b, i, BANDS[band].lit);
      if (g) groups[band].push(g);
    });
    return groups.filter((g) => g.length).map((g) => {
      const merged = mergeGeometries(g);
      g.forEach((part) => part.dispose());
      return merged;
    });
  }, [buildings]);

  const material = useMemo(() => makeMaterial(), []);

  useFrame(() => {
    glowUniform.value = ATMOS.windowGlow;
    wetUniform.value = ATMOS.wet;
  });

  useEffect(
    () => () => {
      geometries.forEach((g) => g.dispose());
      material.dispose();
    },
    [geometries, material],
  );

  return (
    <>
      {geometries.map((g, i) => (
        <mesh key={i} geometry={g} material={material} />
      ))}
    </>
  );
}
