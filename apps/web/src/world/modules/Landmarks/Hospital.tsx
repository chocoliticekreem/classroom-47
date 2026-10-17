"use client";
// Hospital, cell (140, -140). Local coords: origin at the cell centre, buildable +-13.
// Faces south (+z local). Ambulances leave from the SW corner, by road node
// PLACES.hospital (120, -120) = local (-20, 20).
import { Baked } from "./Baked";
import type { Kits } from "./kit";
import type { LandmarkMaterials } from "./materials";
import { ambulance, tree, windows } from "./props";

const WHITE = "#f5f6f3";
const TRIM = "#d9dcdf";
const RED = "#d8232a";
const GLASS = "#7fb0d4";
const BLUE = "#0b5fb3";

export function build(k: Kits) {
  const s = k.solid;
  // forecourt + lawn
  s.slab(-13.4, 13.4, 0, 0.08, -13.4, 13.4, "#c6c8c4");
  s.slab(1.5, 13.2, 0, 0.18, 6.2, 13.2, "#6fbf4e");
  tree(k, 4.5, 10, 0.75, 0);
  tree(k, 10.5, 9.5, 0.85, 4);
  // main tower: 5 floors with ribbon windows
  s.slab(-6, 13, 0, 20, -13, 5, WHITE);
  s.slab(-6.15, 13.15, 0, 0.8, -13.15, 5.15, TRIM);
  for (const y of [3.7, 7.3, 10.9, 14.5]) s.slab(-6.08, 13.08, y - 0.12, y + 0.12, -13.08, 5.08, TRIM);
  s.slab(-6.2, 13.2, 20, 20.8, -13.2, 5.2, TRIM);
  s.slab(-5.6, 12.6, 20.6, 20.82, -12.6, 4.6, "#8d949b");
  const ribbons = [2.2, 5.5, 9.1, 12.7, 16.3];
  for (const y of ribbons) {
    k.glass.slab(-5.4, 7.4, y - 0.95, y + 0.95, 5.0, 5.12, GLASS); // south (a white panel at x 8..12.6 carries the cross)
    k.glass.slab(-5.4, 12.4, y - 0.95, y + 0.95, -13.12, -13.0, GLASS);
    k.glass.slab(12.98, 13.1, y - 0.95, y + 0.95, -12.4, 4.4, GLASS);
    if (y > 8) k.glass.slab(-6.1, -5.98, y - 0.95, y + 0.95, -12.4, -6.8, GLASS);
    if (y > 8) k.glass.slab(-6.1, -5.98, y - 0.95, y + 0.95, -1.2, 4.4, GLASS);
  }
  // vertical fins
  for (let x = -4; x <= 7; x += 2.2) s.slab(x - 0.1, x + 0.1, 0.8, 20, 5.0, 5.3, TRIM);
  // red crosses (south face panel, west face above the A&E wing)
  s.slab(7.9, 12.7, 1, 19.6, 5.0, 5.18, "#ffffff");
  s.slab(10.3 - 0.6, 10.3 + 0.6, 11.4, 16.8, 5.25, 5.4, RED);
  s.slab(10.3 - 2.2, 10.3 + 2.2, 13.5, 14.7, 5.25, 5.4, RED);
  s.slab(-6.4, -6.0, 13.5 - 2.4, 13.5 + 2.4, -4.6, -3.4, RED);
  s.slab(-6.4, -6.0, 13.5 - 0.6, 13.5 + 0.6, -6.4, -1.6, RED);
  // rooftop sign backing (sign mesh is separate)
  s.slab(-4.5, 7.5, 20.8, 23.3, 4.5, 4.8, BLUE);
  // helipad on the roof
  s.slab(-4.5, 9.5, 20.8, 21.25, -11.5, 2.5, "#3a3f45");
  k.solid.ring(4.3, 4.9, 32, 2.5, 21.27, -4.5, "#f4c20d");
  s.slab(0.6, 1.5, 21.25, 21.3, -7.2, -1.8, "#ffffff");
  s.slab(3.5, 4.4, 21.25, 21.3, -7.2, -1.8, "#ffffff");
  s.slab(1.5, 3.5, 21.25, 21.3, -4.95, -4.05, "#ffffff");
  for (const [x, z] of [[-4.3, -11.3], [9.3, -11.3], [-4.3, 2.3], [9.3, 2.3], [2.5, -11.3], [2.5, 2.3], [-4.3, -4.5], [9.3, -4.5]])
    k.glow.box(0.3, 0.2, 0.3, x, 21.35, z, "#4dff7a");
  // windsock + plant room
  s.cyl(0.05, 0.05, 2.6, 5, [11.8, 22.1, -11.8], "#cfd3d6");
  s.cone(0.25, 1.2, 6, [12.3, 23.2, -11.8], "#ff6a1a", [0, 0, Math.PI / 2]);
  s.slab(10.2, 12.6, 20.8, 22.6, -9, -2, "#a5abb1");
  for (const z of [-7.8, -5.5, -3.2]) s.cyl(0.6, 0.6, 0.3, 8, [11.4, 22.75, z], "#6b7178");
  // A&E wing (2 floors)
  s.slab(-13, -6, 0, 7.2, -13, 5, "#ece9e0");
  s.slab(-13.15, -5.9, 7.2, 7.7, -13.15, 5.15, TRIM);
  windows(k, "z", -13, -1, -11.5, 3.5, 2.5, [2.2, 5.2], 1.6, 1.4, GLASS);
  windows(k, "x", -13, -1, -11.8, -7.2, 2.3, [5.2], 1.6, 1.4, GLASS);
  k.glass.slab(-11.6, -7.4, 0.08, 2.8, 4.98, 5.12, "#a9d0ea");
  k.glass.slab(-12.6, -7.0, 4.1, 6.2, 4.98, 5.12, GLASS);
  // ambulance canopy with red fascia (A&E sign mesh sits on it)
  s.slab(-13.2, 1.2, 4.0, 4.4, 5, 11.2, WHITE);
  s.slab(-13.2, 1.2, 3.85, 5.0, 11.0, 11.25, RED);
  for (const x of [-13.0, -8.3, 0.9]) s.cyl(0.18, 0.18, 3.9, 8, [x, 1.95, 10.7], TRIM);
  // ambulance bays: yellow box outlines + "keep clear" hatching
  for (const [x0, x1] of [[-12.8, -8.6], [-8.0, -3.8]]) {
    s.slab(x0, x0 + 0.15, 0.08, 0.11, 5.3, 12.8, "#f4c20d");
    s.slab(x1 - 0.15, x1, 0.08, 0.11, 5.3, 12.8, "#f4c20d");
    s.slab(x0, x1, 0.08, 0.11, 12.65, 12.8, "#f4c20d");
  }
  for (let i = 0; i < 6; i++) s.box(0.25, 0.03, 2.4, -2.4 + i * 0.8, 0.1, 9.5, "#f4c20d", Math.PI / 4);
  ambulance(k, -10.7, 8.6, 0);
  // bollards along the kerb
  for (let x = 2; x <= 13; x += 1.6) s.cyl(0.12, 0.12, 0.8, 6, [x, 0.4, 13.1], "#2a2d33");
}

export function Hospital({ mats }: { mats: LandmarkMaterials }) {
  return (
    <group position={[140, 0, -140]}>
      <Baked build={build} mats={mats} />
      <mesh position={[1.5, 22.05, 4.82]} material={mats.signs.hospital}>
        <planeGeometry args={[11.6, 2.3]} />
      </mesh>
      <mesh position={[-6, 4.42, 11.27]} material={mats.signs.ae}>
        <planeGeometry args={[3.6, 1.1]} />
      </mesh>
    </group>
  );
}
