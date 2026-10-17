import { describe, expect, it } from "vitest";
import type { Trace } from "../types";
import {
  anyRunning, buildTimeline, datasetsOf, filterExecutions, fmtCost, fmtDuration, fmtStarted, gateBar,
  sortExecutions, traceTotals, type ExecutionSummary, RESULT_CHIPS, chipCounts, chipOf, matchesChip,
} from "./logic";

const ex = (o: Partial<ExecutionSummary>): ExecutionSummary => ({
  id: "x", caseId: "delivery-001", dataset: "public", workflowId: "default-incident", status: "success",
  outcome: "acted", startedAt: "2026-10-10T10:00:00Z", durationMs: 1000, costUsd: 0.01, origin: "answers",
  simulated: false, eval: null, ...o,
});

describe("execution list", () => {
  const rows = [
    ex({ id: "a", status: "success", dataset: "public", startedAt: "2026-10-10T10:00:00Z" }),
    ex({ id: "b", status: "running", dataset: "generated", startedAt: "2026-10-10T09:00:00Z", caseId: "gen-007" }),
    ex({ id: "c", status: "error", dataset: "public", startedAt: "2026-10-10T11:00:00Z" }),
  ];
  it("filters by status, dataset and query", () => {
    expect(filterExecutions(rows, { status: "all", dataset: "public" }).map((r) => r.id)).toEqual(["a", "c"]);
    expect(filterExecutions(rows, { status: "error", dataset: "all" }).map((r) => r.id)).toEqual(["c"]);
    expect(filterExecutions(rows, { status: "all", dataset: "all", q: "GEN" }).map((r) => r.id)).toEqual(["b"]);
  });
  it("sorts running first then newest", () => {
    expect(sortExecutions(rows).map((r) => r.id)).toEqual(["b", "c", "a"]);
  });
  it("knows when to poll and lists datasets", () => {
    expect(anyRunning(rows)).toBe(true);
    expect(anyRunning([rows[0]])).toBe(false);
    expect(datasetsOf(rows)).toEqual(["generated", "public"]);
  });
});

describe("formatters", () => {
  it("formats durations and costs", () => {
    expect(fmtDuration(null)).toBe("–");
    expect(fmtDuration(420)).toBe("420 ms");
    expect(fmtDuration(4200)).toBe("4.2 s");
    expect(fmtDuration(95000)).toBe("1m 35s");
    expect(fmtCost(null)).toBe("–");
    expect(fmtCost(0.0012)).toBe("$0.0012");
    expect(fmtCost(0.123)).toBe("$0.123");
  });
  it("formats started-at relative to now", () => {
    const now = Date.parse("2026-10-10T12:00:00Z");
    expect(fmtStarted("2026-10-10T11:59:50Z", now)).toBe("just now");
    expect(fmtStarted("2026-10-10T11:50:00Z", now)).toBe("10m ago");
    expect(fmtStarted("2026-10-08T11:50:00Z", now)).toBe("2026-10-08 11:50");
  });
});

const trace: Trace = {
  version: 1, runId: "r", caseId: "delivery-001", flowId: "default-incident", mode: "practice",
  events: [
    { t: 0, kind: "run_start", title: "Parcel missing", inputs: [{ n: 1, channel: "email", from: "cust", excerpt: "where" }] },
    { t: 1, kind: "node_start", nodeId: "triage", nodeType: "triage" },
    { t: 5, kind: "model_call", nodeId: "triage", runner: "claude", model: "claude-sonnet", latencyMs: 4, tokensIn: 1200, tokensOut: 300, costUsd: 0.01, ok: true },
    { t: 6, kind: "node_end", nodeId: "triage", status: "ok", summary: "high", latencyMs: 5, costUsd: 0.01 },
    { t: 6, kind: "edge", from: "triage", to: "gate" },
    { t: 7, kind: "node_start", nodeId: "gate", nodeType: "safety_gate" },
    { t: 8, kind: "node_end", nodeId: "gate", status: "ok", summary: "ask", latencyMs: 1, costUsd: 0,
      output: { type: "safety_gate", risk: 0.55, decision: "ask", allowBelow: 0.3, blockAbove: 0.8 } },
    { t: 8, kind: "edge", from: "gate", to: "human", when: "ask" },
    { t: 9, kind: "node_start", nodeId: "human", nodeType: "human_decision" },
    { t: 10, kind: "node_end", nodeId: "human", status: "ok", summary: "card", latencyMs: 1, costUsd: 0,
      output: { type: "human_decision", card: { routeTo: "Supervisor", summary: "s", tried: [], options: [{ id: "a", label: "Refund", undoable: false }], wouldChangeMyMind: "proof", deadlineMins: 30, fallback: "hold" } } },
    { t: 11, kind: "run_end", outcome: "escalated", totalCostUsd: 0.01, totalLatencyMs: 11,
      nextAction: { recipient: "Supervisor", channel: "email", message: "please decide", undoable: true } },
  ],
};

