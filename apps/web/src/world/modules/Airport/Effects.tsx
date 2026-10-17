"use client";
// Airport VFX: tyre smoke, the smoking engine, sparks from a burst tyre, foam arcs from the tenders, and the
// plane crash itself (fireball flash, flickering fire light, broken airframe, debris, burning wing, a tall
// black smoke plume visible across the city). Two pooled particle meshes do all the particles.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useWorld } from "../../store";
import type { Plane } from "./flight";
import { wreckGeometries } from "./geometry";
import { markDirty, Pool, poolMesh, spawnArgs } from "./particles";
import { v3, type V3 } from "./path";
import { planeLocalToWorld, SICK_ENGINE, type AirportSim, type CrashRun } from "./sim";

const S = spawnArgs();
const P = v3(0, 0, 0);
const GEAR_L = v3(2.1, 0.3, -0.4);
const GEAR_R = v3(-2.1, 0.3, -0.4);
const NOZZLE = v3(0, 3.9, 5.2);
const m4 = new THREE.Matrix4();
const DEBRIS = 70;
const G = 9.8;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

interface WreckState {
  run: CrashRun;
  fires: V3[]; // burning points (world)
  plume: V3[]; // plume sources
  flashT: number;
}

export default function Effects({ sim }: { sim: AirportSim }) {
  const smoke = useMemo(() => new Pool(1800), []);
  const glow = useMemo(() => new Pool(900), []);
  const smokeMesh = useMemo(() => poolMesh(smoke, false), [smoke]);
  const glowMesh = useMemo(() => poolMesh(glow, true), [glow]);
  const lastStep = useRef(-1);
  const carry = useRef(new Float32Array(20)); // fractional spawn accumulators per emitter slot
  const wreck = useRef<WreckState | null>(null);
  const blanket = useRef({ r: 0, x: 0, z: 0 });

  const front = useRef<THREE.Mesh>(null);
  const rear = useRef<THREE.Mesh>(null);
  const wing = useRef<THREE.Mesh>(null);
  const debrisRef = useRef<THREE.InstancedMesh>(null);
  const scorchRef = useRef<THREE.Mesh>(null);
  const flashRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const foamRef = useRef<THREE.Mesh>(null);
  const waveRef = useRef<THREE.Mesh>(null);

  const built = useMemo(() => {
    const scorch = new THREE.CircleGeometry(1, 24);
    scorch.rotateX(-Math.PI / 2);
    const foam = new THREE.CircleGeometry(1, 24);
    foam.rotateX(-Math.PI / 2);
    return {
      wrecks: sim.fleet.planes.map((p) => wreckGeometries(p.spec)),
      charMat: new THREE.MeshStandardMaterial({ vertexColors: true, color: "#6a6a6a", roughness: 0.95, flatShading: true, side: THREE.DoubleSide }),
      debris: new THREE.BoxGeometry(1, 1, 1),
      debrisMat: new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }),
      scorch,
      scorchMat: new THREE.MeshBasicMaterial({ color: "#14100c", transparent: true, opacity: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -10 }),
      flash: new THREE.SphereGeometry(1, 16, 10),
      flashMat: new THREE.MeshBasicMaterial({ color: "#ffb347", transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      wave: new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2),
      waveMat: new THREE.MeshBasicMaterial({ color: "#ffd9a0", transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
      foam,
      foamMat: new THREE.MeshStandardMaterial({ color: "#f4f6f8", roughness: 1, transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -7, polygonOffsetUnits: -14 }),
    };
  }, [sim]);

  useEffect(
    () => () => {
      for (const w of built.wrecks) for (const g of [w.front, w.rear, w.wing]) g.dispose();
      for (const g of [built.debris, built.scorch, built.flash, built.foam, built.wave]) g.dispose();
      for (const m of [built.charMat, built.debrisMat, built.scorchMat, built.flashMat, built.foamMat, built.waveMat]) m.dispose();
      smokeMesh.geometry.dispose();
      (smokeMesh.material as THREE.Material).dispose();
      glowMesh.geometry.dispose();
      (glowMesh.material as THREE.Material).dispose();
    },
    [built, smokeMesh, glowMesh],
  );

  /** Spawn `rate` per second from emitter `slot`, calling `make` for each particle. */
  const emit = (slot: number, rate: number, dt: number, make: () => void) => {
    const c = carry.current;
    c[slot] += rate * dt;
    while (c[slot] >= 1) {
      c[slot] -= 1;
      make();
    }
  };

  const tyreSmoke = (p: Plane, count: number) => {
    for (const gear of [GEAR_L, GEAR_R]) {
      planeLocalToWorld(p, gear, P);
      for (let k = 0; k < count; k++) {
        Object.assign(S, {
          x: P.x + rnd(-0.6, 0.6), y: 0.5, z: P.z + rnd(-0.6, 0.6),
          vx: p.dir.x * rnd(4, 14) + rnd(-1.5, 1.5), vy: rnd(0.6, 2.2), vz: p.dir.z * rnd(4, 14) + rnd(-1.5, 1.5),
          life: rnd(1.6, 2.8), s0: rnd(0.8, 1.5), s1: rnd(4.5, 7.5), a: 0.75, r: 0.86, g: 0.86, b: 0.84, gravity: -0.4, drag: 1.4,
        });
        smoke.spawn(S);
      }
    }
  };

  const sparks = (x: number, y: number, z: number, n: number, back: V3 | null, spread: number) => {
    for (let k = 0; k < n; k++) {
      Object.assign(S, {
        x, y, z,
        vx: (back ? -back.x * rnd(4, 12) : 0) + rnd(-spread, spread), vy: rnd(1, spread + 2), vz: (back ? -back.z * rnd(4, 12) : 0) + rnd(-spread, spread),
        life: rnd(0.25, 0.6), s0: rnd(0.25, 0.5), s1: 0.05, a: 1, r: 1, g: rnd(0.55, 0.85), b: 0.25, gravity: G, drag: 0.5,
      });
      glow.spawn(S);
    }
  };

  const flame = (x: number, y: number, z: number, size: number, rise: number) => {
    Object.assign(S, {
      x: x + rnd(-1, 1) * size * 0.4, y, z: z + rnd(-1, 1) * size * 0.4,
      vx: rnd(-0.6, 0.6), vy: rise * rnd(0.6, 1.2), vz: rnd(-0.6, 0.6),
      life: rnd(0.45, 0.9), s0: size * rnd(0.8, 1.2), s1: size * 0.25, a: 0.95, r: 1, g: rnd(0.35, 0.55), b: 0.08, gravity: -3, drag: 0.6,
    });
    glow.spawn(S);
  };

  const darkSmoke = (x: number, y: number, z: number, size: number, shade: number, life: number, rise: number) => {
    Object.assign(S, {
      x: x + rnd(-1, 1), y, z: z + rnd(-1, 1),
      vx: rnd(-0.8, 0.8) + 1.4, vy: rise * rnd(0.7, 1.2), vz: rnd(-0.8, 0.8) + 0.4,
      life, s0: size * 0.35, s1: size, a: 0.85, r: shade, g: shade, b: shade * 1.02, gravity: -1.1, drag: 0.12,
    });
    smoke.spawn(S);
  };

  const startWreck = (run: CrashRun) => {
    const p = run.plane;
    const sx = run.site.x;
    const sz = run.site.z;
    const dx = Math.sin(p.yaw);
    const dz = Math.cos(p.yaw);
    const px = Math.cos(p.yaw);
    const pz = -Math.sin(p.yaw);
    const w = built.wrecks[sim.fleet.planes.indexOf(p)] ?? built.wrecks[0];
    const place = (mesh: THREE.Mesh | null, geo: THREE.BufferGeometry, x: number, z: number, y: number, yaw: number, roll: number, pitch: number) => {
      if (!mesh) return;
      mesh.geometry = geo;
      mesh.position.set(x, y, z);
      mesh.rotation.set(pitch, yaw, roll, "YXZ");
      mesh.visible = true;
    };
    place(front.current, w.front, sx + dx * 5 + px * 2, sz + dz * 5 + pz * 2, -0.7, p.yaw + 0.35, 0.32, 0.06);
    place(rear.current, w.rear, sx - dx * 7 - px * 3, sz - dz * 7 - pz * 3, -0.5, p.yaw - 0.4, -0.22, -0.05);
    const wingYaw = p.yaw + 2.2;
    place(wing.current, w.wing, sx - px * 6 + dx * 8, sz - pz * 6 + dz * 8, -0.3, wingYaw, 0.12, 0);
    // debris field strewn along the direction of travel
    const deb = debrisRef.current;
    if (deb) {
      const cols = ["#3a3a3a", "#5b5b5b", "#d9dee4", "#2a2a2a", p.spec.tail, p.spec.body];
      const tmpC = new THREE.Color();
      for (let i = 0; i < DEBRIS; i++) {
        // thrown wide: mostly forward along the flight path, some sideways and back
        const along = rnd(-35, 70);
        const side = rnd(-1, 1) * (10 + Math.abs(along) * 0.45);
        const s = rnd(0.35, 1.9);
        m4.makeRotationFromEuler(new THREE.Euler(rnd(0, 3), rnd(0, 3), rnd(0, 3)));
        m4.scale(new THREE.Vector3(s, s * rnd(0.2, 0.7), s * rnd(0.6, 1.6)));
        m4.setPosition(sx + dx * along + px * side, s * 0.15, sz + dz * along + pz * side);
        deb.setMatrixAt(i, m4);
        deb.setColorAt(i, tmpC.set(cols[i % cols.length]));
      }
      deb.instanceMatrix.needsUpdate = true;
      if (deb.instanceColor) deb.instanceColor.needsUpdate = true;
      deb.visible = true;
    }
    if (scorchRef.current) {
      scorchRef.current.position.set(sx + dx * 3, 0.05, sz + dz * 3);
      scorchRef.current.scale.set(17, 1, 24);
      scorchRef.current.rotation.y = p.yaw;
      scorchRef.current.visible = true;
    }
    const wingC = { x: sx - px * 6 + dx * 8 + Math.cos(wingYaw) * 5, z: sz - pz * 6 + dz * 8 - Math.sin(wingYaw) * 5 };
    wreck.current = {
      run,
      fires: [
        v3(wingC.x, 1, wingC.z),
        v3(sx + dx * 9 + px * 2, 2.5, sz + dz * 9 + pz * 2),
        v3(sx - dx * 12 - px * 3, 2, sz - dz * 12 - pz * 3),
        v3(sx + dx * 26 + px * 7, 0.6, sz + dz * 26 + pz * 7),
        v3(sx - dx * 20 - px * 9, 0.6, sz - dz * 20 - pz * 9),
      ],
      plume: [v3(sx + dx * 6, 4, sz + dz * 6), v3(sx - dx * 8, 4, sz - dz * 8), v3(wingC.x, 3, wingC.z)],
      flashT: 0,
    };
    // the fireball
    // tumbling chunks thrown out of the blast
    for (let k = 0; k < 90; k++) {
      const a = rnd(0, Math.PI * 2);
      const sp = rnd(10, 32);
      Object.assign(S, {
        x: sx, y: rnd(1, 4), z: sz,
        vx: Math.cos(a) * sp + dx * 10, vy: rnd(8, 24), vz: Math.sin(a) * sp + dz * 10,
        life: rnd(2, 3.5), s0: rnd(0.6, 1.6), s1: rnd(0.5, 1.2), a: 1, r: 0.12, g: 0.11, b: 0.1, gravity: G, drag: 0.15,
      });
      smoke.spawn(S);
    }
    // dust skirt racing outward with the shockwave
    for (let k = 0; k < 48; k++) {
      const a = (k / 48) * Math.PI * 2;
      Object.assign(S, {
        x: sx + Math.cos(a) * 6, y: 1.5, z: sz + Math.sin(a) * 6,
        vx: Math.cos(a) * 30, vy: rnd(0.5, 2), vz: Math.sin(a) * 30,
        life: rnd(2.2, 3.2), s0: 5, s1: 16, a: 0.6, r: 0.42, g: 0.38, b: 0.33, gravity: -0.3, drag: 1.3,
      });
      smoke.spawn(S);
    }
    for (let k = 0; k < 160; k++) {
      const a = rnd(0, Math.PI * 2);
      const sp = rnd(5, 20);
      Object.assign(S, {
        x: sx + rnd(-4, 4), y: rnd(1, 5), z: sz + rnd(-4, 4),
        vx: Math.cos(a) * sp + dx * 8, vy: rnd(4, 16), vz: Math.sin(a) * sp + dz * 8,
        life: rnd(1.2, 2.6), s0: rnd(5, 9), s1: rnd(12, 22), a: 1, r: 1, g: rnd(0.4, 0.65), b: 0.12, gravity: -3, drag: 1.3,
      });
      glow.spawn(S);
    }
    for (let k = 0; k < 50; k++) darkSmoke(sx + rnd(-8, 8), rnd(2, 8), sz + rnd(-8, 8), rnd(14, 24), 0.08, rnd(4, 7), rnd(4, 10));
    sparks(sx, 2, sz, 80, null, 14);
  };

  const clearWreck = () => {
    wreck.current = null;
    for (const r of [front, rear, wing, scorchRef]) if (r.current) r.current.visible = false;
    if (debrisRef.current) debrisRef.current.visible = false;
  };

  useFrame((_, delta) => {
    const st = useWorld.getState();
    if (st.paused) return;
    const dt = Math.min(delta, 0.1);
    const t = performance.now() / 1000;

    // one-shot events from the latest sim step
    if (sim.stepId !== lastStep.current) {
      lastStep.current = sim.stepId;
      for (const ev of sim.fx) {
        if (ev.type === "touchdown") tyreSmoke(ev.plane, 7);
        if (ev.type === "hardTouchdown") {
          tyreSmoke(ev.plane, 16);
          planeLocalToWorld(ev.plane, GEAR_R, P);
          sparks(P.x, 0.4, P.z, 70, ev.plane.dir, 4);
        }
      }
    }

    // emergency: smoking engine, burst-tyre sparks on the rollout
    const em = sim.emergency;
    if (em) {
      const p = em.plane;
      const live = p.phase === "approach" || p.phase === "emergencyRollout" || p.phase === "stopped";
      if (live) {
        const fire = em.sinceStop >= 0 ? Math.max(0, 1 - em.sinceStop / 14) : 1;
        planeLocalToWorld(p, SICK_ENGINE, P);
        const shade = 0.16 + (1 - fire) * 0.6;
        emit(0, 34 * (0.3 + 0.7 * fire), dt, () => darkSmoke(P.x - p.dir.x * 2, P.y, P.z - p.dir.z * 2, rnd(3.5, 6), shade, rnd(2.5, 4.5), 1.5));
        if (fire > 0.02) emit(1, 30 * fire, dt, () => flame(P.x, P.y, P.z, 1.3, 2));
      }
      if (p.phase === "emergencyRollout") {
        planeLocalToWorld(p, GEAR_R, P);
        emit(2, 110, dt, () => sparks(P.x, 0.3, P.z, 1, p.dir, 2.5));
        emit(3, 12, dt, () => darkSmoke(P.x, 0.6, P.z, rnd(2, 4), 0.5, 1.8, 1));
      }
    }

    // crash: the stricken plane's trail, then the wreck
    const cr = sim.crash;
    if (cr && cr.plane.phase === "crashing") {
      const p = cr.plane;
      planeLocalToWorld(p, SICK_ENGINE, P);
      emit(4, 45, dt, () => darkSmoke(P.x, P.y, P.z, rnd(4, 7), 0.1, rnd(3, 5), 1));
      emit(5, 35, dt, () => flame(P.x, P.y, P.z, 1.6, 1));
    }
    if (cr && cr.tl && (!wreck.current || wreck.current.run !== cr)) startWreck(cr);
    if (!cr && wreck.current) clearWreck();

    const light = lightRef.current;
    const w = wreck.current;
    if (w && cr && cr.tl) {
      const fire = cr.tl.fire;
      w.flashT += dt;
      const wave = waveRef.current;
      if (wave) {
        const k = w.flashT / 1.4;
        wave.visible = k < 1;
        wave.position.set(cr.site.x, 1.2, cr.site.z);
        wave.scale.setScalar(2 + k * 85);
        (wave.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - k) * 0.9;
      }
      const flash = flashRef.current;
      if (flash) {
        const k = w.flashT;
        flash.visible = k < 1.6;
        flash.position.set(cr.site.x, 4, cr.site.z);
        flash.scale.setScalar(6 + Math.min(1, k / 0.35) * 34);
        (flash.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - k / 1.6);
      }
      if (light) {
        light.position.set(cr.site.x, 9, cr.site.z);
        const flick = 0.75 + 0.25 * Math.sin(t * 23) * Math.sin(t * 7.3);
        light.intensity = fire * 900 * flick + Math.max(0, 1 - w.flashT / 1.2) * 6000;
      }
      // black plume, turning to grey steam as the foam wins
      const shade = 0.06 + (1 - fire) * 0.55;
      const plumeRate = 9 * (0.25 + fire);
      w.plume.forEach((src, i) => emit(6 + i, plumeRate, dt, () => darkSmoke(src.x, src.y, src.z, rnd(20, 32), shade, rnd(9, 13), rnd(6, 10))));
      if (fire > 0.02)
        w.fires.forEach((f, i) => emit(9 + i, (i < 3 ? 34 : 12) * fire, dt, () => flame(f.x, f.y, f.z, i === 0 ? 3.2 : i < 3 ? 2.6 : 1.4, 4)));
    } else {
      if (light) light.intensity = 0;
      if (flashRef.current) flashRef.current.visible = false;
      if (waveRef.current) waveRef.current.visible = false;
    }

    // smoking embers in the crater (dying away once the rebuild starts)
    const crater = sim.crater;
    if (crater) {
      const k = crater.stage === "destroyed" ? 1 : Math.max(0, 1 - crater.t / 12);
      if (k > 0) {
        emit(17, 14 * k, dt, () => {
          const a = rnd(0, Math.PI * 2);
          const r = rnd(0, crater.radius * 0.45);
          Object.assign(S, {
            x: crater.x + Math.cos(a) * r, y: 0.4, z: crater.z + Math.sin(a) * r,
            vx: rnd(-0.3, 0.3), vy: rnd(0.6, 2), vz: rnd(-0.3, 0.3),
            life: rnd(0.8, 1.8), s0: rnd(0.3, 0.6), s1: 0.1, a: 0.9, r: 1, g: rnd(0.3, 0.5), b: 0.05, gravity: -0.5, drag: 0.4,
          });
          glow.spawn(S);
        });
        emit(18, 5 * k, dt, () => {
          const a = rnd(0, Math.PI * 2);
          const r = rnd(0, crater.radius * 0.5);
          darkSmoke(crater.x + Math.cos(a) * r, 0.8, crater.z + Math.sin(a) * r, rnd(4, 8), 0.35, rnd(4, 7), 2);
        });
      }
    }

    // foam arcs from the tenders' roof monitors
    let foaming = false;
    for (const u of sim.crew) {
      if (!u.spraying || !u.target) continue;
      foaming = true;
      const c = Math.cos(u.yaw);
      const s = Math.sin(u.yaw);
      const nx = u.x + c * NOZZLE.x + s * NOZZLE.z;
      const nz = u.z - s * NOZZLE.x + c * NOZZLE.z;
      const tx = u.target.x;
      const tz = u.target.z;
      emit(14 + u.index, 55, dt, () => {
        const ax = tx + rnd(-2, 2);
        const az = tz + rnd(-2, 2);
        const ay = rnd(0.5, 2.5);
        const T = 0.9 + Math.hypot(ax - nx, az - nz) / 45;
        Object.assign(S, {
          x: nx, y: NOZZLE.y, z: nz,
          vx: (ax - nx) / T, vy: (ay - NOZZLE.y + 0.5 * G * T * T) / T, vz: (az - nz) / T,
          life: T + rnd(0.3, 0.9), s0: rnd(0.5, 0.8), s1: rnd(1.8, 3), a: 0.95, r: 0.97, g: 0.98, b: 1, gravity: G, drag: 0,
        });
        smoke.spawn(S);
      });
      blanket.current.x = u.target.x;
      blanket.current.z = u.target.z;
    }
    const b = blanket.current;
    const maxR = cr ? 16 : 9;
    b.r = foaming ? Math.min(maxR, b.r + dt * 0.8) : Math.max(0, b.r - dt * (sim.emergency || sim.crash ? 0 : 2));
    const fm = foamRef.current;
    if (fm) {
      fm.visible = b.r > 0.05;
      fm.position.set(b.x, 0.06, b.z);
      fm.scale.set(b.r, 1, b.r * 0.85);
    }

    smoke.update(dt);
    glow.update(dt);
    markDirty(smokeMesh);
    markDirty(glowMesh);
  });

  return (
    <group>
      <primitive object={smokeMesh} />
      <primitive object={glowMesh} />
      <mesh ref={front} material={built.charMat} visible={false} castShadow />
      <mesh ref={rear} material={built.charMat} visible={false} castShadow />
      <mesh ref={wing} material={built.charMat} visible={false} />
      <instancedMesh ref={debrisRef} args={[built.debris, built.debrisMat, DEBRIS]} visible={false} frustumCulled={false} />
      <mesh ref={scorchRef} geometry={built.scorch} material={built.scorchMat} visible={false} />
      <mesh ref={foamRef} geometry={built.foam} material={built.foamMat} visible={false} />
      <mesh ref={waveRef} geometry={built.wave} material={built.waveMat} visible={false} renderOrder={14} />
      <mesh ref={flashRef} geometry={built.flash} material={built.flashMat} visible={false} renderOrder={14} />
      {/* always mounted (adding a light later would recompile every material); dark until something burns */}
      <pointLight ref={lightRef} color="#ff8a33" intensity={0} distance={140} decay={1.6} />
    </group>
  );
}
