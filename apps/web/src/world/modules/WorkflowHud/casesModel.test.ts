import { describe, expect, it } from "vitest";
import type { WorkflowEvent } from "../../store";
import { caseEvents, caseForCaseId, caseIdOf, currentStep, isCityMade, mergeCases, resolveSelection, runPath, stateFromEvents, stateFromRun, type MergeInput, type SavedRun } from "./casesModel";

let n = 0;
const ev = (caseId: string, t: number, p: Partial<WorkflowEvent> = {}): WorkflowEvent => ({
  id: `e${n++}`, t, caseId, nodeId: "ingest", status: "start", summary: "Reading…", ...p,
});
const run = (p: Partial<SavedRun>): SavedRun => ({
  id: "x1", caseId: "delivery-007", title: "AGT-001 · delivery-007", status: "success", outcome: "acted", startedAt: new Date(1_000_000).toISOString(), card: null, runId: "r1", ...p,
});
const base = (p: Partial<MergeInput>): MergeInput => ({ workflow: [], runs: [], perfNow: 10_000, epochNow: 2_000_000, ...p });

describe("helpers", () => {
  it("reads the case id from a feed label", () => {
    expect(caseIdOf("AGT-003 · delivery-007")).toBe("delivery-007");
    expect(caseIdOf("delivery-007")).toBe("delivery-007");
  });
  it("spots city-made incident and late-van cases", () => {
    expect(isCityMade("INC-001 · car crash")).toBe(true);
    expect(isCityMade("DLY-002 · 3 late")).toBe(true);
    expect(isCityMade("city-inc-2-INC-458")).toBe(true);
    expect(isCityMade("city-delay-4")).toBe(true);
    expect(isCityMade("AGT-001 · delivery-007")).toBe(false);
    expect(isCityMade("gen-007")).toBe(false);
  });
  it("maps HUD lines to a plain state", () => {
    expect(stateFromEvents([])).toBe("waiting");
    expect(stateFromEvents([{ nodeId: "ingest", status: "start", summary: "Waiting: budget" }])).toBe("waiting");
    expect(stateFromEvents([{ nodeId: "triage", status: "ok", summary: "x" }])).toBe("working");
    expect(stateFromEvents([{ nodeId: "human", status: "ask", summary: "x" }])).toBe("person");
    expect(stateFromEvents([{ nodeId: "log", status: "ok", summary: "Done" }])).toBe("sent");
    expect(stateFromEvents([{ nodeId: "gate", status: "block", summary: "x" }, { nodeId: "log", status: "ok", summary: "Done" }])).toBe("stopped");
  });
  it("maps saved runs to a plain state", () => {
    expect(stateFromRun({ status: "running" })).toBe("working");
    expect(stateFromRun({ status: "error" })).toBe("stopped");
    expect(stateFromRun({ status: "success", outcome: "escalated" })).toBe("person");
    expect(stateFromRun({ status: "success", outcome: "blocked" })).toBe("stopped");
    expect(stateFromRun({ status: "success", outcome: "acted" })).toBe("sent");
  });
});

describe("mergeCases", () => {
  it("lists real cases only, never city incidents or late vans", () => {
    const items = mergeCases(base({
      workflow: [ev("INC-001 · car crash", 9_000), ev("DLY-001 · 2 late", 9_100), ev("AGT-001 · delivery-007", 9_200)],
      runs: [run({ id: "c", caseId: "city-inc-2-INC-458", title: "city-inc-2-INC-458", runId: "rc" })],
    }));
    expect(items.map((i) => i.caseId)).toEqual(["delivery-007"]);
  });

  it("merges a saved run with its feed lines (no duplicates)", () => {
    const items = mergeCases(base({
      workflow: [ev("AGT-001 · delivery-007", 9_500, { executionId: "x1" }), ev("AGT-001 · delivery-007", 9_900, { nodeId: "log", status: "ok", summary: "Done", executionId: "x1" })],
      runs: [run({})],
    }));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: "ex:x1", state: "sent", executionId: "x1", runId: "r1", caseId: "delivery-007" });
  });

  it("links a run to a feed case by label when the feed has no execution id yet", () => {
    const items = mergeCases(base({ workflow: [ev("AGT-001 · delivery-007", 9_500)], runs: [run({ status: "running" })] }));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: "ex:x1", label: "AGT-001 · delivery-007" });
  });

  it("keeps runs that only live in SQLite, newest first, with their state", () => {
    const items = mergeCases(base({ runs: [run({ id: "a", runId: "ra", card: { x: 1 } }), run({ id: "b", runId: "rb", status: "error", caseId: "gen-002", title: null, startedAt: new Date(1_500_000).toISOString() })] }));
    expect(items.map((i) => [i.key, i.state, i.caseId])).toEqual([["ex:b", "stopped", "gen-002"], ["ex:a", "person", "delivery-007"]]);
  });

  it("puts the camera where the case was acted out", () => {
    const items = mergeCases(base({ workflow: [ev("AGT-001 · delivery-007", 9_500)], positions: { "delivery-007": { x: 5, z: 6 } } }));
    expect(items[0].pos).toEqual({ x: 5, z: 6 });
  });
});

describe("selection", () => {
  const items = mergeCases(base({ workflow: [ev("AGT-001 · delivery-007", 9_500), ev("RUN-001 · gen-003", 9_600)] }));
  it("finds a case by its case id", () => {
    expect(caseForCaseId(items, "gen-003")?.label).toBe("RUN-001 · gen-003");
    expect(caseForCaseId(items, "nope")).toBeNull();
  });
  it("follows the case when its key changes", () => {
    expect(resolveSelection(items, { key: "ex:gone", label: "AGT-001 · delivery-007" })?.caseId).toBe("delivery-007");
    expect(resolveSelection(items, null)).toBeNull();
  });
  it("lists only the selected case's lines", () => {
    const wf = [ev("A", 1), ev("B", 2), ev("A", 3)];
    expect(caseEvents(wf, { ...items[0], label: "A" }).map((e) => e.t)).toEqual([1, 3]);
    expect(caseEvents(wf, null)).toEqual([]);
  });
});

describe("runPath", () => {
  const rows = [
    { atMs: 0, nodeId: "ingest", status: "start" as const, summary: "Reading" },
    { atMs: 100, nodeId: "ingest", status: "ok" as const, summary: "Read the messages" },
    { atMs: 300, nodeId: "triage", status: "ok" as const, summary: "Problem: crash" },
    { atMs: 600, nodeId: "gate", status: "block" as const, summary: "Too risky" },
  ];
  it("lists only the steps the run took, in order, with their latest status", () => {
    const p = runPath(rows);
    expect(p.map((s) => [s.nodeId, s.status])).toEqual([["ingest", "ok"], ["triage", "ok"], ["gate", "block"], ["block", "block"]]);
    expect(p[0].lines).toHaveLength(2);
    expect(p[0].atMs).toBe(0);
  });
  it("shows every step with showAll, untouched ones empty", () => {
    const p = runPath(rows, true);
    expect(p.length).toBeGreaterThanOrEqual(13);
    expect(p.find((s) => s.nodeId === "planner")).toMatchObject({ status: null, lines: [] });
    expect(p.find((s) => s.nodeId === "triage")?.status).toBe("ok");
  });
  it("picks the last reached step as current", () => {
    expect(currentStep(runPath(rows, true))).toBe("block");
    expect(currentStep([])).toBeNull();
  });
});
