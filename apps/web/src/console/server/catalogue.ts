// Every case the console can run or show, per dataset, read from the repo:
//   public    data/cases/delivery (via data/index.json)
//   generated data/generated/delivery without a grounding seed
//   grounded  data/generated/delivery with a grounding seed (data/scraped)
//   adversarial data/adversarial/delivery (Oriol's adversarial cases, PR #12)
//   city      data/city/delivery (hand-written city scenarios; no index.json, read from the folder)
//   haiku     data/haiku/delivery (Haiku-made cases, scripts/eval/gen-haiku.mjs; read from the folder)
//   bulk      data/bulk/delivery (2,500 rule-made cases, scripts/eval/gen-bulk.mjs; listed by data/bulk/index.json)
//   fixtures  docs/stress-test/fixtures/NNN (index.md + history.md), id "fixture-NNN"
//   adhoc     runs/adhoc/<id>.json, one-off cases from the "New case" page (console/intake/adhoc.ts)
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fixtureAttachmentPaths, fixtureView, fixtureTitle, generatedView, publicView, type CaseView } from "./caseViews";
import { repoRoot } from "./db";
import { ADHOC_DATASET, listAdhoc, readAdhoc } from "../intake/adhoc";

export interface CaseEntry {
  id: string;
  dataset: string;
  title: string | null;
}

interface Located extends CaseEntry {
  file: string; // absolute; for fixtures, the fixture folder
  mutation: string | null; // difficulty pattern (scripts/eval/mutations.mjs); null for public and fixtures
}

/** A case with its difficulty pattern, for scenario sets. */
export interface CaseWithMutation extends CaseEntry { mutation: string | null }

export const DATASETS = ["public", "generated", "grounded", "adversarial", "city", "haiku", "bulk", "fixtures"] as const;

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function scan(): Promise<Located[]> {
  const root = repoRoot();
  const data = path.join(root, "data");
  const out: Located[] = [];

  const index = (await readJson<{ id: string; track: string; title?: string; file: string }[]>(path.join(data, "index.json"))) ?? [];
  for (const c of index) {
    if (c.track === "delivery") out.push({ id: c.id, dataset: "public", title: c.title ?? null, file: path.join(data, c.file), mutation: null });
  }

  type Indexed = { id: string; title?: string; grounding?: string | null; mutation?: string; file: string };
  for (const set of ["generated", "adversarial", "city", "haiku", "bulk"] as const) {
    const dataset = (c: { grounding?: string | null }) => (set !== "generated" ? set : c.grounding ? "grounded" : "generated");
    const listed = (await readJson<Indexed[]>(path.join(data, set, "index.json"))) ?? [];
    const indexed = new Set(listed.map((c) => c.id));
    for (const c of listed) {
      out.push({ id: c.id, dataset: dataset(c), title: c.title ?? null, file: path.join(data, c.file), mutation: c.mutation ?? null });
    }
    // Files not yet in the index still count.
    const dir = path.join(data, set, "delivery");
    for (const name of (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith(".json")).sort()) {
      const id = name.replace(/\.json$/, "");
      if (indexed.has(id)) continue;
      const c = await readJson<Omit<Indexed, "file">>(path.join(dir, name));
      if (!c) continue;
      out.push({ id: c.id ?? id, dataset: dataset(c), title: c.title ?? null, file: path.join(dir, name), mutation: c.mutation ?? null });
    }
  }

  const fixDir = path.join(root, "docs", "stress-test", "fixtures");
  for (const name of (await readdir(fixDir).catch(() => [] as string[])).sort()) {
    const indexMd = await readFile(path.join(fixDir, name, "index.md"), "utf8").catch(() => null);
    if (indexMd === null) continue;
    out.push({ id: `fixture-${name}`, dataset: "fixtures", title: fixtureTitle(indexMd), file: path.join(fixDir, name), mutation: null });
  }
  for (const c of await listAdhoc()) out.push({ id: c.id, dataset: ADHOC_DATASET, title: c.title, file: "", mutation: null });
  return out;
}

