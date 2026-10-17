"use client";
// Police station, cell (-140, 140). Local coords: origin at the cell centre, buildable +-13.
// The car park faces the north road (z = -20 local); vehicles leave at the NE corner,
// next to road node PLACES.policeStation (-120, 120) = local (20, -20).
import { Baked } from "./Baked";
import type { Kits } from "./kit";
import type { LandmarkMaterials } from "./materials";
import { policeCar, windows } from "./props";

const WHITE = "#f1f2ee";
const BLUE = "#1d46a3";
const STONE = "#9aa0a6";
const GLASS = "#2b4f86";

export function build(k: Kits) {
  const s = k.solid;
  // car park
  s.slab(-13.4, 13.4, 0, 0.1, -13.4, -1, "#3d4147");
  // building
  s.slab(-13.2, 13.2, 0, 0.7, -1.2, 13.2, STONE);
  s.slab(-13, 13, 0, 11, -1, 13, WHITE);
  s.slab(-13.06, 13.06, 3.6, 4.2, -1.06, 13.06, BLUE);
  s.slab(-13.1, 13.1, 11, 12, -1.1, 13.1, BLUE);
  s.slab(-12.5, 12.5, 11.9, 12.04, -0.5, 12.5, "#6b7178");
  // corner quoins
  for (const x of [-13, 13]) for (const z of [-1, 13]) s.slab(x - 0.35, x + 0.35, 0, 11, z - 0.35, z + 0.35, "#e2e4e0");
  // windows: 3 floors on all sides, leaving the entrance bay clear
  const ys = [2.0, 5.8, 9.0];
  const clear = (u: number, y: number) => Math.abs(u) < 2.8 && y < 7;
  windows(k, "x", -1, -1, -11.7, 11.7, 2.6, ys, 1.4, 1.6, GLASS, clear);
  windows(k, "x", 13, 1, -11.7, 11.7, 2.6, ys, 1.4, 1.6, GLASS);
  windows(k, "z", -13, -1, 0.6, 11.4, 2.7, ys, 1.4, 1.6, GLASS);
  windows(k, "z", 13, 1, 0.6, 11.4, 2.7, ys, 1.4, 1.6, GLASS);
  // entrance: steps, door, portico
  s.slab(-2.8, 2.8, 0, 0.25, -3.4, -1, "#c9ccd0");
  s.slab(-2.4, 2.4, 0.25, 0.5, -2.4, -1, "#c9ccd0");
  k.glass.slab(-1.3, 1.3, 0.5, 2.9, -1.15, -0.95, "#1b2f5c");
  s.slab(-2.9, 2.9, 3.0, 3.35, -3.4, -1, WHITE);
  s.slab(-2.95, 2.95, 3.15, 3.4, -3.45, -3.3, BLUE);
  for (const x of [-2.5, 2.5]) s.cyl(0.18, 0.2, 2.75, 8, [x, 1.75, -3.0], WHITE);
  // the classic blue lamp over the door
  s.cyl(0.08, 0.08, 0.5, 6, [0, 3.6, -2.4], "#1f2326");
  k.glow.frustum(0.38, 0.3, 0.75, [0, 4.25, -2.4], "#3d7bff");
  s.frustum(0.12, 0.45, 0.32, [0, 4.78, -2.4], "#1f2326");
  s.sphere(0.1, 6, 4, [0, 5.0, -2.4], "#1f2326");
  // freestanding blue lamp at the car park entrance
  s.cyl(0.1, 0.16, 4.2, 8, [3.6, 2.1, -12.9], "#1f2326");
  k.glow.frustum(0.32, 0.26, 0.65, [3.6, 4.55, -12.9], "#3d7bff");
  s.frustum(0.1, 0.4, 0.3, [3.6, 5.03, -12.9], "#1f2326");
  // rooftop sign board backing + radio mast
  s.slab(-5.2, 5.2, 12, 14.4, -0.7, -0.4, BLUE);
  for (const x of [-4, 4]) s.slab(x - 0.12, x + 0.12, 12, 13.4, -0.4, 0.6, "#4a4f55");
  s.cyl(0.08, 0.16, 9, 6, [9.5, 16.5, 9.5], "#9aa0a6");
  for (const y of [14, 16.5, 19]) s.box(1.4, 0.06, 0.06, 9.5, y, 9.5, "#9aa0a6");
  k.glow.sphere(0.2, 6, 4, [9.5, 21.1, 9.5], "#ff3030");
  s.slab(5, 8, 12, 13.4, 7.5, 11, "#8a9096");
  // car park: bay lines, hatched no-parking zone, kerb wall with an exit at the east
  for (const x of [-12.6, -9.4, -6.2, -3.0, 3.0, 6.2, 9.4, 12.6]) s.slab(x - 0.08, x + 0.08, 0.1, 0.13, -6.4, -1.2, "#f4f4f0");
  for (const x of [-12.6, 3.0]) s.slab(x, x + 9.6, 0.1, 0.13, -6.5, -6.3, "#f4f4f0");
  for (let i = 0; i < 5; i++) s.box(0.22, 0.03, 2.2, -2 + i, 0.115, -5.0, "#f2c81a", Math.PI / 4);
  s.slab(-13.4, -12.9, 0, 0.6, -13.4, -1, "#d5d8dc");
  s.slab(-13.4, 3, 0, 0.6, -13.4, -12.9, "#d5d8dc");
  for (let x = -12; x <= 2; x += 2.6) s.slab(x - 0.12, x + 0.12, 0, 0.9, -13.35, -12.95, BLUE);
  // parked response cars, nose in
  policeCar(k, -11.0, -3.9, 0);
  policeCar(k, -7.8, -3.9, 0);
  policeCar(k, 7.8, -3.9, 0);
  // painted arrow towards the exit
  s.slab(4.5, 9.5, 0.1, 0.13, -10.0, -9.7, "#f4f4f0");
  s.box(1.3, 0.03, 0.3, 9.75, 0.115, -9.5, "#f4f4f0", Math.PI / 4);
  s.box(1.3, 0.03, 0.3, 9.75, 0.115, -10.2, "#f4f4f0", -Math.PI / 4);
}

export function PoliceStation({ mats }: { mats: LandmarkMaterials }) {
  return (
    <group position={[-140, 0, 140]}>
      <Baked build={build} mats={mats} />
      <mesh position={[0, 5.75, -1.16]} rotation={[0, Math.PI, 0]} material={mats.signs.police}>
        <planeGeometry args={[4.8, 1.2]} />
      </mesh>
      <mesh position={[0, 13.2, -0.76]} rotation={[0, Math.PI, 0]} material={mats.signs.police}>
        <planeGeometry args={[9.8, 2.2]} />
      </mesh>
    </group>
  );
}
