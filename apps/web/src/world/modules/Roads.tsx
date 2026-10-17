"use client";
// Module: Roads. Every edge of the road graph as asphalt with markings, downtown junctions, zebras,
// sidewalks, the A-Ring highway (barriers + sign gantries) and live overlays on closed roads.
import { useEffect, useMemo } from "react";
import type { BufferGeometry } from "three";
import { Boxes } from "./Roads/Boxes";
import Closures from "./Roads/Closures";
import { buildRoadLayout, type Gantry } from "./Roads/layout";
import { signTexture } from "./Roads/textures";

function Flat({ geometry, color, layer, roughness = 0.9 }: { geometry: BufferGeometry; color: string; layer: number; roughness?: number }) {
  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial
        color={color}
        roughness={roughness}
        polygonOffset
        polygonOffsetFactor={-layer}
        polygonOffsetUnits={-layer * 2}
      />
    </mesh>
  );
}

function Sign({ g, forward }: { g: Gantry; forward: boolean }) {
  const [top, main] = forward ? g.fwd : g.back;
  const tex = useMemo(() => signTexture(top, main), [top, main]);
  useEffect(() => () => tex.dispose(), [tex]);
  // side vector (-dz, dx); traffic along +d keeps left (side -3) and reads a panel facing -d
  const side = forward ? -3 : 3;
  const along = forward ? -0.29 : 0.29;
  const x = g.x - g.dz * side + g.dx * along;
  const z = g.z + g.dx * side + g.dz * along;
  const rotY = forward ? Math.atan2(-g.dx, -g.dz) : Math.atan2(g.dx, g.dz);
  return (
    <mesh position={[x, 6.25, z]} rotation={[0, rotY, 0]}>
      <planeGeometry args={[5.4, 2.2]} />
      <meshStandardMaterial map={tex} emissiveMap={tex} emissive="#ffffff" emissiveIntensity={0.3} roughness={0.6} />
    </mesh>
  );
}

export default function Roads() {
  const L = useMemo(() => buildRoadLayout(), []);
  const geo = useMemo(
    () => ({
      country: L.country.build(),
      street: L.street.build(),
      patches: L.patches.build(),
      highway: L.highway.build(),
      markings: L.markings.build(),
    }),
    [L],
  );
  useEffect(() => () => Object.values(geo).forEach((g) => g.dispose()), [geo]);

  return (
    <group name="roads">
      <Flat geometry={geo.country} color="#2b2a2c" layer={1} />
      <Flat geometry={geo.street} color="#3a3d45" layer={2} />
      <Flat geometry={geo.patches} color="#41444c" layer={3} />
      <Flat geometry={geo.highway} color="#33353c" layer={4} roughness={0.85} />
      <Flat geometry={geo.markings} color="#f4f3ee" layer={5} roughness={0.7} />

      <Boxes boxes={L.sidewalks} color="#b9b4aa" />
      <Boxes boxes={L.curbs} color="#d9d5cc" />

      <Boxes boxes={L.centralBarrier} color="#c9c6be" />
      <Boxes boxes={L.rails} color="#aeb6bf" roughness={0.4} metalness={0.5} />
      <Boxes boxes={L.railPosts} color="#7d858e" roughness={0.5} metalness={0.4} />
      <Boxes boxes={L.gantryMetal} color="#8c949c" roughness={0.5} metalness={0.4} castShadow />
      {L.gantries.map((g, i) => (
        <group key={i}>
          <Sign g={g} forward />
          <Sign g={g} forward={false} />
        </group>
      ))}

      <Closures />
    </group>
  );
}
