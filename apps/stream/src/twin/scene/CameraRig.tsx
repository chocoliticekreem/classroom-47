"use client";

import { MapControls } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { MapControls as MapControlsImpl } from "three-stdlib";
import { PRESETS, useCameraStore } from "./cameraStore";

const goalPos = new THREE.Vector3();
const goalTarget = new THREE.Vector3();

export function CameraRig() {
  const controls = useRef<MapControlsImpl>(null);
  const flying = useRef(false);
  const flight = useCameraStore((s) => s.flight);
  const preset = useCameraStore((s) => s.preset);

  useEffect(() => {
    goalPos.set(...PRESETS[preset].pos);
    goalTarget.set(...PRESETS[preset].target);
    flying.current = true;
  }, [flight, preset]);

  useFrame(({ camera }, dt) => {
    const c = controls.current;
    if (!c || !flying.current) return;
    const k = 1 - Math.exp(-2.2 * Math.min(dt, 0.05));
    camera.position.lerp(goalPos, k);
    c.target.lerp(goalTarget, k);
    if (camera.position.distanceTo(goalPos) < 0.3 && c.target.distanceTo(goalTarget) < 0.3) {
      flying.current = false;
    }
  });

  return (
    <MapControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      maxPolarAngle={Math.PI / 2.05}
      minDistance={12}
      maxDistance={1800}
      onStart={() => {
        flying.current = false;
      }}
    />
  );
}
