import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execute } from "./execute";
import { getExecutionInput, recordExecutionInput, upsertExecution, type ExecutionWrite } from "./store";

describe("persistent case follow-ups", () => {
  let scratch: string;
  const calls: Record<string, unknown>[] = [];
  beforeAll(async () => {
    scratch = await mkdtemp(path.join(tmpdir(), "rivet-chain-"));
    process.env.CONSOLE_DB_PATH = path.join(scratch, "console.db");
    process.env.CONSOLE_REPO_ROOT = path.resolve(import.meta.dirname, "../../../../..");
    vi.stubGlobal("fetch", vi.fn(async (_url: string, options: RequestInit) => {
      calls.push(JSON.parse(String(options.body)));
      return new Response(JSON.stringify({
        trace: { events: [{ kind: "run_end", outcome: "acted", durationMs: 1, costUsd: 0 }] },
        outbox: [{ status: "recorded", note: "sandbox", action: { recipient: "Dispatch", channel: "Email", kind: "request_to_owner", purpose: "check capacity", message: `Check request ${calls.length}` } }],
      }), { status: 200 });
    }));
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    delete process.env.CONSOLE_DB_PATH;
    delete process.env.CONSOLE_REPO_ROOT;
    await rm(scratch, { recursive: true, force: true });
  });

  it("keeps customer changes and both earlier desk requests through multiple persisted follow-ups", async () => {
    const first = await execute({ caseId: "gen-3302", dataset: "generated" });
    const customer = { n: 0, timestamp: "", stage: null, channel: "Customer portal", from: "Recipient", to: "Desk", body: "Monday 10:00–12:00 only", source: "live_human" as const };
    const second = await execute({ parentExecutionId: first.id, extraEvents: [customer], elapsedMs: 60_000,
      humanDecision: { optionId: "option-1", label: "Check with Dispatch", by: "tap", who: "Desk supervisor" } });
    const third = await execute({ parentExecutionId: second.id, extraEvents: [{ ...customer, from: "Dispatch", body: "Monday slot available, booking still needs confirmation" }], elapsedMs: 60_000 });
    expect(third.status).toBe("success");
    const events = calls[2].events as { n: number; body: string }[];
    expect(events.filter((e) => e.body === customer.body)).toHaveLength(1);
    expect(events.some((e) => e.body === "Already sent by the desk: Check request 1")).toBe(true);
    expect(events.some((e) => e.body === "Already sent by the desk: Check request 2")).toBe(true);
    expect(new Set(events.map((e) => e.n)).size).toBe(events.length);
    expect(calls[2].humanDecision).toBeUndefined();
    expect(getExecutionInput(third.id)?.events).toEqual(events);
  });

  it("preserves saved evidence when a result is updated and leaves older imports readable", () => {
    const row: ExecutionWrite = { id: "legacy", sourceKey: null, caseId: "gen-3302", dataset: "generated", workflowId: "default-incident", status: "running", outcome: null, startedAt: "2026-10-10T10:00:00Z", durationMs: null, costUsd: null, origin: "console", simulated: false, title: null, nextAction: null, gate: null, error: null, trace: null, answerMd: null, reasoningMd: null, eval: null };
    upsertExecution(row);
    expect(getExecutionInput(row.id)).toBeNull();
    const view = { id: row.caseId, title: null, context: null, initial_request: null, events: [], attachments: [] };
    recordExecutionInput(row.id, view);
    upsertExecution({ ...row, status: "success" });
    expect(getExecutionInput(row.id)).toEqual(view);
  });

  it("rejects mixing another case or dataset into a parent history", async () => {
    const count = calls.length;
    await expect(execute({ parentExecutionId: "legacy", caseId: "gen-3301" })).rejects.toMatchObject({ status: 400 });
    await expect(execute({ parentExecutionId: "legacy", dataset: "adversarial" })).rejects.toMatchObject({ status: 400 });
    expect(calls).toHaveLength(count);
  });
});
