// Uploaded cases for "Try it now": the user drops a .zip of case folders, a whole folder, loose files
// (one case) or our JSON case files, and the real Reality runner runs on them.
//   runs/reality-try/.uploads/<stamp>/cases/1..N   staged until the user presses Run (hidden: not a run)
//   then moved to runs/reality-try/<stamp>/cases/ by startTry.
// Every path from the upload is checked here: no "..", no absolute paths (zip-slip), __MACOSX and
// hidden files are dropped. Nothing is joined to a folder without that check.
import { unzipSync } from "fflate";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
export const UPLOAD_MAX_CASES = 200;
/** What the files inside a zip may add up to once unpacked (zip-bomb guard). */
export const UNZIPPED_MAX_BYTES = 200 * 1024 * 1024;
const MAX_FILES = 5000;

export interface UploadEntry {
  /** Relative path as the browser sent it (webkitRelativePath, or the file name). */
  path: string;
  data: Uint8Array;
}

export interface PlannedCase {
  /** Drop folder name, 1..N. */
  name: string;
  /** Where it came from in the upload (folder name, JSON file, or "loose files"). */
  source: string;
  files: { path: string; data: Uint8Array }[];
}

export class UploadError extends Error {
  status = 400;
}

/**
 * A safe relative path ("a/b/c.md"), null for files to drop silently (__MACOSX, hidden files),
 * and throws for paths that try to leave the folder (.., absolute, drive letters, NUL).
 */
export function safeRelPath(raw: string): string | null {
  if (typeof raw !== "string" || raw.includes("\0")) throw new UploadError(`Unsafe path in upload: ${JSON.stringify(raw)}`);
  const p = raw.replace(/\\/g, "/");
  if (p.startsWith("/") || /^[a-zA-Z]:/.test(p)) throw new UploadError(`Absolute path in upload: ${raw}`);
  const parts = p.split("/").filter((s) => s !== "" && s !== ".");
  if (parts.some((s) => s === "..")) throw new UploadError(`Path leaves the folder: ${raw}`);
  if (!parts.length) return null;
  if (parts.some((s) => s === "__MACOSX" || s.startsWith("."))) return null;
  return parts.join("/");
}

/** Unpacks a zip into entries under `prefix`, with size and count guards. */
export function unzipEntries(data: Uint8Array, prefix = ""): UploadEntry[] {
  let declared = 0;
  let count = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, {
      filter: (f) => {
        if (f.name.endsWith("/")) return false;
        if (safeRelPath(f.name) === null) return false;
        declared += f.originalSize;
        count++;
        if (count > MAX_FILES) throw new UploadError(`The zip holds more than ${MAX_FILES} files.`);
        if (declared > UNZIPPED_MAX_BYTES) throw new UploadError(`The zip unpacks to more than ${UNZIPPED_MAX_BYTES / 1024 / 1024} MB.`);
        return true;
      },
    });
  } catch (err) {
    if (err instanceof UploadError) throw err;
    throw new UploadError(`Could not read the zip: ${err instanceof Error ? err.message : String(err)}`);
  }
  let total = 0;
  const out: UploadEntry[] = [];
  for (const [name, bytes] of Object.entries(files)) {
    total += bytes.length;
    if (total > UNZIPPED_MAX_BYTES) throw new UploadError(`The zip unpacks to more than ${UNZIPPED_MAX_BYTES / 1024 / 1024} MB.`);
    const rel = safeRelPath(name);
    if (rel) out.push({ path: prefix ? `${prefix}/${rel}` : rel, data: bytes });
  }
  return out;
}

// ---------- our JSON cases -> raw folder ----------
interface JsonEvent { n?: number; timestamp?: string; stage?: string; channel?: string; from?: string; to?: string; body?: string }
interface JsonCase {
  id?: string;
  title?: string;
  context?: string;
  initial_request?: string;
  details?: Record<string, string>;
  escalation_snapshot?: { first_event?: number; last_event?: number };
  events: JsonEvent[];
  attachments?: { name?: string; text?: string; missing?: boolean; corrupt?: boolean }[];
}

