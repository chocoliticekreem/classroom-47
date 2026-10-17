"use client";
// Module: Depot. The Hamyway Delivery depot south of the city (ZONES.depot): warehouse with a huge branded sign,
// loading bays, conveyor with parcels, forklifts shuttling pallets, trailer park, light masts, fence and a
// gatehouse whose barrier lifts when any registry vehicle comes near the gate.
import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Group,
  InstancedMesh,
  Material,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  Shape,
  Vector3,
} from "three";
import { allVehicles } from "../registry";
import { useWorld } from "../store";
import {
  BARRIER,
  CONVEYOR,
  FORKLIFT_BOXES,
  FORKLIFT_ROUTES,
  FORKLIFT_WHEELS,
  GATE,
  PARCEL_COLORS,
  WH,
  buildLayout,
  type Item,
  type Part,
} from "./Depot/layout";
import { barrierStep, buildLegs, nightFactor, sampleForklift, type ForkliftSample } from "./Depot/logic";
import { makeRollerTexture, makeRoofTexture, makeSignTexture, makeStripeTexture, makeTrailerTexture } from "./Depot/textures";

const GEO = {
  box: new BoxGeometry(1, 1, 1),
  cyl: new CylinderGeometry(0.5, 0.5, 1, 12),
  plane: new PlaneGeometry(1, 1),
  disc: new CircleGeometry(1, 28).rotateX(-Math.PI / 2),
};
type GeoName = keyof typeof GEO;

/** Static instanced mesh: one draw call for a list of transformed items (per-instance colour when given). */
function Instanced({
  items,
  geo,
  material,
  castShadow,
  receiveShadow,
}: {
  items: Item[];
  geo: GeoName;
  material: Material;
  castShadow?: boolean;
  receiveShadow?: boolean;
}) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new Object3D();
    const col = new Color();
    items.forEach((it, i) => {
      o.position.set(it.p[0], it.p[1], it.p[2]);
      if (it.r) o.rotation.set(it.r[0], it.r[1], it.r[2]);
      else o.rotation.set(0, 0, 0);
      o.scale.set(it.s[0], it.s[1], it.s[2]);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      if (it.c) m.setColorAt(i, col.set(it.c));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [items]);
  if (items.length === 0) return null;
  return (
    <instancedMesh
      ref={ref}
      args={[GEO[geo], material, items.length]}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
    />
  );
}

interface Mats {
  solid: MeshStandardMaterial;
  door: MeshStandardMaterial;
  interior: MeshStandardMaterial;
  lamp: MeshStandardMaterial;
  sign: MeshStandardMaterial;
  roof: MeshStandardMaterial;
  livery: MeshStandardMaterial;
  fence: MeshStandardMaterial;
  pool: MeshBasicMaterial;
  body: MeshStandardMaterial;
  pad: MeshStandardMaterial;
  grass: MeshStandardMaterial;
  arm: MeshStandardMaterial;
  rubber: MeshStandardMaterial;
  textures: CanvasTexture[];
}

