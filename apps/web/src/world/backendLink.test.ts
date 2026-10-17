import { describe, expect, it, vi } from "vitest";
import type { Trace } from "../../../api/src/lib/trace";
import { cardFromTrace, traceToTimedEvents } from "./agentBridge";
import {
  affectedDeliveries, buildIncidentCase, ExecutionPoller, originOf, provenanceLabel, recordDecision,
  type ExecutionDetail, type ExecutionRow, type FetchJson,
} from "./backendLink";
import type { Delivery, Incident } from "./store";
import { useWorld } from "./store";
import { addSpend, budgetLeft, claimRun, clampMax, newBudget, nextSlotAt } from "./modules/WorkflowDriver/budget";
import { spendSplit, summariseCases } from "./modules/WorkflowHud/flow";

// ---------------------------------------------------------------- incident -> case view

const incident: Incident = {
  id: "inc-7", kind: "car_crash", edgeKey: "g_0_0|g_1_0", x: 10, z: 0, status: "active", createdAt: 0,
  note: "Van V-12 crashed into a car on King St",
};
const deliveries: Record<string, Delivery> = {
  "DL-1001": { id: "DL-1001", truckId: "T-1", stop: "s_far", status: "en_route", etaS: 300 },
  "DL-1002": { id: "DL-1002", truckId: "T-2", stop: "g_1_0", status: "en_route", etaS: 600 },
  "DL-1003": { id: "DL-1003", truckId: "T-3", stop: "s_x", status: "delivered", etaS: 0 },
  "DL-1004": { id: "DL-1004", truckId: "T-4", stop: "s_y", status: "delayed", etaS: 900 },
};
const positions = { "T-1": { x: 200, z: 0 }, "T-4": { x: 12, z: 0 } };

describe("incident -> case view", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  const { view, affected } = buildIncidentCase(incident, deliveries, { now, seq: 3, positions });

  it("tags every event simulated_persona and runs in demo mode", () => {
    expect(view.mode).toBe("demo");
    expect(view.events.length).toBe(2);
    expect(view.events.every((e) => e.source === "simulated_persona")).toBe(true);
    expect(view.id).toBe("city-inc-3-inc-7");
  });

  it("builds context from the incident note and the store's deliveries", () => {
    expect(view.context).toContain("Van V-12 crashed into a car on King St");
    expect(view.context).toContain("DL-1002");
    expect(view.context).not.toContain("DL-1003"); // delivered: not affected
    expect(affected.map((d) => d.id)).toEqual(["DL-1002", "DL-1004", "DL-1001"]); // on the road, then nearest
  });

  it("has a driver report and a customer 'where's my parcel'", () => {
    expect(view.events[0].channel).toBe("Driver app");
    expect(view.events[0].from).toContain("T-2");
    expect(view.events[1].channel).toBe("Customer portal");
    expect(view.events[1].body).toMatch(/Where's my parcel/);
    expect(view.events[1].body).toContain("DL-1002");
    expect(view.events.every((e) => !Number.isNaN(Date.parse(e.timestamp)))).toBe(true);
  });

  it("leaks no answer, plan or outcome", () => {
    const json = JSON.stringify(view).toLowerCase();
    for (const word of ["expected", "should", "recommend", "plan:", "outcome", "answer", "title"]) expect(json).not.toContain(word);
    expect(Object.keys(view).sort()).toEqual(["context", "events", "id", "mode"]);
  });

  it("still builds a case with no deliveries on the road", () => {
    const c = buildIncidentCase({ ...incident, kind: "breakdown" }, {}, { now, seq: 1 });
    expect(c.affected).toEqual([]);
    expect(c.view.events.every((e) => e.source === "simulated_persona")).toBe(true);
    expect(c.view.context).toContain("No Hamyway delivery is confirmed");
  });

  it("caps affected deliveries", () => {
    expect(affectedDeliveries(incident, deliveries, positions, 1).map((d) => d.id)).toEqual(["DL-1002"]);
  });
});

