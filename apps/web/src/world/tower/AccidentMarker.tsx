"use client";

import { ACCIDENT } from "./layout";

/** The crash on Tower Bridge Road. */
export default function AccidentMarker() {
  return (
    <group position={[ACCIDENT.x, 1.3, ACCIDENT.z]}>
      <mesh position={[-0.9, 0, 0.7]} rotation={[0.06, 0.38, 0.1]}>
        <boxGeometry args={[4, 1.4, 1.8]} />
        <meshStandardMaterial color="#c0392b" roughness={0.55} metalness={0.12} />
      </mesh>
      <mesh position={[1.0, 0, -0.6]} rotation={[-0.05, -0.62, -0.08]}>
        <boxGeometry args={[4, 1.4, 1.8]} />
        <meshStandardMaterial color="#ecf0f1" roughness={0.48} metalness={0.08} />
      </mesh>
      <mesh position={[0, 2.5, 0]} rotation={[0, 0.4, 0]}>
        <octahedronGeometry args={[0.75, 0]} />
        <meshStandardMaterial color="#ff8c00" emissive="#ff8c00" emissiveIntensity={0.4} roughness={0.4} />
      </mesh>
    </group>
  );
}
