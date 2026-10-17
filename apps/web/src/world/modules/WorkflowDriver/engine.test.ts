import { describe, expect, it } from "vitest";
import type { WorkflowEvent } from "../../store";
import {
  WorkflowEngine,
  gateDecision,
  parseDecisionCard,
  CUSTOMER_TEMPLATE_IDS,
  type EngineOptions,
} from "./engine";

function setup(opts: Partial<EngineOptions> = {}) {
  const events: WorkflowEvent[] = [];
  const engine = new WorkflowEngine({ seed: 7, background: false, emit: (e) => events.push(e), ...opts });
  return { engine, events };
}

/** Advance in 50 ms ticks, like a frame loop. */
function run(engine: WorkflowEngine, ms: number) {
  for (let t = 0; t < ms; t += 50) engine.advance(50);
}

const forCase = (events: WorkflowEvent[], caseId: string) => events.filter((e) => e.caseId === caseId);
const nodesOf = (events: WorkflowEvent[]) => events.filter((e) => e.status !== "start").map((e) => e.nodeId);

describe("gateDecision", () => {
  it("allows below 0.3, asks from 0.3 to below 0.8, blocks at 0.8 and above", () => {
    expect(gateDecision(0.29)).toBe("allow");
    expect(gateDecision(0.3)).toBe("ask");
    expect(gateDecision(0.79)).toBe("ask");
    expect(gateDecision(0.8)).toBe("block");
  });
});

describe("parseDecisionCard", () => {
  it("pulls the options out of a decision card summary", () => {
    expect(parseDecisionCard("Decide: Refund £20 / Redeliver tomorrow / Investigate")).toEqual([
      "Refund £20",
      "Redeliver tomorrow",
      "Investigate",
    ]);
    expect(parseDecisionCard("Triage: missing_parcel · high")).toBeNull();
  });
});

describe("incident cases", () => {
  it("ordinary disruptions route automatically across seeds; welfare and major incidents need a lead", () => {
    for (const seed of [1, 7, 11, 42, 91]) {
      const { engine } = setup({ seed });
      for (const kind of ["roadworks", "car_crash", "pileup", "breakdown", "emergency_landing"] as const) {
        const c = engine.incident({ id: kind, kind, edgeKey: "a|b" });
        expect(c.gate, `${kind}, seed ${seed}`).toBe("allow");
      }
      for (const kind of ["truck_crash", "plane_crash"] as const) {
        const c = engine.incident({ id: kind, kind, edgeKey: "a|b" });
        expect(c.gate).toBe("ask");
        expect(c.decision?.reason).toMatch(/lead must decide/);
      }
    }
  });

  it("opens CASE-0001 for a roadworks incident and starts at ingest", () => {
    const { engine, events } = setup();
    engine.incident({ id: "INC-1", kind: "roadworks", edgeKey: "g_0_0|g_1_0", note: "Roadworks closed King St", affected: 6 });
    engine.advance(10);
    const c = engine.cases()[0];
    expect(c.id).toBe("CASE-0001");
    expect(c.title).toBe("Roadworks closed King St: 6 Hamyway City deliveries on affected routes");
    expect(events[0]).toMatchObject({ caseId: "CASE-0001", nodeId: "ingest", status: "start" });
  });

  it("walks the flow in order and finishes at log", () => {
    const { engine, events } = setup();
    engine.incident({ id: "INC-1", kind: "roadworks", edgeKey: "a|b", note: "Roadworks closed King St", affected: 6 });
    run(engine, 60_000);
    const nodes = nodesOf(forCase(events, "CASE-0001"));
    expect(nodes.slice(0, 7)).toEqual(["ingest", "history", "triage", "clash", "group", "missing_info", "planner"]);
    expect(nodes).toContain("gate");
    expect(nodes[nodes.length - 1]).toBe("log");
    expect(engine.cases()[0].state).not.toBe("running");
  });

  it("keeps every summary at 90 characters or fewer", () => {
    const { engine, events } = setup({ background: true });
    engine.incident({ id: "INC-1", kind: "truck_crash", edgeKey: "a|b", note: "A Hamyway truck hit a bus on the Embankment near the very long named junction", affected: 9 });
    engine.incident({ id: "INC-2", kind: "breakdown", edgeKey: "c|d", note: "", affected: 4 });
    run(engine, 180_000);
    expect(events.length).toBeGreaterThan(50);
    for (const e of events) expect(e.summary.length).toBeLessThanOrEqual(90);
  });

  it("shows each node for at least 500 ms before its result", () => {
    const { engine, events } = setup({ clock: undefined });
    engine.incident({ id: "INC-1", kind: "car_crash", edgeKey: "a|b", note: "", affected: 3 });
    run(engine, 60_000);
    const evs = forCase(events, "CASE-0001");
    for (let i = 0; i < evs.length; i++) {
      if (evs[i].status !== "start") continue;
      const result = evs.slice(i + 1).find((e) => e.nodeId === evs[i].nodeId && e.status !== "start");
      expect(result).toBeDefined();
      expect(result!.t - evs[i].t).toBeGreaterThanOrEqual(500);
    }
  });

  it.each(["car_crash", "truck_crash", "pileup", "roadworks", "breakdown", "plane_crash", "emergency_landing"] as const)(
    "handles a %s incident end to end",
    (kind) => {
      const { engine, events } = setup();
      engine.incident({ id: "INC-1", kind, edgeKey: "a|b", note: "", affected: 5 });
      run(engine, 90_000);
      const nodes = nodesOf(events);
      expect(nodes[0]).toBe("ingest");
      expect(nodes[nodes.length - 1]).toBe("log");
      expect(engine.cases()[0].title).toMatch(/: 5 Hamyway City deliveries on affected routes$/);
    },
  );

  it("uses the injected clock for event timestamps", () => {
    const { engine, events } = setup({ clock: () => 123 });
    engine.incident({ id: "INC-1", kind: "roadworks", edgeKey: "a|b", note: "", affected: 2 });
    engine.advance(10);
    expect(events[0].t).toBe(123);
  });
});

