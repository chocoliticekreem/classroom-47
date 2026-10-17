// The culture quarter (brutalist arts centre, a brick power-station gallery with one tall chimney,
// a glass concert hall with a wavy roof) and the cluster of mid-rise glass towers.
import * as THREE from "three";
import { Bag, boxes, merge, unitBox } from "./kit";
import { CULTURE, TOWERS, type RBox } from "./layout";
import type { Facades, Glow } from "./streets";
import { lampMaterial } from "./streets";

const rb = (x: number, y: number, z: number, w: number, h: number, d: number, color: string, ry = 0): RBox => ({ x, y, z, w, h, d, ry, color });

export function buildCulture(bag: Bag, glow: Glow, fac: Facades) {
  const box = bag.keep(unitBox());
  const concrete: RBox[] = [];
  const brick: RBox[] = [];
  const glass: RBox[] = [];
  const plain: RBox[] = [];
  const lit: RBox[] = [];

  // --- Brutalist arts centre: stacked cantilevered concrete slabs and a fly tower
  {
    const { x, z, w, d } = CULTURE.arts;
    const c = "#b9b6ae", cd = "#a19e96";
    concrete.push(rb(x, 0, z, w, 6, d, c));
    plain.push(rb(x, 6, z, w + 5, 2.4, d + 5, cd)); // terrace slab
    concrete.push(rb(x - 1, 8.4, z + 1, w - 6, 8, d - 6, c));
    plain.push(rb(x - 1, 16.4, z + 1, w - 2, 2.4, d - 2, cd));
    concrete.push(rb(x - 5, 18.8, z + 3, w - 16, 7.2, d - 14, c));
    concrete.push(rb(x + 12, 18.8, z - 6, 14, 17, 14, "#c4c1b9")); // fly tower
    plain.push(rb(x + 12, 35.8, z - 6, 15, 0.8, 15, cd));
    // board-marked pillars under the cantilever
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) plain.push(rb(x + sx * (w / 2 + 1.5), 0, z + sz * (d / 2 + 1.5), 1.4, 6, 1.4, cd));
  }

  // --- Power-station gallery: long dark-brick hall, glowing glass light-beam roof, central chimney
  {
    const { x, z, w, d } = CULTURE.gallery;
    const c = "#7b4a35";
    brick.push(rb(x, 0, z, w, 24, d, c));
    glass.push(rb(x, 24, z + 2, w - 4, 4.5, 12, "#e8f2f7")); // the light beam
    lit.push(rb(x, 28.5, z + 2, w - 4, 0.3, 12, "#ffffff"));
    // chimney on the north (street) front, Tate-style
    const chx = x, chz = z - d / 2 + 2;
    plain.push(rb(chx, 0, chz, 9, 64, 9, "#6f4230"));
    plain.push(rb(chx, 64, chz, 9.8, 1.2, 9.8, "#5e3828"));
    lit.push(rb(chx, 58, chz, 9.3, 3, 9.3, "#ffffff")); // the "Swiss light" band
    // tall slot windows along the hall
    for (let i = -3; i <= 3; i++) lit.push(rb(x + i * 8, 4, z - d / 2 - 0.05, 1.4, 16, 0.2, "#ffffff"));
  }

  // --- Glass concert hall: dark brick plinth, glass body
  {
    const { x, z, w, d } = CULTURE.hall;
    brick.push(rb(x, 0, z, w, 9, d, "#5a3a32"));
    glass.push(rb(x, 9, z, w, 18, d, "#cfe4f0"));
  }

  // --- Glass towers (and a set-back crown + mast each)
  TOWERS.forEach((t, i) => {
    glass.push(rb(t.x, 0, t.z, t.w, t.h, t.d, ["#9fc4dc", "#a9d0e2", "#8fb3cc", "#b8d6e6", "#7fa6c0"][i], t.ry));
    plain.push(rb(t.x, t.h, t.z, t.w * 0.7, 3.5, t.d * 0.7, "#5d6b78", t.ry));
    if (i % 2 === 0) glass.push(rb(t.x, t.h + 3.5, t.z, t.w * 0.45, 8, t.d * 0.45, "#b8d6e6", t.ry));
    plain.push(rb(t.x, t.h + (i % 2 === 0 ? 11.5 : 3.5), t.z, 0.4, 10, 0.4, "#d5d9dd"));
    // podium shops
    lit.push(rb(t.x, 0, t.z, t.w + 0.4, 4.5, t.d + 0.4, "#ffffff", t.ry));
  });

  bag.add(boxes(box, fac.concrete, concrete, { cast: true }));
  bag.add(boxes(box, fac.brick, brick, { cast: true }));
  bag.add(boxes(box, fac.glass, glass, { cast: true }));
  bag.add(boxes(box, bag.keep(new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true })), plain, { cast: true }));
  // podium glazing, the light beam and the chimney band: soft by day, glowing at night
  bag.add(boxes(box, lampMaterial(bag, glow, "#b7c9d3", "#ffe6b0", 1.5), lit, { receive: false }));

  // concert hall wavy roof: a row of half-cylinder vaults of different sizes
  {
    const { x, z, w, d } = CULTURE.hall;
    const parts: THREE.BufferGeometry[] = [];
    const radii = [5.5, 7, 6, 4.5];
    let px = x - w / 2;
    for (const r of radii) {
      const width = (w * r) / radii.reduce((a, b) => a + b, 0);
      const g = new THREE.CylinderGeometry(1, 1, d, 16, 1, false, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2);
      g.scale(width / 2, r * 0.8, 1).translate(px + width / 2, 27, z);
      parts.push(g);
      px += width;
    }
    const mat = bag.keep(new THREE.MeshStandardMaterial({ color: "#f3f6f8", roughness: 0.3, metalness: 0.3, side: THREE.DoubleSide, emissive: new THREE.Color("#bcd8ff"), emissiveIntensity: 0, flatShading: true }));
    glow.std.push({ mat, k: 0.45 });
    const mesh = new THREE.Mesh(bag.keep(merge(parts)), mat);
    mesh.castShadow = true;
    bag.add(mesh);
  }
}