const CACHE_MS = 15_000;
let cache: { at: number; cases: Promise<Located[]> } | null = null;

async function located(): Promise<Located[]> {
  if (!cache || Date.now() - cache.at > CACHE_MS) cache = { at: Date.now(), cases: scan() };
  return cache.cases;
}

/** Changes each time the catalogue is rescanned (at most every CACHE_MS). For caching derived views. */
export function catalogueStamp(): number {
  return cache?.at ?? 0;
}

export async function listCases(dataset?: string | null, q?: string | null): Promise<CaseEntry[]> {
  const needle = q?.trim().toLowerCase();
  return (await located())
    .filter((c) => !dataset || c.dataset === dataset)
    .filter((c) => !needle || c.id.toLowerCase().includes(needle) || (c.title ?? "").toLowerCase().includes(needle))
    .map(({ id, dataset: d, title }) => ({ id, dataset: d, title }));
}

/** Every case with its difficulty pattern. */
export async function listCasesWithMutation(): Promise<CaseWithMutation[]> {
  return (await located()).map(({ id, dataset, title, mutation }) => ({ id, dataset, title, mutation }));
}

export async function findCase(caseId: string, dataset?: string | null): Promise<CaseEntry | null> {
  const all = await located();
  const hit = all.find((c) => c.id === caseId && (!dataset || c.dataset === dataset));
  return hit ? { id: hit.id, dataset: hit.dataset, title: hit.title } : null;
}

type Built = { entry: CaseEntry; view: CaseView };

const VIEW_MEMO_MAX = 1000;
const gv = globalThis as unknown as { __consoleViewMemo?: Map<string, Promise<Built | null>> };
const viewMemo = (gv.__consoleViewMemo ??= new Map<string, Promise<Built | null>>());

/**
 * The view the eval would send for this case. Null if the case is unknown. Memoised in-process per
 * dataset + case id (case files do not change while the console runs); unknown cases are not
 * remembered, and every caller gets its own copy.
 */
export async function buildView(caseId: string, dataset?: string | null): Promise<Built | null> {
  const key = `${dataset ?? ""}\u0000${caseId}`;
  let p = viewMemo.get(key);
  if (!p) {
    p = buildViewUncached(caseId, dataset);
    viewMemo.set(key, p);
    if (viewMemo.size > VIEW_MEMO_MAX) viewMemo.delete(viewMemo.keys().next().value!);
    p.then((b) => { if (!b) viewMemo.delete(key); }, () => viewMemo.delete(key));
  }
  const built = await p;
  return built ? structuredClone(built) : null;
}

/** Forget memoised views (tests, or after case files change). */
export function clearViewMemo() {
  viewMemo.clear();
}

async function buildViewUncached(caseId: string, dataset?: string | null): Promise<Built | null> {
  // One-off cases are read straight from disk: one saved a moment ago is not in the scan cache yet.
  if (dataset === ADHOC_DATASET || (!dataset && caseId.startsWith("adhoc-"))) {
    const c = await readAdhoc(caseId);
    return c ? { entry: { id: c.id, dataset: ADHOC_DATASET, title: c.title }, view: generatedView(c) } : null;
  }
  const hit = (await located()).find((c) => c.id === caseId && (!dataset || c.dataset === dataset));
  if (!hit) return null;
  const entry = { id: hit.id, dataset: hit.dataset, title: hit.title };
  if (hit.dataset === "fixtures") {
    const [indexMd, historyMd] = await Promise.all([
      readFile(path.join(hit.file, "index.md"), "utf8"),
      readFile(path.join(hit.file, "history.md"), "utf8"),
    ]);
    const attachments = await Promise.all(fixtureAttachmentPaths(indexMd).map(async (rel) => ({
      name: path.basename(rel),
      text: await readFile(path.join(hit.file, rel), "utf8").catch(() => null),
    })));
    return { entry, view: fixtureView(hit.id, indexMd, historyMd, attachments) };
  }
  const raw = JSON.parse(await readFile(hit.file, "utf8"));
  return { entry, view: hit.dataset === "public" ? publicView(raw) : generatedView(raw) };
}
