import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getEdge, lanePosition } from "../../roads";
import { obstacleAt, type ObstacleFn } from "../DeliveryFleet/lookahead";

// Headless engine (canvas 2D stubbed), with the look-ahead raycast mocked.
const ctx: unknown = new Proxy(
  {},
  {
    get: (_t, p) => (p === "measureText" ? () => ({ width: 10 }) : () => undefined),
    set: () => true,
  },
);
beforeAll(() => {
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
  };
});
afterAll(() => {
  delete (globalThis as { document?: unknown }).document;
});

describe("bus look-ahead braking", () => {
  it("a bus with an obstacle reported ahead decelerates to a stop short of it", async () => {
    const { createTransit } = await import("./engine");
    let current: ObstacleFn = () => null;
    const eng = createTransit({ obstacleFn: (...a) => current(...a) });
    const off = eng.register();
    try {
      const dt = 1 / 30;
      let pick: ReturnType<typeof eng.busState>[number] | null = null;
      for (let f = 0; f < 30 * 120 && !pick; f++) {
        eng.tick(dt);
        for (const b of eng.busState()) {
          const len = b.to ? (getEdge(b.from, b.to)?.length ?? 0) : 0;
          if (b.to && b.mode === 0 && !b.crashed && !b.stopAhead && b.v > 3 && (1 - b.t) * len > 50) {
            pick = b;
            break;
          }
        }
      }
      expect(pick).not.toBeNull();
      const len = getEdge(pick!.from, pick!.to!)!.length;
      const [ox, oz] = lanePosition(pick!.from, pick!.to!, pick!.t + 32 / len);
      current = obstacleAt(pick!.id, ox, oz);
      const me = () => eng.busState().find((b) => b.id === pick!.id)!;
      let minDist = Infinity;
      let stoppedNear = false;
      for (let f = 0; f < 30 * 40 && !stoppedNear; f++) {
        eng.tick(dt);
        const b = me();
        const d = Math.hypot(ox - b.x, oz - b.z);
        minDist = Math.min(minDist, d);
        if (b.v < 0.05 && b.mode === 0 && d < 5.2 + 2.2 + 2 + 1.5) stoppedNear = true; // half bus + obstacle + standoff
      }
      expect(stoppedNear).toBe(true);
      expect(minDist).toBeGreaterThan(5.2 + 2.2 + 0.5);
    } finally {
      off();
      eng.dispose();
    }
  });
});
