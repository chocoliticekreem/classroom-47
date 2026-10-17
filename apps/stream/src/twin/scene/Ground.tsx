"use client";

export function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]} receiveShadow>
      <circleGeometry args={[5000, 64]} />
      <meshStandardMaterial color="#0a0c12" roughness={1} metalness={0} />
    </mesh>
  );
}
