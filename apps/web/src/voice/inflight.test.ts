import { describe, expect, it } from "vitest";
import { createInflight } from "./inflight";

describe("createInflight", () => {
  it("settle waits for tool calls still in flight, so their results are not lost when a call ends", async () => {
    const inflight = createInflight();
    let decision: string | null = null;
    void inflight.track(new Promise<void>((resolve) => setTimeout(() => { decision = "option-1"; resolve(); }, 30)));
    await inflight.settle();
    expect(decision).toBe("option-1");
  });

  it("settle also waits for calls that start while it is waiting, and survives failures", async () => {
    const inflight = createInflight();
    const seen: string[] = [];
    void inflight.track(new Promise<void>((resolve) => setTimeout(() => {
      seen.push("first");
      void inflight.track(new Promise<void>((r) => setTimeout(() => { seen.push("second"); r(); }, 10)));
      resolve();
    }, 10)));
    void inflight.track(Promise.reject(new Error("tool failed"))).catch(() => {});
    await inflight.settle();
    expect(seen).toEqual(["first", "second"]);
  });
});
