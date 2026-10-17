import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./http";
import { nextDelay, Poller } from "./poller";

const O = { maxBackoffMs: 60_000, hiddenFactor: 4, retryBaseMs: 5_000 };

function setup(opts: { fail?: () => ApiError | null; hidden?: () => boolean } = {}) {
  const calls: { key: string; signal: AbortSignal }[] = [];
  const pending: { resolve: (v: unknown) => void; reject: (e: unknown) => void }[] = [];
  const fetcher = vi.fn((key: string, signal: AbortSignal) => {
    calls.push({ key, signal });
    return new Promise((resolve, reject) => {
      pending.push({ resolve, reject });
      signal.addEventListener("abort", () => {
        const e = new Error("aborted");
        e.name = "AbortError";
        reject(e);
      });
    });
  });
  const poller = new Poller(fetcher, { isHidden: opts.hidden ?? (() => false), now: () => Date.now() });
  /** Settle the oldest pending request. */
  const answer = async (value: unknown = { ok: true }) => {
    const p = pending.shift()!;
    const err = opts.fail?.();
    if (err) p.reject(err);
    else p.resolve(value);
    await vi.advanceTimersByTimeAsync(0);
  };
  return { poller, fetcher, calls, pending, answer };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("dedupe", () => {
  it("shares one request between components reading the same path", async () => {
    const { poller, fetcher, answer } = setup();
    const a = vi.fn();
    const b = vi.fn();
    poller.subscribe("/x", 5000, a);
    poller.subscribe("/x", 5000, b);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await answer({ n: 1 });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(poller.getSnapshot("/x").data).toEqual({ n: 1 });
  });

  it("joins an in-flight request on reload instead of sending another", async () => {
    const { poller, fetcher } = setup();
    poller.subscribe("/x", 0, () => {});
    const p1 = poller.refresh("/x");
    const p2 = poller.refresh("/x");
    expect(p1).toBe(p2);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("polls once per interval for all subscribers, at the fastest subscriber's rate", async () => {
    const { poller, fetcher, answer } = setup();
    poller.subscribe("/x", 10_000, () => {});
    poller.subscribe("/x", 2_000, () => {});
    await answer();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("reuses a fresh answer for a late subscriber", async () => {
    const { poller, fetcher, answer } = setup();
    poller.subscribe("/x", 0, () => {});
    await answer();
    poller.subscribe("/x", 0, () => {});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps different paths separate", () => {
    const { poller, fetcher } = setup();
    poller.subscribe("/a", 0, () => {});
    poller.subscribe("/b", 0, () => {});
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("unmount", () => {
  it("aborts the request in flight when the last subscriber leaves, not before", async () => {
    const { poller, calls } = setup();
    const off1 = poller.subscribe("/x", 5000, () => {});
    const off2 = poller.subscribe("/x", 5000, () => {});
    off1();
    expect(calls[0].signal.aborted).toBe(false);
    off2();
    expect(calls[0].signal.aborted).toBe(true);
    expect(poller.isInflight("/x")).toBe(false);
  });

  it("stops polling after the last unsubscribe", async () => {
    const { poller, fetcher, answer } = setup();
    const off = poller.subscribe("/x", 1000, () => {});
    await answer();
    off();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not record an error for an aborted request", async () => {
    const { poller } = setup();
    const off = poller.subscribe("/x", 0, () => {});
    off();
    await vi.advanceTimersByTimeAsync(0);
    expect(poller.getSnapshot("/x").error).toBeUndefined();
  });
});

describe("back-off", () => {
  it("doubles the interval per consecutive error, capped, and resets on success", async () => {
    let failing = true;
    const { poller, fetcher, answer } = setup({ fail: () => (failing ? new ApiError("down", 0) : null) });
    poller.subscribe("/x", 1000, () => {});
    await answer(); // fail 1 -> next in 1 s
    await vi.advanceTimersByTimeAsync(999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await answer(); // fail 2 -> next in 2 s
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(3);
    await answer(); // fail 3 -> 4 s
    expect(poller.getSnapshot("/x").failures).toBe(3);
    await vi.advanceTimersByTimeAsync(4000);
    failing = false;
    await answer(); // success -> back to 1 s
    expect(poller.getSnapshot("/x").failures).toBe(0);
    expect(poller.getSnapshot("/x").error).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it("keeps the last good data through errors", async () => {
    let failing = false;
    const { poller, answer } = setup({ fail: () => (failing ? new ApiError("down", 503) : null) });
    poller.subscribe("/x", 1000, () => {});
    await answer({ v: 1 });
    failing = true;
    await vi.advanceTimersByTimeAsync(1000);
    await answer();
    const s = poller.getSnapshot("/x");
    expect(s.data).toEqual({ v: 1 });
    expect(s.error?.status).toBe(503);
  });

  it("retries a fetch-once hook by itself after a connection error", async () => {
    let failing = true;
    const { poller, fetcher, answer } = setup({ fail: () => (failing ? new ApiError("down", 0) : null) });
    poller.subscribe("/x", 0, () => {});
    await answer();
    failing = false;
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await answer({ v: 2 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetcher).toHaveBeenCalledTimes(2); // healed; fetch-once stops
  });

  it("does not hammer a 404", async () => {
    const { poller, fetcher, answer } = setup({ fail: () => new ApiError("nope", 404) });
    poller.subscribe("/x", 0, () => {});
    await answer();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("slows down 4x while the tab is hidden and catches up when it is shown", async () => {
    let hidden = true;
    const { poller, fetcher, answer } = setup({ hidden: () => hidden });
    poller.subscribe("/x", 1000, () => {});
    await answer();
    await vi.advanceTimersByTimeAsync(3999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await answer();
    await vi.advanceTimersByTimeAsync(1500);
    hidden = false;
    poller.wake(); // visibilitychange
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(3); // overdue at the visible rate -> fetch at once
  });

  it("nextDelay: pure schedule", () => {
    expect(nextDelay(5000, 0, false, false, O)).toBe(5000);
    expect(nextDelay(5000, 0, true, false, O)).toBe(20_000);
    expect(nextDelay(5000, 3, false, true, O)).toBe(20_000);
    expect(nextDelay(5000, 10, false, true, O)).toBe(60_000);
    expect(nextDelay(0, 0, false, false, O)).toBeNull();
    expect(nextDelay(0, 1, false, true, O)).toBe(5000);
    expect(nextDelay(0, 1, false, false, O)).toBeNull();
    expect(nextDelay(120_000, 3, false, true, O)).toBe(120_000); // cap never undercuts the base
  });
});
