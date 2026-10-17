import { describe, expect, it } from "vitest";
import {
  approach, dollyDistance, wheelAction, PINCH_GAIN, FOLLOW_DIST, easeInOutCubic, framePosition, pickTourShot, poseIsSane, wheelDollyLog, wheelPixels, zoneFrame,
  CONTROL_TUNING, HOME_POS, HOME_TARGET, HOTKEYS, INTRO_POS, MAX_DIST, MAX_POLAR, MIN_DIST, WORLD_HALF, type TourIncident,
} from "./logic";

describe("easeInOutCubic", () => {
  it("maps endpoints and midpoint, clamps outside 0..1", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
    expect(easeInOutCubic(-1)).toBe(0);
    expect(easeInOutCubic(2)).toBe(1);
  });
});

describe("framePosition", () => {
  it("places the camera at the given distance and elevation from the target", () => {
    const [x, y, z] = framePosition(10, 0, 20, 0, Math.PI / 4, 100);
    const d = Math.hypot(x - 10, y, z - 20);
    expect(d).toBeCloseTo(100);
    expect(y).toBeCloseTo(100 * Math.sin(Math.PI / 4));
    // azimuth 0 means the camera sits on the +z side of the target
    expect(x).toBeCloseTo(10);
    expect(z).toBeGreaterThan(20);
  });
});

describe("zoneFrame", () => {
  it("centres on the zone box and scales distance with zone size", () => {
    const f = zoneFrame("docks");
    expect(f.x).toBe(290);
    expect(f.z).toBe(0);
    expect(zoneFrame("downtown").distance).toBeGreaterThan(f.distance);
  });
});

describe("pickTourShot", () => {
  const inc = (id: string, createdAt: number, status: TourIncident["status"] = "active"): TourIncident => ({
    id, kind: "car_crash", x: 1, z: 2, status, createdAt,
  });

  it("shows the newest unseen active incident on odd steps", () => {
    const shot = pickTourShot(1, [inc("a", 1), inc("b", 5), inc("c", 3)], new Set());
    expect(shot).toEqual({ kind: "incident", id: "b", x: 1, z: 2 });
    const next = pickTourShot(3, [inc("a", 1), inc("b", 5), inc("c", 3)], new Set(["b"]));
    expect(next).toMatchObject({ kind: "incident", id: "c" });
  });

  it("falls back to the newest incident when all have been seen", () => {
    expect(pickTourShot(1, [inc("a", 1), inc("b", 5)], new Set(["a", "b"]))).toMatchObject({ id: "b" });
  });

  it("ignores cleared incidents and cycles scenic shots", () => {
    const kinds = [0, 1, 2, 3, 4, 5].map((s) => pickTourShot(s, [inc("x", 1, "cleared")], new Set()).kind);
    expect(kinds).not.toContain("incident");
    expect(new Set(kinds)).toEqual(new Set(["chase", "skyline", "docks", "roadworks"]));
  });

  it("uses scenic shots on even steps even when incidents exist", () => {
    expect(pickTourShot(2, [inc("a", 1)], new Set()).kind).not.toBe("incident");
  });
});

describe("HOTKEYS", () => {
  it("lists every bound key", () => {
    const keys = HOTKEYS.map((h) => h.keys).join(" ");
    for (const k of ["WASD", "Q", "E", "R", "F", "1", "V", "C", "Esc"]) expect(keys).toContain(k);
  });
});

describe("calm tuning", () => {
  it("uses gentle control speeds", () => {
    expect(CONTROL_TUNING.panSpeed).toBeLessThanOrEqual(0.6);
    expect(CONTROL_TUNING.rotateSpeed).toBeLessThanOrEqual(0.4);
    expect(CONTROL_TUNING.zoomSpeed).toBeLessThanOrEqual(0.5);
  });
});

