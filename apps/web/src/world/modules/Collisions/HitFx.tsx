"use client";
// Cyclist-hit visuals: the knocked-off bike and rider (tumbling, then lying in the road), and the
// onlookers who gather. All state lives in cyclistHits (stepped by the engine); this only draws it.
// Three instanced meshes, a handful of instances: 3 draw calls.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Color, InstancedMesh, Matrix4, MeshStandardMaterial, Object3D } from "three";
import { bikeGeometry, fallenRiderGeometry, onlookerGeometry } from "../Life/bikeGeo";
import { CROWD_N, FADE_MS, cyclistHits } from "./cyclist";

const MAX = 4; // scenes drawn at once
const SCALE = 1.25; // matches the live cyclists
const JERSEYS = ["#ffb703", "#e63946", "#3a86ff", "#2a9d8f", "#ff6a1a", "#8338ec", "#90be6d", "#ff006e"].map((c) => new Color(c));
const CLOTHES = ["#4a6fa5", "#b5524a", "#5d8a5e", "#d9c27a", "#7a5c99", "#3d3d46", "#c47a3d", "#9aa3ad"].map((c) => new Color(c));
const hidden = new Matrix4().makeScale(0, 0, 0);

export default function HitFx() {
  const bikeRef = useRef<InstancedMesh>(null);
  const riderRef = useRef<InstancedMesh>(null);
  const crowdRef = useRef<InstancedMesh>(null);
  const o = useMemo(() => new Object3D(), []);
  const res = useMemo(
    () => ({
      bike: bikeGeometry(),
      rider: fallenRiderGeometry(),
      person: onlookerGeometry(),
      bikeMat: new MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 }),
      bodyMat: new MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true }),
    }),
    [],
  );
  useEffect(
    () => () => {
      res.bike.dispose();
      res.rider.dispose();
      res.person.dispose();
      res.bikeMat.dispose();
      res.bodyMat.dispose();
    },
    [res],
  );

  // colours up front, so the instance-colour shader variant is compiled at load, not at the first hit
  useEffect(() => {
    const riders = riderRef.current;
    const crowd = crowdRef.current;
    if (!riders || !crowd) return;
    for (let i = 0; i < MAX; i++) riders.setColorAt(i, JERSEYS[i]);
    for (let i = 0; i < MAX * CROWD_N; i++) crowd.setColorAt(i, CLOTHES[i % CLOTHES.length]);
  }, []);

  useFrame(() => {
    const bikes = bikeRef.current;
    const riders = riderRef.current;
    const crowd = crowdRef.current;
    if (!bikes || !riders || !crowd) return;
    const now = performance.now();
    let i = 0;
    let colours = false;
    for (const hit of cyclistHits.values()) {
      if (i >= MAX) break;
      const fade = hit.clearedAt === null ? 1 : Math.max(0, 1 - (now - hit.clearedAt) / FADE_MS);
      const shrink = Math.min(1, fade * 3); // the bike is wheeled away near the end of the fade
      // bike: lying on its side once it stops
      const b = hit.bike;
      o.position.set(b.x, b.y + Math.abs(Math.sin(b.roll)) * 0.08, b.z);
      o.rotation.set(0, b.yaw, b.roll, "YXZ");
      o.scale.setScalar(SCALE * shrink);
      o.updateMatrix();
      bikes.setMatrixAt(i, shrink > 0 ? o.matrix : hidden);
      // rider: thrown, then lying in the road; carried on a stretcher by the paramedics; gone once loaded
      const r = hit.rider;
      if (hit.loaded || hit.clearedAt !== null) riders.setMatrixAt(i, hidden);
      else {
        if (hit.carry) {
          o.position.set(hit.carry.x, hit.carry.y, hit.carry.z);
          o.rotation.set(0, hit.carry.h, 0, "YXZ");
        } else {
          const side = r.roll >= 0 ? Math.PI / 2 : -Math.PI / 2;
          o.position.set(r.x, r.y, r.z);
          o.rotation.set((r.roll - side) * 0.5, r.yaw, r.roll - side, "YXZ");
        }
        o.scale.setScalar(SCALE);
        o.updateMatrix();
        riders.setMatrixAt(i, o.matrix);
      }
      riders.setColorAt(i, JERSEYS[hit.jersey % JERSEYS.length]);
      colours = true;
      // crowd
      const c = hit.crowd;
      for (let k = 0; k < CROWD_N; k++) {
        const idx = i * CROWD_N + k;
        if (k >= c.n) {
          crowd.setMatrixAt(idx, hidden);
          continue;
        }
        const walking = Math.abs(c.x[k] - (hit.clearedAt === null ? c.tx[k] : c.sx[k])) + Math.abs(c.z[k] - (hit.clearedAt === null ? c.tz[k] : c.sz[k])) > 0.05;
        o.position.set(c.x[k], walking ? Math.abs(Math.sin(now * 0.012 + k)) * 0.06 : 0, c.z[k]);
        o.rotation.set(0, c.h[k], 0);
        o.scale.setScalar(fade);
        o.updateMatrix();
        crowd.setMatrixAt(idx, fade > 0 ? o.matrix : hidden);
        crowd.setColorAt(idx, CLOTHES[c.colour[k] % CLOTHES.length]);
      }
      i++;
    }
    const used = i;
    for (; i < MAX; i++) {
      bikes.setMatrixAt(i, hidden);
      riders.setMatrixAt(i, hidden);
      for (let k = 0; k < CROWD_N; k++) crowd.setMatrixAt(i * CROWD_N + k, hidden);
    }
    bikes.count = used;
    riders.count = used;
    crowd.count = used * CROWD_N;
    bikes.instanceMatrix.needsUpdate = true;
    riders.instanceMatrix.needsUpdate = true;
    crowd.instanceMatrix.needsUpdate = true;
    if (colours) {
      if (riders.instanceColor) riders.instanceColor.needsUpdate = true;
      if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
    }
  });

  return (
    <group name="cyclist-hits">
      <instancedMesh ref={bikeRef} args={[res.bike, res.bikeMat, MAX]} frustumCulled={false} count={0} />
      <instancedMesh ref={riderRef} args={[res.rider, res.bodyMat, MAX]} frustumCulled={false} count={0} />
      <instancedMesh ref={crowdRef} args={[res.person, res.bodyMat, MAX * CROWD_N]} frustumCulled={false} count={0} />
    </group>
  );
}
