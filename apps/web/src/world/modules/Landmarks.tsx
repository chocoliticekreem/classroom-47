"use client";
// Module: Landmarks. The hero props of the downtown grid, one per reserved cell:
//   (-140, 140) police station    (140, -140) hospital    (-140, -140) highway maintenance yard
//   (20, 20) central park + Big-Ben-style clock tower     (140, 20) London-Eye-style wheel
// Everything static is baked into a few vertex-coloured meshes per landmark (see Landmarks/kit.ts).
// Reads useWorld.timeOfDay (clock hands, night lighting) and paused (wheel, ducks). Writes nothing.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { useWorld } from "../store";
import { CentralPark } from "./Landmarks/CentralPark";
import { FerrisWheel } from "./Landmarks/FerrisWheel";
import { Hospital } from "./Landmarks/Hospital";
import { MaintenanceYard } from "./Landmarks/MaintenanceYard";
import { makeMaterials } from "./Landmarks/materials";
import { PoliceStation } from "./Landmarks/PoliceStation";
import { nightFactor } from "./Landmarks/time";

export default function Landmarks() {
  const mats = useMemo(() => makeMaterials(), []);
  useEffect(() => () => mats.dispose(), [mats]);

  useFrame(() => {
    mats.setNight(nightFactor(useWorld.getState().timeOfDay));
  });

  return (
    <group name="landmarks">
      <PoliceStation mats={mats} />
      <Hospital mats={mats} />
      <MaintenanceYard mats={mats} />
      <CentralPark mats={mats} />
      <FerrisWheel mats={mats} />
    </group>
  );
}
