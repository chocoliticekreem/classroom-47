import { describe, expect, it } from "vitest";
import type { Flow } from "../types";
import flowJson from "../../../../api/flows/default-incident.json";
import { BRANCHING_EXAMPLE } from "../../../../api/src/agent/architect";
import { edgeKey } from "./doc";
import {
  BADGE_H, CARD_W, GAP_Y, TREE_MARK, cardHeight, displayPositions, edgeRoutes, tidyPositions, treeLayout, unmerge,
  usablePositions, type DisplayTree, type Route,
} from "./layout";


/** The earlier 27-node branching example: a DAG with many shared nodes and a retry loop. */
function sharedDag(): Flow {
  const types: Record<string, string> = {
    ingest: "ingest", history: "history_lookup", group: "group_check", triage: "triage", info_damage: "missing_info",
    clash_parcel: "clash_check", perspectives_cold: "perspectives", perspectives: "perspectives", human_hold: "human_decision",
    planner_ask: "planner", gate_ask: "safety_gate", action_ask: "action", planner_group: "planner", gate_group: "safety_gate",
    action_group: "action", planner_investigation: "planner", planner_strict: "planner", gate_strict: "safety_gate",
    planner: "planner", gate: "safety_gate", human: "human_decision", action: "action", verify: "verify",
    human_failed: "human_decision", log: "case_log", log_held: "case_log", log_waiting: "case_log",
  };
  const e = (from: string, to: string, when?: string) => (when ? { from, to, when } : { from, to });
  const exits = (g: string, act: string) => [e(g, act, "allow"), e(g, "human", "ask"), e(g, "log", "block")];
  return {
    id: "dag", name: "dag", business: "",
    nodes: Object.entries(types).map(([id, type]) => ({ id, type: type as Flow["nodes"][number]["type"], runs_on: [] })),
    edges: [
      e("ingest", "history"), e("history", "group"), e("group", "planner_group", "linked"), e("group", "triage", "single"),
      e("triage", "info_damage", "damage"), e("triage", "clash_parcel", "missing_parcel"), e("triage", "perspectives_cold", "cold_chain"), e("triage", "perspectives", "other"),
      e("info_damage", "planner_ask", "missing"), e("info_damage", "perspectives", "complete"),
      e("clash_parcel", "planner_investigation", "clash"), e("clash_parcel", "perspectives", "consistent"),
      e("perspectives_cold", "human_hold", "force_human"), e("perspectives_cold", "planner_strict", "brief"),
      e("perspectives", "human_hold", "force_human"), e("perspectives", "planner", "brief"),
      e("human_hold", "planner_strict", "proceed"), e("human_hold", "log_held", "fallback"),
      e("planner_ask", "gate_ask"), ...exits("gate_ask", "action_ask"), e("action_ask", "log_waiting"),
      e("planner_group", "gate_group"), ...exits("gate_group", "action_group"), e("action_group", "log"),
      e("planner_investigation", "gate"), e("planner_strict", "gate_strict"), ...exits("gate_strict", "action"),
      e("planner", "gate"), ...exits("gate", "action"),
      e("human", "action", "approve"), e("human", "log", "reject"), e("human", "log_held", "fallback"),
      e("action", "verify"), e("verify", "log", "ok"), e("verify", "action", "retry"), e("verify", "human_failed", "failed"),
      e("human_failed", "log_held"),
    ],
  };
}

const FLOWS: [string, Flow][] = [["default", flowJson as Flow], ["branching example", BRANCHING_EXAMPLE], ["shared DAG", sharedDag()]];

type Seg = { x1: number; y1: number; x2: number; y2: number };
const segs = (r: Route): Seg[] => [
  { x1: r.sx, y1: r.sy, x2: r.trunkX, y2: r.sy },
  { x1: r.trunkX, y1: r.sy, x2: r.trunkX, y2: r.ty },
  { x1: r.trunkX, y1: r.ty, x2: r.tx, y2: r.ty },
].filter((s) => s.x1 !== s.x2 || s.y1 !== s.y2);

/** Axis-aligned segments touch (cross, meet or overlap). */
function touch(a: Seg, b: Seg): boolean {
  const ax = [Math.min(a.x1, a.x2), Math.max(a.x1, a.x2)], ay = [Math.min(a.y1, a.y2), Math.max(a.y1, a.y2)];
  const bx = [Math.min(b.x1, b.x2), Math.max(b.x1, b.x2)], by = [Math.min(b.y1, b.y2), Math.max(b.y1, b.y2)];
  return ax[0] <= bx[1] && bx[0] <= ax[1] && ay[0] <= by[1] && by[0] <= ay[1];
}

