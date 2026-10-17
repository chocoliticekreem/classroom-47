"use client";
// Two flocks of birds: boids-lite (seek a circling target + cohesion + separation + alignment), flapping wings.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { BufferAttribute, BufferGeometry, DoubleSide, InstancedMesh, MeshStandardMaterial, Object3D } from "three";
import { useWorld } from "../../store";
import { mulberry32 } from "./sim";

const PER_FLOCK = 18;
const FLOCKS = [
  { cx: -60, cz: -40, r: 90, y: 48, w: 0.11 },
  { cx: 110, cz: 90, r: 70, y: 64, w: -0.14 },
];
const N = PER_FLOCK * FLOCKS.length;
const MIN_SPEED = 9;
const MAX_SPEED = 15;

function wingGeometry(side: 1 | -1) {
  const g = new BufferGeometry();
  // triangle from the body out to the wing tip, swept back a little
  const v = new Float32Array([0, 0, 0.35, 0, 0, -0.3, side * 1.3, 0, -0.25]);
  g.setAttribute("position", new BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

export default function Birds() {
  const leftRef = useRef<InstancedMesh>(null);
  const rightRef = useRef<InstancedMesh>(null);
  const { left, right, mat } = useMemo(
    () => ({
      left: wingGeometry(1),
      right: wingGeometry(-1),
      mat: new MeshStandardMaterial({ color: "#2f2f3a", roughness: 0.9, side: DoubleSide }),
    }),
    [],
  );
  useEffect(
    () => () => {
      left.dispose();
      right.dispose();
      mat.dispose();
    },
    [left, right, mat],
  );

  const state = useRef<{ pos: Float32Array; vel: Float32Array; t: number } | null>(null);
  if (state.current === null) {
    const rand = mulberry32(2024);
    const pos = new Float32Array(N * 3);
    const vel = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const f = FLOCKS[Math.floor(i / PER_FLOCK)];
      pos[i * 3] = f.cx + f.r + (rand() - 0.5) * 12;
      pos[i * 3 + 1] = f.y + (rand() - 0.5) * 6;
      pos[i * 3 + 2] = f.cz + (rand() - 0.5) * 12;
      vel[i * 3 + 2] = 12 * Math.sign(f.w);
    }
    state.current = { pos, vel, t: 0 };
  }

  useFrame((_, delta) => {
    const s = state.current!;
    if (useWorld.getState().paused) return;
    const dt = Math.min(delta, 0.1);
    s.t += dt;
    const { pos, vel } = s;
    for (let f = 0; f < FLOCKS.length; f++) {
      const fl = FLOCKS[f];
      const a = s.t * fl.w + f * 2;
      const tx = fl.cx + Math.cos(a) * fl.r;
      const tz = fl.cz + Math.sin(a) * fl.r;
      const ty = fl.y + Math.sin(s.t * 0.3 + f) * 8;
      const start = f * PER_FLOCK;
      const end = start + PER_FLOCK;
      let mx = 0, my = 0, mz = 0, vx = 0, vy = 0, vz = 0;
      for (let i = start; i < end; i++) {
        mx += pos[i * 3]; my += pos[i * 3 + 1]; mz += pos[i * 3 + 2];
        vx += vel[i * 3]; vy += vel[i * 3 + 1]; vz += vel[i * 3 + 2];
      }
      mx /= PER_FLOCK; my /= PER_FLOCK; mz /= PER_FLOCK;
      vx /= PER_FLOCK; vy /= PER_FLOCK; vz /= PER_FLOCK;
      for (let i = start; i < end; i++) {
        const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
        let ax = (tx - px) * 0.25 + (mx - px) * 0.3 + (vx - vel[i * 3]) * 0.6;
        let ay = (ty - py) * 0.5 + (my - py) * 0.3 + (vy - vel[i * 3 + 1]) * 0.6;
        let az = (tz - pz) * 0.25 + (mz - pz) * 0.3 + (vz - vel[i * 3 + 2]) * 0.6;
        for (let j = start; j < end; j++) {
          if (j === i) continue;
          const dx = px - pos[j * 3], dy = py - pos[j * 3 + 1], dz = pz - pos[j * 3 + 2];
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < 16 && d2 > 1e-4) {
            const k = 40 / d2;
            ax += dx * k; ay += dy * k; az += dz * k;
          }
        }
        let nvx = vel[i * 3] + ax * dt;
        let nvy = vel[i * 3 + 1] + ay * dt;
        let nvz = vel[i * 3 + 2] + az * dt;
        const sp = Math.hypot(nvx, nvy, nvz) || 1;
        const clamped = Math.min(MAX_SPEED, Math.max(MIN_SPEED, sp));
        nvx *= clamped / sp; nvy *= (clamped / sp) * 0.5; nvz *= clamped / sp;
        vel[i * 3] = nvx; vel[i * 3 + 1] = nvy; vel[i * 3 + 2] = nvz;
        pos[i * 3] = px + nvx * dt;
        pos[i * 3 + 1] = py + nvy * dt;
        pos[i * 3 + 2] = pz + nvz * dt;
      }
    }
    const l = leftRef.current!;
    const r = rightRef.current!;
    for (let i = 0; i < N; i++) {
      const heading = Math.atan2(vel[i * 3], vel[i * 3 + 2]);
      const flap = Math.sin(s.t * 11 + i * 1.7) * 0.7 + 0.15;
      dummy.position.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      dummy.rotation.set(0, heading, flap, "YXZ");
      dummy.updateMatrix();
      l.setMatrixAt(i, dummy.matrix);
      dummy.rotation.set(0, heading, -flap, "YXZ");
      dummy.updateMatrix();
      r.setMatrixAt(i, dummy.matrix);
    }
    l.instanceMatrix.needsUpdate = true;
    r.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={leftRef} args={[left, mat, N]} frustumCulled={false} />
      <instancedMesh ref={rightRef} args={[right, mat, N]} frustumCulled={false} />
    </group>
  );
}

const dummy = new Object3D();
dummy.scale.setScalar(1.6);
