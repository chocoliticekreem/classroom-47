import { connection } from "next/server";
import { cachedEvidence } from "@/console/server/evidenceCache";
import { jsonError } from "@/console/server/http";
import { ensureImported, refreshAnswersIfChanged } from "@/console/server/importer";

// GET /api/console/evidence -> { rows, totals }: every case in every dataset with its latest run and verdict.
// Cached until the database or the catalogue changes; a new Reality run in ANSWERS/ is picked up on the next call.
export async function GET() {
  await connection();
  try {
    await ensureImported();
    await refreshAnswersIfChanged();
    return Response.json(await cachedEvidence());
  } catch (err) {
    return jsonError(err);
  }
}
