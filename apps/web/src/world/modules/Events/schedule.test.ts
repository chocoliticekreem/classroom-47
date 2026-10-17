import { describe, expect, it } from "vitest";
import { forceEnd, isClosureKind, isNightHour, newLife, Scheduler, SCHEDULE, stepLife, type EventKind } from "./schedule";

describe("Scheduler", () => {
  it("starts with the motorcade, then one event every 3-5 minutes", () => {
    const s = new Scheduler(7, 0);
    expect(s.poll(SCHEDULE.firstMs - 1, 12, false)).toBeNull();
    expect(s.poll(SCHEDULE.firstMs, 12, false)).toBe("motorcade");
    const gap = s.next - SCHEDULE.firstMs;
    expect(gap).toBeGreaterThanOrEqual(SCHEDULE.minGapMs);
    expect(gap).toBeLessThanOrEqual(SCHEDULE.maxGapMs);
  });

  it("is deterministic for a seed", () => {
    const run = (seed: number) => {
      const s = new Scheduler(seed, 0);
      const out: (EventKind | null)[] = [];
      for (let t = 0; t < 3_600_000; t += 1000) {
        const k = s.poll(t, 21, false);
        if (k) out.push(k);
      }
      return out;
    };
    expect(run(42)).toEqual(run(42));
  });

  it("never schedules fireworks by day", () => {
    const s = new Scheduler(3, 0);
    for (let t = 0; t < 7_200_000; t += 1000) expect(s.poll(t, 13, false)).not.toBe("fireworks");
  });

  it("schedules fireworks at night", () => {
    const s = new Scheduler(3, 0);
    const kinds = new Set<EventKind>();
    for (let t = 0; t < 7_200_000; t += 1000) {
      const k = s.poll(t, 22, false);
      if (k) kinds.add(k);
    }
    expect(kinds.has("fireworks")).toBe(true);
  });

  it("never starts a second closure event while one is live", () => {
    const s = new Scheduler(9, 0);
    for (let t = 0; t < 7_200_000; t += 1000) {
      const k = s.poll(t, 12, true);
      expect(k === null || !isClosureKind(k)).toBe(true);
    }
  });

  it("knows night", () => {
    expect(isNightHour(21)).toBe(true);
    expect(isNightHour(3)).toBe(true);
    expect(isNightHour(12)).toBe(false);
  });
});

describe("event lifecycle", () => {
  it("planned -> live -> ended when the show finishes", () => {
    const l = newLife(0, 5000, 60_000);
    expect(l.phase).toBe("planned");
    expect(stepLife(l, 4000, false)).toBeNull();
    expect(stepLife(l, 5000, false)).toBe("go_live");
    expect(l.phase).toBe("live");
    expect(stepLife(l, 10_000, false)).toBeNull();
    expect(stepLife(l, 11_000, true)).toBe("end");
    expect(l.phase).toBe("ended");
    expect(l.endedAt).toBe(11_000);
    expect(stepLife(l, 12_000, true)).toBeNull();
  });

  it("always ends by the hard stop", () => {
    const l = newLife(0, 0, 60_000);
    stepLife(l, 0, false);
    expect(stepLife(l, 59_999, false)).toBeNull();
    expect(stepLife(l, 60_000, false)).toBe("end");
  });

  it("can be ended early once", () => {
    const l = newLife(0, 1000, 60_000);
    expect(forceEnd(l, 500)).toBe(true);
    expect(forceEnd(l, 600)).toBe(false);
    expect(l.phase).toBe("ended");
  });
});
