// Workflow versions. v1 is seeded from the workflow's current flow the first time versions are read.
import type { Flow, WorkflowVersion } from "../types";
import { getDb, type SqlValue } from "./db";
import { getWorkflow, seedWorkflows } from "./store";
import { flowHash } from "./practiceCache";

const CREATED_BY = ["user", "architect", "improve"] as const;

function toVersion(r: Record<string, SqlValue>): WorkflowVersion {
  return {
    workflowId: String(r.workflow_id),
    version: Number(r.version),
    flow: JSON.parse(String(r.flow)) as Flow,
    createdAt: String(r.created_at),
    createdBy: String(r.created_by) as WorkflowVersion["createdBy"],
    note: r.note === null ? null : String(r.note),
    parentVersion: r.parent_version === null ? null : Number(r.parent_version),
  };
}

export class VersionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Seeds v1 from the workflow's current flow when it has no versions yet. Throws 404 for an unknown workflow. */
export async function ensureVersions(workflowId: string) {
  const db = getDb();
  if (db.prepare("SELECT 1 AS x FROM workflow_versions WHERE workflow_id = ? LIMIT 1").get(workflowId)) return;
  await seedWorkflows();
  const w = getWorkflow(workflowId);
  if (!w) throw new VersionError(`no workflow ${workflowId}`, 404);
  db.prepare(`INSERT OR IGNORE INTO workflow_versions (workflow_id, version, flow, created_at, created_by, note, parent_version)
    VALUES (?, 1, ?, ?, 'user', ?, NULL)`).run(workflowId, JSON.stringify(w.flow), new Date().toISOString(),
    w.source === "file" ? "Seeded from the flow file" : "Seeded from the saved workflow");
}

export async function listVersions(workflowId: string): Promise<WorkflowVersion[]> {
  await ensureVersions(workflowId);
  return getDb().prepare("SELECT * FROM workflow_versions WHERE workflow_id = ? ORDER BY version DESC").all(workflowId).map(toVersion);
}

/** One version, or the latest when `version` is null. */
export async function getVersion(workflowId: string, version?: number | null): Promise<WorkflowVersion | null> {
  await ensureVersions(workflowId);
  const db = getDb();
  const row = version
    ? db.prepare("SELECT * FROM workflow_versions WHERE workflow_id = ? AND version = ?").get(workflowId, version)
    : db.prepare("SELECT * FROM workflow_versions WHERE workflow_id = ? ORDER BY version DESC LIMIT 1").get(workflowId);
  return row ? toVersion(row) : null;
}

export function isFlowShape(f: unknown): f is Flow {
  const o = f as Flow | null;
  return Boolean(o && typeof o === "object" && Array.isArray(o.nodes) && Array.isArray(o.edges)
    && o.nodes.every((n) => n && typeof n.id === "string" && typeof n.type === "string")
    && o.edges.every((e) => e && typeof e.from === "string" && typeof e.to === "string"));
}

export async function createVersion(workflowId: string, body: { flow?: unknown; createdBy?: unknown; note?: unknown; parentVersion?: unknown }): Promise<WorkflowVersion> {
  if (!isFlowShape(body.flow)) throw new VersionError("body.flow must be a flow with nodes and edges", 400);
  const createdBy = CREATED_BY.includes(body.createdBy as (typeof CREATED_BY)[number]) ? (body.createdBy as WorkflowVersion["createdBy"]) : "user";
  await ensureVersions(workflowId);
  const db = getDb();
  const parent = body.parentVersion === null || body.parentVersion === undefined ? null : Number(body.parentVersion);
  if (parent !== null && !db.prepare("SELECT 1 AS x FROM workflow_versions WHERE workflow_id = ? AND version = ?").get(workflowId, parent)) {
    throw new VersionError(`no version ${parent} of ${workflowId}`, 400);
  }
  const next = Number(db.prepare("SELECT MAX(version) AS v FROM workflow_versions WHERE workflow_id = ?").get(workflowId)?.v ?? 0) + 1;
  if (createdBy === "improve") {
    const baseline = parent === null ? null : await getVersion(workflowId, parent);
    const current = getWorkflow(workflowId);
    if (!baseline || parent !== next - 1 || !current || flowHash(current.flow) !== flowHash(baseline.flow)) {
      throw new VersionError("The workflow changed after this proposal. Test its current version before improving it", 409);
    }
  }
  db.prepare(`INSERT INTO workflow_versions (workflow_id, version, flow, created_at, created_by, note, parent_version) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(workflowId, next, JSON.stringify(body.flow), new Date().toISOString(), createdBy, typeof body.note === "string" ? body.note : null, parent);
  return (await getVersion(workflowId, next))!;
}
