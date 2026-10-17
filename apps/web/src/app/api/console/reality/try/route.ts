import { connection } from "next/server";
import { jsonError, readBody } from "@/console/server/http";
import { CENTS_PER_CASE, TRY_BUDGET_MAX_USD, TRY_BUDGET_USD, TRY_DEFAULT, TRY_MAX, deliveryRawDir, listTryRuns, rawCases, startTry, tryBudget, tryCount } from "@/console/server/realityTry";
import { UPLOAD_MAX_BYTES, UPLOAD_MAX_CASES } from "@/console/server/realityUpload";

// GET  /api/console/reality/try -> { runs (newest first), available, max, centsPerCase }
// POST /api/console/reality/try { n, budget } -> { run }: copies n raw Delivery practice cases to
// runs/reality-try/<stamp>/cases/1..n and runs `npm run reality` on them into runs/reality-try/<stamp>/ANSWERS.
// POST /api/console/reality/try { upload, budget } runs a staged upload (see ./upload) the same way.
export async function GET() {
  await connection();
  try {
    const track = await deliveryRawDir();
    const available = track ? (await rawCases(track)).length : 0;
    return Response.json({ runs: await listTryRuns(), available, max: TRY_MAX, defaultN: TRY_DEFAULT, centsPerCase: CENTS_PER_CASE,
      budgetUsd: TRY_BUDGET_USD, budgetMaxUsd: TRY_BUDGET_MAX_USD, uploadMaxBytes: UPLOAD_MAX_BYTES, uploadMaxCases: UPLOAD_MAX_CASES });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: Request) {
  const body = await readBody<{ n?: unknown; upload?: unknown; budget?: unknown }>(req);
  const n = tryCount(body?.n ?? TRY_DEFAULT);
  if (n === null) return Response.json({ error: "n must be a number of cases (1 to 10)." }, { status: 400 });
  const budgetUsd = tryBudget(body?.budget);
  if (budgetUsd === null) return Response.json({ error: `budget must be a number of dollars (up to ${TRY_BUDGET_MAX_USD}).` }, { status: 400 });
  if (body?.upload !== undefined && typeof body.upload !== "string") return Response.json({ error: "upload must be an upload id." }, { status: 400 });
  try {
    return Response.json({ run: await startTry(n, { upload: body?.upload as string | undefined, budgetUsd }) });
  } catch (err) {
    return jsonError(err);
  }
}
