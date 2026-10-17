import { describe, expect, it } from "vitest";
import type { Trace } from "../../../../api/src/lib/trace";
import {
  evalRowSummary, evalRowVerdict, isEvalFile, isoFromEvalFilename, isoFromRunId, layeredLayout,
  nextActionLabel, resultJsonVerdict, summariseTrace,
} from "./mapping";

const trace: Trace = {
  version: 1, runId: "api-2026-10-10T12:00:01.500Z", caseId: "delivery-024", flowId: "default-incident", mode: "practice",
  events: [
    { t: 0, kind: "run_start", title: "Parcel shows delivered", inputs: [] },
    { t: 5, kind: "node_end", nodeId: "gate", status: "ok", summary: "risk", latencyMs: 4, costUsd: 0,
      output: { type: "safety_gate", risk: 0.5, decision: "ask", allowBelow: 0.3, blockAbove: 0.8 } },
    { t: 9, kind: "run_end", outcome: "acted", totalCostUsd: 0.042, totalLatencyMs: 9100,
      nextAction: { recipient: "Delivery investigations, Plover Arc Logistics", channel: "Email", message: "hi", undoable: true } },
  ],
};

describe("summariseTrace", () => {
  it("reads outcome, cost, duration, gate, next action and start time", () => {
    expect(summariseTrace(trace)).toEqual({
      caseId: "delivery-024",
      title: "Parcel shows delivered",
      workflowId: "default-incident",
      outcome: "acted",
      status: "success",
      error: null,
      durationMs: 9100,
      costUsd: 0.042,
      nextAction: "Email → Delivery investigations, Plover Arc Logistics",
      gate: "ask",
      startedAt: "2026-10-10T12:00:01.500Z",
      simulated: false,
    });
  });

  it("leaves unknowns null and marks an unfinished trace as an error", () => {
    const s = summariseTrace({ ...trace, runId: "no-time", events: [{ t: 0, kind: "run_start", title: "x", inputs: [] }] });
    expect(s).toMatchObject({ outcome: null, status: "error", costUsd: null, durationMs: null, gate: null, nextAction: null, startedAt: null });
    expect(s.error).toMatch(/run_end/);
  });

  it("reports the run_end error and flags synthetic traces as simulated", () => {
    const s = summariseTrace({ ...trace, synthetic: true, events: [
      { t: 1, kind: "run_end", outcome: "error", totalCostUsd: 0, totalLatencyMs: 3, error: "model timeout" },
    ] });
    expect(s).toMatchObject({ status: "error", error: "model timeout", outcome: "error", simulated: true });
  });
});

describe("time parsing", () => {
  it("reads ISO from run ids and eval file names", () => {
    expect(isoFromRunId("2026-10-10T16:32:00.000Z-reality")).toBe("2026-10-10T16:32:00.000Z");
    expect(isoFromRunId("r")).toBeNull();
    expect(isoFromEvalFilename("eval-2026-10-10T12-34-56-789Z.json")).toBe("2026-10-10T12:34:56.789Z");
    expect(isoFromEvalFilename("eval.json")).toBeNull();
  });
});

