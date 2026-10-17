import type { NextRequest } from "next/server";
import { listCases } from "@/console/server/catalogue";
import { jsonError } from "@/console/server/http";

// GET /api/console/cases?dataset&q -> { cases }. Datasets: public, generated, grounded, fixtures.
export async function GET(req: NextRequest) {
  try {
    const p = req.nextUrl.searchParams;
    return Response.json({ cases: await listCases(p.get("dataset"), p.get("q")) });
  } catch (err) {
    return jsonError(err);
  }
}
