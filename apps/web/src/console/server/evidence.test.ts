import { describe, expect, it } from "vitest";
import { buildEvidence, type EvidenceExecution } from "./evidence";

const ex = (o: Partial<EvidenceExecution> & { id: string; caseId: string; startedAt: string }): EvidenceExecution => ({
  dataset: "public", status: "success", outcome: "acted", durationMs: 1000, costUsd: 0.01, simulated: false,
  title: null, nextAction: "Email → A", gate: "allow", eval: null, ...o,
});

describe("buildEvidence", () => {
  it("joins each case with its latest finished run and latest verdict, and totals them", () => {
    const { rows, totals } = buildEvidence(
      [{ id: "delivery-001", dataset: "public", title: "One" }, { id: "gen-101", dataset: "generated", title: "Two", mutation: "conflicting_information" }],
      [
        ex({ id: "e1", caseId: "delivery-001", startedAt: "2026-10-10T10:00:00Z", eval: { pass: true, score: 0.9, critical: false, verdict: "Right team.", brokenRules: [] }, costUsd: null, nextAction: "Email → A" }),
        ex({ id: "e2", caseId: "delivery-001", startedAt: "2026-10-10T11:00:00Z", outcome: "escalated", costUsd: 0.05, nextAction: null, gate: "ask" }),
        ex({ id: "e3", caseId: "delivery-001", startedAt: "2026-10-10T12:00:00Z", status: "running", outcome: null }),
        ex({ id: "sim", caseId: "gen-101", startedAt: "2026-10-10T12:00:00Z", simulated: true }),
        ex({ id: "r1", caseId: "Case-A", dataset: "reality", startedAt: "2026-10-10T09:00:00Z", title: "Reality A", costUsd: 0.02 }),
      ],
    );
    expect(rows).toEqual([
      { caseId: "delivery-001", dataset: "public", title: "One", decision: "acted", nextAction: "Email → A", gate: "allow",
        pass: true, score: 0.9, costUsd: null, durationMs: 1000, executionId: "e1",
        critical: false, verdict: "Right team.", brokenRules: [], mutation: null },
      { caseId: "gen-101", dataset: "generated", title: "Two", decision: null, nextAction: null, gate: null,
        pass: null, score: null, costUsd: null, durationMs: null, executionId: null,
        critical: null, verdict: null, brokenRules: [], mutation: "conflicting_information" },
      { caseId: "Case-A", dataset: "reality", title: "Reality A", decision: "acted", nextAction: "Email → A", gate: "allow",
        pass: null, score: null, costUsd: 0.02, durationMs: 1000, executionId: "r1",
        critical: null, verdict: null, brokenRules: [], mutation: null },
    ]);
    expect(totals).toEqual({
      cases: 3, evaluated: 1, passed: 1, costUsd: 0.02, criticalFailures: 0,
      byDataset: [
        { dataset: "public", run: 1, right: 1, wrong: 0 },
        { dataset: "generated", run: 0, right: 0, wrong: 0 },
        { dataset: "reality", run: 1, right: 0, wrong: 0 },
      ],
    });
  });

  it("marks a broken must_not as critical and carries the judge's note and rules", () => {
    const { rows, totals } = buildEvidence([{ id: "gen-1", dataset: "generated", title: null }], [
      ex({ id: "a", caseId: "gen-1", startedAt: "2026-10-10T10:00:00Z", eval: { pass: false, score: 0, verdict: "Promised a refund.", brokenRules: ["Never promise a refund"] } }),
    ]);
    expect(rows[0]).toMatchObject({ pass: false, score: 0, critical: true, verdict: "Promised a refund.", brokenRules: ["Never promise a refund"] });
    expect(totals.criticalFailures).toBe(1);
    expect(totals.byDataset).toEqual([{ dataset: "generated", run: 1, right: 0, wrong: 1 }]);
  });

  it("reads critical from old notes-only verdicts", () => {
    const { rows } = buildEvidence([{ id: "x", dataset: "public", title: null }], [
      ex({ id: "a", caseId: "x", startedAt: "2026-10-10T10:00:00Z", eval: { pass: false, score: 0, notes: "BROKE RULE: No refunds | note" } }),
      ex({ id: "b", caseId: "y", startedAt: "2026-10-10T10:00:00Z", eval: { pass: false, score: 0.4, notes: "wrong team" } }),
      ex({ id: "c", caseId: "z", startedAt: "2026-10-10T10:00:00Z", eval: { pass: false, score: 0, notes: "agent error" } }),
    ]);
    // y scored 0.4, so no rule was broken; z scored 0 with no reason given, so it is unknown.
    expect(rows.map((r) => r.critical)).toEqual([true, false, null]);
  });

  it("takes outcome, run id, verdict, cost and time from one run: the latest judged one, else the latest", () => {
    const { rows } = buildEvidence([{ id: "c", dataset: "public", title: null }, { id: "d", dataset: "public", title: null }], [
      // c: judged run, then a later failed run. The row must describe the judged run only.
      ex({ id: "judged", caseId: "c", startedAt: "2026-10-10T10:00:00Z", outcome: "acted", costUsd: 0.04, durationMs: 7000, eval: { pass: true, score: 0.9 } }),
      ex({ id: "failed", caseId: "c", startedAt: "2026-10-10T12:00:00Z", status: "error", outcome: null, costUsd: 0.09, durationMs: 9000 }),
      // d: never judged, so the latest finished run.
      ex({ id: "d1", caseId: "d", startedAt: "2026-10-10T10:00:00Z", costUsd: 0.01 }),
      ex({ id: "d2", caseId: "d", startedAt: "2026-10-10T11:00:00Z", outcome: "escalated", costUsd: 0.03, durationMs: 3000 }),
    ]);
    expect(rows.map((r) => [r.executionId, r.decision, r.pass, r.costUsd, r.durationMs])).toEqual([
      ["judged", "acted", true, 0.04, 7000],
      ["d2", "escalated", null, 0.03, 3000],
    ]);
  });

  it("stays fast with 500 cases and 10 runs each", () => {
    const cases = Array.from({ length: 500 }, (_, i) => ({ id: `gen-${i}`, dataset: i % 2 ? "generated" : "public", title: null, mutation: "m" }));
    const runs = cases.flatMap((c, i) => Array.from({ length: 10 }, (_, j) => ex({
      id: `${c.id}-${j}`, caseId: c.id, startedAt: `2026-10-10T${String(10 + j).padStart(2, "0")}:00:00Z`,
      eval: j === 9 ? { pass: i % 3 !== 0, score: 0.8 } : null,
    })));
    const t = performance.now();
    const { rows, totals } = buildEvidence(cases, runs);
    expect(performance.now() - t).toBeLessThan(100);
    expect(rows).toHaveLength(500);
    expect(totals.evaluated).toBe(500);
  });
});
