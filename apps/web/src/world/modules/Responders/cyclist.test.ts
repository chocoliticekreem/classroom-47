import { describe, expect, it } from "vitest";
import { edgeKey } from "../../roads";
import {
  CYCLIST_AMBULANCE_BOOST, GAP_M, gapFor, leaveDelays, planApproach, planDispatch, shouldHandle, towsRequired, towWorkSeconds,
} from "./dispatch";
import { TIMING, newLife, stepLife } from "./lifecycle";
import { MEDIC_S, newMedic, stepMedic } from "./medic";

describe("cyclist_hit responder plan", () => {
  it("is handled: ambulance first, then police, no tow when the vehicle isn't wrecked", () => {
    expect(shouldHandle("cyclist_hit")).toBe(true);
    expect(planDispatch("cyclist_hit")).toEqual(["ambulance", "police"]);
    expect(towsRequired("cyclist_hit")).toBe(0);
  });

  it("adds a tow only when the vehicle crashed", () => {
    expect(planDispatch("cyclist_hit", { vehicleCrashed: true })).toEqual(["ambulance", "police", "tow"]);
    expect(towsRequired("cyclist_hit", { vehicleCrashed: true })).toBe(1);
    // other kinds ignore the option
    expect(planDispatch("car_crash", { vehicleCrashed: false })).toEqual(["police", "ambulance", "tow"]);
  });

  it("the ambulance leaves first and drives fastest, and parks closest to the rider", () => {
    const roles = planDispatch("cyclist_hit", { vehicleCrashed: true });
    const d = leaveDelays(roles, "cyclist_hit");
    expect(d[0]).toBe(0);
    expect(d[0]).toBeLessThan(d[1]);
    expect(d[1]).toBeLessThan(d[2]);
    expect(CYCLIST_AMBULANCE_BOOST).toBeGreaterThan(1);
    expect(gapFor("ambulance", "cyclist_hit")).toBeLessThan(gapFor("police", "cyclist_hit"));
    expect(gapFor("police", "car_crash")).toBe(GAP_M.police);
    // existing kinds keep their timings
    expect(leaveDelays(["police", "ambulance"])).toEqual([0, 0.4]);
  });

  it("plans an approach that stops short of the rider by the cyclist gap", () => {
    const key = edgeKey("g_0_0", "g_1_0");
    const ap = planApproach("g_3_-3", { edgeKey: key, x: 20, z: 0 }, "ambulance", new Set([key]), undefined, gapFor("ambulance", "cyclist_hit") - GAP_M.ambulance);
    expect(ap).not.toBeNull();
    const stopFromRider = (0.5 - ap!.route.stopT) * 40;
    expect(stopFromRider).toBeCloseTo(gapFor("ambulance", "cyclist_hit"), 0);
  });
});

describe("cyclist_hit lifecycle (no tow)", () => {
  it("waits for the ambulance to leave, then clears and reopens", () => {
    const life = newLife(0, { towsRequired: 0, towWorkS: towWorkSeconds("cyclist_hit") });
    const base = { anyArrived: true, towsArrived: 0, externallyCleared: false };
    expect(stepLife(life, { ...base, workDone: false }, 10)).toEqual(["set_responding"]);
    expect(stepLife(life, { ...base, workDone: false }, 100)).toEqual([]); // paramedics still busy
    expect(stepLife(life, { ...base, workDone: true }, 110)).toEqual([]);
    const c = 110 + towWorkSeconds("cyclist_hit");
    expect(stepLife(life, { ...base, workDone: true }, c)).toEqual(["set_clearing"]);
    expect(stepLife(life, { ...base, workDone: true }, c + TIMING.clearAfterS)).toEqual(["release_tow", "set_cleared"]);
    expect(stepLife(life, base, c + TIMING.clearAfterS + TIMING.returnDelayS)).toEqual(["release_units"]);
  });

  it("with a tow, needs both the tow on scene and the ambulance gone", () => {
    const life = newLife(0, { towsRequired: 1, towWorkS: 2 });
    const base = { anyArrived: true, towsArrived: 1, externallyCleared: false };
    stepLife(life, { ...base, workDone: false }, 5);
    expect(stepLife(life, { ...base, workDone: false }, 50)).toEqual([]);
    stepLife(life, { ...base, workDone: true }, 60);
    expect(stepLife(life, { ...base, workDone: true }, 62)).toEqual(["set_clearing"]);
  });
});

describe("paramedic", () => {
  it("walks to the rider, kneels, stretchers them to the back doors, loads them, then is done", () => {
    const m = newMedic();
    const amb = { x: 0, z: 0, h: 0 }; // facing +z, the rider is 14 m ahead
    const rider = { x: 0.5, z: 14 };
    const seen: string[] = [];
    let carried = false;
    let loadedBeforeDone = false;
    // not parked: nothing happens
    stepMedic(m, 0.1, false, amb, 2.9, rider);
    expect(m.phase).toBe("waiting");
    let out = stepMedic(m, 0.05, true, amb, 2.9, rider);
    const total = MEDIC_S.walk + MEDIC_S.kneel + MEDIC_S.carry + MEDIC_S.board + 1;
    let minRiderDist = Infinity;
    for (let t = 0; t < total; t += 0.05) {
      out = stepMedic(m, 0.05, true, amb, 2.9, rider);
      if (seen[seen.length - 1] !== m.phase) seen.push(m.phase);
      if (m.phase === "kneel") minRiderDist = Math.min(minRiderDist, Math.hypot(m.x - rider.x, m.z - rider.z));
      if (out.carry) carried = true;
      if (out.loaded && !out.done) loadedBeforeDone = true;
    }
    expect(seen).toEqual(["walk", "kneel", "carry", "board", "done"]);
    expect(minRiderDist).toBeLessThan(1);
    expect(carried).toBe(true);
    expect(loadedBeforeDone).toBe(true);
    expect(out.done).toBe(true);
    expect(out.loaded).toBe(true);
    expect(m.visible).toBe(false);
  });
});
