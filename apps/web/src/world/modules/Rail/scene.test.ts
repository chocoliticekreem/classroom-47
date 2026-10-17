// Smoke test: the whole railway scene builds and ticks without a browser (canvas is stubbed), stays within
// the draw-call budget, has no NaN transforms, and the level crossing closes and reopens its road.
import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { useWorld } from "../../store";

beforeAll(() => {
  const ctx = new Proxy(
    {},
    {
      get: (_t, k) => (k === "measureText" ? () => ({ width: 10 }) : () => undefined),
      set: () => true,
    },
  );
  (globalThis as unknown as { document: unknown }).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
  };
});

describe("railway scene", () => {
  it("builds, ticks, and stays within budget", async () => {
    const { createRail } = await import("./engine");
    const rail = createRail();
    const drawables = rail.meshes.filter((m) => m instanceof THREE.Mesh || m instanceof THREE.LineSegments);
    expect(drawables.length).toBeLessThanOrEqual(150);
    for (let i = 0; i < 120; i++) rail.tick(0.1);
    for (const m of rail.meshes) {
      if (!(m instanceof THREE.InstancedMesh)) continue;
      const arr = m.instanceMatrix.array as Float32Array;
      for (let k = 0; k < m.count * 16; k++) expect(Number.isFinite(arr[k])).toBe(true);
    }
    rail.dispose();
  });

  it("closes the crossing's road while a train passes and reopens it", async () => {
    const { createRail } = await import("./engine");
    const { LINES } = await import("./network");
    const lc = LINES.flatMap((l) => l.levelCrossings)[0];
    useWorld.setState({ blocked: {}, paused: false });
    const rail = createRail();
    let sawClosed = false;
    let sawOpenAfter = false;
    for (let i = 0; i < 3000; i++) {
      rail.tick(0.1);
      const closed = lc.edges.every((e) => useWorld.getState().blocked[e] === "Level crossing closed");
      if (closed) sawClosed = true;
      else if (sawClosed && !lc.edges.some((e) => e in useWorld.getState().blocked)) sawOpenAfter = true;
    }
    expect(sawClosed).toBe(true);
    expect(sawOpenAfter).toBe(true);
    rail.dispose();
    for (const e of lc.edges) expect(useWorld.getState().blocked[e]).toBeUndefined();
  });
});
