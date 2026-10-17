import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ExecutionWrite } from "./store";

// SQLite round trip of the v2 verdict columns, and the evidence cache's invalidation on a write.
describe("evidence over SQLite", () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "evidence-"));
    process.env.CONSOLE_REPO_ROOT = root;
    process.env.CONSOLE_DB_PATH = path.join(root, "console.db");
  });
  afterAll(async () => {
    delete process.env.CONSOLE_REPO_ROOT;
    delete process.env.CONSOLE_DB_PATH;
    await rm(root, { recursive: true, force: true });
  });

  const write = (o: Partial<ExecutionWrite> & { id: string; caseId: string }): ExecutionWrite => ({
    sourceKey: null, dataset: "generated", workflowId: "default-incident", status: "success", outcome: "acted",
    startedAt: "2026-10-10T10:00:00.000Z", durationMs: 2000, costUsd: 0.01, origin: "console", simulated: false,
    title: null, nextAction: null, gate: null, error: null, trace: null, answerMd: null, reasoningMd: null, eval: null, ...o,
  });

  it("stores critical, verdict and broken rules, and rebuilds the cached grid only after a write", async () => {
    const { upsertExecution, recordVerdict, evidenceExecutions, getExecution } = await import("./store");
    const { cachedEvidence } = await import("./evidenceCache");
    upsertExecution(write({ id: "a", caseId: "gen-1", eval: { pass: false, score: 0, critical: true, verdict: "Shared the code.", brokenRules: ["Never share the gate code"] } }));
    upsertExecution(write({ id: "sim", caseId: "gen-2", simulated: true }));
    expect(evidenceExecutions().map((e) => e.id)).toEqual(["a"]);
    expect(getExecution("a")?.eval).toEqual({ pass: false, score: 0, critical: true, verdict: "Shared the code.", brokenRules: ["Never share the gate code"] });

    const first = await cachedEvidence();
    expect(first.totals.criticalFailures).toBe(1);
    expect(await cachedEvidence()).toBe(first); // same object: nothing changed

    upsertExecution(write({ id: "b", caseId: "gen-3", startedAt: "2026-10-10T11:00:00.000Z" }));
    recordVerdict("b", { pass: true, score: 0.9, notes: "ok", critical: false, verdict: "Right.", brokenRules: [] });
    const second = await cachedEvidence();
    expect(second).not.toBe(first);
    expect(second.rows.find((r) => r.caseId === "gen-3")).toMatchObject({ pass: true, critical: false, verdict: "Right.", costUsd: 0.01, durationMs: 2000 });
    expect(second.totals.byDataset).toEqual([{ dataset: "generated", run: 2, right: 1, wrong: 1 }]);
  });
});
