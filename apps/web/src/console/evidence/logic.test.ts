import { describe, expect, it } from "vitest";
import type { EvidenceRow } from "../types";
import { EMPTY_FILTER, filterRows, fmtPct, groupByDataset, nextSort, sortRows, totalsOf, distinct } from "./logic";

const row = (o: Partial<EvidenceRow>): EvidenceRow => ({
  caseId: "delivery-001", dataset: "public", title: null, decision: "acted", nextAction: null, gate: "allow",
  pass: true, score: 1, costUsd: 0.01, durationMs: 1000, executionId: "e1",
  critical: null, verdict: null, brokenRules: [], mutation: null, ...o,
});

const rows = [
  row({ caseId: "delivery-10", dataset: "public", pass: false, score: 0.2, costUsd: 0.03, gate: "ask" }),
  row({ caseId: "delivery-2", dataset: "public", pass: true, score: 0.9, costUsd: 0.01 }),
  row({ caseId: "gen-1", dataset: "generated", pass: null, score: null, costUsd: null, decision: "escalated", nextAction: "Email → Plover Arc" }),
];

describe("filterRows", () => {
  it("searches across fields with every term", () => {
    expect(filterRows(rows, { ...EMPTY_FILTER, q: "plover email" }).map((r) => r.caseId)).toEqual(["gen-1"]);
    expect(filterRows(rows, { ...EMPTY_FILTER, q: "plover sms" })).toEqual([]);
  });
  it("filters by dataset, gate and pass state", () => {
    expect(filterRows(rows, { ...EMPTY_FILTER, dataset: "generated" })).toHaveLength(1);
    expect(filterRows(rows, { ...EMPTY_FILTER, gate: "ask" }).map((r) => r.caseId)).toEqual(["delivery-10"]);
    expect(filterRows(rows, { ...EMPTY_FILTER, pass: "fail" }).map((r) => r.caseId)).toEqual(["delivery-10"]);
    expect(filterRows(rows, { ...EMPTY_FILTER, pass: "unevaluated" }).map((r) => r.caseId)).toEqual(["gen-1"]);
  });
});

describe("sortRows", () => {
  it("sorts case ids naturally", () => {
    expect(sortRows(rows, "caseId", "asc").map((r) => r.caseId)).toEqual(["delivery-2", "delivery-10", "gen-1"]);
  });
  it("keeps nulls last in both directions", () => {
    expect(sortRows(rows, "score", "asc").map((r) => r.caseId)).toEqual(["delivery-10", "delivery-2", "gen-1"]);
    expect(sortRows(rows, "score", "desc").map((r) => r.caseId)).toEqual(["delivery-2", "delivery-10", "gen-1"]);
    expect(sortRows(rows, "pass", "desc").map((r) => r.caseId)).toEqual(["delivery-2", "delivery-10", "gen-1"]);
  });
  it("does not mutate input", () => {
    const copy = [...rows];
    sortRows(rows, "costUsd", "desc");
    expect(rows).toEqual(copy);
  });
  it("toggles direction", () => {
    expect(nextSort({ key: "caseId", dir: "asc" }, "caseId")).toEqual({ key: "caseId", dir: "desc" });
    expect(nextSort({ key: "caseId", dir: "asc" }, "costUsd")).toEqual({ key: "costUsd", dir: "desc" });
    expect(nextSort({ key: "costUsd", dir: "asc" }, "dataset")).toEqual({ key: "dataset", dir: "asc" });
  });
});

describe("totals and groups", () => {
  it("computes totals and pass rate over evaluated rows only", () => {
    const t = totalsOf(rows);
    expect(t).toMatchObject({ cases: 3, evaluated: 2, passed: 1, passRate: 0.5 });
    expect(t.costUsd).toBeCloseTo(0.04);
    expect(totalsOf([]).passRate).toBeNull();
  });
  it("groups by dataset preserving row order", () => {
    const g = groupByDataset(sortRows(rows, "caseId", "desc"));
    expect(g.map((x) => x.dataset)).toEqual(["generated", "public"]);
    expect(g[1].rows.map((r) => r.caseId)).toEqual(["delivery-10", "delivery-2"]);
    expect(g[1].totals.passed).toBe(1);
  });
  it("lists distinct values and formats percentages", () => {
    expect(distinct(rows, "gate")).toEqual(["allow", "ask"]);
    expect(fmtPct(0.5)).toBe("50.0%");
    expect(fmtPct(1)).toBe("100%");
    expect(fmtPct(null)).toBe("–");
  });
});

import { resultNumbers, wasRun } from "./logic";

describe("resultNumbers", () => {
  it("counts only cases that were run", () => {
    const notRun = row({ caseId: "x", executionId: null, decision: null, pass: null, score: null });
    expect(wasRun(notRun)).toBe(false);
    expect(resultNumbers([...rows, notRun])).toEqual({ known: 4, run: 3, right: 1, wrong: 1, unchecked: 1 });
  });
  it("searches plain words too", () => {
    expect(filterRows(rows, { ...EMPTY_FILTER, q: "needs a person" }).map((r) => r.caseId)).toEqual(["gen-1"]);
  });
});
