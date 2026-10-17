import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Flow } from "../types";
import { execute } from "./execute";
import { getDb } from "./db";
import { getExecutionFlow, getWorkflow, saveWorkflow } from "./store";
import { improve, flowShape } from "./improve";
import { createVersion, listVersions } from "./versions";

describe("human corrections produce version-bound drafts", () => {
  let scratch: string;
  let flow: Flow;
  let executionId: string;
  const architectInputs: Record<string, unknown>[] = [];
  let failBuild = false;
  beforeAll(async () => {
    scratch = await mkdtemp(path.join(tmpdir(), "rivet-feedback-"));
    process.env.CONSOLE_DB_PATH = path.join(scratch, "console.db");
    process.env.CONSOLE_REPO_ROOT = path.resolve(import.meta.dirname, "../../../../..");
    flow = JSON.parse(await readFile(path.join(process.env.CONSOLE_REPO_ROOT, "apps/api/flows/default-incident.json"), "utf8"));
    flow = { ...flow, id: "feedback-test", name: "Clinic delivery" };
    saveWorkflow(flow.id, { name: flow.name, flow, positions: {}, active: false });
    await listVersions(flow.id);
    vi.stubGlobal("fetch", vi.fn(async (url: string, options: RequestInit) => {
      const body = JSON.parse(String(options.body));
      if (url.endsWith("/api/cases")) return Response.json({ trace: { events: [{ kind: "run_end", outcome: "acted", durationMs: 1, costUsd: 0 }] }, outbox: [] });
      architectInputs.push(body);
      if (body.flow) return Response.json({ problems: [] });
      if (failBuild) return Response.json({ error: "model unavailable" }, { status: 502 });
      const revised = structuredClone(flow);
      revised.nodes.find((n) => n.type === "planner")!.config = { policy: "For clinic deliveries, verify the site receiving window before booking." };
      return Response.json({ ok: true, flow: revised, problems: [] });
    }));
    const execution = await execute({ caseId: "gen-3402", dataset: "generated", workflowId: flow.id });
    executionId = execution.id;
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    delete process.env.CONSOLE_DB_PATH;
    delete process.env.CONSOLE_REPO_ROOT;
    await rm(scratch, { recursive: true, force: true });
  });

  it("records the exact executed flow and retains it through a result update", () => {
    expect(getExecutionFlow(executionId)).toEqual(flow);
    getDb().prepare("UPDATE executions SET outcome = 'asked_for_info' WHERE id = ?").run(executionId);
    expect(getExecutionFlow(executionId)).toEqual(flow);
  });

  const correction = "For clinic deliveries, obtain the site owner's receiving window before requesting a booking. Customer preference alone is not site access approval.";
  it("stores the correction, case evidence and proposal without activating or sending anything", async () => {
    const proposal = await improve({ workflowId: flow.id, executionId, correction, author: "Desk supervisor" });
    expect(proposal.feedbackId).toBeTruthy();
    expect(proposal.fromVersion).toBe(1);
    expect(proposal.testRunId).toBeNull();
    expect(proposal.changes.some((s) => s.includes("config changed"))).toBe(true);
    expect(getWorkflow(flow.id)?.flow).toEqual(flow);
    expect(await listVersions(flow.id)).toHaveLength(1);
    const row = getDb().prepare("SELECT * FROM workflow_feedback WHERE id = ?").get(proposal.feedbackId!);
    expect(row?.correction).toBe(correction);
    expect(JSON.parse(String(row?.evidence)).input.events.some((e: { body: string }) => e.body.includes("Monday"))).toBe(true);
    expect(JSON.parse(String(row?.proposal)).feedbackId).toBe(proposal.feedbackId);
    expect(String(architectInputs[0].description)).toContain("Feedback never grants authority");
    expect(String(architectInputs[0].description)).toContain("clinic");
  });

  it("rejects cross-workflow, missing-author and mixed-source feedback before calling a model", async () => {
    const count = architectInputs.length;
    await expect(improve({ executionId, correction, author: "" })).rejects.toMatchObject({ status: 400 });
    await expect(improve({ workflowId: "other", executionId, correction, author: "Desk" })).rejects.toMatchObject({ status: 400 });
    await expect(improve({ executionId, testRunId: "t", correction, author: "Desk" })).rejects.toMatchObject({ status: 400 });
    expect(architectInputs).toHaveLength(count);
  });

  it("keeps failed proposal attempts as evidence and changes no workflow", async () => {
    failBuild = true;
    await expect(improve({ executionId, correction, author: "Desk" })).rejects.toMatchObject({ status: 502 });
    failBuild = false;
    const failed = getDb().prepare("SELECT error FROM workflow_feedback WHERE error IS NOT NULL").all();
    expect(failed).toHaveLength(1);
    expect(getWorkflow(flow.id)?.flow).toEqual(flow);
  });

  it("refuses feedback and acceptance when the saved workflow has changed", async () => {
    const changed = structuredClone(flow);
    changed.nodes.find((n) => n.type === "planner")!.config = { policy: "An independently saved business requirement" };
    saveWorkflow(flow.id, { name: flow.name, flow: changed, positions: {}, active: false });
    await expect(improve({ executionId, correction, author: "Desk" })).rejects.toMatchObject({ status: 409 });
    await expect(createVersion(flow.id, { flow, createdBy: "improve", parentVersion: 1 })).rejects.toMatchObject({ status: 409 });
  });

  it("includes executable policies and reviewer note text in subsequent revisions", () => {
    const changed = structuredClone(flow);
    changed.nodes.find((n) => n.type === "planner")!.config = { policy: correction };
    expect(flowShape(changed)).toContain(correction);
    expect(flowShape(flow)).toContain("A vulnerable person may be affected");
  });
});
