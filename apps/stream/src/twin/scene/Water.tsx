"use client";

import { MeshReflectorMaterial } from "@react-three/drei";
import type { MeshReflectorMaterial as MeshReflectorMaterialImpl } from "@react-three/drei/materials/MeshReflectorMaterial";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { ATMOS } from "./palette";
import { useGeometry } from "./useGeometry";
import { ringToShape } from "./shapes";

const CALM = new THREE.Color("#0b1420");
const DAY = new THREE.Color("#2b4a66");
const RAINY = new THREE.Color("#06090e");

export function Water() {
  const { water } = useGeometry();
  const material = useRef<MeshReflectorMaterialImpl>(null);
  useFrame(() => {
    const m = material.current;
    if (!m) return;
    m.color.copy(CALM).lerp(DAY, ATMOS.windowGlow < 0.5 ? 1 - ATMOS.windowGlow : 0).lerp(RAINY, ATMOS.wet * 0.7);
    m.roughness = 0.55 - 0.3 * ATMOS.wet;
  });
  const geometry = useMemo(() => {
    const parts = water
      .filter((ring) => ring.length >= 3)
      .map((ring) => {
        return new THREE.ShapeGeometry(ringToShape(ring));
      });
    return parts.length ? mergeGeometries(parts) : null;
  }, [water]);
  if (!geometry) return null;
  // Why: MeshReflectorMaterial derives its mirror plane from the mesh's local +Z, so the
  // geometry stays in XY and the mesh itself is rotated flat.
  return (
    <mesh geometry={geometry} position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <MeshReflectorMaterial
        ref={material}
        resolution={1024}
        mirror={0.75}
        mixBlur={1}
        mixStrength={2.2}
        blur={[300, 80]}
        depthScale={0.6}
        minDepthThreshold={0.6}
        maxDepthThreshold={1.4}
        color="#0b1420"
        metalness={0.6}
        roughness={0.55}
        distortion={0.4}
      />
    </mesh>
  );
}
