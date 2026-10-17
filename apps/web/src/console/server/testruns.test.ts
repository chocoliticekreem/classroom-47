import { describe, expect, it } from "vitest";
import type { TestRunCase } from "../types";
import { CONCURRENCY, queuedCase, runCases } from "./testruns";

const cases = (n: number) => Array.from({ length: n }, (_, i) => queuedCase({ id: `c${i}`, dataset: "public" }));
const pass = (c: TestRunCase): TestRunCase => ({ ...c, status: "passed", score: 1 });

describe("runCases", () => {
  it("runs every case with at most `concurrency` in flight and reports every change", async () => {
    let inFlight = 0;
    let peak = 0;
    const updates: string[][] = [];
    const end = await runCases({
      cases: cases(7),
      concurrency: 3,
      isCancelled: () => false,
      onUpdate: (cs) => updates.push(cs.map((c) => c.status)),
      runOne: async (c) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return pass(c);
      },
    });
    expect(end).toBe("done");
    expect(peak).toBe(3);
    expect(updates).toHaveLength(14); // running + finished, per case
    expect(updates.at(-1)).toEqual(Array(7).fill("passed"));
  });

  it("one failing case does not stop the rest", async () => {
    const list = cases(4);
    await runCases({
      cases: list,
      concurrency: 3,
      isCancelled: () => false,
      onUpdate: () => {},
      runOne: async (c) => {
        if (c.caseId === "c1") throw new Error("agent exploded");
        return pass(c);
      },
    });
    expect(list.map((c) => c.status)).toEqual(["passed", "error", "passed", "passed"]);
    expect(list[1].verdict).toBe("error: agent exploded");
  });

  it("cancel stops new cases; running ones finish and stay recorded", async () => {
    const list = cases(6);
    let cancelled = false;
    const end = await runCases({
      cases: list,
      concurrency: 2,
      isCancelled: () => cancelled,
      onUpdate: () => {},
      runOne: async (c) => {
        if (c.caseId === "c1") cancelled = true;
        await new Promise((r) => setTimeout(r, 5));
        return pass(c);
      },
    });
    expect(end).toBe("cancelled");
    expect(list.map((c) => c.status)).toEqual(["passed", "passed", "queued", "queued", "queued", "queued"]);
  });

  it("all 5 cases start at once with CONCURRENCY and each gets its own start and end time", async () => {
    const list = cases(5).map((c, i) => ({ ...c, title: `Case ${i}` }));
    let inFlight = 0;
    let peak = 0;
    let t = Date.parse("2026-10-10T14:00:00Z");
    const release: (() => void)[] = [];
    const run = runCases({
      cases: list,
      concurrency: CONCURRENCY,
      isCancelled: () => false,
      onUpdate: () => {},
      now: () => new Date((t += 1000)),
      runOne: async (c) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise<void>((r) => release.push(r));
        inFlight--;
        // runOne returns a fresh case without title or timing, as the real scorer does.
        return { ...queuedCase({ id: c.caseId, dataset: c.dataset }), title: undefined, startedAt: undefined, status: "passed" };
      },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(peak).toBe(5);
    expect(list.every((c) => c.status === "running" && c.startedAt)).toBe(true);
    release.forEach((r) => r());
    await run;
    for (const [i, c] of list.entries()) {
      expect(c.title).toBe(`Case ${i}`);
      expect(c.status).toBe("passed");
      expect(Date.parse(c.finishedAt!)).toBeGreaterThan(Date.parse(c.startedAt!));
    }
  });

  it("an error case keeps its start time and gets an end time", async () => {
    const list = cases(1);
    await runCases({ cases: list, concurrency: 1, isCancelled: () => false, onUpdate: () => {}, runOne: async () => { throw new Error("x"); } });
    expect(list[0].startedAt).toBeTruthy();
    expect(list[0].finishedAt).toBeTruthy();
  });
});
