import { describe, expect, it } from "vitest";
import { countdown, doneLine, headline, unknowns } from "./HumanDesk";

const at = Date.parse("2026-10-10T12:00:00Z");
const deadlineIn = (ms: number) => new Date(at + ms).toISOString();

describe("countdown", () => {
  it("ticks in minutes and seconds under an hour", () => {
    expect(countdown({ status: "pending", deadlineAt: deadlineIn(12 * 60_000 + 4_000) }, at)).toEqual({ text: "12:04 left", tone: "ok" });
    expect(countdown({ status: "pending", deadlineAt: deadlineIn(90_000) }, at)).toEqual({ text: "1:30 left", tone: "soon" });
  });
  it("shows hours, lateness and decided cases", () => {
    expect(countdown({ status: "pending", deadlineAt: deadlineIn(65 * 60_000) }, at).text).toBe("1 h 5 min left");
    expect(countdown({ status: "pending", deadlineAt: deadlineIn(-3 * 60_000) }, at)).toEqual({ text: "3 min late", tone: "late" });
    expect(countdown({ status: "decision_recorded", deadlineAt: deadlineIn(0) }, at)).toEqual({ text: "Decided", tone: "done" });
    expect(countdown({ status: "resolved", deadlineAt: deadlineIn(0) }, at).text).toBe("Done in the city");
  });
});

describe("handover words", () => {
  it("names a case by its summary when the title is only an id", () => {
    expect(headline({ title: "Case: Parcel left in the rain", caseId: "gen-1", summary: "", mustDecide: "" })).toBe("Parcel left in the rain");
    expect(headline({ title: "city-inc-1-inc-smoke", caseId: "city-inc-1-inc-smoke", summary: "Van V-14 may have crashed on King St. More text.", mustDecide: "" })).toBe("Van V-14 may have crashed on King St.");
  });
  it("turns recorded messages into a plain done line", () => {
    expect(doneLine("Message recorded for Calla Mossop via Customer portal: Acknowledge the loss.")).toEqual({ main: "Messaged Calla Mossop (Customer portal)", why: "Acknowledge the loss." });
    expect(doneLine("Requested the carrier's evidence")).toEqual({ main: "Requested the carrier's evidence", why: "" });
  });
  it("lists the clash, unchecked claims and what would settle it", () => {
    const lines = unknowns({
      clash: "The feed says V-14 crashed; the driver says it is stuck behind it.",
      evidence: [{ who: "Driver", says: "Stuck behind a crash", basis: "unverified_claim" }, { who: "Feed", says: "Crash on King St", basis: "system_record" }],
      wouldChangeMyMind: "The driver confirming nobody is hurt.",
    });
    expect(lines).toEqual([
      "The stories don't match. The feed says V-14 crashed; the driver says it is stuck behind it.",
      'Driver says: "Stuck behind a crash" Not checked yet.',
      "What would settle it: the driver confirming nobody is hurt.",
    ]);
  });
});
