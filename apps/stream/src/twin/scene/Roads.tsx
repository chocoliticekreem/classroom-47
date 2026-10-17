"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { ROAD_Y, layoutOf, offsetPolyline, subPolyline } from "../network/layout";
import type { RoadNetwork, XZ } from "../network/types";
import { useNetwork } from "../network/useNetwork";
import { MeshBuilder, makeSurfaceMaterial, useSurfaceUniforms } from "./surfaces";

const ASPHALT = { major: new THREE.Color("#343842"), minor: new THREE.Color("#2e323c") };
const PAINT = new THREE.Color("#d6dae2");
const MARKING_Y = ROAD_Y + 0.02;

const DASH = { major: { on: 3.5, off: 7 }, minor: { on: 2, off: 5 } };

function paintDashes(b: MeshBuilder, pts: XZ[], cum: number[], from: number, to: number, on: number, off: number) {
  const span = to - from;
  if (span < on) return;
  const count = Math.max(1, Math.floor((span + off) / (on + off)));
  const pitch = count > 1 ? (span - on) / (count - 1) : 0;
  const start = count > 1 ? from : from + (span - on) / 2;
  for (let i = 0; i < count; i++) {
    const s0 = start + pitch * i;
    const line = subPolyline(pts, cum, s0, s0 + on);
    b.flatStrip(offsetPolyline(line, 0.08), offsetPolyline(line, -0.08), MARKING_Y, PAINT);
  }
}

function buildAsphalt(net: RoadNetwork): THREE.BufferGeometry {
  const layout = layoutOf(net);
  const b = new MeshBuilder();
  net.edges.forEach((edge) => {
    const strip = layout.strips[edge.id];
    if (strip) b.flatStrip(strip.leftIn, strip.rightIn, ROAD_Y, ASPHALT[edge.kind]);
  });
  for (const { node, poly } of layout.patches) {
    const n = net.nodes[node];
    const color = n.edges.some((e) => net.edges[e].kind === "major") ? ASPHALT.major : ASPHALT.minor;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      b.tri([n.x, ROAD_Y, n.z], [p[0], ROAD_Y, p[1]], [q[0], ROAD_Y, q[1]], [0, 1, 0], color);
    }
  }
  return b.build();
}

function buildMarkings(net: RoadNetwork): THREE.BufferGeometry {
  const layout = layoutOf(net);
  const b = new MeshBuilder();
  net.edges.forEach((edge) => {
    const strip = layout.strips[edge.id];
    if (!strip || strip.length < 8) return;
    const margin = (atStart: boolean) => (net.nodes[atStart ? edge.from : edge.to].junction ? 2.5 : 0.5);
    if (!edge.oneway) {
      const { on, off } = DASH[edge.kind];
      paintDashes(b, strip.pts, strip.cum, margin(true), strip.length - margin(false), on, off);
    }
    if (edge.kind === "major") {
      for (const side of [1, -1]) {
        const d = side * (edge.width / 2 - 0.5);
        b.flatStrip(offsetPolyline(strip.pts, d + 0.06), offsetPolyline(strip.pts, d - 0.06), MARKING_Y, PAINT);
      }
    }
  });

  for (const items of layout.items) {
    for (const it of items) {
      if (!it.crossing) continue;
      const edge = net.edges[it.edge];
      const strip = layout.strips[it.edge];
      if (!strip) continue;
      const n = strip.pts.length;
      const c = it.atStart ? strip.pts[0] : strip.pts[n - 1];
      const nb = it.atStart ? strip.pts[1] : strip.pts[n - 2];
      const dl = Math.hypot(nb[0] - c[0], nb[1] - c[1]) || 1;
      const dx = (nb[0] - c[0]) / dl;
      const dz = (nb[1] - c[1]) / dl;
      const reach = edge.width / 2 - 0.7;
      for (let lat = -reach; lat <= reach + 0.01; lat += 1) {
        const x0 = c[0] - dz * (lat - 0.25) - dx * 1.5;
        const z0 = c[1] + dx * (lat - 0.25) - dz * 1.5;
        const x1 = c[0] - dz * (lat + 0.25) - dx * 1.5;
        const z1 = c[1] + dx * (lat + 0.25) - dz * 1.5;
        b.flatQuad([x0, z0], [x1, z1], [x0 + dx * 3, z0 + dz * 3], [x1 + dx * 3, z1 + dz * 3], MARKING_Y, PAINT);
      }
    }
  }
  return b.build();
}

const NODE_COLOURS = [new THREE.Color(2.6, 0.2, 2.2), new THREE.Color(0.2, 1.8, 2.4), new THREE.Color(2.8, 1.3, 0.2)];

function NodeDebug({ net }: { net: RoadNetwork }) {
  const { mesh, lines } = useMemo(() => {
    const inst = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1.1, 10, 8),
      new THREE.MeshBasicMaterial({ toneMapped: false }),
      net.nodes.length,
    );
    const m = new THREE.Matrix4();
    net.nodes.forEach((n, i) => {
      const deg = n.edges.length;
      const scale = n.junction ? 1.6 : 1;
      m.makeScale(scale, scale, scale).setPosition(n.x, 1.6, n.z);
      inst.setMatrixAt(i, m);
      inst.setColorAt(i, NODE_COLOURS[deg <= 1 ? 0 : deg === 2 ? 1 : 2]);
    });
    inst.frustumCulled = false;
    const verts: number[] = [];
    for (const e of net.edges) {
      for (let i = 0; i < e.pts.length - 1; i++) {
        verts.push(e.pts[i][0], 1, e.pts[i][1], e.pts[i + 1][0], 1, e.pts[i + 1][1]);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    const seg = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: new THREE.Color(0.4, 2.2, 0.6), toneMapped: false }));
    seg.frustumCulled = false;
    return { mesh: inst, lines: seg };
  }, [net]);

  useEffect(
    () => () => {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
      lines.geometry.dispose();
      (lines.material as THREE.Material).dispose();
    },
    [mesh, lines],
  );

  return (
    <>
      <primitive object={mesh} />
      <primitive object={lines} />
    </>
  );
}

export function Roads() {
  const net = useNetwork();
  useSurfaceUniforms();

  const { asphalt, markings } = useMemo(
    () => ({ asphalt: buildAsphalt(net), markings: buildMarkings(net) }),
    [net],
  );
  const materials = useMemo(() => {
    const paint = makeSurfaceMaterial({ roughness: 0.55 });
    paint.polygonOffsetFactor = -3;
    paint.polygonOffsetUnits = -3;
    paint.emissive.set("#ffffff");
    paint.emissiveIntensity = 0.12;
    return { asphalt: makeSurfaceMaterial({ roughness: 0.92, grain: 0.35 }), paint };
  }, []);
  const showNodes = useMemo(() => new URLSearchParams(window.location.search).get("nodes") === "1", []);

  useEffect(
    () => () => {
      asphalt.dispose();
      markings.dispose();
    },
    [asphalt, markings],
  );
  useEffect(
    () => () => {
      materials.asphalt.dispose();
      materials.paint.dispose();
    },
    [materials],
  );

  return (
    <>
      <mesh geometry={asphalt} material={materials.asphalt} receiveShadow />
      <mesh geometry={markings} material={materials.paint} />
      {showNodes && <NodeDebug net={net} />}
    </>
  );
}
