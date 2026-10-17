import { describe, expect, it } from "vitest";
import { PHASES, craneAt, derive, jibPoint, newCraneState, slewAngle, type CranePlan } from "./crane";
import { wrapPi } from "./geom2d";
import { DUMP, EXCAVATOR_CYCLE, dumpAt, dumpCycle, excavatorAt, hoistY } from "./machines";
import { getSites } from "./sites";

const plan: CranePlan = {
  cx: 0, cz: 0,
  pick: { x: 20, z: 5, y: 1.4 }, // east-ish
  drop: { x: -6, z: -18, y: 40 }, // north-west-ish
  clearY: 45, hoistV: 3, slewV: 0.2, trolleyV: 1.5, attachS: 4, releaseS: 3,
};

describe("slew convention", () => {
  it("matches three.js rotation.y: jib at angle θ points along (cos θ, -sin θ)", () => {
    for (const [dx, dz] of [[10, 0], [0, -10], [-7, 3], [4, 9]]) {
      const a = slewAngle(dx, dz);
      const [x, z] = jibPoint(0, 0, a, Math.hypot(dx, dz));
      expect(x).toBeCloseTo(dx);
      expect(z).toBeCloseTo(dz);
    }
  });
});

describe("crane timeline", () => {
  const d = derive(plan);
  const st = newCraneState();
  const hook = (t: number) => {
    craneAt(plan, d, t, st);
    const [x, z] = jibPoint(plan.cx, plan.cz, st.slew, st.radius);
    return { x, z, y: st.hookY, loaded: st.loaded, placed: st.placed, phase: st.phase };
  };

  it("starts at the pick and visits the drop", () => {
    const h0 = hook(0.01);
    expect(h0.x).toBeCloseTo(plan.pick.x, 1);
    expect(h0.z).toBeCloseTo(plan.pick.z, 1);
    expect(h0.y).toBeCloseTo(plan.pick.y, 3);
    const tRelease = d.durations.slice(0, 4).reduce((s, x) => s + x, 0) + 0.5;
    const hr = hook(tRelease);
    expect(hr.phase).toBe("release");
    expect(hr.x).toBeCloseTo(plan.drop.x, 1);
    expect(hr.z).toBeCloseTo(plan.drop.z, 1);
    expect(hr.y).toBeCloseTo(plan.drop.y, 3);
  });

  it("runs every phase in order with positive durations", () => {
    expect(d.durations).toHaveLength(PHASES.length);
    for (const x of d.durations) expect(x).toBeGreaterThan(0);
    const seen: string[] = [];
    for (let t = 0; t < d.cycle; t += 0.05) {
      const p = hook(t).phase;
      if (seen[seen.length - 1] !== p) seen.push(p);
    }
    expect(seen).toEqual([...PHASES]);
  });

  it("is continuous (no jumps) and periodic", () => {
    let prev = hook(0);
    for (let t = 0.02; t < d.cycle * 2; t += 0.02) {
      const h = hook(t);
      expect(Math.hypot(h.x - prev.x, h.z - prev.z)).toBeLessThan(0.3);
      expect(Math.abs(h.y - prev.y)).toBeLessThan(0.3);
      prev = h;
    }
    const a = hook(3.3);
    const b = hook(3.3 + d.cycle);
    expect(b.x).toBeCloseTo(a.x, 6);
    expect(b.y).toBeCloseTo(a.y, 6);
  });

  it("only slews/trolleys at the clear height (never drags a load through the tower)", () => {
    for (let t = 0; t < d.cycle; t += 0.05) {
      const h = hook(t);
      if (h.phase === "slewOut" || h.phase === "slewBack") expect(h.y).toBeCloseTo(plan.clearY, 6);
      else {
        const atPick = Math.hypot(h.x - plan.pick.x, h.z - plan.pick.z) < 0.01;
        const atDrop = Math.hypot(h.x - plan.drop.x, h.z - plan.drop.z) < 0.01;
        expect(atPick || atDrop).toBe(true);
      }
      expect(h.y).toBeGreaterThanOrEqual(Math.min(plan.pick.y, plan.drop.y) - 1e-6);
      expect(h.y).toBeLessThanOrEqual(plan.clearY + 1e-6);
    }
  });

  it("slews the short way round and stays within the pick-drop sector", () => {
    const a0 = slewAngle(plan.pick.x, plan.pick.z);
    const a1 = slewAngle(plan.drop.x, plan.drop.z);
    expect(Math.abs(d.dA)).toBeLessThanOrEqual(Math.PI + 1e-9);
    expect(Math.abs(wrapPi(a0 + d.dA - a1))).toBeLessThan(1e-9);
    for (let t = 0; t < d.cycle; t += 0.1) {
      craneAt(plan, d, t, st);
      const rel = (st.slew - a0) / d.dA; // 0 at pick, 1 at drop
      expect(rel).toBeGreaterThanOrEqual(-1e-9);
      expect(rel).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it("carries the load out and leaves it placed on the way back", () => {
    for (let t = 0; t < d.cycle; t += 0.1) {
      const h = hook(t);
      const out = ["attach", "hoist", "slewOut", "lower", "release"].includes(h.phase);
      expect(h.loaded).toBe(out);
      expect(h.placed).toBe(!out);
    }
  });

  it("works for every crane on every real site", () => {
    for (const s of getSites())
      for (const c of s.cranes) {
        const dd = derive(c.plan);
        expect(dd.cycle).toBeGreaterThan(20);
        expect(dd.cycle).toBeLessThan(150);
        let prevY = craneAt(c.plan, dd, 0, st).hookY;
        for (let t = 0.05; t < dd.cycle; t += 0.05) {
          const y = craneAt(c.plan, dd, t, st).hookY;
          expect(Math.abs(y - prevY)).toBeLessThan(0.4);
          expect(st.radius).toBeLessThan(c.jib);
          prevY = y;
        }
      }
  });
});

describe("excavator and dump truck", () => {
  it("excavator cycle loops smoothly between the pit and the truck", () => {
    const p = { yaw: 0, boom: 0, stick: 0, bucket: 0 };
    let prev = { ...excavatorAt(0.3, 2.1, 0, p) };
    for (let t = 0.02; t < EXCAVATOR_CYCLE * 2; t += 0.02) {
      excavatorAt(0.3, 2.1, t, p);
      expect(Math.abs(wrapPi(p.yaw - prev.yaw))).toBeLessThan(0.1);
      expect(Math.abs(p.boom - prev.boom)).toBeLessThan(0.1);
      prev = { ...p };
    }
    excavatorAt(0.3, 2.1, 4.8, p);
    expect(p.yaw).toBeCloseTo(2.1, 3);
    expect(excavatorAt(0.3, 2.1, 0, p).yaw).toBeCloseTo(0.3, 3);
  });

  it("dump truck loads at A, tips at B and returns", () => {
    const run = { ax: 0, az: 0, bx: 12, bz: 0 };
    const q = { x: 0, z: 0, h: 0, tip: 0, moving: false };
    expect(dumpAt(run, 1, q).x).toBe(0);
    const { travel, cycle } = dumpCycle(run);
    dumpAt(run, DUMP.loadS + travel + DUMP.tipS / 2, q);
    expect(q.x).toBeCloseTo(12);
    expect(q.tip).toBeGreaterThan(0.9);
    expect(dumpAt(run, cycle - 0.01, q).x).toBeLessThan(0.1);
    expect(q.h).toBeCloseTo(Math.PI / 2);
  });

  it("hoist cage stays on its mast", () => {
    for (let t = 0; t < 60; t += 0.5) {
      const y = hoistY(40, t);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(40);
    }
  });
});
