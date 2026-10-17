"use client";
// Highway maintenance yard, cell (-140, -140). Local coords: origin at the cell centre, buildable +-13.
// The gate is in the NW corner (local -x, -z), towards road node PLACES.maintenanceYard (-160, -160).
import { Baked } from "./Baked";
import type { Kits } from "./kit";
import type { LandmarkMaterials } from "./materials";
import { gritter } from "./props";

const ORANGE = "#ff7a1a";
const GREY = "#8b9199";
const DARK = "#3b3f45";

function coneStack(k: Kits, x: number, z: number, n: number) {
  const s = k.solid;
  for (let i = 0; i < n; i++) s.slab(x - 0.32, x + 0.32, 0.08 + i * 0.13, 0.13 + i * 0.13, z - 0.32, z + 0.32, "#1b1b1b");
  const b = 0.08 + n * 0.13;
  s.cone(0.3, 0.85, 8, [x, b + 0.42, z], ORANGE);
  s.cyl(0.13, 0.17, 0.16, 8, [x, b + 0.45, z], "#f4f4f0");
}

function chapter8Barrier(k: Kits, x: number, z: number, ry: number) {
  k.solid.at(x, 0, z, ry, () => {
    for (let i = 0; i < 6; i++) k.solid.slab(-0.9 + i * 0.3, -0.6 + i * 0.3, 0.6, 0.9, -0.03, 0.03, i % 2 ? "#f4f4f0" : "#d8232a");
    for (const sx of [-0.8, 0.8]) {
      k.solid.slab(sx - 0.04, sx + 0.04, 0.08, 0.9, -0.04, 0.04, "#2a2d33");
      k.solid.slab(sx - 0.1, sx + 0.1, 0.08, 0.16, -0.35, 0.35, "#2a2d33");
    }
  });
}

