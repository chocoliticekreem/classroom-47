"use client";
// One distinct, readable set of props per Scene, composed from the kit. Everything is in the scene's
// local frame: +x along the road, +z away from the road (frontage at loc.front, our van at loc.vanZ).
import { useMemo, useRef, type ReactNode } from "react";
import type { Group, InstancedMesh, Mesh } from "three";
import { Object3D } from "three";
import type { Scene } from "../../scenarios";
import {
  B, Ball, Bob, C, ConeM, Container, Conveyor, Cyl, Disc, Frontage, GEO, LiveTag, mat, Pallet, Panel, Parcel, Person,
  Ring, Shard, Shelf, Show, Spin, Tag, TrafficCone, Truck, useSceneTime, Van, WalkingCourier,
} from "./kit";
import { rng } from "./director";
import type { SceneLoc } from "./location";
import type { SceneSpec } from "./scenes";

type V3 = [number, number, number];

export interface SceneProps {
  scene: Scene;
  spec: SceneSpec;
  loc: SceneLoc;
  t0: number;
  resolved: boolean;
  /** vehicle_breakdown: the fleet supplied the real van, so don't draw ours */
  externalVehicle?: boolean;
}

/** Main sign (scene text) floating above the props. */
function Sign({ spec, t0, p = [0, 4.8, 0] }: { spec: SceneSpec; t0: number; p?: V3 }) {
  return (
    <Bob t0={t0} p={p} amp={0.12}>
      <Tag text={spec.sign} h={0.9} bg={spec.accent} />
    </Bob>
  );
}

/** Van at the kerb + frontage + courier walking to the door. */
function DoorBase({ loc, t0, van = true, courier = true, carry = true, front = true, doorGlow = false, shop = false, to }: { loc: SceneLoc; t0: number; van?: boolean; courier?: boolean; carry?: boolean; front?: boolean; doorGlow?: boolean; shop?: boolean; to?: V3 }) {
  return (
    <>
      {front && <Frontage p={[0, 0, loc.front]} glow={doorGlow} shop={shop} c={loc.front < 3 ? "#d9c9ae" : C.wall} />}
      {van && <Van p={[-3.6, 0, loc.vanZ]} t0={t0} />}
      {courier && <WalkingCourier t0={t0} a={[-1.4, 0, loc.vanZ + 1.4]} b={to ?? [0, 0, loc.front - 0.9]} carry={carry} />}
    </>
  );
}

const arrive = 4.6; // courier reaches the door around here

/** Knocking hand at the door: a small bobbing fist. */
function Knock({ t0, p }: { t0: number; p: V3 }) {
  const m = useRef<Mesh>(null);
  useSceneTime(t0, (t) => {
    if (!m.current) return;
    const k = t > arrive && t < arrive + 5;
    m.current.visible = k;
    m.current.position.z = p[2] + (k ? Math.abs(Math.sin(t * 10)) * 0.15 : 0);
  });
  return <Ball mref={m} p={p} s={[0.2, 0.2, 0.2]} c={C.skin} />;
}

function PhoneRing({ t0, p }: { t0: number; p: V3 }) {
  const g = useRef<Group>(null);
  useSceneTime(t0, (t) => {
    if (g.current) g.current.rotation.z = Math.sin(t * 40) * 0.25 * (Math.sin(t * 2) > 0 ? 1 : 0);
  });
  return (
    <group ref={g} position={p}>
      <B s={[0.5, 0.9, 0.12]} c={C.dark} />
      <B p={[0, 0.05, -0.07]} s={[0.4, 0.65, 0.02]} c="#7fd1ff" e={1.2} />
      <Bob t0={t0} p={[0, 0.9, 0]} pulse={6}>
        <Tag text="RING" h={0.45} bg={C.blue} />
      </Bob>
    </group>
  );
}

function Gate({ p, t0 }: { p: V3; t0: number }) {
  return (
    <group position={p}>
      <B p={[-1.6, 1.1, 0]} s={[0.25, 2.2, 0.25]} c={C.dark} />
      <B p={[1.6, 1.1, 0]} s={[0.25, 2.2, 0.25]} c={C.dark} />
      <B p={[0, 1.0, 0]} s={[3.0, 1.7, 0.08]} c="#4a4f57" o={0.85} />
      <B p={[0, 1.9, 0]} s={[3.0, 0.12, 0.14]} c={C.dark} />
      <B p={[1.85, 1.2, -0.1]} s={[0.3, 0.45, 0.12]} c={C.steel} />
      <Show t0={t0} when={(t) => Math.floor(t * 3) % 2 === 0}>
        <B p={[1.85, 1.32, -0.17]} s={[0.14, 0.08, 0.02]} c={C.red} e={3} />
      </Show>
    </group>
  );
}

/** Flash of a camera every ~2 s. */
function CameraFlash({ t0, p }: { t0: number; p: V3 }) {
  return (
    <group position={p}>
      <B s={[0.35, 0.25, 0.2]} c={C.dark} />
      <Show t0={t0} when={(t) => t % 2 < 0.15}>
        <Ball p={[0, 0.1, 0.4]} s={[1.4, 1.4, 1.4]} c="#ffffff" add o={0.8} />
      </Show>
    </group>
  );
}

function clusterSeeds(n: number, seed: number, radius: number) {
  const r = rng(seed);
  return Array.from({ length: n }, () => ({ a: r() * Math.PI * 2, d: 0.3 + r() * radius, s: 0.6 + r() * 0.8, ph: r() * 6, rot: r() * 6 }));
}

