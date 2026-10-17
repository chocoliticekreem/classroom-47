"use client";
// Central park, cell (20, 20): lawns, paths, pond with ducks, trees, benches, railings,
// and a Big-Ben-style clock tower whose hands show useWorld timeOfDay.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { BoxGeometry, type Group, type InstancedMesh, Matrix4, Quaternion, Vector3 } from "three";
import { useWorld } from "../../store";
import { Baked } from "./Baked";
import type { Kits } from "./kit";
import type { LandmarkMaterials } from "./materials";
import { bench, lamp, tree } from "./props";
import { clockHandAngles } from "./time";

const GRASS = "#6cbf4c";
const PATH = "#e4d5ab";
const STONE = "#dcc68f";
const STONE_D = "#c7ad72";
const GOLD = "#e0b13e";
const SLATE = "#3e4a5c";
const G = 0.22; // grass top
const P = 0.3; // plaza top

const POND = { x: -7.5, z: 7.5, sx: 1.25 };
const FACE_Y = 28.75;
const FACE_D = 3.14;
const FACES: [number, number, number, number][] = [
  [0, FACE_Y, FACE_D, 0],
  [FACE_D, FACE_Y, 0, Math.PI / 2],
  [0, FACE_Y, -FACE_D, Math.PI],
  [-FACE_D, FACE_Y, 0, -Math.PI / 2],
];

