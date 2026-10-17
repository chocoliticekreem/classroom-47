import { describe, expect, it } from "vitest";
import { ROAD_EDGES, ROAD_NODES, edgeKey, getEdge, getNode, lanePosition, neighbours } from "../../roads";
import {
  FREIGHT_NODES,
  HIGHWAY_NODES,
  IDM,
  isJunction,
  lateralOf,
  pathPointAhead,
  shouldYield,
  turnSpeed,
  advance,
  blockageT,
  idmAccel,
  laneObstacle,
  needsReroute,
  pickDestination,
  poseAt,
  replanPath,
  signalDecision,
  smoothPose,
  turnSide,
  uturnPose,
  type Pose,
} from "./driving";

const pose = (): Pose => ({ x: 0, z: 0, h: 0 });
const dist = (a: Pose, b: Pose) => Math.hypot(a.x - b.x, a.z - b.z);

describe("idmAccel", () => {
  it("accelerates on a free road and settles at the limit", () => {
    expect(idmAccel(0, 11, Infinity, 0)).toBeCloseTo(IDM.aMax);
    expect(Math.abs(idmAccel(11, 11, Infinity, 0))).toBeLessThan(0.01);
  });
  it("brakes when closing on a stopped obstacle", () => {
    expect(idmAccel(11, 11, 10, 11)).toBeLessThan(-3);
  });
  it("never exceeds the hard braking limit", () => {
    expect(idmAccel(22, 22, 0.1, 22)).toBeGreaterThanOrEqual(-9);
  });
  it("slows gently (not violently) when entering a slower road", () => {
    const a = idmAccel(22, 11, Infinity, 0);
    expect(a).toBeLessThan(0);
    expect(a).toBeGreaterThan(-4);
  });
  it("holds still when stopped right behind something", () => {
    expect(idmAccel(0, 11, IDM.s0, 0)).toBeLessThanOrEqual(0.01);
  });
});

describe("advance", () => {
  const path = ["g_0_0", "g_1_0", "g_2_0"];
  it("moves along an edge", () => {
    const s = { path, idx: 0, t: 0 };
    expect(advance(s, 10)).toBe(0);
    expect(s.t).toBeCloseTo(0.25);
  });
  it("crosses onto the next edge and reports it", () => {
    const s = { path, idx: 0, t: 0.9 };
    expect(advance(s, 8)).toBe(1);
    expect(s.idx).toBe(1);
    expect(s.t).toBeCloseTo(4 / 40);
  });
  it("stops at the end of the path", () => {
    const s = { path, idx: 1, t: 0.9 };
    advance(s, 100);
    expect(s.idx).toBe(1);
    expect(s.t).toBe(1);
  });
});

describe("poseAt", () => {
  it("matches lanePosition mid-edge", () => {
    const p = poseAt(["g_0_0", "g_1_0", "g_1_1"], 0, 0.5, pose());
    const [x, z, h] = lanePosition("g_0_0", "g_1_0", 0.5);
    expect(p.x).toBeCloseTo(x);
    expect(p.z).toBeCloseTo(z);
    expect(p.h).toBeCloseTo(h);
  });
  it("is continuous along a turn, including across the node", () => {
    const path = ["g_0_0", "g_1_0", "g_1_1"];
    const len = 40;
    let prev = poseAt(path, 0, 0.5, pose());
    for (let s = 20.25; s < 60; s += 0.25) {
      const idx = s < len ? 0 : 1;
      const t = s < len ? s / len : (s - len) / len;
      const p = poseAt(path, idx, t, pose());
      expect(dist(p, prev)).toBeLessThan(0.6);
      prev = p;
    }
  });
  it("turns the heading through the junction", () => {
    const path = ["g_0_0", "g_1_0", "g_1_1"];
    const before = poseAt(path, 0, 0.5, pose()).h;
    const after = poseAt(path, 1, 0.5, pose()).h;
    const mid = poseAt(path, 0, 1, pose()).h;
    expect(Math.abs(after - before)).toBeCloseTo(Math.PI / 2);
    expect(mid).not.toBeCloseTo(before, 1);
    expect(mid).not.toBeCloseTo(after, 1);
  });
  it("handles a U-turn at a node without jumping", () => {
    const path = ["g_0_0", "g_1_0", "g_0_0"];
    let prev = poseAt(path, 0, 0.8, pose());
    for (let s = 32.25; s < 48; s += 0.25) {
      const p = s < 40 ? poseAt(path, 0, s / 40, pose()) : poseAt(path, 1, (s - 40) / 40, pose());
      expect(dist(p, prev)).toBeLessThan(0.8);
      prev = p;
    }
  });
});

