export function fixtureTrace(mode = "practice") {
  return {
    version: 1, caseId: "delivery-024", runId: "review-test-run", mode, flowId: "default-incident",
    events: [
      { kind: "run_start", t: 0, title: "Damaged parcel needs an owner decision" },
      { kind: "node_end", t: 1, nodeId: "triage", output: { type: "triage", urgency: "high" } },
      { kind: "node_end", t: 2, nodeId: "human", output: { type: "human_decision", card: {
        summary: "Customer reports damage; carrier has not confirmed the condition.", routeTo: "Claims team", clash: "Carrier scan says intact; customer reports damage.",
        tried: ["Requested the carrier's evidence"], wouldChangeMyMind: "A carrier inspection", deadlineMins: 15,
        options: [{ id: "investigate", label: "Ask claims team to investigate", undoable: true }, { id: "hold", label: "Hold the refund request", undoable: true }],
        fallback: "Hold the request and send nothing further",
      } } },
      { kind: "run_end", t: 3, outcome: "escalated", totalCostUsd: .03, totalLatencyMs: 2500 },
    ],
  };
}
