import { describe, expect, it } from "vitest";
import { edgeKey, getNode, ROAD_EDGES } from "../../roads";
import { signalFor } from "../../signals";
import {
  crashNote,
  directionWord,
  findRearEnd,
  findSolo,
  pickJunction,
  pickPileupRun,
  pickScriptedEdge,
  roadName,
  type Candidate,
} from "./director";

const v = (id: string, kind: Candidate["kind"], from: string, to: string, t: number, speed = 8, stopped = false): Candidate => ({
  id,
  kind,
  from,
  to,
  t,
  speed,
  stopped,
  edgeKey: edgeKey(from, to),
});

describe("findRearEnd", () => {
  it("finds two moving cars close together on the same directed lane, rear first", () => {
    const pair = findRearEnd([v("a", "car", "g_0_0", "g_1_0", 0.5), v("b", "taxi", "g_0_0", "g_1_0", 0.6)], {
      blocked: new Set(),
      kind: "car_crash",
    });
    expect(pair?.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("ignores opposite lanes, far apart vehicles, stopped vehicles and emergency vehicles", () => {
    const none = findRearEnd(
      [
        v("a", "car", "g_0_0", "g_1_0", 0.5),
        v("b", "car", "g_1_0", "g_0_0", 0.5), // opposite direction
        v("c", "car", "g_0_0", "g_1_0", 0.95), // 18 m ahead of a: too far
        v("d", "police", "g_0_0", "g_1_0", 0.55),
        v("e", "car", "g_0_0", "g_1_0", 0.52, 0, true),
      ],
      { blocked: new Set() },
    );
    expect(none).toBeNull();
  });

  it("skips blocked edges", () => {
    const pair = findRearEnd([v("a", "car", "g_0_0", "g_1_0", 0.5), v("b", "car", "g_0_0", "g_1_0", 0.6)], {
      blocked: new Set([edgeKey("g_0_0", "g_1_0")]),
    });
    expect(pair).toBeNull();
  });

  it("truck_crash needs a truck involved; car_crash excludes trucks", () => {
    const cars = [v("a", "car", "g_0_0", "g_1_0", 0.5), v("b", "van", "g_0_0", "g_1_0", 0.6)];
    expect(findRearEnd(cars, { blocked: new Set(), kind: "truck_crash" })).toBeNull();
    const withTruck = [v("a", "truck", "g_0_0", "g_1_0", 0.5), v("b", "van", "g_0_0", "g_1_0", 0.6)];
    expect(findRearEnd(withTruck, { blocked: new Set(), kind: "truck_crash" })).not.toBeNull();
    expect(findRearEnd(withTruck, { blocked: new Set(), kind: "car_crash" })).toBeNull();
  });
});

describe("findSolo", () => {
  it("picks a moving eligible vehicle matching the kind", () => {
    const list = [v("a", "bus", "g_0_0", "g_1_0", 0.5), v("b", "truck", "g_0_0", "g_1_0", 0.2)];
    expect(findSolo(list, { blocked: new Set(), kind: "truck_crash" }, () => 0)?.id).toBe("b");
    expect(findSolo(list, { blocked: new Set(), kind: "car_crash" }, () => 0)).toBeNull();
  });
});

describe("naming", () => {
  it("names downtown streets, the ring and directions", () => {
    expect(roadName(edgeKey("g_0_0", "g_1_0"))).toMatch(/\S/);
    expect(roadName(edgeKey("h_0", "h_1"))).toBe("the A-Ring");
    expect(directionWord("g_0_0", "g_1_0")).toBe("eastbound");
    expect(directionWord("g_0_1", "g_0_0")).toBe("northbound");
  });

  it("builds a punchy note with the road in it", () => {
    const note = crashNote("truck_crash", "jackknife", "h_0", "h_1", () => 0);
    expect(note).toContain("A-Ring");
    expect(note).toContain("eastbound");
  });
});

describe("pickScriptedEdge", () => {
  it("returns a downtown or highway edge that isn't blocked or excluded", () => {
    const blocked = new Set<string>();
    for (const e of ROAD_EDGES.values()) if (e.kind === "street") blocked.add(e.key);
    const k = pickScriptedEdge(Math.random, blocked, new Set())!;
    expect(ROAD_EDGES.get(k)?.kind).toBe("highway");
  });
});

describe("pickPileupRun", () => {
  it("returns a straight, unblocked run of two edges on the ring or a downtown avenue", () => {
    for (let i = 0; i < 30; i++) {
      const r = pickPileupRun(Math.random, new Set())!;
      const [a, b, c] = [getNode(r.a), getNode(r.b), getNode(r.c)];
      expect((b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x)).toBeCloseTo(0);
      expect(ROAD_EDGES.get(edgeKey(r.a, r.b))!.kind).toBe(r.highway ? "highway" : "street");
    }
    expect(pickPileupRun(() => 0, new Set())!.highway).toBe(true);
  });
});

describe("pickJunction", () => {
  it("victim has green, runner has red, at the same moment", () => {
    for (const now of [0, 5000, 9100, 13000]) {
      const j = pickJunction(Math.random, new Set(), now)!;
      expect(signalFor(j.node, j.aFrom, now)).toBe("green");
      expect(signalFor(j.node, j.bFrom, now)).toBe("red");
    }
  });
});

describe("pileup note", () => {
  it("counts vehicles", () => {
    expect(crashNote("pileup", "pileup", "h_2", "h_1", () => 0, "car", "car", 12)).toBe(
      "12-vehicle pileup on the A-Ring westbound, both carriageways closed",
    );
  });
});
