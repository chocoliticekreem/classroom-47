import { describe, expect, it } from "vitest";
import { edgeKey, getEdge, lanePosition } from "../../roads";
import { BUS_ROUTES, LoopNavigator, expandGridLoop, lanePose, planDetour, type Pose } from "./busRoutes";

describe("bus routes", () => {
  it("expands grid corners into a closed loop of adjacent nodes", () => {
    const loop = expandGridLoop([[0, 0], [2, 0], [2, 1], [0, 1]]);
    expect(loop).toEqual(["g_0_0", "g_1_0", "g_2_0", "g_2_1", "g_1_1", "g_0_1"]);
  });

  it("has 3 routes, each a closed loop over real roads with ~8 stops on loop edges", () => {
    expect(BUS_ROUTES.map((r) => r.number)).toEqual(["25", "73", "390"]);
    for (const r of BUS_ROUTES) {
      const n = r.loop.length;
      for (let i = 0; i < n; i++) expect(getEdge(r.loop[i], r.loop[(i + 1) % n]), `${r.number} ${r.loop[i]}`).toBeDefined();
      expect(new Set(r.loop).size).toBe(n);
      expect(r.stops.length).toBeGreaterThanOrEqual(7);
      expect(r.stops.length).toBeLessThanOrEqual(9);
      for (const s of r.stops) {
        expect(r.loop[s.loopIdx]).toBe(s.from);
        expect(r.loop[(s.loopIdx + 1) % n]).toBe(s.to);
        expect(getEdge(s.from, s.to)!.kind).toBe("street");
      }
    }
  });

  it("route 390 goes out to the suburbs via the ring", () => {
    const r = BUS_ROUTES.find((x) => x.number === "390")!;
    expect(r.loop.some((id) => id.startsWith("sub_"))).toBe(true);
    expect(r.loop.some((id) => id.startsWith("h_"))).toBe(true);
    expect(r.stops.some((s) => s.from.startsWith("sub_"))).toBe(true);
  });
});

describe("detours", () => {
  const r = BUS_ROUTES[0];
  it("finds a path around a blocked loop edge to the next stop and rejoins the loop there", () => {
    const idx = 0;
    const blocked = new Set([edgeKey(r.loop[0], r.loop[1])]);
    const d = planDetour(r.loop, idx, r.loop[0], r.stops, blocked)!;
    expect(d).not.toBeNull();
    expect(d.path[d.path.length - 1]).toBe(r.loop[d.rejoin]);
    let prev = r.loop[0];
    for (const id of d.path) {
      expect(blocked.has(edgeKey(prev, id))).toBe(false);
      prev = id;
    }
  });

  it("navigator follows the loop, detours round a block, then rejoins", () => {
    const nav = new LoopNavigator(r.loop, r.stops, 0);
    const blocked = new Set<string>();
    expect(nav.chooseNext(blocked)).toBe(r.loop[1]);
    nav.arrive(r.loop[1]);
    expect(nav.onLoop).toBe(true);
    // block the next loop edge
    blocked.add(edgeKey(r.loop[1], r.loop[2]));
    const first = nav.chooseNext(blocked)!;
    expect(first).not.toBe(r.loop[2]);
    expect(nav.onLoop).toBe(false);
    let guard = 0;
    let cur = first;
    while (!nav.onLoop && guard++ < 50) {
      nav.arrive(cur);
      if (nav.onLoop) break;
      cur = nav.chooseNext(blocked)!;
      expect(cur).not.toBeNull();
    }
    expect(nav.onLoop).toBe(true);
    expect(nav.at).toBe(r.loop[nav.idx]);
  });

  it("u-turns back to the previous node and replans", () => {
    const nav = new LoopNavigator(r.loop, r.stops, 0);
    const blocked = new Set<string>();
    nav.chooseNext(blocked);
    blocked.add(edgeKey(r.loop[0], r.loop[1]));
    nav.uTurn(r.loop[0]);
    expect(nav.target).toBe(r.loop[0]);
    nav.arrive(r.loop[0]);
    const nxt = nav.chooseNext(blocked);
    expect(nxt).not.toBeNull();
    expect(nxt).not.toBe(r.loop[1]);
  });
});

describe("lanePose", () => {
  const out: Pose = { x: 0, z: 0, h: 0 };
  it("matches lanePosition on straight sections", () => {
    lanePose(null, "g_0_0", "g_1_0", "g_2_0", 0.5, 6, out);
    const [x, z, h] = lanePosition("g_0_0", "g_1_0", 0.5);
    expect(out.x).toBeCloseTo(x);
    expect(out.z).toBeCloseTo(z);
    expect(out.h).toBeCloseTo(h);
  });
  it("is continuous through a corner", () => {
    const a: Pose = { x: 0, z: 0, h: 0 };
    lanePose("g_-1_0", "g_0_0", "g_1_0", "g_1_1", 0.9999, 6, a);
    const b: Pose = { x: 0, z: 0, h: 0 };
    lanePose("g_0_0", "g_1_0", "g_1_1", "g_1_2", 0.0001, 6, b);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(0.05);
  });
});
