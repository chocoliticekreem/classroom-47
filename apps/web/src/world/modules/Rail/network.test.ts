import { describe, expect, it } from "vitest";
import { ROAD_EDGES } from "../../roads";
import { CROSSING, spanCovers } from "./crossing";
import { newTrainState } from "./motion";
import {
  H,
  LINES,
  gantrySites,
  halfSpacing,
  heightAt,
  lineById,
  onRailway,
  riverZAt,
  roadClearance,
  signalSites,
  styleRuns,
  trackLateral,
  trackPoint,
  viaductLayout,
  type TrackPoint,
} from "./network";
import { crossingCalled, createTrains, sampleTrain } from "./sim";

const tp: TrackPoint = { x: 0, y: 0, z: 0, h: 0 };

describe("railway network", () => {
  it("has the four lines with 4-6 passenger trains and 3 freight trains", () => {
    expect(LINES.map((l) => l.id)).toEqual(["west", "north", "east", "freight"]);
    const trains = createTrains();
    const freight = trains.filter((t) => t.line.spec.freight);
    expect(freight).toHaveLength(3);
    expect(trains.length - freight.length).toBeGreaterThanOrEqual(4);
    expect(trains.length - freight.length).toBeLessThanOrEqual(6);
  });

  it("serves 3-4 suburban stations besides the terminus", () => {
    const names = new Set(LINES.filter((l) => !l.spec.freight).flatMap((l) => l.stations.map((s) => s.name)));
    names.delete("King's Hamyway");
    expect(names.size).toBeGreaterThanOrEqual(3);
    expect(names.size).toBeLessThanOrEqual(4);
  });

  it("platforms are long enough for their trains", () => {
    for (const l of LINES) for (const st of l.stations) expect(st.s1 - st.s0).toBeGreaterThanOrEqual(l.trainLen);
  });

  it("only ever crosses a road at grade (level crossing) or high enough to bridge it", () => {
    for (const l of LINES)
      for (const c of l.roadCrossings) {
        const h = heightAt(l, c.s);
        expect(h < 0.5 || h > 5.8, `${l.id} crosses ${c.key} at ${h.toFixed(2)} m`).toBe(true);
      }
  });

  it("has one or two level crossings, each closing real road edges", () => {
    const lcs = LINES.flatMap((l) => l.levelCrossings);
    expect(lcs.length).toBeGreaterThanOrEqual(1);
    expect(lcs.length).toBeLessThanOrEqual(2);
    for (const lc of lcs) {
      expect(lc.edges.length).toBeGreaterThan(0);
      for (const e of lc.edges) expect(ROAD_EDGES.has(e)).toBe(true);
      expect(lc.note).toBe("Level crossing closed");
    }
  });

  it("crosses the river on the truss bridge, high above the water", () => {
    const north = lineById("north");
    expect(north.riverS).not.toBeNull();
    const [s0, s1] = north.riverS!;
    for (let s = s0; s <= s1; s += 5) expect(heightAt(north, s)).toBeCloseTo(H, 5);
    // the truss spans the full river width
    trackPoint(north, s0, 0, tp);
    expect(tp.z - riverZAt(tp.x)).toBeGreaterThan(35);
    trackPoint(north, s1, 0, tp);
    expect(riverZAt(tp.x) - tp.z).toBeGreaterThan(35);
    expect(styleRuns(north).some((r) => r.style === "truss")).toBe(true);
  });

  it("stays low enough under the airport approach (planes cross x -610 at about 19 m)", () => {
    const west = lineById("west");
    for (let s = 0; s < west.L; s += 2) {
      trackPoint(west, s, 0, tp);
      if (tp.x < -560 && Math.abs(tp.z - -412) < 25) expect(tp.y + 4.4 + 6.5).toBeLessThan(18);
    }
  });

  it("never stands a pier on a road", () => {
    for (const l of LINES)
      for (const run of styleRuns(l).filter((r) => r.style === "viaduct")) {
        const { piers, spans } = viaductLayout(l, run.s0, run.s1);
        expect(spans.length).toBe(piers.length - 1);
        for (const s of piers.slice(1, -1)) {
          trackPoint(l, s, 0, tp);
          expect(roadClearance(tp.x, tp.z), `${l.id} pier at s=${s.toFixed(1)}`).toBeGreaterThan(1);
        }
      }
  });

  it("keeps trains on the same line apart over a whole cycle", () => {
    const trains = createTrains();
    const a = newTrainState();
    const b = newTrainState();
    for (const line of LINES) {
      const mine = trains.filter((t) => t.line === line);
      if (mine.length < 2) continue;
      for (let t = 0; t < line.schedule.cycle; t += 0.5)
        for (let i = 0; i < mine.length; i++)
          for (let j = i + 1; j < mine.length; j++) {
            sampleTrain(mine[i], t, a);
            sampleTrain(mine[j], t, b);
            const overlap = a.s + mine[i].len / 2 + 15 > b.s - mine[j].len / 2 && b.s + mine[j].len / 2 + 15 > a.s - mine[i].len / 2;
            if (!overlap) continue;
            // overlapping in s: must be on different tracks along the whole overlap
            const lo = Math.max(a.s - mine[i].len / 2, b.s - mine[j].len / 2) - 15;
            const hi = Math.min(a.s + mine[i].len / 2, b.s + mine[j].len / 2) + 15;
            for (let s = lo; s <= hi; s += 2) {
              const gap = Math.abs(trackLateral(line, s, a.dir) - trackLateral(line, s, b.dir));
              expect(gap, `${line.id} t=${t} s=${s.toFixed(0)}`).toBeGreaterThan(3.5);
            }
          }
    }
  });

  it("never parks a train on a level crossing", () => {
    for (const l of LINES)
      for (const lc of l.levelCrossings)
        for (const stop of l.stops) expect(spanCovers(stop.s - l.trainLen / 2, stop.s + l.trainLen / 2, lc.s, CROSSING.margin + 3)).toBe(false);
  });

  it("closes each level crossing briefly for every train and reopens it in between", () => {
    const trains = createTrains();
    for (const l of LINES)
      for (const lc of l.levelCrossings) {
        const closures: number[] = [];
        let since = -1;
        const dt = 0.25;
        for (let t = 0; t < l.schedule.cycle * 2; t += dt) {
          const called = crossingCalled(lc, trains, t);
          if (called && since < 0) since = t;
          if (!called && since >= 0) {
            if (since > 0) closures.push(t - since);
            since = -1;
          }
        }
        expect(closures.length).toBeGreaterThanOrEqual(l.consists.length + 1);
        const longest = Math.max(...closures);
        const shortest = Math.min(...closures);
        expect(shortest).toBeGreaterThan(CROSSING.warn);
        // EMU: about 8 s; a long slow freight takes ~20 s, and two passing each other keep it down ~35 s
        expect(longest).toBeLessThan(l.spec.freight ? 40 : 13);
      }
  });

  it("uses double track with island platforms and single track onto the Shoreditch viaduct", () => {
    const west = lineById("west");
    const park = west.stations.find((s) => s.name === "Airport Parkway")!;
    expect(halfSpacing(west, park.s)).toBeCloseTo(4.25, 5);
    expect(halfSpacing(west, park.s - 150)).toBeCloseTo(2.25, 5);
    const east = lineById("east");
    expect(halfSpacing(east, east.L - 5)).toBe(0);
    // out-bound trains keep left (+), back-bound on the other track
    expect(trackLateral(west, 400, 1)).toBeGreaterThan(0);
    expect(trackLateral(west, 400, -1)).toBeLessThan(0);
    // and both tracks meet the terminus platform road on the same side for the reversal
    expect(trackLateral(west, 20, 1)).toBeCloseTo(trackLateral(west, 20, -1), 5);
    expect(trackLateral(west, west.L - 20, 1)).toBeCloseTo(trackLateral(west, west.L - 20, -1), 5);
  });

  it("has signals both ways and overhead line gantries on the electrified lines", () => {
    for (const l of LINES) {
      const sig = signalSites(l);
      expect(sig.some((s) => s.dir > 0)).toBe(true);
      expect(sig.some((s) => s.dir < 0)).toBe(true);
      expect(gantrySites(l).length > 0).toBe(l.spec.catenary);
    }
  });

  it("publishes keep-out boxes that cover the track", () => {
    for (const l of LINES)
      for (let s = 0; s < Math.min(l.L, l.externalS); s += 25) {
        trackPoint(l, s, 0, tp);
        expect(onRailway(tp.x, tp.z, 0)).toBe(true);
      }
    expect(onRailway(0, 0, 0)).toBe(false);
  });
});
