import { afterEach, describe, expect, it } from "vitest";
import { allVehicles, getVehicle } from "../../registry";
import { ROAD_EDGES, getNode } from "../../roads";
import { pointSegDist } from "./geom2d";
import { MIXER_COUNT, MixerFleet, chooseNext, pullInPose, stopT } from "./mixers";
import { getSites } from "./sites";

const sites = getSites();
let fleet: MixerFleet | null = null;
afterEach(() => {
  fleet?.stop();
  fleet = null;
});

function run(f: MixerFleet, seconds: number, onStep?: () => void) {
  const dt = 0.05;
  let now = 0;
  for (let t = 0; t < seconds; t += dt) {
    now += dt * 1000;
    f.step(dt, now);
    onStep?.();
  }
}

function nearRoad(x: number, z: number, tol: number) {
  for (const e of ROAD_EDGES.values()) {
    const a = getNode(e.a);
    const b = getNode(e.b);
    if (pointSegDist(x, z, a.x, a.z, b.x, b.z) < tol) return true;
  }
  return false;
}

describe("mixer helpers", () => {
  it("stops ~10 m short of the gate node", () => {
    expect((1 - stopT(100)) * 100).toBeCloseTo(10);
    expect(stopT(8)).toBeGreaterThanOrEqual(0.3);
  });

  it("pull-in curve starts on the road pose and ends on the pad pose", () => {
    const a = { x: 0, z: 0, h: 0 };
    const b = { x: 12, z: 14, h: Math.PI / 2 };
    const o = { x: 0, z: 0, h: 0 };
    pullInPose(a, b, 0, o);
    expect(o.x).toBeCloseTo(0);
    expect(o.h).toBeCloseTo(0);
    pullInPose(a, b, 1, o);
    expect(o.x).toBeCloseTo(12);
    expect(o.z).toBeCloseTo(14);
    expect(o.h).toBeCloseTo(Math.PI / 2);
  });

  it("never sends a mixer to its own site or a busy pad", () => {
    const busy = new Set(sites.flatMap((_, i) => (i === 1 ? [] : [`${i}:0`, `${i}:1`])));
    const r = chooseNext(sites, 0, busy, new Set(), Math.random);
    expect(r?.[0]).toBe(1);
    expect(chooseNext(sites, 1, busy, new Set(), Math.random)).toBeNull();
  });
});

describe("mixer fleet", () => {
  it("registers every mixer as a truck, parked on a pad", () => {
    fleet = new MixerFleet(sites);
    fleet.start();
    const st = fleet.state();
    expect(st).toHaveLength(MIXER_COUNT);
    for (const m of st) {
      expect(getVehicle(m.id)?.kind).toBe("truck");
      expect(m.mode).toBe("pour");
    }
    const pads = new Set(st.map((m) => `${m.site}:${m.pad}`));
    expect(pads.size).toBe(MIXER_COUNT); // one mixer per pad
  });

  it("drives the roads between sites and pours at each", () => {
    fleet = new MixerFleet(sites);
    fleet.start();
    const f = fleet;
    const visits = new Map<string, Set<number>>();
    let drivingSamples = 0;
    let offRoad = 0;
    run(f, 420, () => {
      for (const m of f.state()) {
        expect(Number.isFinite(m.x) && Number.isFinite(m.z) && Number.isFinite(m.h)).toBe(true);
        if (m.mode === "pour") {
          if (!visits.has(m.id)) visits.set(m.id, new Set());
          visits.get(m.id)!.add(m.site);
        }
        if (m.mode === "drive") {
          drivingSamples++;
          if (!nearRoad(m.x, m.z, 6)) offRoad++;
        }
      }
    });
    expect(drivingSamples).toBeGreaterThan(1000);
    expect(offRoad / drivingSamples).toBeLessThan(0.01); // on the lane while driving
    const multi = [...visits.values()].filter((s) => s.size >= 2).length;
    expect(multi).toBeGreaterThanOrEqual(4); // most mixers reached another site
  });

  it("crashes only while driving on the road", () => {
    fleet = new MixerFleet(sites);
    fleet.start();
    const ids = fleet.state().map((m) => m.id);
    expect(getVehicle(ids[0])!.crash!()).toBe(false); // pouring on its pad
    run(fleet, 60);
    const driving = fleet.state().find((m) => m.mode === "drive");
    expect(driving).toBeTruthy();
    const v = getVehicle(driving!.id)!;
    expect(v.crash!()).toBe(true);
    expect(v.crash!()).toBe(false);
    run(fleet, 3);
    expect(fleet.state().find((m) => m.id === driving!.id)!.mode).toBe("crashed");
    expect(getVehicle(driving!.id)!.stopped).toBe(true);
  });

  it("unregisters on stop", () => {
    fleet = new MixerFleet(sites);
    fleet.start();
    fleet.stop();
    fleet = null;
    expect([...allVehicles()].filter((v) => v.id.startsWith("mixer"))).toHaveLength(0);
  });
});
