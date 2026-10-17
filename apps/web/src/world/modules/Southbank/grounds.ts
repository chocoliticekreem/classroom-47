// Flat surfaces and open spaces: the district's paved base, the pedestrianised market street,
// the culture plaza, the park (lawn, paths, lake with pedalos, bandstand), the crescent lawn and
// the roundabout islands.
import * as THREE from "three";
import { ZONES } from "../../config";
import { SB_FEATURES } from "../../districts/southbank";
import { Bag, merge, paint } from "./kit";
import { CULTURE } from "./layout";
import { waterMaterial } from "./materials";
import { makePaving } from "./textures";

const Z = ZONES.southbank;
const F = SB_FEATURES;

function flat(color: string, offset: number, extra: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: offset, polygonOffsetUnits: offset * 2, ...extra });
}

/** Ribbon along a polyline, `half` metres each side, UVs in metres / tile. */
function ribbon(pts: readonly (readonly [number, number])[], half: number, y: number, tile: number) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  let acc = 0;
  pts.forEach(([x, z], i) => {
    const [px, pz] = pts[Math.max(0, i - 1)], [nx, nz] = pts[Math.min(pts.length - 1, i + 1)];
    const dx = nx - px, dz = nz - pz, l = Math.hypot(dx, dz) || 1;
    const ox = (-dz / l) * half, oz = (dx / l) * half;
    if (i > 0) acc += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]);
    pos.push(x + ox, y, z + oz, x - ox, y, z - oz);
    uv.push(0, acc / tile, (2 * half) / tile, acc / tile);
    if (i > 0) {
      const b = i * 2;
      idx.push(b - 2, b - 1, b, b - 1, b + 1, b);
    }
  });
  // extend the ends a little so the paving meets the pavements
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (g.attributes.normal.getY(0) < 0) {
    g.setIndex(idx.map((_, i) => idx[i - (i % 3) + [0, 2, 1][i % 3]]));
    g.computeVertexNormals();
  }
  return g;
}

