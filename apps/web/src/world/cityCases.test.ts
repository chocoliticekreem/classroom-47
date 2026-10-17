import { describe, expect, it } from "vitest";
import { OverBudgetError, runCityCase } from "./agentBridge";

const view = { id: "city-incident-1", events: [{ n: 1, timestamp: "", stage: "Escalation", channel: "Call", from: "Driver", to: "Desk", body: "Stuck" }], mode: "demo" as const };
const trace = { version: 1, runId: "run-1", caseId: "city-incident-1", flowId: "default-incident", events: [{ t: 0, kind: "run_end", outcome: "acted", totalCostUsd: 0.02, totalLatencyMs: 1 }] };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("runCityCase (same-origin, recorded in SQLite)", () => {
  it("POSTs to the console, then follows the execution until it finishes", async () => {
    const calls: string[] = [];
    let polls = 0;
    const budgets: unknown[] = [];
    const fetchStub = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "/api/console/city/cases") {
        expect(JSON.parse(String(init?.body))).toEqual({ view, label: "INC-001" });
        return json(202, { id: "ex-1", budget: { starts: [1], spentUsd: 0, maxPerWindow: 3 } });
      }
      polls++;
      return json(200, { execution: polls < 2 ? { status: "running", trace: null } : { status: "success", trace, card: null, outbox: [] } });
    }) as typeof fetch;
    const r = await runCityCase(view, "INC-001", { fetch: fetchStub, sleep: async () => {}, onBudget: (b) => budgets.push(b) });
    expect(r.executionId).toBe("ex-1");
    expect(r.trace.runId).toBe("run-1");
    expect(calls).toEqual(["POST /api/console/city/cases", "GET /api/console/executions/ex-1", "GET /api/console/executions/ex-1"]);
    expect(budgets).toHaveLength(1);
  });

  it("429 means over the shared budget: OverBudgetError, nothing followed", async () => {
    const fetchStub = (async () => json(429, { error: "over budget", budget: { starts: [1, 2, 3], spentUsd: 0.1, maxPerWindow: 3 } })) as unknown as typeof fetch;
    await expect(runCityCase(view, "INC-001", { fetch: fetchStub })).rejects.toBeInstanceOf(OverBudgetError);
  });

  it("an errored execution rejects with its error", async () => {
    const fetchStub = (async (url: string) =>
      url.endsWith("/cases") ? json(202, { id: "ex-2" }) : json(200, { execution: { status: "error", trace: null, error: "agent API answered 500" } })) as unknown as typeof fetch;
    await expect(runCityCase(view, "INC-002", { fetch: fetchStub, sleep: async () => {} })).rejects.toThrow("agent API answered 500");
  });
});
