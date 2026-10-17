import { describe, expect, it } from "vitest";
import type { Flow, TestRun } from "../types";
import flowJson from "../../../../api/flows/default-incident.json";
import {
  autoNext, autoStart, configChanges, costPerCase, diffCount, diffFlows, edgeMark, fmtValue, initialPoll,
  learningCurve, nodeMark, pollReducer, practiceLink, retestBody, reuseLine, type AutoState,
} from "./testing";

const base = flowJson as Flow;

function revised(): Flow {
  const f: Flow = structuredClone(base);
  f.nodes = f.nodes.filter((n) => n.id !== "clash");
  f.edges = f.edges.filter((e) => e.from !== "clash" && e.to !== "clash");
  f.nodes.push({ id: "missing", type: "missing_info", runs_on: ["jev"] });
  f.edges.push({ from: "perspectives", to: "missing" }, { from: "missing", to: "planner" });
  const gate = f.nodes.find((n) => n.id === "gate")!;
  gate.config = { allow_below: 0.2, block_above: 0.8 };
  f.nodes.find((n) => n.id === "verify")!.runs_on = ["jev", "code"];
  return f;
}

const run = (over: Partial<TestRun> = {}, summary: Partial<TestRun["summary"]> = {}): TestRun => ({
  id: "t1", workflowId: "w", version: 1, set: "quick", filter: null, status: "running",
  startedAt: "2026-10-10T00:00:00Z", finishedAt: null, cases: [],
  summary: { total: 5, passed: 2, failed: 3, errors: 0, meanScore: 0.5, costUsd: 0.5, ...summary },
  ...over,
});

describe("diffFlows", () => {
  const d = diffFlows(base, revised());
  it("finds added, removed and changed nodes", () => {
    expect([...d.addedNodes]).toEqual(["missing"]);
    expect([...d.removedNodes]).toEqual(["clash"]);
    expect(d.changedNodes.get("gate")?.config).toEqual([{ key: "allow_below", from: 0.3, to: 0.2 }]);
    expect(d.changedNodes.get("verify")?.runners).toEqual({ from: ["jev"], to: ["jev", "code"] });
    expect(d.changedNodes.has("ingest")).toBe(false);
  });
  it("finds edge changes and keeps removed items in the merged flow", () => {
    expect([...d.addedEdges].sort()).toEqual(["missing->planner", "perspectives->missing"]);
    expect([...d.removedEdges].sort()).toEqual(["clash->planner", "perspectives->clash"]);
    expect(d.merged.nodes.some((n) => n.id === "clash")).toBe(true);
    expect(d.merged.edges).toHaveLength(revised().edges.length + 2);
    expect(nodeMark(d, "missing")).toBe("added");
    expect(nodeMark(d, "clash")).toBe("removed");
    expect(nodeMark(d, "gate")).toBe("changed");
    expect(nodeMark(d, "ingest")).toBeNull();
    expect(edgeMark(d, { from: "perspectives", to: "clash" })).toBe("removed");
    expect(edgeMark(d, { from: "ingest", to: "history" })).toBeNull();
    expect(diffCount(d)).toBe(1 + 1 + 2 + 2 + 2);
  });
  it("treats when labels as part of the edge identity", () => {
    const f = structuredClone(base);
    f.edges = f.edges.map((e) => (e.from === "gate" && e.when === "block" ? { ...e, to: "human" } : e));
    const dd = diffFlows(base, f);
    expect([...dd.addedEdges]).toEqual(["gate->human:block"]);
    expect([...dd.removedEdges]).toEqual(["gate->log:block"]);
  });
  it("no diff for identical flows", () => {
    expect(diffCount(diffFlows(base, structuredClone(base)))).toBe(0);
    expect(configChanges(undefined, { a: 1 })).toEqual([{ key: "a", from: undefined, to: 1 }]);
    expect(fmtValue(0.25)).toBe("0.25");
    expect(fmtValue(undefined)).toBe("—");
  });
});

