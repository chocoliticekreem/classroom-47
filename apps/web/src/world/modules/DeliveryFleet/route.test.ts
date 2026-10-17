import { describe, expect, it } from "vitest";
import { edgeKey, findPath, getEdge, getNode, lanePosition } from "../../roads";
import { buildRoute, firstBlockedEdge, kerbPose, newSample, sampleRoute, type Route } from "./route";

function maxStep(route: Route, step = 0.25) {
  const s = newSample();
  sampleRoute(route, 0, s);
  let px = s.x;
  let pz = s.z;
  let worst = 0;
  for (let d = step; d <= route.length; d += step) {
    sampleRoute(route, d, s);
    worst = Math.max(worst, Math.hypot(s.x - px, s.z - pz));
    px = s.x;
    pz = s.z;
  }
  return worst;
}

describe("buildRoute / sampleRoute", () => {
  it("starts and ends on the left lane of a straight path", () => {
    const r = buildRoute(["g_0_0", "g_1_0", "g_2_0"]);
    const s = sampleRoute(r, 0, newSample());
    const [x0, z0] = lanePosition("g_0_0", "g_1_0", 0);
    expect(s.x).toBeCloseTo(x0);
    expect(s.z).toBeCloseTo(z0);
    sampleRoute(r, r.length, s);
    const [x1, z1] = lanePosition("g_1_0", "g_2_0", 1);
    expect(s.x).toBeCloseTo(x1, 1);
    expect(s.z).toBeCloseTo(z1, 1);
    expect(r.length).toBeCloseTo(80, 0);
  });

  it("is continuous through turns and U-turns", () => {
    const turns = buildRoute(["g_0_0", "g_1_0", "g_1_1", "g_0_1", "g_0_0"]);
    expect(maxStep(turns)).toBeLessThan(0.4);
    const uturn = buildRoute(["g_0_0", "g_1_0", "g_0_0"]);
    expect(maxStep(uturn)).toBeLessThan(0.4);
  });

  it("follows a real findPath route across zones without jumps", () => {
    const path = findPath("depot_yard_w", "sub_1_1")!;
    const r = buildRoute(path);
    expect(maxStep(r, 0.5)).toBeLessThan(0.8);
    expect(r.edgeKeys.length).toBe(path.length - 1);
  });

  it("puts the stop line just before each interior junction", () => {
    const r = buildRoute(["g_0_0", "g_1_0", "g_1_1"]);
    expect(Number.isNaN(r.stopLine[0])).toBe(true);
    const s = sampleRoute(r, r.stopLine[1], newSample());
    const n = getNode("g_1_0");
    const d = Math.hypot(s.x - n.x, s.z - n.z);
    expect(d).toBeGreaterThan(5);
    expect(d).toBeLessThan(8);
  });

  it("reports the edge and an increasing t on straights", () => {
    const r = buildRoute(["g_0_0", "g_1_0", "g_2_0"]);
    const s = newSample();
    sampleRoute(r, 10, s);
    expect(s.edge).toBe(0);
    const t1 = s.t;
    sampleRoute(r, 20, s);
    expect(s.t).toBeGreaterThan(t1);
    sampleRoute(r, 60, s);
    expect(s.edge).toBe(1);
  });

  it("honours startAlong/endAlong and start/end poses", () => {
    const start = kerbPose("g_0_0", "g_1_0", 20);
    const end = kerbPose("g_1_0", "g_2_0", 24);
    const r = buildRoute(["g_0_0", "g_1_0", "g_2_0"], { startPose: start, startAlong: 26, endPose: end, endAlong: 16 });
    const s = sampleRoute(r, 0, newSample());
    expect(s.x).toBeCloseTo(start.x);
    expect(s.z).toBeCloseTo(start.z);
    expect(s.edge).toBe(-1);
    sampleRoute(r, r.length, s);
    expect(s.x).toBeCloseTo(end.x);
    expect(s.z).toBeCloseTo(end.z);
    expect(maxStep(r)).toBeLessThan(0.4);
  });

  it("kerbPose sits to the left of the lane, off the centre line", () => {
    const p = kerbPose("g_0_0", "g_1_0", 20); // driving +x, left is -z
    const [, lz] = lanePosition("g_0_0", "g_1_0", 0.5);
    expect(p.z).toBeLessThan(lz);
    expect(Math.abs(p.z)).toBeGreaterThan(4);
  });

  it("throws for non-adjacent nodes", () => {
    expect(() => buildRoute(["g_0_0", "g_2_0"])).toThrow();
  });
});

describe("firstBlockedEdge", () => {
  it("finds the first blocked edge at or after an index", () => {
    const r = buildRoute(["g_0_0", "g_1_0", "g_2_0", "g_3_0"]);
    const k = edgeKey("g_2_0", "g_3_0");
    expect(firstBlockedEdge(r, 0, new Set([k]))).toBe(k);
    expect(firstBlockedEdge(r, 0, new Set())).toBeNull();
    expect(getEdge("g_2_0", "g_3_0")!.key).toBe(k);
  });
});
