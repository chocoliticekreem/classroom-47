import { describe, expect, it } from "vitest";
import { WorkflowEngine } from "../world/modules/WorkflowDriver/engine";
import { simulationTasks } from "./simulation";

function waitingEngine() {
  const engine = new WorkflowEngine({ seed: 7, background: false, emit: () => {}, humanTimeoutMs: 15 * 60_000 });
  engine.customerMessage(undefined, { risk: .5 });
  for (let i = 0; i < 800 && engine.cases()[0].state !== "awaiting_human"; i++) engine.advance(50);
  return engine;
}
describe("city human decisions", () => {
  it("shows the actual reason and specialist for a necessary review", () => {
    const engine = new WorkflowEngine({ background: false, emit: () => {}, humanTimeoutMs: 15 * 60_000 });
    engine.customerMessage("legal_notice");
    for (let i = 0; i < 800 && engine.cases()[0].state !== "awaiting_human"; i++) engine.advance(50);
    const task = simulationTasks(engine, "city-session", 100_000)[0];
    expect(task.mustDecide).toMatch(/formal solicitor/);
    expect(task.routeTo).toBe("Legal lead");
  });

  it("uses the configured desk supervisor for legal escalation even when the case title is routine", () => {
    const engine = new WorkflowEngine({ background: false, emit: () => {}, humanTimeoutMs: 15 * 60_000 });
    engine.scenario({ scenarioId: "delivery-024", runId: "legal-case", modifiers: ["needs_human"] });
    for (let i = 0; i < 800 && engine.cases()[0].state !== "awaiting_human"; i++) engine.advance(50);
    const task = simulationTasks(engine, "city-session", 100_000)[0];
    expect(task.title).toMatch(/recipient has no parcel/);
    expect(task.routeTo).toBe("Desk supervisor");
    expect(task.mustDecide).toMatch(/legal action/);
  });

  it("shares the engine deadline and applies the exact chosen option once", () => {
    const engine = waitingEngine();
    const task = simulationTasks(engine, "city-session", 100_000)[0];
    expect(task.simulated).toBe(true);
    expect(Date.parse(task.deadlineAt)).toBe(100_000 + 15 * 60_000);
    expect(engine.decide(task.caseId, "Invented option")).toBe(false);
    expect(engine.decide(task.caseId, task.options[0].label)).toBe(true);
    expect(engine.decide(task.caseId, task.options[1].label)).toBe(false);
    engine.advance(50);
    expect(engine.cases()[0].decision?.chosen).toBe(task.options[0].label);
    expect(simulationTasks(engine, "city-session", 100_050)[0].status).toBe("resolved");
  });
  it("does not accept a choice after the engine's deadline", () => {
    const engine = waitingEngine();
    const task = simulationTasks(engine, "city-session", 100_000)[0];
    engine.advance(15 * 60_000);
    expect(engine.decide(task.caseId, task.options[0].label)).toBe(false);
    expect(engine.cases()[0].decision?.auto).toBe(true);
  });
});
