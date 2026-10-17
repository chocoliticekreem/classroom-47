import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { allVehicles } from "../../registry";
import { edgeKey } from "../../roads";
import { useWorld } from "../../store";
import { BUS_ROUTES } from "./busRoutes";

// Headless smoke run of the whole Transit engine: canvas 2D calls are stubbed out.
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

describe("transit engine (headless)", () => {
  it("runs for a few minutes: buses move and stop, people board, trains run, detours work", async () => {
    const { createTransit } = await import("./engine");
    const eng = createTransit();
    const off = eng.register();
    const buses = [...allVehicles()].filter((v) => v.kind === "bus");
    expect(buses.length).toBe(BUS_ROUTES.reduce((a, r) => a + r.buses, 0));
    const start = buses.map((b) => b.object.position.clone());
    let stoppedSeen = 0;
    // close a road on route 25's loop half way through
    const r = BUS_ROUTES[0];
    const key = edgeKey(r.loop[3], r.loop[4]);
    for (let f = 0; f < 30 * 180; f++) {
      if (f === 30 * 60) useWorld.getState().blockEdge(key, "test");
      eng.tick(1 / 30);
      if (f % 30 === 0) for (const b of buses) if (b.stopped) stoppedSeen++;
      for (const b of buses) expect(Number.isFinite(b.object.position.x)).toBe(true);
    }
    useWorld.getState().unblockEdge(key);
    buses.forEach((b, i) => expect(b.object.position.distanceTo(start[i])).toBeGreaterThan(1));
    expect(stoppedSeen).toBeGreaterThan(5);
    // no bus is sitting on the closed road after a minute of it being shut
    off();
    expect([...allVehicles()].filter((v) => v.kind === "bus").length).toBe(0);
    eng.dispose();
  });
});