// ---------------------------------------------------------------- budget guard

describe("budget guard", () => {
  it("allows N real cases per 10 minutes, then refuses until the window rolls", () => {
    let b = newBudget(2);
    b = claimRun(b, 0)!;
    b = claimRun(b, 1000)!;
    expect(budgetLeft(b, 1000)).toBe(0);
    expect(claimRun(b, 2000)).toBeNull();
    expect(nextSlotAt(b, 2000)).toBe(600_000);
    expect(claimRun(b, 600_001)).not.toBeNull(); // the first start fell out of the window
    expect(b.runs).toBe(2);
  });
  it("adds only real, finite costs", () => {
    let b = newBudget();
    b = addSpend(b, 0.05);
    b = addSpend(b, Number.NaN);
    b = addSpend(b, -1);
    expect(b.spentUsd).toBeCloseTo(0.05);
  });
  it("clamps the tunable max", () => {
    expect(clampMax(-3)).toBe(0);
    expect(clampMax(1000)).toBe(60);
    expect(clampMax(4.4)).toBe(4);
  });
  it("lives in the store: claim, refuse (the case waits) and tune", () => {
    const st = useWorld.getState();
    st.setAgentBudgetMax(1);
    expect(useWorld.getState().claimAgentRun(5_000_000)).toBe(true);
    expect(useWorld.getState().claimAgentRun(5_000_001)).toBe(false);
    useWorld.getState().addAgentSpend(0.0421);
    expect(useWorld.getState().agentBudget.spentUsd).toBeCloseTo(0.0421);
    useWorld.getState().setAgentBudgetMax(20);
    expect(useWorld.getState().agentBudget.maxPerWindow).toBe(20);
    expect(newBudget().maxPerWindow).toBe(3); // default (kept low: the key has little money left)
  });
});

// ---------------------------------------------------------------- execution polling

function trace(runId: string, extra: Partial<Trace> = {}): Trace {
  return {
    version: 1, runId, caseId: "delivery-013", flowId: "default-incident", mode: "practice",
    events: [
      { t: 0, kind: "run_start", title: "x", inputs: [] },
      { t: 10, kind: "run_end", outcome: "acted", totalCostUsd: 0.05, totalLatencyMs: 10 },
    ],
    ...extra,
  };
}

function fakeConsole() {
  const rows: ExecutionRow[] = [];
  const details = new Map<string, ExecutionDetail>();
  const calls: string[] = [];
  const fetchJson: FetchJson = async (url) => {
    calls.push(url);
    if (url.startsWith("/api/console/executions?")) return { executions: [...rows].reverse() }; // newest first
    const id = decodeURIComponent(url.split("/").pop()!);
    return { execution: details.get(id) };
  };
  const add = (id: string, status: ExecutionRow["status"], t: Trace | null) => {
    const row: ExecutionRow = { id, caseId: "delivery-013", status, origin: "console", simulated: false, costUsd: 0.05, startedAt: "" };
    const i = rows.findIndex((r) => r.id === id);
    if (i >= 0) rows[i] = row;
    else rows.push(row);
    details.set(id, { ...row, trace: t });
  };
  return { fetchJson, add, calls };
}

