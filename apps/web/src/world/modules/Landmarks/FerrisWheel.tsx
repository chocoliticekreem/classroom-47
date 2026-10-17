"use client";
// London-Eye-style observation wheel, cell (140, 20). ~46 m across including capsules.
// The wheel faces south (towards the default camera); an A-frame holds it from the north side.
// Rim + spokes rotate as one baked mesh; the 32 capsules are instanced and stay upright.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { type Group, type InstancedMesh, Matrix4 } from "three";
import { useWorld } from "../../store";
import { Baked } from "./Baked";
import { Kit, type Kits } from "./kit";
import type { LandmarkMaterials } from "./materials";
import { lamp, tree } from "./props";

const R = 20; // outer rim radius
const HUB_Y = 24.2;
const CAP_R = R + 1.7; // capsule centre radius
const N = 32;
const SPEED = 0.045; // rad/s, about one turn every 2.3 minutes
const WHITE = "#f2f4f6";
const STEEL = "#c9ced4";
const ORANGE = "#ff6a1a";

/** Static parts: plaza, A-frame legs, axle, boarding pier, kiosk. */
export function buildStatic(k: Kits) {
  const s = k.solid;
  s.slab(-13.6, 13.6, 0, 0.14, -13.6, 13.6, "#d9d2c3");
  for (let i = -13; i <= 13; i += 2.6) s.slab(i - 0.04, i + 0.04, 0.14, 0.15, -13.6, 13.6, "#c8bfae");
  // A-frame behind the wheel (north, -z), leaning back to ground anchors
  const hub: [number, number, number] = [0, HUB_Y, -2.6];
  for (const x of [-9, 9]) {
    s.beam([x, 0, -12.2], hub, 0.75, WHITE, 8);
    s.cyl(1.4, 1.6, 0.8, 8, [x, 0.4, -12.2], "#a9adb2");
  }
  s.beam([-6.3, 7.3, -9.6], [6.3, 7.3, -9.6], 0.35, WHITE);
  s.beam([-3.6, 14.6, -6.9], [3.6, 14.6, -6.9], 0.3, WHITE);
  // back-stay cables
  for (const x of [-3, 3]) s.beam([x, 0.2, -13.2], [0, HUB_Y - 0.5, -2.8], 0.07, "#6b7178", 4);
  // axle + hub
  s.cyl(0.9, 0.9, 6.0, 12, [0, HUB_Y, 0], STEEL, [Math.PI / 2, 0, 0]);
  s.cyl(1.4, 1.4, 1.0, 10, [0, HUB_Y, -2.6], "#9aa0a6", [Math.PI / 2, 0, 0]);
  // boarding pier under the bottom of the wheel
  const py = HUB_Y - CAP_R - 1.25; // floor level of the lowest capsule
  s.slab(-6.5, 6.5, 0, Math.max(0.6, py), 2.2, 6.2, "#b5b9be");
  s.slab(-6.5, 6.5, py, py + 0.12, 2.0, 6.4, "#8d6a48");
  for (const x of [-6.2, 6.2]) s.slab(x - 0.06, x + 0.06, py, py + 1.1, 2.0, 6.4, "#30363b");
  s.slab(-6.5, 6.5, py + 1.0, py + 1.08, 6.34, 6.42, "#30363b");
  for (let i = 0; i < 4; i++) s.slab(-2, 2, 0, 0.18 * (i + 1), 6.4 + i * 0.5, 6.9 + i * 0.5, "#c8ccd0");
  // canopy over the pier, Hamyway orange
  for (const x of [-6, 6]) for (const z of [2.4, 6.0]) s.cyl(0.1, 0.1, 3.2, 6, [x, py + 1.6, z], "#30363b");
  s.slab(-6.6, 6.6, py + 3.2, py + 3.45, 1.8, 6.6, ORANGE);
  s.slab(-6.6, 6.6, py + 3.0, py + 4.1, 6.6, 6.7, ORANGE);
  // ticket kiosk + queue barriers
  s.slab(7.5, 11.5, 0.14, 3.0, 8.5, 11.5, WHITE);
  s.slab(7.4, 11.6, 3.0, 3.4, 8.4, 11.6, ORANGE);
  k.glass.slab(8.0, 11.0, 1.1, 2.4, 8.44, 8.52, "#2b4f86");
  for (let i = 0; i < 4; i++) s.slab(-5, 5, 0.9, 0.96, 8.5 + i * 1.1, 8.56 + i * 1.1, "#2a2d33");
  for (let i = 0; i < 4; i++) for (const x of [-5, 0, 5]) s.cyl(0.05, 0.05, 0.95, 5, [x, 0.6, 8.53 + i * 1.1], "#2a2d33");
  // planters, trees, lamps
  for (const x of [-11.5, 11.5]) for (const z of [-4, 4.5]) {
    s.slab(x - 1.2, x + 1.2, 0.14, 0.7, z - 1.2, z + 1.2, "#bdb6a6");
    tree(k, x, z, 0.7, Math.abs(x + z) | 0, 0.7);
  }
  for (const [x, z] of [[-8, 12.2], [0, 12.2], [8, 12.2], [-12.4, 10], [12.4, 0]]) lamp(k, x, z, 0.14, 4);
}

