import { describe, expect, it } from "vitest";
import { liveCallsOn, setLiveCalls } from "./liveCalls";

describe("live calls switch", () => {
  it("is off by default and never throws without browser storage", () => {
    expect(liveCallsOn()).toBe(false);
    expect(() => setLiveCalls(true)).not.toThrow();
  });
  it("remembers the choice when storage exists", () => {
    const store = new Map<string, string>();
    const g = globalThis as { localStorage?: unknown };
    g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    try {
      setLiveCalls(true);
      expect(liveCallsOn()).toBe(true);
      setLiveCalls(false);
      expect(liveCallsOn()).toBe(false);
    } finally {
      delete g.localStorage;
    }
  });
});
