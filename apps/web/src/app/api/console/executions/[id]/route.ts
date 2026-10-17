import type { NextRequest } from "next/server";
import { jsonError } from "@/console/server/http";
import { ensureImported } from "@/console/server/importer";
import { getExecution } from "@/console/server/store";

// GET /api/console/executions/:id -> { execution } with trace, ANSWER.md and REASONING.md.
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/console/executions/[id]">) {
  const { id } = await ctx.params;
  try {
    await ensureImported();
    const execution = getExecution(id);
    if (!execution) return Response.json({ error: `no execution ${id}` }, { status: 404 });
    return Response.json({ execution });
  } catch (err) {
    return jsonError(err);
  }
}
