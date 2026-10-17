import { describe, expect, it } from "vitest";
import type { Flow, Trace } from "../types";
import flowJson from "../../../../api/flows/default-incident.json";
import { addNode, connect, docSignature, edgeKey, removeNodes, sourceHandleFor, uniqueNodeId, updateEdgeWhen, type FlowDoc } from "./doc";
import { checkpoint, initHistory, push, redo, replace, undo } from "./history";
import { withPositions } from "./layout";
import { ALL_NODE_TYPES, NODE_META, searchNodeTypes } from "./nodeTypes";
import { buildOverlay, fmtMs, fmtUsd, inputsOf, pairKey, replayDelays } from "./status";

const flow = flowJson as Flow;

const trace: Trace = {
  version: 1, runId: "r1", caseId: "delivery-024", flowId: "default-incident", mode: "practice",
  events: [
    { t: 0, kind: "run_start", title: "Missing parcel", inputs: [{ n: 1, channel: "email", from: "a", excerpt: "hi" }] },
    { t: 1, kind: "node_start", nodeId: "ingest", nodeType: "ingest" },
    { t: 900, kind: "model_call", nodeId: "ingest", runner: "claude", model: "claude-x", latencyMs: 880, tokensIn: 10, tokensOut: 5, costUsd: 0.02, ok: true },
    { t: 901, kind: "node_end", nodeId: "ingest", status: "ok", summary: "2 files", latencyMs: 900, costUsd: 0.02 },
    { t: 902, kind: "node_start", nodeId: "history", nodeType: "history_lookup" },
    { t: 903, kind: "node_end", nodeId: "history", status: "ok", summary: "0 commitments", latencyMs: 1, costUsd: 0 },
    { t: 904, kind: "node_start", nodeId: "triage", nodeType: "triage" },
    { t: 950, kind: "node_end", nodeId: "triage", status: "ok", summary: "missing", latencyMs: 46, costUsd: 0,
      output: { type: "triage", caseType: "missing", urgency: "high", p: 0.9 } },
    { t: 951, kind: "node_start", nodeId: "perspectives", nodeType: "perspectives" },
    { t: 952, kind: "node_end", nodeId: "perspectives", status: "skipped", summary: "skipped: no Jev key", latencyMs: 1, costUsd: 0 },
    { t: 953, kind: "node_start", nodeId: "clash", nodeType: "clash_check" },
    { t: 960, kind: "node_end", nodeId: "clash", status: "ok", summary: "no conflict", latencyMs: 7, costUsd: 0 },
    { t: 961, kind: "node_start", nodeId: "planner", nodeType: "planner" },
    { t: 2000, kind: "node_end", nodeId: "planner", status: "ok", summary: "email", latencyMs: 1039, costUsd: 0.05 },
    { t: 2001, kind: "node_start", nodeId: "gate", nodeType: "safety_gate" },
    { t: 2100, kind: "node_end", nodeId: "gate", status: "ok", summary: "1 of 1 cleared", latencyMs: 99, costUsd: 0,
      output: { type: "safety_gate", risk: 0.1, decision: "allow", allowBelow: 0.3, blockAbove: 0.8 } },
    { t: 2101, kind: "edge", from: "gate", to: "action", when: "allow" },
    { t: 2102, kind: "node_start", nodeId: "action", nodeType: "action" },
    { t: 2200, kind: "node_end", nodeId: "action", status: "error", summary: "outbox down", latencyMs: 98, costUsd: 0 },
    { t: 2201, kind: "edge", from: "action", to: "log" },
    { t: 2202, kind: "node_start", nodeId: "log", nodeType: "case_log" },
    { t: 2300, kind: "run_end", outcome: "error", totalCostUsd: 0.07, totalLatencyMs: 2300, error: "boom" },
  ],
};

