"use client";

import { useMemo } from "react";
import { BufferAttribute, BufferGeometry, Float32BufferAttribute } from "three";
import { RIVER } from "./layout";

const Y = 0.4;

/**
 * Triangle strip along the centreline. Each point is offset by halfWidth on both
 * sides of the local perpendicular, so the ribbon is halfWidth * 2 wide.
 * Light tint only — the satellite already shows the Thames.
 */
function ribbon(centerline: readonly (readonly [number, number])[], halfWidth: number): BufferGeometry | null {
  const n = centerline.length;
  if (n < 2) return null;

  const pos = new Float32Array(n * 2 * 3);
  const idx = new Uint32Array((n - 1) * 6);
  for (let i = 0; i < n; i++) {
    const [x, z] = centerline[i];
    const prev = centerline[Math.max(0, i - 1)];
    const next = centerline[Math.min(n - 1, i + 1)];
    const dx = next[0] - prev[0];
    const dz = next[1] - prev[1];
    const len = Math.hypot(dx, dz) || 1;
    const ox = (-dz / len) * halfWidth;
    const oz = (dx / len) * halfWidth;
    const v = i * 6;
    pos[v] = x + ox;
    pos[v + 1] = Y;
    pos[v + 2] = z + oz;
    pos[v + 3] = x - ox;
    pos[v + 4] = Y;
    pos[v + 5] = z - oz;
    if (i === 0) continue;
    const b = i * 2;
    const k = (i - 1) * 6;
    idx[k] = b - 2;
    idx[k + 1] = b - 1;
    idx[k + 2] = b;
    idx[k + 3] = b - 1;
    idx[k + 4] = b + 1;
    idx[k + 5] = b;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(pos, 3));
  geometry.setIndex(new BufferAttribute(idx, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

export default function Water() {
  const { centerline, halfWidth } = RIVER;
  const geometry = useMemo(() => ribbon(centerline, halfWidth), [centerline, halfWidth]);
  if (!geometry) return null;
  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial color="#1a4c6e" transparent opacity={0.28} depthWrite={false} />
    </mesh>
  );
}
