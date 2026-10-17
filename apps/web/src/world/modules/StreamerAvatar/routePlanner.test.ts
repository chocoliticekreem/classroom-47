import { describe, expect, it } from "vitest";
import {
  HAZARD_AVOID_DISTANCE,
  distanceToRoute,
  planStreamerRoutes,
  routeLength,
  sampleRoute,
} from "./routePlanner";

describe("routePlanner", () => {
  it("computes primaryRoute from start to destination and detours safeRoute around a midpoint hazard", () => {
    const startX = 0;
    const startZ = 0;
    const destX = 80;
    const destZ = -80;

    // First compute primary route to find its exact midpoint
    const initialPlan = planStreamerRoutes(startX, startZ, destX, destZ);
    expect(initialPlan.primaryRoute[0]).toEqual([startX, startZ]);
    expect(initialPlan.primaryRoute[initialPlan.primaryRoute.length - 1]).toEqual([destX, destZ]);

    const [midX, midZ] = sampleRoute(initialPlan.primaryRoute, 0.5);

    // Place a high-risk stream sniper / crowd swarm hazard right on the primaryRoute midpoint
    const plan = planStreamerRoutes(startX, startZ, destX, destZ, [
      {
        x: midX,
        z: midZ,
        radius: 30,
        risk: 0.95,
        label: "Stream Sniper Midpoint Ambush",
      },
    ]);

    // Primary route passes directly through the midpoint hazard (distance ~ 0)
    const primaryClearance = distanceToRoute(midX, midZ, plan.primaryRoute);
    expect(primaryClearance).toBeLessThan(1);

    // Safe route starts at (startX, startZ) and reaches (destX, destZ)
    expect(plan.safeRoute[0]).toEqual([startX, startZ]);
    expect(plan.safeRoute[plan.safeRoute.length - 1]).toEqual([destX, destZ]);

    // Safe route detours around the midpoint hazard by > 35m
    const safeClearance = distanceToRoute(midX, midZ, plan.safeRoute);
    expect(safeClearance).toBeGreaterThan(HAZARD_AVOID_DISTANCE);

    // Hazard zones include the midpoint ambush
    expect(plan.hazardZones.length).toBeGreaterThanOrEqual(1);
    expect(plan.hazardZones[0].label).toBe("Stream Sniper Midpoint Ambush");
  });

  it("avoids a hazard placed on a straight east-west street segment", () => {
    const plan = planStreamerRoutes(0, 0, 160, 0, [
      { x: 80, z: 0, radius: 32, risk: 0.9, label: "Crosswalk Surge" },
    ]);

    expect(plan.primaryRoute[0]).toEqual([0, 0]);
    expect(plan.primaryRoute[plan.primaryRoute.length - 1]).toEqual([160, 0]);
    expect(distanceToRoute(80, 0, plan.primaryRoute)).toBe(0);

    expect(plan.safeRoute[0]).toEqual([0, 0]);
    expect(plan.safeRoute[plan.safeRoute.length - 1]).toEqual([160, 0]);
    expect(distanceToRoute(80, 0, plan.safeRoute)).toBeGreaterThan(HAZARD_AVOID_DISTANCE);
    expect(routeLength(plan.safeRoute)).toBeGreaterThan(routeLength(plan.primaryRoute));
  });
});
