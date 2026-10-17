"use client";
// Module: Crashes. Crash director + crash choreography + crash VFX.
// Every 35-60 s (and on bus request:crash) it stages one of:
//  - a real collision between registry vehicles (rear-end / solo, via crash()),
//  - a scripted ordinary crash: red-light T-bone at a junction, rear-end shunt, highway side-swipe,
//    rollover onto the roof, or a jackknifed burning HGV,
//  - a multi-vehicle pileup (6-13 vehicles concertina over ~3-4 s on the A-Ring or a downtown avenue).
// Each impact gets its own flash, sparks, glass, airbags, skid marks, smoke/steam/fire and a vehicle:crashed
// event (so camera shake ripples). Fast traffic arriving at the tail may cause secondary collisions.
// Responders moves the incident on; when it is "cleared" everything here is removed.
// Safety net: an incident nobody responds to is cleared here after 60 s (120 s for pileups).
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { emit, on } from "../bus";
import { allVehicles, getVehicle, nextId, type VehicleEntry, type VehicleKind } from "../registry";
import { edgeKey as makeEdgeKey, edgeMidpoint, getNode, ROAD_EDGES } from "../roads";
import { blockedSet, useWorld, type IncidentStatus } from "../store";
import {
  participants,
  planJackknife,
  planJunction,
  planPileup,
  planRollover,
  planSecondary,
  planShunt,
  planSideswipe,
  type Actor,
  type Approaching,
  type Choreo,
  type RealRef,
} from "./Crashes/choreo";
import {
  crashNote,
  findRearEnd,
  findSolo,
  pickJunction,
  pickPileupRun,
  pickScriptedEdge,
  roadName,
  type CrashKind,
  type Scenario,
} from "./Crashes/director";
import { DebrisPool, DecalPool, ParticlePool } from "./Crashes/particles";
import { makeParticleMesh, markParticlesDirty } from "./Crashes/vfx";
import { ActorView, CAR_COLORS, ENGINE_Z, getShared, SiteMarker, type Frame, type LaneRef } from "./Crashes/wrecks";

const MAX_ACTIVE = 3;
const SAFETY_S = 60;
const SAFETY_PILEUP_S = 120;
const LIGHTS = 2; // pre-mounted so a fire never forces a shader recompile
const MAX_EMITTERS = 8;
const LEAD_IN = 0.15; // let scripted actors mount (and register) before the first impact
const WIND_X = 0.9;
const WIND_Z = 0.35;
const CIVIL = new Set<VehicleKind>(["car", "taxi", "van", "truck"]);

const Em = { Smoke: 0, Heavy: 1, Steam: 2, Fire: 3 } as const;
type Em = (typeof Em)[keyof typeof Em];

interface Emitter {
  type: Em;
  x: number;
  z: number;
  acc: number;
  acc2: number;
}

interface Visual {
  slot: number;
  incidentId: string;
  kind: CrashKind;
  title: string;
  frame: Frame;
  tri: [number, number];
  labelZ: number;
  size: number;
  actors: Actor[];
  lanes: LaneRef[];
  clock: { t: number };
  status: IncidentStatus;
}

interface Slot {
  active: boolean;
  incidentId: string;
  note: string;
  edges: string[];
  kind: CrashKind;
  status: IncidentStatus;
  age: number;
  safety: number;
  clock: { t: number };
  frame: Frame;
  choreo: Choreo | null;
  next: number;
  emitters: Emitter[];
  emitterCount: number;
  light: number;
  flash: number;
  flashX: number;
  flashZ: number;
}

const newSlot = (): Slot => ({
  active: false,
  incidentId: "",
  note: "",
  edges: [],
  kind: "car_crash",
  status: "active",
  age: 0,
  safety: SAFETY_S,
  clock: { t: 0 },
  frame: { cx: 0, cz: 0, h: 0 },
  choreo: null,
  next: 0,
  emitters: Array.from({ length: MAX_EMITTERS }, () => ({ type: Em.Smoke, x: 0, z: 0, acc: 0, acc2: 0 })),
  emitterCount: 0,
  light: -1,
  flash: 0,
  flashX: 0,
  flashZ: 0,
});

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Local (lx, lz) in frame f -> world, written into out. */
function toWorld(f: Frame, lx: number, lz: number, out: { x: number; z: number }) {
  const c = Math.cos(f.h);
  const s = Math.sin(f.h);
  out.x = f.cx + lx * c + lz * s;
  out.z = f.cz - lx * s + lz * c;
  return out;
}
/** World -> local z (along the frame's direction of travel). */
function localZ(f: Frame, x: number, z: number) {
  return (x - f.cx) * Math.sin(f.h) + (z - f.cz) * Math.cos(f.h);
}
/** Point in an actor's own frame (lat, along) at pose (px, pz, yaw) -> crash-frame local. */
function actorLocal(px: number, pz: number, yaw: number, lat: number, along: number, out: { x: number; z: number }) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  out.x = px + lat * c + along * s;
  out.z = pz - lat * s + along * c;
  return out;
}