describe("buildTimeline", () => {
  it("folds events into node steps with model calls, gate and card", () => {
    const items = buildTimeline(trace);
    expect(items.map((i) => i.kind)).toEqual(["run_start", "node", "edge", "node", "edge", "node", "run_end"]);
    const triage = items[1] as Extract<(typeof items)[number], { kind: "node" }>;
    expect(triage.calls).toHaveLength(1);
    expect(triage.status).toBe("ok");
    const gate = items[3] as Extract<(typeof items)[number], { kind: "node" }>;
    expect(gate.gate).toEqual({ risk: 0.55, decision: "ask", allowBelow: 0.3, blockAbove: 0.8 });
    const human = items[5] as Extract<(typeof items)[number], { kind: "node" }>;
    expect(human.card?.options[0].label).toBe("Refund");
    const end = items[6] as Extract<(typeof items)[number], { kind: "run_end" }>;
    expect(end.nextAction?.recipient).toBe("Supervisor");
  });
  it("leaves unfinished nodes running and tolerates orphan node_end", () => {
    const items = buildTimeline({ ...trace, events: [
      { t: 0, kind: "node_start", nodeId: "a", nodeType: "triage" },
      { t: 3, kind: "node_end", nodeId: "b", status: "error", summary: "x", latencyMs: 2, costUsd: 0 },
    ] });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: "node", status: "running" });
    expect(items[1]).toMatchObject({ kind: "node", nodeId: "b", status: "error", t: 1 });
  });
  it("returns nothing for a missing trace", () => {
    expect(buildTimeline(null)).toEqual([]);
  });
  it("totals tokens and cost", () => {
    expect(traceTotals(trace)).toEqual({ calls: 1, tokensIn: 1200, tokensOut: 300, costUsd: 0.01 });
  });
});

describe("gateBar", () => {
  it("clamps into percentages", () => {
    expect(gateBar({ risk: 1.4, allowBelow: 0.3, blockAbove: 0.8, decision: "block" })).toEqual({ risk: 100, allow: 30, block: 80 });
  });
});

describe("result chips", () => {
  const rows = [
    { status: "success" as const, outcome: "acted" },
    { status: "success" as const, outcome: "acted" },
    { status: "success" as const, outcome: "escalated" },
    { status: "success" as const, outcome: "asked_for_info" },
    { status: "success" as const, outcome: "blocked" },
    { status: "error" as const, outcome: null },
    { status: "success" as const, outcome: "error" },
    { status: "running" as const, outcome: null },
    { status: "success" as const, outcome: "no_action" },
  ];
  it("counts each chip, with All covering everything", () => {
    expect(chipCounts(rows)).toEqual({ all: 9, sent: 2, person: 1, asked: 1, stopped: 1, failed: 2 });
  });
  it("matches rows to chips", () => {
    expect(rows.filter((r) => matchesChip(r, "failed"))).toHaveLength(2);
    expect(rows.filter((r) => matchesChip(r, "all"))).toHaveLength(9);
    expect(chipOf({ status: "running", outcome: null })).toBeNull();
    expect(RESULT_CHIPS.map((c) => c.label)).toEqual(["All", "Sent", "Needs a person", "Asked", "Stopped", "Didn't finish"]);
  });
});