describe("pollReducer", () => {
  it("start -> polling -> done", () => {
    let s = pollReducer(initialPoll, { type: "start" });
    expect(s.phase).toBe("starting");
    s = pollReducer(s, { type: "started", run: run() });
    expect(s.phase).toBe("polling");
    s = pollReducer(s, { type: "poll_ok", run: run({ status: "done" }) });
    expect(s.phase).toBe("done");
    expect(s.run?.status).toBe("done");
  });
  it("tolerates a few failed polls, then errors", () => {
    let s = pollReducer(pollReducer(initialPoll, { type: "start" }), { type: "started", run: run() });
    for (let i = 0; i < 4; i++) s = pollReducer(s, { type: "poll_failed", error: "net", status: 0 });
    expect(s.phase).toBe("polling");
    s = pollReducer(s, { type: "poll_ok", run: run() });
    expect(s.misses).toBe(0);
    for (let i = 0; i < 5; i++) s = pollReducer(s, { type: "poll_failed", error: "net", status: 0 });
    expect(s.phase).toBe("error");
  });
  it("404 stops at once; late answers after cancel are ignored", () => {
    const polling = pollReducer(initialPoll, { type: "started", run: run() });
    expect(pollReducer(polling, { type: "poll_failed", error: "gone", status: 404 }).phase).toBe("error");
    const c = pollReducer(polling, { type: "cancel" });
    expect(c.phase).toBe("cancelled");
    expect(pollReducer(c, { type: "poll_ok", run: run({ status: "done" }) })).toBe(c);
    expect(pollReducer(initialPoll, { type: "start_failed", error: "404" }).phase).toBe("error");
    expect(pollReducer(polling, { type: "poll_ok", run: run({ status: "error" }) }).phase).toBe("error");
  });
});