export function buildGrounds(bag: Bag) {
  const add = (g: THREE.BufferGeometry, m: THREE.Material) => {
    const mesh = new THREE.Mesh(bag.keep(g), m);
    mesh.receiveShadow = true;
    bag.add(mesh);
    return mesh;
  };
  const w = Z.maxX - Z.minX, d = Z.maxZ - Z.minZ;
  // urban base (pavements everywhere between the roads and the buildings)
  add(new THREE.PlaneGeometry(w + 6, d + 6).rotateX(-Math.PI / 2).translate((Z.minX + Z.maxX) / 2, 0.04, (Z.minZ + Z.maxZ) / 2), bag.keep(flat("#b3aea4", 3)));

  // market street + culture plaza paving
  const pav = bag.keep(makePaving());
  const pavMat = bag.keep(flat("#ffffff", 1.5, { map: pav }));
  const m = F.market;
  const ext: [number, number][] = [
    [m[0][0] - (m[1][0] - m[0][0]) * 0.3, m[0][1] - (m[1][1] - m[0][1]) * 0.3],
    ...m.map(([x, z]) => [x, z] as [number, number]),
    [m[m.length - 1][0] + (m[m.length - 1][0] - m[m.length - 2][0]) * 0.25, m[m.length - 1][1] + (m[m.length - 1][1] - m[m.length - 2][1]) * 0.25],
  ];
  add(ribbon(ext, F.marketWidth / 2 + 1, 0.016, 4), pavMat);
  const pl = CULTURE.plaza;
  const plaza = new THREE.PlaneGeometry(pl.maxX - pl.minX, pl.maxZ - pl.minZ).rotateX(-Math.PI / 2).translate((pl.minX + pl.maxX) / 2, 0.016, (pl.minZ + pl.maxZ) / 2);
  const puv = plaza.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < puv.count; i++) puv.setXY(i, (puv.getX(i) * (pl.maxX - pl.minX)) / 4, (puv.getY(i) * (pl.maxZ - pl.minZ)) / 4);
  add(plaza, pavMat);

  // park lawn, crescent lawn, roundabout islands (one grass material)
  const grass = bag.keep(flat("#6fae4f", 2));
  const P = F.park;
  const lawnParts: THREE.BufferGeometry[] = [
    new THREE.PlaneGeometry(P.maxX - P.minX, P.maxZ - P.minZ).rotateX(-Math.PI / 2).translate((P.minX + P.maxX) / 2, 0.014, (P.minZ + P.maxZ) / 2),
    new THREE.CircleGeometry(F.crescent.r - 6, 40).rotateX(-Math.PI / 2).translate(F.crescent.x, 0.014, F.crescent.z),
    ...F.roundabouts.map((r) => new THREE.CircleGeometry(r.r - 5.5, 24).rotateX(-Math.PI / 2).translate(r.x, 0.04, r.z)),
  ].map((g) => (g.deleteAttribute("uv"), g.toNonIndexed()));
  add(merge(lawnParts), grass);

  // park paths: a cross plus a loop round the lake
  const paths: THREE.BufferGeometry[] = [];
  const cxm = (P.minX + P.maxX) / 2;
  paths.push(new THREE.PlaneGeometry(3, P.maxZ - P.minZ).rotateX(-Math.PI / 2).translate(cxm, 0.02, (P.minZ + P.maxZ) / 2));
  paths.push(new THREE.PlaneGeometry(P.maxX - P.minX, 3).rotateX(-Math.PI / 2).translate(cxm, 0.02, P.minZ + 8));
  const lk = F.lake;
  paths.push(new THREE.RingGeometry(1, 1.12, 48).scale(lk.rx + 4, lk.rz + 4, 1).rotateX(-Math.PI / 2).translate(lk.x, 0.021, lk.z));
  paths.push(new THREE.CircleGeometry(10, 24).rotateX(-Math.PI / 2).translate(F.bandstand.x, 0.022, F.bandstand.z));
  add(merge(paths.map((g) => (g.deleteAttribute("uv"), g.toNonIndexed()))), bag.keep(flat("#ddd2bb", 1)));

  // lake: stone rim + animated water
  add(new THREE.RingGeometry(1, 1.08, 48).scale(lk.rx, lk.rz, 1).rotateX(-Math.PI / 2).translate(lk.x, 0.05, lk.z), bag.keep(flat("#cfc8b8", 0.5)));
  add(new THREE.CircleGeometry(1, 48).scale(lk.rx, lk.rz, 1).rotateX(-Math.PI / 2).translate(lk.x, 0.03, lk.z), bag.keep(waterMaterial()));

  // pedalos on the lake + a little island
  const boats: THREE.BufferGeometry[] = [];
  const boatSpots: [number, number, string][] = [[-8, -4, "#ff6a1a"], [5, 3, "#f5f5f5"], [12, -5, "#2e86ab"], [-14, 5, "#f2c14e"]];
  for (const [bx, bz, c] of boatSpots) {
    boats.push(paint(new THREE.BoxGeometry(1.6, 0.6, 2.6).translate(lk.x + bx, 0.3, lk.z + bz), c));
    boats.push(paint(new THREE.BoxGeometry(1.2, 0.5, 1).translate(lk.x + bx, 0.85, lk.z + bz - 0.3), "#ffffff"));
  }
  boats.push(paint(new THREE.CylinderGeometry(3, 3.6, 0.6, 10).translate(lk.x + 2, 0.2, lk.z - 1), "#6aa84f"));
  boats.push(paint(new THREE.IcosahedronGeometry(2.4, 0).translate(lk.x + 2, 3.5, lk.z - 1), "#3f7a34"));
  boats.push(paint(new THREE.CylinderGeometry(0.2, 0.3, 2.4, 5).translate(lk.x + 2, 1.4, lk.z - 1), "#6b4a2f"));

  // bandstand: octagonal plinth, eight slender posts, a green-and-white roof with a finial
  const bs = F.bandstand;
  boats.push(paint(new THREE.CylinderGeometry(5, 5.3, 0.9, 8).translate(bs.x, 0.45, bs.z), "#e9e4d8"));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    boats.push(paint(new THREE.CylinderGeometry(0.14, 0.14, 3.2, 5).translate(bs.x + 4.4 * Math.cos(a), 2.5, bs.z + 4.4 * Math.sin(a)), "#f5f5f5"));
  }
  boats.push(paint(new THREE.CylinderGeometry(5.6, 5.6, 0.4, 8).translate(bs.x, 4.2, bs.z), "#f5f5f5"));
  boats.push(paint(new THREE.ConeGeometry(5.8, 2.8, 8).translate(bs.x, 5.8, bs.z), "#2f6d4a"));
  boats.push(paint(new THREE.ConeGeometry(0.4, 1.4, 6).translate(bs.x, 7.8, bs.z), "#d4af37"));
  // a little brass band on the plinth
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    boats.push(paint(new THREE.BoxGeometry(0.5, 1.6, 0.4).translate(bs.x + 2.2 * Math.cos(a), 1.7, bs.z + 2.2 * Math.sin(a)), i % 2 ? "#b81d24" : "#1d2a5c"));
  }

  // roundabout centrepieces: a fountain on RA1, an obelisk on RA2, plus kerbs
  const [r1, r2] = F.roundabouts;
  for (const r of F.roundabouts) boats.push(paint(new THREE.CylinderGeometry(r.r - 5.3, r.r - 5.3, 0.22, 24, 1, true).translate(r.x, 0.11, r.z), "#d6d0c4"));
  boats.push(paint(new THREE.CylinderGeometry(4, 4.3, 0.7, 16).translate(r1.x, 0.35, r1.z), "#d9d3c7"));
  boats.push(paint(new THREE.CylinderGeometry(3.5, 3.5, 0.1, 16).translate(r1.x, 0.72, r1.z), "#5fa6c9"));
  boats.push(paint(new THREE.CylinderGeometry(0.5, 0.8, 3, 8).translate(r1.x, 2, r1.z), "#d9d3c7"));
  boats.push(paint(new THREE.CylinderGeometry(1.6, 1.6, 0.4, 12).translate(r1.x, 3.4, r1.z), "#d9d3c7"));
  boats.push(paint(new THREE.BoxGeometry(2.2, 1.2, 2.2).translate(r2.x, 0.6, r2.z), "#cfc8b8"));
  boats.push(paint(new THREE.CylinderGeometry(0.35, 1, 11, 4).rotateY(Math.PI / 4).translate(r2.x, 6.7, r2.z), "#e1dbcf"));

  const parts = boats.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of parts) if (g.attributes.uv) g.deleteAttribute("uv");
  const mesh = add(merge(parts), bag.keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true })));
  mesh.castShadow = true;
}
