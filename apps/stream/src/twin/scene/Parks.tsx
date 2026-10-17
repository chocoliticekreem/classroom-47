"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { useGeometry } from "./useGeometry";
import { ringToShape } from "./shapes";

export function Parks() {
  const { parks } = useGeometry();
  const geometry = useMemo(() => {
    const parts = parks.map((ring) => {
      const g = new THREE.ShapeGeometry(ringToShape(ring));
      g.rotateX(-Math.PI / 2);
      return g;
    });
    return parts.length ? mergeGeometries(parts) : null;
  }, [parks]);
  if (!geometry) return null;
  return (
    <mesh geometry={geometry} position={[0, 0.12, 0]}>
      <meshStandardMaterial color="#0c2416" roughness={1} emissive="#0a2a14" emissiveIntensity={0.25} />
    </mesh>
  );
}
