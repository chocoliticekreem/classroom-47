"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { makeFacadeMaterial, updateFacadeUniforms } from "./buildings/material";
import { buildBuildingChunks } from "./buildings/massing";
import { useGeometry } from "./useGeometry";

export function Buildings() {
  const { buildings } = useGeometry();
  const chunks = useMemo(() => buildBuildingChunks(buildings), [buildings]);
  const material = useMemo(() => makeFacadeMaterial(), []);

  useFrame(({ clock }) => updateFacadeUniforms(clock.elapsedTime));

  useEffect(
    () => () => {
      chunks.forEach((chunk) => chunk.geometry.dispose());
      material.dispose();
    },
    [chunks, material],
  );

  return (
    <>
      {chunks.map((chunk, i) => (
        <mesh key={i} geometry={chunk.geometry} material={material} />
      ))}
    </>
  );
}
