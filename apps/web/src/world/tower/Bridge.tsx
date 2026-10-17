"use client";

import { useMemo } from "react";
import { Line } from "@react-three/drei";
import { BufferGeometry, Float32BufferAttribute } from "three";
import { BRIDGE } from "./layout";

function ribbon(points: readonly [number, number][], width: number, y: number): BufferGeometry {
  const verts: number[] = [];
  const index: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)]!;
    const next = points[Math.min(points.length - 1, i + 1)]!;
    let dx = next[0] - prev[0];
    let dz = next[1] - prev[1];
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const px = -dz * (width / 2);
    const pz = dx * (width / 2);
    const [x, z] = points[i]!;
    verts.push(x + px, y, z + pz, x - px, y, z - pz);
  }
  for (let i = 0; i < points.length - 1; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(verts, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

export default function Bridge() {
  const deck = useMemo(() => ribbon(BRIDGE.points, 16, 1.4), []);
  const [nx, nz] = BRIDGE.towers.north;
  const [sx, sz] = BRIDGE.towers.south;
  const northTip = BRIDGE.points[0]!;
  const southTip = BRIDGE.points[BRIDGE.points.length - 1]!;
  return (
    <group>
      <mesh geometry={deck}>
        <meshStandardMaterial color="#2c3e50" roughness={0.62} metalness={0.08} />
      </mesh>
      <Tower x={nx} z={nz} />
      <Tower x={sx} z={sz} />
      <mesh
        position={[(nx + sx) / 2, 36, (nz + sz) / 2]}
        rotation={[0, Math.atan2(sx - nx, sz - nz), 0]}
      >
        <boxGeometry args={[4.2, 3.2, Math.hypot(sx - nx, sz - nz)]} />
        <meshStandardMaterial color="#e4dcc8" />
      </mesh>
      <Line points={[[nx, 58, nz], [northTip[0], 4, northTip[1]]]} color="#c5d0dc" lineWidth={2} />
      <Line points={[[sx, 58, sz], [southTip[0], 4, southTip[1]]]} color="#c5d0dc" lineWidth={2} />
      <Line points={[[nx, 58, nz], [sx, 58, sz]]} color="#c5d0dc" lineWidth={2} />
    </group>
  );
}

function Tower({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 21, 0]}>
        <boxGeometry args={[16, 42, 14]} />
        <meshStandardMaterial color="#e4dcc8" roughness={0.7} />
      </mesh>
      <mesh position={[0, 32, 0]}>
        <boxGeometry args={[16.4, 3, 14.4]} />
        <meshStandardMaterial color="#1f4e89" />
      </mesh>
      <mesh position={[0, 52, 0]}>
        <coneGeometry args={[8, 20, 4]} />
        <meshStandardMaterial color="#d9d0bc" />
      </mesh>
    </group>
  );
}