const TITLES: Record<Scenario, string> = {
  rear_end: "CRASH",
  solo: "CRASH",
  junction: "RED-LIGHT SMASH",
  shunt: "REAR-END SHUNT",
  sideswipe: "SIDE-SWIPE",
  rollover: "ROLLOVER",
  jackknife: "HGV FIRE",
  pileup: "PILEUP",
};

export default function Crashes() {
  const [visuals, setVisuals] = useState<Visual[]>([]);
  const slots = useRef<Slot[]>(Array.from({ length: MAX_ACTIVE }, newSlot));
  const queue = useRef<CrashKind[]>([]);
  const timer = useRef(35 + Math.random() * 25);
  const lights = useRef<(THREE.PointLight | null)[]>([]);
  const lightOwner = useRef<number[]>(Array.from({ length: LIGHTS }, () => -1));

  // Pools and their meshes (one draw call each).
  const fx = useMemo(() => {
    const smoke = new ParticlePool(1400);
    const glow = new ParticlePool(1000);
    const glass = new DebrisPool(420, 0.3);
    const cargo = new DebrisPool(48, 0.5);
    const decals = new DecalPool(220);
    const smokeMesh = makeParticleMesh(smoke, false);
    const glowMesh = makeParticleMesh(glow, true);
    const debrisMat = new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.25, flatShading: true });
    const glassMesh = new THREE.InstancedMesh(new THREE.TetrahedronGeometry(0.5), debrisMat, glass.n);
    const cargoMat = new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true });
    const cargoMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), cargoMat, cargo.n);
    for (const [m, p] of [
      [glassMesh, glass],
      [cargoMesh, cargo],
    ] as const) {
      m.instanceColor = new THREE.InstancedBufferAttribute(p.color, 3);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
    }
    cargoMesh.castShadow = true;
    const decalMat = new THREE.MeshBasicMaterial({
      color: "#0b0b0c",
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
    });
    const decalMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), decalMat, decals.n);
    decalMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    decalMesh.frustumCulled = false;
    decalMesh.renderOrder = 2;
    const dummy = new THREE.Object3D();
    writeDebris(glass, glassMesh, dummy);
    writeDebris(cargo, cargoMesh, dummy);
    writeDecals(decals, decalMesh, dummy);
    return { smoke, glow, glass, cargo, decals, smokeMesh, glowMesh, glassMesh, cargoMesh, decalMesh };
  }, []);

  useEffect(
    () => () => {
      for (const m of [fx.smokeMesh, fx.glowMesh, fx.glassMesh, fx.cargoMesh, fx.decalMesh]) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    },
    [fx],
  );

  // Scratch objects (no per-frame allocation).
  const scratch = useMemo(
    () => ({
      dummy: new THREE.Object3D(),
      p: { x: 0, z: 0 },
      q: { x: 0, z: 0 },
      r: { x: 0, z: 0 },
      col: new THREE.Color(),
      debrisDirty: true,
    }),
    [],
  );

  // UI requests.
  useEffect(
    () =>
      on((e) => {
        if (e.type === "request:crash" && queue.current.length < 3) queue.current.push(e.kind);
      }),
    [],
  );

  // If this module unmounts, reopen the roads it closed and clear its incidents.
  useEffect(() => {
    const s = slots.current;
    return () => {
      for (const sl of s) if (sl.active) finishIncident(sl);
    };
  }, []);

  // --- VFX helpers -------------------------------------------------------------

  function burst(slot: number, x: number, z: number, dx: number, dz: number, strength: number, heavy: boolean, airbag: boolean, paint: string) {
    const { glow, smoke, glass } = fx;
    const k = heavy ? 1.4 : 1;
    glow.emit(x, 1.2, z, 0, 0, 0, 0.35, 2, (10 + 10 * strength) * k, 1, 1, 0.9, 0.6, 1, 0.6, 0.2, 0, 0, 0, slot);
    glow.emit(x, 1, z, 0, 0.5, 0, 0.7, 1, (6 + 6 * strength) * k, 0.9, 1, 0.5, 0.12, 0.8, 0.15, 0.02, 0, 0, 0, slot);
    const sparks = Math.round((25 + 50 * strength) * k);
    for (let i = 0; i < sparks; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rnd(5, 14);
      glow.emit(x, 0.9, z, Math.cos(a) * sp + dx * 4, rnd(2, 10), Math.sin(a) * sp + dz * 4,
        rnd(0.4, 1.1), rnd(0.35, 0.6), 0.08, 1, 1, 0.92, 0.55, 1, 0.35, 0.05, 20, 0.5, 0, slot);
    }
    const ring = Math.round(10 + 8 * strength);
    for (let i = 0; i < ring; i++) {
      const a = (i / ring) * Math.PI * 2;
      const sp = rnd(3, 6.5);
      smoke.emit(x, 0.5, z, Math.cos(a) * sp, rnd(0.4, 1.4), Math.sin(a) * sp,
        rnd(1.3, 2.4), 1.4, rnd(4, 6) * k, 0.6, 0.58, 0.55, 0.5, 0.75, 0.73, 0.7, -0.3, 1.6, rnd(-0.5, 0.5), slot);
    }
    if (airbag)
      for (let i = 0; i < 2; i++)
        smoke.emit(x + rnd(-0.5, 0.5), 1.15, z + rnd(-0.5, 0.5), rnd(-0.4, 0.4), rnd(0.3, 0.8), rnd(-0.4, 0.4),
          rnd(0.7, 1.0), 0.4, 1.7, 0.95, 1, 1, 1, 0.95, 0.95, 0.97, 0, 1.5, rnd(-1, 1), slot);
    // glass, plastic and paint: thrown forward with the momentum, so a pileup leaves a long trail
    scratch.col.set(paint);
    const n = Math.round((14 + 26 * strength) * k);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rnd(1.5, 7);
      const fwd = rnd(2, 9);
      const pick = Math.random();
      let r = 0.78;
      let g = 0.93;
      let b = 1;
      if (pick > 0.55 && pick < 0.8) r = g = b = 0.12;
      else if (pick >= 0.8) {
        r = scratch.col.r;
        g = scratch.col.g;
        b = scratch.col.b;
      }
      glass.spawn({ x, y: 0.9, z, vx: Math.cos(a) * sp + dx * fwd, vy: rnd(3, 8), vz: Math.sin(a) * sp + dz * fwd, scale: rnd(0.25, 0.6), r, g, b, spin: 20, owner: slot });
    }
    scratch.debrisDirty = true;
  }

  function spillCargo(slot: number, rx: number, rz: number, dx: number, dz: number) {
    for (let i = 0; i < 16; i++) {
      const sp = rnd(2, 8);
      const side = rnd(-0.7, 0.7);
      const pick = Math.random();
      const [r, g, b] = pick < 0.55 ? [0.74, 0.55, 0.33] : pick < 0.85 ? [1, 0.42, 0.1] : [0.95, 0.94, 0.9];
      fx.cargo.spawn({ x: rx + rnd(-0.8, 0.8), y: rnd(1.5, 3.2), z: rz + rnd(-0.8, 0.8), vx: (dx + side * dz) * sp, vy: rnd(2, 7), vz: (dz - side * dx) * sp, scale: rnd(0.7, 1.25), r, g, b, spin: 7, owner: slot });
    }
    scratch.debrisDirty = true;
  }

  /** Two tyre strips from (x0,z0) to (x1,z1) (world), offset sideways by +-0.8 m. */
  function skid(slot: number, x0: number, z0: number, x1: number, z1: number) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 0.5) return;
    const ox = ((z1 - z0) / len) * 0.8;
    const oz = (-(x1 - x0) / len) * 0.8;
    fx.decals.add(x0 + ox, z0 + oz, x1 + ox, z1 + oz, 0.32, slot);
    fx.decals.add(x0 - ox, z0 - oz, x1 - ox, z1 - oz, 0.32, slot);
  }

  function addEmitter(sl: Slot, type: Em, x: number, z: number) {
    if (sl.emitterCount >= MAX_EMITTERS) return;
    const e = sl.emitters[sl.emitterCount++];
    e.type = type;
    e.x = x;
    e.z = z;
    e.acc = 0;
    e.acc2 = 0;
  }

  function claimLight(slot: number) {
    for (let i = 0; i < LIGHTS; i++)
      if (lightOwner.current[i] === -1) {
        lightOwner.current[i] = slot;
        return i;
      }
    return -1;
  }

  function releaseLight(sl: Slot) {
    if (sl.light >= 0) {
      lightOwner.current[sl.light] = -1;
      const L = lights.current[sl.light];
      if (L) L.intensity = 0;
    }
    sl.light = -1;
  }

  function flashAt(index: number, x: number, z: number) {
    const sl = slots.current[index];
    if (sl.light < 0) sl.light = claimLight(index);
    sl.flash = 0.4;
    sl.flashX = x;
    sl.flashZ = z;
  }

  // --- Lifecycle ---------------------------------------------------------------

  /** Remove everything this crash put in the world (VFX, wrecks, light, extra closures). */
  function teardown(index: number) {
    const sl = slots.current[index];
    if (!sl.active) return;
    sl.active = false;
    sl.choreo = null;
    releaseLight(sl);
    reopen(sl);
    fx.smoke.killOwner(index, 1.2);
    fx.glow.killOwner(index, 0.25);
    fx.glass.killOwner(index);
    fx.cargo.killOwner(index);
    fx.decals.killOwner(index);
    scratch.debrisDirty = true;
    const id = sl.incidentId;
    setVisuals((v) => v.filter((x) => x.incidentId !== id));
  }

  // --- Building crashes ----------------------------------------------------------

  const idGen = () => nextId("WRECK");

  /** Real fast vehicles on the given directed lanes, behind the tail of the wreckage. */
  function approaching(f: Frame, lanes: [string, string][], tailZ: number, exclude: Set<string>): Approaching[] {
    const out: Approaching[] = [];
    for (const v of allVehicles()) {
      if (!CIVIL.has(v.kind) || v.stopped || exclude.has(v.id)) continue;
      if (!lanes.some(([a, b]) => v.from === a && v.to === b)) continue;
      const behind = tailZ - localZ(f, v.object.position.x, v.object.position.z);
      if (behind > 0) out.push({ id: v.id, behind, speed: v.speed });
    }
    return out;
  }

  function laneFor(from: string, to: string, len: number, z: number): LaneRef {
    return { edgeKey: makeEdgeKey(from, to), from, to, t: clamp01(0.5 + z / len) };
  }

  function createCrash(requested: CrashKind) {
    const index = slots.current.findIndex((s) => !s.active);
    if (index < 0) return;
    const blocked = blockedSet();
    for (const s of slots.current) if (s.active) for (const k of s.edges) blocked.add(k);
    const sl = slots.current[index];
    const now = performance.now();

    let kind = requested;
    let scenario: Scenario;
    let frame: Frame;
    let choreo: Choreo;
    let edges: string[];
    let lanes: LaneRef[];
    let noteFrom: string;
    let noteTo: string;
    let aKind: VehicleKind = kind === "truck_crash" ? "truck" : "car";
    let bKind: VehicleKind = "car";
    let tri: [number, number] = [2.8, -15];
    let labelZ = 0;
    let size = 1;
    let center = { x: 0, z: 0 };
    let secondaryLanes: [string, string][];
    const immediate: VehicleEntry[] = [];
    let note: string | null = null;

    if (kind === "pileup") {
      const run = pickPileupRun(Math.random, blocked);
      if (!run) return;
      const A = getNode(run.a);
      const C = getNode(run.c);
      const total = run.l1 + run.l2;
      const headS = run.highway ? rnd(90, Math.min(total - 12, 150)) : rnd(58, Math.min(total - 8, 70));
      const ux = (C.x - A.x) / total;
      const uz = (C.z - A.z) / total;
      frame = { cx: A.x + ux * headS, cz: A.z + uz * headS, h: Math.atan2(ux, uz) };
      const sOf = (v: VehicleEntry) => {
        if (v.from === run.a && v.to === run.b) return v.t * run.l1;
        if (v.from === run.b && v.to === run.c) return run.l1 + v.t * run.l2;
        if (v.from === run.c && v.to === run.b) return run.l1 + (1 - v.t) * run.l2;
        if (v.from === run.b && v.to === run.a) return (1 - v.t) * run.l1;
        return null;
      };
      const same: RealRef[] = [];
      const opp: RealRef[] = [];
      for (const v of allVehicles()) {
        if (!CIVIL.has(v.kind) || v.stopped || !v.crash) continue;
        const s = sOf(v);
        if (s === null) continue;
        const forward = (v.from === run.a && v.to === run.b) || (v.from === run.b && v.to === run.c);
        (forward ? same : opp).push({ id: v.id, z: s - headS, kind: v.kind });
      }
      choreo = planPileup({ rand: Math.random, highway: run.highway, room: headS, same, opp, ids: idGen, colors: CAR_COLORS });
      scenario = "pileup";
      noteFrom = run.a;
      noteTo = run.c;
      const midS = headS + choreo.tailZ / 2;
      const primary = midS > run.l1 ? makeEdgeKey(run.b, run.c) : makeEdgeKey(run.a, run.b);
      edges = [primary, primary === makeEdgeKey(run.a, run.b) ? makeEdgeKey(run.b, run.c) : makeEdgeKey(run.a, run.b)];
      lanes = choreo.actors.map((a) => {
        const s = headS + a.rest.z;
        return s < run.l1
          ? { edgeKey: makeEdgeKey(run.a, run.b), from: run.a, to: run.b, t: clamp01(s / run.l1) }
          : { edgeKey: makeEdgeKey(run.b, run.c), from: run.b, to: run.c, t: clamp01((s - run.l1) / run.l2) };
      });
      tri = [2.8, choreo.tailZ - 14];
      labelZ = choreo.tailZ / 2;
      size = 2.2;
      center = toWorld(frame, 0, labelZ, { x: 0, z: 0 });
      secondaryLanes = [
        [run.a, run.b],
        [run.b, run.c],
      ];
      note = crashNote("pileup", "pileup", run.a, run.c, Math.random, "car", "car", participants(choreo));
    } else {
      // 1) real collision first (most of the time), else a scripted set piece
      const tryReal = Math.random() < (kind === "truck_crash" ? 0.6 : 0.5);
      scenario = "rear_end";
      if (tryReal) {
        const pair = findRearEnd(allVehicles(), { blocked, kind });
        if (pair) {
          for (const v of pair) if (v.crash?.()) immediate.push(v);
          if (immediate.length === 1) scenario = "solo";
        }
        if (!immediate.length) {
          scenario = "solo";
          const tried = new Set<string>();
          for (let attempt = 0; attempt < 4 && !immediate.length; attempt++) {
            const v = findSolo([...allVehicles()].filter((c) => !tried.has(c.id)), { blocked, kind });
            if (!v) break;
            tried.add(v.id);
            if (v.crash?.()) immediate.push(v);
          }
        }
      }

      if (immediate.length) {
        const lead = immediate[0];
        noteFrom = lead.from!;
        noteTo = lead.to!;
        const na = getNode(noteFrom);
        const nb = getNode(noteTo);
        let x = 0;
        let z = 0;
        for (const v of immediate) {
          x += v.object.position.x;
          z += v.object.position.z;
        }
        frame = { cx: x / immediate.length, cz: z / immediate.length, h: Math.atan2(nb.x - na.x, nb.z - na.z) };
        if (immediate.some((v) => v.kind === "truck")) kind = "truck_crash";
        aKind = immediate[0].kind;
        bKind = immediate[1]?.kind ?? "car";
        choreo = { actors: [], impacts: [], tailZ: -4, duration: 0 };
        edges = [lead.edgeKey ?? makeEdgeKey(noteFrom, noteTo)];
        lanes = [];
        tri = [0.6, -16];
        secondaryLanes = [[noteFrom, noteTo]];
      } else if (kind === "truck_crash") {
        const key = pickScriptedEdge(Math.random, blocked, new Set());
        if (!key) return;
        const e = ROAD_EDGES.get(key)!;
        [noteFrom, noteTo] = Math.random() < 0.5 ? [e.a, e.b] : [e.b, e.a];
        const na = getNode(noteFrom);
        const nb = getNode(noteTo);
        const [mx, mz] = edgeMidpoint(key);
        frame = { cx: mx, cz: mz, h: Math.atan2(nb.x - na.x, nb.z - na.z) };
        scenario = "jackknife";
        choreo = planJackknife({ rand: Math.random, ids: idGen, colors: CAR_COLORS });
        edges = [key];
        lanes = choreo.actors.map((a) => laneFor(noteFrom, noteTo, e.length, a.rest.z));
        secondaryLanes = [[noteFrom, noteTo]];
      } else {
        const junction = Math.random() < 0.4 ? pickJunction(Math.random, blocked, now) : null;
        if (junction) {
          const n = getNode(junction.node);
          const to = getNode(junction.aTo);
          frame = { cx: n.x, cz: n.z, h: Math.atan2(to.x - n.x, to.z - n.z) };
          const bf = getNode(junction.bFrom);
          const side = (bf.x - n.x) * Math.cos(frame.h) - (bf.z - n.z) * Math.sin(frame.h) > 0 ? 1 : -1;
          scenario = "junction";
          choreo = planJunction({ rand: Math.random, ids: idGen, colors: CAR_COLORS }, side);
          noteFrom = junction.bFrom;
          noteTo = junction.node;
          edges = [makeEdgeKey(junction.node, junction.aTo), makeEdgeKey(junction.bFrom, junction.node)];
          lanes = [
            { edgeKey: edges[0], from: junction.node, to: junction.aTo, t: 0.1 },
            { edgeKey: edges[1], from: junction.bFrom, to: junction.node, t: 0.92 },
          ];
          tri = [2.8, -12];
          secondaryLanes = [
            [junction.aFrom, junction.node],
            [junction.bFrom, junction.node],
          ];
          note = `Car ran a red on ${roadName(edges[1])} and T-boned another at the ${roadName(edges[0])} junction, glass everywhere`;
        } else {
          const key = pickScriptedEdge(Math.random, blocked, new Set());
          if (!key) return;
          const e = ROAD_EDGES.get(key)!;
          [noteFrom, noteTo] = Math.random() < 0.5 ? [e.a, e.b] : [e.b, e.a];
          const na = getNode(noteFrom);
          const nb = getNode(noteTo);
          const [mx, mz] = edgeMidpoint(key);
          frame = { cx: mx, cz: mz, h: Math.atan2(nb.x - na.x, nb.z - na.z) };
          const r = Math.random();
          const hw = e.kind === "highway";
          const s = { rand: Math.random, ids: idGen, colors: CAR_COLORS };
          if (hw ? r < 0.4 : false) [scenario, choreo] = ["sideswipe", planSideswipe(s)];
          else if (r < (hw ? 0.75 : 0.65)) [scenario, choreo] = ["shunt", planShunt(s)];
          else [scenario, choreo] = ["rollover", planRollover(s)];
          edges = [key];
          lanes = choreo.actors.map((a) => laneFor(noteFrom, noteTo, e.length, a.rest.z));
          secondaryLanes = [[noteFrom, noteTo]];
        }
      }
      if (!immediate.length) center = toWorld(frame, 0, 0, { x: 0, z: 0 });
      else center = { x: frame.cx, z: frame.cz };
    }

    // Secondary collisions: fast traffic closing on the tail may not stop in time.
    const involved = new Set(choreo.impacts.map((i) => i.vehicleId ?? "").concat(immediate.map((v) => v.id)));
    const second = planSecondary(approaching(frame, secondaryLanes, choreo.tailZ, involved), Math.max(0.5, choreo.duration), Math.random, kind === "pileup" ? 0.4 : 0.25);
    if (second.length) {
      choreo.impacts.push(...second);
      choreo.impacts.sort((a, b) => a.at - b.at);
      choreo.duration = choreo.impacts[choreo.impacts.length - 1].at;
    }

    const incidentId = nextId("INC");
    const finalNote = note ?? crashNote(kind, scenario, noteFrom, noteTo, Math.random, aKind, bKind);
    Object.assign(sl, {
      active: true,
      incidentId,
      note: finalNote,
      edges,
      kind,
      status: "active" as IncidentStatus,
      age: 0,
      safety: kind === "pileup" ? SAFETY_PILEUP_S : SAFETY_S,
      clock: { t: -LEAD_IN },
      frame,
      choreo,
      next: 0,
      emitterCount: 0,
      flash: 0,
      light: -1,
    });

    const w = useWorld.getState();
    w.addIncident({ id: incidentId, kind, edgeKey: edges[0], x: center.x, z: center.z, status: "active", createdAt: now, note: finalNote });
    for (const k of edges) {
      w.blockEdge(k, finalNote);
      emit({ type: "road:blocked", edgeKey: k, reason: finalNote });
    }
    emit({ type: "incident:created", incidentId });

    // Real crashes that already happened: VFX now.
    for (const v of immediate) realImpact(index, v, v.kind === "truck" ? 1 : 0.75, false);

    const title = kind === "pileup" ? `PILEUP ×${participants(choreo)}` : TITLES[scenario];
    const visual: Visual = { slot: index, incidentId, kind, title, frame, tri, labelZ, size, actors: choreo.actors, lanes, clock: sl.clock, status: "active" };
    setVisuals((v) => [...v, visual]);
  }

  /** VFX + bookkeeping for a real registry vehicle that has just crashed. */
  function realImpact(index: number, v: VehicleEntry, strength: number, callCrash: boolean) {
    if (callCrash && !v.crash?.()) return;
    const sl = slots.current[index];
    const px = v.object.position.x;
    const pz = v.object.position.z;
    const hx = Math.sin(v.object.rotation.y);
    const hz = Math.cos(v.object.rotation.y);
    const truck = v.kind === "truck";
    burst(index, px + hx * 2, pz + hz * 2, hx, hz, strength, truck, !truck, CAR_COLORS[(px * 7) & 7] ?? "#888");
    skid(index, px - hx * 10, pz - hz * 10, px, pz);
    flashAt(index, px, pz);
    if (truck) {
      addEmitter(sl, Em.Fire, px + hx * 2, pz + hz * 2);
      spillCargo(index, px - hx * 5, pz - hz * 5, -hx, -hz);
    } else addEmitter(sl, sl.emitterCount < 2 ? Em.Smoke : Em.Steam, px + hx * 1.5, pz + hz * 1.5);
    emit({ type: "vehicle:crashed", vehicleId: v.id, incidentId: sl.incidentId });
  }

  /** A scripted actor reaches its moment of impact. */
  function actorImpact(index: number, a: Actor, strength: number) {
    const sl = slots.current[index];
    const f = sl.frame;
    const hgv = a.model === "hgv";
    // impact point: the actor's nose at contact
    const nose = actorLocal(a.contact.x, a.contact.z, a.contact.yaw, 0, hgv ? 2.8 : 2.1, scratch.p);
    const P = toWorld(f, nose.x, nose.z, scratch.q);
    const c = Math.cos(f.h);
    const s = Math.sin(f.h);
    const dx = Math.sin(a.contact.yaw) * c + Math.cos(a.contact.yaw) * s;
    const dz = -Math.sin(a.contact.yaw) * s + Math.cos(a.contact.yaw) * c;
    burst(index, P.x, P.z, dx, dz, strength, hgv, !hgv && a.role !== "lead", a.color);
    flashAt(index, P.x, P.z);
    // skid marks: braking before contact, then the slide to rest
    if (a.speed > 0) {
      const brake = Math.min(14, Math.max(5, a.speed * 0.6));
      const b0 = toWorld(f, a.contact.x - Math.sin(a.contact.yaw) * brake, a.contact.z - Math.cos(a.contact.yaw) * brake, scratch.r);
      const bx = b0.x;
      const bz = b0.z;
      const c0 = toWorld(f, a.contact.x, a.contact.z, scratch.p);
      const cx = c0.x;
      const cz = c0.z;
      skid(index, bx, bz, cx, cz);
      const r0 = toWorld(f, a.rest.x, a.rest.z, scratch.r);
      skid(index, cx, cz, r0.x, r0.z);
    }
    // what burns / smokes / steams once it comes to rest
    const eng = actorLocal(a.rest.x, a.rest.z, a.rest.yaw, 0, hgv ? ENGINE_Z.hgv : ENGINE_Z.car, scratch.p);
    const E = toWorld(f, eng.x, eng.z, scratch.r);
    if (a.fire) addEmitter(sl, Em.Fire, E.x, E.z);
    else if (hgv) addEmitter(sl, Em.Heavy, E.x, E.z);
    else if (a.steam) addEmitter(sl, Em.Steam, E.x, E.z);
    else if (a.crumpled && Math.random() < 0.4) addEmitter(sl, Em.Smoke, E.x, E.z);
    if (hgv) {
      // cargo out of the back of the trailer
      const rear = actorLocal(a.rest.x, a.rest.z, a.rest.yaw + a.rest.fold, 0, -8.5, scratch.p);
      const R = toWorld(f, rear.x, rear.z, scratch.r);
      const yaw = f.h + a.rest.yaw + a.rest.fold;
      spillCargo(index, R.x, R.z, -Math.sin(yaw), -Math.cos(yaw));
    }
    emit({ type: "vehicle:crashed", vehicleId: a.id, incidentId: sl.incidentId });
  }

  // --- Frame loop ------------------------------------------------------------------

  useFrame((_, rawDt) => {
    const w = useWorld.getState();
    const t = performance.now() / 1000;
    getShared().hazardMat.emissiveIntensity = Math.floor(t * 2.6) % 2 ? 3 : 0.1;
    if (w.paused) return;
    const dt = Math.min(rawDt, 0.1);

    // Director
    timer.current -= dt;
    if (timer.current <= 0) {
      timer.current = rnd(35, 60);
      const r = Math.random();
      queue.current.push(r < 0.15 ? "pileup" : r < 0.45 ? "truck_crash" : "car_crash");
    }
    while (queue.current.length) {
      const k = queue.current.shift()!;
      if (slots.current.some((s) => !s.active)) createCrash(k);
    }

    const incidents = w.incidents;
    for (let i = 0; i < MAX_ACTIVE; i++) {
      const sl = slots.current[i];
      if (!sl.active) continue;
      sl.age += dt;
      sl.clock.t += dt;

      // Choreography: fire every impact whose time has come.
      const ch = sl.choreo;
      while (ch && sl.next < ch.impacts.length && ch.impacts[sl.next].at <= sl.clock.t) {
        const im = ch.impacts[sl.next++];
        if (im.actor >= 0) actorImpact(i, ch.actors[im.actor], im.strength);
        else if (im.vehicleId) {
          const v = getVehicle(im.vehicleId);
          if (v) realImpact(i, v, im.strength, true);
        }
      }

      // Lifecycle
      let status: IncidentStatus = "cleared";
      for (let j = incidents.length - 1; j >= 0; j--)
        if (incidents[j].id === sl.incidentId) {
          status = incidents[j].status;
          break;
        }
      if (status === "active" && sl.age > sl.safety) {
        finishIncident(sl);
        status = "cleared";
      }
      if (status !== sl.status) {
        sl.status = status;
        if (status === "cleared") {
          teardown(i);
          continue;
        }
        const id = sl.incidentId;
        setVisuals((v) => v.map((x) => (x.incidentId === id ? { ...x, status } : x)));
      }

      // Emitters
      const clearing = sl.status === "clearing";
      let fireX = 0;
      let fireZ = 0;
      let fires = 0;
      for (let k = 0; k < sl.emitterCount; k++) {
        const e = sl.emitters[k];
        const type: Em = clearing ? Em.Steam : e.type;
        const rate = type === Em.Steam ? (clearing ? 3 : 6) : type === Em.Smoke ? 7 : type === Em.Heavy ? 13 : 12;
        e.acc += rate * dt;
        while (e.acc >= 1) {
          e.acc -= 1;
          const sx = e.x + rnd(-0.7, 0.7);
          const sz = e.z + rnd(-0.7, 0.7);
          if (type === Em.Steam)
            fx.smoke.emit(sx, 1, sz, WIND_X * 0.6, rnd(1.5, 2.5), WIND_Z * 0.6, rnd(2.2, 3.2), 0.6, rnd(3, 4.5), 0.5,
              0.88, 0.89, 0.92, 0.96, 0.96, 0.98, -0.3, 0.3, rnd(-0.4, 0.4), i);
          else if (type === Em.Smoke)
            fx.smoke.emit(sx, 1.2, sz, WIND_X + rnd(-0.3, 0.3), rnd(2, 3.2), WIND_Z + rnd(-0.3, 0.3), rnd(4.5, 6.5), rnd(1, 1.5), rnd(5, 7.5), 0.8,
              0.17, 0.16, 0.16, 0.5, 0.49, 0.48, -0.3, 0.25, rnd(-0.35, 0.35), i);
          else
            fx.smoke.emit(sx, 2.6, sz, WIND_X + rnd(-0.3, 0.3), rnd(2.4, 3.6), WIND_Z + rnd(-0.3, 0.3), rnd(6, 8.5), rnd(1.6, 2.4), rnd(9, 13), 0.9,
              0.07, 0.065, 0.065, 0.34, 0.33, 0.32, -0.35, 0.22, rnd(-0.35, 0.35), i);
        }
        if (type === Em.Fire) {
          fireX += e.x;
          fireZ += e.z;
          fires++;
          e.acc2 += 42 * dt;
          while (e.acc2 >= 1) {
            e.acc2 -= 1;
            fx.glow.emit(e.x + rnd(-1.2, 1.2), rnd(0.8, 2.2), e.z + rnd(-1.2, 1.2), WIND_X * 0.4, rnd(2.5, 4.5), WIND_Z * 0.4,
              rnd(0.45, 0.9), rnd(1.8, 2.8), 0.3, 0.95, 1, 0.78, 0.28, 0.9, 0.16, 0.03, -1, 0.5, rnd(-1, 1), i);
            if (Math.random() < 0.12)
              fx.glow.emit(e.x + rnd(-1, 1), rnd(2, 3), e.z + rnd(-1, 1), WIND_X + rnd(-1, 1), rnd(4, 7), WIND_Z + rnd(-1, 1),
                rnd(1.2, 2.2), 0.22, 0.08, 1, 1, 0.75, 0.3, 1, 0.3, 0.05, -0.4, 0.2, 0, i);
          }
        }
      }

      // Light: impact flashes, then a flickering fire glow
      if (sl.flash > 0) sl.flash -= dt;
      if (fires && sl.light < 0) sl.light = claimLight(i);
      if (sl.light >= 0) {
        const L = lights.current[sl.light];
        const flashing = sl.flash > 0;
        const flash = flashing ? (sl.flash / 0.4) * 800 : 0;
        const flicker = fires ? 170 * (0.72 + 0.18 * Math.sin(t * 23 + i) + 0.1 * Math.sin(t * 61 + i * 3)) : 0;
        if (L) {
          L.intensity = flash + flicker;
          if (flashing) L.position.set(sl.flashX, 2.4, sl.flashZ);
          else if (fires) L.position.set(fireX / fires, 2.4, fireZ / fires);
        }
        const done = !ch || sl.next >= ch.impacts.length;
        if (!fires && !flashing && done) releaseLight(sl);
      }
    }

    // Simulate pools and push to GPU
    fx.smoke.update(dt);
    fx.glow.update(dt);
    markParticlesDirty(fx.smokeMesh);
    markParticlesDirty(fx.glowMesh);
    const movedGlass = fx.glass.update(dt);
    const movedCargo = fx.cargo.update(dt);
    if (movedGlass || movedCargo || scratch.debrisDirty) {
      writeDebris(fx.glass, fx.glassMesh, scratch.dummy);
      writeDebris(fx.cargo, fx.cargoMesh, scratch.dummy);
      scratch.debrisDirty = false;
    }
    if (fx.decals.dirty) writeDecals(fx.decals, fx.decalMesh, scratch.dummy);
  });

  return (
    <group name="crashes">
      <primitive object={fx.decalMesh} />
      <primitive object={fx.glassMesh} />
      <primitive object={fx.cargoMesh} />
      <primitive object={fx.smokeMesh} />
      <primitive object={fx.glowMesh} />
      {Array.from({ length: LIGHTS }, (_, i) => (
        <pointLight
          key={i}
          ref={(l) => {
            lights.current[i] = l;
          }}
          color="#ff7a1f"
          intensity={0}
          distance={45}
          decay={1.6}
        />
      ))}
      {visuals.map((v) => (
        <group key={v.incidentId} position={[v.frame.cx, 0, v.frame.cz]} rotation={[0, v.frame.h, 0]}>
          <SiteMarker
            title={v.title}
            status={v.status}
            slick={v.kind === "pileup" ? 5 : v.kind === "truck_crash" ? 4.5 : 2.6}
            tri={v.tri}
            phase={v.slot * 2.1}
            size={v.size}
            labelZ={v.labelZ}
          />
          {v.actors.map((a, k) => (
            <ActorView key={a.id} actor={a} clock={v.clock} frame={v.frame} lane={v.lanes[k]} burnt={v.status !== "active"} />
          ))}
        </group>
      ))}
    </group>
  );
}

