import { zipSync, strToU8 } from "fflate";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { isJsonCase, jsonCaseToRaw, planUpload, readStaged, safeRelPath, stageUpload, unzipEntries, writePlanned } from "./realityUpload";

const t = (s: string) => strToU8(s);
const names = (c: { files: { path: string }[] }) => c.files.map((f) => f.path).sort();

describe("upload paths", () => {
  it("rejects paths that leave the folder", () => {
    for (const bad of ["../x.md", "a/../../x", "/etc/passwd", "C:\\x\\y.md", "c:/x", "a\\..\\..\\b", "x\0.md", "cases/1/../../../evil"]) {
      expect(() => safeRelPath(bad), bad).toThrow();
    }
  });

  it("drops __MACOSX and hidden files, normalises the rest", () => {
    expect(safeRelPath("__MACOSX/1/._index.md")).toBeNull();
    expect(safeRelPath("1/.DS_Store")).toBeNull();
    expect(safeRelPath("./1//index.md")).toBe("1/index.md");
    expect(safeRelPath("1\\attachments\\a.pdf")).toBe("1/attachments/a.pdf");
  });

  it("refuses a zip-slip entry inside a zip", () => {
    const zip = zipSync({ "1/index.md": t("# Case 1"), "../../evil.sh": t("x") });
    expect(() => unzipEntries(zip)).toThrow(/leaves the folder/);
    expect(() => planUpload([{ path: "cases.zip", data: zip }])).toThrow(/leaves the folder/);
  });

  it("refuses a file that is not a zip", () => {
    expect(() => unzipEntries(t("not a zip"))).toThrow(/Could not read the zip/);
  });

  it("writePlanned never writes outside its case folder", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "upl-"));
    await expect(writePlanned([{ name: "1", source: "x", files: [{ path: "../2/x.md", data: t("x") }] }], dir)).rejects.toThrow();
    await expect(writePlanned([{ name: "../x", source: "x", files: [] }], dir)).rejects.toThrow();
    await rm(dir, { recursive: true, force: true });
  });
});

describe("planUpload", () => {
  it("a zip of case folders in a wrapper folder becomes one case per folder, in number order", () => {
    const zip = zipSync({
      "cases/10/index.md": t("# Case 10"),
      "cases/2/index.md": t("# Case 2"),
      "cases/2/history.md": t("h"),
      "cases/2/attachments/a.pdf": t("%PDF"),
      "__MACOSX/cases/2/._index.md": t("junk"),
      "cases/.DS_Store": t("junk"),
    });
    const cases = planUpload([{ path: "drop.zip", data: zip }]);
    expect(cases.map((c) => [c.name, c.source])).toEqual([["1", "2"], ["2", "10"]]);
    expect(names(cases[0])).toEqual(["attachments/a.pdf", "history.md", "index.md"]);
  });

  it("an uploaded folder keeps relative paths; a README beside the cases is left out", () => {
    const cases = planUpload([
      { path: "drop/README.md", data: t("readme") },
      { path: "drop/001/index.md", data: t("# Case 001") },
      { path: "drop/002/case-files/inner/index.md", data: t("# Case 002") },
    ]);
    expect(cases.map((c) => c.source)).toEqual(["001", "002"]);
    expect(names(cases[1])).toEqual(["case-files/inner/index.md"]);
  });

  it("a single case folder (index.md at its root) is one case even with an attachments folder", () => {
    const cases = planUpload([
      { path: "017/index.md", data: t("# Case 017") },
      { path: "017/history.md", data: t("h") },
      { path: "017/attachments/x.png", data: t("png") },
    ]);
    expect(cases).toHaveLength(1);
    expect(names(cases[0])).toEqual(["attachments/x.png", "history.md", "index.md"]);
  });

  it("loose files are ONE case", () => {
    const cases = planUpload([
      { path: "email.txt", data: t("hello") },
      { path: "photo.png", data: t("png") },
      { path: "notes.csv", data: t("a,b") },
    ]);
    expect(cases).toHaveLength(1);
    expect(names(cases[0])).toEqual(["email.txt", "notes.csv", "photo.png"]);
  });

  it("our JSON cases become one raw case each; other JSON stays a plain file", () => {
    const c = { id: "gen-1001", title: "Case: Late van", context: "ctx", initial_request: "req", events: [{ n: 1, timestamp: "2026-02-02T09:00:00Z", channel: "Email", from: "A", to: "B", body: "hi" }] };
    const cases = planUpload([
      { path: "gen-1001.json", data: t(JSON.stringify(c)) },
      { path: "two.json", data: t(JSON.stringify([c, { ...c, id: "gen-1002" }])) },
    ]);
    expect(cases.map((x) => x.source)).toEqual(["gen-1001.json", "two.json #1", "two.json #2"]);
    expect(names(cases[0])).toEqual(["history.md", "index.md"]);
    const loose = planUpload([{ path: "manifest.json", data: t('{"shipment":"DL-1"}') }]);
    expect(loose).toHaveLength(1);
    expect(names(loose[0])).toEqual(["manifest.json"]);
  });

  it("caps cases at 200 and empty uploads", () => {
    const many = Array.from({ length: 201 }, (_, i) => ({ path: `d/${i + 1}/index.md`, data: t("x") }));
    expect(() => planUpload(many)).toThrow(/at most 200/);
    expect(() => planUpload([{ path: "__MACOSX/x", data: t("x") }])).toThrow(/No case files/);
  });

  it("caps the upload at 50 MB", () => {
    const big = new Uint8Array(26 * 1024 * 1024);
    expect(() => planUpload([{ path: "a.pdf", data: big }, { path: "b.pdf", data: big }])).toThrow(/over 50 MB/);
  });
});

