import { describe, expect, it } from "vitest";
import { inBox, ZONES } from "../../config";
import { CRASH_SITES, EMERGENCY_STOP_X, HOLD, RWY, STAND_Z, STANDS, TOUCHDOWN_X } from "./layout";
import type { Path } from "./path";
import { v3 } from "./path";
import { DISTRICT_TARGETS, pickCrashSite } from "./layout";
import {
  doomedPath,
  approachEntry,
  approachPath,
  climbPath,
  crashPath,
  decisionDistance,
  emergencyApproachPath,
  emergencyRolloutPath,
  goAroundPath,
  lineupPath,
  pushbackPath,
  rolloutPath,
  takeoffRollPath,
  taxiInPath,
  taxiOutPath,
  towPath,
} from "./routes";

const pt = v3(0, 0, 0);
function everyPoint(p: Path, f: (x: number, y: number, z: number) => void) {
  for (let d = 0; d <= p.length; d += 2) {
    p.sample(d, pt);
    f(pt.x, pt.y, pt.z);
  }
}

describe("approach", () => {
  const path = approachPath(approachEntry(() => 0.5));

  it("ends at the touchdown point on the runway centreline", () => {
    expect(path.end.x).toBeCloseTo(TOUCHDOWN_X);
    expect(path.end.z).toBeCloseTo(RWY.z);
    expect(path.end.y).toBe(0);
  });

  it("descends steadily on the final approach (glide slope), never below ground", () => {
    let last = Infinity;
    const finalFrom = path.length - 700;
    for (let d = finalFrom; d <= path.length; d += 5) {
      path.sample(d, pt);
      expect(pt.y).toBeLessThanOrEqual(last + 1e-6);
      expect(pt.y).toBeGreaterThanOrEqual(0);
      last = pt.y;
    }
    // glide slope a few degrees: ~25-45 m high 500 m out
    path.sample(path.length - 500, pt);
    expect(pt.y).toBeGreaterThan(20);
    expect(pt.y).toBeLessThan(60);
  });

  it("has a decision point a few hundred metres before touchdown", () => {
    const d = decisionDistance(path);
    expect(path.length - d).toBeGreaterThan(200);
    path.sample(d, pt);
    expect(pt.x).toBeLessThan(RWY.x0 - 150);
  });

  it("starts far off the map", () => {
    expect(Math.hypot(path.start.x, path.start.z)).toBeGreaterThan(1200);
  });

  it("emergency approach lands long and stops on the runway", () => {
    const e = emergencyApproachPath(approachEntry(() => 0.2));
    expect(e.end.x).toBeGreaterThan(TOUCHDOWN_X + 20);
    const r = emergencyRolloutPath();
    expect(r.start.x).toBeCloseTo(e.end.x);
    expect(r.end.x).toBeCloseTo(EMERGENCY_STOP_X);
    expect(r.end.z).toBeCloseTo(RWY.z);
  });
});

describe("ground routes", () => {
  const all: [string, Path][] = [["rollout", rolloutPath()], ["lineup", lineupPath()], ["takeoff", takeoffRollPath()]];
  for (const s of STANDS) {
    all.push([`in ${s.id}`, taxiInPath(s)], [`push ${s.id}`, pushbackPath(s)], [`out ${s.id}`, taxiOutPath(s)], [`tow ${s.id}`, towPath(s)]);
  }

  it("stay on the ground and inside the airport zone", () => {
    for (const [, p] of all)
      everyPoint(p, (x, y, z) => {
        expect(y).toBe(0);
        expect(inBox(ZONES.airport, x, z)).toBe(true);
      });
  });

  it("chain together: rollout -> taxi in -> stand, pushback -> taxi out -> hold -> lineup -> takeoff", () => {
    for (const s of STANDS) {
      const tin = taxiInPath(s);
      expect(tin.start).toEqual(rolloutPath().end);
      expect(tin.end.x).toBeCloseTo(s.x);
      expect(tin.end.z).toBeCloseTo(STAND_Z);
      const push = pushbackPath(s);
      expect(push.start).toEqual(tin.end);
      const out = taxiOutPath(s);
      expect(out.start.x).toBeCloseTo(push.end.x);
      expect(out.start.z).toBeCloseTo(push.end.z);
      expect(out.end.x).toBeCloseTo(HOLD.x);
      expect(out.end.z).toBeCloseTo(HOLD.z);
      expect(towPath(s).end).toEqual(tin.end);
    }
    expect(lineupPath().end).toEqual(takeoffRollPath().start);
  });

  it("rollout leaves the runway (ends south of the runway edge)", () => {
    expect(rolloutPath().end.z).toBeGreaterThan(RWY.z + RWY.halfW);
  });
});

describe("air routes", () => {
  it("climb-outs start on the runway and leave the map", () => {
    for (let v = 0; v < 3; v++) {
      const c = climbPath(v);
      expect(c.start).toEqual(takeoffRollPath().end);
      expect(Math.hypot(c.end.x, c.end.z)).toBeGreaterThan(1200);
      expect(c.end.y).toBeGreaterThan(100);
    }
  });

  it("go-around climbs from where the plane is", () => {
    const g = goAroundPath(v3(-800, 40, RWY.z), v3(1, -0.1, 0));
    expect(g.start).toEqual(v3(-800, 40, RWY.z));
    everyPoint(g, (_x, y) => expect(y).toBeGreaterThanOrEqual(39));
    expect(Math.hypot(g.end.x, g.end.z)).toBeGreaterThan(1200);
  });

  it("crash path comes down at the site", () => {
    for (const s of CRASH_SITES) {
      const c = crashPath(v3(-900, 60, RWY.z), v3(1, 0, 0), s);
      expect(c.end.x).toBeCloseTo(s.x);
      expect(c.end.z).toBeCloseTo(s.z);
      expect(c.end.y).toBe(0);
      everyPoint(c, (_x, y) => expect(y).toBeGreaterThanOrEqual(0));
    }
  });

  it("doomed jet path: comes from the sky, ~9 s at 55 m/s, ends at the target", () => {
    const sites = [...CRASH_SITES, ...DISTRICT_TARGETS, pickCrashSite(() => 0.5), pickCrashSite(() => 0.3)];
    for (const s of sites) {
      const p = doomedPath(s);
      expect(p.start.y).toBeGreaterThan(120);
      expect(p.length / 55).toBeGreaterThan(7.5);
      expect(p.length / 55).toBeLessThan(11);
      expect(p.end).toEqual(v3(s.x, 0, s.z));
      everyPoint(p, (_x, y) => expect(y).toBeGreaterThanOrEqual(0));
    }
  });
});
