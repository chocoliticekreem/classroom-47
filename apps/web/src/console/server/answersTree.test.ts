import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { answersTree, findInTree, isSafeRelPath, readTreeFile } from "./answersTree";

let root: string;
let outside: string;

beforeAll(async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "answers-tree-"));
  root = path.join(base, "ANSWERS");
  outside = path.join(base, "secret.md");
  await writeFile(outside, "secret");
  await mkdir(path.join(root, "2"), { recursive: true });
  await mkdir(path.join(root, "10"), { recursive: true });
  await mkdir(path.join(root, "empty"), { recursive: true });
  await writeFile(path.join(root, "INDEX.md"), "# Index");
  await writeFile(path.join(root, "RUNLOG.md"), "Run x.");
  await writeFile(path.join(root, ".hidden.md"), "no");
  await writeFile(path.join(root, "case-history.jsonl"), "{}\n");
  await writeFile(path.join(root, "2", "trace.json"), "{}");
  await writeFile(path.join(root, "2", "ANSWER.md"), "# Two");
  await writeFile(path.join(root, "2", "notes.exe"), "x");
  await writeFile(path.join(root, "10", "ANSWER.md"), "x".repeat(50));
});

describe("isSafeRelPath", () => {
  it.each(["../secret.md", "/etc/passwd", "2/../../secret.md", "2\\ANSWER.md", ".", "2/./ANSWER.md", "", ".hidden.md", "a\0b"])("refuses %j", (p) => {
    expect(isSafeRelPath(p)).toBe(false);
  });
  it("accepts plain paths", () => {
    expect(isSafeRelPath("2/ANSWER.md")).toBe(true);
    expect(isSafeRelPath("INDEX.md")).toBe(true);
  });
});

describe("answersTree", () => {
  it("lists root files and case folders in number order, runner files first", async () => {
    const t = await answersTree(root);
    expect(t.files.map((f) => f.name)).toEqual(["INDEX.md", "RUNLOG.md", "case-history.jsonl"]);
    expect(t.cases.map((c) => c.name)).toEqual(["2", "10"]);
    expect(t.cases[0].children.map((f) => f.path)).toEqual(["2/ANSWER.md", "2/trace.json"]);
  });
  it("finds only listed files", async () => {
    const t = await answersTree(root);
    expect(findInTree(t, "2/ANSWER.md")?.size).toBe(5);
    expect(findInTree(t, "2/notes.exe")).toBeNull();
    expect(findInTree(t, "../secret.md")).toBeNull();
  });
});

describe("readTreeFile", () => {
  it("reads a listed file", async () => {
    expect(await readTreeFile(root, "2/ANSWER.md")).toEqual({ path: "2/ANSWER.md", size: 5, text: "# Two", truncated: false });
  });
  it("cuts at the cap", async () => {
    const r = await readTreeFile(root, "10/ANSWER.md", 10);
    expect(r?.text).toHaveLength(10);
    expect(r?.truncated).toBe(true);
    expect(r?.size).toBe(50);
  });
  it("refuses escapes and unlisted files", async () => {
    for (const p of ["../secret.md", outside, "2/../../secret.md", "missing.md", "2/notes.exe", 5]) {
      expect(await readTreeFile(root, p)).toBeNull();
    }
  });
});