describe("turnSide", () => {
  it("detects left, right and straight (heading +x then -z is a left turn)", () => {
    // travelling east (+x), left is -z
    expect(turnSide("g_0_0", "g_1_0", "g_1_-1")).toBe(1);
    expect(turnSide("g_0_0", "g_1_0", "g_1_1")).toBe(-1);
    expect(turnSide("g_0_0", "g_1_0", "g_2_0")).toBe(0);
  });
});

describe("rerouting", () => {
  const path = ["g_0_0", "g_1_0", "g_2_0", "g_3_0"];
  it("flags a blocked edge later on the path", () => {
    expect(needsReroute(path, 0, new Set([edgeKey("g_2_0", "g_3_0")]))).toBe(true);
    expect(needsReroute(path, 0, new Set([edgeKey("g_0_0", "g_1_0")]))).toBe(false); // current edge handled separately
    expect(needsReroute(path, 0, new Set())).toBe(false);
  });
  it("replans from the end of the current edge, keeping the edge it is on", () => {
    const blocked = new Set([edgeKey("g_1_0", "g_2_0")]);
    const r = replanPath(path, 0, "g_3_0", blocked)!;
    expect(r.path[0]).toBe("g_0_0");
    expect(r.path[1]).toBe("g_1_0");
    expect(r.path.at(-1)).toBe("g_3_0");
    expect(needsReroute(r.path, r.idx, blocked)).toBe(false);
  });
  it("keeps the previous node so turn blending survives a replan", () => {
    const r = replanPath(path, 1, "g_3_0", new Set([edgeKey("g_2_0", "g_3_0")]))!;
    expect(r.idx).toBe(1);
    expect(r.path.slice(0, 3)).toEqual(["g_0_0", "g_1_0", "g_2_0"]);
  });
  it("prefers not to U-turn at the node", () => {
    const r = replanPath(["g_0_0", "g_1_0"], 0, "g_0_1", new Set())!;
    expect(r.path[2]).not.toBe("g_0_0");
  });
});

describe("laneObstacle", () => {
  const path = ["g_0_0", "g_1_0", "g_2_0"];
  it("finds the leader on the same edge", () => {
    const o = laneObstacle(path, 0, 0.25, 2, (f, t) => (f === "g_0_0" && t === "g_1_0" ? { t: 0.75, speed: 3, half: 2 } : null));
    expect(o.gap).toBeCloseTo(20 - 4);
    expect(o.speed).toBe(3);
  });
  it("looks onto the next edge", () => {
    const o = laneObstacle(path, 0, 0.5, 2, (f) => (f === "g_1_0" ? { t: 0.25, speed: 0, half: 2 } : null));
    expect(o.gap).toBeCloseTo(20 + 10 - 4);
  });
  it("is infinite when the road is clear", () => {
    expect(laneObstacle(path, 0, 0.5, 2, () => null).gap).toBe(Infinity);
  });
});

describe("signalDecision", () => {
  it("goes on green, stops on red", () => {
    expect(signalDecision("green", 20, 11, false)).toBe("go");
    expect(signalDecision("red", 20, 11, false)).toBe("stop");
  });
  it("on amber stops when there is room, commits when too close", () => {
    expect(signalDecision("amber", 30, 11, false)).toBe("stop");
    expect(signalDecision("amber", 3, 11, false)).toBe("commit");
  });
  it("ignores the light once committed or past the line", () => {
    expect(signalDecision("red", 2, 11, true)).toBe("go");
    expect(signalDecision("red", -2, 5, false)).toBe("go");
  });
});

describe("blockageT", () => {
  it("projects a point onto a directed edge", () => {
    expect(blockageT("g_0_0", "g_1_0", 10, 0)).toBeCloseTo(0.25);
    expect(blockageT("g_1_0", "g_0_0", 10, 0)).toBeCloseTo(0.75);
  });
});

describe("uturnPose", () => {
  it("starts at the start pose and ends at the end pose facing back", () => {
    const a: Pose = { x: 0, z: 0, h: 0 };
    const b: Pose = { x: 4, z: 0, h: Math.PI };
    const p0 = uturnPose(a, b, 0, pose());
    const p1 = uturnPose(a, b, 1, pose());
    expect(dist(p0, a)).toBeCloseTo(0);
    expect(dist(p1, b)).toBeCloseTo(0);
    expect(Math.cos(p1.h)).toBeCloseTo(-1);
  });
});