/** True for one of our case JSON files (data/cases, generated, bulk, haiku): a title or id plus an events list. */
export function isJsonCase(v: unknown): v is JsonCase {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const c = v as Record<string, unknown>;
  return Array.isArray(c.events) && c.events.length > 0 && (typeof c.title === "string" || typeof c.id === "string")
    && c.events.every((e) => e && typeof e === "object" && typeof (e as JsonEvent).body === "string");
}

const pad3 = (n: number) => String(n).padStart(3, "0");
const when = (ts: string | undefined) => (ts ?? "").replace("T", " ").replace(/(\.\d+)?Z$/, " UTC");
const plainTitle = (c: JsonCase) => (c.title ?? c.id ?? "Uploaded case").replace(/^Case(\s+[\w-]+)?:\s*/, "");
const caseLabel = (c: JsonCase) => (c.title?.match(/^Case\s+([\w-]+):/)?.[1] ?? c.id ?? "uploaded").replace(/^(bulk|delivery|gen|haiku)-/, "");
const safeName = (s: string) => /^[\w.-]+$/.test(s) && !s.startsWith(".");

/**
 * A raw case folder (index.md, history.md, attachments/) for one of our JSON cases, the format the
 * judges send. Cut at the escalation snapshot, and never carries the answer key (next_action,
 * outcome, expected, boundaries, rationale stay out).
 */
export function jsonCaseToRaw(c: JsonCase): Record<string, string> {
  const last = c.escalation_snapshot?.last_event;
  const events = (typeof last === "number" ? c.events.filter((e, i) => (e.n ?? i + 1) <= last) : c.events);
  const seen = events.map((e) => e.body ?? "").join("\n");
  const cut = typeof last === "number";
  const attachments = (c.attachments ?? []).filter((a) => a.name && typeof a.text === "string" && a.text && !a.missing && !a.corrupt
    && (!cut || seen.includes(a.name)))
    .map((a) => {
      const base = path.basename(a.name!);
      const name = /\.(txt|csv|md|json)$/i.test(base) ? base : `${base}.txt`;
      return { name: safeName(name) ? name : `attachment-${name.replace(/[^\w.-]/g, "_").replace(/^\.+/, "")}`, text: a.text! };
    });
  const esc = events.at(-1);
  const label = caseLabel(c);
  const lines = [`# Case ${label}: ${plainTitle(c)}`, "", "## Case details", ""];
  if (esc?.from) lines.push(`- **Source role:** ${esc.from}`);
  lines.push("- **Status:** Escalated — awaiting the desk's decision");
  if (events[0]?.timestamp) lines.push(`- **Created:** ${when(events[0].timestamp)}`);
  if (esc?.timestamp) lines.push(`- **Escalated:** ${when(esc.timestamp)}`);
  if (c.details?.primary_shipment) lines.push(`- **Primary shipment:** ${c.details.primary_shipment}`);
  if (c.details?.coordinator) lines.push(`- **Coordinator:** ${c.details.coordinator}`);
  lines.push("");
  if (c.context) lines.push("## Context", "", c.context, "");
  if (c.initial_request) lines.push("## Initial request", "", c.initial_request, "");
  lines.push("## History", "", "[Read the complete dated history](history.md).", "");
  lines.push("## Attachments", "");
  if (attachments.length) for (const a of attachments) lines.push(`- [${a.name}](attachments/${a.name})`);
  else lines.push("None.");
  lines.push("");

  const history = [`# Case ${label} history — ${plainTitle(c)}`, "", `All identities, records and communications are fictional. Total events: ${events.length}.`, "", ""].join("\n")
    + events.map((e, i) => {
      const n = e.n ?? i + 1;
      const out = [`<a id="event-${pad3(n)}"></a>`, `## ${when(e.timestamp)} — event ${pad3(n)}`, ""];
      if (e.stage) out.push(`- **Stage:** ${e.stage}`);
      if (e.channel) out.push(`- **Channel:** ${e.channel}`);
      if (e.from) out.push(`- **From:** ${e.from}`);
      if (e.to) out.push(`- **To:** ${e.to}`);
      out.push("", e.body ?? "", "");
      return out.join("\n");
    }).join("\n");

  const files: Record<string, string> = { "index.md": lines.join("\n"), "history.md": history };
  for (const a of attachments) files[`attachments/${a.name}`] = a.text;
  return files;
}

