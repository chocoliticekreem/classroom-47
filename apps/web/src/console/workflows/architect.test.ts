import { describe, expect, it } from "vitest";
import type { Flow } from "../types";
import flowJson from "../../../../api/flows/default-incident.json";
import {
  architectDescription, buildRequest, explainFlow, nameFrom, problemsByNode, revealFrame, revealOrder,
  safetyLine, safetySummary, slugify, usageTotals, validateRequest,
} from "./architect";

const flow = flowJson as Flow;

describe("architect requests", () => {
  it("sends the description, trimmed", () => {
    expect(buildRequest("  Frozen food, cold-chain vans ")).toEqual({ description: "Frozen food, cold-chain vans" });
  });
  it("refines by appending Changes:", () => {
    expect(buildRequest("Pharmacy courier", "add a missing-info step")).toEqual({
      description: "Pharmacy courier\n\nChanges: add a missing-info step",
    });
    expect(architectDescription("A", "   ")).toBe("A");
  });
  it("validates by sending the flow", () => {
    expect(validateRequest(flow)).toEqual({ flow });
  });
});

describe("draft reveal", () => {
  it("starts at ingest and follows edges breadth-first", () => {
    const order = revealOrder(flow);
    expect(order[0]).toBe("ingest");
    expect(order.slice(0, 7)).toEqual(["ingest", "history", "triage", "perspectives", "clash", "planner", "gate"]);
    // gate exits in declared order: allow (action), ask (human), block (log)
    expect(order.slice(7, 10)).toEqual(["action", "human", "log"]);
    expect(order).toHaveLength(flow.nodes.length);
    expect(new Set(order).size).toBe(flow.nodes.length);
  });
  it("every node appears after at least one predecessor", () => {
    const order = revealOrder(flow);
    for (const id of order.slice(1)) {
      const preds = flow.edges.filter((e) => e.to === id).map((e) => order.indexOf(e.from));
      expect(Math.min(...preds)).toBeLessThan(order.indexOf(id));
    }
  });
  it("appends unreachable nodes and handles no ingest", () => {
    const f = { nodes: [{ id: "x", type: "triage" as const, runs_on: [] }, { id: "y", type: "verify" as const, runs_on: [] }, { id: "z", type: "planner" as const, runs_on: [] }], edges: [{ from: "x", to: "y" }, { from: "y", to: "x" }] };
    expect(revealOrder(f)).toEqual(["z", "x", "y"]);
  });
  it("frames show only edges between visible nodes", () => {
    const order = revealOrder(flow);
    const f = revealFrame(flow, order, 3);
    expect([...f.nodes]).toEqual(["ingest", "history", "triage"]);
    expect(f.edges).toEqual([{ from: "ingest", to: "history" }, { from: "history", to: "triage" }]);
    expect(revealFrame(flow, order, 0).nodes.size).toBe(0);
    expect(revealFrame(flow, order, 99).edges).toHaveLength(flow.edges.length);
  });
});

describe("explanation and problems", () => {
  it("explains steps with gate branches", () => {
    const steps = explainFlow(flow);
    const gate = steps.find((s) => s.id === "gate")!;
    expect(gate.label).toBe("Safety check");
    expect(gate.branches).toEqual(["OK → Send it", "Ask a person → Ask a person", "Stop → Done"]);
    expect(steps[0].role).toBe("Reads every message and file.");
    for (const s of steps) expect(s.role.split(" ").length).toBeLessThanOrEqual(8);
  });
  it("maps problems to nodes", () => {
    const { byNode, general } = problemsByNode([
      'safety_gate "gate" needs numeric config allow_below < block_above, both between 0 and 1',
      "unreachable from the start: verify, log",
      "cycle: action -> verify -> action",
      "no human_decision node",
    ], flow);
    expect(Object.keys(byNode).sort()).toEqual(["action", "gate", "log", "verify"]);
    expect(byNode.verify).toHaveLength(2);
    expect(general).toEqual(["no human_decision node"]);
  });
  it("totals usage", () => {
    expect(usageTotals(undefined)).toBeNull();
    expect(usageTotals([{ model: "m", latencyMs: 1000, tokensIn: 1, tokensOut: 1, costUsd: 0.01 }, { model: "m2", latencyMs: 500, tokensIn: 1, tokensOut: 1, costUsd: 0.02 }]))
      .toEqual({ costUsd: 0.03, latencyMs: 1500, calls: 2, model: "m2" });
  });
  it("names and ids", () => {
    expect(slugify("Pharmacy courier, 40 drivers, controlled meds")).toBe("pharmacy-courier-40-drivers-controlled");
    expect(slugify("Frozen food", ["frozen-food"])).toBe("frozen-food-2");
    expect(slugify("!!!")).toBe("flow");
    expect(nameFrom("frozen food, cold-chain vans")).toBe("Frozen food, cold-chain vans");
    expect(nameFrom("x".repeat(80)).length).toBeLessThanOrEqual(49);
  });
});

describe("safety summary", () => {
  const n = (id: string, type: string) => ({ id, type, runs_on: [] }) as unknown as Flow["nodes"][number];
  it("the default playbook checks safety on every path", () => {
    const s = safetySummary(flow);
    expect(s).toEqual({ steps: flow.nodes.length, gates: 1, everyPath: true });
    expect(safetyLine(s)).toBe(`${flow.nodes.length} steps · checks safety on every path`);
  });
  it("a branch that sends without the check is caught", () => {
    const f = structuredClone(flow);
    f.edges.push({ from: "triage", to: "action", when: "urgent" });
    const s = safetySummary(f);
    expect(s.everyPath).toBe(false);
    expect(safetyLine(s)).toBe(`${f.nodes.length} steps · some paths skip the safety check`);
  });
  it("a retry loop back past the check does not count as skipping it", () => {
    const f = structuredClone(flow);
    f.edges.push({ from: "verify", to: "planner", when: "retry" });
    expect(safetySummary(f).everyPath).toBe(true);
  });
  it("with nothing that sends, every end must be behind a check", () => {
    const ok = { nodes: [n("a", "ingest"), n("g", "safety_gate"), n("l", "case_log")], edges: [{ from: "a", to: "g" }, { from: "g", to: "l", when: "allow" }] };
    expect(safetySummary(ok).everyPath).toBe(true);
    const bad = { nodes: [...ok.nodes, n("x", "verify")], edges: [...ok.edges, { from: "a", to: "x" }] };
    expect(safetySummary(bad).everyPath).toBe(false);
  });
  it("no gate, or no steps, is never safe", () => {
    const f = { nodes: [n("a", "ingest"), n("s", "action")], edges: [{ from: "a", to: "s" }] };
    expect(safetySummary(f)).toEqual({ steps: 2, gates: 0, everyPath: false });
    expect(safetyLine(safetySummary(f))).toBe("2 steps · no safety check");
    expect(safetySummary({ nodes: [], edges: [] }).everyPath).toBe(false);
  });
});
