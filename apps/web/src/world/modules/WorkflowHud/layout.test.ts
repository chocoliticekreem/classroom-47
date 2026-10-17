import { describe, expect, it } from "vitest";
import {
  bottomBandWidth,
  GUTTER,
  hudLayout,
  isEmbedSearch,
  MINIMAP_EXTENT,
  minimapRect,
  OPS_W,
  overlaps,
  panelTop,
  SCEN_W,
  toRect,
  TOAST_MAX_W,
} from "./layout";

const VIEWPORTS: [number, number][] = [
  [1280, 720],
  [1280, 800],
  [1440, 900],
  [1920, 1080],
];

// Worst cases the bottom band can hold: footer on two rows (46) + gap + a decision card whose
// option buttons wrapped (190).
const BAND_H = 46 + 8 + 190;

describe("hudLayout: no overlaps at common screen sizes", () => {
  for (const [vw, vh] of VIEWPORTS) {
    for (const topBarH of [52, 100]) {
      for (const opsOpen of [true, false]) {
        it(`${vw}x${vh}, top bar ${topBarH}px, ops ${opsOpen ? "open" : "collapsed"}`, () => {
          const l = hudLayout({ topBarH, opsOpen, minimap: true });
          const top = toRect(l.topBar, vw, vh, topBarH);
          const ops = toRect(l.ops, vw, vh);
          const scen = toRect(l.scenario, vw, vh);
          const band = toRect(l.bottomBand, vw, vh, BAND_H);
          const map = minimapRect(vh);

          const regions: Record<string, ReturnType<typeof toRect>> = { top, scen, band, map };
          if (opsOpen) regions.ops = ops;
          const names = Object.keys(regions);
          for (let i = 0; i < names.length; i++)
            for (let j = i + 1; j < names.length; j++)
              expect(overlaps(regions[names[i]], regions[names[j]]), `${names[i]} vs ${names[j]}`).toBe(false);

          // Everything stays on screen.
          for (const [n, r] of Object.entries(regions)) {
            expect(r.x0, n).toBeGreaterThanOrEqual(0);
            expect(r.x1, n).toBeLessThanOrEqual(vw);
            expect(r.y0, n).toBeGreaterThanOrEqual(0);
            expect(r.y1, n).toBeLessThanOrEqual(vh);
          }
          // The decision card fits its band at full width, and the panels keep a usable height.
          expect(bottomBandWidth(vw, l)).toBeGreaterThanOrEqual(TOAST_MAX_W);
          expect(scen.y1 - scen.y0).toBeGreaterThan(200);
          if (opsOpen) expect(ops.y1 - ops.y0).toBeGreaterThan(400);
        });
      }
    }
  }

  it("the scenario panel stops above the minimap", () => {
    const l = hudLayout({ topBarH: 52, opsOpen: true, minimap: true });
    expect(l.scenario.bottom).toBe(MINIMAP_EXTENT + GUTTER);
    expect(toRect(l.scenario, 1280, 720).y1).toBeLessThan(minimapRect(720).y0);
  });

  it("panels follow the measured top bar height (it may wrap)", () => {
    expect(panelTop(52)).toBe(GUTTER + 52 + 8);
    expect(hudLayout({ topBarH: 96, opsOpen: true, minimap: true }).ops.top).toBe(panelTop(96));
    expect(panelTop(-5)).toBe(GUTTER + 8);
  });

  it("the bottom band spans the full width left of a collapsed panel", () => {
    const l = hudLayout({ topBarH: 52, opsOpen: false, minimap: true });
    expect(l.bottomBand.right).toBe(GUTTER);
    const open = hudLayout({ topBarH: 52, opsOpen: true, minimap: true });
    expect(open.bottomBand.right).toBe(GUTTER + OPS_W + GUTTER);
  });

  it("without the minimap (embed) the left-hand regions reach the edge", () => {
    const l = hudLayout({ topBarH: 52, opsOpen: true, minimap: false });
    expect(l.bottomBand.left).toBe(GUTTER);
    expect(l.scenario.bottom).toBe(GUTTER);
    expect(l.scenario.width).toBe(SCEN_W);
  });
});

describe("toRect / overlaps", () => {
  it("handles left+width, right+width and stretched boxes", () => {
    expect(toRect({ left: 10, top: 5, width: 100, height: 20 }, 500, 400)).toEqual({ x0: 10, x1: 110, y0: 5, y1: 25 });
    expect(toRect({ right: 10, bottom: 5, width: 100 }, 500, 400, 30)).toEqual({ x0: 390, x1: 490, y0: 365, y1: 395 });
    expect(toRect({ left: 10, right: 10, top: 0, bottom: 0 }, 500, 400)).toEqual({ x0: 10, x1: 490, y0: 0, y1: 400 });
  });

  it("treats touching edges as not overlapping", () => {
    expect(overlaps({ x0: 0, y0: 0, x1: 10, y1: 10 }, { x0: 10, y0: 0, x1: 20, y1: 10 })).toBe(false);
    expect(overlaps({ x0: 0, y0: 0, x1: 10, y1: 10 }, { x0: 9, y0: 9, x1: 20, y1: 20 })).toBe(true);
  });
});

describe("isEmbedSearch", () => {
  it("detects ?embed=1 and friends", () => {
    expect(isEmbedSearch("?embed=1")).toBe(true);
    expect(isEmbedSearch("embed=true")).toBe(true);
    expect(isEmbedSearch("?stats=1&embed")).toBe(true);
    expect(isEmbedSearch("?embed=0")).toBe(false);
    expect(isEmbedSearch("")).toBe(false);
    expect(isEmbedSearch("?skip=Rail")).toBe(false);
  });
});
