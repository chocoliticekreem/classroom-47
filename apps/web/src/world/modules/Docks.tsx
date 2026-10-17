"use client";
// Module: Docks. The harbour east of downtown: quay wall, STS cranes working a moored container
// ship, a container yard, sheds, light towers and a straddle carrier on a private loop.
// Static layout + animation timelines live in ./Docks/layout.ts (unit tested).
import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { WATER_X, ZONES } from "../config";
import { useWorld } from "../store";
import {
  APRON_Y,
  CONTAINER,
  CRANES,
  CRANE_SLOT_ROW,
  LIGHT_TOWERS,
  SHEDS,
  SHIP,
  SHIP_BAYS,
  SHIP_ROWS,
  docksRand,
  nightFactor,
  shipBayZ,
  shipBob,
  shipRoll,
  shipRowX,
  straddleAt,
  yardSlots,
  type StraddleState,
} from "./Docks/layout";
import {
  BRANDS,
  apronTexture,
  atlasBoxGeometry,
  containerTexture,
  hullNameTexture,
  signTexture,
} from "./Docks/textures";
import {
  beam,
  box,
  hullGeometry,
  shedGeometry,
  shipWindowGeometry,
  straddleGeometry,
  superstructureGeometry,
} from "./Docks/geometry";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import PortCranes from "./Docks/PortCranes";

const TINTS = ["#c0392b", "#2e6fb7", "#3f8f4f", "#e0b52c", "#2a9d8f", "#8e3b46", "#8a9199", "#c76b29", "#e6e6e2", "#2c3e75", "#6d4c8c"];

interface InstSpec {
  m: THREE.Matrix4[];
  c?: THREE.Color[];
}

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const _e = new THREE.Euler();
function mat(x: number, y: number, z: number, yaw = 0, sx = 1, sy = 1, sz = 1, rz = 0) {
  _e.set(0, yaw, rz);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(_e), new THREE.Vector3(sx, sy, sz));
}

function Static({
  geometry,
  material,
  spec,
  cast = false,
  receive = false,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  spec: InstSpec;
  cast?: boolean;
  receive?: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    spec.m.forEach((m, i) => mesh.setMatrixAt(i, m));
    if (spec.c) spec.c.forEach((c, i) => mesh.setColorAt(i, c));
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.computeBoundingBox();
  }, [spec]);
  if (spec.m.length === 0) return null;
  return <instancedMesh ref={ref} args={[geometry, material, spec.m.length]} castShadow={cast} receiveShadow={receive} />;
}

function std(color: string, extra: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.05, ...extra });
}

