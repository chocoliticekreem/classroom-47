"use client";
// Module: Transit. London red double-deckers on routes 25, 73 and 390 (stops, shelters, passengers
// getting on and off; they obey signals, keep their distance and detour round closed roads), plus an
// elevated Underground-style metro (red and blue lines, stations with roundels, shuttling trains
// with sliding doors and platform crowds). Everything is instanced; logic lives in ./Transit/.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { createTransit } from "./Transit/engine";

export default function Transit() {
  const engine = useMemo(() => createTransit(), []);

  useEffect(() => engine.register(), [engine]);
  useEffect(() => () => engine.dispose(), [engine]);

  useFrame(({ camera }, delta) => engine.tick(delta, camera));

  return (
    <group name="Transit">
      {engine.meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </group>
  );
}
