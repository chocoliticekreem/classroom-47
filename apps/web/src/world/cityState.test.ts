import { describe, expect, it } from "vitest";
import type { DecisionCard } from "../../../api/src/lib/trace";
import { hydrateCity, missingRunLines, serialiseCity, type CityRun, type SnapshotSource } from "./cityState";
import type { WorkflowEvent } from "./store";

const src = (): SnapshotSource => ({
  incidents: [
    { id: "inc-1", kind: "car_crash", edgeKey: "a|b", x: 10, z: -5, status: "responding", createdAt: 9_000, note: "Crash on King St" },
    { id: "inc-0", kind: "roadworks", edgeKey: "c|d", x: 0, z: 0, status: "cleared", createdAt: 1_000, note: "done" },
  ],
  events: [
    { id: "ev-1", kind: "marathon", title: "Marathon", status: "live", startsAt: 8_000, endsAt: 20_000, route: ["n1", "n2"], closedEdges: ["n1|n2"], x: 1, z: 2 },
    { id: "ev-0", kind: "parade", title: "Old", status: "ended", startsAt: 0, endsAt: 1, route: [], closedEdges: [], x: 0, z: 0 },
  ],
  blocked: { "a|b": "car_crash", "n1|n2": "marathon" },
  weatherOverride: "rain",
  timeOfDay: 21.25,
  timeScale: 10,
  workflow: [{ id: "w1", t: 9_500, caseId: "INC-001 · car crash", nodeId: "triage", status: "ok", summary: "Checked", source: "agent", synthetic: true, executionId: "ex-1" }],
  agentQueue: [
    { id: "job-2", label: "INC-002 · car crash", kind: "incident", enqueuedAt: 5, synthetic: true, incidentId: "inc-1" },
    { id: "job-3", label: "AGT-001 · delivery-003", kind: "scenario", enqueuedAt: 6, synthetic: false },
  ],
});

describe("serialiseCity / hydrateCity", () => {
  it("round-trips the world, re-timed against the new page clock", () => {
    const snap = JSON.parse(JSON.stringify(serialiseCity(src(), 10_000, 1_700_000_000_000)));
    expect(snap.incidents).toHaveLength(1); // cleared dropped
    expect(snap.events).toHaveLength(1); // ended dropped
    const h = hydrateCity(snap, 500)!;
    expect(h.incidents[0]).toMatchObject({ id: "inc-1", status: "responding", x: 10, z: -5, createdAt: 500 - 1_000 });
    expect(h.events[0]).toMatchObject({ id: "ev-1", startsAt: 500 - 2_000, endsAt: 500 + 10_000 });
    expect(h.weatherOverride).toBe("rain");
    expect(h.timeOfDay).toBe(21.25);
    expect(h.timeScale).toBe(10);
    expect(h.workflow[0]).toMatchObject({ id: "w1", t: 0, executionId: "ex-1" });
    expect(h.requeueIncidents).toEqual(["inc-1"]);
    expect(h.droppedQueue).toEqual(["AGT-001 · delivery-003"]);
  });

  it("keeps road closures of restored incidents and live events even when `blocked` lost them", () => {
    const snap = serialiseCity({ ...src(), blocked: {} }, 10_000, 0);
    const h = hydrateCity(JSON.parse(JSON.stringify(snap)), 0)!;
    expect(Object.keys(h.blocked).sort()).toEqual(["a|b", "n1|n2"]);
  });

  it("rejects what isn't a snapshot and sanitises bad fields", () => {
    expect(hydrateCity(null, 0)).toBeNull();
    expect(hydrateCity({ v: 99 }, 0)).toBeNull();
    const h = hydrateCity({ v: 1, incidents: [{ id: 1 }, "x"], weatherOverride: "hail", timeOfDay: 99, timeScale: -3, feed: [{}], queue: [{ label: "x", kind: "incident", incidentId: "gone" }] }, 0)!;
    expect(h.incidents).toEqual([]);
    expect(h.weatherOverride).toBe("auto");
    expect(h.timeOfDay).toBe(24);
    expect(h.timeScale).toBe(0);
    expect(h.workflow).toEqual([]);
    expect(h.requeueIncidents).toEqual([]);
  });
});

const card: DecisionCard = { routeTo: "Ops lead", summary: "Refund or redeliver?", tried: [], options: [{ id: "o1", label: "Redeliver", undoable: true }], deadlineMins: 30, fallback: "Redeliver", undoable: true } as unknown as DecisionCard;
const run = (o: Partial<CityRun> & { id: string }): CityRun => ({ caseId: "city-incident-1", title: `INC-00${o.id.slice(-1)} · car crash`, status: "success", outcome: "acted", startedAt: "", costUsd: 0.04, error: null, card: null, runId: `run-${o.id}`, ...o });

describe("missingRunLines", () => {
  it("adds one line per run the feed doesn't have, oldest first, with real cards for open decisions", () => {
    const runs = [run({ id: "x3", status: "running" }), run({ id: "x2", card, outcome: "escalated" }), run({ id: "x1" })];
    const lines = missingRunLines(runs, []);
    expect(lines.map((l) => [l.executionId, l.status])).toEqual([["x1", "ok"], ["x2", "ask"], ["x3", "start"]]);
    expect(lines[1].card?.options[0].label).toBe("Redeliver");
    expect(lines[1].runId).toBe("run-x2");
  });

  it("skips runs already in the feed and closes decisions the review queue has answered", () => {
    const feed: Pick<WorkflowEvent, "caseId" | "status" | "runId" | "executionId">[] = [
      { caseId: "INC-001", status: "ask", runId: "run-x1", executionId: "x1" },
    ];
    const lines = missingRunLines([run({ id: "x2", card }), run({ id: "x1", card })], feed, new Set(["run-x1", "run-x2"]));
    expect(lines.map((l) => [l.caseId, l.status, l.summary])).toEqual([
      ["INC-002 · car crash", "ok", "Done: a person decided"],
      ["INC-001", "ok", "Done: a person decided"],
    ]);
  });
});
