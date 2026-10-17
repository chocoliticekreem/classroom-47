import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tryCostLine } from "../reality/logic";
import { diskReport, findAnswerFolder, realityFiles } from "./reality";
import { buildDropFolder, deliveryRawDir, tryBudget, tryCaseInput, isStamp, pickCases, rawCases, stampFor, tryCount, tryRunDir } from "./realityTry";

describe("try run paths", () => {
  it("accepts only stamps made by stampFor", () => {
    expect(isStamp(stampFor(new Date(2026, 9, 10, 15, 4, 5)))).toBe(true);
    expect(stampFor(new Date(2026, 9, 10, 15, 4, 5))).toBe("20261010-150405");
    expect(isStamp("20261010-150405-2")).toBe(true);
    for (const bad of ["..", "../ANSWERS", "20261010-150405/../../x", "/etc", "20261010-150405/..", "a", "", null, 5, "20261010-150405\0"]) {
      expect(isStamp(bad)).toBe(false);
      expect(tryRunDir(bad, "/r")).toBeNull();
    }
    expect(tryRunDir("20261010-150405", "/r")).toBe(path.join("/r", "20261010-150405"));
  });

  it("clamps the case count to 1..10", () => {
    expect(tryCount(3)).toBe(3);
    expect(tryCount("2")).toBe(2);
    expect(tryCount(0)).toBe(1);
    expect(tryCount(99)).toBe(10);
    expect(tryCount("abc")).toBeNull();
    expect(tryCount(undefined)).toBeNull();
  });

  it("clamps the budget to 0.1..5 dollars, default 1", () => {
    expect(tryBudget(undefined)).toBe(1);
    expect(tryBudget("")).toBe(1);
    expect(tryBudget("2.5")).toBe(2.5);
    expect(tryBudget(50)).toBe(5);
    expect(tryBudget(0)).toBe(0.1);
    expect(tryBudget("x")).toBeNull();
  });

  it("states the cost before starting", () => {
    expect(tryCostLine(3)).toBe("3 cases · about 15¢ · real agent");
    expect(tryCostLine(1)).toBe("1 case · about 5¢ · real agent");
    expect(tryCostLine(20)).toBe("20 cases · about $1.00 · real agent");
  });
});

describe("drop folder builder", () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "reality-try-"));
    const track = path.join(root, "raw", "Delivery & Logistics");
    for (const n of ["001", "002", "010"]) {
      await mkdir(path.join(track, n), { recursive: true });
      await writeFile(path.join(track, n, "history.md"), `# Case ${n}`);
      await writeFile(path.join(track, n, "index.md"), "idx");
    }
    await mkdir(path.join(track, "notes"), { recursive: true });
    await mkdir(path.join(track, "004"), { recursive: true }); // no .md file
    await writeFile(path.join(track, "README.md"), "x");
    await mkdir(path.join(root, "raw", "Insurance Claims Processing"), { recursive: true });
  });
  afterAll(() => rm(root, { recursive: true, force: true }));

  it("finds the Delivery track and its numbered case folders", async () => {
    const track = await deliveryRawDir(path.join(root, "raw"));
    expect(track).toBe(path.join(root, "raw", "Delivery & Logistics"));
    expect(await rawCases(track!)).toEqual(["001", "002", "010"]);
  });

  it("picks distinct cases, never more than there are", () => {
    const names = ["001", "002", "010"];
    expect(pickCases(names, 2, () => 0)).toHaveLength(2);
    expect(new Set(pickCases(names, 3)).size).toBe(3);
    expect(pickCases(names, 9)).toHaveLength(3);
  });

  it("copies picked cases to 1..N with their files", async () => {
    const track = path.join(root, "raw", "Delivery & Logistics");
    const drop = path.join(root, "run", "cases");
    const map = await buildDropFolder(track, ["010", "001"], drop);
    expect(map).toEqual([{ name: "1", source: "010" }, { name: "2", source: "001" }]);
    expect((await readdir(drop)).sort()).toEqual(["1", "2"]);
    expect(await readFile(path.join(drop, "1", "history.md"), "utf8")).toBe("# Case 010");
    expect((await readdir(path.join(drop, "2"))).sort()).toEqual(["history.md", "index.md"]);
  });

  it("reads a dropped case's input by scan only", async () => {
    const run = path.join(root, "run");
    expect(await tryCaseInput(run, "1")).toContain("# Case 010");
    expect(await tryCaseInput(run, "..")).toBeNull();
    expect(await tryCaseInput(run, "../cases/1")).toBeNull();
    expect(await tryCaseInput(run, "9")).toBeNull();
  });

  it("refuses a source name that is not a plain case number", async () => {
    const track = path.join(root, "raw", "Delivery & Logistics");
    await expect(buildDropFolder(track, ["../../etc"], path.join(root, "bad"))).rejects.toThrow(/not a case folder/);
  });
});

describe("reading an output folder from disk", () => {
  let out: string;
  beforeAll(async () => {
    out = await mkdtemp(path.join(tmpdir(), "reality-out-"));
    await mkdir(path.join(out, "1"));
    await writeFile(path.join(out, "1", "ANSWER.md"), "# Late parcel\n\n**Decision:** ACT. Rebook the slot.\n");
    await writeFile(path.join(out, "1", "REASONING.md"), "why");
    await writeFile(path.join(out, "1", "trace.json"), JSON.stringify({
      caseId: "1", runId: "x", events: [
        { kind: "run_start", title: "Late parcel" },
        { kind: "run_end", outcome: "acted", totalLatencyMs: 4000, totalCostUsd: 0.05 },
      ],
    }));
    await mkdir(path.join(out, "2"));
    await writeFile(path.join(out, "2", "ANSWER.md"), "# Failed\n");
  });
  afterAll(() => rm(out, { recursive: true, force: true }));

  it("lists each case folder with its outcome, cost and time", async () => {
    const { cases, summary } = await diskReport(out);
    expect(cases.map((c) => [c.caseId, c.outcome, c.failed])).toEqual([["1", "acted", false], ["2", "error", true]]);
    expect(cases[0]).toMatchObject({ title: "Late parcel", decision: "ACT. Rebook the slot.", costUsd: 0.05, durationMs: 4000, executionId: null });
    expect(summary.total).toBe(2);
  });

  it("reads files only from folders the scan found, so a traversal name finds nothing", async () => {
    expect(await realityFiles("1", out)).toEqual({ answerMd: expect.stringContaining("Late parcel"), reasoningMd: "why" });
    expect(await findAnswerFolder("..", out)).toBeNull();
    expect(await realityFiles("../1", out)).toBeNull();
    expect(await realityFiles("/etc", out)).toBeNull();
  });
});
