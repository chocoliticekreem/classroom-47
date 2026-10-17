"use client";

import { useFrame } from "@react-three/fiber";
import type { ReactNode } from "react";
import { ModuleBoundary } from "../ModuleBoundary";
import { updateLandmarkMaterials } from "./landmarks/materials";
import { LondonBridge } from "./landmarks/LondonBridge";
import { Rail } from "./landmarks/Rail";
import { Skyline } from "./landmarks/Skyline";
import { Stations } from "./landmarks/Stations";
import { TowerBridge } from "./landmarks/TowerBridge";
import { TowerOfLondon } from "./landmarks/TowerOfLondon";
import { LondonEye, Westminster } from "./landmarks/Westminster";

function Safe({ name, children }: { name: string; children: ReactNode }) {
  return <ModuleBoundary name={`Landmarks/${name}`}>{children}</ModuleBoundary>;
}

/** Hero London landmarks, stations and elevated rail. Needs GeometryContext (stations, rail). */
export function Landmarks() {
  useFrame(({ clock }) => updateLandmarkMaterials(clock.elapsedTime));
  return (
    <>
      <Safe name="TowerBridge"><TowerBridge /></Safe>
      <Safe name="LondonBridge"><LondonBridge /></Safe>
      <Safe name="TowerOfLondon"><TowerOfLondon /></Safe>
      <Safe name="Skyline"><Skyline /></Safe>
      <Safe name="Westminster"><Westminster /></Safe>
      <Safe name="LondonEye"><LondonEye /></Safe>
      <Safe name="Rail"><Rail /></Safe>
      <Safe name="Stations"><Stations /></Safe>
    </>
  );
}
