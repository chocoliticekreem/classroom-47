"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { Beam, SiteLabel } from "./bankside/Beacon";
import { buildFalconPoint } from "./bankside/falconPoint";
import { buildHalkin } from "./bankside/halkin";
import { LAYERS, type SiteModel } from "./bankside/kit";
import { makeSignMaterial, makeSiteMaterials, updateSiteMaterials } from "./bankside/materials";
import { towerHillInRange, towerHillOffset } from "../landmarks";

/**
 * Two hero buildings on the south bank, inside the loaded city: Falcon Point (Bankside) and Halkin (the
 * hack venue). Plots were picked from the OSM data: on land, clear of building footprints, Falcon Point's
 * river front facing the water to the north-north-east and Halkin one block back, to its south-west.
 */
interface SiteConfig {
  id: string;
  name: string;
  /** Local metres (origin Tower Hill). */
  at: [number, number];
  yaw: number;
  scale: number;
  color: string;
  build: () => SiteModel;
}

const SITES: SiteConfig[] = [
  {
    id: "falcon",
    name: "Falcon Point - Bankside",
    at: [-196, 510],
    yaw: -0.38,
    scale: 1,
    color: "#ffb070",
    build: buildFalconPoint,
  },
  {
    id: "halkin",
    name: "Halkin, 1-2 Paris Garden (Hack venue)",
    at: [-236, 548],
    yaw: -0.8,
    scale: 0.8,
    color: "#5fd4ff",
    build: buildHalkin,
  },
];

/** Local metres of Falcon Point and Halkin (origin Tower Hill). */
export const BANKSIDE_SITES = Object.fromEntries(SITES.map((s) => [s.id, s.at])) as Record<string, [number, number]>;

const falcon = SITES[0];
const falconFront: [number, number] = [-Math.sin(falcon.yaw), -Math.cos(falcon.yaw)];

/** Camera preset shape (see scene/cameraStore.ts PRESETS): frames Falcon Point from the river, ~150 m off. */
export const BANKSIDE_VIEW = {
  pos: [falcon.at[0] + falconFront[0] * 150, 35, falcon.at[1] + falconFront[1] * 150] as [number, number, number],
  target: [falcon.at[0], 12, falcon.at[1]] as [number, number, number],
  label: "Bankside",
};

export function Bankside() {
  const built = useMemo(() => {
    const materials = makeSiteMaterials();
    const sites = SITES.map((site) => {
      const model = site.build();
      const signs = model.signs.map((spec) => ({ spec, material: makeSignMaterial(spec) }));
      return { site, model, signs };
    });
    return { materials, sites, signMaterials: sites.flatMap((s) => s.signs.map((m) => m.material)) };
  }, []);
  const plane = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  useFrame(() => updateSiteMaterials(built.materials, built.signMaterials));
  const [thx, thz] = towerHillOffset();

  useEffect(
    () => () => {
      plane.dispose();
      Object.values(built.materials).forEach((m) => m.dispose());
      built.signMaterials.forEach((m) => {
        m.map?.dispose();
        m.dispose();
      });
      built.sites.forEach((s) => LAYERS.forEach((l) => s.model.geometry[l]?.dispose()));
    },
    [built, plane],
  );

  if (!towerHillInRange()) return null;
  return (
    <group position={[thx, 0, thz]}>
      {built.sites.map(({ site, model, signs }) => (
        <group key={site.id}>
          <group position={[site.at[0], 0, site.at[1]]} rotation={[0, site.yaw, 0]} scale={site.scale}>
            {LAYERS.map((layer) => {
              const geometry = model.geometry[layer];
              return geometry ? <mesh key={layer} geometry={geometry} material={built.materials[layer]} /> : null;
            })}
            {signs.map(({ spec, material }, i) => (
              <group key={i} position={[spec.x, spec.y, spec.z]}>
                <mesh geometry={plane} material={material} rotation={[0, spec.rotY, 0]} scale={[spec.w, spec.h, 1]} />
                {spec.double && (
                  <mesh geometry={plane} material={material} rotation={[0, spec.rotY + Math.PI, 0]} scale={[spec.w, spec.h, 1]} />
                )}
              </group>
            ))}
          </group>
          <Beam x={site.at[0]} z={site.at[1]} color={site.color} />
          <SiteLabel
            x={site.at[0]}
            y={model.topM * site.scale + 8}
            z={site.at[1]}
            name={site.name}
            color={site.color}
          />
        </group>
      ))}
    </group>
  );
}
