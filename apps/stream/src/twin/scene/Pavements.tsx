"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { KERB_W, PATH_W, PATH_Y, PAVE_W, PAVEMENT_Y, ROAD_Y, layoutOf, offsetPolyline } from "../network/layout";
import type { RoadNetwork, XZ } from "../network/types";
import { useNetwork } from "../network/useNetwork";
import { MeshBuilder, makeSurfaceMaterial, useSurfaceUniforms } from "./surfaces";

const SLAB = new THREE.Color("#8d939e");
const KERB_TOP = new THREE.Color("#5b606b");
const KERB_FACE = new THREE.Color("#6e737e");
const SKIRT = new THREE.Color("#3c404a");

function lerpLine(a: XZ[], b: XZ[], t: number): XZ[] {
  return a.map((p, i) => [p[0] + (b[i][0] - p[0]) * t, p[1] + (b[i][1] - p[1]) * t]);
}

/** Raised pavement between a carriageway edge (`inner`) and the building side (`outer`): kerb stripe, flagstones, kerb face. */
function pavementStrip(b: MeshBuilder, inner: XZ[], outer: XZ[]) {
  if (inner.length < 2) return;
  const kerb = lerpLine(inner, outer, KERB_W / PAVE_W);
  b.flatStrip(inner, kerb, PAVEMENT_Y, KERB_TOP);
  b.flatStrip(kerb, outer, PAVEMENT_Y, SLAB, 1);
  b.wall(inner, outer, ROAD_Y, PAVEMENT_Y, KERB_FACE);
  b.wall(outer, inner, 0.05, PAVEMENT_Y, SKIRT);
}

function buildPavements(net: RoadNetwork): THREE.BufferGeometry {
  const layout = layoutOf(net);
  const b = new MeshBuilder();
  for (const strip of layout.strips) {
    if (!strip) continue;
    pavementStrip(b, strip.leftIn, strip.leftOut);
    pavementStrip(b, strip.rightIn, strip.rightOut);
  }
  for (const corner of layout.corners) pavementStrip(b, corner.inner, corner.outer);
  for (const id of layout.pathIds) {
    const pts = net.footways[id].pts;
    b.flatStrip(offsetPolyline(pts, PATH_W / 2), offsetPolyline(pts, -PATH_W / 2), PATH_Y, SLAB, 1);
  }
  return b.build();
}

export function Pavements() {
  const net = useNetwork();
  useSurfaceUniforms();
  const geometry = useMemo(() => buildPavements(net), [net]);
  const material = useMemo(() => makeSurfaceMaterial({ roughness: 0.88, paving: true }), []);

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  return <mesh geometry={geometry} material={material} />;
}
