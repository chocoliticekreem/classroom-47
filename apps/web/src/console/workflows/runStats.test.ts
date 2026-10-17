import { describe, expect, it } from "vitest";
import type { Flow, Trace } from "../types";
import flowJson from "../../../../api/flows/default-incident.json";
import { buildOverlay } from "./status";
import { lastRunView, passedLabel, playbookRuns, runMark, runnerWords, settingRows, tallyRuns } from "./runStats";

const flow = flowJson as Flow;

// Real traces have no node_start events: nodes appear at node_end, hops come from edge events.
function trace(gate: "allow" | "ask", opts: { errorAt?: string } = {}): Trace {
  const ev: Trace["events"] = [
    { t: 0, kind: "run_start", title: "Case: Parcel left in the rain", inputs: [{ n: 1, channel: "email", from: "customer", excerpt: "120 characters" }] },
    { t: 1, kind: "node_end", nodeId: "ingest", status: "ok", summary: "2 files, 0 attachments read", latencyMs: 900, costUsd: 0.02 },
    { t: 1, kind: "edge", from: "ingest", to: "history" },
    { t: 2, kind: "node_end", nodeId: "history", status: opts.errorAt === "history" ? "error" : "ok", summary: "2 open commitments, 2 deadlines", latencyMs: 0, costUsd: 0 },
    { t: 2, kind: "edge", from: "history", to: "triage" },
    { t: 3, kind: "node_end", nodeId: "triage", status: "ok", summary: "damage · high", latencyMs: 300, costUsd: 0,
      output: { type: "triage", caseType: "damage", urgency: "high", p: 0.9 },
      detail: ["Looked at the photo and the message", "Used the jev model to sort it {\"p\":0.9}"] },
    { t: 3, kind: "edge", from: "triage", to: "planner" },
    { t: 4, kind: "node_end", nodeId: "gate", status: "ok", summary: "checked", latencyMs: 10, costUsd: 0.001,
      output: { type: "safety_gate", risk: gate === "allow" ? 0.1 : 0.5, decision: gate, allowBelow: 0.3, blockAbove: 0.8 } },
    { t: 4, kind: "edge", from: "gate", to: gate === "allow" ? "action" : "human", when: gate },
    { t: 5, kind: "run_end", outcome: gate === "allow" ? "acted" : "escalated", totalCostUsd: 0.03, totalLatencyMs: 5 },
  ];
  return { version: 1, runId: "r", caseId: "c", flowId: flow.id, mode: "practice", events: ev } as Trace;
}

describe("runMark", () => {
  const o = buildOverlay(trace("ask", { errorAt: "history" }), flow);
  it("is red when the step went wrong, amber when a person was needed, green otherwise", () => {
    expect(runMark(o.nodes.history)).toBe("error");
    expect(runMark(o.nodes.gate)).toBe("warn");
    expect(runMark(o.nodes.triage)).toBe("ok");
    expect(runMark(null)).toBeNull();
  });
});

describe("tallyRuns", () => {
  it("counts how many runs passed through each step and hop", () => {
    const t = tallyRuns([buildOverlay(trace("allow"), flow), buildOverlay(trace("ask"), flow), buildOverlay(trace("allow"), flow)]);
    expect(t.runs).toBe(3);
    expect(t.nodes.ingest.passed).toBe(3);
    expect(t.nodes.gate).toEqual({ passed: 3, ok: 2, warn: 1, error: 0 });
    expect(t.edges["gate->action"]).toBe(2);
    expect(t.edges["gate->human"]).toBe(1);
    expect(t.nodes.verify).toBeUndefined();
  });
  it("labels the count in words", () => {
    expect(passedLabel({ passed: 7, ok: 7, warn: 0, error: 0 }, 10)).toBe("7 of 10 cases passed here");
    expect(passedLabel(undefined, 4)).toBe("None of the last 4 cases came here");
    expect(passedLabel(undefined, 0)).toBe("");
  });
});

describe("playbookRuns", () => {
  const rows = [
    { id: "a", workflowId: "w", status: "success", startedAt: "2026-10-10T10:00:00Z" },
    { id: "b", workflowId: "w", status: "running", startedAt: "2026-10-10T12:00:00Z" },
    { id: "c", workflowId: "x", status: "success", startedAt: "2026-10-10T11:00:00Z" },
    { id: "d", workflowId: "w", status: "error", startedAt: "2026-10-10T11:30:00Z" },
  ];
  it("keeps finished runs of this playbook, newest first, up to n", () => {
    expect(playbookRuns(rows, "w").map((r) => r.id)).toEqual(["d", "a"]);
    expect(playbookRuns(rows, "w", 1).map((r) => r.id)).toEqual(["d"]);
    expect(playbookRuns(rows, null)).toEqual([]);
  });
});

describe("lastRunView", () => {
  const o = buildOverlay(trace("allow"), flow);
  it("shows the case as the first step's input", () => {
    const v = lastRunView(o, "ingest", flow)!;
    expect(v.input[0].from).toBe("The case");
    expect(v.input[0].lines[0]).toBe("Parcel left in the rain");
    expect(v.output[0]).toBe("Read the messages");
    expect(v.mark).toBe("ok");
    expect(v.cost).toContain("2¢");
  });
  it("names the earlier step in plain words and never leaks model names or JSON", () => {
    const v = lastRunView(o, "triage", flow)!;
    expect(v.input[0].from).toBe("Check past orders");
    const all = [...v.output, ...v.input.flatMap((i) => i.lines)].join(" ");
    expect(all).not.toMatch(/jev|\{|\}/i);
    expect(v.output).toContain("Looked at the photo and the message");
  });
  it("is null for a step that did not run", () => {
    expect(lastRunView(o, "verify", flow)).toBeNull();
    expect(lastRunView(null, "ingest", flow)).toBeNull();
  });
});

describe("settingRows", () => {
  it("turns 0-1 thresholds into sliders and the rest into words", () => {
    const rows = settingRows({ config: { allow_below: 0.3, block_above: 0.8, mode: "strict_mode", rules: { a: 1 }, retries: 2 } });
    expect(rows.find((r) => r.key === "allow_below")).toMatchObject({ label: "Send on its own below", threshold: 0.3 });
    expect(rows.find((r) => r.key === "mode")?.text).toBe("strict mode");
    expect(rows.find((r) => r.key === "rules")?.text).toBe("1 setting");
    expect(rows.find((r) => r.key === "retries")).toMatchObject({ label: "Retries", text: "2" });
    expect(settingRows({})).toEqual([]);
  });
  it("describes runners without model names", () => {
    expect(runnerWords(["code", "jev"])).toBe("Fixed rules, Quick yes/no check");
  });
});
