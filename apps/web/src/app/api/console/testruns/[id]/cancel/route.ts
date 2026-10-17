import type { NextRequest } from "next/server";
import { jsonError } from "@/console/server/http";
import { cancelTestRun } from "@/console/server/testruns";

// POST /api/console/testruns/:id/cancel -> { ok: true }. No new case starts; cases already running finish.
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/console/testruns/[id]/cancel">) {
  const { id } = await ctx.params;
  try {
    if (!cancelTestRun(id)) return Response.json({ error: `no test run ${id}` }, { status: 404 });
    return Response.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
