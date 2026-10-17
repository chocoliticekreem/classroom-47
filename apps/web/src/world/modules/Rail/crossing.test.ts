import { describe, expect, it } from "vitest";
import { CROSSING, barrierDown, lightsOn, newCrossingTimes, roadClosed, spanCovers, updateCrossing } from "./crossing";

describe("level crossing timing", () => {
  it("lights first, barriers after a delay, road closed throughout", () => {
    const c = newCrossingTimes();
    expect(roadClosed(c, 0)).toBe(false);
    expect(barrierDown(c, 0)).toBe(0);
    expect(updateCrossing(c, true, 10)).toBe(true);
    expect(updateCrossing(c, true, 10.5)).toBe(false); // no change, no store write
    expect(lightsOn(c)).toBe(true);
    expect(roadClosed(c, 10)).toBe(true);
    expect(barrierDown(c, 10 + CROSSING.lowerDelay - 0.1)).toBe(0);
    expect(barrierDown(c, 10 + CROSSING.lowerDelay + CROSSING.lowerTime / 2)).toBeCloseTo(0.5, 5);
    expect(barrierDown(c, 10 + CROSSING.lowerDelay + CROSSING.lowerTime)).toBe(1);
  });

  it("raises the barriers when the train has cleared and reopens the road once they are up", () => {
    const c = newCrossingTimes();
    updateCrossing(c, true, 0);
    updateCrossing(c, false, 8);
    expect(lightsOn(c)).toBe(false);
    expect(barrierDown(c, 8)).toBe(1);
    expect(roadClosed(c, 8 + CROSSING.raiseTime / 2)).toBe(true);
    expect(barrierDown(c, 8 + CROSSING.raiseTime / 2)).toBeCloseTo(0.5, 5);
    expect(roadClosed(c, 8 + CROSSING.raiseTime + 0.01)).toBe(false);
    expect(barrierDown(c, 8 + CROSSING.raiseTime + 0.01)).toBe(0);
  });

  it("a very short call raises from wherever the barriers had got to", () => {
    const c = newCrossingTimes();
    updateCrossing(c, true, 0);
    const t = CROSSING.lowerDelay + CROSSING.lowerTime * 0.4;
    updateCrossing(c, false, t);
    expect(barrierDown(c, t)).toBeCloseTo(0.4, 5);
    expect(barrierDown(c, t + CROSSING.raiseTime / 2)).toBeCloseTo(0.2, 5);
  });

  it("a train is on the crossing when its body overlaps the crossing plus margin", () => {
    expect(spanCovers(100, 200, 150)).toBe(true);
    expect(spanCovers(100, 200, 200 + CROSSING.margin - 0.1)).toBe(true);
    expect(spanCovers(100, 200, 200 + CROSSING.margin + 0.1)).toBe(false);
    expect(spanCovers(100, 200, 100 - CROSSING.margin - 0.1)).toBe(false);
  });
});
