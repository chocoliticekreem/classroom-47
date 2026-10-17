import { describe, expect, it } from "vitest";
import { PLACES, ROAD_EDGES, edgeKey, findPath, getEdge } from "../../roads";
import {
  ACTIVE_MAX_S,
  ACTIVE_MIN_S,
  DEPLOY_S,
  FIRST_SPAWN_S,
  MAX_CONCURRENT,
  PACK_S,
  SPAWN_INTERVAL_S,
  advanceRoute,
  chooseTarget,
  createJobClock,
  createScheduler,
  needsRepath,
  planOutbound,
  planReturn,
  roadName,
  schedulerDue,
  siteLayout,
  stepJob,
  targetWeight,
  type Route,
} from "./logic";

const YARD = PLACES.maintenanceYard;

function seeded(seed: number) {
  // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function expectContiguous(route: Route) {
  for (let i = 1; i < route.nodes.length; i++) expect(getEdge(route.nodes[i - 1], route.nodes[i]), route.nodes.join(">")).toBeDefined();
}

describe("scheduler", () => {
  it("fires first at ~15 s then every ~70 s", () => {
    const s = createScheduler();
    expect(schedulerDue(s, FIRST_SPAWN_S - 1, 0)).toBe(false);
    expect(schedulerDue(s, FIRST_SPAWN_S, 0)).toBe(true);
    expect(schedulerDue(s, FIRST_SPAWN_S + 1, 1)).toBe(false);
    expect(schedulerDue(s, FIRST_SPAWN_S + SPAWN_INTERVAL_S - 1, 1)).toBe(false);
    expect(schedulerDue(s, FIRST_SPAWN_S + SPAWN_INTERVAL_S, 1)).toBe(true);
  });

  it("postpones while the max number of crews are out", () => {
    const s = createScheduler();
    expect(schedulerDue(s, FIRST_SPAWN_S, MAX_CONCURRENT)).toBe(false);
    expect(schedulerDue(s, FIRST_SPAWN_S + 1, 0)).toBe(false);
    expect(schedulerDue(s, FIRST_SPAWN_S + 10, 0)).toBe(true);
  });
});

describe("target choice", () => {
  it("prefers highway and central downtown streets, never quiet zone roads", () => {
    const highway = [...ROAD_EDGES.values()].find((e) => e.kind === "highway")!;
    expect(targetWeight(highway)).toBeGreaterThan(0);
    expect(targetWeight(getEdge("g_0_0", "g_1_0")!)).toBeGreaterThan(targetWeight(getEdge("g_-4_3", "g_-4_2")!));
    expect(targetWeight(getEdge("dock_gate", "dock_n")!)).toBe(0);
    expect(targetWeight(getEdge("depot_gate", "depot_yard_w")!)).toBe(0);
  });

  it("never picks blocked, excluded or yard roads, and the road can be bypassed", () => {
    const blocked = new Set([edgeKey("g_0_0", "g_1_0"), edgeKey("g_1_1", "g_1_2")]);
    const exclude = new Set([edgeKey("g_0_1", "g_1_1")]);
    for (let seed = 1; seed < 80; seed++) {
      const key = chooseTarget({ from: YARD, blocked, exclude, rand: seeded(seed) });
      expect(key).not.toBeNull();
      const e = ROAD_EDGES.get(key!)!;
      expect(blocked.has(key!)).toBe(false);
      expect(exclude.has(key!)).toBe(false);
      expect([e.a, e.b]).not.toContain(YARD);
      expect(targetWeight(e)).toBeGreaterThan(0);
      const bl = new Set([...blocked, key!]);
      expect(findPath(e.a, e.b, bl)).not.toBeNull();
    }
  });

  it("spreads choices around (not always the same road)", () => {
    const picks = new Set<string>();
    for (let seed = 1; seed < 40; seed++) picks.add(chooseTarget({ from: YARD, blocked: new Set(), exclude: new Set(), rand: seeded(seed) })!);
    expect(picks.size).toBeGreaterThan(10);
  });
});

