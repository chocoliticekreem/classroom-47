import { afterEach, describe, expect, it } from "vitest";
import { emit, on, type WorldEvent } from "../../bus";
import { allVehicles } from "../../registry";
import { ROAD_EDGES } from "../../roads";
import { useWorld } from "../../store";
import { FleetSim } from "./sim";

function seeded(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

function run(sim: FleetSim, seconds: number, dt = 0.05) {
  for (let t = 0; t < seconds; t += dt) sim.update(dt, sim.now);
}

let sim: FleetSim | null = null;
afterEach(() => {
  sim?.dispose();
  sim = null;
  useWorld.setState({ blocked: {}, incidents: [], deliveries: {}, selectedVehicle: null });
});

describe("FleetSim", () => {
  it("spawns 10 vans + 4 trucks in the registry with deliveries in the store", () => {
    sim = new FleetSim(seeded(1));
    sim.start();
    const mine = [...allVehicles()].filter((v) => v.id.startsWith("V-") || v.id.startsWith("T-"));
    expect(mine.filter((v) => v.kind === "van")).toHaveLength(10);
    expect(mine.filter((v) => v.kind === "truck")).toHaveLength(4);
    const ds = Object.values(useWorld.getState().deliveries);
    expect(ds.length).toBeGreaterThanOrEqual(14 * 3);
    expect(ds.map((d) => d.id)).toContain("DL-1001");
  });

  it("delivers parcels and emits delivery:completed", () => {
    sim = new FleetSim(seeded(2));
    const done: string[] = [];
    const off = on((e) => {
      if (e.type === "delivery:completed") done.push(e.deliveryId);
    });
    sim.start();
    run(sim, 90);
    off();
    expect(done.length).toBeGreaterThan(5);
    const ds = useWorld.getState().deliveries;
    for (const id of done) expect(ds[id].status).toBe("delivered");
  });

  it("never drives through a blocked road it learned about ahead of time", () => {
    sim = new FleetSim(seeded(3));
    sim.start();
    const key = [...ROAD_EDGES.keys()].find((k) => k.includes("g_0_4") && k.includes("h_"))!; // south ramp to the depot
    useWorld.getState().blockEdge(key, "test closure");
    run(sim, 2);
    const entered = new Set<string>();
    for (let t = 0; t < 60; t += 0.05) {
      sim.update(0.05, sim.now);
      for (const v of sim.vans.values()) if (v.phase === "driving" && v.entry.edgeKey === key && v.entry.t > 0.2 && v.entry.t < 0.8) entered.add(v.id);
    }
    expect(entered.size).toBe(0);
  });

  it("breakdown: blocks the road, files an incident, delays parcels, then a replacement takes them", () => {
    sim = new FleetSim(seeded(4));
    const events: WorldEvent[] = [];
    const off = on((e) => events.push(e));
    sim.start();
    run(sim, 5);
    emit({ type: "request:breakdown" });
    const inc = useWorld.getState().incidents.find((i) => i.kind === "breakdown")!;
    expect(inc).toBeTruthy();
    expect(inc.note).toMatch(/^Hamyway City van V-\d+ broke down on /);
    expect(useWorld.getState().blocked[inc.edgeKey]).toBe(inc.note);
    expect(events.some((e) => e.type === "incident:created" && e.incidentId === inc.id)).toBe(true);
    const broken = [...sim.vans.values()].find((v) => v.incidentId === inc.id)!;
    expect(broken.phase).toBe("broken");
    const carried = broken.parcels.map((p) => p.id);
    expect(carried.length).toBeGreaterThan(0);
    for (const id of carried) expect(useWorld.getState().deliveries[id].status).toBe("delayed");
    expect(events.filter((e) => e.type === "delivery:delayed").length).toBeGreaterThanOrEqual(carried.length);

    // a responder clears it
    useWorld.getState().updateIncident(inc.id, { status: "cleared" });
    useWorld.getState().unblockEdge(inc.edgeKey);
    emit({ type: "incident:cleared", incidentId: inc.id });
    run(sim, 3);
    off();
    expect(sim.vans.has(broken.id)).toBe(false);
    const repl = [...sim.vans.values()].find((v) => v.parcels.some((p) => p.id === carried[0]))!;
    expect(repl).toBeTruthy();
    expect(repl.id).not.toBe(broken.id);
    expect(useWorld.getState().deliveries[carried[0]].truckId).toBe(repl.id);
    expect([...sim.vans.values()]).toHaveLength(14);
  });

  it("crash() via the registry stops the van and delays its parcels", () => {
    sim = new FleetSim(seeded(5));
    sim.start();
    run(sim, 3);
    const v = [...sim.vans.values()].find((x) => x.phase === "driving")!;
    expect(v.entry.crash!()).toBe(true);
    expect(v.phase).toBe("crashed");
    expect(v.entry.stopped).toBe(true);
    expect(v.entry.crash!()).toBe(false);
    for (const p of v.parcels) expect(useWorld.getState().deliveries[p.id].status).toBe("delayed");
  });
});
