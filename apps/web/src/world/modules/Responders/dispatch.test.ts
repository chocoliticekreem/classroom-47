import { describe, expect, it } from "vitest";
import { PLACES, ROAD_EDGES, edgeKey, getNode } from "../../roads";
import {
  BASE,
  companionEdges,
  incidentT,
  leaveDelays,
  planApproach,
  planDispatch,
  planReturn,
  shouldHandle,
  towsRequired,
  towWorkSeconds,
} from "./dispatch";

const key = edgeKey("g_0_0", "g_1_0");
const mid = { edgeKey: key, x: 20, z: 0 };

function usesEdge(nodes: string[], k: string) {
  for (let i = 1; i < nodes.length; i++) if (edgeKey(nodes[i - 1], nodes[i]) === k) return true;
  return false;
}

describe("planDispatch", () => {
  it("sends police, ambulance and tow to a car crash", () => {
    expect(planDispatch("car_crash")).toEqual(["police", "ambulance", "tow"]);
  });
  it("adds a fire engine for a truck crash", () => {
    expect(planDispatch("truck_crash")).toEqual(["police", "ambulance", "fire", "tow"]);
  });
  it("sends police and tow to a breakdown", () => {
    expect(planDispatch("breakdown")).toEqual(["police", "tow"]);
  });
  it("ignores roadworks", () => {
    expect(planDispatch("roadworks")).toEqual([]);
    expect(shouldHandle("roadworks")).toBe(false);
    expect(shouldHandle("car_crash")).toBe(true);
  });
  it("sends a doubled-up response to a pileup", () => {
    const roles = planDispatch("pileup");
    const count = (r: string) => roles.filter((x) => x === r).length;
    expect(count("police")).toBe(2);
    expect(count("ambulance")).toBe(2);
    expect(count("fire")).toBe(1);
    expect(count("tow")).toBe(2);
    expect(shouldHandle("pileup")).toBe(true);
    expect(towsRequired("pileup")).toBe(2);
    expect(towWorkSeconds("pileup")).toBe(10);
    expect(towsRequired("car_crash")).toBe(1);
    expect(towWorkSeconds("truck_crash")).toBe(8);
  });
  it("leaves airport incidents to the Airport module", () => {
    expect(shouldHandle("plane_crash")).toBe(false);
    expect(shouldHandle("emergency_landing")).toBe(false);
    expect(planDispatch("plane_crash")).toEqual([]);
    expect(planDispatch("emergency_landing")).toEqual([]);
  });
  it("staggers repeated roles", () => {
    const roles = planDispatch("pileup");
    const d = leaveDelays(roles);
    const firstPolice = d[roles.indexOf("police")];
    const secondPolice = d[roles.lastIndexOf("police")];
    expect(secondPolice).toBeGreaterThan(firstPolice);
    expect(d[roles.lastIndexOf("tow")]).toBeGreaterThan(d[roles.indexOf("tow")]);
    expect(new Set(d.map((x, i) => `${roles[i]}${x}`)).size).toBe(roles.length);
  });
  it("bases units at the right places", () => {
    expect(BASE.police).toBe(PLACES.policeStation);
    expect(BASE.ambulance).toBe(PLACES.hospital);
    expect(BASE.fire).toBe(PLACES.hospital);
    expect(BASE.tow).toBe(PLACES.maintenanceYard);
  });
});

describe("incidentT", () => {
  it("projects the incident onto the edge a->b", () => {
    const e = ROAD_EDGES.get(key)!;
    const t = incidentT(key, 20, 0);
    expect(t).toBeCloseTo(0.5, 5);
    const t2 = incidentT(key, 10, 0);
    const a = getNode(e.a);
    expect(t2).toBeCloseTo(a.x === 0 ? 0.25 : 0.75, 5);
  });
  it("clamps away from the ends", () => {
    expect(incidentT(key, -100, 0)).toBeGreaterThan(0.1);
    expect(incidentT(key, 500, 0)).toBeLessThan(0.9);
  });
});