describe("routes", () => {
  it("plans from the yard to the midpoint of the target without using the target early", () => {
    const key = edgeKey("g_0_0", "g_1_0");
    const r = planOutbound(key, YARD, new Set())!;
    expect(r.nodes[0]).toBe(YARD);
    expect(r.endT).toBe(0.5);
    expectContiguous(r);
    const last = edgeKey(r.nodes[r.nodes.length - 2], r.nodes[r.nodes.length - 1]);
    expect(last).toBe(key);
    for (let i = 1; i < r.nodes.length - 1; i++) expect(edgeKey(r.nodes[i - 1], r.nodes[i])).not.toBe(key);
  });

  it("avoids blocked roads on the way out", () => {
    const blocked = new Set([edgeKey("g_-4_-4", "g_-3_-4")]);
    const r = planOutbound(edgeKey("g_0_0", "g_1_0"), YARD, blocked)!;
    for (let i = 1; i < r.nodes.length; i++) expect(blocked.has(edgeKey(r.nodes[i - 1], r.nodes[i]))).toBe(false);
  });

  it("advances along a route and arrives at endT", () => {
    const r: Route = { nodes: ["g_0_0", "g_1_0", "g_2_0"], endT: 0.5 };
    const c = { seg: 0, t: 0 };
    expect(advanceRoute(r, c, 30)).toBe(false);
    expect(c.seg).toBe(0);
    expect(c.t).toBeCloseTo(0.75);
    expect(advanceRoute(r, c, 20)).toBe(false);
    expect(c.seg).toBe(1);
    expect(c.t).toBeCloseTo(0.25);
    expect(advanceRoute(r, c, 100)).toBe(true);
    expect(c).toEqual({ seg: 1, t: 0.5 });
  });

  it("returns to the yard carrying on through the site", () => {
    const key = edgeKey("g_0_0", "g_1_0");
    const out = planOutbound(key, YARD, new Set())!;
    const a = out.nodes[out.nodes.length - 2];
    const b = out.nodes[out.nodes.length - 1];
    const ret = planReturn(a, b, YARD, new Set())!;
    expect(ret.route.nodes.slice(0, 2)).toEqual([a, b]);
    expect(ret.cursor).toEqual({ seg: 0, t: 0.5 });
    expect(ret.route.nodes[ret.route.nodes.length - 1]).toBe(YARD);
    expect(ret.route.endT).toBe(1);
    expectContiguous(ret.route);
  });

  it("detects a blocked road further along the route", () => {
    const r: Route = { nodes: ["g_0_0", "g_1_0", "g_2_0", "g_3_0"], endT: 1 };
    const blocked = new Set([edgeKey("g_2_0", "g_3_0")]);
    expect(needsRepath(r, { seg: 0, t: 0.2 }, blocked)).toBe(true);
    expect(needsRepath(r, { seg: 2, t: 0.2 }, blocked)).toBe(false); // already on it
    expect(needsRepath(r, { seg: 0, t: 0.2 }, blocked, edgeKey("g_2_0", "g_3_0"))).toBe(false); // own target
  });
});

describe("job state machine", () => {
  it("runs outbound -> deploying -> active -> packing -> returning -> done", () => {
    const j = createJobClock(seeded(3));
    expect(j.activeFor).toBeGreaterThanOrEqual(ACTIVE_MIN_S);
    expect(j.activeFor).toBeLessThanOrEqual(ACTIVE_MAX_S);
    expect(stepJob(j, 1, false)).toEqual([]);
    expect(j.phase).toBe("outbound");
    expect(stepJob(j, 0.1, true)).toEqual(["arrived"]);
    expect(j.phase).toBe("deploying");
    expect(stepJob(j, DEPLOY_S - 0.5, false)).toEqual([]);
    expect(stepJob(j, 1, false)).toEqual(["close_road"]);
    expect(j.phase).toBe("active");
    expect(stepJob(j, j.activeFor - 1, false)).toEqual([]);
    expect(stepJob(j, 1.5, false)).toEqual(["start_packing"]);
    expect(j.phase).toBe("packing");
    expect(stepJob(j, PACK_S + 0.1, false)).toEqual(["reopen_road"]);
    expect(j.phase).toBe("returning");
    expect(stepJob(j, 1, false)).toEqual([]);
    expect(stepJob(j, 1, true)).toEqual(["despawn"]);
    expect(j.phase).toBe("done");
    expect(stepJob(j, 1, true)).toEqual([]);
  });
});

describe("road names and site layout", () => {
  it("names roads", () => {
    expect(roadName(edgeKey("g_0_0", "g_1_0"))).toMatch(/St|Rd|Strand|Holborn|Ln/);
    expect(roadName(edgeKey("g_0_0", "g_0_1"))).not.toBe(roadName(edgeKey("g_0_0", "g_1_0")));
    const hw = [...ROAD_EDGES.values()].find((e) => e.kind === "highway")!;
    expect(roadName(hw.key).length).toBeGreaterThan(3);
    for (const e of ROAD_EDGES.values()) expect(roadName(e.key)).toBeTruthy();
  });

  it("lays out cones, barriers and signs within the road segment", () => {
    for (const len of [40, 61, 110]) {
      const items = siteLayout(len);
      expect(items.filter((i) => i.kind === "sign")).toHaveLength(2);
      expect(items.filter((i) => i.kind === "barrier").length).toBeGreaterThanOrEqual(4);
      expect(items.filter((i) => i.kind === "cone").length).toBeGreaterThan(10);
      for (const it of items) {
        expect(Math.abs(it.s)).toBeLessThanOrEqual(len / 2 - 3);
        expect(Math.abs(it.left)).toBeLessThanOrEqual(4);
      }
    }
  });
});
