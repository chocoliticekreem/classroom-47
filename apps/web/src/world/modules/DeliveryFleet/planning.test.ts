import { describe, expect, it } from "vitest";
import { DELIVERY_STOPS, PLACES, ROAD_EDGES, getEdge, getNode } from "../../roads";
import { BAYS, etaSeconds, makeIdGen, pickBreakdownVictim, planStops, roadName } from "./planning";

function seeded(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

describe("planStops", () => {
  it("picks distinct stops from the pool", () => {
    for (let s = 1; s < 20; s++) {
      const stops = planStops(4, seeded(s));
      expect(stops).toHaveLength(4);
      expect(new Set(stops).size).toBe(4);
      for (const id of stops) expect(DELIVERY_STOPS).toContain(id);
    }
  });

  it("orders stops as a nearest-neighbour tour from the depot", () => {
    const stops = planStops(5, seeded(7));
    const d = (a: string, b: string) => Math.hypot(getNode(a).x - getNode(b).x, getNode(a).z - getNode(b).z);
    for (const other of stops.slice(1)) expect(d(PLACES.depot, stops[0])).toBeLessThanOrEqual(d(PLACES.depot, other));
  });

  it("caps at the pool size", () => {
    expect(planStops(9, seeded(3), ["farm_n", "farm_s"])).toHaveLength(2);
  });
});

describe("ids", () => {
  it("counts up from the start", () => {
    const next = makeIdGen("DL-", 1001);
    expect([next(), next(), next()]).toEqual(["DL-1001", "DL-1002", "DL-1003"]);
    expect(makeIdGen("V-", 1, 2)()).toBe("V-01");
  });
});

describe("BAYS", () => {
  it("sit on the depot yard road, spaced apart, inside the edge", () => {
    expect(BAYS.length).toBeGreaterThanOrEqual(14);
    for (const b of BAYS) {
      const e = getEdge(b.entry, b.exit)!;
      expect(e).toBeTruthy();
      expect(PLACES.depotBays).toContain(b.entry);
      expect(b.along).toBeGreaterThan(0);
      expect(b.along).toBeLessThan(e.length);
    }
    for (const a of BAYS)
      for (const b of BAYS) if (a !== b) expect(Math.hypot(a.pose.x - b.pose.x, a.pose.z - b.pose.z)).toBeGreaterThanOrEqual(9.9);
  });
});

describe("roadName", () => {
  it("names every edge", () => {
    for (const k of ROAD_EDGES.keys()) expect(roadName(k).length).toBeGreaterThan(2);
  });
  it("is consistent along a downtown street", () => {
    expect(roadName(getEdge("g_0_0", "g_1_0")!.key)).toBe(roadName(getEdge("g_1_0", "g_2_0")!.key));
    expect(roadName(getEdge("g_0_0", "g_0_1")!.key)).not.toBe(roadName(getEdge("g_0_0", "g_1_0")!.key));
  });
});

describe("pickBreakdownVictim", () => {
  it("prefers eligible vans with 3+ parcels", () => {
    const c = [
      { id: "a", parcels: 5, eligible: false },
      { id: "b", parcels: 1, eligible: true },
      { id: "c", parcels: 3, eligible: true },
    ];
    expect(pickBreakdownVictim(c, () => 0.99)!.id).toBe("c");
  });
  it("falls back to any eligible van, else null", () => {
    expect(pickBreakdownVictim([{ id: "b", parcels: 1, eligible: true }])!.id).toBe("b");
    expect(pickBreakdownVictim([{ id: "b", parcels: 0, eligible: true }])).toBeNull();
  });
});

describe("etaSeconds", () => {
  it("adds dwell time per stop", () => {
    expect(etaSeconds(80, 0)).toBe(10);
    expect(etaSeconds(80, 2)).toBe(16);
  });
});
