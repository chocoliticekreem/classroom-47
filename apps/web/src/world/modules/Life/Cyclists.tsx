"use client";
// 36 cyclists citywide (downtown + district streets) in the left gutter. Each is REGISTERED in the
// vehicle registry as kind "cyclist" (from/to/t/speed kept current), so traffic's look-ahead raycasts
// see them and brake, and the Collisions module can knock them off (registry crash(), only when
// Collisions asks: object.userData.hitBy). A knocked-off rider is hidden and respawns elsewhere later.
// Riders obey traffic lights, avoid closed roads and brake for whatever is ahead of them.
import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Color, InstancedMesh, Matrix4, MeshStandardMaterial, Object3D } from "three";
import { obstacleAhead } from "../../physics";
import { edgeKey } from "../../roads";
import { getVehicle, registerVehicle, type VehicleEntry } from "../../registry";
import { signalFor } from "../../signals";
import { useWorld } from "../../store";
import { bikeGeometry, riderGeometry } from "./bikeGeo";
import { placeRider, riderT, spawnRiders, stepRider, streetGraph, type Rider, type RiderEnv } from "./riders";
import { mulberry32 } from "./sim";

const COUNT = 36;
const SCALE = 1.25;
const JERSEYS = ["#ffb703", "#e63946", "#3a86ff", "#2a9d8f", "#ff6a1a", "#8338ec", "#90be6d", "#ff006e"];
const DOWN_S = 25; // a knocked-off rider is replaced this long after the hit
const LOOK_EVERY = 3; // frames between obstacle raycasts per rider
const LOOK_RANGE = 7;
const LOOK_HALF_W = 0.35;

interface Slot {
  r: Rider;
  entry: VehicleEntry;
  off: (() => void) | null;
  gap: number; // last raycast result (metres), aged by distance ridden
  gapStopped: boolean;
  shown: number; // smoothed heading
}

export default function Cyclists() {
  const bikeRef = useRef<InstancedMesh>(null);
  const riderRef = useRef<InstancedMesh>(null);
  const sim = useRef<{ slots: Slot[]; rand: () => number; frame: number } | null>(null);

  const { bikeGeo, riderGeo, bikeMat, riderMat } = useMemo(
    () => ({
      bikeGeo: bikeGeometry(),
      riderGeo: riderGeometry(),
      bikeMat: new MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 }),
      riderMat: new MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true }),
    }),
    [],
  );

  useEffect(
    () => () => {
      bikeGeo.dispose();
      riderGeo.dispose();
      bikeMat.dispose();
      riderMat.dispose();
    },
    [bikeGeo, riderGeo, bikeMat, riderMat],
  );

  useLayoutEffect(() => {
    const rand = mulberry32(99);
    const riders = spawnRiders(COUNT, rand);
    const slots: Slot[] = riders.map((r) => {
      const object = new Object3D();
      object.userData.half = 0.9;
      object.userData.halfWidth = 0.35;
      const entry: VehicleEntry = {
        id: r.id, kind: "cyclist", object, edgeKey: null, from: null, to: null, t: 0, speed: 0, stopped: false,
      };
      const slot: Slot = { r, entry, off: null, gap: Infinity, gapStopped: false, shown: r.heading };
      // Only the Collisions module knocks riders off (it sets userData.hitBy first); anything else is refused.
      entry.crash = () => {
        if (!object.userData.hitBy || r.down > 0) return false;
        r.down = DOWN_S;
        r.speed = 0;
        slot.off?.();
        slot.off = null;
        return true;
      };
      sync(slot);
      slot.off = registerVehicle(entry);
      return slot;
    });
    sim.current = { slots, rand, frame: 0 };
    const rider = riderRef.current!;
    const c = new Color();
    for (let i = 0; i < slots.length; i++) rider.setColorAt(i, c.set(JERSEYS[i % JERSEYS.length]));
    if (rider.instanceColor) rider.instanceColor.needsUpdate = true;
    write(slots, bikeRef.current!, rider);
    return () => {
      for (const s of slots) s.off?.();
      sim.current = null;
    };
  }, []);

  useFrame((_, delta) => {
    const s = sim.current;
    if (!s || useWorld.getState().paused) return;
    const dt = Math.min(delta, 0.1);
    s.frame++;
    const blocked = useWorld.getState().blocked;
    const now = performance.now();
    env.blocked = blocked;
    env.now = now;
    for (let i = 0; i < s.slots.length; i++) {
      const slot = s.slots[i];
      const r = slot.r;
      if (r.down > 0) {
        stepRider(r, dt, s.rand, env);
        if (r.down <= 0) respawn(slot, s.rand, blocked);
        continue;
      }
      if ((s.frame + i) % LOOK_EVERY === 0) {
        const hit = obstacleAhead(r.id, r.x, r.z, r.heading, LOOK_RANGE, LOOK_HALF_W);
        // only brake for things that are stopped or slower than us (traffic overtaking in the lane is fine)
        const o = hit ? getVehicle(hit.id) : undefined;
        const slower = !!hit && (hit.stopped || !o || o.speed < Math.max(1.5, r.speed - 0.3));
        slot.gap = hit && slower ? Math.max(0, hit.dist - 0.9) : Infinity; // ray starts at the centre; bike nose is 0.9 m ahead
        slot.gapStopped = !!hit && hit.stopped;
      } else if (slot.gap !== Infinity) slot.gap = Math.max(0, slot.gap - r.speed * dt);
      env.slot = slot;
      stepRider(r, dt, s.rand, env);
      sync(slot);
    }
    write(s.slots, bikeRef.current!, riderRef.current!);
  });

  return (
    <group>
      <instancedMesh ref={bikeRef} args={[bikeGeo, bikeMat, COUNT]} frustumCulled={false} />
      <instancedMesh ref={riderRef} args={[riderGeo, riderMat, COUNT]} frustumCulled={false} />
    </group>
  );
}

