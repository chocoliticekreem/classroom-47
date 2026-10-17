import { describe, expect, it } from "vitest";
import {
  cents,
  plainCaseType,
  plainDataset,
  plainGate,
  plainNode,
  plainOutcome,
  plainStatus,
  plainStep,
  riskWord,
  scrubLeaks,
} from "./plain";

describe("plain glossary", () => {
  it("names steps", () => {
    expect(plainNode("safety_gate")).toBe("Safety check");
    expect(plainNode("human_decision")).toBe("Ask a person");
    expect(plainNode("case_log")).toBe("Done");
    expect(plainNode("some_new_step")).toBe("Some new step");
    expect(plainNode(null)).toBe("Step");
  });
  it("names outcomes and gates", () => {
    expect(plainOutcome("acted")).toBe("Sent");
    expect(plainOutcome("escalated")).toBe("Needs a person");
    expect(plainOutcome("asked_for_info")).toBe("Asked a question");
    expect(plainOutcome("no_action")).toBe("Nothing to do");
    expect(plainOutcome("blocked")).toBe("Stopped");
    expect(plainOutcome(null)).toBe("Not finished");
    expect(plainGate("allow")).toBe("OK");
    expect(plainGate("ask")).toBe("Ask a person");
    expect(plainGate("block")).toBe("Stop");
  });
  it("turns risk into a word", () => {
    expect(riskWord(0.1)).toBe("low");
    expect(riskWord(0.62)).toBe("medium");
    expect(riskWord(0.8)).toBe("high");
    expect(riskWord(null)).toBe("");
  });
  it("formats cents", () => {
    expect(cents(0.0781)).toBe("8¢");
    expect(cents(0.002)).toBe("<1¢");
    expect(cents(0)).toBe("0¢");
    expect(cents(1.236)).toBe("$1.24");
    expect(cents(null)).toBe("");
  });
  it("names case types, datasets and statuses", () => {
    expect(plainCaseType("lost_or_misdelivered")).toBe("Lost or wrong address");
    expect(plainCaseType("cold_chain")).toBe("Chilled or frozen goods");
    expect(plainDataset("city")).toBe("City cases");
    expect(plainStatus("running")).toBe("Working on it");
  });
});


describe("plainStep (real backend summaries)", () => {
  it("ingest and history", () => {
    expect(plainStep("ingest", "1 files, 0 attachments read")).toBe("Read the messages");
    expect(plainStep("ingest", "ingest: 1 files, 0 attachments read")).toBe("Read the messages");
    expect(plainStep("history_lookup", "0 open commitments, 0 deadlines")).toBe("Checked past orders");
    expect(plainStep("history_lookup", "2 open commitments, 1 deadlines")).toBe("Found 2 open promises");
  });
  it("triage", () => {
    expect(plainStep("triage", "triage: missed_or_failed_delivery · medium")).toBe("Problem: missed delivery");
    expect(plainStep("triage", "x", { type: "triage", caseType: "cold_chain", urgency: "high", p: 1 })).toBe(
      "Problem: chilled or frozen goods",
    );
  });
  it("hides skipped second opinions", () => {
    expect(plainStep("perspectives", "perspectives: skipped: no Jev key")).toBeNull();
    expect(plainStep("perspectives", "skipped: timeout")).toBeNull();
    expect(plainStep("perspectives", "3 flags raised")).toBe("Got second opinions");
    expect(plainStep("perspectives", "2 flags raised · needs a human")).toBe("Second opinions: ask a person");
  });
  it("clash check", () => {
    expect(plainStep("clash_check", "no conflict")).toBe("The stories match");
    expect(plainStep("clash_check", "sources may conflict")).toBe("The stories may not match");
    expect(plainStep("clash_check", "1 conflict: driver says delivered, customer says not")).toBe(
      "The stories don't match: driver says delivered, customer says not",
    );
  });
  it("planner never shows the reasoning", () => {
    const why = "act: Plover Arc Logistics owns the route review and must confirm by 3pm";
    expect(plainStep("planner", why)).toBe("Plan: send a message");
    expect(
      plainStep("planner", why, { type: "planner", nextAction: { recipient: "Plover Arc Logistics", channel: "email", message: "…", undoable: true } }),
    ).toBe("Plan: send a message to Plover Arc Logistics");
    expect(plainStep("planner", "ask_for_info: the address is unclear")).toBe("Plan: ask a question");
    expect(plainStep("planner", "escalate_to_human: refund above limit")).toBe("Plan: ask a person");
    expect(plainStep("planner", "wait_no_action: already resolved")).toBe("Plan: nothing to do");
  });
  it("safety check", () => {
    expect(plainStep("gate", "gate: 2 of 2 messages cleared")).toBe("Safety check passed");
    expect(plainStep("safety_gate", "1 of 2 messages cleared")).toBe("Safety check: 1 held for a person");
    expect(plainStep("safety_gate", "0 of 1 messages cleared", { type: "safety_gate", decision: "block", risk: 0.9 })).toBe(
      "Safety check stopped it",
    );
    expect(plainStep("safety_gate", "nothing to send")).toBe("Safety check: nothing to send");
  });
  it("action, verify, log, human", () => {
    expect(plainStep("action", "1 of 1 message(s) accepted by the outbox")).toBe("Message sent");
    expect(plainStep("action", "2 of 2 message(s) accepted by the outbox")).toBe("2 messages sent");
    expect(plainStep("verify", "verify: accepted by the outbox; receipt and reply unverified")).toBe("Sent, waiting for a reply");
    expect(plainStep("verify", "1 message(s) not delivered")).toBe("1 message not delivered");
    expect(plainStep("log", "outcome: escalated")).toBeNull();
    expect(plainStep("case_log", "outcome: acted")).toBeNull();
    expect(plainStep("human_decision", "Card for Ops lead; no human available, fallback logged")).toBe("A person needs to decide");
    expect(plainStep("human_decision", "Answered by Sam (voice): Approve the refund")).toBe("A person chose: Approve the refund");
    expect(plainStep("planner", "failed: model timeout")).toBe("Plan the reply: didn't finish");
  });
});

describe("scrubLeaks", () => {
  it("strips model, runner and internal words", () => {
    expect(scrubLeaks("accepted by the outbox; receipt and reply unverified")).toBe("accepted; receipt and reply unverified");
    expect(scrubLeaks("skipped: no Jev key")).toBe("skipped");
    expect(scrubLeaks("Claude-sonnet-4 wrote the reply")).toBe("wrote the reply");
    expect(scrubLeaks("see trace run_end in config")).toBe("see");
    expect(scrubLeaks("missed_or_failed_delivery")).toBe("missed or failed delivery");
    expect(scrubLeaks('risk {"allow_below":0.3}')).toBe("risk");
    expect(scrubLeaks(null)).toBe("");
  });
});
