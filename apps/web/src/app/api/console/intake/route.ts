import { after } from "next/server";
import { readBody } from "@/console/server/http";
import { execute } from "@/console/server/execute";
import { listExecutions } from "@/console/server/store";
import { ADHOC_DATASET, saveAdhoc } from "@/console/intake/adhoc";
import { parseIntakeRequest } from "@/console/intake/request";

// POST /api/console/intake  body: IntakeRequest (src/console/intake/request.ts) -> { caseId, executionId }.
// Saves the one-off case as runs/adhoc/<id>.json (dataset "adhoc") and starts it on the console
// execute path, the same one "Run a case" uses. It answers as soon as the run's "running" row
// exists, so the page can open Case runs and watch it; the run itself carries on after the response.
const ROW_WAIT_MS = 10_000;

export async function POST(req: Request) {
  const parsed = parseIntakeRequest(await readBody(req));
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const saved = await saveAdhoc(parsed.value);

  let failed: unknown = null;
  const run = execute({ caseId: saved.id, dataset: ADHOC_DATASET, workflowId: parsed.value.workflowId ?? null, mode: parsed.value.practice ? "demo" : null })
    .catch((err) => { failed = err; return null; });
  after(() => run);

  const until = Date.now() + ROW_WAIT_MS;
  while (Date.now() < until) {
    const row = listExecutions({ dataset: ADHOC_DATASET, limit: 50 }).find((e) => e.caseId === saved.id);
    if (row) return Response.json({ caseId: saved.id, executionId: row.id });
    if (failed) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  const message = failed instanceof Error ? failed.message : "The case was saved but the run did not start.";
  return Response.json({ caseId: saved.id, error: message }, { status: 502 });
}
