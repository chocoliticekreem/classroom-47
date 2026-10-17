"use client";

import { STREAMER } from "./layout";

/** The IRL streamer on the bridge. */
export default function StreamerMarker() {
  return (
    <group position={[STREAMER.x, 0, STREAMER.z]}>
      <mesh position={[0, 2, 0]}>
        <cylinderGeometry args={[0.42, 0.42, 2.2, 14]} />
        <meshStandardMaterial color="#ec1187" roughness={0.45} metalness={0.05} />
      </mesh>
      <mesh position={[0, 1.3, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[3.55, 4, 48]} />
        <meshBasicMaterial color="#ffe14a" side={2} />
      </mesh>
      <mesh position={[0, 5.5, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 5, 8]} />
        <meshStandardMaterial color="#1c1c1c" roughness={0.55} />
      </mesh>
      <mesh position={[0, 8, 0]}>
        <sphereGeometry args={[0.28, 12, 10]} />
        <meshStandardMaterial color="#ffe14a" emissive="#ffe14a" emissiveIntensity={0.45} roughness={0.35} />
      </mesh>
    </group>
  );
}
