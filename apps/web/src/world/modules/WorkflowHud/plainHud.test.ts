import { describe, expect, it } from "vitest";
import type { Trace } from "../../../../../api/src/lib/trace";
import { traceToTimedEvents } from "../../agentBridge";
import type { WorkflowEvent } from "../../store";
import { caseLine, caseTitle, FLOW_NODES, stepName, summariseCases } from "./flow";

// Words a person must never read in the HUD (docs/plans/ui-simplify-brief.md).
const LEAK = /\b(jev|claude|outbox|config|trace|run_end|json|mock|synthetic|safety_gate|human_decision|perspectives|missed_or_failed_delivery)\b|_/i;

const trace: Trace = {
  version: 1, runId: "api-7", caseId: "city-inc-1-x", flowId: "default-incident", mode: "demo", synthetic: true,
  events: [
    { t: 0, kind: "run_start", title: "x", inputs: [] },
    { t: 1, kind: "node_start", nodeId: "triage", nodeType: "triage" },
    { t: 9, kind: "node_end", nodeId: "triage", status: "ok", summary: "missed_or_failed_delivery · medium", latencyMs: 8, costUsd: 0,
      output: { type: "triage", caseType: "missed_or_failed_delivery", urgency: "medium", p: 0.9 } },
    { t: 10, kind: "node_start", nodeId: "perspectives", nodeType: "perspectives" as never },
    { t: 11, kind: "node_end", nodeId: "perspectives", status: "skipped", summary: "skipped: no Jev key", latencyMs: 1, costUsd: 0 },
    { t: 12, kind: "node_start", nodeId: "verify", nodeType: "verify" },
    { t: 20, kind: "node_end", nodeId: "verify", status: "ok", summary: "accepted by the outbox; receipt and reply unverified", latencyMs: 8, costUsd: 0 },
    { t: 30, kind: "run_end", outcome: "acted", totalCostUsd: 0.0781, totalLatencyMs: 30,
      nextAction: { recipient: "Tracking support, Plover Arc", channel: "Email", message: "Please review the attempt.", undoable: true } },
  ],
};

function replayed(): WorkflowEvent[] {
  return traceToTimedEvents(trace, "INC-001 · car crash", { origin: "city_incident" }).map((t, i) => ({ ...t.event, id: `e${i}`, t: t.atMs }));
}

describe("plain words in the city HUD", () => {
  it("names steps in plain words, never ids or runner names", () => {
    expect(stepName("gate")).toBe("Safety check");
    expect(stepName("human")).toBe("Ask a person");
    expect(stepName("log")).toBe("Done");
    for (const n of FLOW_NODES) expect(n.label).not.toMatch(LEAK);
  });

  it("titles cases plainly", () => {
    expect(caseTitle("INC-001 · car crash")).toBe("Car crash");
    expect(caseTitle("DLY-002 · 3 late")).toBe("3 late deliveries");
    expect(caseTitle("RUN-001 · delivery-024")).not.toMatch(/delivery-024/);
  });

  it("never stores a raw step summary from a trace", () => {
    for (const e of replayed()) expect(e.summary, e.summary).not.toMatch(LEAK);
    const end = replayed().find((e) => e.costUsd !== undefined)!;
    expect(end.summary).toBe("Done: Sent");
  });

  it("gives one plain sentence and a status word per case", () => {
    const events = replayed();
    const [c] = summariseCases(events);
    const line = caseLine(events, c);
    expect(line).toEqual({ title: "Car crash", sentence: "Messaged Tracking support, Plover Arc.", status: "Done" });
    const waiting: WorkflowEvent[] = [{ id: "a", t: 0, caseId: "INC-002 · pileup", nodeId: "ingest", status: "start", summary: "x", source: "agent" }];
    expect(caseLine(waiting, summariseCases(waiting)[0]).sentence).toBe("Waiting for the answer…");
    const asking: WorkflowEvent[] = [{ ...waiting[0], nodeId: "human", status: "ask" }];
    expect(caseLine(asking, summariseCases(asking)[0])).toMatchObject({ sentence: "A person needs to decide.", status: "Needs a person" });
  });
});