/** JSON cases in a .json file: one case, or an array of cases. Null when it is not ours. */
function jsonCasesIn(data: Uint8Array): JsonCase[] | null {
  if (data.length > 20 * 1024 * 1024) return null;
  try {
    const v = JSON.parse(new TextDecoder().decode(data)) as unknown;
    if (isJsonCase(v)) return [v];
    if (Array.isArray(v) && v.length && v.every(isJsonCase)) return v as JsonCase[];
  } catch {
    // not JSON, or not ours: it stays a plain file
  }
  return null;
}

const enc = new TextEncoder();
const byNumber = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });
const CASE_ROOT_FILE = /^(index|history)\.md$/i;

/**
 * Turns an upload into case folders. Zips are unpacked first, JSON cases converted, then:
 * loose files at the top level form ONE case; otherwise each top-level folder is a case (after
 * peeling off wrapper folders like "cases/"). A folder with index.md or history.md at its root is one case.
 */
export function planUpload(input: UploadEntry[]): PlannedCase[] {
  const entries: UploadEntry[] = [];
  let total = 0;
  for (const e of input) {
    total += e.data.length;
    if (total > UPLOAD_MAX_BYTES) throw new UploadError(`The upload is over ${UPLOAD_MAX_BYTES / 1024 / 1024} MB.`);
    const rel = safeRelPath(e.path);
    if (!rel) continue;
    if (/\.zip$/i.test(rel)) {
      const dir = path.posix.dirname(rel);
      entries.push(...unzipEntries(e.data, dir === "." ? "" : dir));
    } else entries.push({ path: rel, data: e.data });
  }

  const cases: { source: string; files: { path: string; data: Uint8Array }[] }[] = [];
  const plain: UploadEntry[] = [];
  for (const e of entries) {
    const json = /\.json$/i.test(e.path) ? jsonCasesIn(e.data) : null;
    if (!json) { plain.push(e); continue; }
    for (const [i, c] of json.entries()) {
      const files = Object.entries(jsonCaseToRaw(c)).map(([p, text]) => ({ path: p, data: enc.encode(text) }));
      cases.push({ source: json.length > 1 ? `${e.path} #${i + 1}` : e.path, files });
    }
  }

  if (plain.length) {
    let files = plain.map((e) => ({ path: e.path, data: e.data }));
    let peeled = "";
    // Peel wrapper folders: everything under one folder and no file beside it.
    for (;;) {
      const tops = new Set(files.map((f) => f.path.split("/")[0]));
      if (tops.size !== 1 || files.some((f) => !f.path.includes("/"))) break;
      const top = [...tops][0];
      files = files.map((f) => ({ path: f.path.slice(top.length + 1), data: f.data }));
      peeled = top;
    }
    const rootFiles = files.filter((f) => !f.path.includes("/"));
    const hasDirs = files.some((f) => f.path.includes("/"));
    if (!hasDirs || rootFiles.some((f) => CASE_ROOT_FILE.test(f.path))) {
      cases.push({ source: plain.length === 1 ? plain[0].path : peeled || "uploaded files", files });
    } else {
      // Each top-level folder is a case; stray files beside them (README, notes) are left out.
      const groups = new Map<string, { path: string; data: Uint8Array }[]>();
      for (const f of files) {
        const i = f.path.indexOf("/");
        if (i < 0) continue;
        const top = f.path.slice(0, i);
        if (!groups.has(top)) groups.set(top, []);
        groups.get(top)!.push({ path: f.path.slice(i + 1), data: f.data });
      }
      for (const top of [...groups.keys()].sort(byNumber)) cases.push({ source: top, files: groups.get(top)! });
    }
  }

  if (!cases.length) throw new UploadError("No case files found in the upload.");
  if (cases.length > UPLOAD_MAX_CASES) throw new UploadError(`The upload holds ${cases.length} cases; at most ${UPLOAD_MAX_CASES} at a time.`);
  return cases.map((c, i) => ({ name: String(i + 1), source: c.source, files: c.files }));
}

