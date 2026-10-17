import { describe, expect, it } from "vitest";
import { CrashTimeline, Director, EmergencyTimeline, evacPose, PASSENGERS } from "./incidents";

const fixed = (v: number) => () => v;
const IDLE = { emergency: false, crash: false, crews: false };

describe("Director", () => {
  it("fires an emergency every 3-4 minutes when idle", () => {
    const d = new Director(fixed(0.5), { firstEmergency: 100, firstCrash: 1e9 });
    const fired: number[] = [];
    for (let t = 0; t < 800; t += 0.5) {
      const k = d.step(0.5, IDLE);
      if (k === "emergency_landing") fired.push(t);
    }
    expect(fired[0]).toBeGreaterThanOrEqual(99);
    expect(fired[0]).toBeLessThan(101);
    for (let i = 1; i < fired.length; i++) {
      expect(fired[i] - fired[i - 1]).toBeGreaterThanOrEqual(180);
      expect(fired[i] - fired[i - 1]).toBeLessThanOrEqual(241);
    }
    expect(fired.length).toBe(4);
  });

  it("auto crashes are rare: at most one per 6 minutes", () => {
    const d = new Director(Math.random, { firstEmergency: 1e9 });
    const crashes: number[] = [];
    for (let t = 0; t < 3600; t += 1) if (d.step(1, IDLE) === "plane_crash") crashes.push(t);
    expect(crashes.length).toBeGreaterThan(0);
    for (let i = 1; i < crashes.length; i++) expect(crashes[i] - crashes[i - 1]).toBeGreaterThanOrEqual(360);
  });

  it("serves requests right away, and waits while busy", () => {
    const d = new Director(fixed(0.5), { firstEmergency: 1e9, firstCrash: 1e9 });
    d.request("plane_crash");
    expect(d.step(0.1, { ...IDLE, crash: true })).toBe(null); // one crash at a time
    expect(d.step(0.1, { ...IDLE, emergency: true, crews: true })).toBe("plane_crash"); // other incidents don't hold it up
    expect(d.step(0.1, IDLE)).toBe(null);
    d.request("emergency_landing");
    d.request("emergency_landing"); // de-duplicated
    expect(d.step(0.1, { ...IDLE, crash: true, crews: true })).toBe("emergency_landing");
    expect(d.step(0.1, IDLE)).toBe(null);
  });

  it("automatic incidents wait for a quiet airport", () => {
    const d = new Director(fixed(0.5), { firstEmergency: 5, firstCrash: 1e9 });
    for (let t = 0; t < 60; t += 1) expect(d.step(1, { ...IDLE, crews: true })).toBe(null);
    expect(d.step(1, IDLE)).toBe(null); // grace period after the airport went quiet
    let fired = false;
    for (let t = 0; t < 30; t += 1) if (d.step(1, IDLE) === "emergency_landing") fired = true;
    expect(fired).toBe(true);
  });
});

describe("EmergencyTimeline", () => {
  it("responding when stopped, tows after the evacuation, clears once off the runway and >= 45 s", () => {
    const tl = new EmergencyTimeline();
    const statuses: string[] = [];
    let towAt = -1;
    let clearAt = -1;
    for (let t = 0; t < 120; t += 0.1) {
      const stopped = t >= 22;
      const off = towAt > 0 && t > towAt + 6;
      const a = tl.update(0.1, { stopped, offRunway: off });
      if (a.status) statuses.push(a.status);
      if (a.startTow) towAt = t;
      if (a.clear && clearAt < 0) clearAt = t;
    }
    expect(statuses).toEqual(["responding", "clearing", "cleared"]);
    expect(towAt).toBeGreaterThan(22 + 15);
    expect(clearAt).toBeGreaterThanOrEqual(45);
    expect(clearAt).toBeGreaterThan(towAt);
    expect(tl.done).toBe(true);
  });

  it("gives up waiting after a while (failsafe)", () => {
    const tl = new EmergencyTimeline();
    let cleared = false;
    for (let t = 0; t < 400; t += 0.5) if (tl.update(0.5, { stopped: false, offRunway: false }).clear) cleared = true;
    expect(cleared).toBe(true);
  });
});

describe("CrashTimeline", () => {
  it("burns until the crews arrive, they fight it ~65 s, then it clears", () => {
    const tl = new CrashTimeline();
    const statuses: [string, number][] = [];
    let clearAt = -1;
    for (let t = 0; t < 140; t += 0.1) {
      const a = tl.update(0.1, t > 20);
      if (a.status) statuses.push([a.status, t]);
      if (a.clear) clearAt = t;
      if (t < 20) expect(tl.fire).toBe(1);
    }
    expect(statuses.map((s) => s[0])).toEqual(["responding", "clearing", "cleared"]);
    expect(statuses[0][1]).toBeGreaterThan(19);
    expect(tl.fire).toBe(0);
    expect(clearAt).toBeGreaterThanOrEqual(84);
    expect(clearAt).toBeLessThan(92);
  });

  it("foams anyway if crews are slow", () => {
    const tl = new CrashTimeline();
    for (let t = 0; t < 70; t += 0.5) tl.update(0.5, false);
    expect(tl.fire).toBeLessThan(1);
  });
});

describe("evacPose", () => {
  it("passengers are hidden before their turn, then slide down and gather away from the plane", () => {
    const o = { x: 0, y: 0, z: 0, visible: false };
    for (let i = 0; i < PASSENGERS; i++) {
      evacPose(i, 0, o);
      expect(o.visible).toBe(false);
      evacPose(i, 60, o);
      expect(o.visible).toBe(true);
      expect(o.y).toBeCloseTo(0);
      expect(o.x).toBeGreaterThan(10); // gathered off the left-hand side (local +x)
    }
  });
});
