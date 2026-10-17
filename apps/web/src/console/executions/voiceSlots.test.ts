import { describe, expect, it } from "vitest";
import type { ExecutionRecord, OutboxEntry } from "../types";
import { approvalRerun, callableRows, callRequest, callRerun, callStateSeed, cardOpen, noAnswerRerun, noCallLine, noteCaseText, noteRerun, partyRole, voiceNeeded, childRun, driverCallMessage, driverCallRequest, driverCallState } from "./voiceSlots";


const row = (channel: string): OutboxEntry => ({ action: { recipient: "Ms Patel", channel, kind: "k", purpose: "Agree a slot", message: "Hello" }, status: "held_for_human", note: "" });
const ex = { id: "e1", caseId: "delivery-003", dataset: "public", workflowId: "default-incident", title: "Case 003" } as ExecutionRecord & { title: string };
const card = { routeTo: "Desk manager", summary: "", tried: [], options: [{ id: "option-1", label: "A", undoable: true }], wouldChangeMyMind: "", deadlineMins: 10, fallback: "" };

describe("voice slots", () => {
  it("offers a call only on call or phone channels", () => {
    expect(callableRows([row("Email"), row("Phone call"), row("Call"), row("SMS")]).map((r) => r.action.channel)).toEqual(["Phone call", "Call"]);
    expect(callableRows(null)).toEqual([]);
  });
  it("gives a voice note the run's own messages, so a pasted case still guides transcription", () => {
    const run = { ...ex, trace: { events: [{ kind: "run_start", inputs: [
      { n: 1, channel: "Driver chat", from: "Fen Orlo, route driver", excerpt: "I am at 7 Sedgeglass Mews for DL-003." },
      { n: 2, channel: "Dispatch chat", from: "Dispatch", excerpt: "Contact Elva Kesh." },
    ] }] } } as unknown as ExecutionRecord;
    expect(noteCaseText(run)).toBe("From: Fen Orlo, route driver\nI am at 7 Sedgeglass Mews for DL-003.\n\nFrom: Dispatch\nContact Elva Kesh.");
    expect(noteCaseText(ex)).toBe("");
  });
  it("finds the re-run a voice moment just started, so the page can open it while it works", () => {
    const since = Date.parse("2026-10-10T14:26:40Z");
    const runs = [
      { id: "old", parentExecutionId: "p1", startedAt: "2026-10-10T14:20:00Z" },
      { id: "other", parentExecutionId: "p2", startedAt: "2026-10-10T14:26:41Z" },
      { id: "new", parentExecutionId: "p1", startedAt: "2026-10-10T14:26:41Z" },
    ] as unknown as ExecutionRecord[];
    expect(childRun(runs, "p1", since)?.id).toBe("new");
    expect(childRun(runs, "p3", since)).toBeUndefined();
    expect(childRun(runs, undefined, since)).toBeUndefined();
  });
  it("says who a person is, from the case's own messages", () => {
    const run = { ...ex, trace: { events: [{ kind: "run_start", inputs: [
      { n: 1, channel: "Driver chat", from: "Fen Orlo, route driver", excerpt: "I am at 7 Sedgeglass Mews for DL-003." },
      { n: 2, channel: "Dispatch chat", from: "Dispatch, Plover Arc Logistics", excerpt: "Please contact recipient Elva Kesh on the verified callback route." },
    ] }] } } as unknown as ExecutionRecord;
    expect(partyRole("Fen Orlo", run)).toBe("route driver");
    expect(partyRole("Elva Kesh", run)).toBe("recipient");
    expect(partyRole("Nobody Here", run)).toBe("");
    expect(partyRole("Elva Kesh", ex)).toBe("");
  });
  it("finds the role on a pasted case, where the run keeps only the title and the agent's claims", () => {
    const pasted = { ...ex, trace: { events: [
      { kind: "run_start", title: "Please contact recipient Elva Kesh on the verified order callback route.", inputs: [{ n: 1, channel: "Document", from: "history", excerpt: "573 characters" }] },
      { kind: "node_end", node: "clash", output: { type: "clash_check", clash: false, p: 0.1, claims: [{ who: "Fen Orlo, route driver", says: "Gate shut." }] } },
    ] } } as unknown as ExecutionRecord;
    expect(partyRole("Elva Kesh", pasted)).toBe("recipient");
    expect(partyRole("Fen Orlo", pasted)).toBe("route driver");
  });
  it("gives a call on a pasted case the names it needs, so the safety check knows who is on the line", () => {
    const pasted = { ...ex, outbox: [{ ...row("Phone call"), action: { ...row("Phone call").action, recipient: "Elva Kesh", message: "Hello Elva, about DL-003 at 7 Sedgeglass Mews." } }],
      trace: { events: [
        { kind: "run_start", title: "Please contact recipient Elva Kesh on the verified order callback route.", inputs: [{ n: 1, channel: "Document", from: "history", excerpt: "573 characters" }] },
        { kind: "node_end", output: { type: "clash_check", clash: false, p: 0.1, claims: [{ who: "Fen Orlo", says: "Pedestrian gate shut at 7 Sedgeglass Mews." }] } },
      ] } } as unknown as ExecutionRecord;
    const text = callStateSeed(pasted, "Elva Kesh", false).caseText;
    expect(text).toContain("recipient Elva Kesh");
    expect(text).toContain("Fen Orlo: Pedestrian gate shut");
    expect(text).toContain("To Elva Kesh (Phone call): Hello Elva, about DL-003");
    expect(text).not.toContain("573 characters");
  });
  it("says plainly why there is no call", () => {
    expect(noCallLine([{ ...row("Dispatch chat"), action: { ...row("Dispatch chat").action, recipient: "Dispatch, Plover Arc Logistics" } }]))
      .toBe("No call needed on this run: the agent chose Dispatch chat to Dispatch, Plover Arc Logistics.");
    expect(noCallLine([])).toBe("No call needed on this run: the agent sent nothing.");
    expect(noCallLine(null)).toBe("No call needed on this run: the agent sent nothing.");
  });
  it("treats a callback route as a phone channel", () => {
    expect(callableRows([row("Verified order callback route"), row("Callback"), row("Email")]).map((r) => r.action.channel))
      .toEqual(["Verified order callback route", "Callback"]);
  });
  it("only an undecided card with options is open", () => {
    expect(cardOpen(card)).toBe(true);
    expect(cardOpen({ ...card, chosen: "option-1" })).toBe(false);
    expect(cardOpen(null)).toBe(false);
  });
  it("builds execute bodies that link back to the parent", () => {
    const note = { n: 0, timestamp: "", stage: null, channel: "Voice note", from: "Driver", to: "Desk", body: "b", source: "live_human" as const };
    expect(noteRerun(ex, note)).toMatchObject({ parentExecutionId: "e1", extraEvents: [note], voice: { trigger: "note" } });
    const d = { optionId: "option-1", label: "A", by: "voice" as const, who: "Desk manager" };
    expect(approvalRerun(ex, d)).toMatchObject({ parentExecutionId: "e1", humanDecision: d, voice: { trigger: "approval" } });
    expect(callRerun(ex, { events: [note], callId: "c1" })).toMatchObject({ voice: { trigger: "call", callId: "c1" } });
    expect(callRerun(ex, { events: [], decision: d }).voice?.trigger).toBe("approval");
  });
  it("turns a call nobody took into a re-run with one no-answer event", () => {
    const body = noAnswerRerun(ex, row("Phone call"));
    expect(body).toEqual({
      caseId: "delivery-003", dataset: "public", workflowId: "default-incident", parentExecutionId: "e1",
      extraEvents: [{ n: 0, timestamp: "", stage: null, channel: "Call", from: "Desk (voice agent)", to: "Ms Patel", body: "Called Ms Patel about Agree a slot: no answer.", source: "live_human" }],
      voice: { trigger: "call" },
    });
  });
  it("shows voice only when the run has a call or an open decision", () => {
    expect(voiceNeeded({ ...ex, outbox: [row("Email")] } as ExecutionRecord, null)).toBe(false);
    expect(voiceNeeded({ ...ex, outbox: [row("Phone call")] } as ExecutionRecord, null)).toBe(true);
    expect(voiceNeeded({ ...ex, outbox: [] } as ExecutionRecord, card)).toBe(true);
    expect(voiceNeeded({ ...ex, outbox: [] } as ExecutionRecord, { ...card, chosen: "option-1" })).toBe(false);
  });
  it("keeps the call brief within 600 characters", () => {
    const r = callRequest(ex, { ...row("Call"), action: { ...row("Call").action, message: "x".repeat(900) } });
    expect(r.brief.length).toBe(600);
    expect(r).toMatchObject({ purpose: "call", calleeName: "Ms Patel", goal: "Agree a slot", mode: "demo" });
  });
});

describe("driver call from New case", () => {
  const ev = (from: string, to: string, body: string) => ({ n: 1, timestamp: "", stage: null, channel: "Call transcript", from, to, body });
  it("keeps only what the desk and the driver said, in order", () => {
    const m = driverCallMessage([
      ev("Desk (voice agent)", "Tom", "Hi, is this Tom?"),
      ev("Tom", "Desk", "Yes. The road's closed, I can't get the van in."),
      ev("Tom (driver)", "Desk", "Said on the call (blocker): road closed"),
      ev("Desk (voice agent)", "Desk supervisor", "A person is needed: off track"),
    ], "Tom");
    expect(m?.from).toBe("Tom (driver)");
    expect(m?.body).toBe("Desk: Hi, is this Tom?\nTom: Yes. The road's closed, I can't get the van in.");
  });
  it("gives nothing for a call where nobody spoke", () => {
    expect(driverCallMessage([], "Tom")).toBeNull();
  });
  it("asks the agent about the blocker, the parcel and what the driver can do, with no case details", () => {
    const r = driverCallRequest("Tom");
    expect(r.purpose).toBe("call");
    expect(r.questions).toHaveLength(3);
    expect(driverCallState("Tom").caseText).toBe("");
  });
});
