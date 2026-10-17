"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { toLocal } from "../config";
import { Beam, SiteLabel } from "./bankside/Beacon";
import { buildFalconPoint } from "./bankside/falconPoint";
import { buildHalkin } from "./bankside/halkin";
import { LAYERS, type SiteModel } from "./bankside/kit";
import { makeSignMaterial, makeSiteMaterials, updateSiteMaterials } from "./bankside/materials";

/**
 * Two hero buildings ~2 km west of Tower Hill, outside the real-geometry box: Falcon Point (Bankside) and
 * Halkin (the hack venue). They are built larger than life so they read as skyline pieces, use a light
 * fog, carry a light shaft and an edge-clamped label, and each stands on its own little ground patch.
 */
const SKYLINE_SCALE = 2.4;

interface SiteConfig {
  id: string;
  name: string;
  lat: number;
  lon: number;
  yaw: number;
  color: string;
  build: () => SiteModel;
}

const SITES: SiteConfig[] = [
  {
    id: "falcon",
    name: "Falcon Point - Bankside",
    lat: 51.50818,
    lon: -0.10157,
    yaw: -0.38,
    color: "#ffb070",
    build: buildFalconPoint,
  },
  {
    id: "halkin",
    name: "Halkin, 1-2 Paris Garden (Hack venue)",
    lat: 51.50683,
    lon: -0.10636,
    yaw: -1.2,
    color: "#5fd4ff",
    build: buildHalkin,
  },
];

const PLACED = SITES.map((s) => ({ ...s, at: toLocal(s.lat, s.lon) }));

/** Local metres of Falcon Point and Halkin (origin Tower Hill). */
export const BANKSIDE_SITES = Object.fromEntries(PLACED.map((s) => [s.id, s.at])) as Record<string, [number, number]>;

const falcon = PLACED[0];
const falconFront: [number, number] = [-Math.sin(falcon.yaw), -Math.cos(falcon.yaw)];

/** Camera preset shape (see scene/cameraStore.ts PRESETS): frames Falcon Point from the river. */
export const BANKSIDE_VIEW = {
  pos: [falcon.at[0] + falconFront[0] * 240, 42, falcon.at[1] + falconFront[1] * 240] as [number, number, number],
  target: [falcon.at[0], 26, falcon.at[1]] as [number, number, number],
  label: "Bankside",
};

export function Bankside() {
  const built = useMemo(() => {
    const materials = makeSiteMaterials();
    const sites = PLACED.map((site) => {
      const model = site.build();
      const signs = model.signs.map((spec) => ({ spec, material: makeSignMaterial(spec) }));
      return { site, model, signs };
    });
    return { materials, sites, signMaterials: sites.flatMap((s) => s.signs.map((m) => m.material)) };
  }, []);
  const plane = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  useFrame(() => updateSiteMaterials(built.materials, built.signMaterials));

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

  return (
    <>
      {built.sites.map(({ site, model, signs }) => (
        <group key={site.id}>
          <group position={[site.at[0], 0, site.at[1]]} rotation={[0, site.yaw, 0]} scale={SKYLINE_SCALE}>
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
            y={model.topM * SKYLINE_SCALE + 16}
            z={site.at[1]}
            name={site.name}
            color={site.color}
          />
        </group>
      ))}
    </>
  );
}
