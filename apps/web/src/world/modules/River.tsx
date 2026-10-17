"use client";
// Module: River. A big London river along config RIVER: GPU-animated water (flow, ripples, bank foam, boat
// wakes, sky/sunset/night tint), stone embankments with railings, promenades with plane trees, lamps and
// walkers, steps, piers and moored barges; six bridges (Orbital Viaduct, Albert suspension, Battersea steel
// arch, Millennium wobbly footbridge, Westminster stone arches, Tower Bridge) plus the Coast Lift Bridge at
// the mouth; river traffic (tour boats, clippers, a police launch, rowing eights) and a tall ship that sails
// in from the sea and back out every 90 s. Tower Bridge's bascules and the Coast Lift Bridge open for it: the
// span edges are blocked in the store while open (traffic queues / reroutes), with road:blocked/road:reopened.
// Road data for the bridges lives in districts/bridges.ts (merged into the shared graph by roads.ts).
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { spanEdge } from "../districts/bridges";
import { emit } from "../bus";
import { edgeKey } from "../roads";
import { useWorld } from "../store";
import { buildBanks, PROM_W, WALL_T } from "./River/banks";
import { buildBridges } from "./River/bridgeGeo";
import { clipper, policeLaunch, rowingEight, tallShip, tourBoat } from "./River/boats";
import { GeoBuilder, rng } from "./River/builder";
import {
  COAST_PASS_TIMES,
  MAX_LIFT_DEG,
  PASS_TIMES,
  basculeAt,
  loopPose,
  shipAt,
  type BasculeState,
  type LoopPose,
  type ShipState,
} from "./River/engine";
import { boatMaterial, pathTexture, walkerMaterial, wobbleMaterial, type WalkerUniforms } from "./River/materials";
import { BANK_X0, BANK_X1, HALF_W, poseAt, sAtX, type Pose } from "./River/path";
import { MAX_WAKES, applyRiverTime, createRiverMaterial, nightAmount, riverRibbon, waterPatch } from "./River/water";

const SEA_Y = -0.25;
const TOWER_NOTE = "Tower Bridge lifted for shipping";
const COAST_NOTE = "Coast Lift Bridge raised for shipping";
/** Sim clock starts here so the first lift happens ~15 s after load. */
const T0 = 8;

interface BoatSpec {
  kind: number; // index into archetypes
  sa: number;
  sb: number;
  lane: number;
  speed: number;
  u0: number;
  wake: number; // wake length (m)
}

const KINDS = [tourBoat, clipper, policeLaunch, rowingEight];

function boatSpecs(): BoatSpec[] {
  const R = rng(31);
  const out: BoatSpec[] = [];
  const add = (kind: number, x0: number, x1: number, lane: number, speed: number, n: number, wake: number) => {
    const sa = sAtX(x0);
    const sb = sAtX(x1);
    const L = 2 * (sb - sa) + 2 * Math.PI * lane;
    for (let i = 0; i < n; i++) out.push({ kind, sa, sb, lane, speed: speed * (0.9 + R() * 0.2), u0: (L * i) / n + R() * 40, wake });
  };
  add(0, -640, 200, 10, 5, 3, 45); // tour boats
  add(1, -660, 560, 11, 9, 2, 70); // clippers, out to sea and back
  add(2, -1050, 320, 6, 11, 1, 60); // police launch
  add(3, -1150, -560, 16, 5.5, 2, 25); // rowing eights upriver
  return out;
}

/** y of the water surface at x: river level inland, sea level past the mouth. */
function waterLevel(x: number) {
  const t = THREE.MathUtils.smoothstep(x, BANK_X1, BANK_X1 + 30);
  return 0.012 + (SEA_Y - 0.012) * t;
}

