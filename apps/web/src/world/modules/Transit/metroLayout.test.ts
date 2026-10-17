import { describe, expect, it } from "vitest";
import { ROAD_NODES } from "../../roads";
import { METRO_LINES, buildTrack, pillarSites, projectS, trackPose, type TrackPose } from "./metroLayout";

const RESERVED: [number, number][] = [[-140, 140], [140, -140], [-140, -140], [20, 20], [140, 20]];
const pose: TrackPose = { x: 0, z: 0, h: 0 };

describe("track geometry", () => {
  it("a straight track has the polyline length and constant heading", () => {
    const t = buildTrack([[0, 0], [100, 0]], 20);
    expect(t.length).toBeCloseTo(100, 0);
    trackPose(t, 50, pose);
    expect(pose.x).toBeCloseTo(50, 1);
    expect(pose.z).toBeCloseTo(0, 3);
    expect(pose.h).toBeCloseTo(Math.PI / 2, 3); // facing +x
  });
  it("rounds a right-angle corner with the given radius", () => {
    const t = buildTrack([[0, 0], [100, 0], [100, 100]], 20);
    // two straights of 80 plus a quarter circle of radius 20
    expect(t.length).toBeCloseTo(80 + 80 + (Math.PI / 2) * 20, 0);
    // nothing cuts closer to the corner than ~ r*(sqrt2-1)
    let minD = Infinity;
    for (let s = 0; s <= t.length; s += 0.5) {
      trackPose(t, s, pose);
      minD = Math.min(minD, Math.hypot(pose.x - 100, pose.z));
    }
    expect(minD).toBeGreaterThan(20 * (Math.SQRT2 - 1) - 0.3);
    expect(minD).toBeLessThan(20 * (Math.SQRT2 - 1) + 0.3);
  });
  it("projects points back to their arc length", () => {
    const t = buildTrack([[0, 0], [100, 0]], 20);
    expect(projectS(t, 30, 5)).toBeCloseTo(30, 0);
  });
});

describe("metro lines", () => {
  it("has a red and a blue line with 4-5 stations each", () => {
    expect(METRO_LINES.map((l) => l.id)).toEqual(["red", "blue"]);
    for (const l of METRO_LINES) {
      expect(l.stations.length).toBeGreaterThanOrEqual(4);
      expect(l.stations.length).toBeLessThanOrEqual(5);
    }
    const names = METRO_LINES.flatMap((l) => l.stations.map((s) => s.name));
    for (const n of ["Canary Wharf", "Bank", "Docklands", "Hamyway Cross"]) expect(names).toContain(n);
  });
  it("stations are ordered along the track, sit on it, and have room for a train", () => {
    for (const l of METRO_LINES) {
      const t = buildTrack(l.points, l.radius);
      let prev = -Infinity;
      for (const st of l.stations) {
        const s = projectS(t, st.x, st.z);
        trackPose(t, s, pose);
        expect(Math.hypot(pose.x - st.x, pose.z - st.z)).toBeLessThan(0.5);
        expect(s).toBeGreaterThan(prev + 40);
        expect(s).toBeGreaterThan(16);
        expect(s).toBeLessThan(t.length - 16);
        prev = s;
      }
    }
  });
  it("stays clear of the reserved landmark cells", () => {
    for (const l of METRO_LINES) {
      const t = buildTrack(l.points, l.radius);
      for (let s = 0; s <= t.length; s += 2) {
        trackPose(t, s, pose);
        for (const [cx, cz] of RESERVED) {
          const inside = Math.abs(pose.x - cx) < 20 && Math.abs(pose.z - cz) < 20;
          expect(inside, `${l.id} at ${pose.x},${pose.z}`).toBe(false);
        }
      }
    }
  });
  it("the two lines are at different heights so they can cross", () => {
    expect(Math.abs(METRO_LINES[0].height - METRO_LINES[1].height)).toBeGreaterThan(4);
  });
  it("one line reaches out of downtown toward the docks or depot", () => {
    const far = METRO_LINES.some((l) => l.points.some(([x, z]) => x > 180 || z > 180));
    expect(far).toBe(true);
  });
});

describe("pillars", () => {
  it("are spaced along the track and never stand in a junction", () => {
    for (const l of METRO_LINES) {
      const t = buildTrack(l.points, l.radius);
      const sites = pillarSites(t, 20);
      expect(sites.length).toBeGreaterThan(t.length / 30);
      for (const s of sites) {
        trackPose(t, s, pose);
        for (const n of ROAD_NODES.values()) expect(Math.hypot(n.x - pose.x, n.z - pose.z)).toBeGreaterThan(7);
      }
    }
  });
});
