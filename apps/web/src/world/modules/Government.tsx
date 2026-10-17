"use client";
// Module: Government (Layer 3). The government quarter on the east side between the ring and the coast road:
// a White House-style residence (porticoes, wings, South Lawn fountain, helipad with a helicopter that lands and
// takes off, security fence, gate lodges), a Downing Street-style gated terrace (No. 10), the Ministry of
// Transport, a domed Parliament with a clock tower, an embassy with flags, a ceremonial Avenue with a Circus and a
// victory column, bollards and armed police (GPU-instanced, some on patrol). Flags wave on the GPU; facades are
// floodlit at night. Roads live in districts/government.ts (which also exports GOV_PLACES and GOV_DELIVERY_NODES).
// Reads useWorld.timeOfDay and paused. Writes nothing.
import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Euler, Group, InstancedMesh, Matrix4, Mesh, Quaternion, Vector3 } from "three";
import { useWorld } from "../store";
import { heliState, type HeliState } from "./Government/helicopter";
import { POLICE } from "./Government/layout";
import { makeMaterials, newUniforms, tickUniforms, type GovMaterials } from "./Government/materials";
import {
  CLOCK_CENTRE,
  CLOCK_FACE_Y,
  buildGovernment,
  handGeometry,
  heliBodyGeometry,
  heliRotorGeometry,
  heliTailRotorGeometry,
  policeGeometry,
} from "./Government/scene";
import { makeFlagAtlas, makeSignAtlas } from "./Government/textures";

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();

// ---- Armed police (one instanced mesh; positions and patrols computed in the vertex shader) -----------------------

function Police({ mats }: { mats: GovMaterials }) {
  const geo = useMemo(() => policeGeometry(), []);
  useEffect(() => () => geo.dispose(), [geo]);
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current!;
    _m.identity();
    for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, _m);
    mesh.instanceMatrix.needsUpdate = true;
  }, [geo]);
  // positions come from the shader, so instance bounds are meaningless: never cull
  return <instancedMesh ref={ref} args={[geo, mats.police, POLICE.length]} frustumCulled={false} />;
}

// ---- Clock tower hands (follow the city clock; updated once a game minute) --------------------------------------------

function ClockHands({ mats }: { mats: GovMaterials }) {
  const geo = useMemo(() => handGeometry(), []);
  useEffect(() => () => geo.dispose(), [geo]);
  const ref = useRef<InstancedMesh>(null);
  const last = useRef(-1);
  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const hour = useWorld.getState().timeOfDay;
    const minute = Math.floor(hour * 60);
    if (minute === last.current) return;
    last.current = minute;
    const th = ((((hour % 12) + 12) % 12) / 12) * Math.PI * 2;
    const tm = (((hour % 1) + 1) % 1) * Math.PI * 2;
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      for (const [j, ang, len, w] of [[0, th, 0.75, 0.16], [1, tm, 1.15, 0.1]] as const) {
        _p.set(CLOCK_CENTRE.x + Math.sin(a) * CLOCK_CENTRE.r, CLOCK_FACE_Y, CLOCK_CENTRE.z + Math.cos(a) * CLOCK_CENTRE.r);
        _e.set(0, a, -ang, "YXZ");
        _q.setFromEuler(_e);
        mesh.setMatrixAt(k * 2 + j, _m.compose(_p, _q, _s.set(w, len, 0.05)));
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  });
  return <instancedMesh ref={ref} args={[geo, mats.iron, 8]} />;
}

// ---- The residence helicopter -------------------------------------------------------------------------------------

function Helicopter({ mats }: { mats: GovMaterials }) {
  const geos = useMemo(() => ({ body: heliBodyGeometry(), rotor: heliRotorGeometry(), tail: heliTailRotorGeometry() }), []);
  useEffect(() => () => Object.values(geos).forEach((g) => g.dispose()), [geos]);
  const group = useRef<Group>(null);
  const rotor = useRef<Mesh>(null);
  const tail = useRef<Mesh>(null);
  const clock = useRef(30); // start part-way through the parked phase
  const spin = useRef(0);
  const st = useRef<HeliState>({ x: 0, y: 0, z: 0, yaw: 0, rotor: 0 });
  const prev = useRef<{ x: number; z: number; yaw: number } | null>(null);
  useFrame((_, delta) => {
    const g = group.current;
    if (!g || useWorld.getState().paused) return;
    const dt = Math.min(delta, 0.1);
    clock.current += dt;
    const s = heliState(clock.current, st.current);
    if (!prev.current) prev.current = { x: s.x, z: s.z, yaw: s.yaw };
    // bank into turns and pitch forward with speed, from the frame-to-frame motion
    const vx = (s.x - prev.current.x) / Math.max(dt, 1e-3);
    const vz = (s.z - prev.current.z) / Math.max(dt, 1e-3);
    let dyaw = s.yaw - prev.current.yaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    prev.current.x = s.x;
    prev.current.z = s.z;
    prev.current.yaw = s.yaw;
    const speed = Math.min(Math.hypot(vx, vz), 40);
    g.position.set(s.x, s.y, s.z);
    g.rotation.set(Math.min(speed * 0.012, 0.22), s.yaw, Math.max(-0.35, Math.min(0.35, (-dyaw / Math.max(dt, 1e-3)) * 0.6)), "YXZ");
    spin.current += dt * s.rotor * 30;
    if (rotor.current) rotor.current.rotation.y = spin.current;
    if (tail.current) tail.current.rotation.x = spin.current * 1.6;
  });
  return (
    <group ref={group}>
      <mesh geometry={geos.body} material={mats.solid} castShadow />
      <mesh ref={rotor} geometry={geos.rotor} material={mats.solid} position={[0, 4.25, 0.2]} />
      <mesh ref={tail} geometry={geos.tail} material={mats.solid} position={[0.2, 3.3, -8.0]} />
    </group>
  );
}

// ---- Module -------------------------------------------------------------------------------------------------------

export default function Government() {
  const scene = useMemo(() => buildGovernment(), []);
  const U = useMemo(() => newUniforms(), []);
  const atlases = useMemo(() => ({ flags: makeFlagAtlas(), signs: makeSignAtlas() }), []);
  const mats = useMemo(() => makeMaterials(U, atlases.flags, atlases.signs), [U, atlases]);
  useEffect(
    () => () => {
      for (const g of Object.values(scene)) g?.dispose();
    },
    [scene],
  );
  useEffect(() => () => Object.values(atlases).forEach((t) => t.dispose()), [atlases]);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  useFrame((_, delta) => {
    const w = useWorld.getState();
    tickUniforms(U, w.paused ? 0 : Math.min(delta, 0.1), w.timeOfDay);
  });

  return (
    <group name="government">
      {scene.ground && <mesh geometry={scene.ground} material={mats.ground} receiveShadow />}
      {scene.water && <mesh geometry={scene.water} material={mats.water} />}
      {scene.facade && <mesh geometry={scene.facade} material={mats.facade} castShadow receiveShadow />}
      {scene.solid && <mesh geometry={scene.solid} material={mats.solid} castShadow receiveShadow />}
      {scene.windows && <mesh geometry={scene.windows} material={mats.windows} />}
      {scene.glow && <mesh geometry={scene.glow} material={mats.glow} />}
      {scene.signs && <mesh geometry={scene.signs} material={mats.signs} />}
      <mesh geometry={scene.flags} material={mats.flags} />
      <mesh geometry={scene.jets} material={mats.jet} />
      <Police mats={mats} />
      <ClockHands mats={mats} />
      <Helicopter mats={mats} />
    </group>
  );
}
