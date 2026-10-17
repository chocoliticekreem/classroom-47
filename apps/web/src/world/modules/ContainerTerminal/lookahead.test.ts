import { afterEach, describe, expect, it } from "vitest";
import { blockedSet, useWorld } from "../../store";
import { obstacleAt, type ObstacleFn } from "../DeliveryFleet/lookahead";
import { TRUCK } from "./layout";
import { poseAt, type Pose } from "./route";
import { TruckSim, type Truck } from "./trucks";

let sim: TruckSim | null = null;
afterEach(() => {
  sim?.dispose();
  sim = null;
  useWorld.setState({ blocked: {}, incidents: [] });
});

describe("container lorry look-ahead braking", () => {
  it("a lorry with an obstacle reported ahead decelerates to a stop short of it", () => {
    let current: ObstacleFn = () => null;
    const s = new TruckSim({ count: 12, firstTipAfter: 1e9, seed: 5, obstacleFn: (...a) => current(...a) });
    sim = s;
    const dt = 0.1;
    let clock = 0;
    const step = () => {
      clock += dt;
      s.update(dt, clock * 1000, blockedSet());
    };
    let pick: Truck | null = null;
    for (let i = 0; i < 3000 && !pick; i++) {
      step();
      pick = s.trucks.find((t) => t && t.phase === "driving" && t.style.name !== "maniac" && !t.overtake && t.v > 5 && t.route && t.route.length - t.s > 90) ?? null;
    }
    expect(pick).not.toBeNull();
    const t = pick!;
    const p: Pose = { x: 0, z: 0, h: 0 };
    poseAt(t.route!, t.s + 40, p); // the cab front is at s; the obstacle sits 40 m further along the route
    current = obstacleAt(t.id, p.x, p.z);
    let minDist = Infinity;
    let stoppedNear = false;
    for (let i = 0; i < 400 && !stoppedNear; i++) {
      step();
      const d = Math.hypot(p.x - t.cab.x, p.z - t.cab.z); // from the fifth wheel (kingpin behind the front)
      minDist = Math.min(minDist, d);
      if (t.v < 0.05 && d < TRUCK.kingpin + 2.2 + 2.2 + 2) stoppedNear = true; // + obstacle half + IDM standstill gap
    }
    expect(stoppedNear).toBe(true);
    expect(minDist).toBeGreaterThan(TRUCK.kingpin + 2.2 + 0.3);
  });

  it("maniacs look 50% less far past their stopping distance", () => {
    const ranges = new Map<string, number>();
    const s = new TruckSim({
      count: 12,
      firstTipAfter: 1e9,
      seed: 5,
      obstacleFn: (id, _x, _z, _h, range) => {
        ranges.set(id, range);
        return null;
      },
    });
    sim = s;
    s.update(0.1, 100, blockedSet());
    for (const t of s.trucks) {
      if (!t || t.phase !== "driving" || !ranges.has(t.id)) continue;
      const stopDist = (t.v * t.v) / (2 * t.style.brake);
      const buffer = ranges.get(t.id)! - TRUCK.kingpin - stopDist;
      expect(buffer).toBeCloseTo(t.style.name === "maniac" ? 2.5 : 5, 0);
    }
    expect(s.trucks.some((t) => t?.style.name === "maniac")).toBe(true);
  });
});