describe("smoothPose", () => {
  it("absorbs a teleport and then converges", () => {
    const off = { x: 0, z: 0, h: 0 };
    const out = pose();
    smoothPose({ x: 0, z: 0, h: 0 }, { x: 10, z: 0, h: 0 }, off, 1 / 60, 0.5, out);
    expect(out.x).toBeLessThanOrEqual(0.5 + 1e-9);
    let p: Pose = { ...out };
    for (let i = 0; i < 120; i++) {
      smoothPose(p, { x: 10, z: 0, h: 0 }, off, 1 / 60, 0.5, out);
      expect(dist(out, p)).toBeLessThan(0.6);
      p = { ...out };
    }
    expect(out.x).toBeGreaterThan(9.5);
  });
});

describe("pickDestination", () => {
  it("sends lorries to highway or freight nodes", () => {
    for (let i = 0; i < 60; i++) {
      const d = pickDestination("hgv", "h_3", Math.random);
      expect(HIGHWAY_NODES.has(d) || FREIGHT_NODES.has(d), d).toBe(true);
    }
  });
  it("never returns the current node", () => {
    for (let i = 0; i < 30; i++) {
      const d = pickDestination("cab", "g_0_0", Math.random);
      expect(d).not.toBe("g_0_0");
    }
  });
  it("never sends cars into the depot yard", () => {
    for (let i = 0; i < 100; i++) expect(pickDestination("hatch", "g_0_0", Math.random)).not.toMatch(/^depot/);
  });
  it("prefers local trips (mostly within 900 m)", () => {
    let near = 0;
    for (let i = 0; i < 100; i++) {
      const d = getNode(pickDestination("saloon", "g_0_0", Math.random));
      if (Math.hypot(d.x, d.z) <= 900) near++;
    }
    expect(near).toBeGreaterThan(90);
  });
  it("edge lengths are known for the default grid", () => {
    expect(getEdge("g_0_0", "g_1_0")!.length).toBe(40);
  });
});

describe("turnSpeed", () => {
  it("is the limit when going straight, slow for a right angle, crawl for a U-turn", () => {
    expect(turnSpeed("g_0_0", "g_1_0", "g_2_0", 11)).toBe(11);
    const right = turnSpeed("g_0_0", "g_1_0", "g_1_1", 11);
    expect(right).toBeGreaterThan(4);
    expect(right).toBeLessThan(7.5);
    expect(turnSpeed("g_0_0", "g_1_0", "g_0_0", 11)).toBeLessThanOrEqual(3.5);
  });
});

describe("isJunction", () => {
  it("is true where three or more roads meet", () => {
    expect(isJunction("g_0_0")).toBe(true);
    const quiet = [...ROAD_NODES.keys()].find((id) => neighbours(id).length < 3)!;
    expect(isJunction(quiet)).toBe(false);
  });
});

describe("beam helpers", () => {
  it("lateralOf: left is positive (heading +z, left is +x)", () => {
    // heading 0 faces +z; with x to the right on screen... sign convention: (dz*sin h - dx*cos h)
    expect(lateralOf(0, 0, 0, 3, 0)).toBeCloseTo(-3);
    expect(lateralOf(0, 0, 0, -3, 0)).toBeCloseTo(3);
  });
  it("shouldYield is antisymmetric: exactly one of two conflicting vehicles yields", () => {
    const cases: [number, number, number, number, number, number][] = [
      [0, 0, 0, 5, 5, -Math.PI / 2], // perpendicular
      [0, 0, 0, -5, 5, Math.PI / 2],
      [0, 0, 0, 1, 10, Math.PI], // head-on, offset
      [0, 0, 0, 0, 6, 0], // same direction
      [2, -3, 0.4, -4, 2, 2.2],
    ];
    for (const [x, z, h, ox, oz, oh] of cases) {
      const a = shouldYield(x, z, h, "a", ox, oz, oh, "b");
      const b = shouldYield(ox, oz, oh, "b", x, z, h, "a");
      expect(a).not.toBe(b);
    }
  });
  it("pathPointAhead walks along the path and reports overflow at its end", () => {
    const e = [...ROAD_EDGES.values()].find((x) => x.length > 30)!;
    const out = { x: 0, z: 0, h: 0 };
    expect(pathPointAhead([e.a, e.b], 0, 0, 10, out)).toBe(0);
    const p0 = { x: 0, z: 0, h: 0 };
    pathPointAhead([e.a, e.b], 0, 0, 0, p0);
    expect(Math.hypot(out.x - p0.x, out.z - p0.z)).toBeCloseTo(10, 1);
    expect(pathPointAhead([e.a, e.b], 0, 0.5, e.length, out)).toBeCloseTo(e.length / 2, 3);
  });
});
