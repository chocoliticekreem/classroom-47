import { Object3D } from "three";
import { afterEach, describe, expect, it } from "vitest";
import { LANE_OFFSET } from "../../config";
import { on, type WorldEvent } from "../../bus";
import { footprint, obstacleAhead, rebuildSpatialIndex } from "../../physics";
import { registerVehicle, type VehicleEntry, type VehicleKind } from "../../registry";
import { edgeKey } from "../../roads";
import { useWorld } from "../../store";
import {
  CYCLIST_INTERVAL_MS, CyclistGate, HIT_CLOSING, cyclistHitNote, cyclistHits, isCyclistHit, launch, newTumble, restPoint, stepTumble,
} from "./cyclist";
import { CollisionEngine } from "./engine";

const offs: (() => void)[] = [];
afterEach(() => {
  for (const o of offs.splice(0)) o();
  cyclistHits.clear();
  useWorld.setState({ blocked: {}, incidents: [] });
});

type Entry = VehicleEntry & { crashed: number };

function add(id: string, kind: VehicleKind, x: number, z: number, h: number, speed: number, edge = "e-1"): Entry {
  const object = new Object3D();
  object.position.set(x, 0, z);
  object.rotation.y = h;
  const v = { id, kind, object, edgeKey: edge, from: null, to: null, t: 0, speed, stopped: speed === 0, crashed: 0 } as Entry;
  v.crash = () => {
    if (v.crashed) return false;
    if (kind === "cyclist" && !object.userData.hitBy) return false;
    v.crashed++;
    v.stopped = true;
    v.speed = 0;
    return true;
  };
  offs.push(registerVehicle(v));
  return v;
}

const body = (x: number, z: number, h: number, speed: number) => ({ x, z, h, speed, stopped: speed === 0 });

describe("cyclist footprint in the raycast", () => {
  it("is a 0.9 x 0.35 half-extent box", () => {
    expect(footprint("cyclist")).toEqual({ halfLength: 0.9, halfWidth: 0.35 });
  });

  it("a car in its lane sees a cyclist riding in the gutter ahead (traffic and van corridors)", () => {
    // road along +z through x = 0: cars drive at x = +LANE_OFFSET (left of +z travel is +x), bikes 1.2 m further out
    add("bike-1", "cyclist", LANE_OFFSET + 1.2, 20, 0, 5);
    rebuildSpatialIndex();
    const hatchCorridor = 1.72 / 2 + 0.15; // Traffic: WIDTH / 2 + 0.15
    const vanCorridor = 1.05 + 0.3; // DeliveryFleet: halfWidth + CORRIDOR_PAD
    for (const hw of [hatchCorridor, vanCorridor, 1.2]) {
      const hit = obstacleAhead("car-1", LANE_OFFSET, 0, 0, 40, hw);
      expect(hit?.id).toBe("bike-1");
      expect(hit?.kind).toBe("cyclist");
      expect(hit!.dist).toBeCloseTo(20 - 0.9, 1);
    }
    // the oncoming lane doesn't see it
    expect(obstacleAhead("car-2", -LANE_OFFSET, 0, 0, 40, hatchCorridor)).toBeNull();
  });
});

describe("hit detection", () => {
  it("is a hit only above the closing-speed threshold, and only for a moving vehicle", () => {
    const bike = body(0, 1.5, 0, 0);
    expect(isCyclistHit(body(0, 0, 0, HIT_CLOSING - 0.1), bike)).toBe(false);
    expect(isCyclistHit(body(0, 0, 0, HIT_CLOSING + 0.1), bike)).toBe(true);
    // the bike riding away at nearly the car's speed: not closing
    expect(isCyclistHit(body(0, 0, 0, 6), body(0, 1.5, 0, 5))).toBe(false);
    expect(isCyclistHit(body(0, 0, 0, 0), body(0, 1.5, Math.PI, 6))).toBe(false);
  });

  it("the engine turns a fast car-on-cyclist overlap into a cyclist_hit with closure and events", () => {
    const events: WorldEvent[] = [];
    offs.push(on((e) => events.push(e)));
    const key = edgeKey("g_0_0", "g_0_1");
    const car = add("car-9", "car", 2, 10, 0, 6, key);
    const bike = add("bike-2", "cyclist", 2.6, 12, 0, 2, key);
    const eng = new CollisionEngine();
    eng.step(100_000, false);
    expect(car.crashed).toBe(1);
    expect(bike.crashed).toBe(1);
    const inc = useWorld.getState().incidents;
    expect(inc).toHaveLength(1);
    expect(inc[0].kind).toBe("cyclist_hit");
    expect(inc[0].note).toMatch(/^A car hit a cyclist on /);
    expect(useWorld.getState().blocked[key]).toBe(inc[0].note);
    expect(events.map((e) => e.type)).toEqual(["road:blocked", "incident:created", "vehicle:crashed"]);
    expect((events[2] as Extract<WorldEvent, { type: "vehicle:crashed" }>).vehicleId).toBe("car-9");
    expect(cyclistHits.get(inc[0].id)?.damaged).toBe(false);
    expect(eng.stats.crashes).toBe(0); // not a car crash
  });

  it("a slow brush (closing under 2 m/s) is not a hit and only nudges the car", () => {
    const car = add("car-3", "car", 2, 10, 0, 1.5);
    const bike = add("bike-3", "cyclist", 2.6, 12, 0, 0);
    new CollisionEngine().step(100_000, false);
    expect(car.crashed + bike.crashed).toBe(0);
    expect(useWorld.getState().incidents).toHaveLength(0);
  });

  it("emergency vehicles never hit cyclists", () => {
    add("AMBULANCE-1", "ambulance", 2, 10, 0, 12);
    add("bike-4", "cyclist", 2.6, 12, 0, 0);
    new CollisionEngine().step(100_000, false);
    expect(useWorld.getState().incidents).toHaveLength(0);
  });
});

