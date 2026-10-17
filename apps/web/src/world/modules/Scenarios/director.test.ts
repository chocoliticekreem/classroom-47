import { describe, expect, it } from "vitest";
import { SCENARIOS } from "../../scenarios";
import {
  ALL_MODIFIERS,
  Autoplay,
  Director,
  EXPIRE_AFTER_RESOLVED_S,
  EXPIRE_UNRESOLVED_S,
  MAX_ACTIVE,
  isExpired,
  shuffled,
  rng,
} from "./director";

const IDS = SCENARIOS.map((s) => s.id);

describe("Autoplay", () => {
  it("has all 50 scenarios to cycle through", () => {
    expect(IDS).toHaveLength(50);
  });

  it("autoplay covers all 50 scenarios within 50 runs", () => {
    const ap = new Autoplay(IDS, 7);
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(ap.next().scenarioId);
    expect(seen.size).toBe(50);
  });

  it("covers everything again in the next cycle, for any seed", () => {
    for (const seed of [1, 2, 3, 99, 2026]) {
      const ap = new Autoplay(IDS, seed);
      for (let i = 0; i < 50; i++) ap.next();
      const seen = new Set<string>();
      for (let i = 0; i < 50; i++) seen.add(ap.next().scenarioId);
      expect(seen.size).toBe(50);
    }
  });

  it("is deterministic per seed and shuffled (not catalogue order)", () => {
    const a = new Autoplay(IDS, 42);
    const b = new Autoplay(IDS, 42);
    const sa = Array.from({ length: 50 }, () => a.next());
    const sb = Array.from({ length: 50 }, () => b.next());
    expect(sa).toEqual(sb);
    expect(sa.map((p) => p.scenarioId)).not.toEqual(IDS);
  });

  it("attaches 0-2 distinct modifiers and never three plain runs in a row", () => {
    const ap = new Autoplay(IDS, 5);
    let streak = 0;
    for (let i = 0; i < 300; i++) {
      const { modifiers } = ap.next();
      expect(modifiers.length).toBeLessThanOrEqual(2);
      expect(new Set(modifiers).size).toBe(modifiers.length);
      for (const m of modifiers) expect(ALL_MODIFIERS).toContain(m);
      streak = modifiers.length === 0 ? streak + 1 : 0;
      expect(streak).toBeLessThan(3);
    }
  });

  it("uses every modifier eventually", () => {
    const ap = new Autoplay(IDS, 11);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) for (const m of ap.next().modifiers) seen.add(m);
    expect(seen.size).toBe(ALL_MODIFIERS.length);
  });
});

describe("shuffled / rng", () => {
  it("keeps every element", () => {
    const out = shuffled([1, 2, 3, 4, 5], rng(3));
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("lifecycle", () => {
  it("expires 25 s after resolved, or 60 s after staged when nothing resolves", () => {
    const base = { runId: "r", scenarioId: "x", modifiers: [], stagedAt: 0, resolvedAt: null, outcome: null };
    expect(isExpired(base, EXPIRE_UNRESOLVED_S - 1)).toBe(false);
    expect(isExpired(base, EXPIRE_UNRESOLVED_S)).toBe(true);
    const res = { ...base, resolvedAt: 10, outcome: "acted" as const };
    expect(isExpired(res, 10 + EXPIRE_AFTER_RESOLVED_S - 1)).toBe(false);
    expect(isExpired(res, 10 + EXPIRE_AFTER_RESOLVED_S)).toBe(true);
  });
});

describe("Director", () => {
  const stages = (acts: ReturnType<Director["tick"]>) => acts.filter((a) => a.type === "stage");

  it("autoplays every 20-30 s and never exceeds 3 active scenes", () => {
    const d = new Director(IDS, 1);
    const times: number[] = [];
    for (let i = 0; i < 20 * 600; i++) {
      // 10 minutes at 50 ms steps
      const acts = d.tick(0.05);
      if (stages(acts).length) times.push(d.now);
      expect(d.runs.length).toBeLessThanOrEqual(MAX_ACTIVE);
    }
    expect(times.length).toBeGreaterThan(15);
    for (let i = 1; i < times.length; i++) {
      expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(19.9);
      expect(times[i] - times[i - 1]).toBeLessThanOrEqual(30.1);
    }
  });

  it("expires resolved runs 25 s later", () => {
    const d = new Director(IDS, 1, false);
    const [act] = d.request({ scenarioId: "delivery-001", modifiers: [] });
    expect(act.type).toBe("stage");
    const runId = act.type === "stage" ? act.runId : "";
    d.tick(5);
    d.resolve(runId, "acted");
    expect(d.tick(EXPIRE_AFTER_RESOLVED_S - 1)).toEqual([]);
    expect(d.tick(1.01)).toEqual([{ type: "expire", runId }]);
    expect(d.runs).toHaveLength(0);
  });

  it("a request when full evicts the oldest scene", () => {
    const d = new Director(IDS, 1, false);
    const ids = [0, 1, 2].map((i) => {
      const a = d.request({ scenarioId: IDS[i], modifiers: [] })[0];
      d.tick(1);
      return a.type === "stage" ? a.runId : "";
    });
    const acts = d.request({ scenarioId: IDS[3], modifiers: ["noise"] });
    expect(acts[0]).toEqual({ type: "expire", runId: ids[0] });
    expect(acts[1].type).toBe("stage");
    expect(d.runs.map((r) => r.scenarioId)).toEqual([IDS[1], IDS[2], IDS[3]]);
  });

  it("time only moves with tick (pause-safe)", () => {
    const d = new Director(IDS, 1);
    expect(d.now).toBe(0);
    d.tick(0.1);
    expect(d.now).toBeCloseTo(0.1);
  });
});
