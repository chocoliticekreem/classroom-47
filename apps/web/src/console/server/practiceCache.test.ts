import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Trace, TestRunCase } from "../types";
import { cacheKey, canonicalJson, executionUsable, flowHash, isCacheable, reusedCase } from "./practiceCache";
import { summarise } from "./scoring";
import { applyCache, queuedCase, runCases } from "./testruns";
import type { ExecutionWrite } from "./store";

const flow = {
  id: "default-incident", name: "Default", business: "",
  nodes: [{ id: "gate", type: "safety_gate", runs_on: ["code"], config: { allow_below: 0.3, block_at: 0.8 } }],
  edges: [{ from: "ingest", to: "gate" }],
};

const judged = (o: Partial<TestRunCase> = {}): TestRunCase => ({
  ...queuedCase({ id: "delivery-001", dataset: "public", title: "Late parcel" }),
  executionId: "ex-1", status: "passed", score: 0.9, verdict: "Told the customer.", costUsd: 0.05, durationMs: 42_000,
  startedAt: "2026-10-10T09:00:00.000Z", finishedAt: "2026-10-10T09:00:42.000Z", ...o,
});

describe("flow hashing", () => {
  it("ignores key order at every level", () => {
    const shuffled = {
      edges: [{ to: "gate", from: "ingest" }],
      nodes: [{ config: { block_at: 0.8, allow_below: 0.3 }, runs_on: ["code"], type: "safety_gate", id: "gate" }],
      business: "", name: "Default", id: "default-incident",
    };
    expect(canonicalJson(shuffled)).toBe(canonicalJson(flow));
    expect(flowHash(shuffled)).toBe(flowHash(flow));
  });

  it("changes with any edit to the playbook", () => {
    const edited = structuredClone(flow);
    edited.nodes[0].config.block_at = 0.85;
    expect(flowHash(edited)).not.toBe(flowHash(flow));
    expect(flowHash({ ...flow, edges: [] })).not.toBe(flowHash(flow));
    // Array order is behaviour (runners, edges) and is kept.
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it("keys on dataset, case and flow", () => {
    const h = flowHash(flow);
    expect(cacheKey("delivery-001", "public", h)).toBe(`public/delivery-001#${h}`);
    expect(cacheKey("delivery-001", "public", h)).not.toBe(cacheKey("delivery-001", "generated", h));
  });
});

describe("what can be reused", () => {
  it("only judged right/wrong cases with a run", () => {
    expect(isCacheable(judged())).toBe(true);
    expect(isCacheable(judged({ status: "failed", score: 0 }))).toBe(true);
    expect(isCacheable(judged({ status: "error" }))).toBe(false);
    expect(isCacheable(judged({ score: null }))).toBe(false);
    expect(isCacheable(judged({ executionId: null }))).toBe(false);
  });

  it("only while the run finished OK with a trace", () => {
    expect(executionUsable({ status: "success", hasTrace: true, error: null })).toBe(true);
    expect(executionUsable({ status: "error", hasTrace: true, error: null })).toBe(false);
    expect(executionUsable({ status: "success", hasTrace: false, error: null })).toBe(false);
    expect(executionUsable({ status: "success", hasTrace: true, error: "boom" })).toBe(false);
    expect(executionUsable(null)).toBe(false);
  });

  it("a reused case keeps the verdict and original time, costs nothing new", () => {
    const r = reusedCase(judged(), { title: "Late parcel" }, false);
    expect(r).toMatchObject({ status: "passed", score: 0.9, verdict: "Told the customer.", executionId: "ex-1", costUsd: 0, durationMs: 42_000 });
    expect(r.startedAt).toBe("2026-10-10T09:00:00.000Z");
    expect(r.reused).toEqual({ originalCostUsd: 0.05, countedBefore: false });
    // Reusing a reused case keeps the first original cost.
    expect(reusedCase(r, { title: null }, true).reused).toEqual({ originalCostUsd: 0.05, countedBefore: true });
  });
});

describe("applyCache + runCases", () => {
  it("fills hits at once and only runs the misses", async () => {
    const cases = ["a", "b", "c", "d", "e"].map((id) => queuedCase({ id, dataset: "public" }));
    const hits: Record<string, TestRunCase> = {
      a: judged({ caseId: "a", executionId: "ex-a" }),
      c: judged({ caseId: "c", executionId: "ex-c", status: "failed", score: 0.2 }),
      e: judged({ caseId: "e", executionId: "ex-e" }),
    };
    const n = applyCache(cases, { lookup: (c) => hits[c.caseId] ?? null, countedBefore: (id) => id === "ex-a" });
    expect(n).toBe(3);
    expect(cases.map((c) => c.status)).toEqual(["passed", "queued", "failed", "queued", "passed"]);
    expect(cases[0].reused?.countedBefore).toBe(true);
    expect(cases[2].reused?.countedBefore).toBe(false);

    const ran: string[] = [];
    await runCases({
      cases, concurrency: 5, isCancelled: () => false, onUpdate: () => {},
      runOne: async (c) => { ran.push(c.caseId); return { ...c, status: "passed", score: 1, costUsd: 0.04 }; },
    });
    expect(ran.sort()).toEqual(["b", "d"]);
    // Reused rows keep their original timing.
    expect(cases[0].startedAt).toBe("2026-10-10T09:00:00.000Z");

    const s = summarise(cases);
    expect(s).toMatchObject({ total: 5, passed: 4, failed: 1, costUsd: 0.08, reused: 3 });
    // Only "a" was already counted for this version.
    expect(s.repeats).toEqual({ passed: 1, failed: 0, scoreSum: 0.9 });
  });

  it("a run without reuse keeps its old summary shape", () => {
    expect(summarise([judged()])).not.toHaveProperty("reused");
  });
});

describe("practice cache over SQLite", () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "practice-cache-"));
    process.env.CONSOLE_REPO_ROOT = root;
    process.env.CONSOLE_DB_PATH = path.join(root, "console.db");
  });
  afterAll(async () => {
    delete process.env.CONSOLE_REPO_ROOT;
    delete process.env.CONSOLE_DB_PATH;
    await rm(root, { recursive: true, force: true });
  });

  const exec = (o: Partial<ExecutionWrite> & { id: string }): ExecutionWrite => ({
    sourceKey: null, caseId: "delivery-001", dataset: "public", workflowId: "default-incident", status: "success", outcome: "acted",
    startedAt: "2026-10-10T09:00:00.000Z", durationMs: 42_000, costUsd: 0.05, origin: "console", simulated: false,
    title: null, nextAction: null, gate: null, error: null, trace: { events: [] } as unknown as Trace, answerMd: null, reasoningMd: null, eval: null, ...o,
  });

  it("stores, finds, misses on another flow, and drops an entry whose run is unusable", async () => {
    const { upsertExecution } = await import("./store");
    const { storeCached, lookupCached, countedBefore } = await import("./practiceCache");
    const { getDb } = await import("./db");
    upsertExecution(exec({ id: "ex-1" }));
    const h = flowHash(flow);
    storeCached(judged(), h, "default-incident", 2);

    const hit = lookupCached("delivery-001", "public", h);
    expect(hit?.executionId).toBe("ex-1");
    expect(hit?.testCase.verdict).toBe("Told the customer.");
    expect(lookupCached("delivery-001", "public", flowHash({ ...flow, name: "Edited" }))).toBeNull();
    expect(lookupCached("delivery-002", "public", h)).toBeNull();

    expect(countedBefore("default-incident", 2, "ex-1")).toBe(false);
    getDb().prepare(`INSERT INTO test_runs (id, workflow_id, version, scenario_set, filter, status, started_at, finished_at, cases, summary)
      VALUES ('r1', 'default-incident', 2, 'quick', NULL, 'done', '2026-10-10T09:00:00Z', NULL, ?, '{}')`).run(JSON.stringify([judged()]));
    expect(countedBefore("default-incident", 2, "ex-1")).toBe(true);
    expect(countedBefore("default-incident", 3, "ex-1")).toBe(false);

    upsertExecution(exec({ id: "ex-1", status: "error", error: "agent API answered 500" }));
    expect(lookupCached("delivery-001", "public", h)).toBeNull();
  });
});