/** Rotating parts: rims, truss, spokes and the Hamyway-orange light ring. */
export function buildWheel(k: Kits) {
  const s = k.solid;
  const PI2 = Math.PI * 2;
  s.torus(R, 0.38, 6, 96, [0, 0, 0], WHITE);
  for (const z of [-1.1, 1.1]) s.torus(R - 1.7, 0.2, 5, 96, [0, 0, z], WHITE);
  for (let i = 0; i < N; i++) {
    const a = (i / N) * PI2;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    const o: [number, number, number] = [c * R, sn * R, 0];
    const f: [number, number, number] = [c * (R - 1.7), sn * (R - 1.7), 1.1];
    const b: [number, number, number] = [c * (R - 1.7), sn * (R - 1.7), -1.1];
    s.beam(o, f, 0.1, WHITE, 4);
    s.beam(o, b, 0.1, WHITE, 4);
    s.beam(f, b, 0.1, WHITE, 4);
    // capsule mounting ring stub
    s.beam(o, [c * (R + 0.6), sn * (R + 0.6), 0], 0.14, STEEL, 4);
    // tension spokes to both inner rims, alternating hub ends
    const z = i % 2 ? 2.6 : -2.6;
    s.beam([0, 0, z], i % 2 ? f : b, 0.045, "#dfe3e7", 3);
    // a diagonal between neighbours on the inner rims
    const a2 = ((i + 1) / N) * PI2;
    s.beam(f, [Math.cos(a2) * (R - 1.7), Math.sin(a2) * (R - 1.7), -1.1], 0.06, WHITE, 3);
  }
  for (const z of [-2.6, 2.6]) s.cyl(1.6, 1.6, 0.5, 16, [0, 0, z], STEEL, [Math.PI / 2, 0, 0]);
  // light ring on the outer rim face (glows at night)
  k.glow.torus(R + 0.05, 0.13, 4, 128, [0, 0, 0.42], ORANGE);
  k.glow.torus(R + 0.05, 0.13, 4, 128, [0, 0, -0.42], ORANGE);
}

function capsuleShell() {
  const k = new Kit();
  k.slab(-1.3, 1.3, -1.25, -1.0, -2.0, 2.0, "#e9ecef");
  k.torus(1.2, 0.1, 4, 14, [0, 0, -1.6], WHITE);
  k.torus(1.2, 0.1, 4, 14, [0, 0, 1.6], WHITE);
  k.torus(1.25, 0.12, 4, 16, [0, 0, 0], STEEL);
  k.sphere(0.35, 6, 4, [0, 1.2, 0], STEEL);
  return k.build()!;
}

function capsuleGlass() {
  const k = new Kit();
  k.sphere(1, 10, 6, [0, 0, 0], "#bfe2f5", [1.2, 1.05, 2.0]);
  return k.build()!;
}

const _m = new Matrix4();

export function FerrisWheel({ mats }: { mats: LandmarkMaterials }) {
  const wheel = useRef<Group>(null);
  const shells = useRef<InstancedMesh>(null);
  const glass = useRef<InstancedMesh>(null);
  const angle = useRef(0);
  const geos = useMemo(() => ({ shell: capsuleShell(), glass: capsuleGlass() }), []);
  useEffect(
    () => () => {
      geos.shell.dispose();
      geos.glass.dispose();
    },
    [geos],
  );

  useFrame((_, delta) => {
    if (!useWorld.getState().paused) angle.current += Math.min(delta, 0.1) * SPEED;
    const a0 = angle.current;
    if (wheel.current) wheel.current.rotation.z = a0;
    const sh = shells.current;
    const gl = glass.current;
    if (!sh || !gl) return;
    for (let i = 0; i < N; i++) {
      const a = a0 + (i / N) * Math.PI * 2;
      _m.makeTranslation(Math.cos(a) * CAP_R, HUB_Y + Math.sin(a) * CAP_R, 0);
      sh.setMatrixAt(i, _m);
      gl.setMatrixAt(i, _m);
    }
    sh.instanceMatrix.needsUpdate = true;
    gl.instanceMatrix.needsUpdate = true;
  });

  return (
    <group position={[140, 0, 20]}>
      <Baked build={buildStatic} mats={mats} />
      <group ref={wheel} position={[0, HUB_Y, 0]}>
        <Baked build={buildWheel} mats={mats} />
      </group>
      <instancedMesh ref={shells} args={[geos.shell, mats.solid, N]} frustumCulled={false} castShadow />
      <instancedMesh ref={glass} args={[geos.glass, mats.glass, N]} frustumCulled={false} />
      <mesh position={[0, HUB_Y - CAP_R - 1.25 + 3.55, 6.72]} material={mats.signs.eye}>
        <planeGeometry args={[4.4, 1.0]} />
      </mesh>
    </group>
  );
}
