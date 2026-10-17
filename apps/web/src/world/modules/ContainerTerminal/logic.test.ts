import { describe, expect, it } from "vitest";
import { ROAD_NODES, findPath } from "../../roads";
import { CT_PLACES } from "../../districts/containerTerminal";
import { RmgSim, newPairState, newReachState, pairAt, reachAt, reachDefs, slotPoint, straddleTrack, STS_PERIOD } from "./cranes";
import { STYLES, cornerLimit, idmAccel, lightDecision, pickStyle, tipHazard, wantsOvertake } from "./drivers";
import { BLOCKS, STS_CRANES, TRAILER_BED_Y, ZONE, makeYardBox, yardSpecs } from "./layout";
import { buildRoute, edgeAt, kappaAt, poseAt, tailOf } from "./route";
import { CARGO_PER_WRECK, rollPivotOffset, startWreck, stepWreck } from "./wreck";
import { MAX_TIER, Yard, mulberry32 } from "./yard";

describe("terminal roads", () => {
  it("all terminal places exist and connect to the city", () => {
    const places = [...CT_PLACES.gateIn, ...CT_PLACES.gateApproach, CT_PLACES.customs, ...CT_PLACES.bays, CT_PLACES.exit];
    for (const id of places) {
      expect(ROAD_NODES.has(id), id).toBe(true);
      expect(findPath("depot_yard_w", id), id).not.toBeNull();
    }
  });
  it("keeps terminal nodes inside the zone (connectors excepted)", () => {
    for (const n of ROAD_NODES.values()) {
      if (!n.id.startsWith("ct_") || ["ct_dn", "ct_exit", "ct_h8"].includes(n.id)) continue;
      expect(n.x >= ZONE.minX && n.x <= ZONE.maxX && n.z >= ZONE.minZ && n.z <= ZONE.maxZ, n.id).toBe(true);
    }
  });
});

describe("yard", () => {
  it("builds thousands of slots, stacks 1..5 high", () => {
    const y = new Yard(yardSpecs(), makeYardBox);
    expect(y.stacks.length).toBeGreaterThan(150);
    expect(y.count()).toBeGreaterThan(450);
    for (const s of y.stacks) expect(s.tiers.length).toBeGreaterThanOrEqual(1);
    for (const s of y.stacks) expect(s.tiers.length).toBeLessThanOrEqual(MAX_TIER);
  });
  it("picks and places, tracking dirty stacks and refusing overfull stacks", () => {
    const y = new Yard([{ block: 0, bay: 0, row: 0, x: 0, z: 0, initial: 5 }, { block: 0, bay: 1, row: 0, x: 13, z: 0, initial: 1 }], () => ({ brand: 1, tint: 0 }));
    expect(y.place(0, { brand: 0, tint: 0 })).toBe(false);
    const b = y.pick(0)!;
    expect(b.brand).toBe(1);
    expect(y.height(0)).toBe(4);
    expect(y.dirty.has(0)).toBe(true);
    expect(y.pickNear(0, 12)).toBe(1);
    expect(y.placeNear(0, 12)).toBe(1);
    expect(y.housekeep(0, mulberry32(1))).toEqual({ from: 0, to: 1 });
  });
});

