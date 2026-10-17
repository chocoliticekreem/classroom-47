import type { NextRequest } from "next/server";
import { jsonError, readBody } from "@/console/server/http";
import { createVersion, listVersions } from "@/console/server/versions";

// GET /api/console/workflows/:id/versions -> { versions } newest first (v1 seeded from the current flow).
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/console/workflows/[id]/versions">) {
  const { id } = await ctx.params;
  try {
    return Response.json({ versions: await listVersions(id) });
  } catch (err) {
    return jsonError(err);
  }
}

// POST /api/console/workflows/:id/versions  body: { flow, createdBy, note, parentVersion } -> { version }
export async function POST(req: NextRequest, ctx: RouteContext<"/api/console/workflows/[id]/versions">) {
  const { id } = await ctx.params;
  const body = await readBody(req);
  if (!body) return Response.json({ error: "body must be a JSON object" }, { status: 400 });
  try {
    return Response.json({ version: await createVersion(id, body) });
  } catch (err) {
    return jsonError(err);
  }
}
