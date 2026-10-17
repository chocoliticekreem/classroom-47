"use client";
// Module: OldTown (Layer 2). A walled historic town west of the countryside: a ring boulevard on the line of
// the old walls (surviving stretches, towers, the East Gate and West Bar), winding lanes radiating from the
// market square, a St Paul's-style domed cathedral in its churchyard, a gothic abbey, a castle keep on a
// mound, a university quad, parish spires, a canal with a lock and narrowboats, and a Georgian new town
// (crescent + garden square). ~1200 seeded houses (Tudor, stone, brick, Georgian, stucco) with chimney pots,
// shops and pubs with hanging signs; gas lamps; market-day crowds.
// Roads live in districts/oldTown.ts (merged into the shared graph). This module reads useWorld.timeOfDay
// (windows, lamps, floodlights, clock) and paused (crowds, boats, flag). It writes nothing.
import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  Euler,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from "three";
import { useWorld } from "../store";
import { CANAL_LENGTH, CASTLE_FLAG, CLOCK, canalFrame } from "./OldTown/landmarks";
import { makeMaterials, newUniforms, tickUniforms, type OldTownMaterials } from "./OldTown/materials";
import { boatGeometry, buildOldTown, personGeometry, type OldTownScene } from "./OldTown/scene";
import { OLD_TOWN } from "../districts/oldTown";
import { mulberry32 } from "./OldTown/layout";

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3(1, 1, 1);
const _sc = new Vector3();

// ---- Crowds (GPU) ---------------------------------------------------------------------------------------

const SHIRTS = ["#c0392b", "#2e86c1", "#27ae60", "#f1c40f", "#8e44ad", "#ecf0f1", "#34495e", "#e67e22", "#16a085", "#7f8c8d", "#d35400"];

function Crowd({ scene, mats }: { scene: OldTownScene; mats: OldTownMaterials }) {
  const geo = useMemo(() => {
    const g = personGeometry();
    const w = scene.layout.walkers;
    const r = mulberry32(5);
    const seg = new Float32Array(w.length * 4);
    const meta = new Float32Array(w.length * 2);
    const shirt = new Float32Array(w.length * 3);
    const c = new Color();
    w.forEach((s, i) => {
      seg.set(s, i * 4);
      meta[i * 2] = 1.1 + r() * 0.6;
      meta[i * 2 + 1] = r();
      c.set(SHIRTS[Math.floor(r() * SHIRTS.length)]);
      shirt.set([c.r, c.g, c.b], i * 3);
    });
    g.setAttribute("aSeg", new InstancedBufferAttribute(seg, 4));
    g.setAttribute("aMeta", new InstancedBufferAttribute(meta, 2));
    g.setAttribute("aShirt", new InstancedBufferAttribute(shirt, 3));
    return g;
  }, [scene]);
  useEffect(() => () => geo.dispose(), [geo]);
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current!;
    _m.identity();
    for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, _m);
    mesh.instanceMatrix.needsUpdate = true;
  }, [geo]);
  // positions are computed in the vertex shader, so the instance bounds are meaningless: never cull
  return <instancedMesh ref={ref} args={[geo, mats.people, scene.layout.walkers.length]} frustumCulled={false} />;
}

// ---- Narrowboats cruising the canal (2 instances, CPU) -----------------------------------------------------

