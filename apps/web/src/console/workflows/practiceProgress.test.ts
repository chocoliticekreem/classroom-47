import { describe, expect, it } from "vitest";
import type { TestRunCase } from "../types";
import { RUNNING_CAP, TYPICAL_MS, caseElapsedMs, caseTitle, fmtElapsed, overallProgress, runningLine, runningShare } from "./practiceProgress";

const T0 = Date.parse("2026-10-10T14:00:00Z");
const iso = (ms: number) => new Date(T0 + ms).toISOString();
type C = Pick<TestRunCase, "status" | "startedAt" | "finishedAt" | "durationMs">;
const running = (startMs: number): C => ({ status: "running", startedAt: iso(startMs), finishedAt: null, durationMs: null });
const queued: C = { status: "queued", startedAt: null, finishedAt: null, durationMs: null };
const passed = (a: number, b: number): C => ({ status: "passed", startedAt: iso(a), finishedAt: iso(b), durationMs: 1 });

describe("fmtElapsed", () => {
  it("formats minutes and seconds", () => {
    expect(fmtElapsed(42_000)).toBe("0:42");
    expect(fmtElapsed(65_900)).toBe("1:05");
    expect(fmtElapsed(720_000)).toBe("12:00");
    expect(fmtElapsed(null)).toBe("0:00");
    expect(fmtElapsed(-5)).toBe("0:00");
  });
});

describe("caseElapsedMs", () => {
  it("counts to now while running, to the end once finished, null before it starts", () => {
    expect(caseElapsedMs(running(0), T0 + 42_000)).toBe(42_000);
    expect(caseElapsedMs(passed(0, 31_000), T0 + 99_000)).toBe(31_000);
    expect(caseElapsedMs(queued, T0)).toBeNull();
  });
  it("falls back to the agent's duration for runs saved before timing existed", () => {
    expect(caseElapsedMs({ status: "failed", startedAt: null, finishedAt: null, durationMs: 7000 }, T0)).toBe(7000);
  });
});

describe("overallProgress", () => {
  it("finished cases count exactly; queued count nothing", () => {
    expect(overallProgress([passed(0, 1), passed(0, 1), queued, queued], T0)).toBe(0.5);
    expect(overallProgress([], T0)).toBe(0);
  });
  it("keeps moving while cases run but never reaches 100% until all are done", () => {
    const at = (ms: number) => overallProgress([running(0), running(0)], T0 + ms);
    expect(at(5_000)).toBeGreaterThan(0);
    expect(at(30_000)).toBeGreaterThan(at(5_000));
    expect(at(600_000)).toBeLessThanOrEqual(RUNNING_CAP);
    expect(at(600_000)).toBeLessThan(1);
  });
  it("a finished case jumps the bar past where its running share was", () => {
    const before = overallProgress([running(0), running(0)], T0 + 60_000);
    const after = overallProgress([passed(0, 60_000), running(0)], T0 + 60_000);
    expect(after).toBeGreaterThan(before);
  });
  it("runningShare is about 57% of a case at the typical time", () => {
    expect(runningShare(TYPICAL_MS)).toBeCloseTo(RUNNING_CAP * (1 - Math.exp(-1)));
    expect(runningShare(0)).toBe(0);
  });
});

describe("runningLine", () => {
  it("says how many run at once and the usual time", () => {
    const five = Array(5).fill({ status: "running" });
    expect(runningLine(five)).toBe("5 running at once · usually 30–90 s each");
    expect(runningLine([{ status: "running" }, { status: "queued" }, { status: "passed" }])).toBe("1 running · 1 waiting · usually 30–90 s each");
    expect(runningLine([{ status: "passed" }])).toBe("Finishing · usually 30–90 s each");
  });
});

describe("caseTitle", () => {
  it("prefers the title, else makes the id readable", () => {
    expect(caseTitle({ caseId: "delivery-012", title: "Van crashed on the A40" })).toBe("Van crashed on the A40");
    expect(caseTitle({ caseId: "delivery-012", title: null })).toBe("delivery case 012");
  });
});
