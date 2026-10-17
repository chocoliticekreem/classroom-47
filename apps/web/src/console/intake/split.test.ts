import { describe, expect, it } from "vitest";
import { parseDate, splitThread } from "./split";

describe("parseDate", () => {
  it("reads common email date forms as UTC ISO", () => {
    expect(parseDate("2026-02-25 09:00 UTC")).toBe("2026-02-25T09:00:00.000Z");
    expect(parseDate("2026-02-25 09:00")).toBe("2026-02-25T09:00:00.000Z");
    expect(parseDate("Tue, 25 Feb 2026 09:10:00 +0000")).toBe("2026-02-25T09:10:00.000Z");
    expect(parseDate("Wed, 25 Feb 2026 at 09:10")).toBe("2026-02-25T09:10:00.000Z");
    expect(parseDate("2026-02-25T09:00:00+01:00")).toBe("2026-02-25T08:00:00.000Z");
  });
  it("returns null for anything else", () => {
    expect(parseDate("yesterday morning")).toBeNull();
    expect(parseDate("")).toBeNull();
    expect(parseDate(null)).toBeNull();
  });
});

describe("splitThread", () => {
  it("keeps text with no headers as one message", () => {
    const m = splitThread("Hi, my parcel never came.\n\nThanks, Ana");
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ channel: "Email", from: null, to: null, subject: null, date: null, body: "Hi, my parcel never came.\n\nThanks, Ana" });
  });

  it("splits header blocks and sorts them by date", () => {
    const text = [
      "From: Sorin Vaal <sorin@example.com>",
      "To: Rivet Delivery Desk",
      "Date: 2026-02-25 09:10 UTC",
      "Subject: Re: DL-024",
      "",
      "Still nothing here.",
      "",
      "From: Tracking support",
      "To: Rivet Delivery Desk",
      "Date: 2026-02-25 09:00 UTC",
      "Subject: DL-024",
      "",
      "DL-024 shows delivered.",
    ].join("\n");
    const m = splitThread(text);
    expect(m.map((x) => x.body)).toEqual(["DL-024 shows delivered.", "Still nothing here."]);
    expect(m[0]).toMatchObject({ from: "Tracking support", subject: "DL-024", date: "2026-02-25T09:00:00.000Z" });
    expect(m[1].from).toBe("Sorin Vaal <sorin@example.com>");
  });

  it("keeps paste order for undated header blocks and reads a Channel header", () => {
    const m = splitThread("From: Driver\nChannel: Driver chat\n\nGate is shut.\n\nFrom: Dispatch\n\nCall the recipient.");
    expect(m.map((x) => [x.from, x.channel, x.body])).toEqual([
      ["Driver", "Driver chat", "Gate is shut."],
      ["Dispatch", "Email", "Call the recipient."],
    ]);
  });

  it("turns nested quoted replies into older messages, oldest first", () => {
    const text = [
      "Any news? It is urgent.",
      "",
      "On Wed, 25 Feb 2026 at 09:20, Hamyway Desk <desk@rivet.example> wrote:",
      "> We are checking with the carrier.",
      ">",
      "> On Wed, 25 Feb 2026 at 09:10, Sorin Vaal wrote:",
      ">> No one in my household has the parcel.",
    ].join("\n");
    const m = splitThread(text);
    expect(m.map((x) => x.body)).toEqual(["No one in my household has the parcel.", "We are checking with the carrier.", "Any news? It is urgent."]);
    expect(m[0]).toMatchObject({ from: "Sorin Vaal", date: "2026-02-25T09:10:00.000Z" });
    expect(m[1]).toMatchObject({ from: "Hamyway Desk", date: "2026-02-25T09:20:00.000Z" });
    expect(m[2].from).toBeNull();
  });

  it("splits on an Original Message separator (Outlook style)", () => {
    const text = [
      "Please escalate.",
      "",
      "-----Original Message-----",
      "From: Depot 4",
      "Sent: 2026-03-01 08:00",
      "To: Desk",
      "",
      "Pallet is missing from the load.",
    ].join("\n");
    const m = splitThread(text);
    expect(m.map((x) => x.body)).toEqual(["Pallet is missing from the load.", "Please escalate."]);
    expect(m[0]).toMatchObject({ from: "Depot 4", to: "Desk", date: "2026-03-01T08:00:00.000Z" });
  });

  it("does not split on a header-like line without a sender, and drops empty messages", () => {
    const m = splitThread("Subject: only a subject\n\nbody text\n\nFrom: Someone\n\n   \n");
    expect(m).toHaveLength(1);
    expect(m[0].body).toBe("Subject: only a subject\n\nbody text");
  });
});
