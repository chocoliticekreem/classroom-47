import { describe, expect, it, vi } from "vitest";
import {
  caseRunHref, decisionRerunBody, EXECUTE_URL, postDecisionRerun, RERUN_IDLE, RerunRefused, rerunReducer, rerunResult, sentLine,
  type RerunState,
} from "./decisionRerun";
import type { ExecutionRecord, OutboxEntry } from "./types";

const option = { id: "option-1", label: "Sign off redirect or hold" };
const row = (recipient: string, channel: string, status: OutboxEntry["status"] = "recorded"): OutboxEntry => ({
  action: { recipient, channel, kind: "request_to_owner", purpose: "p", message: "m" }, status, note: "",
});
const exec = (over: Partial<ExecutionRecord> = {}): ExecutionRecord => ({
  id: "child-1", caseId: "gen-1201", dataset: "generated", workflowId: "default-incident", status: "success", outcome: "acted",
  startedAt: "2026-10-10T12:00:00Z", durationMs: 1, costUsd: 0.05, origin: "console", simulated: false, trace: null,
  answerMd: null, reasoningMd: null, eval: null, outbox: null, ...over,
});

describe("decisionRerunBody", () => {
  it("carries the choice only as a trusted humanDecision, linked to the parent run", () => {
    expect(decisionRerunBody({ parentExecutionId: "p-1", option, person: "  Mina Okafor ", caseId: "gen-1201", dataset: "generated", workflowId: "default-incident" }))
      .toEqual({
        parentExecutionId: "p-1", caseId: "gen-1201", dataset: "generated", workflowId: "default-incident",
        humanDecision: { optionId: "option-1", label: "Sign off redirect or hold", by: "tap", who: "Mina Okafor" },
      });
  });
  it("leaves out case fields it doesn't know (the console takes them from the parent)", () => {
    expect(decisionRerunBody({ parentExecutionId: "p-1", option, person: "Mina" })).toEqual({
      parentExecutionId: "p-1", humanDecision: { optionId: "option-1", label: option.label, by: "tap", who: "Mina" },
    });
  });
  it("refuses plainly when the parent, option or name is missing", () => {
    expect(() => decisionRerunBody({ parentExecutionId: "", option, person: "Mina" })).toThrow("There is no case run to repeat.");
    expect(() => decisionRerunBody({ parentExecutionId: "p", option: null, person: "Mina" })).toThrow("Pick one of the choices.");
    expect(() => decisionRerunBody({ parentExecutionId: "p", option, person: "   " })).toThrow("Add your name.");
  });
  it("caps the name at 120 characters", () => {
    expect(decisionRerunBody({ parentExecutionId: "p", option, person: "x".repeat(200) }).humanDecision.who).toHaveLength(120);
  });
});

describe("postDecisionRerun", () => {
  const body = decisionRerunBody({ parentExecutionId: "p-1", option, person: "Mina" });
  it("POSTs once to the console execute endpoint and returns the new run", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ execution: exec() }), { status: 200 }));
    const ex = await postDecisionRerun(body, f);
    expect(ex.id).toBe("child-1");
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(EXECUTE_URL);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual(body);
  });
  it("a refused request is RerunRefused with the server's reason (scrubbed)", async () => {
    const f = async () => new Response(JSON.stringify({ error: 'Unknown parent execution "p-1"' }), { status: 404 });
    const err = await postDecisionRerun(body, f).catch((e) => e);
    expect(err).toBeInstanceOf(RerunRefused);
    expect(err.message).toBe('Couldn\'t run it again: Unknown parent execution "p-1"');
  });
  it("a dropped connection is a plain Error (not safe to retry blindly)", async () => {
    const err = await postDecisionRerun(body, async () => { throw new TypeError("fetch failed"); }).catch((e) => e);
    expect(err).not.toBeInstanceOf(RerunRefused);
    expect(err.message).toMatch(/Check Case runs/);
  });
});

describe("rerunResult", () => {
  it("says what was sent, in plain words", () => {
    const outbox = [row("Plover Arc Logistics exception desk", "Email"), row("Calla Mossop", "Customer portal"), row("Held, x", "Email", "held_for_human")];
    expect(sentLine(outbox)).toBe("emailed Plover Arc Logistics exception desk and messaged Calla Mossop");
    expect(rerunResult(exec({ outbox }))).toEqual({ tone: "ok", text: "Sent: emailed Plover Arc Logistics exception desk and messaged Calla Mossop" });
  });
  it("still needs a person, nothing sent, stopped, failed", () => {
    expect(rerunResult(exec({ outcome: "escalated" }))).toEqual({ tone: "warn", text: "Still needs a person" });
    expect(rerunResult(exec({ outcome: "no_action" })).text).toBe("Nothing new to send");
    expect(rerunResult(exec({ outcome: "blocked" })).text).toMatch(/^Stopped/);
    expect(rerunResult(exec({ status: "error", outcome: null, error: "agent API answered 500" }))).toEqual({ tone: "err", text: "It didn't finish. Nothing new was sent." });
  });
  it("links to the run in Case runs", () => {
    expect(caseRunHref("a b")).toBe("/?tab=executions&id=a%20b");
  });
});

describe("rerunReducer (send once)", () => {
  const run = (s: RerunState, ...a: Parameters<typeof rerunReducer>[1][]) => a.reduce(rerunReducer, s);
  it("idle -> confirm -> running -> done", () => {
    const s = run(RERUN_IDLE, { type: "pick", option }, { type: "start" }, { type: "succeed", execution: exec() });
    expect(s.phase).toBe("done");
    if (s.phase === "done") expect(s.result.text).toBe("Sent");
  });
  it("cancel goes back to idle; picking again replaces the option", () => {
    expect(run(RERUN_IDLE, { type: "pick", option }, { type: "cancel" })).toBe(RERUN_IDLE);
    const s = run(RERUN_IDLE, { type: "pick", option }, { type: "pick", option: { id: "option-2", label: "Send nothing" } });
    expect(s).toEqual({ phase: "confirm", option: { id: "option-2", label: "Send nothing" } });
  });
  it("the desk starts straight from idle with an option, never without one", () => {
    expect(run(RERUN_IDLE, { type: "start" })).toBe(RERUN_IDLE);
    expect(run(RERUN_IDLE, { type: "start", option })).toEqual({ phase: "running", option });
  });
  it("nothing moves while running; a finished run is final", () => {
    const running: RerunState = { phase: "running", option };
    expect(run(running, { type: "start" }, { type: "pick", option }, { type: "cancel" })).toBe(running);
    const done = run(running, { type: "succeed", execution: exec() });
    expect(run(done, { type: "start" }, { type: "pick", option }, { type: "fail", message: "x", canRetry: true })).toBe(done);
  });
  it("only a refused request can be tried again", () => {
    const refused = run({ phase: "running", option }, { type: "fail", message: "no", canRetry: true });
    expect(run(refused, { type: "start" }).phase).toBe("running");
    const lost = run({ phase: "running", option }, { type: "fail", message: "lost", canRetry: false });
    expect(run(lost, { type: "start" })).toBe(lost);
  });
});
