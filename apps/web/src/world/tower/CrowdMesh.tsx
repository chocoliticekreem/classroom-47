"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Color, InstancedMesh, Matrix4 } from "three";
import { useTower } from "./state";

const COLORS: Record<string, string> = {
  stream_sniper: "#ff1744",
  fan_swarm: "#ec1187",
  chaos_instigator: "#a855f7",
  reddit_local: "#00e5ff",
  local_commuter: "#f8fafc",
  tourist: "#fde047",
};

export default function CrowdMesh() {
  const mesh = useRef<InstancedMesh>(null);
  const dummy = useRef(new Matrix4());
  const color = useRef(new Color());

  useFrame((_, delta) => {
    useTower.getState().tick(Math.min(delta, 0.05));
    const sim = useTower.getState().sim;
    const live = sim.live;
    const fork = sim.fork;
    const total = live.length + (fork?.length ?? 0);
    const count = Math.min(240, total);
    const m = mesh.current;
    if (!m) return;
    for (let i = 0; i < count; i++) {
      const agent = i < live.length ? live[i]! : fork![i - live.length]!;
      dummy.current.makeTranslation(agent.x, 1.2, agent.z);
      m.setMatrixAt(i, dummy.current);
      color.current.set(COLORS[agent.archetype] ?? "#cccccc");
      m.setColorAt(i, color.current);
    }
    m.count = count;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, 240]} frustumCulled={false} castShadow={false}>
      <sphereGeometry args={[0.7, 8, 6]} />
      <meshStandardMaterial roughness={0.55} />
    </instancedMesh>
  );
}
