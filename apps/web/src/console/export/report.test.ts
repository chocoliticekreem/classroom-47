import { describe, expect, it } from "vitest";
import { buildEvidencePack, mdCell, orderSets, summarise, type PackCase, type PackInput } from "./report";
import { dispositionsOf, loadPackInput, outcomeOfGot, selectCases, type ExecRow, type StoredCase, type StoredTestRun } from "./reportData";

const pc = (over: Partial<PackCase> = {}): PackCase => ({
  caseId: "delivery-001", set: "public", at: "2026-10-10T10:00:00Z", outcome: "acted", completed: true, pass: true, score: 1,
  expectedDispositions: ["contact"], disposition: 1, recipient: 1, rulesBroken: [], note: "fine", costUsd: 0.05, durationMs: 30_000,
  executionId: "e1", source: "practice run abcd1234", ...over,
});

const input = (cases: PackCase[]): PackInput => ({ generatedAt: "2026-10-10T12:00:00.000Z", dbLabel: "runs/console.db", cases, ranCases: cases.length + 1, testRuns: [] });

describe("summarise", () => {
  it("matches the ten lines of scripts/eval/report.mjs", () => {
    const s = summarise([
      pc(),
      pc({ caseId: "gen-1", set: "generated", pass: false, score: 0, rulesBroken: ["Never promise a time"] }),
      pc({ caseId: "gen-2", set: "generated", outcome: "escalated", pass: false, score: 0.3, disposition: 0 }),
      pc({ caseId: "gen-3", set: "generated", outcome: "acted", expectedDispositions: ["no_action"], pass: false, score: 0, disposition: 0 }),
      pc({ caseId: "gen-4", outcome: "error", completed: false, pass: false, score: null, disposition: null, recipient: null }),
    ]);
    expect(s.cases).toBe("5");
    expect(s.score).toBe("0.26");
    expect(s.passing).toBe("20% (1 of 5)");
    expect(s.completed).toBe("80% (4 of 5)");
    expect(s.dispositionRight).toBe("50% (2 of 4)");
    expect(s.ownerRight).toBe("100% (4 of 4)");
    expect(s.actedWhenNothingOwed).toBe("100% (1 of 1)");
    expect(s.overEscalated).toBe("25% (1 of 4)");
    expect(s.underEscalated).toBe("n/a (no such cases in this run)");
    expect(s.brokeARule).toBe("20% (1 of 5)");
  });

  it("leaves unrecorded parts out of their denominators", () => {
    const s = summarise([pc(), pc({ caseId: "x", disposition: null, recipient: null, rulesBroken: null, expectedDispositions: null })]);
    expect(s.dispositionRight).toBe("100% (1 of 1)");
    expect(s.brokeARule).toBe("0% (0 of 1)");
    expect(s.passing).toBe("100% (2 of 2)");
  });
});

describe("buildEvidencePack", () => {
  const md = buildEvidencePack(input([
    pc(),
    pc({ caseId: "gen-1", set: "generated", pass: false, score: 0, rulesBroken: ["Never | promise\na time"], note: "bad" }),
    pc({ caseId: "fixture-101", set: "fixtures", disposition: null, recipient: null }),
  ]));

  it("keeps the eval/results.md layout", () => {
    const heads = md.split("\n").filter((l) => l.startsWith("#"));
    expect(heads[0]).toBe("# Eval results");
    expect(heads).toContain("## All cases");
    expect(heads).toContain("## Not passing, per run");
    expect(heads.indexOf("## Organiser practice cases")).toBeLessThan(heads.findIndex((h) => h.startsWith("## Generated hard cases")));
    expect(md).toContain("| Passing (score 0.7 or more, no rule broken) | 67% (2 of 3) |");
    expect(md).toContain("| Cases | 1 |");
  });

  it("lists failures the way report.mjs does and every case with its run id", () => {
    expect(md).toContain("- `gen-1` (generated), 0.00, acted: broke a rule: Never | promise a time");
    expect(md).toContain("| `delivery-001` | acted | right | 1.00 | $0.0500 | 30.0 s | practice run abcd1234 | `e1` |");
    expect(md).toContain("1 case was scored without a per-part breakdown");
    expect(md).toContain("3 cases scored, out of 4 cases with at least one real run");
  });

  it("says so when nothing is scored", () => {
    const empty = buildEvidencePack(input([]));
    expect(empty).toContain("| Cases | 0 |");
    expect(empty).toContain("None.");
    expect(empty).toContain("none yet");
  });

  it("orders sets and cleans table cells", () => {
    expect(orderSets(["zeta", "fixtures", "public", "generated", "public"])).toEqual(["public", "generated", "fixtures", "zeta"]);
    expect(mdCell("a | b\nc")).toBe("a / b c");
  });
});

