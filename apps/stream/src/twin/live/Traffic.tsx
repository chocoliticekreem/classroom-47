"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { useDemoSettings } from "@/platform/demo";
import { toLocal } from "../config";
import { useNetwork } from "../network/useNetwork";
import { ATMOS } from "../scene/palette";
import { getLastField, useCoveredFrames, useFieldStore } from "../sim/useField";
import { useScenario } from "./scenario";
import { useTwinCounts } from "./sim/counts";
import { coveredBy, snapToField } from "./sim/field";
import { writeYawMatrix } from "./sim/matrix";
import { ROLE_AMBULANCE, ROLE_NONE, ROLE_POLICE, ROLE_QUARRY, TrafficSim } from "./sim/traffic";
import { useLive } from "./store";

/** Instance capacity per kind; how many are actually out comes from the field. */
const CAPACITY = [260, 44, 56];
/** Edges whose midpoint is this close to a TfL disruption line take its speed factor. */
const DISRUPTION_M = 20;
const WHITE_C = new THREE.Color(1, 1, 1);
const BLUE = new THREE.Color(0.2, 0.4, 3);
const POLICE_PAINT = new THREE.Color("#f2f4f6");
const AMBULANCE_PAINT = new THREE.Color("#f5e31a");
const QUARRY_PAINT = new THREE.Color("#8a1c1c");
const SEED = 4717;
const GROUND_Y = 0.05;

const PAINTS = [
  "#0d0e12",
  "#1b1f27",
  "#26303f",
  "#3a1418",
  "#d9dce0",
  "#8a9099",
  "#16322a",
  "#1d2c52",
  "#6b7078",
  "#c4c8cc",
  "#7a1c1c",
].map((c) => new THREE.Color(c));
const VAN_PAINTS = ["#d9dce0", "#c4c8cc", "#1d2c52", "#8a9099", "#e8e2d0"].map((c) => new THREE.Color(c));
const CAB_PAINTS = ["#0b0b0e", "#111216", "#15161b"].map((c) => new THREE.Color(c));

const GLASS: [number, number, number] = [0.03, 0.05, 0.08];
const DARK: [number, number, number] = [0.05, 0.05, 0.06];
const WHITE: [number, number, number] = [1, 1, 1];
const HEAD: [number, number, number] = [3, 2.7, 2.1];
const TAIL: [number, number, number] = [2.6, 0.12, 0.06];
const SIGN: [number, number, number] = [3, 2, 0.5];

function tint(g: THREE.BufferGeometry, [r, gr, b]: [number, number, number]) {
  const n = g.getAttribute("position").count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    c[i * 3] = r;
    c[i * 3 + 1] = gr;
    c[i * 3 + 2] = b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(c, 3));
  return g;
}

/** A flat-shaded box whose roof is narrowed (`top`) and whose nose / tail roof edges are pulled in. */
function block(
  [w, h, l]: [number, number, number],
  [x, y, z]: [number, number, number],
  color: [number, number, number],
  top = 1,
  nose = 1,
  tail = 1,
) {
  const g = new THREE.BoxGeometry(w, h, l).toNonIndexed();
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > 0) {
      p.setX(i, p.getX(i) * top);
      p.setZ(i, p.getZ(i) * (p.getZ(i) > 0 ? nose : tail));
    }
  }
  g.translate(x, y, z);
  g.computeVertexNormals();
  return tint(g, color);
}

function wheels(width: number, wheelbase: number, shift = 0) {
  const parts: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const g = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 10).toNonIndexed();
      g.rotateZ(Math.PI / 2);
      g.translate((sx * width) / 2, 0.33, sz * wheelbase + shift);
      parts.push(tint(g, DARK));
    }
  }
  return parts;
}

function carBody() {
  return mergeGeometries([
    block([1.78, 0.6, 4.3], [0, 0.58, 0], WHITE, 0.96, 0.92, 1),
    block([1.55, 0.5, 2.2], [0, 1.13, -0.2], WHITE, 0.8, 0.62, 0.84),
    block([1.58, 0.32, 2.05], [0, 1.08, -0.2], GLASS, 0.82, 0.64, 0.86),
    block([1.76, 0.22, 0.14], [0, 0.4, 2.2], DARK),
    block([1.76, 0.22, 0.14], [0, 0.4, -2.2], DARK),
    ...wheels(1.82, 1.4),
  ])!;
}

function vanBody() {
  return mergeGeometries([
    block([1.95, 0.55, 5.3], [0, 0.6, 0], WHITE, 0.98, 0.94, 1),
    block([1.95, 1.05, 3.5], [0, 1.4, -0.95], WHITE, 0.97, 1, 1),
    block([1.8, 0.7, 1.7], [0, 1.2, 1.5], WHITE, 0.86, 0.6, 1),
    block([1.82, 0.4, 1.5], [0, 1.28, 1.52], GLASS, 0.88, 0.62, 1),
    block([1.93, 0.22, 0.14], [0, 0.42, 2.65], DARK),
    block([1.93, 0.22, 0.14], [0, 0.42, -2.65], DARK),
    ...wheels(2.0, 1.75),
  ])!;
}

