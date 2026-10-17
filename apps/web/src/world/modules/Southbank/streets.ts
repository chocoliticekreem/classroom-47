// Builds the generic city fabric from the layout: mixed-use blocks with shopfronts and awnings,
// terraces, mews, roofs, street trees, parked cars, café seating, market stalls, lamps and walkers.
import * as THREE from "three";
import { Bag, boxes, instanced, merge, paint, prismGeometry, props, unitBox } from "./kit";
import { FACADE_KINDS, type FacadeKind, type SouthbankLayout } from "./layout";
import { facadeMaterial, stripeMaterial, walkerMaterial } from "./materials";
import { makeFacade, makeStripes, type TexKind } from "./textures";

export interface Glow {
  /** Emissive window materials: emissiveIntensity = night * k. */
  std: { mat: THREE.MeshStandardMaterial; k: number }[];
  /** Unlit lamps/floodlights: colour lerps day -> night. */
  basic: { mat: THREE.MeshBasicMaterial; day: THREE.Color; night: THREE.Color }[];
}

const FACADE_SET: Record<TexKind, { rough: number; metal: number; seed: number; glow: number }> = {
  brick: { rough: 0.9, metal: 0, seed: 101, glow: 0.95 },
  render: { rough: 0.85, metal: 0, seed: 202, glow: 0.95 },
  georgian: { rough: 0.85, metal: 0, seed: 303, glow: 1.0 },
  modern: { rough: 0.6, metal: 0.05, seed: 404, glow: 1.0 },
  glass: { rough: 0.25, metal: 0.25, seed: 505, glow: 1.15 },
  concrete: { rough: 0.95, metal: 0, seed: 606, glow: 1.1 },
  shop: { rough: 0.45, metal: 0, seed: 707, glow: 1.7 },
};

export type Facades = Record<TexKind, THREE.MeshStandardMaterial>;

export function makeFacades(bag: Bag, glow: Glow): Facades {
  const out = {} as Facades;
  for (const kind of Object.keys(FACADE_SET) as TexKind[]) {
    const st = FACADE_SET[kind];
    const tex = makeFacade(kind, st.seed);
    bag.keep(tex.map);
    bag.keep(tex.emissive);
    const mat = bag.keep(facadeMaterial(kind, tex.map, tex.emissive, st.rough, st.metal));
    glow.std.push({ mat, k: st.glow });
    out[kind] = mat;
  }
  return out;
}

export function lampMaterial(bag: Bag, glow: Glow, day = "#e9e2c8", night = "#ffd58a", boost = 2.2) {
  const mat = bag.keep(new THREE.MeshBasicMaterial({ color: day, toneMapped: false }));
  glow.basic.push({ mat, day: new THREE.Color(day), night: new THREE.Color(night).multiplyScalar(boost) });
  return mat;
}

/** Person: dark legs, white torso (takes the instance colour), skin head. Local +z forward. */
function personGeometry() {
  const legs = paint(new THREE.BoxGeometry(0.36, 0.8, 0.24).translate(0, 0.4, 0), "#2d2f3a");
  const body = paint(new THREE.BoxGeometry(0.46, 0.66, 0.28).translate(0, 1.13, 0), "#ffffff");
  const head = paint(new THREE.BoxGeometry(0.24, 0.26, 0.24).translate(0, 1.6, 0), "#e0ac69");
  return merge([legs, body, head]).scale(1.25, 1.25, 1.25);
}