/** Instanced cluster of little items (shards, cascade parcels, junk). One draw call. */
export function Cluster({ n, seed = 1, radius = 1.5, geo = "box", c, size = 0.15, y = 0.05, spin = 0, t0 = 0, float = 0 }: { n: number; seed?: number; radius?: number; geo?: "box" | "tetra" | "plane"; c: string; size?: number; y?: number; spin?: number; t0?: number; float?: number }) {
  const ref = useRef<InstancedMesh>(null);
  const seeds = useMemo(() => clusterSeeds(n, seed, radius), [n, seed, radius]);
  const dummy = useMemo(() => new Object3D(), []);
  useSceneTime(t0, (t) => {
    const m = ref.current;
    if (!m) return;
    for (let i = 0; i < seeds.length; i++) {
      const q = seeds[i];
      const ang = q.a + t * spin * 0.3;
      dummy.position.set(Math.cos(ang) * q.d, y + (float ? (Math.sin(t * 1.5 + q.ph) * 0.5 + 0.5) * float : 0), Math.sin(ang) * q.d);
      dummy.rotation.set(q.rot + t * spin, q.rot * 2 + t * spin, 0);
      dummy.scale.setScalar(size * q.s);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  const g = geo === "tetra" ? GEO.tetra : geo === "plane" ? GEO.plane : GEO.box;
  return <instancedMesh ref={ref} args={[g, mat(c, { double: geo === "plane" }), n]} frustumCulled={false} />;
}

function Puddle({ t0, p }: { t0: number; p: V3 }) {
  const m = useRef<Mesh>(null);
  useSceneTime(t0, (t) => {
    if (m.current) m.current.scale.setScalar(0.6 + Math.min(1, t / 20) * 3.2);
  });
  return <Disc mref={m} p={p} c="#3fb6c9" o={0.75} e={0.4} />;
}

/** Rising steam / frost puffs (instanced). */
function Steam({ t0, p, c = "#e8f6ff" }: { t0: number; p: V3; c?: string }) {
  const ref = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const N = 10;
  useSceneTime(t0, (t) => {
    const m = ref.current;
    if (!m) return;
    for (let i = 0; i < N; i++) {
      const u = (t * 0.5 + i / N) % 1;
      dummy.position.set(Math.sin(i * 2.1) * 0.6 * (0.4 + u), u * 2.6, Math.cos(i * 1.7) * 0.4);
      dummy.scale.setScalar(0.3 + u * 0.7);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <group position={p}>
      <instancedMesh ref={ref} args={[GEO.sph, mat(c, { opacity: 0.55 }), N]} frustumCulled={false} />
    </group>
  );
}

function Thermometer({ p }: { p: V3 }) {
  return (
    <group position={p}>
      <Cyl p={[0, 0.9, 0]} s={[0.22, 1.6, 0.22]} c="#ffffff" />
      <Cyl p={[0, 0.75, 0]} s={[0.14, 1.3, 0.14]} c={C.red} e={1.5} />
      <Ball p={[0, 0.05, 0]} s={[0.45, 0.45, 0.45]} c={C.red} e={1.5} />
    </group>
  );
}

function Magnifier({ t0, p }: { t0: number; p: V3 }) {
  const g = useRef<Group>(null);
  useSceneTime(t0, (t) => {
    if (!g.current) return;
    g.current.position.x = p[0] + Math.sin(t * 0.8) * 2;
    g.current.position.y = p[1] + Math.sin(t * 1.6) * 0.4;
  });
  return (
    <group ref={g} position={p}>
      <Ring s={[1.4, 1.4, 1.4]} c={C.yellow} e={0.6} />
      <B p={[0, 0, 0]} s={[1.2, 1.2, 0.03]} c="#bfe8ff" o={0.4} />
      <B p={[0.7, -0.75, 0]} s={[0.18, 0.9, 0.18]} r={[0, 0, 0.75]} c={C.dark} />
    </group>
  );
}

function Cage({ p, children }: { p: V3; children?: ReactNode }) {
  return (
    <group position={p}>
      <B p={[0, 0.9, 0]} s={[1.6, 1.8, 1.2]} c="#c0c7cf" o={0.3} />
      <B p={[0, 0.03, 0]} s={[1.6, 0.06, 1.2]} c={C.steel} />
      <B p={[-0.8, 0.9, -0.6]} s={[0.06, 1.8, 0.06]} c={C.steel} />
      <B p={[0.8, 0.9, -0.6]} s={[0.06, 1.8, 0.06]} c={C.steel} />
      <B p={[-0.8, 0.9, 0.6]} s={[0.06, 1.8, 0.06]} c={C.steel} />
      <B p={[0.8, 0.9, 0.6]} s={[0.06, 1.8, 0.06]} c={C.steel} />
      {children}
    </group>
  );
}

/** A parcel riding a conveyor from x0 to x1 in a loop. */
function Riding({ t0, x0, x1, y, z = 0, c = C.cardboard, period = 4 }: { t0: number; x0: number; x1: number; y: number; z?: number; c?: string; period?: number }) {
  const g = useRef<Group>(null);
  useSceneTime(t0, (t) => {
    if (g.current) g.current.position.x = x0 + ((t % period) / period) * (x1 - x0);
  });
  return (
    <group ref={g} position={[x0, y, z]}>
      <Parcel c={c} />
    </group>
  );
}

function Arrow({ p, r = 0, c = C.red }: { p: V3; r?: number; c?: string }) {
  return (
    <group position={p} rotation={[0, 0, r]}>
      <B p={[-0.3, 0, 0]} s={[1.2, 0.3, 0.1]} c={c} e={1.2} />
      <ConeArrow c={c} />
    </group>
  );
}
function ConeArrow({ c }: { c: string }) {
  return <mesh geometry={GEO.tetra} material={mat(c, { emissive: 1.2 })} position={[0.45, 0, 0]} rotation={[0, 0, -Math.PI / 2]} scale={[0.7, 0.6, 0.2]} />;
}

function Padlock({ p, s = 1 }: { p: V3; s?: number }) {
  return (
    <group position={p} scale={s}>
      <B s={[0.8, 0.6, 0.3]} c="#d4a017" e={0.4} />
      <Ring p={[0, 0.4, 0]} s={[0.55, 0.6, 0.6]} c={C.steel} />
    </group>
  );
}

/** Heavy box carried by two movers that shuffle towards the van. */
function Movers({ t0, from, to }: { t0: number; from: V3; to: V3 }) {
  const g = useRef<Group>(null);
  useSceneTime(t0, (t) => {
    const n = g.current;
    if (!n) return;
    const u = Math.min(1, Math.max(0, (t - 1) / 9));
    n.position.set(from[0] + (to[0] - from[0]) * u, Math.abs(Math.sin(t * 6)) * 0.05, from[2] + (to[2] - from[2]) * u);
    n.rotation.z = Math.sin(t * 3) * 0.04;
  });
  return (
    <group ref={g} position={from}>
      <Person p={[-0.95, 0, 0]} c={C.orange} />
      <Person p={[0.95, 0, 0]} c={C.orange} />
      <B p={[0, 1.15, 0]} s={[1.5, 0.9, 0.9]} c={C.cardboard} />
      <Bob t0={t0} p={[0, 2.2, 0]}>
        <Tag text="HEAVY" h={0.4} bg={C.dark} />
      </Bob>
    </group>
  );
}

function Locker({ p }: { p: V3 }) {
  const cols = 4;
  const rows = 3;
  const doors: V3[] = [];
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) doors.push([-1.5 + i, 0.5 + j * 0.65, -0.02]);
  return (
    <group position={p}>
      <B p={[0, 1.15, 0.3]} s={[4.3, 2.3, 0.6]} c={C.orange} />
      <LockerDoors doors={doors} />
    </group>
  );
}
function LockerDoors({ doors }: { doors: V3[] }) {
  const ref = useRef<InstancedMesh>(null);
  const setRef = (m: InstancedMesh | null) => {
    ref.current = m;
    if (!m) return;
    const d = new Object3D();
    doors.forEach((p, i) => {
      d.position.set(...p);
      d.scale.set(0.9, 0.55, 0.06);
      d.updateMatrix();
      m.setMatrixAt(i, d.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  };
  return <instancedMesh ref={setRef} args={[GEO.box, mat(C.red, { emissive: 0.8 }), doors.length]} />;
}

/** Wrong-item duck popping out of an open box. */
function PopOut({ t0, p }: { t0: number; p: V3 }) {
  const g = useRef<Group>(null);
  useSceneTime(t0, (t) => {
    if (g.current) g.current.position.y = 0.5 + Math.max(0, Math.sin(t * 2.2)) * 0.9;
  });
  return (
    <group position={p}>
      <B p={[0, 0.25, 0]} s={[0.9, 0.5, 0.8]} c={C.cardboard} />
      <B p={[0, 0.5, -0.45]} s={[0.9, 0.04, 0.5]} r={[-0.9, 0, 0]} c={C.cardboard} />
      <group ref={g}>
        <Ball s={[0.5, 0.45, 0.5]} c={C.yellow} />
        <Ball p={[0, 0.35, 0.12]} s={[0.3, 0.3, 0.3]} c={C.yellow} />
        <B p={[0, 0.33, 0.32]} s={[0.15, 0.06, 0.15]} c={C.orange} />
      </group>
    </group>
  );
}

/** A frozen tracking screen that flickers. */
function Screen({ t0, p }: { t0: number; p: V3 }) {
  return (
    <group position={p}>
      <B p={[0, 1.2, 0.1]} s={[0.15, 2.4, 0.15]} c={C.dark} />
      <B p={[0, 2.6, 0.05]} s={[3.4, 1.6, 0.15]} c={C.dark} />
      <Show t0={t0} when={(t) => (t * 7) % 5 > 0.6}>
        <Panel text="DL-011 · LAST SCAN 3d AGO" p={[0, 2.6, -0.04]} h={0.5} bg="#1b263b" fg="#9ef0ff" glow />
      </Show>
      <Panel text="⏸ FROZEN" p={[0, 2.05, -0.04]} h={0.3} bg={C.amber} fg="#1b1b1b" />
    </group>
  );
}

/** Office: glowing tower shell + beam + tickets flying up into it. */
function OfficeTickets({ t0, spec }: { t0: number; spec: SceneSpec }) {
  const tickets = useRef<(Group | null)[]>([]);
  useSceneTime(t0, (t) => {
    for (let i = 0; i < 4; i++) {
      const g = tickets.current[i];
      if (!g) continue;
      const u = (t * 0.18 + i / 4) % 1;
      const a = u * Math.PI * 3 + i;
      g.position.set(Math.cos(a) * (5 - u * 3), 2 + u * 40, Math.sin(a) * (5 - u * 3));
      g.scale.setScalar(1 - u * 0.4);
    }
  });
  return (
    <>
      <Cyl p={[0, 25, 0]} s={[3, 50, 3]} c={spec.accent} add o={0.18} />
      <Ring p={[0, 0.2, 0]} r={[Math.PI / 2, 0, 0]} s={[8, 8, 8]} c={spec.accent} add o={0.6} />
      {[0, 1, 2, 3].map((i) => (
        <group key={i} ref={(g) => { tickets.current[i] = g; }}>
          <Tag text={i === 0 ? spec.sign : "TICKET"} h={i === 0 ? 1.4 : 0.8} bg={i === 0 ? spec.accent : "#ffffff"} fg={i === 0 ? "#fff" : "#1b263b"} />
        </group>
      ))}
      <Bob t0={t0} p={[0, 46, 0]} amp={0.6}>
        <Tag text={spec.sign} h={3} bg={spec.accent} />
      </Bob>
    </>
  );
}

/** Localized storm: dark cloud, rain streaks (one LineSegments-like instanced mesh), lightning. */
function Storm({ t0, len }: { t0: number; len: number }) {
  const rain = useRef<InstancedMesh>(null);
  const flash = useRef<Mesh>(null);
  const bolt = useRef<Group>(null);
  const span = Math.min(len * 0.9, 70);
  const N = 160;
  const seeds = useMemo(() => Array.from({ length: N }, (_, i) => ({ x: ((i * 37) % 100) / 100 - 0.5, z: ((i * 61) % 100) / 100 - 0.5, ph: ((i * 13) % 100) / 100 })), []);
  const dummy = useMemo(() => new Object3D(), []);
  useSceneTime(t0, (t) => {
    const m = rain.current;
    if (m) {
      for (let i = 0; i < N; i++) {
        const q = seeds[i];
        const y = 16 - ((t * 1.6 + q.ph) % 1) * 16;
        dummy.position.set(q.z * 12, y, q.x * span);
        dummy.scale.set(0.05, 1.1, 0.05);
        dummy.rotation.set(0.15, 0, 0);
        dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix);
      }
      m.instanceMatrix.needsUpdate = true;
    }
    const k = t % 4.3;
    const on = k < 0.08 || (k > 0.18 && k < 0.24);
    if (flash.current) flash.current.visible = on;
    if (bolt.current) {
      bolt.current.visible = on;
      bolt.current.position.z = Math.sin(Math.floor(t / 4.3) * 12.9) * span * 0.35;
    }
  });
  // frame: local +z is across the road for kerb scenes; for the storm we use x across, z along the road
  return (
    <group rotation={[0, Math.PI / 2, 0]}>
      {[-0.35, -0.12, 0.1, 0.32].map((f, i) => (
        <Ball key={i} p={[i % 2 ? 2 : -2, 18 + (i % 2), f * span]} s={[16, 5, span * 0.42]} c="#3d4350" />
      ))}
      <instancedMesh ref={rain} args={[GEO.box, mat("#9fc4ff", { opacity: 0.6 }), N]} frustumCulled={false} />
      <Ball mref={flash} p={[0, 15, 0]} s={[22, 8, span]} c="#dfe9ff" add o={0.35} />
      <group ref={bolt}>
        <B p={[0, 13, 0]} s={[0.25, 5, 0.25]} r={[0, 0, 0.3]} c="#ffffff" basic />
        <B p={[0.7, 8.8, 0]} s={[0.25, 4.5, 0.25]} r={[0, 0, -0.35]} c="#ffffff" basic />
        <B p={[0.2, 4.6, 0]} s={[0.25, 4.5, 0.25]} r={[0, 0, 0.25]} c="#ffffff" basic />
      </group>
      <Disc p={[0, 0.07, 0]} s={[8, 1, span]} c="#4c6a8a" o={0.45} />
      {[-1, 1].map((s) => (
        <group key={s} position={[0, 0, (s * span) / 2 + s * 2]}>
          <B p={[0, 0.6, 0]} s={[7, 0.5, 0.2]} c={C.red} e={0.6} />
          <B p={[-3, 0.35, 0]} s={[0.15, 0.7, 0.15]} c={C.dark} />
          <B p={[3, 0.35, 0]} s={[0.15, 0.7, 0.15]} c={C.dark} />
          <Tag text="ROUTE SUSPENDED: STORM" p={[0, 2.2, 0]} h={0.9} bg={C.red} />
        </group>
      ))}
    </group>
  );
}

/** The props for one scene. */
export default function SceneProps({ scene, spec, loc, t0, resolved, externalVehicle }: SceneProps) {
  const f = loc.front;
  const vz = loc.vanZ;
  const mid: V3 = [0, 0, (f + vz) / 2];
  const sign = <Sign spec={spec} t0={t0} p={[0, 4.8, Math.max(vz, Math.min(f - 0.5, 0.5))]} />;
  switch (scene) {
    // ------------------------------------------------------------------ at the door
    case "door_slot_change":
      return (
        <>
          <DoorBase loc={loc} t0={t0} />
          <Knock t0={t0} p={[0.3, 1.6, f - 0.5]} />
          <Show t0={t0} when={(t) => t > arrive + 1}>
            <Bob t0={t0} p={[0, 3.2, f - 0.3]}><Tag text="?" h={1.1} bg={C.blue} /></Bob>
          </Show>
          <Panel text="09-12 → 15-18?" p={[1.8, 1.6, f - 0.05]} h={0.5} bg="#ffffff" fg={C.blue} />
          {sign}
        </>
      );
    case "failed_attempt_dispute":
      return (
        <>
          <DoorBase loc={loc} t0={t0} />
          <Knock t0={t0} p={[0.3, 1.6, f - 0.5]} />
          <Panel text="SORRY WE MISSED YOU" p={[0, 1.4, f - 0.09]} h={0.32} bg={C.amber} fg="#1b1b1b" />
          <Show t0={t0} when={(t) => t > arrive + 1}>
            <Bob t0={t0} p={[-1.2, 3.1, f - 0.5]}><Tag text="?" h={1.1} bg={C.red} /></Bob>
            <Bob t0={t0} p={[1.2, 3.1, f - 0.5]} speed={2.7}><Tag text="I WAS HOME" h={0.5} bg="#ffffff" fg={C.red} /></Bob>
          </Show>
          {sign}
        </>
      );
    case "address_incomplete":
      return (
        <>
          <Frontage p={[-2.2, 0, f]} w={2.2} h={5} c="#d9c9ae" />
          <Frontage p={[0, 0, f]} w={2.2} h={5} c="#d9c9ae" />
          <Frontage p={[2.2, 0, f]} w={2.2} h={5} c="#d9c9ae" />
          <Van p={[-4.2, 0, vz]} t0={t0} />
          <Parcel p={[0.5, 0, (f + vz) / 2]} s={[0.9, 0.6, 0.7]} />
          <Panel text="FLAT ?" p={[0.5, 0.95, (f + vz) / 2]} h={0.35} bg="#ffffff" fg={C.red} />
          <Person p={[-1.2, 0, (f + vz) / 2]} r={[0, Math.PI / 2, 0]} />
          {[-2.2, 0, 2.2].map((x) => (
            <Bob key={x} t0={t0} p={[x, 3.4, f - 0.4]} speed={2 + x * 0.2}><Tag text="?" h={0.6} bg={C.amber} /></Bob>
          ))}
          {sign}
        </>
      );
    case "access_gated":
      return (
        <>
          <DoorBase loc={loc} t0={t0} to={[0, 0, (f + vz) / 2 - 0.6]} />
          <Gate p={[0, 0, (f + vz) / 2 + 0.2]} t0={t0} />
          <Show t0={t0} when={(t) => t > arrive}>
            <Bob t0={t0} p={[1.85, 2.4, (f + vz) / 2]}><Tag text="CODE ✗" h={0.45} bg={C.red} /></Bob>
          </Show>
          {sign}
        </>
      );
    case "call_before_arrival":
      return (
        <>
          <DoorBase loc={loc} t0={t0} to={[0, 0, (f + vz) / 2]} />
          <PhoneRing t0={t0} p={[0.8, 2.6, (f + vz) / 2]} />
          {sign}
        </>
      );
    case "alternate_recipient":
      return (
        <>
          <DoorBase loc={loc} t0={t0} to={[3, 0, f - 1]} />
          <Frontage p={[3.2, 0, f]} c="#cfe0c3" door={C.green} glow />
          <Person p={[3.2, 0, f - 0.6]} c={C.green} r={[0, Math.PI, 0]} />
          <Bob t0={t0} p={[3.2, 3.3, f - 0.5]}><Tag text="NO.12 ✓" h={0.55} bg={C.green} /></Bob>
          {sign}
        </>
      );
    case "misdelivered_neighbour":
      return (
        <>
          <DoorBase loc={loc} t0={t0} courier={false} />
          <Frontage p={[4, 0, f]} c="#cfe0c3" door={C.amber} glow />
          <Parcel p={[4, 0, f - 0.8]} />
          <Person p={[5, 0, f - 0.7]} c="#6c757d" r={[0, Math.PI, 0]} />
          <Arrow p={[2, 2.2, f - 0.6]} c={C.amber} />
          <Bob t0={t0} p={[0, 3, f - 0.4]}><Tag text="MINE?" h={0.5} bg={C.blue} /></Bob>
          {sign}
        </>
      );
    case "misdelivered_wrong_customer":
      return (
        <>
          <DoorBase loc={loc} t0={t0} to={[-4.2, 0, f - 1]} />
          <Frontage p={[-4.2, 0, f]} c="#f0d6d6" door={C.red} glow />
          <Disc p={[-4.2, 0.05, f - 1]} s={[3, 1, 3]} c={C.red} add o={0.5} />
          <Bob t0={t0} p={[-4.2, 3.3, f - 0.4]} pulse={4}><Tag text="✗ NO.41" h={0.6} bg={C.red} /></Bob>
          <Bob t0={t0} p={[0, 3.3, f - 0.4]}><Tag text="NO.14" h={0.5} bg={C.green} /></Bob>
          {sign}
        </>
      );
    case "bulky_access":
      return (
        <>
          <DoorBase loc={loc} t0={t0} courier={false} />
          <B p={[0, 0.55, (f + vz) / 2 + 0.2]} s={[2.6, 1.1, 1.1]} c={C.cardboard} />
          <Panel text="SOFA" p={[0, 0.7, (f + vz) / 2 - 0.36]} h={0.35} bg="#ffffff" fg="#1b1b1b" />
          <Cyl p={[-1.3, 0.55, f - 1]} s={[0.6, 1.1, 0.6]} c="#2d6a4f" />
          <Cyl p={[-0.6, 0.55, f - 1]} s={[0.6, 1.1, 0.6]} c="#1d3557" />
          <B p={[0.9, 0.4, f - 1.1]} s={[1.4, 0.8, 0.2]} r={[0, 0.4, 0.2]} c={C.steel} />
          <Person p={[-1.8, 0, (f + vz) / 2 + 0.2]} r={[0, Math.PI / 2, 0]} />
          <Person p={[1.8, 0, (f + vz) / 2 + 0.2]} r={[0, -Math.PI / 2, 0]} />
          <Bob t0={t0} p={[0, 2.6, f - 1]}><Tag text="BLOCKED" h={0.5} bg={C.red} /></Bob>
          {sign}
        </>
      );
    case "business_closed":
      return (
        <>
          <group position={[0, 0, f]}>
            <B p={[0, 2, 0.3]} s={[6, 4, 0.6]} c="#c1c8ce" />
            <B p={[0, 1.3, -0.03]} s={[4.2, 2.6, 0.08]} c="#7d8590" />
            {[0.3, 0.7, 1.1, 1.5, 1.9, 2.3].map((y) => <B key={y} p={[0, y, -0.08]} s={[4.2, 0.05, 0.03]} c={C.dark} />)}
          </group>
          <Panel text="CLOSED 17:00" p={[0, 3.1, f - 0.15]} h={0.5} bg={C.red} />
          <Van p={[-4, 0, vz]} t0={t0} />
          <WalkingCourier t0={t0} a={[-1.6, 0, vz + 1.2]} b={[1.4, 0, f - 0.9]} />
          {sign}
        </>
      );
    case "partial_delivery":
      return (
        <>
          <DoorBase loc={loc} t0={t0} courier={false} />
          <Parcel p={[-0.6, 0, f - 0.9]} />
          <B p={[0.6, 0.25, f - 0.9]} s={[0.7, 0.5, 0.6]} c="#ffffff" o={0.25} />
          <Bob t0={t0} p={[0.6, 1.0, f - 0.9]}><Tag text="?" h={0.5} bg={C.amber} /></Bob>
          <Bob t0={t0} p={[0, 2.8, f - 0.5]}><Tag text="1 / 2" h={0.6} bg={C.amber} /></Bob>
          {sign}
        </>
      );
    case "delivered_not_received":
      return (
        <>
          <DoorBase loc={loc} t0={t0} van={false} courier={false} />
          <Disc p={[0, 0.05, f - 0.9]} s={[1.6, 1, 1.6]} c={C.red} add o={0.35} />
          <Bob t0={t0} p={[0, 3.6, f - 1.2]} amp={0.2}>
            <Panel text="TRACKING: DELIVERED ✓" h={0.7} bg="#0f5132" fg="#a7f3d0" glow />
          </Bob>
          <Show t0={t0} when={(t) => t > 2}>
            <Bob t0={t0} p={[0, 1.6, f - 1.2]} pulse={4}><Tag text="EMPTY ?" h={0.5} bg={C.red} /></Bob>
          </Show>
          <Person p={[1.3, 0, f - 0.7]} c="#6c757d" r={[0, Math.PI, 0]} />
          {sign}
        </>
      );
    case "wrong_item":
      return (
        <>
          <DoorBase loc={loc} t0={t0} van={false} courier={false} />
          <PopOut t0={t0} p={[0, 0, f - 1.2]} />
          <Person p={[1.2, 0, f - 0.8]} c="#6c757d" r={[0, Math.PI, 0]} />
          <Bob t0={t0} p={[0, 3, f - 1]}><Tag text="✗ NOT A LAMP" h={0.5} bg={C.red} /></Bob>
          {sign}
        </>
      );
    case "duplicate_shipment":
      return (
        <>
          <DoorBase loc={loc} t0={t0} courier={false} />
          <Parcel p={[-0.5, 0, f - 1]} />
          <Parcel p={[0.5, 0, f - 1]} />
          <Panel text="DL-039" p={[-0.5, 0.35, f - 1.31]} h={0.18} bg="#ffffff" fg="#1b1b1b" />
          <Panel text="DL-039" p={[0.5, 0.35, f - 1.31]} h={0.18} bg="#ffffff" fg="#1b1b1b" />
          <Bob t0={t0} p={[0, 2.5, f - 1]}><Tag text="= =" h={0.6} bg={C.amber} /></Bob>
          {sign}
        </>
      );
    case "pod_missing_high_value":
      return (
        <>
          <DoorBase loc={loc} t0={t0} shop to={[-1, 0, f - 1]} />
          <Parcel p={[1, 0, mid[2]]} s={[0.8, 0.6, 0.6]} c="#3c2f2f" />
          <Padlock p={[1, 1.1, mid[2]]} s={0.8} />
          <Bob t0={t0} p={[1, 2.1, mid[2]]} pulse={3}><Tag text="£" h={0.8} bg={C.amber} /></Bob>
          <Bob t0={t0} p={[-1, 2.8, f - 1]}><Tag text="NO SIGNATURE" h={0.4} bg={C.red} /></Bob>
          {sign}
        </>
      );
    // ------------------------------------------------------------------ damage and safety
    case "damage_evidence":
      return (
        <>
          <DoorBase loc={loc} t0={t0} van={false} courier={false} />
          <Parcel p={[0, 0, f - 1.2]} r={[0.15, 0.4, 0.22]} s={[0.9, 0.55, 0.7]} />
          <B p={[0.35, 0.5, f - 1.45]} s={[0.35, 0.25, 0.25]} r={[0.6, 0.3, 0.5]} c="#9a6b3a" />
          <Person p={[1.5, 0, f - 1.8]} c="#6c757d" r={[0, -0.8, 0]} />
          <CameraFlash t0={t0} p={[1.1, 1.4, f - 1.6]} />
          <Bob t0={t0} p={[0, 2.6, f - 1.2]}><Tag text="DENTED" h={0.45} bg={C.amber} /></Bob>
          {sign}
        </>
      );
    case "damage_confirmed":
      return (
        <>
          <DoorBase loc={loc} t0={t0} van={false} courier={false} />
          <B p={[0, 0.2, f - 1.2]} s={[0.9, 0.4, 0.7]} c={C.cardboard} />
          <Cyl p={[0.9, 0.08, f - 1.6]} s={[0.12, 1.4, 0.12]} r={[0, 0, Math.PI / 2 - 0.1]} c={C.dark} />
          <ConeM p={[1.8, 0.25, f - 1.6]} s={[0.6, 0.5, 0.6]} r={[0, 0, -1.2]} c={C.yellow} />
          <group position={[0.6, 0, f - 1.8]}>
            <Cluster n={14} seed={3} radius={1.2} geo="tetra" c="#e9f5ff" size={0.22} y={0.06} />
          </group>
          <Bob t0={t0} p={[0.6, 2.4, f - 1.4]}><Tag text="LAMP: SMASHED" h={0.45} bg={C.red} /></Bob>
          {sign}
        </>
      );
    case "leaking_parcel":
      return (
        <>
          <Puddle t0={t0} p={[0, 0.04, mid[2] + 1]} />
          <Parcel p={[0, 0, mid[2] + 1]} c="#b78a57" />
          {[[-2, -0.6], [2, -0.6], [-2, 2.6], [2, 2.6]].map(([x, z]) => <TrafficCone key={`${x}${z}`} p={[x, 0, mid[2] + z]} />)}
          <Person p={[3, 0, mid[2] + 1]} c={C.yellow} r={[0, -Math.PI / 2, 0]}>
            <B p={[0, 0.85, 0.19]} s={[0.56, 0.1, 0.02]} c="#d0d0d0" e={1} />
          </Person>
          <Bob t0={t0} p={[0, 2.2, mid[2] + 1]} pulse={4}><Tag text="⚠" h={0.8} bg={C.yellow} fg="#1b1b1b" /></Bob>
          {sign}
        </>
      );
    case "cold_chain_breach":
      return (
        <>
          <Truck p={[-1, 0, vz - 0.4]} reefer />
          <Steam t0={t0} p={[1.05, 3.2, vz - 0.4]} />
          <Steam t0={t0 + 0.7} p={[-3.8, 0.8, vz - 0.4]} c="#ffffff" />
          <Thermometer p={[-1, 3.5, vz - 0.4]} />
          <Bob t0={t0} p={[0.4, 5.8, vz]} pulse={3}><Tag text="+9°C ▲" h={0.7} bg={C.red} /></Bob>
          <Person p={[-4.5, 0, vz + 2]} c={C.blue} />
          {sign}
        </>
      );
    // ------------------------------------------------------------------ pickup / lockers
    case "pickup_point":
      return (
        <>
          <group position={[0, 0, f]}>
            <B p={[0, 1.7, 0.3]} s={[5, 3.4, 0.6]} c="#2a6fb0" />
            <B p={[0, 0.55, -0.4]} s={[2.4, 1.1, 0.7]} c="#f1e8d0" />
          </group>
          <Panel text="PICKUP POINT" p={[0, 3, f - 0.05]} h={0.45} bg={C.blue} />
          <Person p={[0, 0, f + 0.0]} c={C.blue} r={[0, Math.PI, 0]} />
          {[1, 2, 3, 4].map((i) => (
            <Person key={i} p={[-0.6 - i * 0.85, 0, f - 1.3]} c={["#6c757d", "#b5838d", "#457b9d", "#e9c46a"][i - 1]} r={[0, Math.PI / 2, 0]} />
          ))}
          <LiveTag t0={t0} p={[2.4, 2.6, f - 0.6]} h={0.7} bg={C.amber} fg="#1b1b1b" text={(t) => `${Math.max(0, 48 - Math.floor(t / 2))}h`} />
          {sign}
        </>
      );
    case "locker_full":
      return (
        <>
          <Locker p={[0, 0, f - 0.6]} />
          <Panel text="FULL" p={[0, 2.6, f - 0.62]} h={0.5} bg={C.red} />
          <DoorBase loc={loc} t0={t0} front={false} to={[-2.6, 0, f - 1.2]} />
          {sign}
        </>
      );
    // ------------------------------------------------------------------ depot and network
    case "hold_delivery":
      return (
        <>
          <Shelf p={[0, 0, mid[2] + 1.5]} w={3.4} />
          <Parcel p={[0, 0, mid[2]]} s={[0.9, 0.7, 0.7]} c={C.amber} />
          <Panel text="HOLD" p={[0, 0.45, mid[2] - 0.36]} h={0.3} bg={C.amber} fg="#1b1b1b" />
          <Bob t0={t0} p={[0, 1.6, mid[2]]}><Tag text="⏸" h={0.6} bg={C.amber} /></Bob>
          {sign}
        </>
      );
    case "tracking_stale":
      return (
        <>
          <Screen t0={t0} p={[0, 0, mid[2] + 1]} />
          <Parcel p={[2.3, 0, mid[2]]} />
          <Bob t0={t0} p={[2.3, 1.3, mid[2]]}><Tag text="SCAN ?" h={0.45} bg={C.amber} /></Bob>
          {sign}
        </>
      );
    case "misrouted_depot":
      return (
        <>
          <Conveyor p={[0, 0, mid[2]]} len={7} />
          <Conveyor p={[0, 0, mid[2] + 2.2]} len={7} c="#2d6a4f" />
          <Riding t0={t0} x0={-3} x1={3} y={0.92} z={mid[2]} c={C.red} />
          <Riding t0={t0 + 2} x0={-3} x1={3} y={0.92} z={mid[2] + 2.2} />
          <Panel text="→ NORTH" p={[-3.8, 1.6, mid[2] + 2.2]} h={0.3} bg={C.green} />
          <Panel text="→ SOUTH" p={[-3.8, 1.6, mid[2]]} h={0.3} bg={C.dark} />
          <Bob t0={t0} p={[0, 2.4, mid[2] + 1.1]}><Arrow p={[0, 0, 0]} r={Math.PI / 2} /></Bob>
          {sign}
        </>
      );
    case "return_deadline":
      return (
        <>
          <Cage p={[-1.2, 0, mid[2] + 1]}>
            <Parcel p={[0, 0.06, 0]} />
          </Cage>
          <B p={[1.6, 1.2, mid[2] + 1]} s={[0.15, 2.4, 0.15]} c={C.dark} />
          <LiveTag t0={t0} p={[1.6, 2.9, mid[2] + 1]} h={0.9} text={(t) => {
            const s = Math.max(0, 7200 - Math.floor(t * 60));
            return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
          }} />
          {sign}
        </>
      );
    case "lost_parcel":
      return (
        <>
          <Shelf p={[-2, 0, mid[2] + 1.5]} w={3} />
          <Shelf p={[2, 0, mid[2] + 1.5]} w={3} />
          <Magnifier t0={t0} p={[0, 2.2, mid[2] + 0.6]} />
          <Person p={[0, 0, mid[2] - 0.3]} c={C.blue} r={[0, 0, 0]} />
          <Bob t0={t0} p={[0, 3.6, mid[2] + 1]}><Tag text="DL-025 ?" h={0.5} bg={C.blue} /></Bob>
          {sign}
        </>
      );
    case "return_stuck_depot":
      return (
        <>
          <Cage p={[0, 0, mid[2] + 1]}>
            <Parcel p={[-0.3, 0.06, 0]} />
            <Parcel p={[0.35, 0.06, 0.1]} s={[0.5, 0.4, 0.5]} c="#b78a57" />
            <Parcel p={[0, 0.6, 0]} s={[0.6, 0.4, 0.5]} />
          </Cage>
          <Panel text="RETURNS" p={[0, 2.1, mid[2] + 0.38]} h={0.3} bg={C.dark} />
          <Bob t0={t0} p={[0, 3, mid[2] + 1]}><Tag text="DAY 9 ⏳" h={0.5} bg={C.amber} /></Bob>
          {sign}
        </>
      );
    case "returned_to_sender":
      return (
        <>
          <Van p={[-3.5, 0, vz]} t0={t0} />
          <Cage p={[1.5, 0, mid[2] + 1.2]}>
            <Parcel p={[0, 0.06, 0]} />
          </Cage>
          <Bob t0={t0} p={[-1, 2.6, mid[2] + 0.5]}><Arrow p={[0, 0, 0]} r={Math.PI} c={C.blue} /></Bob>
          <Panel text="RTS" p={[1.5, 0.6, mid[2] + 0.58]} h={0.3} bg={C.blue} />
          {sign}
        </>
      );
    case "cancel_before_dispatch":
      return (
        <>
          <Conveyor p={[0, 0, mid[2] + 0.5]} len={7} />
          <Riding t0={t0} x0={-3} x1={3} y={0.92} z={mid[2] + 0.5} />
          <Person p={[0.8, 0, mid[2] + 1.8]} c={C.orange} r={[0, Math.PI, 0]}>
            <Parcel p={[0, 1.4, 0.4]} s={[0.6, 0.45, 0.45]} />
          </Person>
          <Bob t0={t0} p={[0.8, 3.2, mid[2] + 1.8]} pulse={3}><Tag text="✗ CANCELLED" h={0.55} bg={C.red} /></Bob>
          {sign}
        </>
      );
    // ------------------------------------------------------------------ on the road
    case "vehicle_breakdown":
      return (
        <>
          {!externalVehicle && <Van p={[0, 0, vz]} hazard t0={t0} />}
          <TrafficCone p={[-4, 0, vz - 0.4]} />
          <group position={[-5.5, 0, vz]}>
            <ConeM p={[0, 0.45, 0]} s={[0.8, 0.9, 0.08]} r={[0, Math.PI / 2, 0]} c={C.red} e={0.5} />
          </group>
          <Steam t0={t0} p={[2.2, 1.6, vz]} c="#8d8d8d" />
          <Bob t0={t0} p={[0, 3.8, vz]} pulse={3}><Tag text="⚠ ENGINE" h={0.6} bg={C.amber} /></Bob>
          {sign}
        </>
      );
    case "severe_weather":
      return <Storm t0={t0} len={loc.edgeLen} />;
    // ------------------------------------------------------------------ returns
    case "return_label_missing":
      return (
        <>
          <DoorBase loc={loc} t0={t0} van={false} courier={false} />
          <Person p={[0.6, 0, f - 1]} c="#6c757d" r={[0, Math.PI, 0]}>
            <Parcel p={[0, 0.9, 0.38]} s={[0.6, 0.45, 0.45]} />
          </Person>
          <Panel text="LABEL: ?" p={[0.6, 1.15, f - 1.65]} h={0.2} bg="#ffffff" fg={C.red} />
          <Bob t0={t0} p={[0.6, 2.8, f - 1]}><Tag text="?" h={0.8} bg={C.amber} /></Bob>
          {sign}
        </>
      );
    case "return_label_printer":
      return (
        <>
          <Frontage p={[0, 0, f]} shop c="#d9c9ae" />
          <B p={[1.8, 0.5, f - 0.7]} s={[0.9, 1, 0.6]} c="#f1e8d0" />
          <B p={[1.8, 1.1, f - 0.7]} s={[0.7, 0.25, 0.5]} c={C.dark} />
          <B p={[1.8, 1.3, f - 0.85]} s={[0.4, 0.4, 0.02]} r={[-0.5, 0, 0]} c="#ffffff" />
          <Show t0={t0} when={(t) => Math.floor(t * 3) % 2 === 0}>
            <Tag text="ERR 0x4F" p={[1.8, 2.0, f - 0.7]} h={0.4} bg={C.red} />
          </Show>
          <Person p={[0.4, 0, f - 1.2]} c="#6c757d" r={[0, Math.PI / 2, 0]}>
            <Parcel p={[0, 0.9, 0.35]} s={[0.5, 0.4, 0.4]} />
          </Person>
          {sign}
        </>
      );
    case "return_collection_missed":
      return (
        <>
          <DoorBase loc={loc} t0={t0} van={false} courier={false} />
          <Parcel p={[0.8, 0, f - 1]} s={[0.8, 0.6, 0.6]} />
          <Panel text="RETURN" p={[0.8, 0.4, f - 1.31]} h={0.18} bg={C.amber} fg="#1b1b1b" />
          <Person p={[-0.9, 0, f - 0.8]} c="#6c757d" r={[0, Math.PI, 0]} />
          <group position={[0, 2.8, f - 0.6]}>
            <Cyl r={[Math.PI / 2, 0, 0]} s={[1.1, 0.12, 1.1]} c="#ffffff" />
            <ClockHands t0={t0} />
          </group>
          <Disc p={[-3, 0.05, vz]} s={[4, 1, 2]} c={C.amber} add o={0.25} />
          <Bob t0={t0} p={[-3, 1.4, vz]}><Tag text="NO-SHOW" h={0.5} bg={C.amber} /></Bob>
          {sign}
        </>
      );
    case "heavy_item_collection":
      return (
        <>
          <DoorBase loc={loc} t0={t0} courier={false} />
          <Movers t0={t0} from={[0.5, 0, f - 1.2]} to={[-1.5, 0, vz + 1.6]} />
          {sign}
        </>
      );
    // ------------------------------------------------------------------ business / freight / customs
    case "business_collection":
      return (
        <>
          <Frontage p={[0, 0, f]} shop c="#c1c8ce" door={C.orange} />
          <group position={[1.6, 0, f - 1]}>
            <B p={[0, 0.15, 0]} s={[1.3, 0.1, 0.8]} c={C.steel} />
            <Parcel p={[-0.3, 0.2, 0]} s={[0.55, 0.45, 0.6]} />
            <Parcel p={[0.32, 0.2, 0]} s={[0.55, 0.5, 0.6]} />
            <Parcel p={[0, 0.66, 0]} s={[0.6, 0.4, 0.55]} />
          </group>
          <Van p={[-4, 0, vz]} t0={t0} />
          <LiveTag t0={t0} p={[1.6, 2.2, f - 1]} h={0.5} bg={C.blue} text={(t) => `16:${String(Math.min(59, Math.floor(t))).padStart(2, "0")}`} />
          {sign}
        </>
      );
    case "pallet_no_appointment":
      return (
        <>
          <RollerDoor f={f} />
          <Truck p={[-1, 0, vz - 0.4]} box="#e9ecef" />
          <Pallet p={[3.2, 0, f - 1]} />
          <group position={[3.2, 2.2, f - 1]}>
            <B s={[0.9, 0.8, 0.06]} c="#ffffff" />
            <B p={[0, 0.32, -0.04]} s={[0.9, 0.16, 0.02]} c={C.red} />
          </group>
          <Bob t0={t0} p={[3.2, 3.2, f - 1]}><Tag text="✗ NO SLOT" h={0.45} bg={C.amber} /></Bob>
          {sign}
        </>
      );
    case "pallet_no_forklift":
      return (
        <>
          <RollerDoor f={f} />
          <Pallet p={[0, 0, f - 1.2]} />
          <group position={[2.3, 0, f - 1.4]}>
            <B p={[0, 0.7, 0]} s={[1.0, 1.0, 1.6]} c={C.yellow} o={0.25} />
            <B p={[0, 1.6, 0.6]} s={[0.1, 2.2, 0.1]} c={C.yellow} o={0.25} />
          </group>
          <Bob t0={t0} p={[2.3, 3, f - 1.4]}><Tag text="✗ FORKLIFT" h={0.45} bg={C.red} /></Bob>
          <Person p={[-1.3, 0, f - 1.5]} c={C.orange} r={[0, Math.PI / 2, 0]} />
          {sign}
        </>
      );
    case "pallet_missing":
      return (
        <>
          <RollerDoor f={f} />
          <Pallet p={[-1.5, 0, f - 1.2]} />
          <Pallet p={[1.5, 0, f - 1.2]} />
          <Pallet p={[0, 0, f - 1.2]} load={false} />
          <B p={[0, 0.75, f - 1.2]} s={[1.1, 1.1, 0.95]} c="#ffffff" o={0.2} />
          <Bob t0={t0} p={[0, 2.1, f - 1.2]} pulse={3}><Tag text="?" h={0.9} bg={C.red} /></Bob>
          <Panel text="2 / 3" p={[-1.5, 1.6, f - 1.75]} h={0.3} bg="#ffffff" fg={C.red} />
          {sign}
        </>
      );
    case "freight_dimensions":
      return (
        <>
          <Container p={[0, 0, mid[2] + 2.5]} c="#2e86ab" />
          <Pallet p={[-1, 0, mid[2]]} />
          <B p={[-1, 1.35, mid[2] - 0.55]} s={[1.3, 0.04, 0.08]} c={C.yellow} e={0.4} />
          <B p={[-0.38, 0.7, mid[2] - 0.55]} s={[0.06, 1.3, 0.08]} c={C.yellow} e={0.4} />
          <B p={[0.3, 1.35, mid[2] - 0.55]} s={[0.22, 0.22, 0.12]} c={C.yellow} />
          <Person p={[0.9, 0, mid[2] - 0.5]} c={C.orange} r={[0, -Math.PI / 2, 0]} />
          <Bob t0={t0} p={[-1, 2.4, mid[2]]}><Tag text="1.2 x 1.0 x ?" h={0.45} bg={C.amber} fg="#1b1b1b" /></Bob>
          {sign}
        </>
      );
    case "customs_invoice":
      return (
        <>
          <Container p={[0, 0, mid[2] + 1.5]} c="#c44536" />
          <Panel text="HELD" p={[0, 1.6, mid[2] + 0.25]} h={1.1} bg="rgba(229,56,59,0.85)" r={[0, Math.PI, 0.2]} />
          <Bob t0={t0} p={[2.6, 1.5, mid[2] - 0.5]}>
            <B s={[0.6, 0.8, 0.02]} c="#ffffff" />
            <Tag text="INVOICE ?" p={[0, 0.7, 0]} h={0.35} bg={C.dark} />
          </Bob>
          {sign}
        </>
      );
    case "customs_broker":
      return (
        <>
          <Container p={[-1.5, 0, mid[2] + 1.8]} c="#6a994e" />
          <group position={[3, 0, mid[2]]}>
            <B p={[0, 1.2, 0]} s={[1.8, 2.4, 1.6]} c="#f1e8d0" />
            <B p={[0, 1.5, -0.81]} s={[1.2, 0.8, 0.02]} c={C.glass} />
            <B p={[0, 2.5, 0]} s={[2.0, 0.15, 1.8]} c={C.blue} />
          </group>
          <Person p={[3, 0, mid[2] - 1.2]} c="#1d3557" r={[0, Math.PI, 0]} />
          <Panel text="CUSTOMS BROKER" p={[3, 2.9, mid[2] - 0.82]} h={0.3} bg={C.blue} />
          <Bob t0={t0} p={[3, 3.6, mid[2]]}><Tag text="⧗ AWAITING" h={0.4} bg={C.dark} /></Bob>
          {sign}
        </>
      );
    case "import_charge":
      return (
        <>
          <Container p={[0, 0, mid[2] + 1.8]} c="#e9c46a" />
          <Parcel p={[1, 0, mid[2]]} s={[0.9, 0.6, 0.7]} />
          <Spin t0={t0} p={[1, 1.4, mid[2]]} speed={1.5}>
            <Tag text="£ 38.20 DUTY" h={0.45} bg={C.amber} fg="#1b1b1b" />
          </Spin>
          <Bob t0={t0} p={[1, 2.3, mid[2]]} pulse={3}><Tag text="£" h={0.8} bg={C.red} /></Bob>
          {sign}
        </>
      );
    case "customs_last_mile":
      return (
        <>
          <Container p={[1.8, 0, mid[2] + 2]} c="#2e86ab" />
          <Van p={[-3.5, 0, vz]} t0={t0} />
          <Pallet p={[-0.5, 0, mid[2] + 0.4]} />
          <Bob t0={t0} p={[-1, 2.5, mid[2] + 0.5]}><Arrow p={[0, 0, 0]} r={Math.PI} c={C.green} /></Bob>
          <Show t0={t0} when={() => !resolved}>
            <Tag text="WAITING FOR VAN" p={[-0.5, 3.4, mid[2]]} h={0.4} bg={C.dark} />
          </Show>
          {sign}
        </>
      );
    // ------------------------------------------------------------------ office
    case "notification_broken":
    case "refund_review_stalled":
    case "billing_duplicate":
    case "guarantee_refund":
      return <OfficeTickets t0={t0} spec={spec} />;
  }
}

function ClockHands({ t0 }: { t0: number }) {
  const h = useRef<Group>(null);
  useSceneTime(t0, (t) => {
    if (h.current) h.current.rotation.z = -t * 2;
  });
  return (
    <group ref={h} position={[0, 0, -0.08]}>
      <B p={[0, 0.2, 0]} s={[0.06, 0.4, 0.02]} c={C.dark} />
    </group>
  );
}

function RollerDoor({ f }: { f: number }) {
  return (
    <group position={[0, 0, f]}>
      <B p={[0, 2.2, 0.3]} s={[7, 4.4, 0.6]} c="#c8ccd2" />
      <B p={[0, 1.5, -0.03]} s={[3.2, 3, 0.08]} c="#8d99ae" />
      {[0.5, 1, 1.5, 2, 2.5].map((y) => <B key={y} p={[0, y, -0.08]} s={[3.2, 0.04, 0.03]} c={C.dark} />)}
    </group>
  );
}

// Re-exported for modifier overlays.
export { Cluster as InstancedCluster, Shard };
