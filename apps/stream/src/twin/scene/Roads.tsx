"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Ring, TwinGeometry } from "../config";
import { useGeometry } from "./useGeometry";

type Kind = TwinGeometry["roads"][number]["kind"];

const STYLE: Record<Kind, { width: number; y: number; color: string; emissive: string; glow: number }> = {
  major: { width: 10, y: 0.3, color: "#1a1a20", emissive: "#5a3a1c", glow: 0.35 },
  minor: { width: 6, y: 0.25, color: "#15161c", emissive: "#3a2a18", glow: 0.25 },
  path: { width: 2.5, y: 0.2, color: "#121318", emissive: "#20201c", glow: 0.15 },
  rail: { width: 4, y: 0.35, color: "#1c1e24", emissive: "#2a3444", glow: 0.3 },
};

/** Flat ribbon along a polyline: two triangles per segment, no mitred joins (overlap is invisible at this width). */
function ribbon(line: Ring, width: number): THREE.BufferGeometry | null {
  if (line.length < 2) return null;
  const half = width / 2;
  const verts: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i];
    const [bx, bz] = line[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) continue;
    const nx = (-dz / len) * half;
    const nz = (dx / len) * half;
    const base = verts.length / 3;
    verts.push(ax + nx, 0, az + nz, ax - nx, 0, az - nz, bx + nx, 0, bz + nz, bx - nx, 0, bz - nz);
    idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  if (!idx.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export function Roads() {
  const { roads } = useGeometry();

  const layers = useMemo(() => {
    const byKind = new Map<Kind, THREE.BufferGeometry[]>();
    for (const road of roads) {
      const g = ribbon(road.line, STYLE[road.kind].width);
      if (!g) continue;
      const list = byKind.get(road.kind) ?? [];
      list.push(g);
      byKind.set(road.kind, list);
    }
    const majorGlow = roads
      .filter((r) => r.kind === "major")
      .map((r) => ribbon(r.line, 0.7))
      .filter((g): g is THREE.BufferGeometry => g !== null);
    return {
      kinds: [...byKind.entries()].map(([kind, parts]) => ({ kind, geometry: mergeGeometries(parts) })),
      glow: majorGlow.length ? mergeGeometries(majorGlow) : null,
    };
  }, [roads]);

  return (
    <>
      {layers.kinds.map(({ kind, geometry }) => (
        <mesh key={kind} geometry={geometry} position={[0, STYLE[kind].y, 0]}>
          <meshStandardMaterial
            color={STYLE[kind].color}
            emissive={STYLE[kind].emissive}
            emissiveIntensity={STYLE[kind].glow}
            roughness={0.95}
            polygonOffset
            polygonOffsetFactor={-1}
          />
        </mesh>
      ))}
      {layers.glow && (
        <mesh geometry={layers.glow} position={[0, 0.45, 0]}>
          <meshBasicMaterial color={new THREE.Color(2.4, 1.6, 0.9)} toneMapped={false} />
        </mesh>
      )}
    </>
  );
}
