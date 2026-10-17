"use client";

import { CAMERAS } from "./layout";

function markerColor(cam: { approach?: string; bank?: string }): string {
  return cam.approach === "south" || cam.bank === "south" ? "#ff2d55" : "#7bdff2";
}

/** TfL JamCam poles. South bank or approach is pink; everything else is cyan. */
export default function JamCams() {
  return (
    <group>
      {CAMERAS.map((cam) => {
        const color = markerColor(cam);
        return (
          <group key={`${cam.x}:${cam.z}`}>
            <mesh position={[cam.x, 4, cam.z]}>
              <cylinderGeometry args={[0.35, 0.35, 8, 12]} />
              <meshStandardMaterial color={color} roughness={0.45} metalness={0.08} />
            </mesh>
            <mesh position={[cam.x, 8.5, cam.z]}>
              <sphereGeometry args={[0.5, 12, 10]} />
              <meshStandardMaterial color={color} roughness={0.4} metalness={0.12} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
