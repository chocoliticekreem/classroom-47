import { describe, expect, it } from "vitest";
import { formatCount, formatDuration, formatPct, formatRelative, formatUsd, humanize } from "./format";
import { computeKpis } from "./kpis";
import type { EvidenceRow } from "../types";

describe("format", () => {
  it("formats money by magnitude", () => {
    expect(formatUsd(null)).toBe("—");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.0042)).toBe("$0.0042");
    expect(formatUsd(0.0421)).toBe("$0.042");
    expect(formatUsd(1.236)).toBe("$1.24");
    expect(formatUsd(1204.4)).toBe("$1,204");
  });
  it("formats durations", () => {
    expect(formatDuration(undefined)).toBe("—");
    expect(formatDuration(820)).toBe("820 ms");
    expect(formatDuration(4210)).toBe("4.2 s");
    expect(formatDuration(42_000)).toBe("42 s");
    expect(formatDuration(192_000)).toBe("3m 12s");
    expect(formatDuration(3_840_000)).toBe("1h 04m");
  });
  it("formats percentages and counts", () => {
    expect(formatPct(null)).toBe("—");
    expect(formatPct(1)).toBe("100%");
    expect(formatPct(0.875)).toBe("87.5%");
    expect(formatPct(2 / 3)).toBe("66.7%");
    expect(formatCount(1234)).toBe("1,234");
  });
  it("formats relative times", () => {
    const now = Date.parse("2026-10-10T12:00:00Z");
    expect(formatRelative("2026-10-10T11:59:58Z", now)).toBe("just now");
    expect(formatRelative("2026-10-10T11:55:00Z", now)).toBe("5m ago");
    expect(formatRelative("2026-10-10T09:00:00Z", now)).toBe("3h ago");
    expect(formatRelative("2026-10-08T12:00:00Z", now)).toBe("2d ago");
    expect(formatRelative("not a date", now)).toBe("—");
  });
  it("humanizes outcomes", () => {
    expect(humanize("asked_for_info")).toBe("Asked for info");
    expect(humanize(null)).toBe("—");
  });
});

const row = (p: Partial<EvidenceRow>): EvidenceRow => ({
  caseId: "c", dataset: "public", title: null, decision: null, nextAction: null, gate: null,
  pass: null, score: null, costUsd: null, durationMs: null, executionId: null,
  critical: null, verdict: null, brokenRules: [], mutation: null, ...p,
});

describe("computeKpis", () => {
  it("does not count known-but-unrun cases as tested", () => {
    const k = computeKpis([row({}), row({ dataset: "generated" })]);
    expect(k.known).toBe(2);
    expect(k.cases).toBe(0);
    expect(k.criticalFailures).toBeNull();
    expect(k.datasets.map((d) => d.cases)).toEqual([0, 0]);
  });
  it("returns nulls with no data", () => {
    const k = computeKpis([]);
    expect(k.cases).toBe(0);
    expect(k.passRate).toBeNull();
    expect(k.avgCostUsd).toBeNull();
    expect(k.criticalFailures).toBeNull();
  });
  it("aggregates real rows and excludes simulated city rows", () => {
    const k = computeKpis([
      row({ dataset: "public", pass: true, costUsd: 0.02, durationMs: 1000, executionId: "e1" }),
      row({ dataset: "public", pass: false, costUsd: 0.04, durationMs: 3000, executionId: "e2" }),
      row({ dataset: "generated", pass: true }),
      row({ dataset: "fixtures", decision: "escalated" }),
      row({ dataset: "fixtures" }), // known but never run
      row({ dataset: "city", pass: false, costUsd: 9, durationMs: 9, executionId: "sim" }),
    ]);
    expect(k.known).toBe(5);
    expect(k.cases).toBe(4);
    expect(k.evaluated).toBe(3);
    expect(k.passed).toBe(2);
    expect(k.failed).toBe(1);
    expect(k.passRate).toBeCloseTo(2 / 3);
    expect(k.avgCostUsd).toBeCloseTo(0.03);
    expect(k.totalCostUsd).toBeCloseTo(0.06);
    expect(k.avgDurationMs).toBe(2000);
    expect(k.criticalFailures).toBe(0);
    expect(k.simulatedExcluded).toBe(1);
    expect(k.outcomes).toEqual({ escalated: 1 });
    expect(k.datasets.map((d) => d.dataset)).toEqual(["public", "fixtures", "generated"]);
    expect(k.datasets[1]).toMatchObject({ known: 2, cases: 1, evaluated: 0, passRate: null });
    expect(k.datasets[0].passRate).toBe(0.5);
  });
  it("uses recorded critical failures when the server provides them", () => {
    expect(computeKpis([row({ executionId: "e" })], 2).criticalFailures).toBe(2);
  });
});
