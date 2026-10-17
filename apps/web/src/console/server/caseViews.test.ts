import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
// The eval's own loader: the console must send exactly what the eval scores.
import { loadCases } from "../../../../../scripts/eval/cases.mjs";
import { fixtureView, generatedView, parseFixtureHistory, publicView } from "./caseViews";

const DATA = path.resolve(__dirname, "../../../../../data");
const FIXTURES = path.resolve(__dirname, "../../../../../docs/stress-test/fixtures");

describe("publicView", () => {
  it("cuts events at the escalation snapshot, drops unseen attachments, strips title and context", () => {
    const view = publicView({
      id: "delivery-900", track: "delivery", title: "Leaky title", context: "Leaky context", initial_request: "help",
      escalation_snapshot: { last_event: 2 },
      events: [1, 2, 3].map((n) => ({ n, timestamp: `t${n}`, stage: null, channel: null, from: null, to: null, body: n === 1 ? "see label.pdf" : "x" })),
      attachments: [{ name: "label.pdf", text: "L" }, { name: "later.pdf", text: "M" }],
    });
    expect(view.title).toBeNull();
    expect(view.context).toBeNull();
    expect(view.events.map((e) => e.n)).toEqual([1, 2]);
    expect(view.attachments).toEqual([{ name: "label.pdf", text: "L" }]);
  });

  it("matches scripts/eval/cases.mjs on the real public and generated sets", async () => {
    const evalCases: { id: string; set: string; view: unknown }[] = await loadCases("all");
    const index: { id: string; track: string; file: string }[] = JSON.parse(await readFile(path.join(DATA, "index.json"), "utf8"));
    const publicFiles = index.filter((c) => c.track === "delivery").slice(0, 10);
    for (const entry of publicFiles) {
      const raw = JSON.parse(await readFile(path.join(DATA, entry.file), "utf8"));
      expect(publicView(raw)).toEqual(evalCases.find((c) => c.id === entry.id)!.view);
    }
    const gen = JSON.parse(await readFile(path.join(DATA, "generated", "delivery", "gen-101.json"), "utf8"));
    expect(generatedView(gen)).toEqual(evalCases.find((c) => c.id === "gen-101")!.view);
    const { readdir } = await import("node:fs/promises");
    const cityFiles = (await readdir(path.join(DATA, "city", "delivery"))).filter((n) => n.endsWith(".json")).sort();
    expect(cityFiles).toHaveLength(50);
    for (const name of cityFiles) {
      const city = JSON.parse(await readFile(path.join(DATA, "city", "delivery", name), "utf8"));
      expect(generatedView(city)).toEqual(evalCases.find((c) => c.id === city.id && c.set === "city")!.view);
    }
    for (const id of ["adv-001", "adv-073", "adv-074"]) {
      const adv = JSON.parse(await readFile(path.join(DATA, "adversarial", "delivery", `${id}.json`), "utf8"));
      expect(generatedView(adv)).toEqual(evalCases.find((c) => c.id === id)!.view);
    }
  });
});

const HISTORY = `# Case 900 history: x

All identities are fictional. Total events: 2.

<a id="event-001"></a>
## 2026-04-02 09:00:00 UTC — event 001

- **Stage:** Context
- **Channel:** Email
- **From:** Tracking support, Plover Arc Logistics
- **To:** Iona Quill, Rivet Delivery Desk

First line.

Second paragraph.

<a id="event-002"></a>
## 2026-04-03 10:05:00 UTC — event 002

- **Stage:** Escalation
- **Channel:** Customer portal
- **From:** Hollis Fenn, recipient
- **To:** Iona Quill, Rivet Delivery Desk

Where is it?
`;

const INDEX = `# Case 900: Recipient chases a parcel

## Case details

- **Status:** Escalated

## Context

Background line.

## Initial request

Where is it?

## Overview

The escalation snapshot comprises history events 001–001. Decide the next action at escalation.

## Attachments

None.
`;

describe("fixtures", () => {
  it("parses history events with multi-paragraph bodies", () => {
    expect(parseFixtureHistory(HISTORY)).toEqual([
      { n: 1, timestamp: "2026-04-02T09:00:00Z", stage: "Context", channel: "Email", from: "Tracking support, Plover Arc Logistics",
        to: "Iona Quill, Rivet Delivery Desk", body: "First line.\n\nSecond paragraph." },
      { n: 2, timestamp: "2026-04-03T10:05:00Z", stage: "Escalation", channel: "Customer portal", from: "Hollis Fenn, recipient",
        to: "Iona Quill, Rivet Delivery Desk", body: "Where is it?" },
    ]);
  });

  it("builds a view cut at the snapshot in the Overview", () => {
    const v = fixtureView("fixture-900", INDEX, HISTORY);
    expect(v).toMatchObject({ id: "fixture-900", title: "Case 900: Recipient chases a parcel", context: "Background line.", initial_request: "Where is it?" });
    expect(v.events.map((e) => e.n)).toEqual([1]);
  });

  it("reads every committed fixture with its escalation as the last event", async () => {
    for (const n of ["101", "112"]) {
      const [index, history] = await Promise.all(["index.md", "history.md"].map((f) => readFile(path.join(FIXTURES, n, f), "utf8")));
      const v = fixtureView(`fixture-${n}`, index, history);
      expect(v.events.length).toBeGreaterThan(0);
      expect(v.events.at(-1)!.stage).toBe("Escalation");
      expect(v.events.every((e) => e.body.length > 0 && !e.body.includes("<a id="))).toBe(true);
    }
  });
});
