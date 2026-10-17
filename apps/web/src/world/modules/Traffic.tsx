"use client";
// Module: Traffic. ~220 civilian vehicles (cars, estates, sports cars, black cabs, minibuses, vans, motorbikes, HGVs) driving the road
// graph on the left, obeying signals, queueing, and rerouting around closed roads.
// Logic lives in ./Traffic/ (driving.ts is pure + tested, sim.ts runs it and draws instances).
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useState } from "react";
import type { InstancedMesh } from "three";
import { useWorld } from "../store";
import { TrafficSim } from "./Traffic/sim";

export default function Traffic() {
  const [sim] = useState(() => new TrafficSim());

  useEffect(() => {
    sim.start();
    return () => sim.stop();
  }, [sim]);

  useEffect(() => () => sim.dispose(), [sim]);

  useFrame((state, delta) => sim.step(delta, state.camera));

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.instanceId === undefined) return;
    const id = sim.idAt(e.object as InstancedMesh, e.instanceId);
    if (!id) return;
    e.stopPropagation();
    useWorld.getState().select(id);
  };

  return (
    <group name="traffic">
      {sim.meshes.map((m) => (
        <primitive key={m.uuid} object={m} onClick={sim.paintMeshes.has(m) ? onClick : undefined} />
      ))}
    </group>
  );
}
