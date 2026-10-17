import { describe, expect, it } from "vitest";
import {
  caseRows, filterScenarios, incidentSentence, isTelemetry, linkState, openDecisions, placeFrom, runRows, speedBucket, timeBucket, weatherBucket,
  HAPPENINGS, STALE_MS, TWISTS,
} from "./logic";
import { MODIFIERS } from "../../world/scenarios";
import type { CityTelemetry } from "../../world/controlChannel";

const tel = (at: number) => ({ type: "telemetry", at }) as CityTelemetry;
type Ev = CityTelemetry["workflow"][number];
const ev = (caseId: string, nodeId: string, status: string, source?: string): Ev => ({ caseId, nodeId, status, summary: "x", source });

describe("controls", () => {
  it("buckets weather, time and speed", () => {
    expect(weatherBucket("drizzle")).toBe("rain");
    expect(weatherBucket("storm")).toBe("storm");
    expect(weatherBucket(undefined)).toBe(null);
    expect(timeBucket(12)).toBe("day");
    expect(timeBucket(18.5)).toBe("evening");
    expect(timeBucket(23)).toBe("night");
    expect(timeBucket(3)).toBe("night");
    expect(speedBucket(1)).toBe("normal");
    expect(speedBucket(30)).toBe("fast");
  });
  it("offers the five happenings", () => {
    expect(HAPPENINGS.map((h) => h.label)).toEqual(["Car crash", "Truck crash", "Roadworks", "Van breaks down", "Plane emergency"]);
  });
  it("has a plain twist for every modifier", () => {
    expect(Object.keys(TWISTS).sort()).toEqual(Object.keys(MODIFIERS).sort());
  });
  it("link state", () => {
    expect(linkState(null, 0)).toBe("waiting");
    expect(linkState(tel(1000), 1000 + STALE_MS)).toBe("live");
    expect(linkState(tel(1000), 1001 + STALE_MS)).toBe("stale");
  });
});

describe("what's happening", () => {
  it("finds place names", () => {
    expect(placeFrom("Car ran a red on King St and T-boned another")).toBe("King St");
    expect(placeFrom("Van stalled on the Strand, hazards on")).toBe("Strand");
    expect(placeFrom("no place here")).toBe(null);
  });
  it("writes plain sentences", () => {
    expect(incidentSentence({ kind: "truck_crash", status: "responding", note: "Truck jackknifed on King St" })).toBe(
      "Truck crash on King St, police on the way",
    );
    expect(incidentSentence({ kind: "emergency_landing", status: "active", note: "Emergency landing: RV880 engine fire" })).toBe(
      "Plane emergency at the airport, crews on the way",
    );
    expect(incidentSentence({ kind: "roadworks", status: "active", note: "" })).toBe("Roadworks, road closed");
  });
});

describe("cases", () => {
  it("shows the latest plain status per case, newest first, without raw ids", () => {
    const rows = caseRows([
      ev("CASE-0001", "ingest", "start"),
      ev("CASE-0002", "triage", "start", "agent"),
      ev("CASE-0001", "safety_gate", "ask"),
      ev("CASE-0003", "case_log", "ok"),
      ev("CASE-0002", "planner", "start", "agent"),
    ]);
    expect(rows.map((r) => [r.title, r.status, r.live])).toEqual([
      ["Case 2", "Plan the reply…", true],
      ["Case 3", "Done", false],
      ["Case 1", "Needs a person", false],
    ]);
  });
  it("maps blocked and errors", () => {
    expect(caseRows([ev("CASE-9", "safety_gate", "block")])[0].status).toBe("Stopped");
    expect(caseRows([ev("CASE-9", "action", "error")])[0].status).toBe("Something went wrong");
    expect(caseRows([ev("CASE-9", "triage", "start")])[0].status).toBe("What kind of problem…");
  });
});

describe("misc", () => {
  it("filters practice cases", () => {
    const list = [{ id: "delivery-001", title: "Door slot change" }, { id: "delivery-002", title: "Customs invoice" }];
    expect(filterScenarios(list, "")).toHaveLength(2);
    expect(filterScenarios(list, "CUSTOMS").map((s) => s.id)).toEqual(["delivery-002"]);
  });
  it("narrows telemetry", () => {
    expect(isTelemetry(tel(1))).toBe(true);
    expect(isTelemetry({ type: "ping" })).toBe(false);
  });
});

describe("runRows / openDecisions (city cases from SQLite)", () => {
  const runs = [
    { id: "a", caseId: "city-1", title: "INC-003 · car crash", status: "running" as const, outcome: null, card: null, runId: null },
    { id: "b", caseId: "city-2", title: "INC-002 · roadworks", status: "success" as const, outcome: "escalated", card: { summary: "x" }, runId: "r2" },
    { id: "c", caseId: "city-3", title: "INC-001 · breakdown", status: "success" as const, outcome: "escalated", card: { summary: "y" }, runId: "r1" },
  ];
  it("one row per run, a person needed only while the review queue has it open", () => {
    const rows = runRows(runs, new Set(["r1"]));
    expect(rows.map((r) => [r.title, r.status, r.live])).toEqual([
      ["Case 3", "Working on it…", false],
      ["Case 2", "Needs a person", false],
      ["Case 1", "Done", false],
    ]);
    expect(openDecisions(runs, new Set(["r1"]))).toBe(1);
    expect(openDecisions(runs)).toBe(2);
  });
});