describe("delayed deliveries", () => {
  it("collects for 20 s then opens ONE grouped case when they share a reason", () => {
    const { engine, events } = setup();
    engine.delayed("DL-1001", "van V-12 breakdown");
    run(engine, 5_000);
    engine.delayed("DL-1002", "van V-12 breakdown");
    engine.delayed("DL-1003", "van V-12 breakdown");
    engine.delayed("DL-1003", "van V-12 breakdown"); // duplicate ignored
    run(engine, 14_000);
    expect(engine.cases()).toHaveLength(0);
    run(engine, 2_000);
    expect(engine.cases()).toHaveLength(1);
    expect(engine.cases()[0].title).toBe("3 deliveries delayed, 1 cause: van V-12 breakdown");
    run(engine, 30_000);
    const group = events.find((e) => e.nodeId === "group" && e.status === "ok");
    expect(group?.summary).toMatch(/3 deliveries/);
  });

  it("opens a where's-my-parcel case for a lone delay", () => {
    const { engine } = setup();
    engine.delayed("DL-1042", "roadworks on King St");
    run(engine, 21_000);
    expect(engine.cases()).toHaveLength(1);
    expect(engine.cases()[0].kind).toBe("single_delay");
    expect(engine.cases()[0].title).toMatch(/DL-1042/);
  });
});

describe("background customer messages", () => {
  it("routine templates never cross into review because of random risk jitter", () => {
    for (const seed of [1, 7, 11, 42, 91]) {
      const { engine } = setup({ seed });
      for (const id of CUSTOMER_TEMPLATE_IDS.filter((id) => id !== "legal_notice")) {
        const c = engine.customerMessage(id);
        expect(c.gate, `${id}, seed ${seed}`).toBe("allow");
        expect(c.decision).toBeUndefined();
      }
    }
  });

  it("a solicitor's legal hold reaches a person and never sends a fallback message", () => {
    const { engine, events } = setup();
    const c = engine.customerMessage("legal_notice");
    run(engine, 60_000);
    expect(c.gate).toBe("ask");
    expect(c.decision?.reason).toMatch(/formal solicitor/);
    expect(c.decision?.chosen).toBe("Keep legal hold");
    expect(nodesOf(events)).not.toContain("action");
    expect(c.outcome).toBe("escalated");
  });

  it("opens a customer case every 12 to 20 s", () => {
    const { engine } = setup({ background: true });
    run(engine, 11_900);
    expect(engine.cases()).toHaveLength(0);
    run(engine, 8_200);
    expect(engine.cases().length).toBeGreaterThanOrEqual(1);
    expect(engine.cases()[0].kind).toBe("customer");
  });

  it("is deterministic for the same seed", () => {
    const a = setup({ background: true, seed: 42 });
    const b = setup({ background: true, seed: 42 });
    run(a.engine, 90_000);
    run(b.engine, 90_000);
    expect(a.events.map((e) => e.summary)).toEqual(b.events.map((e) => e.summary));
    expect(a.events.length).toBeGreaterThan(20);
  });

  it("has a realistic set of templates", () => {
    for (const id of ["slot_change", "missing_flat", "gate_code", "damaged_carton", "not_arrived", "wrong_item", "return_label", "cold_chain", "import_charge"]) {
      expect(CUSTOMER_TEMPLATE_IDS).toContain(id);
    }
  });
});

