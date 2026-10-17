import { describe, expect, it } from "vitest";
import { caseStatus, gridTiles, headline, runPhase, tally, type RealityCase, type RealityResponse } from "./logic";

const c = (o: Partial<RealityCase>): RealityCase => ({
  n: 1, caseId: "case-01", title: "Parcel left in the rain", outcome: "acted", decision: null,
  escalated: false, failed: false, costUsd: 0.05, durationMs: 30_000, executionId: null, ...o,
});

const resp = (cases: RealityCase[], extra: Partial<RealityResponse> = {}): RealityResponse => ({
  cases, summary: null, runlog: null, ...extra,
});

describe("caseStatus", () => {
  it("maps each outcome to one plain status", () => {
    expect(caseStatus(c({ outcome: "acted" }))).toBe("sent");
    expect(caseStatus(c({ outcome: "asked_for_info" }))).toBe("asked");
    expect(caseStatus(c({ outcome: "escalated" }))).toBe("person");
    expect(caseStatus(c({ outcome: "blocked" }))).toBe("stopped");
    expect(caseStatus(c({ outcome: "no_action" }))).toBe("nothing");
    expect(caseStatus(c({ outcome: "error" }))).toBe("failed");
  });
  it("failed wins over any outcome; no outcome means still working", () => {
    expect(caseStatus(c({ outcome: "acted", failed: true }))).toBe("failed");
    expect(caseStatus(c({ outcome: null }))).toBe("working");
    expect(caseStatus(c({ outcome: "something_new", escalated: true }))).toBe("person");
  });
});

describe("tally", () => {
  const cases = [
    c({ caseId: "a", outcome: "acted", costUsd: 0.1 }),
    c({ caseId: "b", outcome: "no_action", costUsd: null }),
    c({ caseId: "c", outcome: "escalated", costUsd: 0.2 }),
    c({ caseId: "d", outcome: "blocked" }),
    c({ caseId: "e", outcome: "asked_for_info" }),
    c({ caseId: "f", outcome: "error", failed: true }),
    c({ caseId: "g", outcome: null }),
  ];
  it("groups cases into handled / person / asked / failed, counting each once", () => {
    const t = tally(resp(cases));
    expect(t).toMatchObject({ total: 7, done: 6, working: 1, handled: 2, person: 2, asked: 1, failed: 1 });
    expect(t.handled + t.person + t.asked + t.failed + t.working).toBe(t.total);
  });
  it("sums only known costs and returns null when none are known", () => {
    expect(tally(resp(cases)).costUsd).toBeCloseTo(0.1 + 0.2 + 0.05 * 4);
    expect(tally(resp([c({ costUsd: null })])).costUsd).toBeNull();
  });
  it("uses summary.total when the run expects more cases than it has written", () => {
    expect(tally(resp(cases.slice(0, 2), { summary: { total: 50 } })).total).toBe(50);
    expect(tally(resp(cases, { summary: { total: 3 } })).total).toBe(7);
  });
  it("is empty for no data", () => {
    expect(tally(null)).toMatchObject({ total: 0, done: 0, handled: 0, costUsd: null });
  });
});

describe("runPhase", () => {
  it("waits until any case exists", () => {
    expect(runPhase(undefined)).toBe("waiting");
    expect(runPhase(resp([]))).toBe("waiting");
  });
  it("is running while cases are missing or unfinished, even after a run log exists", () => {
    expect(runPhase(resp([c({})]))).toBe("running");
    expect(runPhase(resp([c({ outcome: null })], { runlog: "# Run log" }))).toBe("running");
    expect(runPhase(resp([c({})], { summary: { total: 5 }, runlog: "# Run log" }))).toBe("running");
  });
  it("is done once the run log is written and every case has finished", () => {
    expect(runPhase(resp([c({})], { runlog: "# Run log" }))).toBe("done");
    expect(runPhase(resp([c({})], { summary: { finished: true } }))).toBe("done");
    expect(runPhase(resp([c({})], { summary: { finished: false }, runlog: "x" }))).toBe("running");
  });
});

describe("gridTiles", () => {
  it("orders tiles by case number and pads with pending tiles up to the total", () => {
    const tiles = gridTiles([c({ n: 10, caseId: "j", outcome: "blocked" }), c({ n: 2, caseId: "b" })], 4);
    expect(tiles.map((t) => [t.label, t.status])).toEqual([
      ["2", "sent"], ["10", "stopped"], ["3", "pending"], ["4", "pending"],
    ]);
    expect(tiles[2].caseId).toBeNull();
    expect(new Set(tiles.map((t) => t.key)).size).toBe(4);
  });
  it("never shrinks below the cases it has", () => {
    expect(gridTiles([c({ caseId: "a" }), c({ caseId: "b", n: 2 })], 0)).toHaveLength(2);
  });
});

describe("headline", () => {
  it("drops the raw decision label and keeps the plain sentence", () => {
    expect(headline(c({ decision: "**Decision:** HOLD FOR A HUMAN. Ask the depot to check the van." })))
      .toBe("Ask the depot to check the van.");
    expect(headline(c({ decision: "ACT. Rebook for Tuesday." }))).toBe("Rebook for Tuesday.");
    expect(headline(c({ decision: "Actually rebook it." }))).toBe("Actually rebook it.");
  });
  it("falls back to the status in words and truncates long text", () => {
    expect(headline(c({ decision: null, outcome: "escalated" }))).toBe("Needs a person");
    expect(headline(c({ decision: "x".repeat(200) }), 20)).toHaveLength(20);
  });
});

describe("runPhase with the server's parsed RUNLOG", () => {
  it("reads { runId, rows } without crashing", async () => {
    const { runPhase } = await import("./logic");
    expect(runPhase({ cases: [], summary: null, runlog: { runId: "r1", rows: [] } })).toBe("waiting");
    expect(() => runPhase({ cases: [{ n: 1, caseId: "1", outcome: "acted" } as never], summary: null, runlog: { runId: "r1", rows: [{}] } })).not.toThrow();
  });
});