describe("wheel zoom", () => {
  it("normalises line and page deltas to pixels", () => {
    expect(wheelPixels(3, 1)).toBe(48);
    expect(wheelPixels(1, 2)).toBe(400);
    expect(wheelPixels(7, 0)).toBe(7);
  });
  it("is proportional to the delta, so small trackpad deltas glide", () => {
    const small = wheelDollyLog(4, 0, false, 300);
    const big = wheelDollyLog(40, 0, false, 300);
    expect(small).toBeGreaterThan(0);
    expect(big).toBeCloseTo(small * 10);
    expect(wheelDollyLog(-40, 0, false, 300)).toBeCloseTo(-big);
  });
  it("caps a single event so a mouse flick can't jump", () => {
    expect(wheelDollyLog(5000, 0, false, 300)).toBeLessThanOrEqual(0.22);
    expect(wheelDollyLog(-50, 1, false, 300)).toBeGreaterThanOrEqual(-0.22);
  });
  it("gives pinch more gain; plain scroll is softer far out", () => {
    expect(wheelDollyLog(3, 0, true, 300)).toBeGreaterThan(wheelDollyLog(3, 0, false, 300));
    expect(wheelDollyLog(20, 0, false, MAX_DIST)).toBeLessThan(wheelDollyLog(20, 0, false, 100));
  });
  it("a typical 0.5 s pinch (30 events x 4 px) zooms about 2x at any distance", () => {
    for (const d of [60, 300, 1200]) {
      let log = 0;
      for (let i = 0; i < 30; i++) log += wheelDollyLog(4, 0, true, d);
      expect(Math.exp(log)).toBeGreaterThan(1.8);
      expect(Math.exp(log)).toBeLessThan(2.3);
    }
    expect(PINCH_GAIN).toBeGreaterThan(0);
  });
  it("ignores garbage input", () => {
    expect(wheelDollyLog(NaN, 0, false, 300)).toBe(0);
    expect(wheelDollyLog(10, 0, false, NaN)).toBe(0);
  });
  it("clamps the resulting distance", () => {
    expect(dollyDistance(30, -5)).toBe(MIN_DIST);
    expect(dollyDistance(1300, 5)).toBe(MAX_DIST);
    expect(dollyDistance(100, Math.log(2))).toBeCloseTo(200);
  });
});

describe("approach", () => {
  it("eases toward the goal frame-rate independently", () => {
    const one = approach(0, 1, 8, 0.1);
    let two = approach(0, 1, 8, 0.05);
    two = approach(two, 1, 8, 0.05);
    expect(one).toBeCloseTo(two);
    expect(approach(0, 1, 8, 10)).toBeCloseTo(1);
  });
});

describe("home / reset pose", () => {
  const v = (a: readonly number[]) => ({ x: a[0], y: a[1], z: a[2] });
  it("is sane and within control limits", () => {
    for (const p of [HOME_POS, INTRO_POS]) {
      expect(poseIsSane(v(p), v(HOME_TARGET))).toBe(true);
      const d = Math.hypot(p[0] - HOME_TARGET[0], p[1] - HOME_TARGET[1], p[2] - HOME_TARGET[2]);
      expect(d).toBeGreaterThan(MIN_DIST);
      expect(d).toBeLessThan(MAX_DIST);
      // polar angle from straight up must be inside maxPolarAngle
      expect(Math.acos((p[1] - HOME_TARGET[1]) / d)).toBeLessThan(MAX_POLAR);
    }
    expect(Math.abs(HOME_TARGET[0])).toBeLessThan(WORLD_HALF);
  });
  it("rejects NaN, infinite and degenerate poses", () => {
    expect(poseIsSane({ x: NaN, y: 1, z: 1 }, { x: 0, y: 0, z: 0 })).toBe(false);
    expect(poseIsSane({ x: 1, y: 1, z: 1 }, { x: Infinity, y: 0, z: 0 })).toBe(false);
    expect(poseIsSane({ x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: 1 })).toBe(false);
  });
});

describe("wheelAction", () => {
  it("pinch always blocks page zoom and zooms the camera, even over HUD panels", () => {
    expect(wheelAction({ ctrl: true, overCanvas: true, overScrollableHud: false })).toEqual({ prevent: true, zoom: true });
    expect(wheelAction({ ctrl: true, overCanvas: false, overScrollableHud: false })).toEqual({ prevent: true, zoom: true });
  });
  it("pinch over a scrollable HUD list blocks page zoom but leaves the camera alone", () => {
    expect(wheelAction({ ctrl: true, overCanvas: false, overScrollableHud: true })).toEqual({ prevent: true, zoom: false });
  });
  it("plain scroll zooms over the canvas and scrolls HUD lists normally", () => {
    expect(wheelAction({ ctrl: false, overCanvas: true, overScrollableHud: false })).toEqual({ prevent: true, zoom: true });
    expect(wheelAction({ ctrl: false, overCanvas: false, overScrollableHud: true })).toEqual({ prevent: false, zoom: false });
    expect(wheelAction({ ctrl: false, overCanvas: false, overScrollableHud: false })).toEqual({ prevent: false, zoom: false });
  });
});

describe("follow distance", () => {
  it("starts inside its limits and dolly can move it both ways", () => {
    expect(FOLLOW_DIST.initial).toBeGreaterThan(FOLLOW_DIST.min);
    expect(FOLLOW_DIST.initial).toBeLessThan(FOLLOW_DIST.max);
  });
});
