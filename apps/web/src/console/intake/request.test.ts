import { describe, expect, it } from "vitest";
import { EXAMPLES } from "./examples";
import { attachmentKind, buildEvents, buildIntakeRequest, caseTitle, mergeMessages, parseIntakeRequest, type DraftMessage } from "./request";
import { splitThread } from "./split";

const msg = (p: Partial<DraftMessage>): DraftMessage => ({ channel: "Email", from: null, to: null, subject: null, date: null, body: "x", ...p });
const NOW = new Date("2026-10-10T12:00:00Z");

describe("attachmentKind", () => {
  it("sorts files by what the agent can do with them", () => {
    expect(attachmentKind("pod.pdf")).toBe("pdf");
    expect(attachmentKind("IMG_1.JPG")).toBe("image");
    expect(attachmentKind("scan", "image/png")).toBe("image");
    expect(attachmentKind("call.m4a")).toBe("audio");
    expect(attachmentKind("logger.csv")).toBe("text");
    expect(attachmentKind("notes.txt", "text/plain")).toBe("text");
    expect(attachmentKind("archive.zip")).toBe("other");
  });
});

describe("buildEvents", () => {
  it("numbers events, keeps dates, puts the subject first and marks transcripts", () => {
    const ev = buildEvents([
      msg({ from: "A", to: "Desk", date: "2026-02-25T09:00:00.000Z", subject: "DL-1", body: " hello " }),
      msg({ channel: "Call transcript", from: "B", body: "heard", source: "audio_attachment" }),
      msg({ body: "   " }),
    ], NOW);
    expect(ev).toEqual([
      { n: 1, timestamp: "2026-02-25T09:00:00.000Z", stage: null, channel: "Email", from: "A", to: "Desk", body: "Subject: DL-1\n\nhello" },
      { n: 2, timestamp: "2026-02-25T09:01:00.000Z", stage: null, channel: "Call transcript", from: "B", to: null, body: "heard", source: "audio_attachment" },
    ]);
  });
  it("counts back from now when nothing has a date, keeping the order", () => {
    const ev = buildEvents([msg({ body: "a" }), msg({ body: "b" })], NOW);
    expect(ev.map((e) => e.timestamp)).toEqual(["2026-10-10T11:58:00.000Z", "2026-10-10T11:59:00.000Z"]);
  });
});

describe("mergeMessages and caseTitle", () => {
  it("sorts pasted and added messages by time when all are dated", () => {
    const m = mergeMessages([msg({ body: "late", date: "2026-01-01T10:00:00Z" })], [msg({ body: "early", date: "2026-01-01T09:00:00Z" })]);
    expect(m.map((x) => x.body)).toEqual(["early", "late"]);
  });
  it("keeps pasted first when any date is missing", () => {
    const m = mergeMessages([msg({ body: "p", date: "2026-01-01T10:00:00Z" })], [msg({ body: "a" })]);
    expect(m.map((x) => x.body)).toEqual(["p", "a"]);
  });
  it("titles a case by subject, else by the latest message", () => {
    expect(caseTitle([msg({ subject: "Missing pallet" }), msg({ body: "y" })])).toBe("Missing pallet");
    expect(caseTitle([msg({ body: "first" }), msg({ body: "the latest\nmessage" })])).toBe("the latest message");
    expect(caseTitle([msg({ body: "w".repeat(100) })])).toHaveLength(68);
  });
});

describe("buildIntakeRequest", () => {
  it("sends only attachments with text, and passes the playbook", () => {
    const req = buildIntakeRequest({
      messages: [msg({ body: "hi" })],
      attachments: [
        { name: "log.csv", kind: "text", size: 10, text: "t,c\n08:50,9.2" },
        { name: "pod.pdf", kind: "pdf", size: 1000, text: null },
        { name: "empty.txt", kind: "text", size: 0, text: "  " },
      ],
      now: NOW,
      workflowId: "default-incident",
    });
    expect(req.attachments).toEqual([{ name: "log.csv", text: "t,c\n08:50,9.2" }]);
    expect(req.workflowId).toBe("default-incident");
    expect(req.title).toBe("hi");
  });

  it("round-trips through the server check", () => {
    const ex = EXAMPLES[0];
    const req = buildIntakeRequest({ messages: mergeMessages(splitThread(ex.paste), ex.messages), attachments: [], now: NOW });
    const parsed = parseIntakeRequest(JSON.parse(JSON.stringify(req)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.events.map((e) => [e.n, e.channel, e.from])).toEqual([
      [1, "Email", "Tracking support, Plover Arc Logistics"],
      [2, "Customer portal", "Sorin Vaal, recipient"],
    ]);
    expect(parsed.value.events[0].timestamp).toBe("2026-02-25T09:00:00.000Z");
  });
});

describe("parseIntakeRequest", () => {
  const ev = { timestamp: "2026-01-01T00:00:00Z", body: "x" };
  it("marks all demo sample messages as simulated and preserves explicit practice mode", () => {
    const r = parseIntakeRequest({ practice: true, workflowId: "custom-flow", events: [{ ...ev, source: "live_human" }, { ...ev, source: "audio_attachment" }] });
    expect(r.ok && r.value.practice).toBe(true);
    expect(r.ok && r.value.events.map((e) => e.source)).toEqual(["simulated_persona", "simulated_persona"]);
  });
  it("refuses empty or broken bodies with a plain reason", () => {
    expect(parseIntakeRequest(null)).toEqual({ ok: false, error: "The request was empty." });
    expect(parseIntakeRequest({ events: [] })).toEqual({ ok: false, error: "Add at least one message." });
    expect(parseIntakeRequest({ events: [{ ...ev, body: " " }] })).toEqual({ ok: false, error: "Message 1 is empty." });
    expect(parseIntakeRequest({ events: [{ ...ev, timestamp: "soon" }] })).toEqual({ ok: false, error: "Message 1 has no valid time." });
    expect(parseIntakeRequest({ events: [ev], attachments: [{ name: "a.pdf", text: null }] })).toEqual({ ok: false, error: "Each attachment needs a name and text." });
  });
  it("renumbers events, drops unknown sources and cleans attachment names", () => {
    const r = parseIntakeRequest({ title: "  T ", events: [{ ...ev, n: 9, source: "simulated_persona" }], attachments: [{ name: "../x.txt", text: "y" }] });
    expect(r.ok && r.value).toEqual({
      title: "T",
      events: [{ n: 1, timestamp: "2026-01-01T00:00:00.000Z", stage: null, channel: null, from: null, to: null, body: "x" }],
      attachments: [{ name: ".._x.txt", text: "y" }],
      workflowId: null,
    });
  });
});
