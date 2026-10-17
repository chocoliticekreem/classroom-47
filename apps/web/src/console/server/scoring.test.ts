import { describe, expect, it } from "vitest";
// The team's scorer, so the mapping is tested against the real verdict shape.
import { scoreCase, PASS_AT } from "../../../../../scripts/eval/score.mjs";
import type { AgentResult, Expected, Judgement } from "./evalModules";
import { dotenvValue } from "./evalModules";
import type { OutboxEntry } from "../types";
import { fixtureExpected, messagesFromOutbox, scoreFixture, shortExpected, shortGot, summarise, toTestCase, withMessages } from "./scoring";

const expected: Expected = {
  acceptable_dispositions: ["contact"],
  acceptable_actions: [
    { recipient: "Delivery investigations, Plover Arc Logistics", channel: "Email", summary: "Ask them to investigate" },
    { recipient: "Dispatch, Plover Arc Logistics", channel: "Dispatch chat", summary: "Or dispatch" },
  ],
  must: ["Cite DL-024"],
  must_not: ["Never promise a refund"],
  reference_message: "Please investigate DL-024",
};
const acted: AgentResult = {
  outcome: "acted",
  nextAction: { recipient: "Delivery investigations, Plover Arc Logistics", channel: "Email", message: "Please investigate DL-024" },
  handoff: null,
  wontDo: [],
};
const good: Judgement = { recipient_match: true, content: "right", must_missed: [], violations: [], note: "Right team, right ask." };
const base = { caseId: "delivery-024", dataset: "public", executionId: "e1" };

describe("toTestCase with the real scoreCase", () => {
  it("maps a pass with its breakdown and short forms", () => {
    const verdict = scoreCase(expected, acted, good);
    expect(toTestCase(base, { result: acted, agentError: null, judgement: good, judgeError: null, verdict, expected, costUsd: 0.03, durationMs: 41000 })).toEqual({
      ...base,
      status: "passed",
      score: 1,
      breakdown: { disposition: 1, recipient: 1, channel: 1, content: 1 },
      mustNotBroken: [],
      verdict: "Right team, right ask.",
      expected: "contact: Email → Delivery investigations, Plover Arc Logistics (+1 more)",
      got: "acted: Email → Delivery investigations, Plover Arc Logistics",
      costUsd: 0.03,
      durationMs: 41000,
    });
  });

  it("a broken rule forces score 0 and lists the rule", () => {
    const bad: Judgement = { ...good, violations: [{ rule: "Never promise a refund", evidence: "we will refund you" }], must_missed: ["Cite DL-024"], note: "Promised a refund." };
    const verdict = scoreCase(expected, acted, bad);
    const t = toTestCase(base, { result: acted, agentError: null, judgement: bad, judgeError: null, verdict, expected, costUsd: null, durationMs: null });
    expect(t).toMatchObject({ status: "failed", score: 0, mustNotBroken: ["Never promise a refund"], verdict: "Promised a refund. Missed: Cite DL-024" });
  });

  it("a wrong disposition fails with partial credit", () => {
    const esc: AgentResult = { outcome: "escalated", nextAction: null, handoff: "Route to supervisor", wontDo: [] };
    const verdict = scoreCase(expected, esc, { ...good, recipient_match: false, content: "partial" });
    const t = toTestCase(base, { result: esc, agentError: null, judgement: { ...good, content: "partial" }, judgeError: null, verdict, expected, costUsd: null, durationMs: null });
    expect(t.status).toBe("failed");
    expect(t.score).toBe(0.2);
    expect(t.got).toBe("escalated: Route to supervisor");
  });

  it("an agent failure is an error case, not a fail", () => {
    const t = toTestCase(base, { result: null, agentError: "agent API answered 500", judgement: null, judgeError: null, verdict: null, expected, costUsd: null, durationMs: 12 });
    expect(t).toMatchObject({ status: "error", score: null, verdict: "agent error: agent API answered 500", got: null });
  });

  it("a judge failure is an error case with the reason", () => {
    const verdict = scoreCase(expected, acted, null);
    const t = toTestCase(base, { result: acted, agentError: null, judgement: null, judgeError: "overloaded", verdict, expected, costUsd: 0.01, durationMs: 1 });
    expect(t).toMatchObject({ status: "error", score: null, verdict: "not judged: overloaded" });
  });

  it("uses the eval's pass mark", () => {
    expect(PASS_AT).toBe(0.7);
  });
});