export function build(k: Kits) {
  const s = k.solid;
  // yard surface + markings
  s.slab(-13.4, 13.4, 0, 0.08, -13.4, 13.4, "#4a4d52");
  for (const x of [-12.2, -7.4]) s.slab(x, x + 0.15, 0.08, 0.11, -9.5, 1, "#f2c81a");
  // depot shed: grey walls, orange band and roof, two roller doors facing north
  s.slab(-13, 3, 0, 6, 2, 13, GREY);
  s.slab(-13.08, 3.08, 4.9, 5.7, 1.92, 13.08, ORANGE);
  s.prism(6.0, 2.2, 16.8, [-5, 6, 7.5], ORANGE);
  for (const [x0, x1] of [[-12, -7.2], [-6.4, -1.6]]) {
    s.slab(x0 - 0.25, x1 + 0.25, 0, 4.85, 1.85, 2.0, ORANGE);
    s.slab(x0, x1, 0, 4.6, 1.8, 1.9, "#b8bdc3");
    for (let y = 0.45; y < 4.6; y += 0.45) s.slab(x0, x1, y - 0.04, y + 0.04, 1.76, 1.8, "#9399a0");
  }
  // office end with windows and a door
  k.glass.slab(-0.6, 2.4, 2.2, 3.8, 1.86, 1.96, "#2b4f86");
  s.slab(-1.2, -0.7, 0, 2.4, 1.86, 1.96, "#2a2d33");
  // floodlight on the shed + yard masts
  for (const [x, z] of [[12.4, -8.4], [-12.4, -1.0]]) {
    s.cyl(0.12, 0.2, 9, 6, [x, 4.5, z], "#9aa0a6");
    s.slab(x - 0.6, x + 0.6, 8.8, 9.3, z - 0.3, z + 0.3, "#2a2d33");
    k.glow.slab(x - 0.5, x + 0.5, 8.72, 8.8, z - 0.25, z + 0.25, "#fff1c9");
  }
  // salt dome with a doorway and spilled grit
  s.cyl(4.8, 4.8, 0.9, 12, [8.4, 0.45, 7.8], "#a7a9ab");
  s.dome(4.7, 10, 5, [8.4, 0.9, 7.8], "#b9a98d", [1, 0.95, 1]);
  s.cyl(0.6, 0.8, 0.8, 8, [8.4, 5.7, 7.8], "#8d7f6a");
  s.cone(0.75, 0.6, 8, [8.4, 6.4, 7.8], ORANGE);
  s.slab(6.9, 9.9, 0, 3.2, 2.6, 3.4, ORANGE);
  s.slab(7.3, 9.5, 0, 2.8, 2.5, 3.45, "#2a2a2a");
  s.cone(1.5, 0.9, 9, [8.4, 0.5, 1.6], "#e8e4da");
  s.cone(0.9, 0.6, 8, [9.6, 0.35, 0.8], "#e0dbcf");
  // traffic cones: stacks + a loose row
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) coneStack(k, -3.6 + i * 0.95, -12.2 + j * 0.95, 3 + ((i + j) % 3));
  for (let i = 0; i < 7; i++) coneStack(k, 0.8 + i * 0.85, -6.2, 0);
  // red-and-white barriers, stored in rows
  for (let r = 0; r < 3; r++) for (let i = 0; i < 4; i++) chapter8Barrier(k, 5.5 + i * 2, -12.3 + r * 0.9, 0);
  // water-filled barriers (orange/white)
  for (let i = 0; i < 6; i++) {
    const x = 1 + i * 1.6;
    s.frustum(0.45, 0.75, 0.9, [x, 0.45, -8.4], i % 2 ? "#f4f4f0" : ORANGE, [1, 1, 0.35]);
    s.frustum(0.32, 0.45, 0.25, [x, 1.02, -8.4], i % 2 ? "#f4f4f0" : ORANGE, [1, 1, 0.35]);
  }
  // a portable traffic light pair
  for (const x of [-4.2, -2.6]) {
    s.slab(x - 0.35, x + 0.35, 0, 0.3, -3.4, -2.6, "#f2c81a");
    s.cyl(0.06, 0.06, 2.4, 5, [x, 1.5, -3.0], "#2a2d33");
    s.slab(x - 0.2, x + 0.2, 2.4, 3.4, -3.15, -2.85, "#1b1b1b");
    k.glow.box(0.18, 0.18, 0.05, x, 3.2, -3.17, "#ff3030");
  }
  // gritter parked facing the gate
  gritter(k, -9.8, -3.0, Math.PI);
  // palisade fence with a gate gap in the NW
  const posts: [number, number][] = [];
  for (let u = -13.2; u <= 13.21; u += 2.2) {
    posts.push([u, 13.2], [13.2, u], [-13.2, u]);
    if (u > -6.5) posts.push([u, -13.2]);
  }
  for (const [x, z] of posts) s.slab(x - 0.07, x + 0.07, 0, 2.2, z - 0.07, z + 0.07, "#2f4a3a");
  for (const y of [0.5, 1.9]) {
    s.slab(-13.25, 13.25, y, y + 0.08, 13.17, 13.23, "#2f4a3a");
    s.slab(13.17, 13.23, y, y + 0.08, -13.25, 13.25, "#2f4a3a");
    s.slab(-13.23, -13.17, y, y + 0.08, -13.25, 13.25, "#2f4a3a");
    s.slab(-6.5, 13.25, y, y + 0.08, -13.23, -13.17, "#2f4a3a");
  }
  // gate swung open
  s.at(-6.5, 0, -13.2, 0.8, () => {
    s.slab(-5, 0, 0.4, 0.5, -0.04, 0.04, ORANGE);
    s.slab(-5, 0, 1.6, 1.7, -0.04, 0.04, ORANGE);
    for (let x = -4.9; x < 0; x += 0.7) s.slab(x - 0.04, x + 0.04, 0.4, 1.7, -0.04, 0.04, ORANGE);
  });
  s.slab(-6.7, -6.3, 0, 2.6, -13.4, -13.0, DARK);
  s.slab(-13.4, -13.0, 0, 2.6, -13.4, -13.0, DARK);
}

export function MaintenanceYard({ mats }: { mats: LandmarkMaterials }) {
  return (
    <group position={[-140, 0, -140]}>
      <Baked build={build} mats={mats} />
      <mesh position={[-5, 5.3, 1.9]} rotation={[0, Math.PI, 0]} material={mats.signs.depot}>
        <planeGeometry args={[7.2, 0.78]} />
      </mesh>
    </group>
  );
}
