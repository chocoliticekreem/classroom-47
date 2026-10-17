"use client";
// One InstancedMesh of unit boxes, one draw call for any number of static boxes.
import { useLayoutEffect, useRef } from "react";
import { Euler, InstancedMesh, Matrix4, Quaternion, Vector3 } from "three";
import type { BoxInst } from "./geometry";

const m = new Matrix4();
const p = new Vector3();
const q = new Quaternion();
const s = new Vector3();
const e = new Euler();

export function setBoxMatrix(mesh: InstancedMesh, i: number, b: BoxInst, scaleY = 1) {
  p.set(b.x, b.y - (b.sy * (1 - scaleY)) / 2, b.z);
  q.setFromEuler(e.set(0, b.rotY, 0));
  s.set(b.sx, Math.max(1e-3, b.sy * scaleY), b.sz);
  mesh.setMatrixAt(i, m.compose(p, q, s));
}

interface Props {
  boxes: BoxInst[];
  color: string;
  roughness?: number;
  metalness?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
}

export function Boxes({ boxes, color, roughness = 0.8, metalness = 0, castShadow, receiveShadow = true }: Props) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    boxes.forEach((b, i) => setBoxMatrix(mesh, i, b));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [boxes]);
  if (!boxes.length) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, boxes.length]} castShadow={castShadow} receiveShadow={receiveShadow}>
      <boxGeometry />
      <meshStandardMaterial color={color} roughness={roughness} metalness={metalness} flatShading />
    </instancedMesh>
  );
}
