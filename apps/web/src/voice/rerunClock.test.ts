import { describe, expect, it } from "vitest";
import { createRerunClock } from "./rerunClock";

describe("createRerunClock", () => {
  it("measures time since the last re-run, so case time does not drift ahead on repeated re-runs", () => {
    let now = 1_000_000;
    const clock = createRerunClock(() => now);
    now += 60_000;
    expect(clock.elapsed()).toBe(60_000);
    clock.markRun();
    now += 30_000;
    // Since the last re-run, not since the page loaded (which would be 90 s and double-count the first minute).
    expect(clock.elapsed()).toBe(30_000);
  });
});
