import { describe, expect, it } from "vitest";
import { getNode, PLACES } from "../../roads";
import { GOV_FALLBACK, governmentDestination, gridRun, isDrivable, joinLegs, motorcadeRoute, outAndBack, pathEdges, RouteTrack, tidy } from "./route";

describe("route building", () => {
  it("gridRun walks a straight row", () => {
    expect(gridRun([-1, -2], [2, -2])).toEqual(["g_-1_-2", "g_0_-2", "g_1_-2", "g_2_-2"]);
    expect(gridRun([0, 1], [0, -1])).toEqual(["g_0_1", "g_0_0", "g_0_-1"]);
    expect(() => gridRun([0, 0], [1, 1])).toThrow();
  });

  it("tidy removes back-and-forth and loops", () => {
    expect(tidy(["a", "b", "a", "c"])).toEqual(["a", "c"]);
    expect(tidy(["a", "b", "c", "d", "b", "e"])).toEqual(["a", "b", "e"]);
    expect(tidy(["a", "a", "b"])).toEqual(["a", "b"]);
  });

  it("joinLegs chains routed and explicit legs into one drivable path", () => {
    const p = joinLegs([["g_-4_0", "g_-2_0"], gridRun([-2, 0], [2, 0]), ["g_2_0", "g_2_3"]])!;
    expect(p).not.toBeNull();
    expect(p[0]).toBe("g_-4_0");
    expect(p[p.length - 1]).toBe("g_2_3");
    expect(isDrivable(p)).toBe(true);
    expect(new Set(p).size).toBe(p.length);
  });

  it("joinLegs avoids blocked roads and returns null when it can't", () => {
    const blocked = new Set(["g_0_0|g_1_0"]);
    const p = joinLegs([["g_0_0", "g_1_0"]], blocked)!;
    expect(pathEdges(p)).not.toContain("g_0_0|g_1_0");
    expect(joinLegs([])).toBeNull();
  });

  it("the motorcade goes from the airport through downtown to the government quarter", () => {
    const dest = governmentDestination();
    const r = motorcadeRoute(dest)!;
    expect(r).not.toBeNull();
    expect(r[0]).toBe(PLACES.airport);
    expect(r[r.length - 1]).toBe(dest);
    expect(isDrivable(r)).toBe(true);
    expect(new Set(r).size).toBe(r.length); // no node twice
    // straight through the middle of downtown
    for (const id of gridRun([-3, -2], [3, -2])) expect(r).toContain(id);
  });

  it("government destination falls back to h_4, and prefers a residence gate once gov_ roads exist", () => {
    expect(governmentDestination(new Map([["g_0_0", { id: "g_0_0", zone: "downtown" }]]))).toBe(GOV_FALLBACK);
    const gov = new Map(
      ["gov_ministry_1", "gov_residence_gate", "gov_gate_w"].map((id) => [id, { id, zone: "government" }] as const),
    );
    expect(governmentDestination(gov)).toBe("gov_residence_gate");
    expect(governmentDestination()).toBe("gov_res_gate"); // the real district
  });

  it("outAndBack closes the loop without repeating the end nodes", () => {
    const loop = outAndBack(["g_0_0", "g_1_0", "g_2_0"]);
    expect(loop).toEqual([0, 0, 40, 0, 80, 0, 40, 0]);
  });
});

describe("RouteTrack", () => {
  const path = gridRun([-2, 0], [2, 0]).concat(["g_2_1"]);
  const tr = new RouteTrack(path);

  it("measures the path and finds edges by distance", () => {
    expect(tr.length).toBeCloseTo(200, 5);
    expect(tr.edgeAt(-5)).toBe(0);
    expect(tr.edgeAt(10)).toBe(0);
    expect(tr.edgeAt(45)).toBe(1);
    expect(tr.edgeAt(999)).toBe(4);
    expect(tr.tAt(1, 60)).toBeCloseTo(0.5, 5);
  });

  it("poses move forward along the lane", () => {
    const p = { x: 0, z: 0, h: 0 } as { x: number; z: number; h: number };
    tr.pose(20, p);
    const a = getNode("g_-2_0");
    expect(p.x).toBeCloseTo(a.x + 20, 0);
    expect(Math.abs(p.z - a.z)).toBeCloseTo(2, 0); // on the left lane, 2 m off the centre line
  });

  it("sees the turn at the end of the row", () => {
    expect(tr.nextTurn(150)).toBeCloseTo(10, 5);
    expect(tr.nextTurn(10)).toBe(Infinity);
  });
});