describe("console execution polling", () => {
  it("seeds on the first poll, replays new finished runs once, retries running ones", async () => {
    const c = fakeConsole();
    c.add("old", "success", trace("r-old"));
    const poller = new ExecutionPoller(c.fetchJson, new Set());
    expect(await poller.poll()).toEqual([]); // history is not replayed

    c.add("new", "running", null);
    expect(await poller.poll()).toEqual([]);
    c.add("new", "success", trace("r-new"));
    const got = await poller.poll();
    expect(got.map((e) => e.id)).toEqual(["new"]);
    expect(await poller.poll()).toEqual([]); // no second replay
  });

  it("skips runs without a trace and dedupes by runId (city runs re-imported by the console)", async () => {
    const c = fakeConsole();
    const runIds = new Set(["r-city"]);
    const poller = new ExecutionPoller(c.fetchJson, runIds);
    await poller.poll();
    c.add("a", "error", null);
    c.add("b", "success", trace("r-city"));
    c.add("c", "success", trace("r-c"));
    c.add("d", "success", trace("r-c")); // same run imported twice
    const got = await poller.poll();
    expect(got.map((e) => e.id)).toEqual(["c"]);
    expect(runIds.has("r-c")).toBe(true);
  });

  it("maps origins and provenance labels without mixing them", () => {
    expect(originOf({ origin: "voice" })).toBe("voice");
    expect(originOf({ origin: "console" })).toBe("console");
    expect(provenanceLabel({ source: "agent", synthetic: true, origin: "city_incident" })).toBe("Practice case");
    expect(provenanceLabel({ source: "agent", origin: "console" })).toBe("Live");
    expect(provenanceLabel({ source: "mock" })).toBe("Not live");
    expect(provenanceLabel({})).toBe("Not live");
  });
});

// ---------------------------------------------------------------- trace -> HUD replay with cards

const cardTrace: Trace = {
  version: 1, runId: "api-1", caseId: "city-inc-1-inc-7", flowId: "default-incident", mode: "demo", synthetic: true,
  events: [
    { t: 0, kind: "run_start", title: "x", inputs: [] },
    { t: 1, kind: "node_start", nodeId: "planner", nodeType: "planner" },
    { t: 900, kind: "node_end", nodeId: "planner", status: "ok", summary: "plan", latencyMs: 900, costUsd: 0.02 },
    { t: 901, kind: "node_start", nodeId: "human", nodeType: "human_decision" },
    {
      t: 950, kind: "node_end", nodeId: "human", status: "ok", summary: "held", latencyMs: 50, costUsd: 0,
      output: {
        type: "human_decision",
        card: {
          routeTo: "depot_manager", summary: "Two drivers disagree about the drop.",
          whyStopped: { reason: "agent_judged_unsafe", line: "A refund over the limit needs a manager." },
          evidence: [{ who: "Driver", says: "Road closed", basis: "unverified_claim" }],
          alreadyDone: ["Told the customer we are checking"],
          tried: [], wouldChangeMyMind: "Depot ETA", deadlineMins: 30, fallback: "Hold",
          options: [
            { id: "hold", label: "Hold", undoable: true, effect: "Nothing is sent" },
            { id: "refund", label: "Refund", undoable: false, effect: "Customer gets £40 back by email" },
          ],
        },
      },
    },
    { t: 960, kind: "run_end", outcome: "escalated", totalCostUsd: 0.0612, totalLatencyMs: 960 },
  ],
};

