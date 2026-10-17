import { afterEach, describe, expect, it } from "vitest";
import { Object3D } from "three";
import { registerVehicle } from "../../registry";
import { useWorld } from "../../store";
import { Lookahead, PATIENCE_S, lookRange, obstacleAt, stopSpeed, type ObstacleFn } from "./lookahead";
import { newSample, sampleRoute } from "./route";
import { FleetSim, VEHICLE_DIMS } from "./sim";

function seeded(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

describe("Lookahead", () => {
  it("casts stopping distance + buffer past the bumper with a padded corridor", () => {
    const calls: number[][] = [];
    const fn: ObstacleFn = (_id, _x, _z, _h, range, hw) => {
      calls.push([range, hw]);
      return null;
    };
    const look = new Lookahead({ halfLength: 2.5, halfWidth: 1, decel: 4 }, fn);
    expect(look.scan("me", 0, 0, 0, 8, 0.016)).toBe(Infinity);
    expect(calls[0][0]).toBeCloseTo(2.5 + 64 / 8 + 5);
    expect(calls[0][1]).toBeCloseTo(1.3);
    expect(lookRange(0, 4)).toBe(5);
  });

  it("turns a hit into room in front of the bumper, minus the standoff", () => {
    const fn: ObstacleFn = () => ({ id: "x", dist: 20, kind: "car", stopped: true });
    const look = new Lookahead({ halfLength: 3, halfWidth: 1, decel: 4, standoff: 2 }, fn);
    expect(look.scan("me", 0, 0, 0, 5, 0.016)).toBeCloseTo(15);
    expect(look.cap()).toBeCloseTo(stopSpeed(15, 4));
    expect(look.hitId).toBe("x");
  });

  it("off screen it only casts every 4th frame and coasts on the cached hit", () => {
    let n = 0;
    const fn: ObstacleFn = () => {
      n++;
      return { id: "x", dist: 30, kind: "car", stopped: true };
    };
    const look = new Lookahead({ halfLength: 2, halfWidth: 1, decel: 4 }, fn);
    for (let i = 0; i < 16; i++) look.scan("me", 0, 0, 0, 10, 0.1, false);
    expect(n).toBe(4);
    for (let i = 0; i < 8; i++) look.scan("me", 0, 0, 0, 10, 0.1, true);
    expect(n).toBe(12);
  });

  it("knows when the thing it hit is sitting in a junction", () => {
    const o = new Object3D();
    o.position.set(50, 0, 50);
    const off = registerVehicle({ id: "in-box", kind: "car", object: o, edgeKey: null, from: null, to: null, t: 0, speed: 0, stopped: true });
    try {
      const look = new Lookahead({ halfLength: 2, halfWidth: 1, decel: 4 }, () => ({ id: "in-box", dist: 10, kind: "car", stopped: true }));
      look.scan("me", 50, 30, 0, 5, 0.05);
      expect(look.hitInJunction(52, 48)).toBe(true);
      expect(look.hitInJunction(90, 90)).toBe(false);
    } finally {
      off();
    }
  });

  it("survives a throwing physics implementation", () => {
    const look = new Lookahead({ halfLength: 2, halfWidth: 1, decel: 4 }, () => {
      throw new Error("boom");
    });
    expect(look.scan("me", 0, 0, 0, 10, 0.1)).toBe(Infinity);
  });

  it("loses patience with something that never moves (no permanent deadlock)", () => {
    const look = new Lookahead({ halfLength: 2, halfWidth: 1, decel: 4 }, () => ({ id: "x", dist: 3, kind: "car", stopped: true }));
    let cleared = false;
    for (let t = 0; t < PATIENCE_S + 1; t += 0.1) if (look.scan("me", 0, 0, 0, 0, 0.1) === Infinity) cleared = true;
    expect(cleared).toBe(true);
  });
});

afterEach(() => {
  useWorld.setState({ blocked: {}, incidents: [], deliveries: {}, selectedVehicle: null });
});

describe("FleetSim look-ahead braking", () => {
  it("a van with an obstacle reported ahead decelerates to a stop short of it", () => {
    const sim = new FleetSim(seeded(7));
    sim.start();
    try {
      const dt = 0.05;
      // find a van cruising with plenty of route left
      let van = null;
      for (let t = 0; t < 60 && !van; t += dt) {
        sim.update(dt, sim.now);
        for (const v of sim.vans.values())
          if (v.phase === "driving" && v.kind === "van" && v.speed > 4 && v.route && v.route.length - v.d > 80) {
            van = v;
            break;
          }
      }
      expect(van).not.toBeNull();
      const v = van!;
      const p = sampleRoute(v.route!, v.d + 35, newSample());
      v.look.fn = obstacleAt(v.id, p.x, p.z);
      const half = VEHICLE_DIMS.van.len / 2;
      let minDist = Infinity;
      let stoppedNear = false;
      let prev = v.speed;
      let maxDecel = 0;
      for (let t = 0; t < 30 && !stoppedNear; t += dt) {
        sim.update(dt, sim.now);
        const d = Math.hypot(p.x - v.x, p.z - v.z);
        minDist = Math.min(minDist, d);
        maxDecel = Math.max(maxDecel, (prev - v.speed) / dt);
        prev = v.speed;
        if (v.speed < 0.05 && d < half + 2.2 + 2 + 1.5) stoppedNear = true; // half van + obstacle + standoff
      }
      expect(stoppedNear).toBe(true);
      // never touched it: centre stays at least half a van + the obstacle's half length away
      expect(minDist).toBeGreaterThan(half + 2.2 + 0.5);
      expect(maxDecel).toBeLessThanOrEqual(7.01); // smooth: within the van's braking rate
    } finally {
      sim.dispose();
    }
  });
});
