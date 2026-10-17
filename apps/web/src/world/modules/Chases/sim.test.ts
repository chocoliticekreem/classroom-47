// Headless end-to-end run of the chase simulation (three.js objects, no renderer): every ending must
// play out to "done" without errors, and a crash ending must open (and leave) a car_crash incident.
import { describe, expect, it, vi } from "vitest";

// minimal canvas stub for the CanvasTexture liveries
const ctx = new Proxy({}, { get: (_t, k) => (k === "createRadialGradient" ? () => ({ addColorStop() {} }) : () => {}), set: () => true });
(globalThis as unknown as { document: unknown }).document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
};

describe("ChaseSim (headless)", () => {
  it("runs pursuits, races and cameras end to end", async () => {
    const warn = vi.spyOn(console, "warn");
    const { ChaseSim } = await import("./sim");
    const { useWorld } = await import("../../store");
    const { allVehicles } = await import("../../registry");
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const endings = new Set<string>();
    let flashes = 0;
    for (let run = 0; run < 8; run++) {
      useWorld.setState({ timeOfDay: run % 2 ? 22 : 12, incidents: [], blocked: {} });
      const sim = new ChaseSim();
      sim.start();
      sim.triggerChase();
      sim.triggerRace();
      const s = sim as unknown as { chase: { phase: string; ending: string } | null; cams: { flashT: number }[] };
      let ending = "";
      for (let i = 0; i < 60 * 150 && (s.chase || i < 10); i++) {
        now += 1000 / 60;
        sim.step(1 / 60);
        if (s.chase) ending = s.chase.ending;
        for (const c of s.cams) if (c.flashT === 0) flashes++;
        for (const v of allVehicles()) expect(Number.isFinite(v.object.position.x + v.object.position.z)).toBe(true);
      }
      expect(s.chase).toBeNull(); // finished
      endings.add(ending);
      const incidents = useWorld.getState().incidents.filter((i) => i.kind === "car_crash");
      if (ending === "crash") expect(incidents.length).toBe(1);
      else expect(incidents.length).toBe(0);
      sim.stop();
    }
    expect(endings.size).toBeGreaterThan(1);
    expect(flashes).toBeGreaterThan(0);
    expect(warn).not.toHaveBeenCalled();
  }, 120000);
});
