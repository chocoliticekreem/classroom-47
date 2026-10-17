"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { subscribe, type BusEvent } from "@/platform/bus";

type Suggested = Extract<BusEvent, { type: "route.suggested" }>;

const RIBBON_W = 2.2;
const GLOW_W = 9;
const Y = 0.12;

/** Draws the calmer route published on the bus as a glowing ember ribbon on the ground. */
export function RouteLine() {
  const [route, setRoute] = useState<Suggested | null>(null);
  const glow = useRef<THREE.Mesh>(null);

  useEffect(
    () =>
      subscribe((e) => {
        if (e.type === "route.suggested") setRoute(e);
      }),
    [],
  );

  const pieces = useMemo(() => {
    if (!route) return [];
    const out: { x: number; z: number; len: number; yaw: number }[] = [];
    for (let i = 1; i < route.xz.length; i++) {
      const [ax, az] = route.xz[i - 1];
      const [bx, bz] = route.xz[i];
      const dx = bx - ax;
      const dz = bz - az;
      const len = Math.hypot(dx, dz);
      if (len < 0.3) continue;
      out.push({ x: (ax + bx) / 2, z: (az + bz) / 2, len: len + RIBBON_W * 0.5, yaw: Math.atan2(dx, dz) });
    }
    return out;
  }, [route]);

  useFrame(({ clock }) => {
    if (!glow.current) return;
    const pulse = 0.5 + 0.5 * Math.sin(clock.elapsedTime * 2);
    glow.current.children.forEach((g) => {
      const mesh = g.children[0] as THREE.Mesh | undefined;
      if (mesh) (mesh.material as THREE.MeshBasicMaterial).opacity = 0.12 + pulse * 0.1;
    });
  });

  if (!route) return null;
  const end = route.xz.at(-1);
  return (
    <group>
      {pieces.map((p, i) => (
        <group key={i} position={[p.x, Y, p.z]} rotation={[0, p.yaw, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[RIBBON_W, p.len]} />
            <meshBasicMaterial color="#ff4d2e" transparent opacity={0.95} depthWrite={false} />
          </mesh>
        </group>
      ))}
      <group ref={glow}>
        {pieces.map((p, i) => (
          <group key={i} position={[p.x, Y - 0.04, p.z]} rotation={[0, p.yaw, 0]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[GLOW_W, p.len + GLOW_W * 0.5]} />
              <meshBasicMaterial color="#ff4d2e" transparent opacity={0.18} depthWrite={false} blending={THREE.AdditiveBlending} />
            </mesh>
          </group>
        ))}
      </group>
      {end && (
        <mesh position={[end[0], 1.5, end[1]]}>
          <cylinderGeometry args={[2.4, 2.4, 3, 24, 1, true]} />
          <meshBasicMaterial color="#ff4d2e" transparent opacity={0.5} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}
