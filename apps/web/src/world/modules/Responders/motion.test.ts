import { describe, expect, it } from "vitest";
import { advance, remainingMetres, type Cursor } from "./motion";

const len = () => 10;
const yes = () => true;

describe("advance", () => {
  it("moves along a segment", () => {
    const cur: Cursor = { seg: 0, t: 0 };
    const r = advance({ nodes: ["a", "b", "c"], stopT: 1 }, cur, 5, len, yes);
    expect(cur).toEqual({ seg: 0, t: 0.5 });
    expect(r.arrived).toBe(false);
  });
  it("crosses into the next segment", () => {
    const cur: Cursor = { seg: 0, t: 0.5 };
    advance({ nodes: ["a", "b", "c"], stopT: 1 }, cur, 8, len, yes);
    expect(cur.seg).toBe(1);
    expect(cur.t).toBeCloseTo(0.3);
  });
  it("arrives at stopT on the last segment", () => {
    const cur: Cursor = { seg: 1, t: 0 };
    const r = advance({ nodes: ["a", "b", "c"], stopT: 0.4 }, cur, 50, len, yes);
    expect(r.arrived).toBe(true);
    expect(cur).toEqual({ seg: 1, t: 0.4 });
  });
  it("stops at a node whose next edge cannot be entered", () => {
    const cur: Cursor = { seg: 0, t: 0.9 };
    const r = advance({ nodes: ["a", "b", "c"], stopT: 1 }, cur, 20, len, (a, b) => !(a === "b" && b === "c"));
    expect(r.blockedAt).toBe(1);
    expect(cur).toEqual({ seg: 0, t: 1 });
  });
  it("treats a one-node route as arrived", () => {
    const cur: Cursor = { seg: 0, t: 0 };
    expect(advance({ nodes: ["a"], stopT: 1 }, cur, 5, len, yes).arrived).toBe(true);
  });
});

describe("remainingMetres", () => {
  it("sums the rest of the route", () => {
    expect(remainingMetres({ nodes: ["a", "b", "c"], stopT: 0.5 }, { seg: 0, t: 0.5 }, len)).toBeCloseTo(10);
  });
});

describe("drive to an incident and home (integration with dispatch)", async () => {
  const { BASE, planApproach, planReturn } = await import("./dispatch");
  const { edgeKey, getEdge } = await import("../../roads");
  const L = (a: string, b: string) => getEdge(a, b)!.length;
  it("reaches the scene, then gets home", () => {
    const key = edgeKey("g_1_1", "g_2_1");
    const blocked = new Set([key]);
    for (const role of ["police", "ambulance", "fire", "tow"] as const) {
      const ap = planApproach(BASE[role], { edgeKey: key, x: 60, z: 40 }, role, blocked)!;
      const cur: Cursor = { seg: 0, t: 0 };
      let arrived = false;
      for (let i = 0; i < 5000 && !arrived; i++)
        arrived = advance(ap.route, cur, 1, L, (a, b) => edgeKey(a, b) === key || !blocked.has(edgeKey(a, b))).arrived;
      expect(arrived, role).toBe(true);
      const n = ap.route.nodes;
      const home = planReturn(n[n.length - 2], n[n.length - 1], BASE[role], blocked)!;
      const c2: Cursor = { seg: 0, t: cur.t };
      let back = false;
      for (let i = 0; i < 5000 && !back; i++) back = advance(home, c2, 1, L, (a, b) => !blocked.has(edgeKey(a, b))).arrived;
      expect(back, role).toBe(true);
      expect(home.nodes[home.nodes.length - 1]).toBe(BASE[role]);
    }
  });
});
