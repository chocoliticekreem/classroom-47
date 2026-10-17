"use client";

import { MeshReflectorMaterial } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { useGeometry } from "./useGeometry";
import { ringToShape } from "./shapes";

export function Water() {
  const { water } = useGeometry();
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
