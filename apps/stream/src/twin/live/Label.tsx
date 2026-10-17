"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useId, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { create } from "zustand";

/**
 * DOM labels for things in the scene. <Label> (inside the Canvas) registers an anchor object and
 * content; <LabelHost> (in the DOM overlay) renders them; <LabelLayer> projects them every frame.
 * Replaces drei's <Html>, whose per-label React roots get torn down in React 19 StrictMode and vanish.
 */
interface LabelEntry {
  anchor: THREE.Object3D;
  node: ReactNode;
}

const useLabels = create<{ labels: Map<string, LabelEntry> }>(() => ({ labels: new Map() }));
const elements = new Map<string, HTMLDivElement>();
const _v = new THREE.Vector3();

export function Label({ position, children }: { position: [number, number, number]; children: ReactNode }) {
  const id = useId();
  const anchor = useRef<THREE.Group>(null);
  useEffect(() => {
    if (!anchor.current) return;
    const labels = new Map(useLabels.getState().labels);
    labels.set(id, { anchor: anchor.current, node: children });
    useLabels.setState({ labels });
  }, [id, children]);
  useEffect(
    () => () => {
      const labels = new Map(useLabels.getState().labels);
      labels.delete(id);
      elements.delete(id);
      useLabels.setState({ labels });
    },
    [id],
  );
  return <group ref={anchor} position={position} />;
}

/** Mount once inside the Canvas. */
export function LabelLayer() {
  const { camera, size } = useThree();
  useFrame(() => {
    for (const [id, entry] of useLabels.getState().labels) {
      const el = elements.get(id);
      if (!el) continue;
      entry.anchor.getWorldPosition(_v).project(camera);
      if (_v.z > 1 || !entry.anchor.visible) {
        el.style.display = "none";
        continue;
      }
      const px = (_v.x * 0.5 + 0.5) * size.width;
      const py = (-_v.y * 0.5 + 0.5) * size.height;
      el.style.display = "block";
      el.style.transform = `translate(-50%, -100%) translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`;
    }
  });
  return null;
}

/** Mount once in the DOM overlay, positioned over the canvas. */
export function LabelHost() {
  const labels = useLabels((s) => s.labels);
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 20 }}>
      {Array.from(labels, ([id, entry]) => (
        <div
          key={id}
          ref={(el) => {
            if (el) elements.set(id, el);
            else elements.delete(id);
          }}
          style={{ position: "absolute", left: 0, top: 0, display: "none", willChange: "transform" }}
        >
          {entry.node}
        </div>
      ))}
    </div>
  );
}
