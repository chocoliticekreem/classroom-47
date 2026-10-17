"use client";

/** Solid sky shell. side 1 is Three.js BackSide so the sphere is visible from inside. */
export default function SkyDome() {
  return (
    <mesh>
      <sphereGeometry args={[1800]} />
      <meshBasicMaterial color="#9ec9ef" side={1} />
    </mesh>
  );
}
