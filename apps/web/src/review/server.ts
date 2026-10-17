// Local operational state. Original scored traces and answer files are never modified.
import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { record, sortTasks, taskFromTrace } from "./model";
import type { ReviewDecision, ReviewQueue, ReviewTask } from "./types";

export class ReviewError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export function repoRoot() {
  return path.basename(process.cwd()) === "web" ? path.resolve(process.cwd(), "../..") : process.cwd();
}
function keyOf(trace: Record<string, unknown>) {
  const events = Array.isArray(trace.events) ? trace.events.map(record).filter((e) => e !== null) : [];
  const start = events.findLast((event) => event?.kind === "run_start");
  // A resumed segment may require a new decision. Never carry an old approval into its card.
  const segment = `${start?.seq ?? ""}:${start?.t ?? 0}`;
  return createHash("sha256").update(`${trace.runId}\n${trace.caseId}\n${segment}`).digest("hex").slice(0, 32);
}

async function optionalJson(file: string): Promise<unknown> {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (e) {
    if (record(e)?.code === "ENOENT") return null;
    throw e;
  }
}

async function traceFiles(dir: string, depth = 0): Promise<string[]> {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch (e) { if (record(e)?.code === "ENOENT") return []; throw e; }
  const files: string[] = [];
  for (const entry of entries) {
    // Fixed roots only, no symlink traversal and no user-controlled file paths.
    if (entry.isDirectory() && depth < 5 && entry.name !== "human-review") files.push(...await traceFiles(path.join(dir, entry.name), depth + 1));
    else if (entry.isFile() && (entry.name === "trace.json" || (path.basename(dir) === "traces" && entry.name.endsWith(".json")))) files.push(path.join(dir, entry.name));
  }
  return files;
}

export async function listTasks(root = repoRoot()): Promise<ReviewQueue> {
  const warnings: string[] = [];
  // These are runtime records in the checkout, not assets to bundle into a deployment.
  const files = (await Promise.all(["ANSWERS", "runs", "examples/practice-run"].map((dir) => traceFiles(path.join(/* turbopackIgnore: true */ root, dir))))).flat();
  const tasks = new Map<string, ReviewTask>();
  for (const file of files) {
    try {
      const info = await stat(file);
      if (info.size > 5_000_000) { warnings.push(`Skipped an oversized trace: ${path.relative(root, file)}`); continue; }
      const trace = record(await optionalJson(file));
      if (!trace) continue;
      const result = await optionalJson(path.join(path.dirname(file), "result.json"));
      const id = keyOf(trace);
      const task = taskFromTrace(trace, info.mtime.toISOString(), id, result);
      if (!task || tasks.has(id)) continue;
      const decision = await optionalJson(path.join(root, "runs/human-review/decisions", `${id}.json`));
      if (decision) {
        task.decision = decision as ReviewDecision;
        task.status = "decision_recorded";
      }
      task.origin = file.includes(`${path.sep}api${path.sep}`) ? "agent" : "runner";
      tasks.set(id, task);
    } catch {
      warnings.push(`Could not read ${path.relative(root, file)}. Other cases are still available.`);
    }
  }
  return { tasks: sortTasks([...tasks.values()]), warnings, updatedAt: new Date().toISOString() };
}

/** Register a returned real-agent trace; the sim and future editor share this entry point. */
export async function registerTrace(value: unknown, root = repoRoot()): Promise<ReviewTask | null> {
  const body = record(value);
  const trace = record(body?.trace);
  if (!trace || !Array.isArray(trace.events) || typeof trace.caseId !== "string" || typeof trace.runId !== "string") throw new ReviewError("A complete agent trace is required", 400);
  const receivedAt = new Date().toISOString();
  const id = keyOf(trace);
  const task = taskFromTrace(trace, receivedAt, id, body?.result);
  if (!task) return null;
  const dir = path.join(root, "runs/review-imports", id);
  await mkdir(dir, { recursive: true });
  // wx makes retries idempotent and keeps the original receipt/deadline stable.
  try { await writeFile(path.join(dir, "trace.json"), JSON.stringify(trace), { flag: "wx" }); }
  catch (e) { if (record(e)?.code !== "EEXIST") throw e; }
  if (body?.result) await writeFile(path.join(dir, "result.json"), JSON.stringify(body.result));
  return (await listTasks(root)).tasks.find((t) => t.id === id) ?? task;
}

export async function decideTask(id: string, value: unknown, root = repoRoot()): Promise<ReviewTask> {
  const body = record(value);
  if (!body || typeof body.optionId !== "string" || typeof body.who !== "string" || !body.who.trim()) throw new ReviewError("Pick a choice and add your name", 400);
  if (body.who.length > 120 || (typeof body.note === "string" && body.note.length > 2000)) throw new ReviewError("Name or note is too long", 400);
  const task = (await listTasks(root)).tasks.find((t) => t.id === id);
  if (!task) throw new ReviewError("This case is no longer waiting", 404);
  if (task.mode === "reality") throw new ReviewError("Test day results are view only", 409);
  if (task.status !== "pending") throw new ReviewError("Someone already decided this case", 409);
  const option = task.options.find((o) => o.id === body.optionId);
  if (!option) throw new ReviewError("Pick one of the choices", 400);
  const decision: ReviewDecision = {
    optionId: option.id, optionLabel: option.label, who: body.who.trim(),
    note: typeof body.note === "string" ? body.note.trim() : "", at: new Date().toISOString(), execution: "pending",
  };
  const dir = path.join(root, "runs/human-review/decisions");
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, `${task.id}.json`);
  const temp = path.join(dir, `${randomUUID()}.tmp`);
  await writeFile(temp, JSON.stringify(decision));
  try {
    // Atomic create: two reviewers cannot both approve, even across server processes.
    await link(temp, target);
  } catch (e) {
    if (record(e)?.code === "EEXIST") throw new ReviewError("Someone has already recorded a decision. Refresh to see it.", 409);
    throw e;
  } finally { await unlink(temp); }
  return { ...task, status: "decision_recorded", decision };
}