describe("clash, gate, human, verify, log", () => {
  it("fires the clash node on contradictory stories", () => {
    const { engine, events } = setup();
    engine.customerMessage("not_arrived");
    run(engine, 40_000);
    const clash = events.find((e) => e.nodeId === "clash" && e.status !== "start");
    expect(clash?.summary).toMatch(/^Clash: tracking/);
    expect(engine.cases()[0].clash).toBe(true);
  });

  it("asks a human with a decision card and auto-picks the safe option after ~6 s", () => {
    const { engine, events } = setup();
    engine.customerMessage("not_arrived", { risk: 0.55 });
    run(engine, 60_000);
    const evs = forCase(events, "CASE-0001");
    const gate = evs.find((e) => e.nodeId === "gate" && e.status !== "start");
    expect(gate?.summary).toMatch(/ask a human/);
    // Exactly one "ask" per case: the human decision card (the HUD toasts on every ask).
    const asks = evs.filter((e) => e.status === "ask");
    expect(asks.map((e) => e.nodeId)).toEqual(["human"]);
    const ask = asks[0];
    const options = parseDecisionCard(ask.summary);
    expect(options).toContain("Investigate");
    const done = evs.find((e) => e.nodeId === "human" && e.status === "ok")!;
    expect(done.t - ask.t).toBeGreaterThanOrEqual(6_000);
    expect(done.summary).toMatch(/Investigate/);
    expect(nodesOf(evs).slice(-3)).toEqual(["action", "verify", "log"]);
  });

  it("lets the HUD decide for a waiting case", () => {
    const { engine, events } = setup();
    engine.customerMessage("not_arrived", { risk: 0.55 });
    let waiting = engine.cases()[0];
    for (let i = 0; i < 400 && waiting.state !== "awaiting_human"; i++) {
      engine.advance(50);
      waiting = engine.cases()[0];
    }
    expect(waiting.state).toBe("awaiting_human");
    expect(engine.decide(waiting.id, "Refund £20")).toBe(true);
    engine.advance(50);
    const done = events.find((e) => e.nodeId === "human" && e.status === "ok")!;
    expect(done.summary).toMatch(/Refund £20/);
  });

  it("allows low-risk cases straight to action", () => {
    const { engine, events } = setup();
    engine.customerMessage("return_label", { risk: 0.1 });
    run(engine, 40_000);
    const nodes = nodesOf(events);
    expect(nodes).not.toContain("human");
    expect(nodes.indexOf("action")).toBe(nodes.indexOf("gate") + 1);
    expect(events.find((e) => e.nodeId === "action" && e.status === "ok")?.summary).toMatch(/→/);
  });

  it("blocks high-risk cases and goes straight to log", () => {
    const { engine, events } = setup();
    engine.customerMessage("cold_chain", { risk: 0.88 });
    run(engine, 40_000);
    const gate = events.find((e) => e.nodeId === "gate" && e.status !== "start");
    expect(gate?.status).toBe("block");
    const nodes = nodesOf(events);
    expect(nodes).not.toContain("action");
    expect(nodes[nodes.length - 1]).toBe("log");
    expect(engine.cases()[0].state).toBe("blocked");
  });

  it("retries verify once when it fails", () => {
    const { engine, events } = setup();
    engine.customerMessage("return_label", { risk: 0.1, verifyFails: true });
    run(engine, 40_000);
    const verify = events.filter((e) => e.nodeId === "verify" && e.status !== "start").map((e) => e.status);
    expect(verify).toEqual(["error", "ok"]);
  });

  it("logs a mock cost between $0.0003 and $0.004", () => {
    const { engine, events } = setup({ background: true });
    run(engine, 200_000);
    const logs = events.filter((e) => e.nodeId === "log" && e.status === "ok");
    expect(logs.length).toBeGreaterThan(3);
    for (const l of logs) {
      const cost = Number(/\$(\d+\.\d+)/.exec(l.summary)![1]);
      expect(cost).toBeGreaterThanOrEqual(0.0003);
      expect(cost).toBeLessThanOrEqual(0.004);
    }
    for (const c of engine.cases().filter((c) => c.state === "done" || c.state === "blocked")) {
      expect(c.costUsd).toBeGreaterThanOrEqual(0.0003);
      expect(c.costUsd).toBeLessThanOrEqual(0.004);
    }
  });
});

describe("concurrency", () => {
  it("runs at most 6 cases at once and queues the rest", () => {
    const { engine } = setup();
    for (let i = 0; i < 9; i++) engine.incident({ id: `INC-${i}`, kind: "roadworks", edgeKey: `e${i}`, note: "", affected: 3 });
    let maxActive = 0;
    for (let t = 0; t < 120_000; t += 50) {
      engine.advance(50);
      const active = engine.cases().filter((c) => c.state === "running" || c.state === "awaiting_human").length;
      maxActive = Math.max(maxActive, active);
    }
    expect(maxActive).toBe(6);
    expect(engine.cases().filter((c) => c.state === "done" || c.state === "blocked")).toHaveLength(9);
  });

  it("records step summaries with runners on the case", () => {
    const { engine } = setup();
    engine.customerMessage("damaged_carton", { risk: 0.1 });
    run(engine, 40_000);
    const c = engine.cases()[0];
    const triage = c.steps.find((s) => s.nodeId === "triage")!;
    expect(triage.runner).toBe("jev");
    expect(c.steps.find((s) => s.nodeId === "planner")!.runner).toBe("claude");
    expect(triage.summary).toMatch(/^Triage: \w+ · (low|medium|high) · p 0\.\d\d$/);
  });
});