/** One shared env object for stepRider (no per-frame closures). */
const env: RiderEnv & { blocked: Readonly<Record<string, string>>; now: number; slot: Slot | null } = {
  blocked: {},
  now: 0,
  slot: null,
  isGreen(node, fromNode) {
    return signalFor(node, fromNode, env.now) === "green";
  },
  isBlocked(key) {
    return key in env.blocked;
  },
  ahead() {
    return env.slot ? env.slot.gap : Infinity;
  },
  aheadStopped() {
    return env.slot ? env.slot.gapStopped : false;
  },
};

function respawn(slot: Slot, rand: () => number, blocked: Readonly<Record<string, string>>) {
  const g = streetGraph();
  const pool = rand() < 0.4 || !g.districts.length ? g.downtown : g.districts;
  let key = pool[Math.floor(rand() * pool.length)];
  for (let k = 0; k < 6 && key in blocked; k++) key = pool[Math.floor(rand() * pool.length)];
  placeRider(slot.r, key, rand);
  slot.gap = Infinity;
  slot.shown = slot.r.heading;
  delete slot.entry.object.userData.hitBy;
  sync(slot);
  if (!slot.off) slot.off = registerVehicle(slot.entry);
}

/** Registry entry follows the sim. */
function sync(slot: Slot) {
  const r = slot.r;
  const e = slot.entry;
  e.object.position.set(r.x, 0, r.z);
  e.object.rotation.y = r.heading;
  if (e.from !== r.from || e.to !== r.to || !e.edgeKey) {
    e.from = r.from;
    e.to = r.to;
    e.edgeKey = edgeKey(r.from, r.to);
  }
  e.t = riderT(r);
  e.speed = r.speed;
  e.stopped = r.speed === 0;
}

const dummy = new Object3D();
dummy.scale.setScalar(SCALE);
const hidden = new Matrix4().makeScale(0, 0, 0);

function write(slots: Slot[], bike: InstancedMesh, rider: InstancedMesh) {
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const b = slot.r;
    if (b.down > 0) {
      bike.setMatrixAt(i, hidden);
      rider.setMatrixAt(i, hidden);
      continue;
    }
    let d = b.heading - slot.shown;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    slot.shown += d * 0.25;
    dummy.position.set(b.x, 0, b.z);
    dummy.rotation.set(0, slot.shown, b.speed > 0 ? Math.sin(b.phase) * 0.04 : 0.12);
    dummy.updateMatrix();
    bike.setMatrixAt(i, dummy.matrix);
    dummy.position.y = b.speed > 0 ? Math.abs(Math.sin(b.phase)) * 0.04 : 0;
    dummy.updateMatrix();
    rider.setMatrixAt(i, dummy.matrix);
  }
  bike.instanceMatrix.needsUpdate = true;
  rider.instanceMatrix.needsUpdate = true;
}
