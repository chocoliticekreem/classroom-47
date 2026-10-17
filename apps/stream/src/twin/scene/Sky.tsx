"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { CITY_GLOW, FOG_FAR, FOG_NEAR, SKY_HORIZON, SKY_TOP } from "./palette";

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform vec2 uGlowDir;
uniform float uTime;
varying vec3 vDir;

float hash(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}

void main() {
  float h = clamp(vDir.y, -0.05, 1.0);
  float t = pow(max(h, 0.0), 0.45);
  vec3 col = mix(uHorizon, uTop, t);
  float toward = max(dot(normalize(vDir.xz), uGlowDir), 0.0);
  float lift = smoothstep(0.0, 0.1, h) * exp(-max(h, 0.0) * 5.0);
  float glow = pow(toward, 2.0) * lift;
  col += uGlow * glow * 0.8;
  col += vec3(0.05, 0.06, 0.12) * lift;
  vec3 cell = floor(vDir * 700.0);
  float star = step(0.9965, hash(cell));
  float d = length(fract(vDir * 700.0) - 0.5);
  star *= smoothstep(0.32, 0.12, d);
  float twinkle = 0.6 + 0.4 * sin(uTime * 1.7 + hash(cell + 1.0) * 6.283);
  col += vec3(0.8, 0.85, 1.0) * star * twinkle * smoothstep(0.08, 0.35, h) * 0.9;
  gl_FragColor = vec4(col, 1.0);
}`;

export function Sky() {
  const mesh = useRef<THREE.Mesh>(null);
  const material = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(
    () => ({
      uTop: { value: new THREE.Color(SKY_TOP) },
      uHorizon: { value: new THREE.Color(SKY_HORIZON) },
      uGlow: { value: new THREE.Color(CITY_GLOW) },
      uGlowDir: { value: new THREE.Vector2(-0.65, -0.76) },
      uTime: { value: 0 },
    }),
    [],
  );

  useFrame(({ camera, clock }) => {
    if (mesh.current) mesh.current.position.copy(camera.position);
    if (material.current) material.current.uniforms.uTime.value = clock.elapsedTime;
  });

  return (
    <>
      <fog attach="fog" args={[SKY_HORIZON, FOG_NEAR, FOG_FAR]} />
      <color attach="background" args={[SKY_HORIZON]} />
      <mesh ref={mesh} frustumCulled={false} renderOrder={-10}>
        <sphereGeometry args={[4500, 48, 24]} />
        <shaderMaterial
          ref={material}
          uniforms={uniforms}
          vertexShader={VERT}
          fragmentShader={FRAG}
          side={THREE.BackSide}
          depthWrite={false}
          fog={false}
        />
      </mesh>
    </>
  );
}
