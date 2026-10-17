"use client";
// Airport fire service vehicles: two crash tenders and an ambulance, registered in the shared vehicle registry
// (kinds "fire" / "ambulance") so the minimap, camera and traffic can see them. Blue lights flash on a call.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { registerVehicle, type VehicleEntry } from "../../registry";
import { edgeKey } from "../../roads";
import { useWorld } from "../../store";
import { ambulanceGeometry, tenderGeometry } from "./geometry";
import { nightFactor } from "./layout";
import type { AirportSim } from "./sim";

const m4 = new THREE.Matrix4();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const BAR: Record<"fire" | "ambulance", [number, number, number][]> = {
  fire: [
    [0.85, 3.45, 4.7],
    [-0.85, 3.45, 4.7],
  ],
  ambulance: [
    [0.75, 2.95, 1.9],
    [-0.75, 2.95, 1.9],
  ],
};

export default function Crew({ sim }: { sim: AirportSim }) {
  const crew = sim.crew;
  const groups = useRef<(THREE.Group | null)[]>([]);
  const barsRef = useRef<THREE.InstancedMesh>(null);

  const built = useMemo(
    () => ({
      tender: tenderGeometry(),
      ambulance: ambulanceGeometry(),
      mat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, flatShading: true }),
      bar: new THREE.BoxGeometry(0.55, 0.25, 0.4),
      barMat: new THREE.MeshBasicMaterial({ toneMapped: false }),
    }),
    [],
  );

  useEffect(() => {
    const offs = crew.map((u, i) => {
      const g = groups.current[i];
      if (!g) return () => {};
      const entry: VehicleEntry = {
        id: u.id,
        kind: u.kind,
        object: g,
        edgeKey: null,
        from: null,
        to: null,
        t: 0,
        speed: 0,
        stopped: true,
      };
      g.userData.entry = entry;
      return registerVehicle(entry);
    });
    const bars = barsRef.current;
    if (bars) {
      for (let i = 0; i < bars.count; i++) bars.setColorAt(i, new THREE.Color(i % 2 ? "#ff2a2a" : "#2a6bff"));
      if (bars.instanceColor) bars.instanceColor.needsUpdate = true;
    }
    return () => {
      for (const off of offs) off();
      built.tender.dispose();
      built.ambulance.dispose();
      built.bar.dispose();
      built.mat.dispose();
      built.barMat.dispose();
    };
  }, [crew, built]);

  useFrame(() => {
    const t = performance.now() / 1000;
    const night = nightFactor(useWorld.getState().timeOfDay);
    built.barMat.color.setScalar(1.5 + night * 2.5);
    const bars = barsRef.current;
    crew.forEach((u, i) => {
      const g = groups.current[i];
      if (!g) return;
      g.position.set(u.x, 0, u.z);
      g.rotation.y = u.yaw;
      g.updateMatrix();
      const entry = g.userData.entry as VehicleEntry | undefined;
      if (entry) {
        entry.from = u.from;
        entry.to = u.to;
        entry.edgeKey = u.from && u.to ? edgeKey(u.from, u.to) : null;
        entry.t = u.t;
        entry.speed = u.speed;
        entry.stopped = u.speed < 0.2;
      }
      if (!bars) return;
      const active = u.state === "out" || u.state === "onscene";
      BAR[u.kind].forEach(([x, y, z], j) => {
        const on = active && Math.sin(t * 14 + j * Math.PI + i) > 0.2;
        if (!on) bars.setMatrixAt(i * 2 + j, ZERO);
        else bars.setMatrixAt(i * 2 + j, m4.makeTranslation(x, y, z).premultiply(g.matrix));
      });
    });
    if (bars) bars.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      {crew.map((u, i) => (
        <group
          key={u.id}
          ref={(el) => {
            groups.current[i] = el;
          }}
          position={[u.x, 0, u.z]}
          rotation={[0, u.yaw, 0]}
        >
          <mesh geometry={u.kind === "fire" ? built.tender : built.ambulance} material={built.mat} castShadow />
        </group>
      ))}
      <instancedMesh ref={barsRef} args={[built.bar, built.barMat, crew.length * 2]} frustumCulled={false} />
    </group>
  );
}
