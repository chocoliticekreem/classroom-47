import { describe, expect, it } from "vitest";
import type { Flow, WorkflowRecord } from "../types";
import { carefulToThresholds, thresholdsToCareful } from "../workflows/careful";
import {
  activeWorkflow,
  applyCareful,
  caseSetCounts,
  currentThresholds,
  describeThresholds,
  flowCareful,
  money,
  spendSummary,
  withCareful,
} from "./logic";

const flow = (gateConfig?: Record<string, unknown>): Flow =>
  ({
    id: "default-incident",
    name: "Default",
    business: "",
    nodes: [
      { id: "planner", type: "planner", runs_on: ["claude"] },
      { id: "gate", type: "safety_gate", runs_on: ["jev", "code"], config: { note: "keep", ...gateConfig } },
      { id: "gate2", type: "safety_gate", runs_on: ["code"] },
    ],
    edges: [{ from: "planner", to: "gate" }],
  }) as unknown as Flow;

const wf = (over: Partial<WorkflowRecord> = {}): WorkflowRecord => ({
  id: "default-incident",
  name: "Default",
  flow: flow({ allow_below: 0.3, block_above: 0.8 }),
  positions: {},
  active: true,
  updatedAt: "2026-01-01T00:00:00.000Z",
  source: "file",
  ...over,
});

describe("threshold dial wiring", () => {
  it("strict end sets every safety check to the strict thresholds and keeps other config", () => {
    const out = applyCareful(flow({ allow_below: 0.3, block_above: 0.8 }), 1);
    const gates = out.nodes.filter((n) => n.type === "safety_gate");
    expect(gates).toHaveLength(2);
    for (const g of gates) expect(g.config).toMatchObject({ allow_below: 0.15, block_above: 0.65 });
    expect(gates[0].config?.note).toBe("keep");
    expect(out.nodes[0]).toEqual(flow().nodes[0]);
  });

  it("relaxed end and middle follow careful.ts", () => {
    expect(currentThresholds(applyCareful(flow(), 0))).toEqual({ allow_below: 0.5, block_above: 0.95 });
    expect(currentThresholds(applyCareful(flow(), 0.5))).toEqual(carefulToThresholds(0.5));
  });

  it("does not mutate the input flow", () => {
    const f = flow({ allow_below: 0.3, block_above: 0.8 });
    applyCareful(f, 1);
    expect(f.nodes[1].config).toMatchObject({ allow_below: 0.3, block_above: 0.8 });
  });

  it("reads the dial position back from the first safety check", () => {
    expect(flowCareful(flow({ allow_below: 0.15, block_above: 0.65 }))).toBe(1);
    expect(flowCareful(flow({ allow_below: 0.5, block_above: 0.95 }))).toBe(0);
    expect(flowCareful(flow({ allow_below: 0.3, block_above: 0.8 }))).toBe(thresholdsToCareful({ allow_below: 0.3, block_above: 0.8 }));
    expect(flowCareful({ ...flow(), nodes: [] } as Flow)).toBeNull();
  });

  it("round-trips: saving a dial position reads back the same position", () => {
    for (const c of [0, 0.25, 0.5, 0.75, 1]) expect(flowCareful(applyCareful(flow(), c))).toBeCloseTo(c, 1);
  });

  it("withCareful keeps the playbook id and identity fields", () => {
    const rec = withCareful(wf(), 1);
    expect(rec.id).toBe("default-incident");
    expect(rec.flow.id).toBe("default-incident");
    expect(rec.active).toBe(true);
    expect(currentThresholds(rec.flow)).toEqual({ allow_below: 0.15, block_above: 0.65 });
  });

  it("defaults missing thresholds to 0.30 / 0.80", () => {
    expect(currentThresholds(flow())).toEqual({ allow_below: 0.3, block_above: 0.8 });
  });

  it("picks the active playbook", () => {
    expect(activeWorkflow([wf({ id: "a", active: false }), wf({ id: "b", active: true })])?.id).toBe("b");
    expect(activeWorkflow([wf({ id: "a", active: false })])?.id).toBe("a");
    expect(activeWorkflow([])).toBeNull();
  });
});

describe("describeThresholds", () => {
  it("says the default in plain words", () => {
    const d = describeThresholds({ allow_below: 0.3, block_above: 0.8 });
    expect(d.ask).toBe("Asks a person when risk is 30 to 79 in 100");
    expect(d.stop).toBe("Stops when risk is high (80+ in 100)");
    expect(d.send).toBe("Sends on its own when risk is under 30 in 100");
  });

  it("strict asks for a person even at low risk", () => {
    const t = carefulToThresholds(1);
    expect(describeThresholds(t).ask).toBe(`Asks a person when risk is ${Math.round(t.allow_below * 100)} to ${Math.round(t.block_above * 100) - 1} in 100`);
    expect(t.allow_below).toBeLessThan(0.3);
  });

  it("never leaks config keys", () => {
    const all = Object.values(describeThresholds(carefulToThresholds(0.4))).join(" ");
    expect(all).not.toMatch(/allow_below|block_above|0\.\d/);
  });
});

describe("spendSummary", () => {
  const now = new Date(2026, 9, 10, 15, 0);
  const at = (d: number, h = 10) => new Date(2026, 9, d, h).toISOString();

  it("sums today's cost and averages over runs with a cost", () => {
    const s = spendSummary(
      [
        { startedAt: at(10), costUsd: 0.08 },
        { startedAt: at(10, 1), costUsd: 0.02 },
        { startedAt: at(10), costUsd: null },
        { startedAt: at(9), costUsd: 0.2 },
      ],
      now,
    );
    expect(s.todayUsd).toBeCloseTo(0.1);
    expect(s.todayRuns).toBe(3);
    expect(s.costedRuns).toBe(3);
    expect(s.avgUsd).toBeCloseTo(0.1);
  });

  it("is honest when nothing has a cost", () => {
    const s = spendSummary([{ startedAt: "bad", costUsd: null }], now);
    expect(s).toEqual({ todayUsd: 0, todayRuns: 0, avgUsd: null, costedRuns: 0 });
    expect(money(s.avgUsd)).toBe("—");
    expect(money(s.todayUsd)).toBe("0¢");
  });
});

describe("caseSetCounts", () => {
  it("joins cases per set with case runs per set", () => {
    const out = caseSetCounts({ cases_public: 30, cases_city: 50, executions: 9 }, [
      { dataset: "public" },
      { dataset: "public" },
      { dataset: "adhoc" },
    ]);
    expect(out.map((s) => [s.dataset, s.cases, s.runs])).toEqual([
      ["city", 50, 0],
      ["public", 30, 2],
      ["adhoc", 0, 1],
    ]);
    expect(out.every((s) => s.label.length > 0)).toBe(true);
  });
});