describe("auto-improve loop", () => {
  const tested = (s: AutoState, passed: number, failed: number) =>
    autoNext(s, { type: "tested", status: "done", summary: { total: 5, passed, failed, errors: 0, meanScore: passed / 5, costUsd: 1 } });
  const improve = (s: AutoState) => autoNext(autoNext(s, { type: "improved", proposal: { problems: [], changes: ["x"] } }), { type: "accepted", version: 2 });

  it("runs test -> improve -> accept -> test while the pass rate rises, up to 3", () => {
    let s = autoStart();
    s = tested(s, 1, 4);
    expect(s.step).toBe("improve");
    s = improve(s);
    expect(s).toMatchObject({ step: "test", iteration: 1 });
    s = tested(s, 2, 3);
    s = improve(s);
    s = tested(s, 3, 2);
    s = improve(s);
    expect(s.iteration).toBe(3);
    s = tested(s, 4, 1);
    expect(s.step).toBe("stopped");
    expect(s.reason).toMatch(/improved 3 times/);
    expect(s.rates).toEqual([0.2, 0.4, 0.6, 0.8]);
  });
  it("stops early when the pass rate stops rising", () => {
    let s = tested(autoStart(), 2, 3);
    s = improve(s);
    s = tested(s, 2, 3);
    expect(s.step).toBe("stopped");
    expect(s.reason).toMatch(/stopped getting better/);
  });
  it("stops when all pass, on bad proposals, errors and user stop", () => {
    expect(tested(autoStart(), 5, 0).reason).toBe("every case is right");
    const atImprove = tested(autoStart(), 1, 4);
    expect(autoNext(atImprove, { type: "improved", proposal: { problems: ["no ingest node"], changes: ["x"] } }).reason).toMatch(/wasn't safe/);
    expect(autoNext(atImprove, { type: "improved", proposal: { problems: [], changes: [] } }).reason).toMatch(/no changes/);
    expect(autoNext(atImprove, { type: "failed", error: "boom" }).reason).toBe("boom");
    expect(autoNext(atImprove, { type: "stop" }).step).toBe("stopped");
    expect(autoNext(autoStart(), { type: "tested", status: "error", summary: run().summary }).reason).toMatch(/didn't finish/);
    // out-of-order events are ignored
    expect(autoNext(autoStart(), { type: "accepted", version: 3 }).step).toBe("test");
  });
});

describe("learning curve and helpers", () => {
  it("averages finished runs per version", () => {
    const pts = learningCurve([
      run({ version: 1, status: "done" }, { passed: 1, meanScore: 0.4 }),
      run({ version: 1, status: "done" }, { passed: 3, meanScore: 0.6 }),
      run({ version: 2, status: "done" }, { passed: 4, meanScore: 0.9 }),
      run({ version: 3, status: "running" }),
    ]);
    expect(pts.map((p) => p.version)).toEqual([1, 2]);
    expect(pts[0].passRate).toBeCloseTo(0.4);
    expect(pts[0].meanScore).toBeCloseTo(0.5);
    expect(pts[1].runs).toBe(1);
  });
  it("estimates cost per case only from history", () => {
    expect(costPerCase([])).toBeNull();
    expect(costPerCase([run({ status: "done" }, { total: 4, costUsd: 0.8 })])).toBeCloseTo(0.2);
  });
  it("counts a reused result once per version", () => {
    const pts = learningCurve([
      // v1: first run 2 of 5 right, all fresh.
      run({ version: 1, status: "done" }, { total: 5, passed: 2, failed: 3, meanScore: 0.4 }),
      // v1 again, every case reused from that run: no new evidence, left out.
      run({ version: 1, status: "done" }, { total: 5, passed: 2, failed: 3, meanScore: 0.4, reused: 5, repeats: { passed: 2, failed: 3, scoreSum: 2 } }),
      // v1 again: 3 repeats (1 right, score sum 0.9) + 2 fresh right (scores 1, 1).
      run({ version: 1, status: "done" }, { total: 5, passed: 3, failed: 2, meanScore: 0.58, reused: 3, repeats: { passed: 1, failed: 2, scoreSum: 0.9 } }),
      // v2 reused results from an identical v1 flow: new for v2, so counted.
      run({ version: 2, status: "done" }, { total: 5, passed: 2, failed: 3, meanScore: 0.4, reused: 5, repeats: { passed: 0, failed: 0, scoreSum: 0 } }),
    ]);
    expect(pts[0].runs).toBe(2);
    expect(pts[0].passRate).toBeCloseTo((0.4 + 1) / 2);
    expect(pts[0].meanScore).toBeCloseTo((0.4 + 1) / 2);
    expect(pts[1]).toMatchObject({ version: 2, runs: 1 });
    expect(pts[1].passRate).toBeCloseTo(0.4);
  });
  it("leaves reused cases out of the cost estimate", () => {
    expect(costPerCase([run({ status: "done" }, { total: 5, reused: 3, costUsd: 0.1 })])).toBeCloseTo(0.05);
    expect(costPerCase([run({ status: "done" }, { total: 5, reused: 5, costUsd: 0 })])).toBeNull();
  });
  it("says how many were reused", () => {
    const re = { originalCostUsd: 0.05, countedBefore: false };
    expect(reuseLine([{ status: "passed", reused: null }])).toBeNull();
    expect(reuseLine([
      { status: "passed", reused: re }, { status: "failed", reused: re }, { status: "passed", reused: re },
      { status: "running" }, { status: "queued" },
    ])).toBe("3 reused · 2 running");
    expect(reuseLine([{ status: "passed", reused: re }, { status: "failed" }])).toBe("1 reused · 1 new");
  });
  it("builds a re-test body on the same cases", () => {
    const r = run({ cases: [{ caseId: "a" }, { caseId: "b" }] as TestRun["cases"] });
    expect(retestBody(r, 2)).toEqual({ workflowId: "w", version: 2, set: "custom", caseIds: ["a", "b"], limit: 2 });
  });
});

describe("practiceLink", () => {
  const p = (s: string) => new URLSearchParams(s);
  it("reads the Results deep link", () => {
    expect(practiceLink(p("tab=workflows&panel=practice&set=generated&filter=wrong_address"))).toEqual({ set: "generated", filter: "wrong_address" });
    expect(practiceLink(p("panel=practice&set=city"))).toEqual({ set: "city", filter: null });
  });
  it("ignores unknown sets and other panels", () => {
    expect(practiceLink(p("panel=practice&set=bogus&filter=%20"))).toEqual({ set: null, filter: null });
    expect(practiceLink(p("tab=workflows&set=quick"))).toBeNull();
    expect(practiceLink(null)).toBeNull();
  });
});
