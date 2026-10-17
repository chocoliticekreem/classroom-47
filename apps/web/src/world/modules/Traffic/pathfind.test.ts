import { describe, expect, it } from "vitest";
import { ROAD_NODES, edgeKey, findPath, getEdge } from "../../roads";
import { fastPath } from "./pathfind";

const cost = (p: string[]) => p.slice(1).reduce((s, id, i) => s + getEdge(p[i], id)!.length / getEdge(p[i], id)!.speedLimit, 0);

describe("fastPath", () => {
  const ids = [...ROAD_NODES.keys()];
  it("matches roads.findPath travel time on random pairs", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 150; i++) {
      const a = ids[Math.floor(rnd() * ids.length)];
      const b = ids[Math.floor(rnd() * ids.length)];
      const ref = findPath(a, b);
      const got = fastPath(a, b, new Set());
      expect(got === null, `${a}->${b}`).toBe(ref === null);
      if (ref && got) {
        expect(got[0]).toBe(a);
        expect(got.at(-1)).toBe(b);
        expect(cost(got)).toBeCloseTo(cost(ref), 6);
      }
    }
  });
  it("avoids blocked edges", () => {
    const blocked = new Set([edgeKey("g_0_0", "g_1_0")]);
    const p = fastPath("g_0_0", "g_1_0", blocked)!;
    expect(p.length).toBeGreaterThan(2);
    for (let i = 1; i < p.length; i++) expect(blocked.has(edgeKey(p[i - 1], p[i]))).toBe(false);
  });
  it("returns null for unknown nodes and [from] for from === to", () => {
    expect(fastPath("nope", "g_0_0", new Set())).toBeNull();
    expect(fastPath("g_0_0", "g_0_0", new Set())).toEqual(["g_0_0"]);
  });
});