describe("buildOverlay", () => {
  const o = buildOverlay(trace, flow);
  it("maps node statuses, including skipped, error and still-running-at-error", () => {
    expect(o.nodes.ingest.status).toBe("ok");
    expect(o.nodes.perspectives.status).toBe("skipped");
    expect(o.nodes.action.status).toBe("error");
    expect(o.nodes.log.status).toBe("error"); // was running when run_end said error
    expect(o.nodes.verify).toBeUndefined();
    expect(o.finished).toBe(true);
    expect(o.start?.title).toBe("Missing parcel");
  });
  it("aggregates latency, cost, model calls and order", () => {
    expect(o.nodes.ingest.latencyMs).toBe(900);
    expect(o.nodes.ingest.costUsd).toBeCloseTo(0.02);
    expect(o.nodes.ingest.modelCalls).toHaveLength(1);
    expect(o.nodes.ingest.runs).toBe(1);
    expect(o.nodes.ingest.order).toBe(0);
    expect(o.nodes.gate.output).toMatchObject({ decision: "allow" });
  });
  it("infers linear hops from start order only along flow edges, and keeps explicit edges", () => {
    for (const [a, b] of [["ingest", "history"], ["history", "triage"], ["triage", "perspectives"], ["planner", "gate"], ["gate", "action"], ["action", "log"]]) {
      expect(o.taken.has(pairKey(a, b))).toBe(true);
    }
    expect(o.edges.find((e) => e.from === "gate")).toMatchObject({ to: "action", when: "allow", inferred: false });
    // action->log is not in the flow but was explicitly emitted
    expect(o.edges.find((e) => e.from === "action" && e.to === "log")?.inferred).toBe(false);
    expect(o.taken.has(pairKey("gate", "human"))).toBe(false);
  });
  it("without a flow only explicit edges count", () => {
    const bare = buildOverlay(trace);
    expect(bare.edges.map((e) => pairKey(e.from, e.to))).toEqual(["gate->action", "action->log"]);
  });
  it("supports partial replays", () => {
    const p = buildOverlay(trace, flow, 3);
    expect(p.nodes.ingest.status).toBe("running");
    expect(p.finished).toBe(false);
    expect(buildOverlay(trace, flow, 0).nodes).toEqual({});
  });
  it("lists inputs of a node", () => {
    expect(inputsOf(o, "triage").map((n) => n.nodeId)).toEqual(["history"]);
  });
  it("counts repeated runs", () => {
    const t2: Trace = { ...trace, events: [
      { t: 0, kind: "node_start", nodeId: "planner", nodeType: "planner" },
      { t: 5, kind: "node_end", nodeId: "planner", status: "ok", summary: "a", latencyMs: 5, costUsd: 0.01 },
      { t: 6, kind: "node_start", nodeId: "planner", nodeType: "planner" },
      { t: 9, kind: "node_end", nodeId: "planner", status: "ok", summary: "b", latencyMs: 3, costUsd: 0.01 },
    ] };
    const r = buildOverlay(t2, flow).nodes.planner;
    expect(r.runs).toBe(2);
    expect(r.latencyMs).toBe(8);
    expect(r.summary).toBe("b");
    expect(r.status).toBe("ok");
  });
});

describe("replayDelays", () => {
  it("squeezes into the target and clamps gaps", () => {
    const d = replayDelays(trace, 5000, 60, 900);
    expect(d).toHaveLength(trace.events.length);
    expect(d[0]).toBe(0);
    expect(Math.min(...d.slice(1))).toBeGreaterThanOrEqual(60);
    expect(Math.max(...d)).toBeLessThanOrEqual(900);
  });
});