function cabBody() {
  return mergeGeometries([
    block([1.76, 0.6, 4.6], [0, 0.6, 0], WHITE, 0.96, 0.94, 1),
    block([1.6, 0.9, 2.75], [0, 1.35, -0.45], WHITE, 0.9, 0.78, 0.92),
    block([1.63, 0.55, 2.6], [0, 1.32, -0.45], GLASS, 0.92, 0.8, 0.94),
    block([1.74, 0.22, 0.14], [0, 0.4, 2.3], DARK),
    block([1.74, 0.22, 0.14], [0, 0.4, -2.3], DARK),
    ...wheels(1.8, 1.45),
  ])!;
}

function lamps(length: number, width: number, sign?: number) {
  const parts: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    parts.push(block([0.34, 0.14, 0.06], [sx * width * 0.34, 0.66, length / 2 + 0.03], HEAD));
    parts.push(block([0.3, 0.12, 0.06], [sx * width * 0.36, 0.7, -length / 2 - 0.03], TAIL));
  }
  if (sign !== undefined) parts.push(block([0.5, 0.14, 0.22], [0, sign, 0.1], SIGN));
  return mergeGeometries(parts)!;
}

/** A pool of light on the road ahead of the car; additive, fading to black at the far edge. */
function beam() {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    "position",
    new THREE.BufferAttribute(
      new Float32Array([-0.7, 0, 2.5, 0.7, 0, 2.5, 2.1, 0, 12, -0.7, 0, 2.5, 2.1, 0, 12, -2.1, 0, 12]),
      3,
    ),
  );
  const near = [0.3, 0.26, 0.16];
  g.setAttribute(
    "color",
    new THREE.BufferAttribute(new Float32Array([...near, ...near, 0, 0, 0, ...near, 0, 0, 0, 0, 0, 0]), 3),
  );
  return g;
}

const PALETTES = [PAINTS, VAN_PAINTS, CAB_PAINTS];

/** Ambient paint per vehicle, with responders in their livery; lamps go back to white when a role ends. */
function paint(sim: TrafficSim, bodies: THREE.InstancedMesh[], lamp: THREE.InstancedMesh[]) {
  let i = 0;
  for (const v of sim.vehicles) {
    const set = PALETTES[v.kind];
    const c =
      v.role === ROLE_POLICE
        ? POLICE_PAINT
        : v.role === ROLE_AMBULANCE
          ? AMBULANCE_PAINT
          : v.role === ROLE_QUARRY
            ? QUARRY_PAINT
            : set[(i * 7 + (i >> 2)) % set.length];
    bodies[v.kind].setColorAt(v.slot, c);
    if (v.role === ROLE_NONE) lamp[v.kind].setColorAt(v.slot, WHITE_C);
    i++;
  }
  for (const m of [...bodies, ...lamp]) if (m.instanceColor) m.instanceColor.needsUpdate = true;
}

function step(
  sim: TrafficSim,
  meshes: { bodies: THREE.InstancedMesh[]; lamp: THREE.InstancedMesh[]; pool: THREE.InstancedMesh },
  lights: THREE.MeshBasicMaterial,
  pool: THREE.MeshBasicMaterial,
  dt: number,
  frame: number,
) {
  sim.update(dt);
  const poolArr = meshes.pool.instanceMatrix.array;
  const vs = sim.vehicles;
  const strobe = Math.floor(performance.now() / 120) % 2 === 0;
  for (let i = 0; i < vs.length; i++) {
    const v = vs[i];
    const sc = v.parked ? 0 : 1;
    writeYawMatrix(meshes.bodies[v.kind].instanceMatrix.array, v.slot * 16, v.x, GROUND_Y, v.z, v.yaw, sc, sc);
    writeYawMatrix(poolArr, i * 16, v.x, GROUND_Y + 0.04, v.z, v.yaw, sc, sc);
    if (v.role === ROLE_POLICE || v.role === ROLE_AMBULANCE) {
      const lamp = meshes.lamp[v.kind];
      lamp.setColorAt(v.slot, strobe ? BLUE : WHITE_C);
      if (lamp.instanceColor) lamp.instanceColor.needsUpdate = true;
    }
  }
  for (const m of meshes.bodies) m.instanceMatrix.needsUpdate = true;
  meshes.pool.instanceMatrix.needsUpdate = true;
  if (frame % 60 === 0 && useTwinCounts.getState().vehicles !== sim.active) useTwinCounts.setState({ vehicles: sim.active });
  const night = ATMOS.windowGlow;
  lights.color.setScalar(0.3 + 0.7 * night);
  pool.color.setScalar(night);
  meshes.pool.visible = night > 0.03;
}

