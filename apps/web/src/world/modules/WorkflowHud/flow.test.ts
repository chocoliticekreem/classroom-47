import { describe, expect, it } from "vitest";
import type { WorkflowEvent } from "../../store";
import { formatAge, formatClock, gateBranch, newAsks, nodeStatuses, summariseCases } from "./flow";

let n = 0;
const ev = (caseId: string, nodeId: string, status: WorkflowEvent["status"], t: number): WorkflowEvent => ({
  id: `e${n++}`,
  t,
  caseId,
  nodeId,
  status,
  summary: `${nodeId} ${status}`,
});

describe("nodeStatuses", () => {
  it("keeps the latest status per node for the case only", () => {
    const evs = [ev("A", "triage", "start", 1), ev("A", "triage", "ok", 2), ev("B", "triage", "error", 3)];
    expect(nodeStatuses(evs, "A")).toEqual({ triage: "ok" });
  });
  it("lights the virtual block node when the gate blocks", () => {
    const st = nodeStatuses([ev("A", "gate", "block", 1)], "A");
    expect(st.block).toBe("block");
    expect(gateBranch(st)).toBe("block");
  });
  it("detects ask and allow branches", () => {
    expect(gateBranch({ gate: "ask" })).toBe("ask");
    expect(gateBranch({ gate: "ok", action: "start" })).toBe("allow");
    expect(gateBranch({ gate: "start" })).toBeNull();
  });
});

describe("summariseCases", () => {
  it("groups by case, newest activity first, with states", () => {
    const evs = [
      ev("A", "ingest", "ok", 1),
      ev("B", "ingest", "ok", 2),
      ev("A", "gate", "ask", 3),
      ev("B", "log", "ok", 4),
    ];
    const s = summariseCases(evs);
    expect(s.map((c) => c.caseId)).toEqual(["B", "A"]);
    expect(s[0].state).toBe("closed");
    expect(s[1].state).toBe("awaiting");
    expect(s[1].cost).toBeGreaterThan(0);
  });
});

describe("newAsks", () => {
  it("returns ask events after the last seen id, oldest first", () => {
    const evs = [ev("A", "gate", "ask", 1), ev("A", "x", "ok", 2), ev("B", "gate", "ask", 3), ev("C", "gate", "ask", 4)];
    expect(newAsks(evs, evs[1].id).map((e) => e.caseId)).toEqual(["B", "C"]);
    expect(newAsks(evs, evs[3].id)).toEqual([]);
  });
});

describe("format", () => {
  it("formats clock and age", () => {
    expect(formatClock(17.5)).toBe("17:30");
    expect(formatClock(24.25)).toBe("00:15");
    expect(formatAge(75_000)).toBe("1m 15s");
  });
});