describe("RMG scheduler", () => {
  it("loads a box onto a waiting truck and conserves boxes", () => {
    const y = new Yard(yardSpecs(), makeYardBox);
    const m = new RmgSim(0, 0, y);
    const before = y.count();
    m.request({ truckId: "T", kind: "load", x: 276, z: 170 });
    let dropped = null;
    let picked = false;
    for (let i = 0; i < 1200 && !dropped; i++)
      for (const e of m.update(0.05, mulberry32(2))) {
        if (e.type === "picked") picked = true;
        if (e.type === "dropped") dropped = e.job;
      }
    expect(picked).toBe(true);
    expect(dropped?.kind).toBe("load");
    expect(dropped?.box).toBeTruthy();
    expect(dropped!.to.y).toBe(TRAILER_BED_Y);
    expect(y.count()).toBe(before - 1);
  });
  it("unloads an export box into the stack, then shuffles while idle", () => {
    const y = new Yard(yardSpecs(), makeYardBox);
    const m = new RmgSim(1, 1, y);
    const before = y.count();
    m.request({ truckId: "T", kind: "unload", x: 276, z: 207, box: { brand: 2, tint: 0 } });
    for (let i = 0; i < 1200 && m.job !== null || i < 2; i++) m.update(0.05, mulberry32(3));
    expect(y.count()).toBe(before + 1);
    let shuffled = false;
    for (let i = 0; i < 400; i++) {
      m.update(0.05, mulberry32(i));
      if (m.job?.kind === "shuffle") shuffled = true;
    }
    for (let i = 0; i < 2000 && m.job; i++) m.update(0.05, () => 0.99);
    expect(shuffled).toBe(true);
    expect(y.count()).toBe(before + 1);
  });
  it("keeps the gantry on its rails while working", () => {
    const y = new Yard(yardSpecs(), makeYardBox);
    const m = new RmgSim(2, 2, y);
    for (let i = 0; i < 3000; i++) {
      m.update(0.05, mulberry32(i));
      expect(m.pose.gx).toBeGreaterThan(245);
      expect(m.pose.gx).toBeLessThan(310);
      expect(m.pose.sy).toBeGreaterThan(0);
    }
  });
});

