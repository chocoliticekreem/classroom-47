import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CITY_DATASET, claimCityBudget, cityRuns, getCityBudget, getCityState, parseCityCase, putCityState, setCityBudgetMax, startCityCase } from "./city";
import { getExecution, upsertExecution } from "./store";

const view = { id: "city-incident-1", events: [{ n: 1, timestamp: "", stage: "Escalation", channel: "Call", from: "Driver", to: "Desk", body: "Stuck", source: "simulated_persona" }] };

describe("parseCityCase", () => {
  it("accepts a city view and refuses junk", () => {
    expect(parseCityCase({ view, label: " INC-001 · car crash " })).toMatchObject({ label: "INC-001 · car crash", view: { id: "city-incident-1", mode: "demo" } });
    expect(parseCityCase({ view: { id: "x", events: [] } })).toEqual({ error: "view with id and events is required" });
    expect(parseCityCase({ view: { id: "x", events: [{}] } })).toEqual({ error: "every event needs a body" });
    expect(parseCityCase(null)).toHaveProperty("error");
  });
});

describe("city persistence over SQLite", () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "city-state-"));
    process.env.CONSOLE_REPO_ROOT = root;
    process.env.CONSOLE_DB_PATH = path.join(root, "console.db");
  });
  afterAll(async () => {
    delete process.env.CONSOLE_REPO_ROOT;
    delete process.env.CONSOLE_DB_PATH;
    await rm(root, { recursive: true, force: true });
  });

  it("saves and reads back the one world row; refuses non-objects", () => {
    expect(getCityState()).toBeNull();
    expect(putCityState({ v: 1, incidents: [{ id: "inc-1" }] })).toMatchObject({ ok: true });
    expect(putCityState({ v: 1, incidents: [] })).toMatchObject({ ok: true });
    expect(getCityState()?.state).toEqual({ v: 1, incidents: [] });
    expect(putCityState([1])).toEqual({ ok: false, error: "state must be an object" });
    expect(putCityState({ big: "x".repeat(600 * 1024) })).toEqual({ ok: false, error: "state too large" });
  });

  it("the budget window is shared and persisted: the 4th claim in 10 min is refused", () => {
    setCityBudgetMax(3);
    const t = 1_000_000_000;
    expect(claimCityBudget(t)).not.toBeNull();
    expect(claimCityBudget(t + 1)).not.toBeNull();
    expect(claimCityBudget(t + 2)).not.toBeNull();
    expect(claimCityBudget(t + 3)).toBeNull();
    expect(getCityBudget(t + 3).starts).toHaveLength(3);
    expect(claimCityBudget(t + 10 * 60_000 + 5)).not.toBeNull(); // window rolled
    expect(getCityBudget().runs).toBe(4);
  });

  it("a city case is recorded running at once (origin city, simulated), then finished in the background", async () => {
    const { id, done } = startCityCase(view, "INC-001 · car crash", async (base, body) => {
      expect(body).toMatchObject({ id: "city-incident-1", mode: "demo", flowId: "default-incident" });
      expect(getExecution(base.id)?.status).toBe("running");
      upsertExecution({ ...base, status: "success", outcome: "escalated", costUsd: 0.07, trace: { version: 1, runId: "run-9", caseId: base.caseId, flowId: "default-incident", events: [] } as never, card: { summary: "Pick one" } as never });
    });
    const running = getExecution(id)!;
    expect(running).toMatchObject({ origin: "city", simulated: true, dataset: CITY_DATASET, title: "INC-001 · car crash" });
    const before = getCityBudget().spentUsd;
    await done;
    expect(getExecution(id)?.status).toBe("success");
    expect(getCityBudget().spentUsd).toBeCloseTo(before + 0.07);
    const runs = cityRuns(20);
    expect(runs[0]).toMatchObject({ id, runId: "run-9", card: { summary: "Pick one" } });
  });

  it("a failing run becomes an error row instead of crashing", async () => {
    const { id, done } = startCityCase(view, "INC-002", async () => {
      throw new Error("boom");
    });
    await done;
    expect(getExecution(id)).toMatchObject({ status: "error", error: "boom" });
  });
});
