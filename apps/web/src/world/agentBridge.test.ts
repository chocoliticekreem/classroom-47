import { describe, expect, it } from "vitest";
import type { Trace } from "../../../api/src/lib/trace";
import { outcomeOf, toCaseView, traceToTimedEvents } from "./agentBridge";
import { SCENARIOS } from "./scenarios";

const trace: Trace = {
  version: 1, runId: "r", caseId: "city-delivery-024", flowId: "default-incident", mode: "demo",
  events: [
    { t: 0, kind: "run_start", title: "x", inputs: [] },
    { t: 1, kind: "node_start", nodeId: "triage", nodeType: "triage" },
    { t: 50, kind: "node_end", nodeId: "triage", status: "ok", summary: "missing parcel", latencyMs: 50, costUsd: 0 },
    { t: 51, kind: "node_start", nodeId: "gate", nodeType: "safety_gate" },
    { t: 99, kind: "node_end", nodeId: "gate", status: "ok", summary: "risk 0.5", latencyMs: 4000, costUsd: 0,
      output: { type: "safety_gate", risk: 0.5, decision: "ask", allowBelow: 0.3, blockAbove: 0.8 } },
    { t: 120, kind: "run_end", outcome: "acted", totalCostUsd: 0.01, totalLatencyMs: 120,
      nextAction: { recipient: "Delivery investigations, Plover Arc Logistics", channel: "Email", message: "Please open an investigation", undoable: true } },
  ],
};

describe("agent bridge", () => {
  it("builds a case view with only escalation-time messages and modifier messages", () => {
    const s = SCENARIOS.find((x) => x.id === "delivery-024")!;
    const v = toCaseView(s, ["prompt_injection"]);
    expect(v.events).toHaveLength(s.messages.length + 1);
    expect(JSON.stringify(v)).not.toContain(s.expected!.summary);
    expect(v.mode).toBe("demo");
  });
  it("replays a trace with clamped timing, gate status and a matchable action line", () => {
    const ev = traceToTimedEvents(trace, "AGT-1 · delivery-024");
    const gate = ev.find((e) => e.event.nodeId === "gate" && e.event.status !== "start")!;
    expect(gate.event.status).toBe("ask");
    const triageEnd = ev.find((e) => e.event.nodeId === "triage" && e.event.status === "ok")!;
    expect(triageEnd.atMs).toBe(600); // 50 ms clamped up to 600
    expect(gate.atMs).toBe(600 + 2500); // 4000 ms clamped down
    const action = ev.find((e) => e.event.nodeId === "action")!;
    expect(action.event.summary).toMatch(/^Email → Delivery investigations/);
    expect(ev.every((e) => e.event.source === "agent")).toBe(true);
    expect(outcomeOf(trace)).toBe("acted");
  });
});