describe("planApproach", () => {
  it("ends on the incident edge, stopping short of the wreck", () => {
    const blocked = new Set([key]);
    const ap = planApproach(BASE.police, mid, "police", blocked)!;
    expect(ap).not.toBeNull();
    const n = ap.route.nodes;
    expect(edgeKey(n[n.length - 2], n[n.length - 1])).toBe(key);
    expect(ap.route.stopT).toBeGreaterThan(0);
    expect(ap.route.stopT).toBeLessThan(0.5);
    // never crosses the incident edge before the final leg
    expect(usesEdge(n.slice(0, -1), key)).toBe(false);
    expect(n[0]).toBe(BASE.police);
  });

  it("tow stops closer to the wreck than police", () => {
    const blocked = new Set([key]);
    const p = planApproach(BASE.police, mid, "police", blocked)!;
    const t = planApproach(BASE.police, mid, "tow", blocked)!;
    expect(t.route.stopT).toBeGreaterThan(p.route.stopT);
  });

  it("prefers the side not avoided when possible", () => {
    const blocked = new Set([key]);
    const p = planApproach(BASE.tow, mid, "tow", blocked)!;
    const q = planApproach(BASE.tow, mid, "tow", blocked, p.side)!;
    expect(q.side).not.toBe(p.side);
  });

  it("returns null when both ends are unreachable", () => {
    // isolate farm_w: its two edges blocked, incident on a different edge into farm_w is the only way in
    const inc = { edgeKey: edgeKey("farm_n", "farm_w"), x: -322, z: -45 };
    const blocked = new Set([edgeKey("farm_n", "farm_w"), edgeKey("farm_s", "farm_w"), edgeKey("farm_gate", "farm_n"), edgeKey("h_15", "farm_n")]);
    // farm_n is cut off from everything except via the incident edge, farm_w only via farm_s (blocked)
    expect(planApproach(BASE.police, inc, "police", blocked)).toBeNull();
  });

  it("handles a base that is an endpoint of the incident edge", () => {
    const [a] = ROAD_EDGES.get(edgeKey(PLACES.policeStation, "g_-3_2"))!.key.split("|");
    const k = edgeKey(PLACES.policeStation, "g_-3_2");
    const n = getNode(PLACES.policeStation);
    const ap = planApproach(BASE.police, { edgeKey: k, x: n.x, z: n.z - 20 }, "police", new Set([k]));
    expect(ap).not.toBeNull();
    expect(ap!.route.nodes.length).toBeGreaterThanOrEqual(2);
    expect(a).toBeTruthy();
  });
});

describe("pileup helpers", () => {
  it("adds extra gap for a repeat unit", () => {
    const blocked = new Set([key]);
    const p1 = planApproach(BASE.police, mid, "police", blocked)!;
    const p2 = planApproach(BASE.police, mid, "police", blocked, undefined, 6)!;
    expect(p2.side).toBe(p1.side);
    expect(p2.route.stopT).toBeLessThan(p1.route.stopT);
  });
  it("finds the adjacent edge closed by the same incident", () => {
    const second = edgeKey("g_1_0", "g_2_0");
    const unrelated = edgeKey("g_1_0", "g_1_1");
    const far = edgeKey("g_3_3", "g_3_2");
    const blocked = { [key]: "Pileup on X", [second]: "Pileup on X", [unrelated]: "Roadworks", [far]: "Pileup on X" };
    expect(companionEdges(key, "Pileup on X", blocked)).toEqual([second]);
    expect(companionEdges(key, "", blocked)).toEqual([]);
  });
});

describe("planReturn", () => {
  it("continues to the next node then paths home", () => {
    const r = planReturn("g_0_0", "g_1_0", BASE.police, new Set())!;
    expect(r.nodes.slice(0, 2)).toEqual(["g_0_0", "g_1_0"]);
    expect(r.nodes[r.nodes.length - 1]).toBe(BASE.police);
    expect(r.stopT).toBe(1);
  });
  it("returns null when home is unreachable", () => {
    const all = new Set([...ROAD_EDGES.keys()]);
    expect(planReturn("g_0_0", "g_1_0", BASE.police, all)).toBeNull();
  });
  it("is a single leg when the next node is home", () => {
    const r = planReturn("g_-3_2", BASE.police, BASE.police, new Set())!;
    expect(r.nodes).toEqual(["g_-3_2", BASE.police]);
  });
});
