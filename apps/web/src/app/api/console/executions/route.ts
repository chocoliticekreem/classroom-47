import type { NextRequest } from "next/server";
import { jsonError } from "@/console/server/http";
import { ensureImported } from "@/console/server/importer";
import { listExecutions } from "@/console/server/store";

// GET /api/console/executions?limit&dataset -> { executions } (no trace/markdown bodies), newest first.
export async function GET(req: NextRequest) {
  try {
    await ensureImported();
    const limit = Number(req.nextUrl.searchParams.get("limit")) || undefined;
    const dataset = req.nextUrl.searchParams.get("dataset");
    return Response.json({ executions: listExecutions({ limit, dataset }) });
  } catch (err) {
    return jsonError(err);
  }
}