function makeMaterials(): Mats {
  const signTex = makeSignTexture();
  const roofTex = makeRoofTexture();
  const trailerTex = makeTrailerTexture();
  const rollerTex = makeRollerTexture();
  const stripeTex = makeStripeTexture();
  stripeTex.wrapS = RepeatWrapping;
  stripeTex.repeat.set(4, 1);
  const std = (o: ConstructorParameters<typeof MeshStandardMaterial>[0]) =>
    new MeshStandardMaterial({ roughness: 0.8, metalness: 0, ...o });
  return {
    solid: std({ color: "#ffffff", flatShading: true }),
    door: std({ map: rollerTex, roughness: 0.6, metalness: 0.2 }),
    interior: std({ color: "#3a2a18", emissive: new Color("#ffc47a"), emissiveIntensity: 0.9 }),
    lamp: std({ color: "#fff3d6", emissive: new Color("#ffe2a8"), emissiveIntensity: 0.3 }),
    sign: std({ map: signTex, emissiveMap: signTex, emissive: new Color("#ffffff"), emissiveIntensity: 0.15, roughness: 0.5 }),
    roof: std({ map: roofTex, roughness: 0.7, metalness: 0.15 }),
    livery: std({ map: trailerTex, roughness: 0.6 }),
    fence: std({ color: "#9aa3ad", transparent: true, opacity: 0.32, depthWrite: false, side: DoubleSide }),
    pool: new MeshBasicMaterial({
      color: "#ffcf8a",
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
    body: std({ color: "#d6d9dd" }),
    pad: std({ color: "#a2a5a9", roughness: 0.95 }),
    grass: std({ color: "#6fae4f", roughness: 0.95, flatShading: true }),
    arm: std({ map: stripeTex, roughness: 0.5 }),
    rubber: std({ color: "#1d1e22", roughness: 0.9 }),
    textures: [signTex, roofTex, trailerTex, rollerTex, stripeTex],
  };
}

// ---------- Forklifts (all three share two instanced meshes) ----------
const FORKLIFT_SPEED = 3.2;
const FORK_CARRY = 0.15;

function partMatrices(parts: Part[]) {
  const o = new Object3D();
  return parts.map((p) => {
    o.position.set(p.p[0], p.p[1], p.p[2]);
    o.rotation.set(p.r?.[0] ?? 0, p.r?.[1] ?? 0, p.r?.[2] ?? 0);
    o.scale.set(p.s[0], p.s[1], p.s[2]);
    o.updateMatrix();
    return o.matrix.clone();
  });
}

function makeForkliftSim() {
  const legs = FORKLIFT_ROUTES.map((r) => buildLegs(r));
  return {
    legs,
    offsets: [0, 7.3, 3.1],
    headings: legs.map(() => NaN),
    sample: { x: 0, z: 0, heading: 0, loaded: false, lift: 0 } as ForkliftSample,
    boxLocal: partMatrices(FORKLIFT_BOXES),
    wheelLocal: partMatrices(FORKLIFT_WHEELS),
    time: 0,
    m: new Matrix4(),
    lift: new Matrix4(),
    tmp: new Matrix4(),
    zero: new Matrix4().makeScale(0, 0, 0),
    q: new Quaternion(),
    e: new Euler(),
    pos: new Vector3(),
    one: new Vector3(1, 1, 1),
  };
}

function Forklifts({ solid, rubber }: { solid: Material; rubber: Material }) {
  const bodyRef = useRef<InstancedMesh>(null);
  const wheelRef = useRef<InstancedMesh>(null);
  const simRef = useRef<ReturnType<typeof makeForkliftSim> | null>(null);

  useLayoutEffect(() => {
    const b = bodyRef.current;
    if (!b) return;
    const col = new Color();
    for (let f = 0; f < FORKLIFT_ROUTES.length; f++)
      FORKLIFT_BOXES.forEach((p, i) => b.setColorAt(f * FORKLIFT_BOXES.length + i, col.set(p.c ?? "#ffffff")));
    if (b.instanceColor) b.instanceColor.needsUpdate = true;
  }, []);

  useFrame((_, delta) => {
    const b = bodyRef.current;
    const w = wheelRef.current;
    if (!b || !w) return;
    const sim = (simRef.current ??= makeForkliftSim());
    const paused = useWorld.getState().paused;
    const dt = Math.min(delta, 0.1);
    if (!paused) sim.time += dt;
    const s = sim.sample;
    for (let f = 0; f < sim.legs.length; f++) {
      sampleForklift(sim.legs[f], FORKLIFT_SPEED, sim.time + sim.offsets[f], s);
      // smooth heading so corners and reversing turns read as steering, not snapping
      let h = sim.headings[f];
      if (Number.isNaN(h)) h = s.heading;
      else if (!paused) {
        let d = s.heading - h;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        h += d * Math.min(1, dt * 7);
      }
      sim.headings[f] = h;
      sim.e.set(0, h, 0);
      sim.q.setFromEuler(sim.e);
      sim.pos.set(s.x, 0, s.z);
      sim.m.compose(sim.pos, sim.q, sim.one);
      sim.lift.makeTranslation(0, FORK_CARRY + s.lift, 0);
      for (let i = 0; i < FORKLIFT_BOXES.length; i++) {
        const part = FORKLIFT_BOXES[i];
        const idx = f * FORKLIFT_BOXES.length + i;
        if (part.load && !s.loaded) {
          b.setMatrixAt(idx, sim.zero);
          continue;
        }
        sim.tmp.copy(sim.m);
        if (part.lift) sim.tmp.multiply(sim.lift);
        sim.tmp.multiply(sim.boxLocal[i]);
        b.setMatrixAt(idx, sim.tmp);
      }
      for (let i = 0; i < FORKLIFT_WHEELS.length; i++) {
        sim.tmp.multiplyMatrices(sim.m, sim.wheelLocal[i]);
        w.setMatrixAt(f * FORKLIFT_WHEELS.length + i, sim.tmp);
      }
    }
    b.instanceMatrix.needsUpdate = true;
    w.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh
        ref={bodyRef}
        args={[GEO.box, solid, FORKLIFT_BOXES.length * FORKLIFT_ROUTES.length]}
        frustumCulled={false}
        castShadow
      />
      <instancedMesh
        ref={wheelRef}
        args={[GEO.cyl, rubber, FORKLIFT_WHEELS.length * FORKLIFT_ROUTES.length]}
        frustumCulled={false}
      />
    </group>
  );
}

// ---------- Conveyor parcels ----------
const PARCELS = 11;
const BELT_SPEED = 1.7;

function makeParcelSim() {
  const sizes: [number, number, number][] = [];
  for (let i = 0; i < PARCELS; i++) {
    const k = (i * 7919) % 13;
    sizes.push([0.45 + (k % 4) * 0.12, 0.3 + (k % 3) * 0.12, 0.4 + (k % 5) * 0.09]);
  }
  return { sizes, time: 0, o: new Object3D() };
}

function ConveyorParcels({ solid }: { solid: Material }) {
  const ref = useRef<InstancedMesh>(null);
  const simRef = useRef<{ sizes: [number, number, number][]; time: number; o: Object3D } | null>(null);

  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const col = new Color();
    for (let i = 0; i < PARCELS; i++) m.setColorAt(i, col.set(PARCEL_COLORS[(i * 5) % PARCEL_COLORS.length]));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, []);

  useFrame((_, delta) => {
    const m = ref.current;
    if (!m) return;
    const sim = (simRef.current ??= makeParcelSim());
    if (!useWorld.getState().paused) sim.time += Math.min(delta, 0.1);
    const len = CONVEYOR.maxX - CONVEYOR.minX;
    const spacing = len / PARCELS;
    const o = sim.o;
    for (let i = 0; i < PARCELS; i++) {
      const d = (sim.time * BELT_SPEED + i * spacing + (i % 3) * 0.35) % len;
      const [sx, sy, sz] = sim.sizes[i];
      o.position.set(CONVEYOR.minX + d, CONVEYOR.y + sy / 2, CONVEYOR.z + ((i % 3) - 1) * 0.12);
      o.rotation.set(0, ((i % 4) - 1.5) * 0.12, 0);
      // shrink into the tunnel mouths so parcels appear/disappear cleanly
      const edge = Math.min(d, len - d);
      const k = Math.min(1, edge / 0.35);
      o.scale.set(sx * k, sy * k, sz * k);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={ref} args={[GEO.box, solid, PARCELS]} frustumCulled={false} castShadow />;
}

// ---------- Gate barrier ----------
const GATE_RADIUS = 12;

function Barrier({ arm }: { arm: Material }) {
  const pivot = useRef<Group>(null);
  const state = useRef({ open: 0 });
  useFrame((_, delta) => {
    const g = pivot.current;
    if (!g) return;
    const r2 = GATE_RADIUS * GATE_RADIUS;
    let near = false;
    for (const v of allVehicles()) {
      const p = v.object.position;
      let dx = p.x - GATE.x;
      let dz = p.z - GATE.z;
      if (dx * dx + dz * dz <= r2) {
        near = true;
        break;
      }
      dx = p.x;
      dz = p.z - BARRIER.z;
      if (dx * dx + dz * dz <= r2) {
        near = true;
        break;
      }
    }
    if (!useWorld.getState().paused) state.current.open = barrierStep(state.current.open, near, Math.min(delta, 0.1));
    const u = state.current.open;
    const eased = u * u * (3 - 2 * u);
    g.rotation.z = -eased * 1.42;
  });
  return (
    <group ref={pivot} position={[BARRIER.pivotX, BARRIER.y, BARRIER.z]}>
      <mesh position={[-BARRIER.length / 2, 0, 0]} material={arm} castShadow>
        <boxGeometry args={[BARRIER.length, 0.16, 0.16]} />
      </mesh>
    </group>
  );
}

// ---------- Night lighting (material intensities only; no extra lights) ----------
function NightLights({ mats }: { mats: Mats }) {
  const last = useRef(-1);
  const matsRef = useRef(mats);
  useFrame(() => {
    const m = matsRef.current;
    const n = nightFactor(useWorld.getState().timeOfDay);
    if (Math.abs(n - last.current) < 0.005) return;
    last.current = n;
    m.lamp.emissiveIntensity = 0.25 + 2.6 * n;
    m.sign.emissiveIntensity = 0.15 + 0.85 * n;
    m.interior.emissiveIntensity = 0.9 + 1.5 * n;
    m.pool.opacity = 0.32 * n;
    m.pool.visible = n > 0.01;
  });
  return null;
}

export default function Depot() {
  const layout = useMemo(() => buildLayout(), []);
  const mats = useMemo(() => makeMaterials(), []);
  useEffect(
    () => () => {
      for (const t of mats.textures) t.dispose();
      for (const m of Object.values(mats)) if (m instanceof Material) m.dispose();
    },
    [mats],
  );

  const grassShape = useMemo(() => {
    // planted island inside the access-road triangle; shape y = -world z (rotated flat below)
    const s = new Shape();
    s.moveTo(0, -265.5);
    s.lineTo(-27.5, -295.5);
    s.lineTo(27.5, -295.5);
    s.closePath();
    return s;
  }, []);

  const whW = WH.maxX - WH.minX;
  const whD = WH.back - WH.front;
  const whZ = (WH.front + WH.back) / 2;

  return (
    <group name="depot">
      {/* yard pad */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.01, 286.5]} material={mats.pad} receiveShadow>
        <planeGeometry args={[120, 87]} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]} material={mats.grass} receiveShadow>
        <shapeGeometry args={[grassShape]} />
      </mesh>
      {/* warehouse shell + roof */}
      <mesh position={[0, WH.h / 2, whZ]} material={mats.body} castShadow receiveShadow>
        <boxGeometry args={[whW, WH.h, whD]} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, WH.h + 0.02, whZ]} material={mats.roof} receiveShadow>
        <planeGeometry args={[whW - 0.4, whD - 0.4]} />
      </mesh>

      <Instanced items={layout.solid} geo="box" material={mats.solid} castShadow receiveShadow />
      <Instanced items={layout.cyl} geo="cyl" material={mats.solid} />
      <Instanced items={layout.doors} geo="box" material={mats.door} />
      <Instanced items={layout.interior} geo="box" material={mats.interior} />
      <Instanced items={layout.lamps} geo="box" material={mats.lamp} />
      <Instanced items={layout.signs} geo="plane" material={mats.sign} />
      <Instanced items={layout.livery} geo="plane" material={mats.livery} />
      <Instanced items={layout.fence} geo="box" material={mats.fence} />
      <Instanced items={layout.pools} geo="disc" material={mats.pool} />

      <ConveyorParcels solid={mats.solid} />
      <Forklifts solid={mats.solid} rubber={mats.rubber} />
      <Barrier arm={mats.arm} />
      <NightLights mats={mats} />
    </group>
  );
}

