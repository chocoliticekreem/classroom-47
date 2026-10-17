import { describe, expect, it } from "vitest";
import { getNode, neighbours } from "../../roads";
import {
  PIT,
  canStop,
  collide,
  interceptHorizon,
  pitChance,
  pitContact,
  pitImpulse,
  predictNode,
  roadblockSite,
  stepBody,
  type Body,
} from "./dynamics";

const ROW = ["g_-3_0", "g_-2_0", "g_-1_0", "g_0_0", "g_1_0", "g_2_0", "g_3_0"]; // 40 m edges

describe("pursuit prediction", () => {
  it("predicts the node the getaway reaches after a few seconds", () => {
    // halfway along the first edge (20 m to g_-2_0), 20 m/s for 2 s = 40 m -> passes g_-2_0, reaches g_-1_0
    expect(predictNode(ROW, 0, 0.5, 20, 2)).toBe("g_-1_0");
    expect(predictNode(ROW, 0, 0.5, 20, 0)).toBe("g_-2_0"); // at least its current target
  });

  it("stops at the end of the known route", () => {
    expect(predictNode(ROW, 0, 0, 30, 60)).toBe("g_3_0");
  });

  it("aims further ahead the further away the police car is", () => {
    expect(interceptHorizon(20, 20)).toBe(1.5);
    expect(interceptHorizon(120, 20)).toBe(6);
    expect(interceptHorizon(1000, 20)).toBe(8);
  });
});

describe("PIT physics", () => {
  const g = { x: 0, z: 0, h: 0, speed: 18 }; // facing +z; right-hand side is -x

  it("recognises a police car at the rear quarter, alongside, as a PIT contact", () => {
    const c = pitContact(g, { x: -1.9, z: -2.6, h: 0.05, speed: 19.5 });
    expect(c.alongside).toBe(true);
    expect(c.side).toBeGreaterThan(0); // on the right
    expect(pitChance(c)).toBeGreaterThan(0.5);
  });

  it("rejects contacts that are too far, directly behind, or at a bad angle", () => {
    expect(pitContact(g, { x: -1.9, z: -9, h: 0, speed: 19 }).alongside).toBe(false); // too far back
    expect(pitContact(g, { x: 0, z: -3, h: 0, speed: 19 }).alongside).toBe(false); // in line, not alongside
    expect(pitContact(g, { x: -1.9, z: -2.6, h: PIT.maxAngle + 0.3, speed: 19 }).alongside).toBe(false);
    expect(pitChance(pitContact(g, { x: -1.9, z: -9, h: 0, speed: 19 }))).toBe(0);
  });

  it("a slower police car rarely makes it work", () => {
    const slow = pitChance(pitContact(g, { x: -1.9, z: -2.6, h: 0, speed: 12 }));
    const matched = pitChance(pitContact(g, { x: -1.9, z: -2.6, h: 0, speed: 19.5 }));
    expect(slow).toBeLessThan(matched);
  });

  it("spins the getaway with yaw momentum towards the police side, then friction brings it to rest", () => {
    const c = pitContact(g, { x: -1.9, z: -2.6, h: 0, speed: 20 });
    const b: Body = pitImpulse(g, c);
    expect(b.w).toBeLessThan(0); // police on the right: nose swings right (negative yaw)
    expect(b.vz).toBeCloseTo(18); // keeps its forward momentum
    expect(b.vx).toBeGreaterThan(0); // pushed left (+x), away from the police
    let t = 0;
    let rested = false;
    while (t < 10 && !rested) {
      rested = stepBody(b, 1 / 60);
      t += 1 / 60;
    }
    expect(rested).toBe(true);
    expect(t).toBeGreaterThan(1.5);
    expect(t).toBeLessThan(5);
    expect(Math.abs(b.h)).toBeGreaterThan(1.2); // spun round a good way
    expect(b.z).toBeGreaterThan(10); // slid on down the road
  });
});

describe("collisions", () => {
  it("conserves momentum and shoves the struck car forward", () => {
    const [v1, v2] = collide(1400, 20, 1400, 5);
    expect(1400 * v1 + 1400 * v2).toBeCloseTo(1400 * 25);
    expect(v2).toBeGreaterThan(5);
    expect(v1).toBeLessThan(20);
  });

  it("bounces off something much heavier", () => {
    const [v1, v2] = collide(1400, 20, 14000, 0, 0.3);
    expect(v1).toBeLessThan(2);
    expect(v2).toBeLessThan(3);
  });

  it("knows when a crash is unavoidable", () => {
    expect(canStop(20, 0, 30)).toBe(true);
    expect(canStop(20, 0, 5)).toBe(false);
    expect(canStop(10, 12, 1)).toBe(true); // it's pulling away
  });
});

describe("roadblock placement", () => {
  const path = ["g_-4_0", "g_-3_0", "g_-2_0", "g_-1_0", "g_0_0", "g_1_0", "g_2_0", "g_3_0", "g_4_0"];

  it("picks a junction on the predicted route within range, with a choice of roads", () => {
    const rb = roadblockSite(path, 0, 0.5, 90, 260)!;
    expect(rb).not.toBeNull();
    const k = path.indexOf(rb.node);
    expect(k).toBeGreaterThan(0);
    expect(rb.from).toBe(path[k - 1]);
    expect(rb.exit).toBe(path[k + 1]);
    expect(neighbours(rb.node).length).toBeGreaterThanOrEqual(3);
    const n = getNode(path[0]);
    const j = getNode(rb.node);
    expect(Math.abs(j.x - n.x) - 20).toBeGreaterThanOrEqual(90 - 1e-6);
  });

  it("parks two cars across the exit road, just past the junction", () => {
    const rb = roadblockSite(path, 0, 0.5)!;
    const n = getNode(rb.node);
    const e = getNode(rb.exit);
    const dir = Math.sign(e.x - n.x);
    expect(rb.slots).toHaveLength(2);
    for (const s of rb.slots) {
      expect((s.x - n.x) * dir).toBeGreaterThan(4);
      expect((s.x - n.x) * dir).toBeLessThan(12);
      expect(Math.abs(s.z - n.z)).toBeLessThan(3); // on the carriageway
      expect(Math.abs(Math.cos(s.h))).toBeGreaterThan(0.6); // pointing along z: across an x-aligned road
    }
    // one on each side of the centre line
    expect(Math.sign(rb.slots[0].z - n.z)).not.toBe(Math.sign(rb.slots[1].z - n.z));
  });

  it("returns null when the route is too short", () => {
    expect(roadblockSite(["g_0_0", "g_1_0"], 0, 0.5)).toBeNull();
  });
});