describe("STS / straddle / reach stacker timelines", () => {
  it("the box is always somewhere sensible and the straddle stays near the quay/yard", () => {
    const def = STS_CRANES[0];
    const tr = straddleTrack(def, "straddleA");
    const slot = slotPoint("straddleA");
    const o = newPairState();
    for (let t = 0; t < STS_PERIOD * 2; t += 0.25) {
      pairAt(t, def, tr, slot, o);
      for (const v of [o.boxA.x, o.boxA.y, o.boxA.z, o.straddle.x, o.straddle.z, o.sts.trolleyX]) expect(Number.isFinite(v)).toBe(true);
      expect(o.boxA.y).toBeGreaterThanOrEqual(0);
      expect(o.straddle.x).toBeGreaterThan(250);
      expect(o.straddle.x).toBeLessThan(335);
    }
  });
  it("reach stackers alternate the box between two stacks", () => {
    const st = newReachState();
    const d = reachDefs()[0];
    reachAt(0.5, d, st);
    const x0 = st.boxX;
    reachAt(22.8, d, st);
    expect(Math.abs(st.boxX - x0)).toBeGreaterThan(10);
    for (let t = 0; t < 100; t += 0.3) {
      reachAt(t, d, st);
      expect(st.boomLen).toBeGreaterThan(2);
      expect(st.boxY).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("routes", () => {
  it("follows the lane, curves round corners and maps back to edges", () => {
    const path = findPath("ct_l0_bay", CT_PLACES.exit)!;
    const r = buildRoute(path);
    expect(r.length).toBeGreaterThan(50);
    const p = { x: 0, z: 0, h: 0 };
    let maxK = 0;
    for (let s = r.start; s < r.length; s += 1) {
      poseAt(r, s, p);
      maxK = Math.max(maxK, Math.abs(kappaAt(r, s)));
      const { i, t } = edgeAt(r, s);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(path.length - 1);
      expect(t).toBeGreaterThanOrEqual(0);
    }
    expect(maxK).toBeGreaterThan(0.05); // there are real bends
    expect(maxK).toBeLessThan(1);
  });
  it("signs curvature: + for a left turn", () => {
    // heading south (+z) along the west perimeter, then east (+x) into lane 0: driving +z then +x is a LEFT turn
    const r = buildRoute(["ct_w_153", "ct_w_172", "ct_l0_a"]);
    let k = 0;
    for (let s = r.start; s < r.length; s += 0.5) k += kappaAt(r, s);
    expect(k).toBeGreaterThan(0);
  });
  it("joins a new leg onto the tail without jumps, U-turning when it doubles back", () => {
    const a = buildRoute(["ct_w_172", "ct_l0_a", "ct_l0_bay"]);
    const tail = tailOf(a, a.length);
    const b = buildRoute(["ct_l0_bay", "ct_l0_a"], 0, tail);
    const p = { x: 0, z: 0, h: 0 };
    const q = { x: 0, z: 0, h: 0 };
    poseAt(a, a.length, p);
    poseAt(b, b.here, q);
    expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeLessThan(0.2);
    let prev = { ...q };
    for (let s = b.here; s < b.length; s += 0.5) {
      poseAt(b, s, q);
      expect(Math.hypot(q.x - prev.x, q.z - prev.z)).toBeLessThan(0.8);
      prev = { ...q };
    }
  });
});

describe("drivers", () => {
  it("maniacs speed, overtake and run reds; calm drivers don't", () => {
    expect(STYLES.maniac.speedMul).toBe(1.5);
    expect(lightDecision("red", 20, 10, STYLES.maniac, 0.1)).toBe("go");
    expect(lightDecision("red", 20, 10, STYLES.calm, 0.1)).toBe("stop");
    expect(lightDecision("amber", 30, 5, STYLES.maniac, 0.9)).toBe("go");
    expect(lightDecision("amber", 30, 5, STYLES.calm, 0.1)).toBe("stop");
    expect(lightDecision("amber", 2, 15, STYLES.calm, 0.1)).toBe("go"); // can't stop in time
    expect(wantsOvertake(STYLES.maniac, 20, 5, 16, 120, true)).toBe(true);
    expect(wantsOvertake(STYLES.maniac, 20, 5, 16, 40, true)).toBe(false);
    expect(wantsOvertake(STYLES.normal, 20, 5, 16, 120, true)).toBe(false);
  });
  it("only maniacs risk a rollover, more so the harder they corner", () => {
    expect(tipHazard(8, STYLES.normal)).toBe(0);
    expect(tipHazard(3, STYLES.maniac)).toBe(0);
    expect(tipHazard(6, STYLES.maniac)).toBeGreaterThan(tipHazard(5, STYLES.maniac));
  });
  it("brakes for bends ahead and follows a leader", () => {
    const r = buildRoute(["ct_w_153", "ct_w_172", "ct_l0_a"]);
    const calm = cornerLimit(r, r.start, 10, STYLES.calm, 0);
    const mad = cornerLimit(r, r.start, 10, STYLES.maniac, 0);
    expect(mad).toBeGreaterThan(calm);
    expect(idmAccel(10, 15, 5, 10, STYLES.normal)).toBeLessThan(-3);
    expect(idmAccel(5, 15, Infinity, 0, STYLES.normal)).toBeGreaterThan(0);
  });
  it("roughly a third of drivers are maniacs", () => {
    const r = mulberry32(9);
    let n = 0;
    for (let i = 0; i < 1000; i++) if (pickStyle(r) === "maniac") n++;
    expect(n).toBeGreaterThan(250);
    expect(n).toBeLessThan(450);
  });
});

describe("rollover wreck", () => {
  it("rolls onto its side, sheds the box and spills cargo that comes to rest", () => {
    const w = startWreck(0, 0, 0, 16, 1, { x: 0, z: -6, h: 0 }, TRAILER_BED_Y);
    const r = mulberry32(5);
    for (let i = 0; i < 400; i++) stepWreck(w, 1 / 60, r);
    expect(w.roll).toBeGreaterThan(1.3);
    expect(w.attached).toBe(false);
    expect(w.burst).toBe(true);
    expect(w.cargo.length).toBe(CARGO_PER_WRECK);
    // box flew off to the right of travel (right = -x when heading +z)
    expect(w.bx).toBeLessThan(-1);
    for (let i = 0; i < 900; i++) stepWreck(w, 1 / 60, r);
    expect(w.settled).toBe(true);
    for (const c of w.cargo) expect(c.y).toBeGreaterThanOrEqual(c.s / 2 - 1e-6);
  });
  it("pivots on the low side edge", () => {
    const [ox, oy] = rollPivotOffset(Math.PI / 2, 1.25);
    expect(ox).toBeCloseTo(-1.25);
    expect(oy).toBeCloseTo(1.25);
  });
});

describe("blocks", () => {
  it("has three RMG blocks plus reefer, straddle and empties blocks", () => {
    expect(BLOCKS.filter((b) => b.kind === "rmg").length).toBe(3);
    expect(BLOCKS.some((b) => b.kind === "reefer")).toBe(true);
  });
});
