"use client";
// Module: Ground. The terrain base: meadow, zone surfaces, riverbed, beaches and rocks, the sea wall, and the animated sea.
// Heights: meadow y = 0, kerb bands 0.005, riverbed 0.006, zone patches 0.008, quay markings 0.011-0.012, sea WATER_Y (-0.25).
// Surfaces also use a positive polygonOffset (meadow most, patches least) so roads at y >= 0.02 always win the depth test.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { WATER_X } from "../config";
import { useWorld } from "../store";
import {
  beachGeometry,
  bordersGeometry,
  buildRocks,
  embankmentRects,
  gridGeometry,
  landRects,
  meadowColor,
  patchColor,
  PATCHES,
  quayLinesGeometry,
  riverbedGeometry,
} from "./Ground/geometry";
import { QUAY_N, QUAY_S, WATER_Y } from "./Ground/noise";
import {
  cobblesTexture,
  countryTexture,
  depotTexture,
  docksTexture,
  industrialTexture,
  lawnTexture,
  lushTexture,
  meadowTexture,
  mudTexture,
  pavingTexture,
  shoreditchTexture,
  southbankTexture,
  terminalTexture,
  TILE,
} from "./Ground/textures";
import { createWaterMaterial, tickWater } from "./Ground/water";

const PATCH_Y = 0.008;
const SEA_EXTENT = 4400;

function surface(map: THREE.Texture | null, offset: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({
    map,
    vertexColors: true,
    roughness: 0.9,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: offset,
    polygonOffsetUnits: offset * 2,
    ...extra,
  });
}

function buildGround() {
  const tex = {
    meadow: meadowTexture(),
    country: countryTexture(),
    lawn: lawnTexture(),
    paving: pavingTexture(),
    depot: depotTexture(),
    docks: docksTexture(),
    southbank: southbankTexture(),
    shoreditch: shoreditchTexture(),
    cobbles: cobblesTexture(),
    industrial: industrialTexture(),
    terminal: terminalTexture(),
    lush: lushTexture(),
    mud: mudTexture(),
  };

  const meshes: { geo: THREE.BufferGeometry; mat: THREE.Material; name: string }[] = [
    { name: "meadow", geo: gridGeometry(landRects(), 0, TILE.meadow, meadowColor), mat: surface(tex.meadow, 4) },
    { name: "kerbs", geo: bordersGeometry(), mat: surface(null, 3, { roughness: 0.95 }) },
    { name: "downtown", geo: gridGeometry([PATCHES.downtown], PATCH_Y, TILE.paving, patchColor(0.12, 41)), mat: surface(tex.paving, 2, { roughness: 0.85 }) },
    { name: "countryside", geo: gridGeometry([PATCHES.countryside], PATCH_Y, TILE.country, patchColor(0.3, 42)), mat: surface(tex.country, 2) },
    { name: "depot", geo: gridGeometry([PATCHES.depot], PATCH_Y, TILE.depot, patchColor(0.1, 43)), mat: surface(tex.depot, 2, { roughness: 0.82 }) },
    { name: "suburbs", geo: gridGeometry([PATCHES.suburbs], PATCH_Y, TILE.lawn, patchColor(0.18, 44)), mat: surface(tex.lawn, 2) },
    { name: "docks", geo: gridGeometry([PATCHES.docks], PATCH_Y, TILE.docks, patchColor(0.16, 45)), mat: surface(tex.docks, 2, { roughness: 0.8 }) },
    { name: "embankment", geo: gridGeometry(embankmentRects(), PATCH_Y, TILE.docks, patchColor(0.12, 46)), mat: surface(tex.docks, 2, { roughness: 0.8 }) },
    { name: "container-terminal", geo: gridGeometry([PATCHES.containerTerminal], PATCH_Y, TILE.terminal, patchColor(0.1, 47)), mat: surface(tex.terminal, 2, { roughness: 0.85 }) },
    { name: "industrial", geo: gridGeometry([PATCHES.industrial], PATCH_Y, TILE.industrial, patchColor(0.22, 48)), mat: surface(tex.industrial, 2, { roughness: 0.75 }) },
    { name: "southbank", geo: gridGeometry([PATCHES.southbank], PATCH_Y, TILE.southbank, patchColor(0.14, 49)), mat: surface(tex.southbank, 2, { roughness: 0.85 }) },
    { name: "shoreditch", geo: gridGeometry([PATCHES.shoreditch], PATCH_Y, TILE.shoreditch, patchColor(0.18, 50)), mat: surface(tex.shoreditch, 2, { roughness: 0.85 }) },
    { name: "old-town", geo: gridGeometry([PATCHES.oldTown], PATCH_Y, TILE.cobbles, patchColor(0.16, 51)), mat: surface(tex.cobbles, 2, { roughness: 0.88 }) },
    { name: "hampstead", geo: gridGeometry([PATCHES.hampstead], PATCH_Y, TILE.lush, patchColor(0.3, 52)), mat: surface(tex.lush, 2) },
    { name: "riverbed", geo: riverbedGeometry(), mat: surface(tex.mud, 3, { roughness: 0.7 }) },
    { name: "quay-lines", geo: quayLinesGeometry(), mat: surface(null, 1, { roughness: 0.6 }) },
    { name: "beach", geo: beachGeometry(), mat: surface(null, 3, { flatShading: true, roughness: 0.95 }) },
  ];

  // Sea wall: a concrete block under the docks/embankment whose east and end faces drop into the sea.
  const quayGeo = new THREE.BoxGeometry(16, 3, QUAY_S - QUAY_N);
  quayGeo.translate(WATER_X - 8, -1.55, (QUAY_N + QUAY_S) / 2);
  const quayMat = new THREE.MeshStandardMaterial({ color: "#7c8085", roughness: 0.9, flatShading: true });
  meshes.push({ name: "quay-wall", geo: quayGeo, mat: quayMat });

  // The sea: from just under the beach far out past the horizon.
  const waterGeo = new THREE.PlaneGeometry(SEA_EXTENT + 40, SEA_EXTENT * 2, 1, 1);
  waterGeo.rotateX(-Math.PI / 2);
  waterGeo.translate(WATER_X - 40 + (SEA_EXTENT + 40) / 2, WATER_Y, 0);
  const waterMat = createWaterMaterial();

  const rocks = buildRocks();

  const dispose = () => {
    for (const t of Object.values(tex)) t.dispose();
    for (const m of meshes) {
      m.geo.dispose();
      m.mat.dispose();
    }
    waterGeo.dispose();
    waterMat.dispose();
    rocks.geometry.dispose();
    (rocks.material as THREE.Material).dispose();
    rocks.dispose();
  };

  return { meshes, waterGeo, waterMat, rocks, dispose };
}

export default function Ground() {
  const g = useMemo(() => buildGround(), []);
  useEffect(() => g.dispose, [g]);

  useFrame((state, delta) => {
    const world = useWorld.getState();
    tickWater(g.waterMat, world.paused ? 0 : Math.min(delta, 0.1), world.timeOfDay, state.scene.fog?.color ?? null);
  });

  return (
    <group name="ground">
      {g.meshes.map((m) => (
        <mesh key={m.name} name={`ground-${m.name}`} geometry={m.geo} material={m.mat} receiveShadow />
      ))}
      <mesh name="ground-sea" geometry={g.waterGeo} material={g.waterMat} />
      <primitive object={g.rocks} />
    </group>
  );
}
