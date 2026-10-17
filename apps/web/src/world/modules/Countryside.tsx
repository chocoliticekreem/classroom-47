"use client";
// Module: Countryside. Patchwork fields, hedgerows and dry-stone walls, a farm (house, red barn,
// silos, haystacks, tractor, duck pond), a windmill, wind turbines, grazing sheep and cows,
// rolling hills to the west, and instanced trees scattered over all open land outside the ring.
import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  Euler,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type Mesh,
} from "three";
import { useWorld } from "../store";
import { FARM, mulberry32 } from "./Countryside/layout";
import { TURBINE_HEIGHT, WINDMILL_RY, buildCountryside, treeGeometries, treeMatrices } from "./Countryside/scene";

type Built = ReturnType<typeof buildCountryside>;

const _m = new Matrix4();
const _base = new Matrix4();
const _loc = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();

function compose(out: Matrix4, x: number, y: number, z: number, ry: number, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz, "YXZ");
  return out.compose(_p.set(x, y, z), _q.setFromEuler(_e), _s.set(sx, sy, sz));
}

// --- Spinning things --------------------------------------------------------------------------

function Rotors({ built, mat }: { built: Built; mat: MeshStandardMaterial }) {
  const ref = useRef<InstancedMesh>(null);
  const hubs = useMemo(
    () =>
      built.turbines.map((t) => {
        const v = new Vector3(0, TURBINE_HEIGHT * t.scale + 0.3 * t.scale, 3.1 * t.scale);
        v.applyAxisAngle(new Vector3(0, 1, 0), WINDMILL_RY).add(new Vector3(t.x, t.y, t.z));
        return v;
      }),
    [built],
  );
  const angle = useRef(0);
  useLayoutEffect(() => {
    ref.current!.instanceMatrix.setUsage(DynamicDrawUsage);
  }, []);
  useFrame((_, delta) => {
    const mesh = ref.current;
    if (!mesh) return;
    if (!useWorld.getState().paused) angle.current += Math.min(delta, 0.1) * 1.1;
    built.turbines.forEach((t, i) => {
      const h = hubs[i];
      compose(_m, h.x, h.y, h.z, WINDMILL_RY, 0, angle.current + t.phase, t.scale, t.scale, t.scale);
      mesh.setMatrixAt(i, _m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[built.rotorGeo, mat, built.turbines.length]} castShadow frustumCulled={false} />;
}

function Sails({ built, mat }: { built: Built; mat: MeshStandardMaterial }) {
  const ref = useRef<Mesh>(null);
  const pos = useMemo(() => {
    const v = new Vector3(0, 13.8, 3.6).applyAxisAngle(new Vector3(0, 1, 0), WINDMILL_RY);
    return [FARM.windmill.x + v.x, v.y, FARM.windmill.z + v.z] as const;
  }, []);
  useFrame((_, delta) => {
    if (!ref.current || useWorld.getState().paused) return;
    ref.current.rotation.z += Math.min(delta, 0.1) * 0.55;
  });
  return (
    <mesh ref={ref} geometry={built.sailsGeo} material={mat} position={pos} rotation={[0, WINDMILL_RY, 0, "YXZ"]} castShadow />
  );
}

// --- Trees ----------------------------------------------------------------------------------------

// Trees near the city cast shadows; the thousands out in the far forests don't (shadow pass cost).
const SHADOW_REACH = 480;

function Trees({ built }: { built: Built }) {
  const { geos, mats, near, far } = useMemo(() => {
    const geos = treeGeometries();
    const mats = {
      trunk: new MeshStandardMaterial({ color: "#6b4a32", roughness: 0.9, flatShading: true }),
      crown: new MeshStandardMaterial({ color: "#ffffff", roughness: 0.82, flatShading: true }),
    };
    const isNear = (t: { x: number; z: number }) => Math.abs(t.x) < SHADOW_REACH && Math.abs(t.z) < SHADOW_REACH;
    return { geos, mats, near: built.trees.filter(isNear), far: built.trees.filter((t) => !isNear(t)) };
  }, [built]);
  useEffect(
    () => () => {
      geos.trunk.dispose();
      geos.crowns.forEach((g) => g.dispose());
      mats.trunk.dispose();
      mats.crown.dispose();
    },
    [geos, mats],
  );
  return (
    <group>
      <TreeSet trees={near} geos={geos} mats={mats} shadows />
      <TreeSet trees={far} geos={geos} mats={mats} shadows={false} />
    </group>
  );
}

type TreeGeos = ReturnType<typeof treeGeometries>;
interface TreeMats {
  trunk: MeshStandardMaterial;
  crown: MeshStandardMaterial;
}

function TreeSet({ trees, geos, mats, shadows }: { trees: Built["trees"]; geos: TreeGeos; mats: TreeMats; shadows: boolean }) {
  const data = useMemo(() => treeMatrices(trees), [trees]);
  const trunkRef = useRef<InstancedMesh>(null);
  const crownRefs = useRef<(InstancedMesh | null)[]>([]);
  useLayoutEffect(() => {
    const trunk = trunkRef.current!;
    trunk.instanceMatrix.array.set(data.trunk);
    trunk.instanceMatrix.needsUpdate = true;
    trunk.computeBoundingSphere();
    const c = new Color();
    data.crown.forEach((arr, s) => {
      const mesh = crownRefs.current[s];
      if (!mesh) return;
      mesh.instanceMatrix.array.set(arr);
      mesh.instanceMatrix.needsUpdate = true;
      data.crownColor[s].forEach((hex, i) => mesh.setColorAt(i, c.set(hex)));
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    });
  }, [data]);

  return (
    <group>
      <instancedMesh ref={trunkRef} args={[geos.trunk, mats.trunk, trees.length]} castShadow={shadows} />
      {geos.crowns.map((g, s) =>
        data.crown[s].length ? (
          <instancedMesh
            key={s}
            ref={(m) => {
              crownRefs.current[s] = m;
            }}
            args={[g, mats.crown, data.crown[s].length / 16]}
            castShadow={shadows}
          />
        ) : null,
      )}
    </group>
  );
}

// --- Grazing animals ------------------------------------------------------------------------------

interface Animal {
  pasture: number;
  cow: boolean;
  x: number;
  z: number;
  h: number;
  tx: number;
  tz: number;
  wait: number;
  head: number; // 0 up, 1 grazing
  phase: number;
  scale: number;
}

const DUCKS = 3;
const COW_PARTS = 6; // body, head, 4 legs
const SHEEP_DARK_PARTS = 5; // head, 4 legs

// local part layouts: [x, y, z, sx, sy, sz]
const SHEEP_LEGS: [number, number, number][] = [
  [0.24, 0.28, 0.38],
  [-0.24, 0.28, 0.38],
  [0.24, 0.28, -0.38],
  [-0.24, 0.28, -0.38],
];
const COW_LEGS: [number, number, number][] = [
  [0.36, 0.42, 0.72],
  [-0.36, 0.42, 0.72],
  [0.36, 0.42, -0.72],
  [-0.36, 0.42, -0.72],
];

function stepAnimal(a: Animal, dt: number, pastures: Built["pastures"], rand: () => number) {
  if (a.wait > 0) {
    a.wait -= dt;
    a.head = Math.min(1, a.head + dt * 1.5);
    if (a.wait <= 0) {
      // pick a nearby grazing spot so the herd drifts slowly
      const spots = pastures[a.pasture].spots;
      let best = spots[Math.floor(rand() * spots.length)];
      for (let k = 0; k < 6; k++) {
        const s = spots[Math.floor(rand() * spots.length)];
        if ((s[0] - a.x) ** 2 + (s[1] - a.z) ** 2 < 64) {
          best = s;
          break;
        }
      }
      a.tx = best[0];
      a.tz = best[1];
    }
    return;
  }
  a.head = Math.max(0, a.head - dt * 2);
  const dx = a.tx - a.x;
  const dz = a.tz - a.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.3) {
    a.wait = 4 + rand() * 12;
    return;
  }
  const want = Math.atan2(dx, dz);
  let diff = want - a.h;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  a.h += Math.sign(diff) * Math.min(Math.abs(diff), dt * 1.4);
  const speed = (a.cow ? 0.45 : 0.6) * (Math.abs(diff) > 1 ? 0.3 : 1);
  a.x += Math.sin(a.h) * speed * dt;
  a.z += Math.cos(a.h) * speed * dt;
  a.phase += dt * speed * 7;
}

function Animals({ built }: { built: Built }) {
  const { geos, mats, animals, cowColors, cowHeadColors } = useMemo(() => {
    const rand = mulberry32(42);
    const animals: Animal[] = [];
    built.pastures.forEach((p, pi) => {
      const n = p.count;
      for (let i = 0; i < n; i++) {
        const [x, z] = p.spots[Math.floor(rand() * p.spots.length)];
        animals.push({
          pasture: pi,
          cow: p.animal === "cow",
          x,
          z,
          h: rand() * Math.PI * 2,
          tx: x,
          tz: z,
          wait: rand() * 8,
          head: 1,
          phase: rand() * 6,
          scale: (p.animal === "cow" ? 1.45 : 1.6) * (0.9 + rand() * 0.2),
        });
      }
    });
    const cowPalette = ["#7a4a2a", "#2b2b2b", "#efece4", "#9b5a2e", "#2b2b2b"];
    const cowColors = animals.filter((a) => a.cow).map(() => cowPalette[Math.floor(rand() * cowPalette.length)]);
    const cowHeadColors = cowColors.map((c) => (c === "#7a4a2a" || c === "#9b5a2e" ? "#f2eee6" : c));
    const geos = {
      fluff: new IcosahedronGeometry(1, 1),
      box: new BoxGeometry(1, 1, 1),
    };
    const mats = {
      fluff: new MeshStandardMaterial({ color: "#f4f1ea", roughness: 0.95, flatShading: true }),
      dark: new MeshStandardMaterial({ color: "#2a2724", roughness: 0.9, flatShading: true }),
      parts: new MeshStandardMaterial({ color: "#ffffff", roughness: 0.85, flatShading: true }),
    };
    return { geos, mats, animals, cowColors, cowHeadColors };
  }, [built]);
  useEffect(
    () => () => {
      Object.values(geos).forEach((g) => g.dispose());
      Object.values(mats).forEach((m) => m.dispose());
    },
    [geos, mats],
  );

  const sheep = useMemo(() => animals.filter((a) => !a.cow), [animals]);
  const cows = useMemo(() => animals.filter((a) => a.cow), [animals]);
  const fluffRef = useRef<InstancedMesh>(null);
  const darkRef = useRef<InstancedMesh>(null);
  const partsRef = useRef<InstancedMesh>(null);
  const rand = useMemo(() => mulberry32(77), []);

  useLayoutEffect(() => {
    for (const r of [fluffRef, darkRef, partsRef]) r.current!.instanceMatrix.setUsage(DynamicDrawUsage);
    const parts = partsRef.current!;
    const c = new Color();
    cows.forEach((_, i) => {
      for (let k = 0; k < COW_PARTS; k++) {
        const hex = k === 1 ? cowHeadColors[i] : k >= 2 ? (cowColors[i] === "#efece4" ? "#3a3530" : cowColors[i]) : cowColors[i];
        parts.setColorAt(i * COW_PARTS + k, c.set(hex));
      }
    });
    for (let d = 0; d < DUCKS; d++) {
      const base = cows.length * COW_PARTS + d * 2;
      parts.setColorAt(base, c.set("#f6f3ea"));
      parts.setColorAt(base + 1, c.set(d === 0 ? "#2f7a44" : "#f6f3ea"));
    }
    parts.instanceColor!.needsUpdate = true;
  }, [cows, cowColors, cowHeadColors]);

  const time = useRef(0);
  useFrame((_, rawDelta) => {
    const fluff = fluffRef.current;
    const dark = darkRef.current;
    const parts = partsRef.current;
    if (!fluff || !dark || !parts) return;
    const paused = useWorld.getState().paused;
    const dt = paused ? 0 : Math.min(rawDelta, 0.1);
    time.current += dt;

    for (const a of animals) {
      if (dt > 0) stepAnimal(a, dt, built.pastures, rand);
    }

    sheep.forEach((a, i) => {
      compose(_base, a.x, 0, a.z, a.h, 0, 0, a.scale, a.scale, a.scale);
      const bob = a.wait > 0 ? 0 : Math.abs(Math.sin(a.phase * 2)) * 0.05;
      _loc.compose(_p.set(0, 0.82 + bob, 0), _q.identity(), _s.set(0.62, 0.5, 0.82));
      fluff.setMatrixAt(i, _m.multiplyMatrices(_base, _loc));
      const hy = 0.95 - a.head * 0.45;
      const hz = 0.82 + a.head * 0.12;
      compose(_loc, 0, hy + bob, hz, 0, a.head * 0.7, 0, 0.32, 0.36, 0.42);
      dark.setMatrixAt(i * SHEEP_DARK_PARTS, _m.multiplyMatrices(_base, _loc));
      SHEEP_LEGS.forEach(([lx, ly, lz], k) => {
        const swing = a.wait > 0 ? 0 : Math.sin(a.phase + (k % 3 === 0 ? 0 : Math.PI)) * 0.45;
        compose(_loc, lx, ly, lz, 0, swing, 0, 0.14, 0.56, 0.14);
        dark.setMatrixAt(i * SHEEP_DARK_PARTS + 1 + k, _m.multiplyMatrices(_base, _loc));
      });
    });

    cows.forEach((a, i) => {
      const o = i * COW_PARTS;
      compose(_base, a.x, 0, a.z, a.h, 0, 0, a.scale, a.scale, a.scale);
      _loc.compose(_p.set(0, 1.32, 0), _q.identity(), _s.set(0.95, 0.9, 1.9));
      parts.setMatrixAt(o, _m.multiplyMatrices(_base, _loc));
      compose(_loc, 0, 1.6 - a.head * 0.75, 1.2 + a.head * 0.15, 0, a.head * 0.6, 0, 0.55, 0.55, 0.72);
      parts.setMatrixAt(o + 1, _m.multiplyMatrices(_base, _loc));
      COW_LEGS.forEach(([lx, ly, lz], k) => {
        const swing = a.wait > 0 ? 0 : Math.sin(a.phase + (k % 3 === 0 ? 0 : Math.PI)) * 0.35;
        compose(_loc, lx, ly, lz, 0, swing, 0, 0.22, 0.86, 0.22);
        parts.setMatrixAt(o + 2 + k, _m.multiplyMatrices(_base, _loc));
      });
    });

    // ducks paddling round the pond
    const { x: px, z: pz, r } = FARM.pond;
    for (let d = 0; d < DUCKS; d++) {
      const ang = time.current * (0.12 + d * 0.03) + d * 2.1;
      const rad = r * (0.35 + d * 0.15);
      const x = px + Math.cos(ang) * rad * 1.1;
      const z = pz + Math.sin(ang) * rad * 0.8;
      const heading = Math.atan2(-Math.sin(ang) * 1.1, Math.cos(ang) * 0.8);
      const base = cows.length * COW_PARTS + d * 2;
      compose(_base, x, 0.08, z, heading, 0, 0, 1.3, 1.3, 1.3);
      _loc.compose(_p.set(0, 0.15, 0), _q.identity(), _s.set(0.42, 0.28, 0.7));
      parts.setMatrixAt(base, _m.multiplyMatrices(_base, _loc));
      _loc.compose(_p.set(0, 0.42, 0.28), _q.identity(), _s.set(0.22, 0.26, 0.24));
      parts.setMatrixAt(base + 1, _m.multiplyMatrices(_base, _loc));
    }

    fluff.instanceMatrix.needsUpdate = true;
    dark.instanceMatrix.needsUpdate = true;
    parts.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={fluffRef} args={[geos.fluff, mats.fluff, sheep.length]} castShadow frustumCulled={false} />
      <instancedMesh
        ref={darkRef}
        args={[geos.box, mats.dark, sheep.length * SHEEP_DARK_PARTS]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={partsRef}
        args={[geos.box, mats.parts, cows.length * COW_PARTS + DUCKS * 2]}
        castShadow
        frustumCulled={false}
      />
    </group>
  );
}

// --- Module ----------------------------------------------------------------------------------------

export default function Countryside() {
  const built = useMemo(() => buildCountryside(), []);
  const mats = useMemo(
    () => ({
      solid: new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 }),
      water: new MeshStandardMaterial({
        color: "#4f9fd6",
        roughness: 0.15,
        metalness: 0.1,
        emissive: new Color("#1d4f7a"),
        emissiveIntensity: 0.25,
      }),
    }),
    [],
  );
  useEffect(
    () => () => {
      built.staticGeo.dispose();
      built.flatGeo.dispose();
      built.rotorGeo.dispose();
      built.sailsGeo.dispose();
      built.waterGeo.dispose();
      mats.solid.dispose();
      mats.water.dispose();
    },
    [built, mats],
  );

  return (
    <group name="countryside">
      <mesh geometry={built.staticGeo} material={mats.solid} castShadow receiveShadow />
      <mesh geometry={built.flatGeo} material={mats.solid} receiveShadow />
      <mesh geometry={built.waterGeo} material={mats.water} position={[FARM.pond.x, 0.07, FARM.pond.z]} receiveShadow />
      <Rotors built={built} mat={mats.solid} />
      <Sails built={built} mat={mats.solid} />
      <Trees built={built} />
      <Animals built={built} />
    </group>
  );
}