function reopen(sl: Slot) {
  const w = useWorld.getState();
  for (const key of sl.edges)
    if (w.blocked[key] !== undefined && w.blocked[key] === sl.note) {
      useWorld.getState().unblockEdge(key);
      emit({ type: "road:reopened", edgeKey: key });
    }
}

/** Our own clearing (safety net / unmount): mark cleared, reopen roads, announce. */
function finishIncident(sl: Slot) {
  useWorld.getState().updateIncident(sl.incidentId, { status: "cleared" });
  reopen(sl);
  emit({ type: "incident:cleared", incidentId: sl.incidentId });
}

function writeDebris(pool: DebrisPool, mesh: THREE.InstancedMesh, dummy: THREE.Object3D) {
  for (let i = 0; i < pool.n; i++) {
    const i3 = i * 3;
    dummy.position.set(pool.pos[i3], pool.pos[i3 + 1], pool.pos[i3 + 2]);
    dummy.rotation.set(pool.rot[i3], pool.rot[i3 + 1], pool.rot[i3 + 2]);
    const s = pool.state[i] === 0 ? 0 : pool.scale[i];
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

function writeDecals(pool: DecalPool, mesh: THREE.InstancedMesh, dummy: THREE.Object3D) {
  for (let i = 0; i < pool.n; i++) {
    dummy.position.set(pool.x[i], 0.075 + (i % 7) * 0.001, pool.z[i]);
    dummy.rotation.set(0, pool.yaw[i], 0);
    if (pool.alive[i]) dummy.scale.set(pool.width[i], 1, pool.len[i]);
    else dummy.scale.set(0, 0, 0);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  pool.dirty = false;
}
