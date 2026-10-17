import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decideTask, listTasks, registerTrace } from "./server";
import { fixtureTrace } from "./test-fixtures";

let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), "rivet-review-test-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("persistent human decisions", () => {
  it("records one of two competing decisions without altering the scored trace", async () => {
    const original = fixtureTrace();
    const task = (await registerTrace({ trace: original }, root))!;
    const choices = await Promise.allSettled([
      decideTask(task.id, { optionId: "investigate", who: "Claims manager" }, root),
      decideTask(task.id, { optionId: "hold", who: "Depot manager" }, root),
    ]);
    expect(choices.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const saved = (await listTasks(root)).tasks[0];
    expect(saved.status).toBe("decision_recorded");
    expect(saved.decision?.execution).toBe("pending");
    expect(JSON.parse(await readFile(path.join(root, "runs/review-imports", task.id, "trace.json"), "utf8"))).toEqual(original);
  });
  it("rejects unknown options and preserves Reality Test outputs", async () => {
    const task = (await registerTrace({ trace: fixtureTrace() }, root))!;
    await expect(decideTask(task.id, { optionId: "refund-everything", who: "Reviewer" }, root)).rejects.toMatchObject({ status: 400 });
    const reality = (await registerTrace({ trace: { ...fixtureTrace("reality"), runId: "reality-run" } }, root))!;
    await expect(decideTask(reality.id, { optionId: "hold", who: "Reviewer" }, root)).rejects.toMatchObject({ status: 409 });
  });
  it("keeps the same receipt/deadline when a trace is registered again", async () => {
    const task = (await registerTrace({ trace: fixtureTrace() }, root))!;
    const again = (await registerTrace({ trace: fixtureTrace() }, root))!;
    expect(again.id).toBe(task.id);
    expect(again.deadlineAt).toBe(task.deadlineAt);
  });
  it("requires a new decision for a resumed segment of the same case", async () => {
    const trace = fixtureTrace();
    const original = (await registerTrace({ trace }, root))!;
    await decideTask(original.id, { optionId: "hold", who: "Reviewer" }, root);
    const resumed = { ...trace, events: [...trace.events, { ...trace.events[0], t: 100 }, trace.events[2]] };
    const next = (await registerTrace({ trace: resumed }, root))!;
    expect(next.id).not.toBe(original.id);
    expect(next.decision).toBeNull();
    expect(next.status).toBe("pending");
  });
  it("continues loading good cases when another trace is corrupt", async () => {
    await registerTrace({ trace: fixtureTrace() }, root);
    const dir = path.join(root, "ANSWERS/broken");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "trace.json"), "{incomplete");
    const queue = await listTasks(root);
    expect(queue.tasks).toHaveLength(1);
    expect(queue.warnings).toHaveLength(1);
  });
});