export default function Docks() {
  // ---------- resources ----------
  const R = useMemo(() => {
    const containerGeo = atlasBoxGeometry();
    const genericMat = std("#ffffff", { map: containerTexture() });
    const brandMats = BRANDS.map((b) => std("#ffffff", { map: containerTexture(b) }));
    const vc = std("#ffffff", { vertexColors: true, flatShading: true });
    const lamp = std("#fff4d6", { emissive: new THREE.Color("#ffd58a"), emissiveIntensity: 0.2 });
    const red = std("#ff3b2f", { emissive: new THREE.Color("#ff2a1a"), emissiveIntensity: 0.5 });
    const windows = std("#22303f", { emissive: new THREE.Color("#ffcf7a"), emissiveIntensity: 0, roughness: 0.3 });
    const pool = new THREE.MeshBasicMaterial({
      color: "#ffcf8a",
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const apronMap = apronTexture();
    const apron = std("#ffffff", { map: apronMap, roughness: 0.92 });
    const concrete = std("#8d8a83", { roughness: 0.95 });
    const coping = std("#d3cec4");
    const darkRubber = std("#1d1d1f", { roughness: 0.9 });
    const bollard = std("#2d2f33", { roughness: 0.6, metalness: 0.3 });
    const steel = std("#5d636b", { metalness: 0.4, roughness: 0.6 });
    const hullLow = std("#9e2f28");
    const hullBoot = std("#f2f0ea");
    const hullTop = std("#1f2e4a");
    const deck = std("#4a5a52");
    const nameMap = hullNameTexture();
    const hullName = std("#ffffff", { map: nameMap, transparent: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
    const signMaps = [
      ...SHEDS.map((s, i) => signTexture(s.sign, i === 0 ? "#ff6a1a" : "#24427f", "#ffffff", 1024, 128)),
      signTexture("PORT OF HAMYWAY", "#1f2e4a", "#ffffff", 1024, 192, "BERTH 3 · CONTAINER TERMINAL"),
    ];
    const signMats = signMaps.map((m) =>
      std("#ffffff", { map: m, emissiveMap: m, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0.05 }),
    );
    const disposables: { dispose(): void }[] = [
      containerGeo, genericMat, ...brandMats, vc, lamp, red, windows, pool, apronMap, apron, concrete, coping,
      darkRubber, bollard, steel, hullLow, hullBoot, hullTop, deck, nameMap, hullName, ...signMaps, ...signMats,
      ...(genericMat.map ? [genericMat.map] : []), ...brandMats.map((m) => m.map!),
    ];
    return {
      containerGeo, genericMat, brandMats, vc, lamp, red, windows, pool, apron, concrete, coping, darkRubber,
      bollard, steel, hullLow, hullBoot, hullTop, deck, hullName, signMats, disposables,
    };
  }, []);

  const G = useMemo(() => {
    const zb = ZONES.docks;
    const g = {
      straddle: straddleGeometry(),
      hullLow: hullGeometry(SHIP.keelY, 0.45),
      hullBoot: hullGeometry(0.45, 0.85),
      hullTop: hullGeometry(0.85, SHIP.deckY),
      superstructure: superstructureGeometry(),
      shipWindows: shipWindowGeometry(),
      hullName: (() => {
        const a = new THREE.PlaneGeometry(56, 3.6).rotateY(-Math.PI / 2).translate(-SHIP.beam / 2 - 0.06, 3.1, 8);
        const b = new THREE.PlaneGeometry(56, 3.6).rotateY(Math.PI / 2).translate(SHIP.beam / 2 + 0.06, 3.1, 8);
        return mergeGeometries([a, b], false)!;
      })(),
      apron: new THREE.PlaneGeometry(WATER_X - zb.minX, zb.maxZ - zb.minZ)
        .rotateX(-Math.PI / 2)
        .translate((WATER_X + zb.minX) / 2, 0.012, (zb.maxZ + zb.minZ) / 2),
      quayWall: box(7, 9, zb.maxZ - zb.minZ + 0.6, WATER_X - 3.5, -4.5 + 0.005, 0),
      coping: box(0.6, 0.28, zb.maxZ - zb.minZ, WATER_X - 0.3, 0.14, 0),
      bollard: (() => {
        const a = new THREE.CylinderGeometry(0.3, 0.38, 0.8, 8).translate(0, 0.4, 0);
        const b = new THREE.CylinderGeometry(0.46, 0.46, 0.18, 8).translate(0, 0.86, 0);
        return mergeGeometries([a, b], false)!;
      })(),
      fender: new THREE.TorusGeometry(0.75, 0.32, 6, 12).rotateY(Math.PI / 2),
      moorings: (() => {
        const L: [number, number, number, number][] = [
          [-74, -64, 1, 0], [-70, -57, 1, 0], [72, 64, 1, 0], [68, 57, 1, 0], [-22, -8, 1, 0], [22, 8, 1, 0],
        ];
        const xs = SHIP.x - SHIP.beam / 2 + 1;
        return mergeGeometries(
          L.map(([sz, bz]) => beam([WATER_X - 0.6, 0.9, bz], [xs, SHIP.deckY + 0.4, sz], 0.14).toNonIndexed()),
          false,
        )!;
      })(),
      pole: new THREE.CylinderGeometry(0.28, 0.42, 28, 6).translate(0, 14, 0),
      lampHead: (() => {
        const parts = [box(3.6, 0.3, 1.6, 0, 28.2, 0), box(1, 0.9, 1.1, -1.2, 27.7, 0), box(1, 0.9, 1.1, 1.2, 27.7, 0)];
        return mergeGeometries(parts.map((p) => p.toNonIndexed()), false)!;
      })(),
      poolDisc: new THREE.CircleGeometry(15, 24).rotateX(-Math.PI / 2),
      shed: SHEDS.map((s) => shedGeometry(s.w, s.d, s.h, s.color)),
      shedSign: new THREE.PlaneGeometry(20, 2.4),
    };
    return g;
  }, []);

  // ---------- static instance layouts ----------
  const L = useMemo(() => {
    const generic: InstSpec = { m: [], c: [] };
    const brands: InstSpec[] = BRANDS.map(() => ({ m: [] }));
    const col = new THREE.Color();
    for (const s of yardSlots()) {
      const r = docksRand(s.seed);
      for (let t = 0; t < s.tiers; t++) {
        const y = APRON_Y + t * CONTAINER.h + CONTAINER.h / 2;
        const p = r();
        const sz = s.short ? 0.5 : 1;
        const m = mat(s.x, y, s.z, 0, 1, 1, sz);
        const b = s.short ? -1 : p < 0.1 ? 0 : p < 0.15 ? 1 : p < 0.2 ? 2 : p < 0.24 ? 3 : -1;
        if (b >= 0) brands[b].m.push(m);
        else {
          generic.m.push(m);
          generic.c!.push(col.set(TINTS[Math.floor(r() * TINTS.length)]).clone());
        }
      }
    }
    // ship deck (ship-local x)
    const shipGeneric: InstSpec = { m: [], c: [] };
    const shipRivet: InstSpec = { m: [] };
    const r = docksRand(99);
    for (let k = 0; k < SHIP_BAYS; k++)
      for (let i = 0; i < SHIP_ROWS; i++) {
        const crane = CRANES.find((c) => Math.abs(c.z - shipBayZ(k)) < 0.1);
        const n = crane && i === CRANE_SLOT_ROW ? crane.shipStack : 2 + Math.floor(r() * (i === 0 || i === SHIP_ROWS - 1 ? 2.5 : 4));
        for (let t = 0; t < n; t++) {
          const m = mat(shipRowX(i) - SHIP.x, SHIP.deckY + t * CONTAINER.h + CONTAINER.h / 2, shipBayZ(k));
          if (r() < 0.22) shipRivet.m.push(m);
          else {
            shipGeneric.m.push(m);
            shipGeneric.c!.push(col.set(TINTS[Math.floor(r() * TINTS.length)]).clone());
          }
        }
      }
    const zb = ZONES.docks;
    const bollards: InstSpec = { m: [] };
    const fenders: InstSpec = { m: [] };
    for (let z = zb.minZ + 3; z <= zb.maxZ - 3; z += 7) {
      bollards.m.push(mat(WATER_X - 0.6, APRON_Y, z));
      fenders.m.push(mat(WATER_X + 0.3, -1.1, z + 3.5));
    }
    const poles: InstSpec = { m: LIGHT_TOWERS.map((t) => mat(t.x, 0, t.z)) };
    const heads: InstSpec = { m: LIGHT_TOWERS.map((t, i) => mat(t.x, 0, t.z, (i * 0.7) % Math.PI)) };
    const pools: InstSpec = { m: LIGHT_TOWERS.map((t) => mat(t.x, 0.08, t.z)) };
    return { generic, brands, shipGeneric, shipRivet, bollards, fenders, poles, heads, pools };
  }, []);

  useEffect(
    () => () => {
      for (const d of R.disposables) d.dispose();
      for (const g of Object.values(G)) {
        if (g instanceof THREE.BufferGeometry) g.dispose();
        else if (Array.isArray(g)) for (const x of g) if (x instanceof THREE.BufferGeometry) x.dispose();
      }
    },
    [R, G],
  );

  // ---------- animated refs ----------
  const boxes = useRef<THREE.InstancedMesh>(null);
  const ship = useRef<THREE.Group>(null);
  const straddle = useRef<THREE.Group>(null);
  const sim = useRef({ t: 0, night: -1, ss: {} as StraddleState });

  const mats = useRef(R); // materials are tweaked per frame (night, beacon blink) through the ref
  useFrame((_, delta) => {
    const S = sim.current;
    const M = mats.current;
    const w = useWorld.getState();
    if (!w.paused) S.t += Math.min(delta, 0.1);
    const t = S.t;

    // night lighting (only touch materials when it changes)
    const n = nightFactor(w.timeOfDay);
    if (Math.abs(n - S.night) > 0.01) {
      S.night = n;
      M.lamp.emissiveIntensity = 0.2 + n * 3.2;
      M.windows.emissiveIntensity = n * 1.6;
      M.pool.opacity = n * 0.22;
      M.pool.visible = n > 0.02;
      for (const m of M.signMats) m.emissiveIntensity = 0.05 + n * 0.7;
    }
    M.red.emissiveIntensity = (Math.sin(t * 2.6) > 0.55 ? 2.5 : 0.25) * (0.4 + n);

    // ship
    if (ship.current) {
      ship.current.position.y = shipBob(t);
      ship.current.rotation.z = shipRoll(t);
    }

    // yard-loop straddle carrier (the STS cranes + quay carriers live in ./Docks/PortCranes)
    const bx = boxes.current;
    if (bx) {
      const st = straddleAt(t, S.ss);
      bx.setMatrixAt(0, setM(st.boxX, st.boxY + CONTAINER.h / 2, st.boxZ, st.boxYaw, 1, 0));
      bx.instanceMatrix.needsUpdate = true;
      if (straddle.current) {
        straddle.current.position.set(st.x, APRON_Y, st.z);
        straddle.current.rotation.y = st.yaw;
      }
    }
  });

  const zb = ZONES.docks;
  return (
    <group name="docks">
      {/* apron + quay */}
      <mesh geometry={G.apron} material={R.apron} receiveShadow />
      <mesh geometry={G.quayWall} material={R.concrete} />
      <mesh geometry={G.coping} material={R.coping} receiveShadow />
      <Static geometry={G.bollard} material={R.bollard} spec={L.bollards} />
      <Static geometry={G.fender} material={R.darkRubber} spec={L.fenders} />

      {/* container yard */}
      <Static geometry={R.containerGeo} material={R.genericMat} spec={L.generic} cast receive />
      {L.brands.map((b, i) => (
        <Static key={i} geometry={R.containerGeo} material={R.brandMats[i]} spec={b} cast receive />
      ))}

      {/* STS cranes working the berth, quay straddle carriers, buffer blocks, crews, quay lights */}
      <PortCranes
        containerGeo={R.containerGeo}
        genericMat={R.genericMat}
        brandMats={R.brandMats}
        vc={R.vc}
        lamp={R.lamp}
        red={R.red}
        steel={R.steel}
      />
      <instancedMesh ref={boxes} args={[R.containerGeo, R.brandMats[0], 1]} frustumCulled={false} castShadow />

      {/* straddle carrier */}
      <group ref={straddle}>
        <mesh geometry={G.straddle} material={R.vc} castShadow />
      </group>

      {/* ship hull + deck cargo + mooring lines are drawn by the Shipping module (berths.ts BERTHS.docks) */}

      {/* sheds */}
      {SHEDS.map((s, i) => (
        <group key={i} position={[s.x, 0, s.z]}>
          <mesh geometry={G.shed[i]} material={R.vc} castShadow receiveShadow />
          <mesh
            geometry={G.shedSign}
            material={R.signMats[i]}
            position={[0, s.h - 2.4, (s.z < 0 ? 1 : -1) * (s.d / 2 + 0.2)]}
            rotation={[0, s.z < 0 ? 0 : Math.PI, 0]}
          />
        </group>
      ))}

      {/* gate: gatehouse + overhead sign gantry over the dock road */}
      <group position={[zb.minX + 7, 0, 0]}>
        <mesh position={[5, 1.6, 10]} material={R.coping} castShadow>
          <boxGeometry args={[5, 3.2, 4]} />
        </mesh>
        <mesh position={[5, 3.4, 10]} material={R.brandMats[0]}>
          <boxGeometry args={[5.6, 0.4, 4.6]} />
        </mesh>
        {[-7, 7].map((z) => (
          <mesh key={z} position={[0, 4.4, z]} material={R.steel} castShadow>
            <boxGeometry args={[0.5, 8.8, 0.5]} />
          </mesh>
        ))}
        <mesh position={[0, 8.6, 0]} material={R.steel}>
          <boxGeometry args={[0.6, 0.6, 14.6]} />
        </mesh>
        <mesh position={[-0.35, 8.6, 0]} rotation={[0, -Math.PI / 2, 0]} material={R.signMats[SHEDS.length]}>
          <planeGeometry args={[12, 2.25]} />
        </mesh>
        <mesh position={[0.35, 8.6, 0]} rotation={[0, Math.PI / 2, 0]} material={R.signMats[SHEDS.length]}>
          <planeGeometry args={[12, 2.25]} />
        </mesh>
      </group>

      {/* light towers */}
      <Static geometry={G.pole} material={R.steel} spec={L.poles} cast />
      <Static geometry={G.lampHead} material={R.lamp} spec={L.heads} />
      <Static geometry={G.poolDisc} material={R.pool} spec={L.pools} />
    </group>
  );
}

function setM(x: number, y: number, z: number, yaw: number, sy: number, rz: number) {
  _e.set(0, yaw, rz);
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(1, sy, 1);
  return _m.compose(_p, _q, _s);
}