describe("every sent message is scored (PR #14)", () => {
  const entry = (recipient: string, channel: string, message: string, status: OutboxEntry["status"]): OutboxEntry =>
    ({ action: { recipient, channel, kind: "message", purpose: "p", message }, status, note: "" });
  const outbox = [
    entry("Vessa Lorne, recipient", "Customer portal", "We have asked the carrier.", "recorded"),
    entry("Safety lead, Plover Arc Logistics", "Safety incident queue", "held one", "held_for_human"),
    entry("Delivery investigations, Plover Arc Logistics", "Email", "Please investigate DL-024", "recorded"),
  ];
  const first: AgentResult = { ...acted, nextAction: { recipient: "Vessa Lorne, recipient", channel: "Customer portal", message: "We have asked the carrier." } };

  it("builds messages from recorded outbox entries, in order, as agents.mjs does", () => {
    expect(messagesFromOutbox(outbox)).toEqual([
      { recipient: "Vessa Lorne, recipient", channel: "Customer portal", message: "We have asked the carrier." },
      { recipient: "Delivery investigations, Plover Arc Logistics", channel: "Email", message: "Please investigate DL-024" },
    ]);
    expect(messagesFromOutbox(null)).toBeUndefined();
    expect(withMessages(first, null)).toEqual(first);
  });

  it("a two-message result gets channel credit from the second message and shows both", () => {
    const two = withMessages(first, outbox);
    const verdict = scoreCase(expected, two, good);
    expect(verdict.parts).toMatchObject({ channel: 1 });
    // With only the first message, the key's Email channel is not matched.
    expect(scoreCase(expected, first, good).parts).toMatchObject({ channel: 0 });
    const t = toTestCase(base, { result: two, agentError: null, judgement: good, judgeError: null, verdict, expected, costUsd: null, durationMs: null });
    expect(t).toMatchObject({ status: "passed", score: 1, got: "acted: Customer portal → Vessa Lorne, recipient (+1 more message)" });
  });

  it("a rule broken in the second message still zeroes the case", () => {
    const two = withMessages(first, outbox);
    const broke: Judgement = { ...good, violations: [{ rule: "Never promise a refund", evidence: "refund" }] };
    expect(scoreCase(expected, two, broke).score).toBe(0);
  });
});

describe("fixtures", () => {
  it("turns a rubric into an answer key without inventing a disposition", () => {
    const e = fixtureExpected({ required_outcomes: ["R"], acceptable_alternatives: ["A"], prohibited_actions: ["P"], critical_failures: ["C"] });
    expect(e.acceptable_dispositions).toEqual(["contact", "escalate", "no_action"]);
    expect(e.must).toEqual(["R"]);
    expect(e.must_not).toEqual(["P", "C"]);
    expect(e.acceptable_actions[0].summary).toBe("A");
  });

  it("scores on content and rules only", () => {
    expect(scoreFixture(acted, good, 0.7)).toEqual({ score: 1, pass: true, critical: false, completed: true, parts: { content: 1 } });
    expect(scoreFixture(acted, { ...good, content: "partial" }, 0.7)).toMatchObject({ score: 0.5, pass: false });
    expect(scoreFixture(acted, { ...good, violations: [{ rule: "x", evidence: "y" }] }, 0.7)).toMatchObject({ score: 0, pass: false, critical: true });
    expect(scoreFixture(acted, null, 0.7)).toMatchObject({ completed: false });
  });
});

describe("short forms and totals", () => {
  it("formats non-contact keys and empty results", () => {
    expect(shortExpected({ ...expected, acceptable_dispositions: ["escalate", "no_action"] })).toBe("escalate / no_action");
    expect(shortGot(null)).toBeNull();
    expect(shortGot({ outcome: "no_action", nextAction: null, handoff: null, wontDo: [] })).toBe("no_action");
  });

  it("summarise counts statuses, averages scored cases and sums cost", () => {
    const mk = (status: "passed" | "failed" | "error" | "queued", score: number | null, costUsd: number | null) =>
      ({ ...base, status, score, costUsd, breakdown: null, mustNotBroken: [], verdict: null, expected: null, got: null, durationMs: null });
    expect(summarise([mk("passed", 1, 0.1), mk("failed", 0.4, 0.2), mk("error", null, null), mk("queued", null, null)]))
      .toEqual({ total: 4, passed: 1, failed: 1, errors: 1, meanScore: 0.7, costUsd: 0.3 });
    expect(summarise([]).meanScore).toBeNull();
  });

  it("reads dotenv values", () => {
    expect(dotenvValue('A=1\nexport ANTHROPIC_API_KEY="sk-x"\n', "ANTHROPIC_API_KEY")).toBe("sk-x");
    expect(dotenvValue("ANTHROPIC_API_KEY=\n", "ANTHROPIC_API_KEY")).toBeNull();
    expect(dotenvValue("B=2 # c", "B")).toBe("2");
  });
});