export function Traffic() {
  const net = useNetwork();
  const sim = useMemo(() => new TrafficSim(net, CAPACITY, SEED), [net]);
  const frame = useRef(0);

  const fieldAt = useFieldStore((s) => s?.at ?? 0);
  const covered = useCoveredFrames((s) => s.frames);
  const crowd = useDemoSettings().crowd;
  const disruptions = useLive((s) => s.disruptions);
  useEffect(() => {
    const field = getLastField();
    if (!field) return;
    const edges = net.edges;
    const snap = snapToField(sim.edgeMid, field);
    const weight = new Float32Array(edges.length);
    const speed = new Float32Array(edges.length).fill(1);
    const lines: { ax: number; az: number; bx: number; bz: number; factor: number }[] = [];
    for (const d of disruptions) {
      const factor = /closed/i.test(d.closure) || /closure/i.test(d.category) ? 0 : 0.5;
      for (let i = 1; i < d.line.length; i++) {
        const [ax, az] = toLocal(d.line[i - 1][1], d.line[i - 1][0]);
        const [bx, bz] = toLocal(d.line[i][1], d.line[i][0]);
        lines.push({ ax, az, bx, bz, factor });
      }
    }
    let target = 0;
    for (let i = 0; i < edges.length; i++) {
      const x = sim.edgeMid[i * 2];
      const z = sim.edgeMid[i * 2 + 1];
      for (const l of lines) {
        const dx = l.bx - l.ax;
        const dz = l.bz - l.az;
        const l2 = dx * dx + dz * dz;
        const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - l.ax) * dx + (z - l.az) * dz) / l2)) : 0;
        if (Math.hypot(l.ax + dx * t - x, l.az + dz * t - z) < DISRUPTION_M) speed[i] = Math.min(speed[i], l.factor);
      }
      const seg = snap[i];
      if (seg < 0 || coveredBy(covered, x, z)) continue;
      weight[i] = field.segments[seg].vehicles;
      target += (weight[i] * edges[i].length) / 100;
    }
    sim.setField(weight, speed, target * crowd);
  }, [sim, net, fieldAt, covered, crowd, disruptions]);

  const shared = useMemo(() => {
    const paint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.2 });
    const lights = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    const pool = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    return {
      paint,
      lights,
      pool,
      bodies: [carBody(), vanBody(), cabBody()],
      lamps: [lamps(4.3, 1.8), lamps(5.3, 2), lamps(4.6, 1.78, 1.82)],
      beam: beam(),
    };
  }, []);

  const meshes = useMemo(() => {
    const per = [0, 0, 0];
    for (const v of sim.vehicles) per[v.kind]++;
    const bodies = shared.bodies.map((g, k) => new THREE.InstancedMesh(g, shared.paint, Math.max(1, per[k])));
    const lamp = shared.lamps.map((g, k) => {
      const m = new THREE.InstancedMesh(g, shared.lights, Math.max(1, per[k]));
      m.instanceMatrix = bodies[k].instanceMatrix;
      return m;
    });
    const pool = new THREE.InstancedMesh(shared.beam, shared.pool, Math.max(1, sim.vehicles.length));
    bodies.forEach((m, k) => (m.count = lamp[k].count = per[k]));
    pool.count = sim.vehicles.length;
    paint(sim, bodies, lamp);
    for (const m of [...bodies, ...lamp, pool]) m.frustumCulled = false;
    pool.renderOrder = 2;
    return { bodies, lamp, pool };
  }, [sim, shared]);

  useEffect(
    () => () => {
      for (const m of [...meshes.bodies, ...meshes.lamp, meshes.pool]) m.dispose();
    },
    [meshes],
  );

  useEffect(
    () => () => {
      shared.paint.dispose();
      shared.lights.dispose();
      shared.pool.dispose();
      shared.beam.dispose();
      [...shared.bodies, ...shared.lamps].forEach((g) => g.dispose());
    },
    [shared],
  );

  const scenario = useScenario((s) => s.scenario);
  useEffect(() => {
    if (scenario) sim.dispatch(scenario.kind);
    else sim.clearDispatch();
    paint(sim, meshes.bodies, meshes.lamp);
  }, [sim, meshes, scenario]);

  useFrame((_, dt) => step(sim, meshes, shared.lights, shared.pool, dt, frame.current++));

  return (
    <group>
      {meshes.bodies.map((m, k) => (
        <primitive key={`b${k}`} object={m} />
      ))}
      {meshes.lamp.map((m, k) => (
        <primitive key={`l${k}`} object={m} />
      ))}
      <primitive object={meshes.pool} />
    </group>
  );
}