function buildRiver() {
  const disposables: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(x: T) => {
    disposables.push(x);
    return x;
  };

  const water = keep(riverRibbon());
  const waterMat = keep(createRiverMaterial());
  const patchMat = keep(createRiverMaterial());
  patchMat.uniforms.uFadeX0.value = 1e6;
  patchMat.uniforms.uFadeX1.value = 1e6 + 1;
  patchMat.transparent = false;

  const banks = buildBanks();
  keep(banks.geometry);
  const br = buildBridges();
  keep(br.geometry);
  keep(br.foot);
  keep(br.leaf);
  keep(br.liftSpan);

  const staticMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.02 }));
  const bridgeMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.1, flatShading: true }));

  const towerPatch = keep(waterPatch(br.tower.x - br.tower.leafHalfW - 0.6, br.tower.x + br.tower.leafHalfW + 0.6, br.tower.hingeN, br.tower.hingeS, 0.3));
  const coastPatch = keep(waterPatch(br.lift.x - br.lift.halfW - 0.9, br.lift.x + br.lift.halfW + 0.9, br.lift.c - br.lift.half, br.lift.c + br.lift.half, 0.95));

  // shared uniforms for walkers + wobble
  const shared: WalkerUniforms = { uTime: { value: 0 }, uWobble: { value: 0.12 } };
  const wobbleMat = keep(wobbleMaterial({ z0: br.footSpan.z0, z1: br.footSpan.z1 }, shared));

  // ---- lights (bridge fairy lights, lanterns, promenade lamp heads) ----
  const lightPts = [...br.lights, ...banks.lamps.map((l) => ({ x: l.x, y: 4.65, z: l.z, s: 0.42 }))];
  const lightGeo = keep(new THREE.OctahedronGeometry(1, 0));
  const lightMat = keep(new THREE.MeshStandardMaterial({ color: "#fff4dc", emissive: "#ffc56e", emissiveIntensity: 0, roughness: 0.4 }));
  const lights = keep(new THREE.InstancedMesh(lightGeo, lightMat, lightPts.length));
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p3 = new THREE.Vector3();
  const s3 = new THREE.Vector3();
  lightPts.forEach((l, i) => lights.setMatrixAt(i, m4.compose(p3.set(l.x, l.y, l.z), q.identity(), s3.setScalar(l.s))));
  lights.computeBoundingSphere();

  // ---- lamp posts ----
  const lampB = new GeoBuilder();
  lampB.cyl(0, 0.35, 0, 0.26, 0.32, 0.7, "#20352b", 8);
  lampB.cyl(0, 2.4, 0, 0.09, 0.13, 3.8, "#20352b", 6);
  lampB.box(0, 4.3, 0, 0.12, 0.12, 0.12, "#20352b");
  lampB.cone(0, 5.2, 0, 0.28, 0.4, "#20352b", 4);
  const lampGeo = keep(lampB.build());
  const lamps = keep(new THREE.InstancedMesh(lampGeo, staticMat, banks.lamps.length));
  banks.lamps.forEach((l, i) => lamps.setMatrixAt(i, m4.compose(p3.set(l.x, 0, l.z), q.setFromEuler(e.set(0, l.yaw, 0)), s3.setScalar(1))));
  lamps.computeBoundingSphere();

  // ---- trees ----
  const trunkGeo = keep(new THREE.CylinderGeometry(0.22, 0.32, 3.4, 6).translate(0, 1.7, 0));
  const crownGeo = keep(new THREE.IcosahedronGeometry(2.6, 0).scale(1, 1.15, 1).translate(0, 5.6, 0));
  const trunkMat = keep(new THREE.MeshStandardMaterial({ color: "#6e5a46", roughness: 0.9 }));
  const crownMat = keep(new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.85, flatShading: true }));
  const trunks = keep(new THREE.InstancedMesh(trunkGeo, trunkMat, banks.trees.length));
  const crowns = keep(new THREE.InstancedMesh(crownGeo, crownMat, banks.trees.length));
  const greens = ["#4f8a3a", "#5c9a41", "#6aa84f", "#47803a", "#78a94a", "#3f7535"].map((c) => new THREE.Color(c));
  const R = rng(11);
  banks.trees.forEach((t, i) => {
    m4.compose(p3.set(t.x, 0, t.z), q.setFromEuler(e.set(0, t.yaw, 0)), s3.setScalar(t.s));
    trunks.setMatrixAt(i, m4);
    crowns.setMatrixAt(i, m4);
    crowns.setColorAt(i, greens[Math.floor(R() * greens.length)]);
  });
  trunks.computeBoundingSphere();
  crowns.computeBoundingSphere();

  // ---- railing posts ----
  const postGeo = keep(new THREE.BoxGeometry(0.1, 1.0, 0.1).translate(0, 1.8, 0));
  const postMat = keep(new THREE.MeshStandardMaterial({ color: "#263034", roughness: 0.6, metalness: 0.4 }));
  const posts = keep(new THREE.InstancedMesh(postGeo, postMat, banks.posts.length));
  banks.posts.forEach((p, i) => posts.setMatrixAt(i, m4.compose(p3.set(p.x, 0, p.z), q.identity(), s3.setScalar(1))));
  posts.computeBoundingSphere();

  // ---- boats ----
  const specs = boatSpecs();
  const boatMat = keep(boatMaterial(br.footprints));
  const boats = KINDS.map((make, k) => {
    const g = keep(make());
    const n = specs.filter((s) => s.kind === k).length;
    const mesh = keep(new THREE.InstancedMesh(g, boatMat, Math.max(1, n)));
    mesh.count = n;
    mesh.frustumCulled = false; // they roam the whole river
    mesh.castShadow = true;
    return mesh;
  });
  const shipGeo = keep(tallShip());
  const shipMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, flatShading: true }));

  // ---- walkers ----
  const walkB = new GeoBuilder();
  walkB.box(0, 0.55, 0, 0.5, 1.1, 0.32, "#ffffff");
  walkB.box(0, 1.33, 0, 0.3, 0.32, 0.3, "#f0d2b4");
  const walkGeo = keep(walkB.build());
  const R2 = rng(5);
  const nProm = 620;
  const nFoot = 46;
  const aWalk = new Float32Array((nProm + nFoot) * 4);
  const range: [number, number] = [sAtX(BANK_X0 + 20), sAtX(BANK_X1 - 8)];
  const footLen = br.footSpan.z1 - br.footSpan.z0;
  for (let i = 0; i < nProm + nFoot; i++) {
    const dir = R2() < 0.5 ? -1 : 1;
    if (i < nProm) {
      const side = R2() < 0.5 ? -1 : 1;
      aWalk.set([R2() * (range[1] - range[0]), dir * (0.9 + R2() * 0.7), side * (HALF_W + WALL_T + 1.8 + R2() * (PROM_W - 5)), 0], i * 4);
    } else {
      aWalk.set([R2() * footLen, dir * (1.0 + R2() * 0.5), (R2() - 0.5) * 3.2, 1], i * 4);
    }
  }
  walkGeo.setAttribute("aWalk", new THREE.InstancedBufferAttribute(aWalk, 4));
  const pTex = keep(pathTexture());
  const walkMat = keep(walkerMaterial(pTex, range, { x: br.footSpan.x, z0: br.footSpan.z0, z1: br.footSpan.z1, y: 0.86 }, shared));
  const walkers = keep(new THREE.InstancedMesh(walkGeo, walkMat, nProm + nFoot));
  const clothes = ["#c0392b", "#2e6fb7", "#2c3e50", "#e0b52c", "#7f8c8d", "#16a085", "#8e44ad", "#d35400", "#ecf0f1", "#34495e", "#ff6a1a"].map((c) => new THREE.Color(c));
  for (let i = 0; i < nProm + nFoot; i++) {
    walkers.setMatrixAt(i, m4.identity());
    walkers.setColorAt(i, clothes[Math.floor(R2() * clothes.length)]);
  }
  walkers.frustumCulled = false;

  return {
    water, waterMat, patchMat, banks, br, staticMat, bridgeMat, towerPatch, coastPatch, wobbleMat, shared,
    lights, lightMat, lamps, trunks, crowns, posts, boats, specs, shipGeo, shipMat, walkers,
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}