function clockTower(k: Kits) {
  const s = k.solid;
  const b = P;
  s.slab(-3.5, 3.5, b, b + 1.2, -3.5, 3.5, "#b9a676");
  s.slab(-2.5, 2.5, b + 1.2, 25.5, -2.5, 2.5, STONE);
  for (const x of [-2.5, 2.5]) for (const z of [-2.5, 2.5]) s.slab(x - 0.38, x + 0.38, b + 1.2, 25.8, z - 0.38, z + 0.38, STONE_D);
  for (const y of [7.5, 13.5, 19.5]) s.slab(-2.65, 2.65, y, y + 0.28, -2.65, 2.65, STONE_D);
  // lancet windows, two columns per face, between the string courses
  for (const y of [4.3, 10.5, 16.5, 22.5])
    for (const u of [-0.9, 0.9]) {
      k.glass.slab(u - 0.24, u + 0.24, y - 1.2, y + 1.2, 2.48, 2.56, "#3b3326");
      k.glass.slab(u - 0.24, u + 0.24, y - 1.2, y + 1.2, -2.56, -2.48, "#3b3326");
      k.glass.slab(2.48, 2.56, y - 1.2, y + 1.2, u - 0.24, u + 0.24, "#3b3326");
      k.glass.slab(-2.56, -2.48, y - 1.2, y + 1.2, u - 0.24, u + 0.24, "#3b3326");
    }
  // clock stage with gilded surrounds
  s.slab(-3.05, 3.05, 25.5, 32, -3.05, 3.05, STONE);
  s.slab(-3.2, 3.2, 25.3, 25.7, -3.2, 3.2, STONE_D);
  for (const [x, , z, ry] of FACES)
    s.at(x * 0.97, 0, z * 0.97, ry, () => {
      s.slab(-2.8, 2.8, FACE_Y - 2.8, FACE_Y + 2.8, -0.02, 0.06, GOLD);
      s.slab(-2.95, 2.95, FACE_Y + 2.8, FACE_Y + 3.05, -0.05, 0.1, STONE_D);
      for (const u of [-2.5, 2.5]) s.cone(0.18, 0.7, 4, [u, FACE_Y + 3.35, 0.02], GOLD);
    });
  // cornice + belfry with arched openings
  s.slab(-3.3, 3.3, 32, 32.5, -3.3, 3.3, GOLD);
  s.slab(-2.65, 2.65, 32.5, 36.6, -2.65, 2.65, STONE);
  for (const u of [-1.35, 0, 1.35]) {
    s.slab(u - 0.32, u + 0.32, 33.0, 35.8, 2.6, 2.7, "#2a241c");
    s.slab(u - 0.32, u + 0.32, 33.0, 35.8, -2.7, -2.6, "#2a241c");
    s.slab(2.6, 2.7, 33.0, 35.8, u - 0.32, u + 0.32, "#2a241c");
    s.slab(-2.7, -2.6, 33.0, 35.8, u - 0.32, u + 0.32, "#2a241c");
  }
  for (const u of [-0.68, 0.68]) {
    s.slab(u - 0.08, u + 0.08, 32.5, 36.6, 2.62, 2.78, GOLD);
    s.slab(u - 0.08, u + 0.08, 32.5, 36.6, -2.78, -2.62, GOLD);
    s.slab(2.62, 2.78, 32.5, 36.6, u - 0.08, u + 0.08, GOLD);
    s.slab(-2.78, -2.62, 32.5, 36.6, u - 0.08, u + 0.08, GOLD);
  }
  s.slab(-2.9, 2.9, 36.6, 37.0, -2.9, 2.9, GOLD);
  // steep slate roof with gilded dormers, lantern and spire
  s.frustum(0.95, 2.85, 6.2, [0, 40.1, 0], SLATE);
  for (const [x, z] of [[0, 2.05], [0, -2.05], [2.05, 0], [-2.05, 0]]) {
    s.slab(x - (z ? 0.35 : 0.2), x + (z ? 0.35 : 0.2), 38.0, 39.2, z - (x ? 0.35 : 0.2), z + (x ? 0.35 : 0.2), GOLD);
    s.cone(0.3, 0.7, 4, [x, 39.55, z], GOLD, [0, Math.PI / 4, 0]);
  }
  for (const x of [-2.75, 2.75])
    for (const z of [-2.75, 2.75]) {
      s.cyl(0.25, 0.32, 1.2, 6, [x, 37.6, z], STONE);
      s.cone(0.32, 2.6, 6, [x, 39.5, z], SLATE);
      s.sphere(0.14, 6, 4, [x, 40.85, z], GOLD);
    }
  s.slab(-0.95, 0.95, 43.2, 45.0, -0.95, 0.95, SLATE);
  s.slab(-1.05, 1.05, 43.9, 44.15, -1.05, 1.05, GOLD);
  for (const u of [-0.4, 0.4]) {
    k.glow.slab(u - 0.15, u + 0.15, 44.25, 44.85, 0.94, 0.98, "#ffe2a3");
    k.glow.slab(u - 0.15, u + 0.15, 44.25, 44.85, -0.98, -0.94, "#ffe2a3");
    k.glow.slab(0.94, 0.98, 44.25, 44.85, u - 0.15, u + 0.15, "#ffe2a3");
    k.glow.slab(-0.98, -0.94, 44.25, 44.85, u - 0.15, u + 0.15, "#ffe2a3");
  }
  s.frustum(0.0, 0.7, 4.6, [0, 47.3, 0], GOLD);
  s.sphere(0.2, 8, 6, [0, 49.6, 0], GOLD);
  s.slab(-0.04, 0.04, 49.6, 50.6, -0.04, 0.04, GOLD);
  s.slab(-0.3, 0.3, 50.15, 50.23, -0.04, 0.04, GOLD);
}

