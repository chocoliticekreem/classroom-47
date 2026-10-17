import type { NextRequest } from "next/server";
import { connection } from "next/server";
import { getDb } from "@/console/server/db";
import { agentUrl } from "@/console/server/execute";
import { jsonError } from "@/console/server/http";

// Proxy to the agent runtime's Architect (apps/api POST /api/architect), server side so there is no CORS.
//   POST { description }  -> { ok, flow?, problems, usage? }   a validated flow built from existing node types
//   POST { flow }         -> { problems }                       validation of a hand-edited flow
// Model-level failures (ok: false + problems) come back as 200 so the UI can show the problems;
// only proxy failures are errors.
//   DELETE ?id=<workflowId> -> { deleted }  removes a workflow saved by the editor (source "db" only).

const TIMEOUT_MS = 120_000;
const DOWN = "The Architect needs the agent API running with ANTHROPIC_API_KEY (npm run dev -w api)";

export async function POST(req: NextRequest) {
  await connection();
  let body: { description?: unknown; flow?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }
  const payload = body.flow !== undefined
    ? { flow: body.flow }
    : typeof body.description === "string" && body.description.trim()
      ? { description: body.description.trim() }
      : null;
  if (!payload) return Response.json({ error: "send { description } or { flow }" }, { status: 400 });

  let res: Response;
  try {
    res = await fetch(`${agentUrl()}/api/architect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return Response.json(
      { error: timedOut ? `The Architect did not answer within ${TIMEOUT_MS / 1000}s. Try a shorter description.` : DOWN },
      { status: timedOut ? 504 : 503 },
    );
  }

  const text = await res.text();
  let data: Record<string, unknown> | null = null;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* not JSON: handled below */
  }
  if (data && (Array.isArray(data.problems) || "ok" in data)) return Response.json(data);
  if (res.status === 404) return Response.json({ error: `${DOWN}. (agent API has no /api/architect)` }, { status: 502 });
  const upstream = typeof data?.error === "string" ? data.error : text.slice(0, 300) || res.statusText;
  const missingKey = /anthropic|api[_ ]?key/i.test(upstream);
  return Response.json({ error: missingKey ? `${DOWN}. Agent said: ${upstream}` : `Architect failed (${res.status}): ${upstream}` }, { status: 502 });
}

export async function DELETE(req: NextRequest) {
  await connection();
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return Response.json({ error: "missing ?id=" }, { status: 400 });
  try {
    const db = getDb();
    const row = db.prepare("SELECT source FROM workflows WHERE id = ?").get(id) as { source?: unknown } | undefined;
    if (!row) return Response.json({ error: `no workflow "${id}"` }, { status: 404 });
    if (row.source !== "db") return Response.json({ error: "workflows read from apps/api/flows cannot be deleted" }, { status: 409 });
    db.prepare("DELETE FROM workflows WHERE id = ? AND source = 'db'").run(id);
    return Response.json({ deleted: id });
  } catch (err) {
    return jsonError(err);
  }
}