/** Writes planned cases to <dropDir>/1..N, re-checking every path stays inside its case folder. */
export async function writePlanned(cases: PlannedCase[], dropDir: string): Promise<void> {
  await mkdir(dropDir, { recursive: true });
  for (const c of cases) {
    if (!/^\d+$/.test(c.name)) throw new UploadError(`Bad case name: ${c.name}`);
    const caseDir = path.join(dropDir, c.name);
    for (const f of c.files) {
      const rel = safeRelPath(f.path);
      if (!rel) continue;
      const dest = path.resolve(caseDir, rel);
      if (!dest.startsWith(caseDir + path.sep)) throw new UploadError(`Path leaves the folder: ${f.path}`);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, f.data);
    }
  }
}

export interface StagedUpload {
  id: string;
  createdAt: string;
  cases: { name: string; source: string; files: number }[];
  bytes: number;
}

export const uploadsRoot = (tryRoot: string) => path.join(tryRoot, ".uploads");
const UPLOAD_ID = /^\d{8}-\d{6}-[a-z0-9]{6}$/;
export const isUploadId = (s: unknown): s is string => typeof s === "string" && UPLOAD_ID.test(s);

/** Plans and stages an upload under <tryRoot>/.uploads/<id>/cases, returning what was found. */
export async function stageUpload(entries: UploadEntry[], tryRoot: string, stamp: string): Promise<StagedUpload> {
  const planned = planUpload(entries);
  const id = `${stamp}-${Math.random().toString(36).slice(2, 8).padEnd(6, "0")}`;
  const dir = path.join(uploadsRoot(tryRoot), id);
  await writePlanned(planned, path.join(dir, "cases"));
  const staged: StagedUpload = {
    id,
    createdAt: new Date().toISOString(),
    cases: planned.map((c) => ({ name: c.name, source: c.source, files: c.files.length })),
    bytes: planned.reduce((s, c) => s + c.files.reduce((t, f) => t + f.data.length, 0), 0),
  };
  await writeFile(path.join(dir, "upload.json"), JSON.stringify(staged, null, 2));
  return staged;
}

/** A staged upload's folder and record, or null. The id is pattern-checked, never joined raw. */
export async function readStaged(id: unknown, tryRoot: string): Promise<{ dir: string; staged: StagedUpload } | null> {
  if (!isUploadId(id)) return null;
  const dir = path.join(uploadsRoot(tryRoot), id);
  try {
    const staged = JSON.parse(await readFile(path.join(dir, "upload.json"), "utf8")) as StagedUpload;
    if (!(await stat(path.join(dir, "cases"))).isDirectory()) return null;
    return { dir, staged };
  } catch {
    return null;
  }
}

/** Removes staged uploads older than a day. */
export async function pruneStaged(tryRoot: string, now = Date.now()): Promise<void> {
  const root = uploadsRoot(tryRoot);
  for (const name of await readdir(root).catch(() => [] as string[])) {
    if (!isUploadId(name)) continue;
    const s = await stat(path.join(root, name)).catch(() => null);
    if (s && now - s.mtimeMs > 24 * 3600 * 1000) await rm(path.join(root, name), { recursive: true, force: true }).catch(() => {});
  }
}