export function build(k: Kits) {
  const s = k.solid;
  // lawn with a stone kerb
  s.slab(-13.8, 13.8, 0, 0.18, -13.8, 13.8, "#b5b0a2");
  s.slab(-13.5, 13.5, 0, G, -13.5, 13.5, GRASS);
  // paths and the central plaza
  s.slab(-13.6, 13.6, G - 0.02, 0.26, -1.25, 1.25, PATH);
  s.slab(-1.25, 1.25, G - 0.02, 0.26, -13.6, 13.6, PATH);
  s.cyl(5.6, 5.6, P, 28, [0, P / 2, 0], "#d6ccb6");
  s.ring(4.6, 5.0, 28, 0, P + 0.005, 0, "#c3b79c");
  // London square railings, gaps at the four path entrances
  for (const side of [-13.35, 13.35])
    for (const [a, b2] of [[-13.35, -1.6], [1.6, 13.35]]) {
      s.slab(a, b2, 0.95, 1.02, side - 0.04, side + 0.04, "#1d2124");
      s.slab(side - 0.04, side + 0.04, 0.95, 1.02, a, b2, "#1d2124");
      for (let u = a; u <= b2 + 0.01; u += 0.6) {
        s.slab(u - 0.025, u + 0.025, G, 1.1, side - 0.025, side + 0.025, "#1d2124");
        s.slab(side - 0.025, side + 0.025, G, 1.1, u - 0.025, u + 0.025, "#1d2124");
      }
    }
  // pond: stone rim, lily pads (water is its own mesh)
  s.cyl(4.5, 4.6, 0.4, 24, [POND.x, 0.2, POND.z], "#b8b3a6", [0, 0, 0], [POND.sx, 1, 1]);
  for (const [dx, dz, r] of [[-2.4, 1.2, 0.45], [-2.0, 1.9, 0.35], [2.2, -1.6, 0.5], [1.6, 2.2, 0.4]])
    s.cyl(r, r, 0.04, 8, [POND.x + dx, 0.37, POND.z + dz], "#3f8f3a");
  // trees
  const trees: [number, number][] = [
    [-5, -9], [-10, -5], [-11, -11], [-7.5, -12], [-4.6, -12.2], [-12, -3.3],
    [5, -9], [10, -5], [11.5, -11], [7.5, -12], [3.6, -12], [12, -3],
    [5.5, 9], [10, 5], [11.5, 11.5], [8, 12], [5.6, 11.4], [12, 2.9],
    [-12, 2.6], [-2.8, 12], [-12.1, 12.3],
  ];
  const inside = (v: number) => Math.max(-11.5, Math.min(11.5, v)); // keep canopies off the pavement
  trees.forEach(([x, z], i) => tree(k, inside(x), inside(z), 0.8 + ((i * 37) % 10) / 25, i, G));
  // benches facing the paths
  for (const z of [-8.5, 8.5]) {
    bench(k, 1.95, z, -Math.PI / 2, 0.26);
    bench(k, -1.95, z, Math.PI / 2, 0.26);
  }
  for (const x of [-8.5, 8.5]) {
    bench(k, x, 1.95, Math.PI, 0.26);
    bench(k, x, -1.95, 0, 0.26);
  }
  // lamps
  for (const [x, z] of [[1.7, 6.2], [-1.7, -6.2], [6.2, -1.7], [-6.2, 1.7], [1.7, -11], [-1.7, 11], [10.4, 1.7], [-10.4, -1.7]])
    lamp(k, x, z, 0.26);
  // flower beds on three diagonals
  for (const [cx, cz] of [[5.3, 5.3], [5.3, -5.3], [-5.3, -5.3]]) {
    s.cyl(1.15, 1.2, 0.3, 12, [cx, G + 0.1, cz], "#6b4a2e");
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4;
      const r = i === 0 ? 0 : 0.7;
      s.sphere(0.2, 5, 3, [cx + Math.cos(a) * r, G + 0.38, cz + Math.sin(a) * r], ["#e23b4a", "#ffd23a", "#c05ad6"][i % 3]);
    }
  }
  // London touches: red phone box and a pillar box by the path entrances
  s.slab(1.95, 2.95, G, G + 2.5, 11.9, 12.9, "#d4202c");
  s.slab(1.9, 3.0, G + 2.5, G + 2.75, 11.85, 12.95, "#b81a24");
  s.cyl(0.42, 0.55, 0.3, 4, [2.45, G + 2.9, 12.4], "#b81a24", [0, Math.PI / 4, 0]);
  k.glass.slab(2.1, 2.8, G + 0.9, G + 2.1, 12.88, 12.94, "#cfe3ee");
  k.glass.slab(2.1, 2.8, G + 0.9, G + 2.1, 11.86, 11.92, "#cfe3ee");
  k.glow.slab(2.15, 2.75, G + 2.28, G + 2.45, 12.9, 12.97, "#fff6d8");
  s.cyl(0.3, 0.32, 1.3, 10, [-2.4, G + 0.65, -12.4], "#d4202c");
  s.dome(0.33, 10, 4, [-2.4, G + 1.3, -12.4], "#d4202c");
  s.slab(-2.55, -2.25, G + 0.95, G + 1.02, -12.12, -12.08, "#1b1b1b");
  clockTower(k);
}