function isTree(t: DisplayTree) {
  const indeg = new Map<string, number>();
  for (const e of t.edges) indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  return t.nodes.every((n) => (indeg.get(n.id) ?? 0) === (t.roots.includes(n.id) ? 0 : 1));
}

describe.each(FLOWS)("tree layout: %s flow", (_name, flow) => {
  const t = unmerge(flow);
  const pos = treeLayout(t);

  it("unmerge yields a tree covering every node and every non-loop edge exactly once", () => {
    expect(isTree(t)).toBe(true);
    expect(t.edges.length).toBe(t.nodes.length - t.roots.length);
    expect(new Set(t.nodes.map((n) => n.nodeId))).toEqual(new Set(flow.nodes.map((n) => n.id)));
    const drawn = t.edges.map((e) => edgeKey(e.edge)).sort();
    const expected = flow.edges.filter((e) => !t.backEdges.includes(e)).map(edgeKey).sort();
    expect(drawn).toEqual(expected);
    expect(new Set(t.nodes.map((n) => n.id)).size).toBe(t.nodes.length);
    expect(t.roots[0]).toBe("ingest");
  });

  it("no two cards (with their badge room) overlap", () => {
    const boxes = t.nodes.map((n) => ({ id: n.id, x: pos[n.id].x, y: pos[n.id].y, w: CARD_W, h: cardHeight(n.node.type) + BADGE_H }));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h + GAP_Y / 2 && b.y < a.y + a.h + GAP_Y / 2;
        expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
  });

  it("no two edges from different outputs touch, and children sit right of parents", () => {
    const routes = edgeRoutes(t, pos);
    expect(routes.size).toBe(t.edges.length);
    const list = t.edges.map((e) => ({ e, r: routes.get(e.id)! }));
    for (const { r } of list) expect(r.tx).toBeGreaterThan(r.trunkX);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (a.e.source === b.e.source && a.e.handle === b.e.handle) continue; // one bus from one output
        for (const sa of segs(a.r)) for (const sb of segs(b.r)) {
          expect(touch(sa, sb), `${a.e.id} touches ${b.e.id}`).toBe(false);
        }
      }
    }
  });
});

describe("unmerge details", () => {
  const t = unmerge(sharedDag());
  it("turns retry into a loop badge on verify and names copies id~n", () => {
    expect(t.backEdges).toEqual([{ from: "verify", to: "action", when: "retry" }]);
    expect(t.byId.get("verify")!.loops).toHaveLength(1);
    const logs = t.nodes.filter((n) => n.nodeId === "log");
    const full = logs.filter((n) => !n.stub);
    expect(full.map((n) => n.id)).toEqual(["log"]);
    expect(logs.filter((n) => n.stub).map((n) => n.id).sort()).toEqual(logs.slice(1).map((_, i) => `log~${i + 2}`).sort());
    expect(logs.every((n) => n.occurrences === logs.length)).toBe(true);
    // a shared node is drawn in full at its shallowest occurrence
    expect(full[0].depth).toBe(Math.min(...logs.map((n) => n.depth)));
    expect(t.byId.get("perspectives")!.depth).toBe(4);
  });
  it("leaves a strict tree alone apart from its retry loop", () => {
    const b = unmerge(BRANCHING_EXAMPLE);
    expect(b.nodes).toHaveLength(BRANCHING_EXAMPLE.nodes.length);
    expect(b.nodes.every((n) => !n.stub && n.id === n.nodeId)).toBe(true);
    expect(b.backEdges.every((e) => e.when === "retry")).toBe(true);
  });
  it("orders gate exits allow, ask, block", () => {
    const kids = t.children.get("gate")!.map((e) => e.edge.when);
    expect(kids).toEqual(["allow", "ask", "block"]);
    const pos = treeLayout(t);
    const ys = t.children.get("gate")!.map((e) => pos[e.target].y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
  });
  it("breaks a cycle without a retry label", () => {
    const c = unmerge({ nodes: [{ id: "ingest", type: "ingest", runs_on: [] }, { id: "b", type: "triage", runs_on: [] }], edges: [{ from: "ingest", to: "b" }, { from: "b", to: "ingest" }] });
    expect(c.backEdges).toEqual([{ from: "b", to: "ingest" }]);
    expect(c.edges).toHaveLength(1);
  });
  it("uses saved positions only when they are tree positions covering every copy", () => {
    const saved = tidyPositions(sharedDag());
    expect(saved[TREE_MARK]).toBeTruthy();
    expect(usablePositions(t, saved)).toBe(saved);
    const unmarked = Object.fromEntries(Object.entries(saved).filter(([k]) => k !== TREE_MARK));
    expect(usablePositions(t, unmarked)).toBeNull();
    expect(displayPositions(t, { ingest: { x: 5, y: 5 } }).ingest).not.toEqual({ x: 5, y: 5 });
  });
});
