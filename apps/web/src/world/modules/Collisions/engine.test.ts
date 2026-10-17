import { Object3D } from "three";
import { afterEach, describe, expect, it } from "vitest";
import { on, type WorldEvent } from "../../bus";
import { registerVehicle, type VehicleEntry, type VehicleKind } from "../../registry";
import { separation } from "../../physics";
import { useWorld } from "../../store";
import { CollisionEngine } from "./engine";

const offs: (() => void)[] = [];
afterEach(() => {
  for (const o of offs.splice(0)) o();
  useWorld.setState({ blocked: {}, incidents: [] });
});

function car(id: string, x: number, z: number, h: number, speed: number, kind: VehicleKind = "car", accept = true): VehicleEntry & { crashed: number } {
  const object = new Object3D();
  object.position.set(x, 0, z);
  object.rotation.y = h;
  const v = { id, kind, object, edgeKey: `e-${id}`, from: null, to: null, t: 0, speed, stopped: speed < 0.3, crashed: 0 } as VehicleEntry & { crashed: number };
  v.crash = () => {
    if (!accept || v.crashed) return false;
    expect(object.userData.impulse).toBeDefined();
    v.crashed++;
    v.stopped = true;
    v.speed = 0;
    return true;
  };
  offs.push(registerVehicle(v));
  return v;
}

/** Two cars rear-ending each other at (x, 0). */
function rearEnd(tag: string, x: number, speed = 14) {
  return [car(`${tag}a`, x, 0, 0, speed), car(`${tag}b`, x, 4, 0, 0)];
}

describe("CollisionEngine", () => {
  it("turns a fast overlap into a crash with incident, closure and events", () => {
    const events: WorldEvent[] = [];
    offs.push(on((e) => events.push(e)));
    const fx: number[] = [];
    const eng = new CollisionEngine((x) => fx.push(x));
    const [a, b] = rearEnd("r", 0);
    eng.step(1000, false);
    expect(a.crashed).toBe(1);
    expect(b.crashed).toBe(1);
    const inc = useWorld.getState().incidents;
    expect(inc).toHaveLength(1);
    expect(inc[0].kind).toBe("car_crash");
    expect(inc[0].note).toMatch(/car ra-?\w* .*into a stopped car/i);
    expect(useWorld.getState().blocked[inc[0].edgeKey]).toBeDefined();
    expect(events.map((e) => e.type)).toEqual(["road:blocked", "incident:created", "vehicle:crashed", "vehicle:crashed"]);
    expect(fx).toHaveLength(1);
    expect(eng.stats.crashes).toBe(1);
  });

  it("uses truck_crash when a lorry is involved", () => {
    const eng = new CollisionEngine();
    car("t1", 0, 0, 0, 15, "truck");
    car("t2", 0, 7, 0, 0);
    eng.step(0, false);
    expect(useWorld.getState().incidents[0].kind).toBe("truck_crash");
  });

  it("rate-limits to one crash per 20 s, dedupes pairs and caps active crashes at 3", () => {
    const eng = new CollisionEngine();
    rearEnd("p", 0);
    eng.step(0, false);
    expect(eng.stats.crashes).toBe(1);
    // same pair again (still overlapping, now both stopped): nothing new
    eng.step(30_000, false);
    expect(eng.stats.crashes).toBe(1);

    rearEnd("q", 100);
    eng.step(10_000 + 30_000, false); // 10 s after... the first crash was at 0, so this is 40 s: allowed
    expect(eng.stats.crashes).toBe(2);
    rearEnd("s", 200);
    eng.step(45_000, false); // 5 s after the second: rate-limited
    expect(eng.stats.crashes).toBe(2);
    expect(eng.stats.suppressed).toBeGreaterThan(0);
    eng.step(60_000, false); // the s pair is still overlapping and fast -> allowed now
    expect(eng.stats.crashes).toBe(3);
    rearEnd("u", 300);
    eng.step(90_000, false); // 3 active: capped
    expect(eng.stats.crashes).toBe(3);
    // clear one -> room again
    const first = useWorld.getState().incidents[0].id;
    useWorld.getState().updateIncident(first, { status: "cleared" });
    eng.step(91_000, false);
    expect(eng.stats.crashes).toBe(4);
  });

  it("slow overlaps only get a separation hint, pushing the mover off the stopped one", () => {
    const eng = new CollisionEngine();
    car("s1", 0, 0, 0, 2);
    car("s2", 0, 4, 0, 0);
    eng.step(0, false);
    expect(eng.stats.crashes).toBe(0);
    expect(eng.stats.slowOverlaps).toBe(1);
    const p = separation("s1");
    expect(p).not.toBeNull();
    expect(p!.z).toBeLessThan(0);
    expect(separation("s2")).toBeNull();
  });

  it("no incident when neither vehicle accepts crash()", () => {
    const eng = new CollisionEngine();
    car("n1", 0, 0, 0, 14, "police", false);
    car("n2", 0, 4, 0, 0, "car", false);
    eng.step(0, false);
    expect(eng.stats.crashes).toBe(0);
    expect(eng.stats.refused).toBe(1);
    expect(useWorld.getState().incidents).toHaveLength(0);
  });
});
