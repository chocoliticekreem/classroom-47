import { describe, expect, it } from "vitest";
import type { StoredExecution } from "../server/store";
import { answerSummary, runBaseName, runFiles, stepList } from "./runFiles";

const exec = (over: Partial<StoredExecution> = {}): StoredExecution => ({
  id: "1a619ef0-2b34-4980-b172-b3587000e6f1", caseId: "delivery-024", dataset: "public", workflowId: "default-incident", status: "success",
  outcome: "acted", startedAt: "2026-10-10T11:00:00Z", durationMs: 35_000, costUsd: 0.0781, origin: "console", simulated: false,
  eval: { pass: true, score: 0.9, notes: "Right team." }, error: null, title: "Case 024: Parcel missing", nextAction: null, gate: "allow",
  answerMd: null, reasoningMd: null, card: null, parentExecutionId: null, voice: null,
  outbox: [{ action: { recipient: "Delivery investigations", channel: "email", kind: "contact", purpose: "p", message: "Please investigate | today." }, status: "recorded", note: "" }],
  trace: {
    version: 1, runId: "r", caseId: "delivery-024", flowId: "f", mode: "practice",
    events: [
      { t: 0, kind: "run_start", title: "Case 024: Parcel missing", inputs: [] },
      { t: 1, kind: "node_start", nodeId: "ingest", nodeType: "ingest" },
      { t: 2, kind: "node_end", nodeId: "ingest", status: "ok", summary: "ingest: 1 files", latencyMs: 1, costUsd: 0 },
      { t: 3, kind: "run_end", outcome: "acted", totalCostUsd: 0.07, totalLatencyMs: 3,
        nextAction: { recipient: "Delivery investigations", channel: "email", message: "Please investigate.", undoable: true } },
    ],
  } as StoredExecution["trace"],
  ...over,
});

describe("run download", () => {
  it("builds an ANSWER.md-style summary from the stored run", () => {
    const md = answerSummary(exec());
    expect(md).toContain("# Parcel missing");
    expect(md).toContain("**Decision:** ACT. Emailed Delivery investigations.");
    expect(md).toContain("| 1 | Delivery investigations | email | Recorded in sandbox outbox, awaiting reply |");
    expect(md).toContain("> Please investigate | today.");
    expect(md).toContain("Checked against the answer key: right, score 0.90. Right team.");
    expect(md).toContain("- Cost: $0.0781");
  });

  it("lists the steps in plain words", () => {
    expect(stepList(exec())).toContain("1. [x] Read the messages");
    expect(stepList(exec({ trace: null }))).toContain("No steps were recorded");
  });

  it("ships the stored answer as-is and every file", () => {
    expect(runFiles(exec()).map((f) => f.name)).toEqual(["ANSWER.md", "steps.md", "trace.json", "messages.json", "run.json"]);
    const withStored = runFiles(exec({ answerMd: "# Runner answer\n", reasoningMd: "# Why\n" }));
    expect(withStored.map((f) => f.name)).toEqual(["ANSWER.md", "REASONING.md", "SUMMARY.md", "steps.md", "trace.json", "messages.json", "run.json"]);
    expect(withStored[0].content).toBe("# Runner answer\n");
    const meta = JSON.parse(withStored.find((f) => f.name === "run.json")!.content);
    expect(meta.trace).toBeUndefined();
    expect(meta.costUsd).toBe(0.0781);
    expect(JSON.parse(withStored.find((f) => f.name === "messages.json")!.content)[0].action.recipient).toBe("Delivery investigations");
  });

  it("names the file safely", () => {
    expect(runBaseName({ caseId: "Reality Case/7", id: "abcdef123456" })).toBe("run-Reality_Case_7-abcdef12");
  });
});