function Boats({ mats }: { mats: OldTownMaterials }) {
  const geo = useMemo(() => boatGeometry(), []);
  useEffect(() => () => geo.dispose(), [geo]);
  const ref = useRef<InstancedMesh>(null);
  // each boat shuttles in its own pound (lock to one end), so none sails through the closed lock gates
  const pounds = useMemo(() => {
    let lockD = 0;
    let best = Infinity;
    for (let d = 0; d < CANAL_LENGTH; d += 1) {
      const f = canalFrame(d);
      const k = Math.hypot(f.x - OLD_TOWN.canal.lock[0], f.z - OLD_TOWN.canal.lock[1]);
      if (k < best) {
        best = k;
        lockD = d;
      }
    }
    return [
      { from: 14, to: lockD - 16, phase: 0.2 },
      { from: lockD + 16, to: CANAL_LENGTH - 14, phase: 0.65 },
    ];
  }, []);
  const t = useRef(0);
  useFrame((_, delta) => {
    const mesh = ref.current;
    if (!mesh) return;
    if (!useWorld.getState().paused) t.current += Math.min(delta, 0.1);
    pounds.forEach((p, i) => {
      const len = p.to - p.from;
      const u = (((t.current * 1.4) / len + p.phase) % 1 + 1) % 1;
      const fwd = u < 0.5;
      const d = p.from + len * (fwd ? u * 2 : 2 - u * 2);
      const f = canalFrame(d);
      const dir = fwd ? 1 : -1;
      const hx = f.dx * dir;
      const hz = f.dz * dir;
      // cruise on the far side from the moored boats (they line the right bank of the west -> east frame)
      _p.set(f.x + f.dz * 2.4, 0.1, f.z - f.dx * 2.4);
      _e.set(0, Math.atan2(hx, hz), 0, "YXZ");
      mesh.setMatrixAt(i, _m.compose(_p, _q.setFromEuler(_e), _s));
    });
    mesh.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[geo, mats.solid, 2]} frustumCulled={false} castShadow />;
}

// ---- Market hall clock hands ------------------------------------------------------------------------------

function ClockHands({ mats }: { mats: OldTownMaterials }) {
  const geo = useMemo(() => new BoxGeometry(1, 1, 1).translate(0, 0.5, 0), []);
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
      const ox = Math.sin(a);
      const oz = Math.cos(a);
      for (const [j, ang, len, w] of [[0, th, 0.72, 0.16], [1, tm, 1.05, 0.1]] as const) {
        _p.set(CLOCK.x + ox * 1.92, CLOCK.y, CLOCK.z + oz * 1.92);
        _e.set(0, a, -ang, "YXZ");
        _q.setFromEuler(_e);
        mesh.setMatrixAt(k * 2 + j, _m.compose(_p, _q, _sc.set(w, len, 0.05)));
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  });
  return <instancedMesh ref={ref} args={[geo, mats.iron, 8]} />;
}

// ---- Castle flag ------------------------------------------------------------------------------------------

function Flag({ mats }: { mats: OldTownMaterials }) {
  const geo = useMemo(() => {
    const g: BufferGeometry = new PlaneGeometry(3.2, 2, 12, 6).translate(1.6, 0, 0);
    const pos = g.getAttribute("position");
    const col: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const red = Math.abs(x - 1.6) < 0.32 || Math.abs(y) < 0.24;
      if (red) col.push(0.78, 0.08, 0.12);
      else col.push(0.97, 0.97, 0.95);
    }
    g.setAttribute("color", new Float32BufferAttribute(col, 3));
    return g;
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);
  return <mesh geometry={geo} material={mats.flag} position={[CASTLE_FLAG.x, CASTLE_FLAG.y, CASTLE_FLAG.z]} rotation={[0, Math.PI / 2 + 0.6, 0]} />;
}

// ---- Module -------------------------------------------------------------------------------------------------

export default function OldTown() {
  const scene = useMemo(() => buildOldTown(), []);
  const U = useMemo(() => newUniforms(), []);
  const mats = useMemo(() => makeMaterials(U), [U]);
  useEffect(
    () => () => {
      for (const k of ["low", "tall", "stone", "windows", "glow", "pave", "lawn", "water"] as const) scene[k]?.dispose();
    },
    [scene],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  useFrame((_, delta) => {
    const w = useWorld.getState();
    tickUniforms(U, w.paused ? 0 : Math.min(delta, 0.1), w.timeOfDay);
  });

  return (
    <group name="old-town">
      {scene.pave && <mesh geometry={scene.pave} material={mats.pave} receiveShadow />}
      {scene.lawn && <mesh geometry={scene.lawn} material={mats.lawn} receiveShadow />}
      {scene.water && <mesh geometry={scene.water} material={mats.water} />}
      {scene.low && <mesh geometry={scene.low} material={mats.solid} receiveShadow />}
      {scene.tall && <mesh geometry={scene.tall} material={mats.solid} castShadow receiveShadow />}
      {scene.stone && <mesh geometry={scene.stone} material={mats.stone} castShadow receiveShadow />}
      {scene.windows && <mesh geometry={scene.windows} material={mats.windows} />}
      {scene.glow && <mesh geometry={scene.glow} material={mats.glow} />}
      <Crowd scene={scene} mats={mats} />
      <Boats mats={mats} />
      <ClockHands mats={mats} />
      <Flag mats={mats} />
    </group>
  );
}
