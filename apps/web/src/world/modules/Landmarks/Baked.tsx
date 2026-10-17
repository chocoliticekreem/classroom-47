"use client";
import { useEffect, useMemo } from "react";
import { type Kits, newKits } from "./kit";
import type { LandmarkMaterials } from "./materials";

/** Bakes a landmark's static parts once into (at most) three meshes: solid, glow and glass. */
export function Baked({ build, mats, shadows = true }: { build: (k: Kits) => void; mats: LandmarkMaterials; shadows?: boolean }) {
  const geos = useMemo(() => {
    const k = newKits();
    build(k);
    return { solid: k.solid.build(), glow: k.glow.build(), glass: k.glass.build() };
  }, [build]);

  useEffect(
    () => () => {
      geos.solid?.dispose();
      geos.glow?.dispose();
      geos.glass?.dispose();
    },
    [geos],
  );

  return (
    <>
      {geos.solid && <mesh geometry={geos.solid} material={mats.solid} castShadow={shadows} receiveShadow />}
      {geos.glass && <mesh geometry={geos.glass} material={mats.glass} />}
      {geos.glow && <mesh geometry={geos.glow} material={mats.glow} />}
    </>
  );
}
