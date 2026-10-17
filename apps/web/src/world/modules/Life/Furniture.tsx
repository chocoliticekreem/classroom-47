"use client";
// Seeded street furniture on downtown sidewalks: red phone boxes, pillar boxes, bus shelters, benches, bins.
// One merged, vertex-coloured geometry per kind => one instanced draw call per kind (+ glowing glass).
import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  BoxGeometry,
  CylinderGeometry,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  type BufferGeometry,
} from "three";
import { useWorld } from "../../store";
import { merge, paint } from "./geo";
import { nightness, placeFurniture, type FurnitureKind } from "./sim";

const RED = "#c8102e";

function box(w: number, h: number, d: number, x: number, y: number, z: number, hex: string) {
  const g = new BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return paint(g, hex);
}
function cyl(rt: number, rb: number, h: number, x: number, y: number, z: number, hex: string, seg = 10) {
  const g = new CylinderGeometry(rt, rb, h, seg);
  g.translate(x, y, z);
  return paint(g, hex);
}

// Local frame: +z faces the road.
export function buildGeometries(): Record<FurnitureKind, BufferGeometry> & { glass: BufferGeometry } {
  const phone = merge([
    box(1.0, 2.3, 1.0, 0, 1.15, 0, RED),
    box(1.1, 0.18, 1.1, 0, 2.38, 0, "#a50d25"),
    cyl(0.5, 0.55, 0.14, 0, 2.53, 0, RED, 8),
    box(0.9, 0.16, 1.04, 0, 2.08, 0, "#1b1b1b"), // "TELEPHONE" band
  ]);
  const post = merge([
    cyl(0.28, 0.3, 1.05, 0, 0.55, 0, RED),
    (() => {
      const g = new SphereGeometry(0.32, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
      g.translate(0, 1.07, 0);
      return paint(g, RED);
    })(),
    box(0.62, 0.14, 0.62, 0, 0.05, 0, "#1b1b1b"),
    box(0.24, 0.05, 0.05, 0, 0.88, 0.29, "#1b1b1b"), // letter slot
  ]);
  const shelter = merge([
    box(3.2, 0.12, 1.4, 0, 2.35, 0, "#2b2d42"), // roof
    box(0.1, 2.3, 0.1, -1.5, 1.15, -0.6, "#2b2d42"),
    box(0.1, 2.3, 0.1, 1.5, 1.15, -0.6, "#2b2d42"),
    box(0.1, 2.3, 0.1, -1.5, 1.15, 0.6, "#2b2d42"),
    box(0.1, 2.3, 0.1, 1.5, 1.15, 0.6, "#2b2d42"),
    box(1.6, 0.08, 0.35, 0.4, 0.55, -0.4, "#6c757d"), // seat
    box(0.9, 0.3, 0.1, 0, 2.15, 0.68, "#e63946"), // route sign band
  ]);
  const bench = merge([
    box(1.8, 0.08, 0.5, 0, 0.48, 0, "#8d5a2b"),
    box(1.8, 0.4, 0.06, 0, 0.75, -0.24, "#8d5a2b"),
    box(0.08, 0.48, 0.5, -0.8, 0.24, 0, "#2b2b2b"),
    box(0.08, 0.48, 0.5, 0.8, 0.24, 0, "#2b2b2b"),
  ]);
  const bin = merge([cyl(0.3, 0.26, 0.85, 0, 0.43, 0, "#2d3e2f", 8), cyl(0.33, 0.33, 0.08, 0, 0.88, 0, "#c9a227", 8)]);
  // phone box windows: their own material so they can glow at night
  const glass = merge([
    box(1.04, 1.3, 0.8, 0, 1.2, 0, "#fff4d6"),
    box(0.8, 1.3, 1.04, 0, 1.2, 0, "#fff4d6"),
  ]);
  return { phone, post, shelter, bench, bin, glass };
}

const KINDS: FurnitureKind[] = ["phone", "post", "shelter", "bench", "bin"];

export default function Furniture() {
  const items = useMemo(() => placeFurniture(20260), []);
  const counts = useMemo(() => {
    const c: Record<FurnitureKind, number> = { phone: 0, post: 0, shelter: 0, bench: 0, bin: 0 };
    for (const it of items) c[it.kind]++;
    return c;
  }, [items]);
  const { geos, mat, glassMat, panelGeo, panelMat } = useMemo(() => {
    const geos = buildGeometries();
    const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.75, flatShading: true });
    const glassMat = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.3,
      emissive: "#ffd27a",
      emissiveIntensity: 0,
    });
    const panelGeo = new BoxGeometry(3.0, 1.7, 0.05);
    panelGeo.translate(0, 1.3, -0.62);
    const panelMat = new MeshStandardMaterial({ color: "#a8d8ea", transparent: true, opacity: 0.4, roughness: 0.1 });
    return { geos, mat, glassMat, panelGeo, panelMat };
  }, []);

  useEffect(
    () => () => {
      for (const g of Object.values(geos)) g.dispose();
      panelGeo.dispose();
      mat.dispose();
      glassMat.dispose();
      panelMat.dispose();
    },
    [geos, mat, glassMat, panelGeo, panelMat],
  );

  const refs = useRef<Partial<Record<FurnitureKind | "glass" | "panel", InstancedMesh | null>>>({});

  useLayoutEffect(() => {
    const dummy = new Object3D();
    const idx: Record<string, number> = { phone: 0, post: 0, shelter: 0, bench: 0, bin: 0, glass: 0, panel: 0 };
    const set = (key: string, m: Object3D) => {
      const mesh = refs.current[key as FurnitureKind];
      if (mesh) mesh.setMatrixAt(idx[key]++, m.matrix);
    };
    for (const it of items) {
      dummy.position.set(it.x, 0, it.z);
      dummy.rotation.set(0, it.heading, 0);
      dummy.updateMatrix();
      set(it.kind, dummy);
      if (it.kind === "phone") set("glass", dummy);
      if (it.kind === "shelter") set("panel", dummy);
    }
    for (const m of Object.values(refs.current)) {
      if (!m) continue;
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
    }
  }, [items]);

  // Phone box windows glow at dusk; cheap uniform tweak, no re-render.
  useFrame(() => {
    const glass = refs.current.glass;
    if (glass) (glass.material as MeshStandardMaterial).emissiveIntensity = 0.9 * nightness(useWorld.getState().timeOfDay);
  });

  return (
    <group>
      {KINDS.map((k) => (
        <instancedMesh
          key={k}
          ref={(m) => {
            refs.current[k] = m;
          }}
          args={[geos[k], mat, counts[k]]}
          receiveShadow
        />
      ))}
      <instancedMesh
        ref={(m) => {
          refs.current.glass = m;
        }}
        args={[geos.glass, glassMat, counts.phone]}
      />
      <instancedMesh
        ref={(m) => {
          refs.current.panel = m;
        }}
        args={[panelGeo, panelMat, counts.shelter]}
      />
    </group>
  );
}
