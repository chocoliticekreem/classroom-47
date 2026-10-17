import { describe, expect, it } from "vitest";
import { CRASH_SITES, RWY, STAND_Z } from "./layout";
import { Fleet, ON_RUNWAY, type FleetEvent, type Phase } from "./flight";

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function run(fleet: Fleet, seconds: number, dt = 0.05, each?: (f: Fleet, ev: FleetEvent[]) => void) {
  for (let t = 0; t < seconds; t += dt) {
    fleet.step(dt);
    each?.(fleet, fleet.events);
  }
}

describe("Fleet: normal operations", () => {
  it("one plane flies the whole cycle in order", () => {
    const f = new Fleet(rng(1), { count: 1, initial: false });
    const seen: Phase[] = [];
    run(f, 400, 0.05, (fl) => {
      const ph = fl.planes[0].phase;
      if (seen[seen.length - 1] !== ph) seen.push(ph);
    });
    const order: Phase[] = ["approach", "rollout", "taxiIn", "parked", "pushback", "taxiOut", "hold", "lineup", "takeoff", "climb", "gone"];
    let i = 0;
    for (const ph of seen) if (ph === order[i]) i++;
    expect(i).toBe(order.length);
  });

  it("never has two planes on the runway, never double-books a stand, and keeps busy", () => {
    const f = new Fleet(rng(7));
    let landings = 0;
    let takeoffs = 0;
    run(f, 1800, 0.05, (fl, ev) => {
      let onRwy = 0;
      const stands = new Set<string>();
      for (const p of fl.planes) {
        if (ON_RUNWAY.has(p.phase)) onRwy++;
        if (p.stand) {
          expect(stands.has(p.stand.id)).toBe(false);
          stands.add(p.stand.id);
        }
      }
      expect(onRwy).toBeLessThanOrEqual(1);
      for (const e of ev) {
        if (e.type === "touchdown") landings++;
        if (e.type === "liftoff") takeoffs++;
      }
    });
    expect(landings).toBeGreaterThan(12);
    expect(takeoffs).toBeGreaterThan(12);
  });

  it("parked planes sit on their stand", () => {
    const f = new Fleet(rng(3));
    run(f, 300, 0.05, (fl) => {
      for (const p of fl.planes)
        if (p.phase === "parked") {
          expect(p.pos.x).toBeCloseTo(p.stand!.x);
          expect(p.pos.z).toBeCloseTo(STAND_Z);
        }
    });
  });

  it("goes around when the runway is closed", () => {
    const f = new Fleet(rng(2), { count: 1, initial: false });
    run(f, 1);
    expect(f.planes[0].phase).toBe("approach");
    f.lock.closed = true;
    let wentAround = false;
    run(f, 120, 0.05, (fl, ev) => {
      if (ev.some((e) => e.type === "goaround")) wentAround = true;
      expect(fl.planes[0].phase).not.toBe("rollout");
    });
    expect(wentAround).toBe(true);
  });
});

describe("Fleet: emergencies", () => {
  it("emergency landing: closes the runway, lands, stops on the runway, then is towed to a stand", () => {
    const f = new Fleet(rng(5));
    run(f, 20);
    const p = f.declareEmergency();
    expect(p).not.toBeNull();
    expect(f.lock.closed).toBe(true);
    let stoppedAt = -1;
    let hard = false;
    let t = 0;
    run(f, 120, 0.05, (fl, ev) => {
      t += 0.05;
      for (const e of ev) {
        if (e.type === "hardTouchdown" && e.plane === p) hard = true;
        if (e.type === "stopped" && e.plane === p) stoppedAt = t;
      }
      // nobody else lands while it's closed (a plane already committed when it was declared may finish)
      if (t > 15) for (const e of ev) if (e.type === "touchdown") expect(e.plane).toBe(p);
      void fl;
    });
    expect(hard).toBe(true);
    expect(stoppedAt).toBeGreaterThan(0);
    expect(p!.phase).toBe("stopped");
    expect(Math.abs(p!.pos.z - RWY.z)).toBeLessThan(0.5);
    expect(f.startTow(p!)).toBe(true);
    run(f, 80);
    expect(p!.phase).toBe("parked");
    f.reopenRunway();
    expect(f.lock.closed).toBe(false);
  });

  it("plane crash: a plane comes down at the site and is removed after", () => {
    for (const site of CRASH_SITES) {
      const f = new Fleet(rng(11));
      run(f, 10);
      const p = f.declareCrash(site);
      expect(p).not.toBeNull();
      let impact = false;
      run(f, 120, 0.05, (_fl, ev) => {
        for (const e of ev) if (e.type === "impact" && e.plane === p) impact = true;
      });
      expect(impact).toBe(true);
      expect(p!.phase).toBe("crashed");
      expect(p!.pos.x).toBeCloseTo(site.x);
      expect(p!.pos.z).toBeCloseTo(site.z);
      expect(p!.stand).toBeNull();
      f.releaseCrashed(p!);
      expect(p!.phase).toBe("gone");
    }
  });
});
