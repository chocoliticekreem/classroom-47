"use client";
// Module: Crowds. 3,000-6,000 pedestrians walking every street sidewalk in the city (derived at runtime
// from the road graph, so new districts fill up automatically), strolling in the central park, streaming
// to metro stations, chatting in groups and queueing for the wheel. Some jog, some carry umbrellas, some
// walk dogs. Everything moves in the vertex shader: the CPU only advances one uTime uniform per frame.
// Three draw calls (people, umbrellas, dogs). Logic: ./Crowds/paths.ts + population.ts (tested).
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { type BufferGeometry, InstancedBufferAttribute, InstancedMesh, type Material } from "three";
import { useWorld } from "../store";
import { dogGeometry, personGeometry, umbrellaGeometry } from "./Crowds/meshes";
import { buildCrowd, type Attrs } from "./Crowds/population";
import { crowdMaterial, crowdUniforms, type Variant } from "./Crowds/shader";
import { METRO_LINES } from "./Transit/metroLayout";

function instanced(geo: BufferGeometry, mat: Material, a: Attrs) {
  geo.setAttribute("aWalk", new InstancedBufferAttribute(a.aWalk, 4));
  geo.setAttribute("aLook", new InstancedBufferAttribute(a.aLook, 4));
  geo.setAttribute("aShirt", new InstancedBufferAttribute(a.aShirt, 4));
  geo.setAttribute("aPants", new InstancedBufferAttribute(a.aPants, 4));
  geo.computeVertexNormals();
  // Positions come from the shader (instance matrices stay identity), so the CPU bounds are meaningless.
  const mesh = new InstancedMesh(geo, mat, Math.max(1, a.count));
  mesh.count = a.count;
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

export default function Crowds() {
  const built = useMemo(() => {
    const stations = METRO_LINES.flatMap((l) => l.stations);
    const crowd = buildCrowd(stations);
    const uniforms = crowdUniforms(crowd.packed);
    const parts: [Variant, () => BufferGeometry, Attrs][] = [
      ["person", personGeometry, crowd.people],
      ["umbrella", umbrellaGeometry, crowd.umbrellas],
      ["dog", dogGeometry, crowd.dogs],
    ];
    const meshes = parts.filter(([, , a]) => a.count > 0).map(([v, geo, a]) => instanced(geo(), crowdMaterial(v, uniforms), a));
    const tick = (dt: number) => {
      uniforms.uTime.value += dt;
    };
    return { uniforms, meshes, tick };
  }, []);

  useEffect(
    () => () => {
      for (const m of built.meshes) {
        m.geometry.dispose();
        (m.material as Material).dispose();
        m.dispose();
      }
      built.uniforms.uPathTex.value.dispose();
      built.uniforms.uHeadTex.value.dispose();
    },
    [built],
  );

  useFrame((_, delta) => {
    if (useWorld.getState().paused) return;
    built.tick(Math.min(delta, 0.1));
  });

  return (
    <group name="Crowds">
      {built.meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </group>
  );
}