describe("JSON case -> raw folder", () => {
  const practice = {
    id: "delivery-001",
    title: "Case 001: Recipient cannot attend",
    details: { primary_shipment: "DL-001", coordinator: "Iona Quill, Rivet Delivery Desk" },
    context: "A lamp parcel.",
    initial_request: "Could you move my delivery?",
    escalation_snapshot: { first_event: 1, last_event: 2 },
    next_action: { summary: "SECRET NEXT ACTION", recipient: "x", channel: "y" },
    outcome: "SECRET OUTCOME",
    boundaries: "SECRET BOUNDARY",
    events: [
      { n: 1, timestamp: "2026-02-02T09:00:00Z", stage: "Context", channel: "Email", from: "Dispatch", to: "Desk", body: "Slots open. See slots.pdf" },
      { n: 2, timestamp: "2026-02-02T09:10:00Z", stage: "Escalation", channel: "Portal", from: "Vessa Lorne, recipient", to: "Desk", body: "Please move it." },
      { n: 3, timestamp: "2026-02-02T10:00:00Z", stage: "Resolution", channel: "Portal", from: "Desk", to: "Vessa", body: "AFTER ESCALATION" },
    ],
    attachments: [
      { name: "slots.pdf", text: "Slot list" },
      { name: "later.pdf", text: "only mentioned later" },
      { name: "../../evil.txt", text: "x" },
    ],
  };

  it("cuts at the escalation snapshot and leaves the answer key out", () => {
    expect(isJsonCase(practice)).toBe(true);
    const files = jsonCaseToRaw(practice);
    expect(Object.keys(files).sort()).toEqual(["attachments/slots.pdf.txt", "history.md", "index.md"]);
    const all = Object.values(files).join("\n");
    for (const secret of ["SECRET", "AFTER ESCALATION", "only mentioned later"]) expect(all).not.toContain(secret);
    expect(files["index.md"]).toMatch(/^# Case 001: Recipient cannot attend/);
    expect(files["index.md"]).toContain("- **Source role:** Vessa Lorne, recipient");
    expect(files["index.md"]).toContain("- **Primary shipment:** DL-001");
    expect(files["history.md"]).toContain("## 2026-02-02 09:10:00 UTC — event 002");
    expect(files["history.md"]).toContain("Total events: 2.");
  });

  it("generated cases (no snapshot) keep every event and stay away from expected", () => {
    const gen = { id: "gen-1001", title: "Case: Van late", context: "c", initial_request: "r", expected: { must: ["SECRET"] }, rationale: "SECRET",
      events: [{ n: 1, timestamp: "2026-03-01T08:00:00Z", channel: "SMS", from: "Driver", to: "Desk", body: "Running late" }] };
    const files = jsonCaseToRaw(gen);
    expect(files["index.md"]).toMatch(/^# Case 1001: Van late/);
    expect(Object.values(files).join("\n")).not.toContain("SECRET");
  });

  it("is not fooled by other JSON", () => {
    expect(isJsonCase({ events: [] })).toBe(false);
    expect(isJsonCase([{ title: "x", events: [{ body: "y" }] }])).toBe(false);
    expect(isJsonCase({ title: "x", events: [{ nobody: 1 }] })).toBe(false);
  });
});

describe("staging", () => {
  const dirs: string[] = [];
  afterAll(async () => { for (const d of dirs) await rm(d, { recursive: true, force: true }); });

  it("stages an upload under .uploads/<id>/cases/1..N and reads it back by id only", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "try-"));
    dirs.push(root);
    const zip = zipSync({ "a/index.md": t("# Case A"), "b/index.md": t("# Case B") });
    const staged = await stageUpload([{ path: "x.zip", data: zip }], root, "20261010-150000");
    expect(staged.cases.map((c) => c.name)).toEqual(["1", "2"]);
    expect(await readdir(path.join(root, ".uploads", staged.id, "cases"))).toEqual(["1", "2"]);
    expect(await readFile(path.join(root, ".uploads", staged.id, "cases", "2", "index.md"), "utf8")).toBe("# Case B");
    expect((await readStaged(staged.id, root))?.staged.cases).toHaveLength(2);
    for (const bad of ["../x", "..", staged.id + "/..", "20261010-150000"]) expect(await readStaged(bad, root)).toBeNull();
  });
});
