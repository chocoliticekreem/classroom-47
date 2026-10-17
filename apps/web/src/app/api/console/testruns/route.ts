import type { NextRequest } from "next/server";
import { jsonError, readBody } from "@/console/server/http";
import { listTestRuns, startTestRun, type StartBody } from "@/console/server/testruns";

// POST /api/console/testruns  body: { workflowId, version?, set, filter?, caseIds?, limit? (default 5, max 20) }
// -> { testRun } at once; the cases run in the background (poll GET /api/console/testruns/:id).
export async function POST(req: Request) {
  const body = await readBody<StartBody>(req);
  if (!body) return Response.json({ error: "body must be a JSON object" }, { status: 400 });
  try {
    return Response.json({ testRun: await startTestRun(body) });
  } catch (err) {
    return jsonError(err);
  }
}

// GET /api/console/testruns?workflowId -> { testRuns } without their cases, newest first.
export async function GET(req: NextRequest) {
  try {
    return Response.json({ testRuns: listTestRuns(req.nextUrl.searchParams.get("workflowId")) });
  } catch (err) {
    return jsonError(err);
  }
}
