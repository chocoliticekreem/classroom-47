import { describe, expect, it, vi } from "vitest";
import type { Trace } from "../../../../../api/src/lib/trace";
import type { ExecutionRecord } from "../../../console/types";
import { ExecutionPoller, rerunParents, type FetchJson } from "../../backendLink";
import { findExecutionId, rerunFeed, rerunWithChoice } from "./rerun";

const trace = (runId: string): Trace => ({
  runId, caseId: "gen-1201", events: [
    { kind: "run_start", t: 0, caseId: "gen-1201", title: "Case" },
    { kind: "node_end", t: 1, nodeId: "triage", nodeType: "triage", status: "ok", summary: "triage: x", latencyMs: 10 },
    { kind: "run_end", t: 2, outcome: "acted", totalCostUsd: 0.05, totalLatencyMs: 20 },
  ],
} as unknown as Trace);
const exec = (over: Partial<ExecutionRecord> = {}): ExecutionRecord => ({
  id: "child", caseId: "gen-1201", dataset: "generated", workflowId: "default-incident", status: "success", outcome: "acted",
  startedAt: "t", durationMs: 1, costUsd: 0.05, origin: "console", simulated: false, trace: trace("api-child"),
  answerMd: null, reasoningMd: null, eval: null, parentExecutionId: "parent", ...over,
});

describe("findExecutionId", () => {
  it("uses the replay's execution, else the review queue's link", async () => {
    const fetchJson = vi.fn(async () => ({ tasks: [{ id: "t1", runId: "r1", caseId: "c1", executionId: "ex-q" }] }));
    expect(await findExecutionId({ runId: "r1", caseId: "c1", replay: { executionId: "ex-r" } as never }, fetchJson)).toBe("ex-r");
    expect(fetchJson).not.toHaveBeenCalled();
    expect(await findExecutionId({ runId: "r1", caseId: "c1" }, fetchJson)).toBe("ex-q");
    expect(await findExecutionId({ runId: "zz", caseId: "c1", taskId: "t1" }, fetchJson)).toBe("ex-q");
    expect(await findExecutionId({ runId: "zz", caseId: "c1" }, fetchJson)).toBeNull();
    expect(await findExecutionId({ runId: "r1", caseId: "c1" }, async () => { throw new Error("down"); })).toBeNull();
  });
});

describe("rerunWithChoice", () => {
  const option = { id: "option-1", label: "Sign off redirect or hold" };
  it("does nothing for a card with no case run", async () => {
    const f = vi.fn();
    expect(await rerunWithChoice({ executionId: null, option, person: "Mina" }, f)).toEqual({ status: "none" });
    expect(f).not.toHaveBeenCalled();
  });
  it("sends one request with the decision and reports the plain result", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ execution: exec() })));
    const r = await rerunWithChoice({ executionId: "parent", option, person: "Mina" }, f);
    expect(r.status).toBe("done");
    if (r.status === "done") expect(r.result.text).toBe("Sent");
    expect(f).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(sent).toEqual({ parentExecutionId: "parent", humanDecision: { optionId: "option-1", label: option.label, by: "tap", who: "Mina" } });
    expect(rerunParents.has("parent")).toBe(true);
  });
  it("reports a failure as it came back and lets the poller replay it", async () => {
    const r = await rerunWithChoice({ executionId: "p-bad", option, person: "Mina" }, async () => new Response(JSON.stringify({ error: "agent API down" }), { status: 502 }));
    expect(r).toEqual({ status: "failed", reason: "Couldn't run it again: agent API down" });
    expect(rerunParents.has("p-bad")).toBe(false);
  });
});

describe("rerunFeed", () => {
  it("heads the replay with 'Re-run with your choice', on the same case line, labelled live", () => {
    const feed = rerunFeed(exec(), "RUN-001 · gen-1201");
    expect(feed[0].event).toMatchObject({ caseId: "RUN-001 · gen-1201", summary: "Re-run with your choice", source: "agent", runId: "api-child", origin: "console" });
    expect(feed[0].event.synthetic).toBeUndefined();
    expect(feed.every((t) => t.event.caseId === "RUN-001 · gen-1201")).toBe(true);
    expect(feed.slice(1).every((t) => t.atMs > 0)).toBe(true);
    expect(feed.at(-1)?.event.summary).toBe("Done: Sent");
  });
  it("labels a practice case and returns nothing without a trace", () => {
    expect(rerunFeed(exec({ simulated: true }), "x")[0].event.synthetic).toBe(true);
    expect(rerunFeed(exec({ trace: null }), "x")).toEqual([]);
  });
});

describe("console poller", () => {
  it("skips a re-run the toast replays itself", async () => {
    const rows: { id: string; status: string; parentExecutionId?: string }[] = [];
    const fetchJson: FetchJson = async (url) => url.includes("?limit")
      ? { executions: rows.map((r) => ({ ...r, caseId: "gen-1201", origin: "console", simulated: false, costUsd: 0, startedAt: "t" })) }
      : { execution: { ...exec({ id: url.split("/").pop()! }), trace: trace(`api-${url.split("/").pop()}`) } };
    const poller = new ExecutionPoller(fetchJson, new Set());
    await poller.poll();
    rerunParents.add("toast-parent");
    rows.push({ id: "mine", status: "success", parentExecutionId: "toast-parent" }, { id: "other", status: "success", parentExecutionId: "someone" });
    expect((await poller.poll()).map((e) => e.id)).toEqual(["other"]);
  });
});