describe("trace -> HUD replay", () => {
  const ev = traceToTimedEvents(cardTrace, "INC-001 · car crash", { origin: "city_incident" });

  it("emits the human node as an ask with the rich card", () => {
    const ask = ev.find((e) => e.event.nodeId === "human" && e.event.status === "ask")!;
    expect(ask.event.card?.whyStopped?.line).toMatch(/manager/);
    expect(ask.event.card?.evidence?.[0].basis).toBe("unverified_claim");
    expect(ask.event.card?.alreadyDone).toEqual(["Told the customer we are checking"]);
    expect(ask.event.card?.options.map((o) => o.effect)).toEqual(["Nothing is sent", "Customer gets £40 back by email"]);
    expect(ask.event.card?.fallbackOptionId).toBe("hold");
    expect(ask.event.card?.deadlineMs).toBe(30 * 60_000);
  });

  it("stamps provenance on every event and carries the real cost once", () => {
    expect(ev.every((e) => e.event.source === "agent" && e.event.synthetic === true && e.event.origin === "city_incident" && e.event.runId === "api-1")).toBe(true);
    const costs = ev.filter((e) => e.event.costUsd !== undefined);
    expect(costs).toHaveLength(1);
    expect(costs[0].event.costUsd).toBe(0.0612);
  });

  it("keeps real spend and mock estimates apart in the feed", () => {
    const real = ev.map((e, i) => ({ ...e.event, id: `r${i}`, t: e.atMs }));
    const mock = [{ id: "m1", t: 1, caseId: "CASE-0001", nodeId: "planner", status: "ok" as const, summary: "x", source: "mock" as const }];
    const split = spendSplit([...real, ...mock]);
    expect(split.real).toBeCloseTo(0.0612);
    expect(split.estimated).toBeGreaterThan(0);
    const cases = summariseCases([...real, ...mock]);
    expect(cases.find((c) => c.caseId === "CASE-0001")?.prov).toBeNull();
    expect(cases.find((c) => c.caseId.startsWith("INC-"))?.prov?.synthetic).toBe(true);
    expect(cases.find((c) => c.caseId.startsWith("INC-"))?.cost).toBeCloseTo(0.0612);
  });

  it("maps a card with no fallback label to the undoable option", () => {
    const c = cardFromTrace({ routeTo: "x", summary: "s", tried: [], wouldChangeMyMind: "", deadlineMins: 0, fallback: "", options: [{ id: "a", label: "A", undoable: false }, { id: "b", label: "B", undoable: true }] }, "id");
    expect(c.fallbackOptionId).toBe("b");
    expect(c.deadlineMs).toBe(60 * 60_000);
  });
});

// ---------------------------------------------------------------- decisions -> review queue

describe("recording a decision", () => {
  const task = { id: "t1", runId: "api-1", caseId: "city-inc-1-inc-7", status: "pending", options: [{ id: "hold" }, { id: "refund" }] };

  it("finds the queued card and posts the choice to the review API", async () => {
    const fetchJson = vi.fn<FetchJson>(async (url, init) => {
      if (url === "/api/review/tasks" && !init) return { tasks: [task] };
      if (url === "/api/review/tasks/t1/decision") return { task: { ...task, status: "decision_recorded" } };
      throw new Error(`unexpected ${url}`);
    });
    const r = await recordDecision({ runId: "api-1", caseId: "city-inc-1-inc-7", optionId: "hold", who: "Arvin" }, fetchJson);
    expect(r.status).toBe("recorded");
    const body = JSON.parse(String(fetchJson.mock.calls[1][1]?.body));
    expect(body).toEqual({ optionId: "hold", who: "Arvin", note: "" });
  });

  it("registers the trace first when the queue doesn't have it", async () => {
    const urls: string[] = [];
    const fetchJson: FetchJson = async (url, init) => {
      urls.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "/api/review/tasks" && !init) return { tasks: [] };
      if (url === "/api/review/tasks" && init?.method === "POST") return { task };
      return { task: { ...task, status: "decision_recorded" } };
    };
    const r = await recordDecision(
      { runId: "api-1", caseId: "city-inc-1-inc-7", optionId: "refund", who: "A", replay: { caseLabel: "x", trace: cardTrace, card: null, outbox: null, origin: "console" } },
      fetchJson,
    );
    expect(r.status).toBe("recorded");
    expect(urls).toEqual(["GET /api/review/tasks", "POST /api/review/tasks", "POST /api/review/tasks/t1/decision"]);
  });

  it("keeps the choice local (not sent) when the queue is unreachable or has no card", async () => {
    const down: FetchJson = async () => { throw new Error("offline"); };
    expect(await recordDecision({ runId: "x", caseId: "y", optionId: "a", who: "A" }, down)).toEqual({ status: "not_sent", reason: "offline" });
    const empty: FetchJson = async () => ({ tasks: [] });
    expect((await recordDecision({ runId: "x", caseId: "y", optionId: "a", who: "A" }, empty)).status).toBe("not_sent");
  });
});
