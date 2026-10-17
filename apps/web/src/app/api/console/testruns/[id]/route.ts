import type { NextRequest } from "next/server";
import { jsonError } from "@/console/server/http";
import { getTestRun } from "@/console/server/testruns";

// GET /api/console/testruns/:id -> { testRun } with every case.
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/console/testruns/[id]">) {
  const { id } = await ctx.params;
  try {
    const testRun = getTestRun(id);
    if (!testRun) return Response.json({ error: `no test run ${id}` }, { status: 404 });
    return Response.json({ testRun });
  } catch (err) {
    return jsonError(err);
  }
}