describe("rate limit", () => {
  it("gate: one hit per 60 s, staged requests skip the interval but not the active cap", () => {
    const g = new CyclistGate();
    expect(g.allows(0, 0)).toBe(true);
    g.commit(0);
    expect(g.allows(CYCLIST_INTERVAL_MS - 1, 0)).toBe(false);
    expect(g.allows(CYCLIST_INTERVAL_MS, 0)).toBe(true);
    expect(g.allows(1000, 0, true)).toBe(true);
    expect(g.allows(1000, 2, true)).toBe(false);
  });

  it("engine: a second hit inside a minute is suppressed, a later one goes through", () => {
    const eng = new CollisionEngine();
    add("car-a", "car", 2, 10, 0, 8);
    add("bike-a", "cyclist", 2.6, 12, 0, 0);
    eng.step(100_000, false);
    expect(useWorld.getState().incidents).toHaveLength(1);
    add("car-b", "car", 102, 10, 0, 8);
    add("bike-b", "cyclist", 102.6, 12, 0, 0);
    eng.step(130_000, false);
    expect(useWorld.getState().incidents).toHaveLength(1);
    expect(eng.stats.cyclistSuppressed).toBeGreaterThan(0);
    eng.step(100_000 + CYCLIST_INTERVAL_MS, false);
    expect(useWorld.getState().incidents).toHaveLength(2);
  });
});

describe("request:cyclist_hit (staged)", () => {
  it("picks a Hamyway van near a cyclist and stages the hit", () => {
    const events: WorldEvent[] = [];
    offs.push(on((e) => events.push(e)));
    const key = edgeKey("g_0_0", "g_1_0");
    add("car-5", "car", 50, 0, Math.PI / 2, 10, key);
    const van = add("V-07", "van", 10, 2, Math.PI / 2, 9, key);
    const bike = add("bike-5", "cyclist", 25, 3.2, Math.PI / 2, 5, key);
    const eng = new CollisionEngine();
    eng.requestCyclistHit();
    eng.step(5000, false);
    expect(van.crashed).toBe(1);
    expect(bike.crashed).toBe(1);
    const inc = useWorld.getState().incidents;
    expect(inc).toHaveLength(1);
    expect(inc[0].kind).toBe("cyclist_hit");
    expect(inc[0].note).toMatch(/^Van V-07 hit a cyclist on \S/);
    const crashed = events.find((e) => e.type === "vehicle:crashed") as Extract<WorldEvent, { type: "vehicle:crashed" }>;
    expect(crashed.vehicleId).toBe("V-07");
    // the rider lands ahead of the van, on its road
    expect(inc[0].x).toBeGreaterThan(10);
  });

  it("note wording", () => {
    expect(cyclistHitNote("van", "V-07", "Fleet St")).toBe("Van V-07 hit a cyclist on Fleet St");
    expect(cyclistHitNote("truck", "T-03", "Fleet St")).toBe("Truck T-03 hit a cyclist on Fleet St");
    expect(cyclistHitNote("taxi", "taxi-4", "Fleet St")).toBe("A black cab hit a cyclist on Fleet St");
  });
});

describe("tumble", () => {
  it("flies, slides and comes to rest lying on its side, ahead of the impact", () => {
    const t = newTumble();
    launch(t, 0, 0, 0, 0, 6, 3, 7, 0.5);
    const rest = restPoint(t);
    for (let i = 0; i < 600 && !t.rest; i++) stepTumble(t, 1 / 60);
    expect(t.rest).toBe(true);
    expect(t.y).toBe(0);
    expect(Math.abs(Math.cos(t.roll))).toBeLessThan(0.05); // on its side
    expect(t.z).toBeGreaterThan(2);
    expect(t.z).toBeLessThan(12);
    expect(rest.x).toBeCloseTo(t.x, 3);
    expect(rest.z).toBeCloseTo(t.z, 3);
  });
});
