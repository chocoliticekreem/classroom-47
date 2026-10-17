"use client";
// Module: CameraRig. MapControls + follow/chase, eased fly-to focus, hotkeys, cinematic tour, crash shake.
// The imperative logic lives in CameraRig/director.ts; pure helpers + HOTKEYS in CameraRig/logic.ts.
import { MapControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useState, type ComponentRef } from "react";
import { CameraDirector } from "./CameraRig/director";
import { CONTROL_TUNING, MAX_DIST, MAX_POLAR, MIN_DIST } from "./CameraRig/logic";

export { HOTKEYS } from "./CameraRig/logic";
export { cameraRigStatus } from "./CameraRig/director";

type Controls = ComponentRef<typeof MapControls>;

export default function CameraRig() {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const [director] = useState(() => new CameraDirector());
  const [controls, setControls] = useState<Controls | null>(null);

  useEffect(() => {
    if (!controls) return;
    director.bind(camera, controls);
    director.intro();
    return director.attach(gl.domElement);
  }, [director, camera, controls, gl]);

  useFrame((_, delta) => director.frame(delta));

  return (
    <MapControls
      ref={setControls}
      makeDefault
      enableDamping
      dampingFactor={CONTROL_TUNING.dampingFactor}
      panSpeed={CONTROL_TUNING.panSpeed}
      rotateSpeed={CONTROL_TUNING.rotateSpeed}
      zoomSpeed={CONTROL_TUNING.zoomSpeed}
      // Wheel/pinch zoom is done by the director (delta-proportional, eased, blocks browser pinch-zoom).
      enableZoom={false}
      minDistance={MIN_DIST}
      maxDistance={MAX_DIST}
      maxPolarAngle={MAX_POLAR}
      screenSpacePanning={false}
      onStart={() => director.userInput()}
    />
  );
}