export function buildStreets(L: SouthbankLayout, bag: Bag, glow: Glow, fac: Facades) {
  const box = bag.keep(unitBox());
  const plain = bag.keep(new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true }));

  // --- building bodies, one InstancedMesh per facade archetype
  for (const kind of FACADE_KINDS as FacadeKind[]) {
    const list = L.bodies[kind];
    if (list.length) bag.add(boxes(box, fac[kind], list, { cast: true }));
  }
  if (L.shopfronts.length) bag.add(boxes(box, fac.shop, L.shopfronts));
  if (L.trims.length) bag.add(boxes(box, plain, L.trims, { cast: true }));
  if (L.acs.length) bag.add(boxes(box, plain, L.acs));
  if (L.kerbs.length) bag.add(boxes(box, plain, L.kerbs));
  if (L.roofs.length) bag.add(boxes(bag.keep(prismGeometry()), plain, L.roofs, { cast: true }));

  // --- awnings and stall canopies: striped, tilted down towards the street
  const stripes = bag.keep(makeStripes());
  const stripeMat = bag.keep(stripeMaterial(stripes));
  const slab = bag.keep(new THREE.BoxGeometry(1, 1, 1));
  bag.add(
    instanced(slab, stripeMat, L.awnings.length, (i, set) => {
      const a = L.awnings[i];
      set(a.x, a.y, a.z, a.w, 0.12, a.d, a.ry, 0.38);
      return a.color;
    }),
  );
  bag.add(
    instanced(slab, stripeMat, L.stalls.length, (i, set) => {
      const s = L.stalls[i];
      set(s.x, 2.4, s.z, 2.4, 0.14, 3.0, s.ry, 0.12);
      return s.color;
    }),
  );
  // stall counters piled with produce
  const counter = bag.keep(
    merge([
      paint(new THREE.BoxGeometry(2.0, 0.95, 2.6).translate(0, 0.48, 0), "#7a5a3c"),
      paint(new THREE.BoxGeometry(1.7, 0.25, 2.3).translate(0, 1.05, 0), "#e2a23b"),
      paint(new THREE.BoxGeometry(0.8, 0.22, 1.0).translate(0.3, 1.25, 0.5), "#c8402f"),
      paint(new THREE.BoxGeometry(0.7, 0.22, 0.9).translate(-0.3, 1.25, -0.6), "#6aa84f"),
      paint(new THREE.BoxGeometry(0.08, 2.4, 0.08).translate(0.95, 1.2, 1.25), "#3a3a3a"),
      paint(new THREE.BoxGeometry(0.08, 2.4, 0.08).translate(-0.95, 1.2, -1.25), "#3a3a3a"),
    ]),
  );
  const vcol = bag.keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true }));
  bag.add(props(counter, vcol, L.stalls, false));

  // --- street trees: trunk + chunky crown
  const trunk = bag.keep(new THREE.CylinderGeometry(0.18, 0.28, 3.2, 5).translate(0, 1.6, 0));
  const crown = bag.keep(new THREE.IcosahedronGeometry(2.3, 0).scale(1, 1.15, 1).translate(0, 4.6, 0));
  bag.add(props(trunk, bag.keep(new THREE.MeshStandardMaterial({ color: "#6b4a2f", roughness: 0.9 })), L.trees, false));
  bag.add(props(crown, bag.keep(new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true })), L.trees));

  // --- parked cars
  const carBody = bag.keep(
    merge([
      paint(new THREE.BoxGeometry(1.8, 0.75, 4.2).translate(0, 0.55, 0), "#ffffff"),
      paint(new THREE.BoxGeometry(1.6, 0.6, 2.2).translate(0, 1.2, -0.2), "#ffffff"),
    ]),
  );
  const carGlass = bag.keep(
    merge([
      paint(new THREE.BoxGeometry(1.64, 0.42, 2.0).translate(0, 1.2, -0.2), "#27323d"),
      paint(new THREE.BoxGeometry(1.9, 0.36, 0.7).translate(0, 0.2, 1.3), "#151515"),
      paint(new THREE.BoxGeometry(1.9, 0.36, 0.7).translate(0, 0.2, -1.3), "#151515"),
    ]),
  );
  const carMat = bag.keep(new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.2, flatShading: true }));
  bag.add(props(carBody, carMat, L.cars));
  bag.add(props(carGlass, vcol, L.cars, false));

  // --- café seating: table + two chairs; umbrellas
  const table = bag.keep(
    merge([
      paint(new THREE.CylinderGeometry(0.5, 0.5, 0.06, 10).translate(0, 0.75, 0), "#f4f1ea"),
      paint(new THREE.CylinderGeometry(0.05, 0.05, 0.75, 4).translate(0, 0.37, 0), "#333333"),
      paint(new THREE.BoxGeometry(0.42, 0.85, 0.42).translate(0.85, 0.42, 0), "#3b3f46"),
      paint(new THREE.BoxGeometry(0.42, 0.85, 0.42).translate(-0.85, 0.42, 0), "#3b3f46"),
    ]),
  );
  bag.add(props(table, vcol, L.tables, false));
  const umbrella = bag.keep(
    merge([
      new THREE.ConeGeometry(1.5, 0.6, 8).translate(0, 2.5, 0).toNonIndexed(),
      new THREE.CylinderGeometry(0.04, 0.04, 2.3, 4).translate(0, 1.15, 0).toNonIndexed(),
    ].map((g) => (g.deleteAttribute("uv"), g))),
  );
  bag.add(props(umbrella, bag.keep(new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true })), L.umbrellas));

  // --- benches
  const bench = bag.keep(new THREE.BoxGeometry(1.8, 0.5, 0.6).translate(0, 0.25, 0));
  bag.add(props(bench, plain, L.benches));

  // --- lamp posts: dark pole and a head that glows at night
  const pole = bag.keep(new THREE.CylinderGeometry(0.08, 0.12, 5.5, 5).translate(0, 2.75, 0));
  const head = bag.keep(new THREE.BoxGeometry(0.5, 0.3, 0.5).translate(0, 5.6, 0));
  bag.add(props(pole, bag.keep(new THREE.MeshStandardMaterial({ color: "#2c2f33", roughness: 0.7 })), L.lamps, false));
  bag.add(props(head, lampMaterial(bag, glow), L.lamps, false, 0, { receive: false }));

  // --- walkers: GPU animated (one uniform per frame for all of them)
  const W = L.walkers;
  const person = bag.keep(personGeometry());
  const wmesh = instanced(person, bag.keep(walkerMaterial()), W.length, (i, set) => {
    const w = W[i];
    set(w.x, 0.02, w.z, 1, 1, 1, 0);
    return w.color;
  }, { receive: false });
  const walk = new Float32Array(W.length * 4);
  const phase = new Float32Array(W.length);
  W.forEach((w, i) => {
    walk.set([w.dx, w.dz, w.len, w.speed], i * 4);
    phase[i] = w.phase;
  });
  person.setAttribute("aWalk", new THREE.InstancedBufferAttribute(walk, 4));
  person.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phase, 1));
  wmesh.frustumCulled = false;
  bag.add(wmesh);
}