export default function River() {
  const R = useMemo(() => buildRiver(), []);
  useEffect(() => R.dispose, [R]);

  const leafN = useRef<THREE.Group>(null);
  const leafS = useRef<THREE.Group>(null);
  const liftRef = useRef<THREE.Mesh>(null);
  const towerPatchRef = useRef<THREE.Mesh>(null);
  const coastPatchRef = useRef<THREE.Mesh>(null);
  const shipRef = useRef<THREE.Mesh>(null);

  // per-frame scratch (no allocations in the loop)
  const st = useMemo(
    () => ({
      t: T0,
      hour: -1,
      lp: { s: 0, lat: 0, ds: 1, dl: 0 } as LoopPose,
      pose: { x: 0, z: 0, tx: 1, tz: 0 } as Pose,
      ship: { s: 0, dir: 1, speed: 0 } as ShipState,
      tower: { lift: 0, closed: false } as BasculeState,
      coast: { lift: 0, closed: false } as BasculeState,
      closed: { tower: false, coast: false },
      m: new THREE.Matrix4(),
      q: new THREE.Quaternion(),
      p: new THREE.Vector3(),
      s: new THREE.Vector3(1, 1, 1),
      e: new THREE.Euler(),
      counters: new Int32Array(4),
    }),
    [],
  );

  // Night lighting: update on timeOfDay change only.
  useEffect(() => {
    const apply = (h: number) => {
      const n = nightAmount(h);
      R.lightMat.emissiveIntensity = n * 2.6;
      R.lightMat.color.setScalar(0.75 + 0.25 * (1 - n));
      applyRiverTime(R.waterMat, h);
      applyRiverTime(R.patchMat, h);
    };
    apply(useWorld.getState().timeOfDay);
    return useWorld.subscribe((s, p) => {
      if (s.timeOfDay !== p.timeOfDay) apply(s.timeOfDay);
    });
  }, [R]);

  // Release any closures we hold if the module unmounts.
  useEffect(
    () => () => {
      const w = useWorld.getState();
      for (const [id, note] of [["tower", TOWER_NOTE], ["coast", COAST_NOTE]] as const) {
        const key = edgeKey(...spanEdge(id));
        if (w.blocked[key] === note) {
          w.unblockEdge(key);
          emit({ type: "road:reopened", edgeKey: key });
        }
      }
    },
    [],
  );

  useFrame((state, delta) => {
    const w = useWorld.getState();
    const dt = w.paused ? 0 : Math.min(delta, 0.1);
    st.t += dt;
    const t = st.t;

    // water + walkers clocks
    R.waterMat.uniforms.uTime.value += dt;
    R.patchMat.uniforms.uTime.value = R.waterMat.uniforms.uTime.value;
    R.shared.uTime.value = t;
    R.shared.uWobble.value = 0.1 + 0.22 * Math.max(0, Math.sin(t * 0.07));
    const fog = state.scene.fog;
    if (fog) {
      (R.waterMat.uniforms.uHorizon.value as THREE.Color).copy(fog.color);
      (R.patchMat.uniforms.uHorizon.value as THREE.Color).copy(fog.color);
    }

    const wakes = R.waterMat.uniforms.uWakes.value as THREE.Vector4[];
    const wakeLen = R.waterMat.uniforms.uWakeLen.value as number[];
    let wi = 0;

    // ---- river boats ----
    st.counters.fill(0);
    for (const b of R.specs) {
      loopPose(b.u0 + b.speed * t, b.sa, b.sb, b.lane, st.lp);
      poseAt(st.lp.s, st.pose);
      const nx = -st.pose.tz;
      const nz = st.pose.tx;
      const x = st.pose.x + nx * st.lp.lat;
      const z = st.pose.z + nz * st.lp.lat;
      const hx = st.pose.tx * st.lp.ds + nx * st.lp.dl;
      const hz = st.pose.tz * st.lp.ds + nz * st.lp.dl;
      const yaw = Math.atan2(hx, hz);
      const bob = Math.sin(t * 1.6 + b.u0) * 0.06;
      st.e.set(Math.sin(t * 1.1 + b.u0) * 0.015, yaw, Math.sin(t * 1.3 + b.u0 * 0.7) * 0.025);
      st.m.compose(st.p.set(x, waterLevel(x) + bob, z), st.q.setFromEuler(st.e), st.s);
      const mesh = R.boats[b.kind];
      mesh.setMatrixAt(st.counters[b.kind]++, st.m);
      if (wi < MAX_WAKES) {
        wakes[wi].set(x, z, hx, hz);
        wakeLen[wi] = b.wake;
        wi++;
      }
    }
    for (const mesh of R.boats) mesh.instanceMatrix.needsUpdate = true;

    // ---- tall ship ----
    shipAt(t, st.ship);
    poseAt(st.ship.s, st.pose);
    const ship = shipRef.current;
    if (ship) {
      const hx = st.pose.tx * st.ship.dir;
      const hz = st.pose.tz * st.ship.dir;
      ship.position.set(st.pose.x, waterLevel(st.pose.x) + Math.sin(t * 0.9) * 0.1, st.pose.z);
      ship.rotation.set(0, Math.atan2(hx, hz), Math.sin(t * 0.7) * 0.02);
      if (wi < MAX_WAKES) {
        wakes[wi].set(st.pose.x, st.pose.z, st.ship.speed > 0.3 ? hx : 0, st.ship.speed > 0.3 ? hz : 0);
        wakeLen[wi] = 22 + st.ship.speed * 6;
        wi++;
      }
    }
    for (; wi < MAX_WAKES; wi++) wakes[wi].set(0, 0, 0, 0);

    // ---- Tower Bridge bascules + Coast Lift Bridge ----
    basculeAt(t, st.tower, PASS_TIMES);
    basculeAt(t, st.coast, COAST_PASS_TIMES);
    const ang = THREE.MathUtils.degToRad(MAX_LIFT_DEG) * st.tower.lift;
    if (leafN.current) leafN.current.rotation.x = -ang;
    if (leafS.current) leafS.current.rotation.x = ang;
    if (towerPatchRef.current) towerPatchRef.current.visible = st.tower.lift > 0.02;
    if (liftRef.current) liftRef.current.position.y = st.coast.lift * R.br.lift.maxY;
    if (coastPatchRef.current) coastPatchRef.current.visible = st.coast.lift > 0.01;

    // Road closures: store writes only on transitions.
    for (const [id, s, note] of [["tower", st.tower, TOWER_NOTE], ["coast", st.coast, COAST_NOTE]] as const) {
      if (s.closed === st.closed[id]) continue;
      st.closed[id] = s.closed;
      const key = edgeKey(...spanEdge(id));
      if (s.closed) {
        if (!(key in w.blocked)) {
          w.blockEdge(key, note);
          emit({ type: "road:blocked", edgeKey: key, reason: note });
        }
      } else if (w.blocked[key] === note) {
        w.unblockEdge(key);
        emit({ type: "road:reopened", edgeKey: key });
      }
    }
  });

  const { br } = R;
  return (
    <group name="river">
      <mesh geometry={R.water} material={R.waterMat} renderOrder={1} />
      <mesh geometry={R.banks.geometry} material={R.staticMat} receiveShadow />
      <mesh geometry={br.geometry} material={R.bridgeMat} castShadow receiveShadow />
      <mesh geometry={br.foot} material={R.wobbleMat} castShadow receiveShadow />
      <group ref={leafN} position={[br.tower.x, 0, br.tower.hingeN]}>
        <mesh geometry={br.leaf} material={R.bridgeMat} castShadow receiveShadow />
      </group>
      <group ref={leafS} position={[br.tower.x, 0, br.tower.hingeS]} rotation={[0, 0, 0]}>
        <mesh geometry={br.leaf} material={R.bridgeMat} rotation={[0, Math.PI, 0]} castShadow receiveShadow />
      </group>
      <mesh ref={liftRef} geometry={br.liftSpan} material={R.bridgeMat} position={[br.lift.x, 0, br.lift.c]} castShadow receiveShadow />
      <mesh ref={towerPatchRef} geometry={R.towerPatch} material={R.patchMat} visible={false} />
      <mesh ref={coastPatchRef} geometry={R.coastPatch} material={R.patchMat} visible={false} />
      <primitive object={R.lights} />
      <primitive object={R.lamps} />
      <primitive object={R.trunks} />
      <primitive object={R.crowns} />
      <primitive object={R.posts} />
      {R.boats.map((b, i) => (
        <primitive key={i} object={b} />
      ))}
      <mesh ref={shipRef} geometry={R.shipGeo} material={R.shipMat} castShadow />
      <primitive object={R.walkers} />
    </group>
  );
}