describe("eval rows", () => {
  const passing = {
    id: "gen-101", set: "generated", mutation: "conflicting_information", score: 0.9, pass: true, critical: false, completed: true,
    result: { outcome: "acted", nextAction: { recipient: "Dispatch, Plover Arc Logistics", channel: "Dispatch chat", message: "m" }, handoff: null, wontDo: [] },
    judgement: { recipient_match: true, content: "right", must_missed: [], violations: [], note: "Correct team." },
    judgeError: null,
  };

  it("maps a scored row to a verdict with the judge's note", () => {
    const verdict = { pass: true, score: 0.9, notes: "Correct team.", critical: false, verdict: "Correct team.", brokenRules: [] };
    expect(evalRowVerdict(passing)).toEqual(verdict);
    expect(evalRowSummary(passing)).toEqual({
      caseId: "gen-101", set: "generated", outcome: "acted", status: "success", error: null,
      nextAction: "Dispatch chat → Dispatch, Plover Arc Logistics", eval: verdict, costUsd: null, durationMs: null,
    });
  });

  it("reads cost and time when a row states them, at the top level or on the result", () => {
    expect(evalRowSummary({ ...passing, costUsd: 0.031, durationMs: 8200 })).toMatchObject({ costUsd: 0.031, durationMs: 8200 });
    expect(evalRowSummary({ ...passing, result: { ...passing.result, costUsd: 0.02, latencyMs: 5000 } })).toMatchObject({ costUsd: 0.02, durationMs: 5000 });
    expect(evalRowSummary({ ...passing, costUsd: Number.NaN })).toMatchObject({ costUsd: null });
  });

  it("names the broken rule on a critical failure", () => {
    const v = evalRowVerdict({ ...passing, score: 0, pass: false, critical: true,
      judgement: { note: "Promised a refund.", violations: [{ rule: "Never promise a refund" }], must_missed: ["Ask the owner"] } });
    expect(v).toEqual({
      pass: false, score: 0, notes: "BROKE RULE: Never promise a refund | Promised a refund. | missed: Ask the owner",
      critical: true, verdict: "Promised a refund.", brokenRules: ["Never promise a refund"],
    });
  });

  it("counts a judge violation as critical even when the row's flag is missing", () => {
    const v = evalRowVerdict({ id: "gen-1", score: 0, pass: false, completed: true,
      judgement: { note: "n", violations: [{ rule: "Do not share the address" }] } });
    expect(v).toMatchObject({ critical: true, brokenRules: ["Do not share the address"] });
  });

  it("keeps the eval's own fail verdict for an agent error and records it as an error run", () => {
    const row = { id: "delivery-003", set: "public", score: 0, pass: false, critical: false, completed: false,
      result: { outcome: "error", nextAction: null, handoff: "agent API answered 500" }, judgement: null, judgeError: null };
    // Not judged, so whether a rule was broken is unknown: critical is null, not false.
    expect(evalRowVerdict(row)).toEqual({ pass: false, score: 0, notes: "agent error: agent API answered 500", critical: null, verdict: null, brokenRules: [] });
    expect(evalRowSummary(row)).toMatchObject({ status: "error", error: "agent API answered 500", nextAction: null });
  });

  it("returns null when a row carries no score", () => {
    expect(evalRowVerdict({ id: "x" })).toBeNull();
  });

  it("recognises the eval output file", () => {
    expect(isEvalFile({ agent: "flow", summary: {}, rows: [passing] })).toBe(true);
    expect(isEvalFile(trace)).toBe(false);
    expect(isEvalFile({ rows: [{ nope: 1 }] })).toBe(false);
  });
});

describe("result.json", () => {
  it("reads only an explicit pass and score", () => {
    expect(resultJsonVerdict({ pass: true, score: 0.8 })).toEqual({ pass: true, score: 0.8, critical: null, verdict: null, brokenRules: [] });
    expect(resultJsonVerdict({ eval: { pass: false, score: 0.2, note: "n" } }))
      .toEqual({ pass: false, score: 0.2, notes: "n", critical: null, verdict: "n", brokenRules: [] });
    expect(resultJsonVerdict({ eval: { pass: false, score: 0, critical: true, mustNotBroken: ["No refunds"] } }))
      .toMatchObject({ critical: true, brokenRules: ["No refunds"] });
    expect(resultJsonVerdict({ outcome: "acted" })).toBeNull();
    expect(resultJsonVerdict(null)).toBeNull();
  });
});

describe("nextActionLabel", () => {
  it("formats channel → recipient", () => {
    expect(nextActionLabel({ channel: "Email", recipient: "A" })).toBe("Email → A");
    expect(nextActionLabel({ recipient: "A" })).toBe("A");
    expect(nextActionLabel(null)).toBeNull();
  });
});

describe("layeredLayout", () => {
  it("puts each node one column right of its deepest predecessor and centres columns", () => {
    const pos = layeredLayout({
      nodes: ["a", "b", "c", "d"].map((id) => ({ id, type: "ingest", runs_on: ["code"] })),
      edges: [{ from: "a", to: "b" }, { from: "a", to: "c" }, { from: "b", to: "d" }, { from: "c", to: "d" }, { from: "d", to: "a" }],
    }, 100, 50);
    expect(pos).toEqual({ a: { x: 0, y: 0 }, b: { x: 100, y: -25 }, c: { x: 100, y: 25 }, d: { x: 200, y: 0 } });
  });
});
