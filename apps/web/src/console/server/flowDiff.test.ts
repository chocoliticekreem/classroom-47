import { describe, expect, it } from "vitest";
import type { Flow } from "../types";
import { diffFlows } from "./flowDiff";

const before: Pick<Flow, "nodes" | "edges"> = {
  nodes: [
    { id: "ingest", type: "ingest", runs_on: ["code"] },
    { id: "triage", type: "triage", runs_on: ["jev"] },
    { id: "perspectives", type: "perspectives", runs_on: ["jev"], config: { rules: { "a.x": { at_least: 0.5, effect: "brief", note: "n" }, "a.y": { at_least: 0.6, effect: "brief", note: "n" } } } },
    { id: "gate", type: "safety_gate", runs_on: ["jev"], config: { allow_below: 0.3, block_above: 0.8 } },
    { id: "log", type: "case_log", runs_on: ["code"] },
  ],
  edges: [
    { from: "ingest", to: "triage" },
    { from: "triage", to: "perspectives" },
    { from: "perspectives", to: "gate" },
    { from: "gate", to: "log", when: "block" },
  ],
};

describe("diffFlows", () => {
  it("is empty for the same flow", () => {
    expect(diffFlows(before, structuredClone(before))).toEqual([]);
  });

  it("lists added/removed nodes, threshold moves, rule changes and branch edits", () => {
    const after = structuredClone(before);
    after.nodes = after.nodes.filter((n) => n.id !== "triage");
    after.nodes.push({ id: "clash", type: "clash_check", runs_on: ["claude"] });
    after.nodes.find((n) => n.id === "gate")!.config = { allow_below: 0.2, block_above: 0.8 };
    after.nodes.find((n) => n.id === "perspectives")!.config = { rules: { "a.x": { at_least: 0.4, effect: "force_human", note: "n" }, "a.z": { at_least: 0.5, effect: "brief", note: "m" } } };
    after.edges = [
      { from: "ingest", to: "clash" },
      { from: "clash", to: "perspectives", when: "clash" },
      { from: "clash", to: "log", when: "consistent" },
      { from: "perspectives", to: "gate" },
      { from: "gate", to: "log", when: "ask" },
    ];
    expect(diffFlows(before, after)).toEqual([
      "Node added: clash (clash_check)",
      "Node removed: triage (triage)",
      "perspectives: rule a.x at_least 0.5 → 0.4",
      "perspectives: rule a.x effect \"brief\" → \"force_human\"",
      "perspectives: rule a.z added (at_least 0.5, \"brief\")",
      "perspectives: rule a.y removed",
      "gate: allow_below 0.3 → 0.2",
      "Edge added: ingest → clash",
      "Edge added: clash → perspectives [clash]",
      "Edge added: clash → log [consistent]",
      "Edge gate → log: branch block → ask",
      "Edge removed: ingest → triage",
      "Edge removed: triage → perspectives",
      "New decision points: clash",
    ]);
  });

  it("reports a node's type and runner changes", () => {
    const after = structuredClone(before);
    after.nodes[1] = { id: "triage", type: "missing_info", runs_on: ["claude"] };
    expect(diffFlows(before, after)).toEqual(["triage: type triage → missing_info", "triage: runs on jev → claude"]);
  });
});