describe("doc edits", () => {
  const doc: FlowDoc = { flow, positions: withPositions(flow, undefined) };
  it("adds nodes with unique ids and default config", () => {
    const { doc: d, id } = addNode(doc, "safety_gate", { x: 1, y: 2 });
    expect(id).toBe("gate_2");
    expect(d.flow.nodes.at(-1)?.config).toEqual({ allow_below: 0.3, block_above: 0.8 });
    expect(uniqueNodeId("verify", ["verify", "verify_2"])).toBe("verify_3");
  });
  it("removes nodes with their edges", () => {
    const d = removeNodes(doc, ["gate"]);
    expect(d.flow.edges.some((e) => e.from === "gate" || e.to === "gate")).toBe(false);
    expect(d.positions.gate).toBeUndefined();
  });
  it("connects via gate handles as `when`, replacing the old target", () => {
    const d = connect(doc, "gate", "verify", "allow");
    expect(d.flow.edges.filter((e) => e.from === "gate" && e.when === "allow")).toEqual([{ from: "gate", to: "verify", when: "allow" }]);
    expect(connect(doc, "ingest", "ingest", "out")).toBe(doc);
    expect(connect(doc, "ingest", "history", "out")).toBe(doc);
    expect(sourceHandleFor(flow, { from: "gate", to: "human", when: "ask" })).toBe("ask");
    expect(sourceHandleFor(flow, { from: "ingest", to: "history" })).toBe("out");
  });
  it("edits edge labels and detects dirtiness", () => {
    const k = edgeKey({ from: "human", to: "action" });
    const d = updateEdgeWhen(doc, k, "approved");
    expect(d.flow.edges.find((e) => e.from === "human")?.when).toBe("approved");
    expect(docSignature(d)).not.toBe(docSignature(doc));
    expect(docSignature({ ...doc })).toBe(docSignature(doc));
  });
});

describe("history", () => {
  it("undoes and redoes", () => {
    let h = initHistory(1);
    h = push(h, 2);
    h = push(h, 3);
    h = undo(h);
    expect(h.present).toBe(2);
    h = redo(h);
    expect(h.present).toBe(3);
    h = checkpoint(h);
    h = replace(h, 4);
    h = replace(h, 5);
    expect(undo(h).present).toBe(3);
    expect(undo(initHistory(1)).present).toBe(1);
  });
});

describe("node catalogue", () => {
  it("covers every node type with gate outputs", () => {
    expect(ALL_NODE_TYPES).toHaveLength(22);
    expect(NODE_META.safety_gate.outputs).toEqual(["allow", "ask", "block"]);
    expect(searchNodeTypes("gate").map((m) => m.type)).toContain("safety_gate");
    expect(searchNodeTypes("")).toHaveLength(22);
  });
  it("formats", () => {
    expect(fmtMs(450)).toBe("450ms");
    expect(fmtMs(1500)).toBe("1.5s");
    expect(fmtUsd(0.0234)).toBe("$0.023");
    expect(fmtUsd(null)).toBe("–");
  });
});

import { carefulToThresholds, carefulWord, thresholdsToCareful } from "./careful";
import { plainWhen } from "./nodeTypes";

describe("plain words", () => {
  it("maps the careful dial onto thresholds and back", () => {
    expect(carefulToThresholds(0)).toEqual({ allow_below: 0.5, block_above: 0.95 });
    expect(carefulToThresholds(1)).toEqual({ allow_below: 0.15, block_above: 0.65 });
    for (const c of [0, 0.25, 0.5, 0.75, 1]) expect(thresholdsToCareful(carefulToThresholds(c))).toBeCloseTo(c, 1);
    const def = thresholdsToCareful({ allow_below: 0.3, block_above: 0.8 });
    expect(carefulWord(def)).toBe("Balanced");
    const strict = carefulToThresholds(0.9);
    expect(strict.allow_below).toBeLessThan(strict.block_above);
  });
  it("labels branches in plain words", () => {
    expect(["allow", "ask", "block"].map(plainWhen)).toEqual(["OK", "Ask a person", "Stop"]);
    expect(plainWhen("missing_parcel")).toBe("Missing parcel");
    expect(plainWhen("force_human")).toBe("Needs a person");
  });
});
