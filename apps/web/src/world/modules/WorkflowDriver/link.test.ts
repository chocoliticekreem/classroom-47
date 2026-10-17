import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Trace } from "../../../../../api/src/lib/trace";
import type { AgentRunResult } from "../../agentBridge";
import type { WorldEvent } from "../../bus";
import { agentIdle, type Delivery, type Incident, type QueuedCase, type WorkflowEvent } from "../../store";
import { CityAgentLink, type HudEvent, type LinkDeps } from "./link";

function traceFor(caseId: string, n: number, synthetic = true): Trace {
  return {
    version: 1, runId: `run-${n}`, caseId, flowId: "default-incident", mode: "demo", synthetic,
    events: [
      { t: 0, kind: "run_start", title: caseId, inputs: [] },
      { t: 1, kind: "node_start", nodeId: "triage", nodeType: "triage" },
      { t: 5, kind: "node_end", nodeId: "triage", status: "ok", summary: "triage", latencyMs: 5, costUsd: 0 },
      { t: 9, kind: "run_end", outcome: "acted", totalCostUsd: 0.05, totalLatencyMs: 9 },
    ],
  };
}

const incident: Incident = { id: "inc-1", kind: "car_crash", edgeKey: "a|b", x: 0, z: 0, status: "active", createdAt: 0, note: "Crash on King St" };
const deliveries: Record<string, Delivery> = { "DL-1": { id: "DL-1", truckId: "T-1", stop: "b", status: "en_route", etaS: 60 } };

function harness(opts: { online?: boolean; budget?: number; maxConcurrent?: number } = {}) {
  const state = { online: opts.online ?? true, budget: opts.budget ?? 100, now: 1_000_000 };
  const pushed: HudEvent[] = [];
  const emitted: WorldEvent[] = [];
  const views: { id: string; events: { source?: string }[]; mode?: string }[] = [];
  const pending: { resolve: (r: AgentRunResult) => void; reject: (e: Error) => void; id: string }[] = [];
  let queue: QueuedCase[] = [];
  let running = 0;
  let spent = 0;
  const deps: LinkDeps = {
    runAgent: (view) => {
      views.push(view);
      return new Promise((resolve, reject) => pending.push({ resolve, reject, id: view.id }));
    },
    push: (e) => pushed.push(e),
    emit: (e) => emitted.push(e),
    schedule: (fn) => fn(), // replay instantly
    online: () => state.online,
    claim: () => (state.budget > 0 ? (state.budget--, true) : false),
    onSpend: (t) => { spent += t.events.find((e) => e.kind === "run_end")?.kind ? 0.05 : 0; },
    onQueue: (q, r) => { queue = q; running = r; },
    incident: (id) => (id === incident.id ? incident : undefined),
    deliveries: () => deliveries,
    positions: () => ({}),
    now: () => state.now,
    clock: () => 0,
    maxConcurrent: opts.maxConcurrent ?? 2,
  };
  const link = new CityAgentLink(deps);
  const finish = async (i = 0) => {
    const p = pending.splice(i, 1)[0];
    p.resolve({ trace: traceFor(p.id, views.length), card: null, outbox: null });
    await new Promise((r) => setTimeout(r, 0));
  };
  return { link, state, pushed, emitted, views, pending, finish, get queue() { return queue; }, get running() { return running; }, get spent() { return spent; } };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("city agent link: queueing", () => {
  it("runs 2 at a time and queues the rest FIFO, starting them as slots free up", async () => {
    const h = harness();
    for (let i = 0; i < 4; i++) h.link.incident("inc-1");
    expect(h.running).toBe(2);
    expect(h.queue.map((q) => q.label)).toEqual(["INC-003 · car crash", "INC-004 · car crash"]);
    await h.finish();
    expect(h.running).toBe(2);
    expect(h.queue.map((q) => q.label)).toEqual(["INC-004 · car crash"]);
    await h.finish();
    await h.finish();
    await h.finish();
    expect(h.running).toBe(0);
    expect(h.queue).toEqual([]);
    expect(h.views.map((v) => v.id)).toEqual(["city-inc-1-inc-1", "city-inc-2-inc-1", "city-inc-3-inc-1", "city-inc-4-inc-1"]);
  });

  it("waits over budget instead of falling back, and resumes when the budget allows", async () => {
    const h = harness({ budget: 1 });
    h.link.incident("inc-1");
    h.link.incident("inc-1");
    expect(h.running).toBe(1);
    expect(h.queue).toHaveLength(1);
    await h.finish();
    expect(h.queue).toHaveLength(1); // still no budget
    h.state.budget = 1;
    h.link.pump();
    expect(h.running).toBe(1);
    expect(h.queue).toHaveLength(0);
  });

  it("pauses everything while the agent is offline and invents nothing", async () => {
    const h = harness({ online: false });
    h.link.incident("inc-1");
    h.link.staged({ runId: "SC-1", scenarioId: "delivery-024", modifiers: [] });
    expect(h.views).toHaveLength(0);
    expect(h.pushed).toHaveLength(0);
    expect(h.emitted).toHaveLength(0);
    expect(h.queue.map((q) => q.kind)).toEqual(["incident", "scenario"]);
    h.state.online = true;
    h.link.pump();
    expect(h.views).toHaveLength(2);
  });

  it("groups delivery delays per cause into one real case", async () => {
    const h = harness();
    h.link.delayed("DL-1", "road closed: crash");
    h.link.delayed("DL-2", "road closed: crash");
    h.link.delayed("DL-1", "road closed: crash"); // duplicate ignored
    h.link.delayed("DL-3", "van breakdown");
    h.link.flushDelays();
    expect(h.views).toHaveLength(0); // window still open
    h.state.now += 20_000;
    h.link.flushDelays();
    expect(h.views).toHaveLength(2);
    const crash = h.views.find((v) => JSON.stringify(v).includes("road closed: crash"))!;
    expect(JSON.stringify(crash)).toContain("DL-2");
    expect(crash.mode).toBe("demo");
    expect(crash.events.every((e) => e.source === "simulated_persona")).toBe(true);
  });

  it("staged scenarios go to the agent and resolve the scene with the trace's outcome", async () => {
    const h = harness();
    h.link.staged({ runId: "SC-1", scenarioId: "delivery-024", modifiers: ["prompt_injection"] });
    expect(h.views[0].id).toBe("city-delivery-024");
    expect(h.views[0].events.at(-1)?.source).toBe("simulated_persona"); // modifier message is invented
    await h.finish();
    expect(h.emitted).toContainEqual({ type: "scenario:resolved", runId: "SC-1", scenarioId: "delivery-024", outcome: "acted" });
  });

  it("an agent error is one labelled error line, with no invented outcome", async () => {
    const h = harness();
    h.link.staged({ runId: "SC-1", scenarioId: "delivery-024", modifiers: [] });
    h.pending[0].reject(new Error("agent API 500"));
    await flush();
    expect(h.pushed.at(-1)).toMatchObject({ nodeId: "log", status: "error", source: "agent" });
    expect(h.emitted).toEqual([]);
    expect(h.running).toBe(0);
  });
});

describe("no mock", () => {
  it("never pushes a mock event: every feed item is a real-agent replay or a labelled agent status", async () => {
    const h = harness({ budget: 3 });
    h.link.incident("inc-1");
    h.link.incident("inc-1");
    h.link.staged({ runId: "SC-1", scenarioId: "delivery-001", modifiers: [] });
    h.link.delayed("DL-1", "x");
    h.state.now += 20_000;
    h.link.flushDelays();
    h.link.consoleExecution({ id: "e1", caseId: "delivery-013", status: "success", origin: "console", simulated: false, costUsd: 0.05, startedAt: "", trace: traceFor("delivery-013", 99, false) });
    while (h.pending.length) await h.finish();
    h.state.budget = 5;
    h.link.pump();
    while (h.pending.length) await h.finish();
    expect(h.pushed.length).toBeGreaterThan(10);
    for (const e of h.pushed as WorkflowEvent[]) {
      expect(e.source).toBe("agent");
      expect(e.source).not.toBe("mock");
    }
  });

  it("nothing on the /city path imports the mock engine or emits source: \"mock\"", () => {
    const world = path.resolve(__dirname, "../..");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(p);
      }
    };
    walk(world);
    const engineFiles = new Set(["engine.ts", "fromScenario.ts", "scenarios.ts", "handle.ts"].map((f) => path.join(world, "modules/WorkflowDriver", f)));
    for (const f of files) {
      if (engineFiles.has(f)) continue;
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/source:\s*["']mock["']/);
      expect(src, f).not.toMatch(/WorkflowDriver\/engine["']|from ["']\.\/engine["']/);
    }
    const driver = readFileSync(path.join(world, "modules/WorkflowDriver.tsx"), "utf8");
    expect(driver).not.toMatch(/WorkflowEngine|agent=mock|customerMessage/);
  });
});