const sc = (over: Partial<StoredCase> = {}): StoredCase => ({
  caseId: "delivery-001", dataset: "public", executionId: "e1", status: "passed", score: 0.9, breakdown: { disposition: 1, recipient: 1, channel: 0, content: 1 } as StoredCase["breakdown"],
  mustNotBroken: [], verdict: "ok", expected: "contact: Customer portal → Vessa", got: "asked_for_info: Customer portal → Vessa", costUsd: 0.07, durationMs: 35_000, ...over,
});
const tr = (id: string, startedAt: string, cases: StoredCase[]): StoredTestRun => ({
  id, workflowId: "default-incident", version: 1, set: "quick", status: "done", startedAt, cases,
  summary: { total: cases.length, passed: 0, failed: 0, errors: 0, meanScore: null, costUsd: 0 },
});
const ex = (over: Partial<ExecRow> = {}): ExecRow => ({
  id: "e1", caseId: "delivery-001", dataset: "public", status: "success", outcome: "asked_for_info", startedAt: "2026-10-10T11:00:00Z",
  durationMs: 35_000, costUsd: 0.07, simulated: false, evalPass: true, evalScore: 0.9, evalNotes: "ok", ...over,
});

describe("selectCases", () => {
  it("keeps a judged run over a later outage error, and the latest judged run otherwise", () => {
    const cases = selectCases(
      [
        tr("run-a", "2026-10-10T11:00:00Z", [sc()]),
        tr("run-b", "2026-10-10T12:00:00Z", [sc({ executionId: "e2", status: "error", score: null, breakdown: null, verdict: "agent error: 500", got: null })]),
      ],
      [ex(), ex({ id: "e2", status: "error", outcome: null, startedAt: "2026-10-10T12:00:00Z", evalPass: null, evalScore: null })],
    );
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ executionId: "e1", pass: true, outcome: "asked_for_info", expectedDispositions: ["contact"], disposition: 1, source: "practice run run-a" });
  });

  it("uses eval verdicts on executions no practice run covers, and skips simulated runs", () => {
    const cases = selectCases([], [
      ex({ id: "e9", caseId: "gen-9", dataset: "generated", evalPass: false, evalScore: 0.4 }),
      ex({ id: "e10", caseId: "city-001", dataset: "city", simulated: true }),
      ex({ id: "e11", caseId: "gen-11", evalPass: null }),
    ]);
    expect(cases.map((c) => c.caseId)).toEqual(["gen-9"]);
    expect(cases[0]).toMatchObject({ source: "eval import", disposition: null, rulesBroken: null, pass: false });
  });

  it("keeps the latest failure when a case never got judged", () => {
    const cases = selectCases([tr("r", "2026-10-10T12:00:00Z", [sc({ executionId: null, status: "error", got: null })])], []);
    expect(cases[0]).toMatchObject({ completed: false, pass: false, outcome: "error", rulesBroken: [] });
  });

  it("parses the short answer key and the short result", () => {
    expect(dispositionsOf("contact: Email → X (+1 more)")).toEqual(["contact"]);
    expect(dispositionsOf("escalate / no_action")).toEqual(["escalate", "no_action"]);
    expect(dispositionsOf("?")).toBeNull();
    expect(dispositionsOf(null)).toBeNull();
    expect(outcomeOfGot("escalated: handed to the supervisor")).toBe("escalated");
    expect(outcomeOfGot("weird")).toBeNull();
  });
});

describe("loadPackInput", () => {
  it("reads both tables through any prepare().all() handle", () => {
    const db = {
      prepare: (sql: string) => ({
        all: () => (sql.includes("FROM executions")
          ? [{ id: "e1", case_id: "delivery-001", dataset: "public", status: "success", outcome: "acted", started_at: "2026-10-10T11:00:00Z", duration_ms: 1000, cost_usd: 0.01, simulated: 0, eval_pass: 1, eval_score: 1, eval_notes: null }]
          : [{ id: "t1", workflow_id: "w", version: 2, scenario_set: "quick", status: "done", started_at: "2026-10-10T10:00:00Z", cases: "not json", summary: null }]),
      }),
    };
    const got = loadPackInput(db, "runs/console.db", new Date("2026-10-10T12:00:00Z"));
    expect(got.cases).toHaveLength(1);
    expect(got.ranCases).toBe(1);
    expect(got.testRuns[0]).toMatchObject({ id: "t1", version: 2, summary: { total: 0 } });
    expect("cases" in got.testRuns[0]).toBe(false);
  });
});
