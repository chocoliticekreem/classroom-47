"use client";
// Module: Collisions. Vehicle-vs-vehicle physics for the whole city. Every frame (before any other
// module updates) it rebuilds the shared spatial index in physics.ts, finds overlapping vehicles and
// turns fast overlaps into real crashes (owner crash() with an impulse hint, car_crash / truck_crash
// incident, road closure, events); slow overlaps get a separation hint (physics.separation).
// Rate-limited to one new crash per 20 s and at most 3 active. Draws a burst of debris at impacts.
// Cyclists: a car/van/truck overlapping a cyclist while closing > 2 m/s knocks them off (cyclist_hit
// incident, at most one a minute; request:cyclist_hit stages one with a van). See ./Collisions/cyclist.ts.
// Debug: window.__cityPhysics = { overlaps, crashes, queriesPerFrame, ... }.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import { BoxGeometry, Color, DynamicDrawUsage, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3, Euler } from "three";
import { on } from "../bus";
import { useWorld } from "../store";
import { CollisionEngine, type CollisionStats } from "./Collisions/engine";
import HitFx from "./Collisions/HitFx";

const N = 96; // debris pieces in the pool
const LIFE = 2.4; // s
const GRAVITY = 18;
const COLORS = ["#d8dde3", "#2b2f36", "#c0392b", "#f1c40f", "#9aa3ad", "#ff6a1a", "#1f6fd1"].map((c) => new Color(c));

declare global {
  interface Window {
    __cityPhysics?: CollisionStats;
  }
}

class Debris {
  readonly mesh: InstancedMesh;
  private x = new Float32Array(N);
  private y = new Float32Array(N);
  private z = new Float32Array(N);
  private vx = new Float32Array(N);
  private vy = new Float32Array(N);
  private vz = new Float32Array(N);
  private spin = new Float32Array(N);
  private age = new Float32Array(N).fill(LIFE);
  private size = new Float32Array(N);
  private cursor = 0;
  private live = 0;
  private m = new Matrix4();
  private q = new Quaternion();
  private e = new Euler();
  private p = new Vector3();
  private s = new Vector3();

  constructor() {
    const geo = new BoxGeometry(1, 1, 1);
    const mat = new MeshStandardMaterial({ roughness: 0.6, metalness: 0.2, flatShading: true });
    this.mesh = new InstancedMesh(geo, mat, N);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.name = "collision-debris";
    const zero = new Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < N; i++) {
      this.mesh.setMatrixAt(i, zero);
      this.mesh.setColorAt(i, COLORS[i % COLORS.length]);
    }
  }

  burst(x: number, z: number, nx: number, nz: number, strength: number, truck: boolean) {
    const n = Math.round(10 + strength * 14 + (truck ? 6 : 0));
    for (let k = 0; k < n; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % N;
      const side = Math.random() < 0.5 ? -1 : 1;
      const sp = (3 + Math.random() * 7) * (0.5 + strength);
      // fling sideways from the impact normal, plus a bit along it
      const ax = nz * side + nx * (Math.random() - 0.5);
      const az = -nx * side + nz * (Math.random() - 0.5);
      this.x[i] = x + (Math.random() - 0.5);
      this.y[i] = 0.6 + Math.random() * 0.6;
      this.z[i] = z + (Math.random() - 0.5);
      this.vx[i] = ax * sp;
      this.vz[i] = az * sp;
      this.vy[i] = 3 + Math.random() * 5 * (0.5 + strength);
      this.spin[i] = (Math.random() - 0.5) * 20;
      this.size[i] = k < 4 ? 0.35 + Math.random() * 0.25 : 0.12 + Math.random() * 0.18;
      this.age[i] = 0;
    }
    this.live = LIFE;
  }

  step(dt: number) {
    if (this.live <= 0) return;
    this.live -= dt;
    for (let i = 0; i < N; i++) {
      if (this.age[i] >= LIFE) continue;
      this.age[i] += dt;
      if (this.age[i] >= LIFE) {
        this.p.set(0, -100, 0);
        this.s.set(0, 0, 0);
        this.m.compose(this.p, this.q.identity(), this.s);
        this.mesh.setMatrixAt(i, this.m);
        continue;
      }
      this.vy[i] -= GRAVITY * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.z[i] += this.vz[i] * dt;
      const sz = this.size[i];
      if (this.y[i] < sz / 2) {
        // bounce and skid to a stop
        this.y[i] = sz / 2;
        this.vy[i] = Math.abs(this.vy[i]) * 0.3;
        this.vx[i] *= 0.6;
        this.vz[i] *= 0.6;
        this.spin[i] *= 0.5;
      }
      const t = this.age[i] * this.spin[i];
      this.e.set(t, t * 0.7, 0);
      this.q.setFromEuler(this.e);
      const fade = Math.min(1, (LIFE - this.age[i]) * 2);
      this.p.set(this.x[i], this.y[i], this.z[i]);
      this.s.set(sz * fade, sz * 0.5 * fade, sz * 1.3 * fade);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshStandardMaterial).dispose();
  }
}

export default function Collisions() {
  const debris = useMemo(() => new Debris(), []);
  const [engine] = useState(() => new CollisionEngine((x, z, nx, nz, s, truck) => debris.burst(x, z, nx, nz, s, truck)));

  useEffect(() => {
    window.__cityPhysics = engine.stats;
    return () => {
      if (window.__cityPhysics === engine.stats) delete window.__cityPhysics;
      debris.dispose();
    };
  }, [engine, debris]);

  useEffect(() => on((e) => {
    if (e.type === "request:cyclist_hit") engine.requestCyclistHit();
  }), [engine]);

  // Negative priority: runs before every other module's useFrame (priority 0), so the spatial index
  // holds last frame's final positions when Traffic & co. query it. (Positive would take over rendering.)
  useFrame((_, delta) => {
    const paused = useWorld.getState().paused;
    engine.step(performance.now(), paused);
    if (!paused) debris.step(Math.min(delta, 0.1));
  }, -10);

  return (
    <>
      <primitive object={debris.mesh} />
      <HitFx />
    </>
  );
}
