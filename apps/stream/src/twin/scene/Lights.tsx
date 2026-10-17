"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { ATMOS } from "./palette";

const SUN_DISTANCE = 1000;
const FILL_DUSK = new THREE.Color("#ffb070");
const FILL_DAY = new THREE.Color("#ffe8cc");

export function Lights() {
  const hemi = useRef<THREE.HemisphereLight>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  const fill = useRef<THREE.DirectionalLight>(null);

  useFrame(() => {
    const flash = ATMOS.lightning * 6;
    if (hemi.current) {
      hemi.current.color.copy(ATMOS.hemiSky);
      hemi.current.groundColor.copy(ATMOS.hemiGround);
      hemi.current.intensity = ATMOS.hemiIntensity + flash;
    }
    if (sun.current) {
      sun.current.position.copy(ATMOS.sunDir).multiplyScalar(SUN_DISTANCE);
      sun.current.color.copy(ATMOS.sunColor);
      sun.current.intensity = ATMOS.sunIntensity;
    }
    if (fill.current) {
      // The low sun is in front of the default cameras, so the faces they see are backlit; a daylight fill from behind lights them.
      fill.current.color.copy(FILL_DUSK).lerp(FILL_DAY, Math.min(ATMOS.sunIntensity / 4.2, 1));
      fill.current.intensity = 0.35 * (1 - ATMOS.cloud * 0.6) + 0.3 * ATMOS.sunIntensity * ATMOS.sunDisc;
    }
  });

  return (
    <>
      <hemisphereLight ref={hemi} args={["#4a5d96", "#141018", 2.4]} />
      <directionalLight ref={sun} position={[-600, 700, -500]} intensity={1.1} color="#8ea4d8" />
      <directionalLight ref={fill} position={[500, 300, 600]} intensity={0.35} color="#ffb070" />
    </>
  );
}