describe("scenario autoplay pacing", () => {
  it("is idle only when online, nothing queued and fewer than 2 running", () => {
    const q: QueuedCase = { id: "j", label: "x", kind: "incident", enqueuedAt: 0, synthetic: true };
    expect(agentIdle({ agentOnline: true, agentQueue: [], agentRunning: 1 })).toBe(true);
    expect(agentIdle({ agentOnline: true, agentQueue: [], agentRunning: 2 })).toBe(false);
    expect(agentIdle({ agentOnline: true, agentQueue: [q], agentRunning: 0 })).toBe(false);
    expect(agentIdle({ agentOnline: false, agentQueue: [], agentRunning: 0 })).toBe(false);
    expect(agentIdle({ agentOnline: null, agentQueue: [], agentRunning: 0 })).toBe(false);
  });
});

describe("CityAgentLink + shared SQLite budget", () => {
  it("a case the server refuses as over budget goes back to the front of the queue and waits 15 s", async () => {
    const h = harness();
    h.link.incident("inc-1");
    expect(h.pending).toHaveLength(1);
    h.pending.splice(0, 1)[0].reject(Object.assign(new Error("over budget"), { overBudget: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(h.queue.map((q) => q.incidentId)).toEqual(["inc-1"]);
    h.link.pump();
    expect(h.pending).toHaveLength(0); // held
    h.state.now += 15_001;
    h.link.pump();
    expect(h.pending).toHaveLength(1);
  });

  it("replayed lines carry the console execution id", async () => {
    const h = harness();
    h.link.incident("inc-1");
    const p = h.pending.splice(0, 1)[0];
    p.resolve({ trace: traceFor(p.id, 1), card: null, outbox: null, executionId: "ex-7" } as AgentRunResult);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.pushed.filter((e) => e.executionId === "ex-7").length).toBeGreaterThan(0);
  });
});
