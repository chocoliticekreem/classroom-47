"use client";

import { useTexture } from "@react-three/drei";
import { PATCH } from "./layout";

/** Satellite photo of the patch. flipY stays default so image north lands on minZ. */
export default function SatelliteGround() {
  const texture = useTexture("/tower-bridge-satellite.jpg");
  const { minX, maxX, minZ, maxZ } = PATCH;
  return (
    <mesh position={[(minX + maxX) / 2, 0, (minZ + maxZ) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[maxX - minX, maxZ - minZ]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}
