// Headless city traffic + collision engine: the beam should keep cars out of each other, and the
// whole physics pass should stay cheap at ~300 vehicles.
import { Object3D } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { obstacleAhead, overlapping, physicsStats, rebuildSpatialIndex } from "../../physics";
import { registerVehicle, type VehicleEntry } from "../../registry";
import { ROAD_EDGES, lanePosition } from "../../roads";
import { useWorld } from "../../store";
import { TrafficSim } from "../Traffic/sim";
import { CollisionEngine } from "./engine";
import { isCrash } from "./rules";

const DT = 1 / 30;
let clock = 0;
beforeEach(() => {
  vi.spyOn(performance, "now").mockImplementation(() => clock);
});

const offs: (() => void)[] = [];
afterEach(() => {
  for (const o of offs.splice(0)) o();
  useWorld.setState({ blocked: {}, incidents: [] });
});

/** Fast overlaps per simulated minute between Traffic vehicles (would-be crashes), with crashes disabled. */
function fastOverlaps(beam: boolean, seconds: number) {
  const sim = new TrafficSim();
  sim.beam = beam;
  sim.start();
  let fast = 0;
  let slow = 0;
  const seen = new Set<string>();
  const body = (v: VehicleEntry) => ({ x: v.object.position.x, z: v.object.position.z, h: v.object.rotation.y, speed: v.speed, stopped: v.stopped });
  for (let i = 0; i < seconds / DT; i++) {
    clock += DT * 1000;
    rebuildSpatialIndex();
    for (const [a, b] of overlapping()) {
      if (isCrash(body(a), body(b))) {
        const k = a.id < b.id ? a.id + b.id : b.id + a.id;
        if (!seen.has(k)) fast++;
        seen.add(k);
      } else slow++;
    }
    sim.step(DT);
  }
  sim.stop();
  return { fast, slowFrames: slow };
}

describe("traffic + collisions (headless, whole city)", () => {
  it("the look-ahead beam cuts fast overlaps (phasing through) way down", () => {
    const off = fastOverlaps(false, 40);
    const on = fastOverlaps(true, 40);
    console.log(`[collisions] 40 s, all visible: fast-overlap pairs beam off ${off.fast}, on ${on.fast}; slow-overlap pair-frames off ${off.slowFrames}, on ${on.slowFrames}`);
    expect(on.fast).toBeLessThan(Math.max(3, off.fast * 0.25));
  });

  it("end to end: real crashes go through Traffic's crash(), rate-limited, roads close", () => {
    const sim = new TrafficSim();
    sim.start();
    const eng = new CollisionEngine();
    for (let i = 0; i < 90 / DT; i++) {
      clock += DT * 1000;
      eng.step(clock, false);
      sim.step(DT);
    }
    const inc = useWorld.getState().incidents;
    console.log(`[collisions] 90 s end to end: ${eng.stats.crashes} crashes, ${eng.stats.refused} refused, last: ${eng.stats.lastCrash}`);
    expect(eng.stats.crashes).toBeLessThanOrEqual(Math.floor(90 / 20) + 1);
    expect(eng.stats.crashes).toBeLessThanOrEqual(3); // nothing clears them in this test: capped at 3 active
    expect(inc.length).toBe(eng.stats.crashes);
    for (const i of inc) {
      expect(["car_crash", "truck_crash"]).toContain(i.kind);
      expect(useWorld.getState().blocked[i.edgeKey]).toBeDefined();
    }
    sim.stop();
  });

  it("profile: ~300 vehicles, ms per frame for index + overlaps + Traffic", () => {
    const sim = new TrafficSim();
    sim.start();
    // 80 extra vehicles from "other modules": parked and moving, on random lanes
    const edges = [...ROAD_EDGES.values()];
    const extras: VehicleEntry[] = [];
    for (let i = 0; i < 80; i++) {
      const e = edges[(i * 7919) % edges.length];
      const [x, , h] = lanePosition(e.a, e.b, 0.5);
      const object = new Object3D();
      object.position.set(x, 0, lanePosition(e.a, e.b, 0.5)[1]);
      object.rotation.y = h;
      const v: VehicleEntry = { id: `x-${i}`, kind: i % 4 ? "van" : "truck", object, edgeKey: e.key, from: e.a, to: e.b, t: 0.5, speed: i % 3 ? 8 : 0, stopped: !(i % 3) };
      extras.push(v);
      offs.push(registerVehicle(v));
    }
    const eng = new CollisionEngine();
    // warm up
    for (let i = 0; i < 60; i++) {
      clock += DT * 1000;
      eng.step(clock, false);
      sim.step(DT);
    }
    const N = 300;
    let tEng = 0;
    let tSim = 0;
    let queries = 0;
    for (let i = 0; i < N; i++) {
      clock += DT * 1000;
      const a = realNow();
      eng.step(clock, false);
      const b = realNow();
      sim.step(DT);
      const c = realNow();
      tEng += b - a;
      tSim += c - b;
      queries += physicsStats.queries;
    }
    // raw query cost
    const a = realNow();
    let hits = 0;
    for (let k = 0; k < 10; k++)
      for (const v of extras) if (obstacleAhead(v.id, v.object.position.x, v.object.position.z, v.object.rotation.y, 40)) hits++;
    const perQuery = (realNow() - a) / (10 * extras.length);
    console.log(
      `[collisions profile] ${physicsStats.vehicles} vehicles: collisions step ${(tEng / N).toFixed(3)} ms/frame ` +
      `(index rebuild + SAT overlaps + crash rules), traffic step incl. beams ${(tSim / N).toFixed(3)} ms/frame, ` +
      `${(queries / N).toFixed(0)} beam queries/frame, ${(perQuery * 1000).toFixed(2)} µs/query (${hits} hits)`,
    );
    expect(physicsStats.vehicles).toBeGreaterThanOrEqual(295);
    expect(tEng / N).toBeLessThan(3);
    sim.stop();
  });
});

/** Wall-clock ms (performance.now is mocked to the sim clock in these tests). */
function realNow() {
  const [sec, ns] = process.hrtime();
  return sec * 1000 + ns / 1e6;
}
