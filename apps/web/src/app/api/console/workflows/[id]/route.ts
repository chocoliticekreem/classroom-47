import type { NextRequest } from "next/server";
import type { WorkflowRecord } from "@/console/types";
import { jsonError } from "@/console/server/http";
import { getWorkflow, saveWorkflow, seedWorkflows } from "@/console/server/store";

// PUT /api/console/workflows/:id  body: WorkflowRecord -> { workflow }. Saved to SQLite (source "db");
// the files in apps/api/flows are never written.
export async function PUT(req: NextRequest, ctx: RouteContext<"/api/console/workflows/[id]">) {
  const { id } = await ctx.params;
  let body: Partial<WorkflowRecord>;
  try {
    body = (await req.json()) as Partial<WorkflowRecord>;
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }
  const flow = body.flow;
  if (!flow || !Array.isArray(flow.nodes) || !Array.isArray(flow.edges)) {
    return Response.json({ error: "body.flow must have nodes and edges arrays" }, { status: 400 });
  }
  try {
    await seedWorkflows();
    const prior = getWorkflow(id);
    const workflow = saveWorkflow(id, {
      name: body.name ?? flow.name ?? prior?.name ?? id,
      flow,
      positions: body.positions ?? prior?.positions ?? {},
      active: body.active ?? prior?.active ?? false,
    });
    return Response.json({ workflow });
  } catch (err) {
    return jsonError(err);
  }
}
