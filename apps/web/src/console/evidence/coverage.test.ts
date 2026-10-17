import { describe, expect, it } from "vitest";
import type { EvidenceRow } from "../types";
import { byPattern, headline, normalizeRow, scorecard, segments, strength, tableRows, why, type ResultRow } from "./coverage";

const base = (o: Partial<EvidenceRow> & Record<string, unknown>): EvidenceRow =>
  ({
    caseId: "c", dataset: "public", title: null, decision: "acted", nextAction: null, gate: "allow",
    pass: true, score: 1, costUsd: null, durationMs: null, executionId: "e", ...o,
  }) as EvidenceRow;
const row = (o: Partial<EvidenceRow> & Record<string, unknown>): ResultRow => normalizeRow(base(o));
const notRun = (o: Partial<EvidenceRow> & Record<string, unknown> = {}) =>
  row({ executionId: null, decision: null, pass: null, score: null, gate: null, ...o });

describe("normalizeRow", () => {
  it("leaves every new field null when the API does not send it", () => {
    expect(row({})).toMatchObject({ critical: null, criticalReported: false, verdict: null, brokenRules: [], pattern: null });
  });
  it("reads the new fields under the names the backend may use", () => {
    const r = row({ pass: false, criticalFailure: true, judgeNote: " Wrong owner ", mustNotBroken: ["promised a refund"], mutation: "noise" });
    expect(r).toMatchObject({ critical: true, verdict: "Wrong owner", brokenRules: ["promised a refund"], pattern: "noise" });
    expect(row({ violations: [{ rule: "r1", evidence: "x" }] }).brokenRules).toEqual(["r1"]);
  });
  it("derives critical from broken rules only for checked cases", () => {
    expect(row({ pass: false, brokenRules: ["r"] }).critical).toBe(true);
    expect(row({ pass: true, brokenRules: [] }).critical).toBe(false);
    expect(notRun({ brokenRules: [] }).critical).toBeNull();
    expect(row({ pass: true, critical: null, brokenRules: [] }).critical).toBeNull();
  });
});

describe("headline", () => {
  const rows = [
    row({ pass: true, costUsd: 0.02, durationMs: 1000 }),
    row({ pass: false, costUsd: 0.04, durationMs: 3000 }),
    row({ pass: null, score: null }),
    notRun(),
  ];
  it("counts run, checked, right and averages only recorded values", () => {
    const h = headline(rows);
    expect(h).toMatchObject({ known: 4, run: 3, checked: 2, right: 1, wrong: 1, rightRate: 0.5 });
    expect(h.avgCostUsd).toBeCloseTo(0.03);
    expect(h.avgDurationMs).toBe(2000);
  });
  it("never invents critical failures or averages", () => {
    const h = headline([row({ pass: null }), notRun()]);
    expect(h.critical).toBeNull();
    expect(h.rightRate).toBeNull();
    expect(h.avgCostUsd).toBeNull();
    expect(h.avgDurationMs).toBeNull();
  });
  it("counts critical failures when reported, preferring the server total", () => {
    const rs = [row({ pass: false, critical: true }), row({ pass: true, critical: false }), notRun({ critical: true })];
    expect(headline(rs).critical).toBe(1);
    expect(headline(rs, 4).critical).toBe(4);
    expect(headline(rs, "4").critical).toBe(1);
  });
  it("reports the field but no number when no checked case records it", () => {
    const h = headline([row({ pass: null, critical: null }), notRun({ critical: null })], 0);
    expect(h).toMatchObject({ criticalReported: true, critical: null });
    expect(headline([row({ pass: true, critical: null })], 0)).toMatchObject({ criticalReported: true, critical: null });
    expect(headline([row({ pass: null })]).criticalReported).toBe(false);
  });
  it("is all zeros on no rows", () => {
    expect(headline([])).toMatchObject({ known: 0, run: 0, checked: 0, rightRate: null, critical: null });
  });
});

describe("scorecard", () => {
  const rows = [
    row({ dataset: "fixtures", pass: false }),
    row({ dataset: "city", pass: true }),
    row({ dataset: "zzz", pass: true }),
    row({ dataset: "public", pass: true }),
    row({ dataset: "public", pass: false }),
    row({ dataset: "public", pass: null }),
    notRun({ dataset: "public" }),
  ];
  it("orders sets as the rules list them, unknown sets last", () => {
    expect(scorecard(rows).map((t) => t.key)).toEqual(["public", "city", "fixtures", "zzz"]);
  });
  it("splits each set into right / wrong / not checked / not run", () => {
    const pub = scorecard(rows)[0];
    expect(pub).toMatchObject({ known: 4, run: 3, right: 1, wrong: 1, unchecked: 1, notRun: 1, rightRate: 0.5 });
    const s = segments(pub);
    expect(s.right + s.wrong + s.unchecked + s.notRun).toBeCloseTo(1);
    expect(s.notRun).toBe(0.25);
  });
  it("has no rate for a set nobody checked", () => {
    expect(scorecard([notRun({ dataset: "city" })])[0]).toMatchObject({ run: 0, notRun: 1, rightRate: null });
  });
});

describe("byPattern", () => {
  it("is empty when no row carries a pattern", () => {
    expect(byPattern([row({}), notRun()])).toEqual([]);
  });
  it("puts the weakest checked pattern first and unchecked ones last", () => {
    const rows = [
      row({ mutation: "noise", pass: true }),
      row({ mutation: "noise", pass: true }),
      row({ mutation: "hidden_injection", pass: false }),
      row({ mutation: "hidden_injection", pass: true }),
      notRun({ mutation: "format_trap" }),
      row({ mutation: "safety_hazard", pass: false }),
    ];
    const t = byPattern(rows);
    expect(t.map((x) => x.key)).toEqual(["safety_hazard", "hidden_injection", "noise", "format_trap"]);
    expect(t.map(strength)).toEqual(["weak", "mixed", "strong", "unknown"]);
  });
});

describe("why", () => {
  it("shows a broken rule first, then the verdict, scrubbed and on one line", () => {
    expect(why(row({ pass: false, brokenRules: ["promised_refund"], verdict: "x" }))).toBe("Broke a rule: promised refund");
    expect(why(row({ verdict: "Claude sent it to the right owner\nmore" }))).toBe("sent it to the right owner");
    expect(why(row({}))).toBe("");
  });
  it("cuts long reasons", () => {
    const r = why(row({ verdict: "word ".repeat(60) }), 40);
    expect(r.length).toBeLessThanOrEqual(41);
    expect(r.endsWith("…")).toBe(true);
  });
});

describe("tableRows", () => {
  const rows = [
    row({ caseId: "a", pass: true }),
    row({ caseId: "b", pass: false }),
    row({ caseId: "c", pass: false, critical: true, dataset: "city" }),
    row({ caseId: "d", pass: null }),
    notRun({ caseId: "e" }),
  ];
  it("shows wrong first (critical on top), hides not-run cases unless asked", () => {
    expect(tableRows(rows, null, "run").map((r) => r.caseId)).toEqual(["c", "b", "a", "d"]);
    expect(tableRows(rows, null, "all").map((r) => r.caseId)).toEqual(["c", "b", "a", "d", "e"]);
    expect(tableRows(rows, null, "wrong").map((r) => r.caseId)).toEqual(["c", "b"]);
    expect(tableRows(rows, "public", "wrong").map((r) => r.caseId)).toEqual(["b"]);
  });
});
