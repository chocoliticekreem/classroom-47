"use client";
import { useThree } from "@react-three/fiber";
import { useEffect } from "react";

// Debug hook for perf work: window.__city.bench(n) renders n frames synchronously and reports
// ms/frame plus draw calls and triangles. Works even when the tab is hidden (rAF is throttled there).
export function PerfProbe() {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    const w = window as unknown as { __city?: unknown };
    w.__city = {
      gl,
      scene,
      camera,
      bench(n = 20) {
        gl.info.autoReset = false;
        gl.info.reset();
        const t0 = performance.now();
        for (let i = 0; i < n; i++) gl.render(scene, camera);
        const ctx = gl.getContext();
        ctx.finish();
        const ms = (performance.now() - t0) / n;
        const out = { msPerFrame: +ms.toFixed(2), drawCalls: Math.round(gl.info.render.calls / n), triangles: Math.round(gl.info.render.triangles / n), geometries: gl.info.memory.geometries, textures: gl.info.memory.textures, programs: gl.info.programs?.length };
        gl.info.autoReset = true;
        return out;
      },
    };
  }, [gl, scene, camera]);
  return null;
}
