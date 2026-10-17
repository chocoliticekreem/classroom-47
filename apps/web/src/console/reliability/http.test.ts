import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, DEFAULT_TIMEOUT_MS, EXECUTE_TIMEOUT_MS, isConnectionError, MSG_TIMEOUT, request } from "./http";

/** A fetch that never answers until aborted. */
function hangingFetch() {
  return vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      }),
  );
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("request timeouts", () => {
  it("gives up after 15 s by default with a plain message", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const p = request<never>("GET", "/api/console/evidence");
    const settled = expect(p).rejects.toMatchObject({ message: MSG_TIMEOUT, status: 0, kind: "timeout" });
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS - 1);
    let done = false;
    void p.catch(() => (done = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await settled;
    const err = await p.catch((e: unknown) => e as ApiError);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.detail).toContain("no answer after 15 s");
    expect(isConnectionError(err)).toBe(true);
  });

  it("honours a longer timeout (execute: 6 min)", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    let done = false;
    const p = request<never>("POST", "/api/console/execute", {}, { timeoutMs: EXECUTE_TIMEOUT_MS }).catch((e: unknown) => {
      done = true;
      return e as ApiError;
    });
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await p).kind).toBe("timeout");
  });

  it("a caller abort is an AbortError, not a timeout", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const ctrl = new AbortController();
    const p = request<never>("GET", "/x", undefined, { signal: ctrl.signal }).catch((e: unknown) => e as ApiError);
    ctrl.abort();
    const err = await p;
    expect(err.name).toBe("AbortError");
    expect(err).not.toBeInstanceOf(ApiError);
  });

  it("clears its timer after a quick answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 })));
    await expect(request("GET", "/x")).resolves.toEqual({ ok: 1 });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("plain errors", () => {
  it("network failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    await expect(request("GET", "/x")).rejects.toMatchObject({ message: "Can't reach Hamyway City right now.", kind: "network" });
  });

  it("server error hides the server's words but keeps them in detail", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "ECONNREFUSED 127.0.0.1:4000" }), { status: 500 })));
    const err = await request<never>("GET", "/api/x?y=1").catch((e: unknown) => e as ApiError);
    expect(err.message).toBe("Something went wrong. Try again in a moment.");
    expect(err.detail).toBe("/api/x: HTTP 500: ECONNREFUSED 127.0.0.1:4000");
  });
});
