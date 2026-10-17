import { connection } from "next/server";
import { listCases } from "@/console/server/catalogue";
import { buildEvidence } from "@/console/server/evidence";
import { jsonError } from "@/console/server/http";
import { ensureImported } from "@/console/server/importer";
import { allExecutions } from "@/console/server/store";
import { resultsCsv } from "@/console/export/csv";

// GET /api/console/export/results.csv -> every case in every dataset with its latest real run:
// outcome, right/wrong against the answer key, score, cost and time. Simulated runs are left out.
export async function GET() {
  await connection();
  try {
    await ensureImported();
    const { rows } = buildEvidence(await listCases(), allExecutions());
    const day = new Date().toISOString().slice(0, 10);
    return new Response(resultsCsv(rows), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="rivet-results-${day}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return jsonError(err);
  }
}