export function buildDucks(k: Kits) {
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    k.solid.at(Math.cos(a) * 2.5, 0.32, Math.sin(a) * 2.5, -a, () => {
      k.solid.sphere(0.22, 6, 4, [0, 0.1, 0], i === 2 ? "#6b4d32" : "#f7f7f2", [1, 0.7, 1.5]);
      k.solid.sphere(0.12, 6, 4, [0, 0.3, 0.25], i === 2 ? "#2f6b3a" : "#f7f7f2");
      k.solid.cone(0.05, 0.14, 4, [0, 0.29, 0.4], "#ff9a1a", [Math.PI / 2, 0, 0]);
    });
  }
}

const _face = new Matrix4();
const _rot = new Matrix4();
const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3(1, 1, 1);
const _axisY = new Vector3(0, 1, 0);

export function CentralPark({ mats }: { mats: LandmarkMaterials }) {
  const hands = useRef<InstancedMesh>(null);
  const ducks = useRef<Group>(null);
  const lastHour = useRef(Number.NaN);
  const handGeo = useMemo(() => new BoxGeometry(1, 1, 1).translate(0, 0.38, 0), []);
  useEffect(() => () => handGeo.dispose(), [handGeo]);

  useFrame((_, delta) => {
    const w = useWorld.getState();
    const dt = Math.min(delta, 0.1);
    if (ducks.current && !w.paused) ducks.current.rotation.y -= dt * 0.12;
    const im = hands.current;
    if (!im || w.timeOfDay === lastHour.current) return;
    lastHour.current = w.timeOfDay;
    const { hour, minute } = clockHandAngles(w.timeOfDay);
    FACES.forEach(([x, y, z, ry], i) => {
      _face.compose(_p.set(x, y, z), _q.setFromAxisAngle(_axisY, ry), _s.set(1, 1, 1));
      // hour hand
      _rot.makeRotationZ(-hour);
      _m.multiplyMatrices(_face, _rot);
      _m.multiply(_rot.compose(_p.set(0, 0, 0.07), _q.identity(), _s.set(0.2, 1.35, 0.05)));
      im.setMatrixAt(i * 2, _m);
      // minute hand
      _rot.makeRotationZ(-minute);
      _m.multiplyMatrices(_face, _rot);
      _m.multiply(_rot.compose(_p.set(0, 0, 0.11), _q.identity(), _s.set(0.13, 2.0, 0.05)));
      im.setMatrixAt(i * 2 + 1, _m);
    });
    im.instanceMatrix.needsUpdate = true;
  });

  return (
    <group position={[20, 0, 20]}>
      <Baked build={build} mats={mats} />
      <mesh position={[POND.x, 0.33, POND.z]} scale={[POND.sx, 1, 1]} material={mats.water} receiveShadow>
        <cylinderGeometry args={[4.15, 4.15, 0.06, 24]} />
      </mesh>
      <group ref={ducks} position={[POND.x, 0, POND.z]}>
        <Baked build={buildDucks} mats={mats} shadows={false} />
      </group>
      {FACES.map(([x, y, z, ry], i) => (
        <mesh key={i} position={[x, y, z]} rotation={[0, ry, 0]} material={mats.signs.clock}>
          <circleGeometry args={[2.35, 40]} />
        </mesh>
      ))}
      <instancedMesh ref={hands} args={[handGeo, mats.hands, 8]} frustumCulled={false} />
    </group>
  );
}
