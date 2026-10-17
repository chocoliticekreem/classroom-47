import { jsonError } from "@/console/server/http";
import { importAll } from "@/console/server/importer";

// POST /api/console/import -> { imported }. Rescans ANSWERS/, runs/ and examples/practice-run/.
export async function POST() {
  try {
    return Response.json({ imported: await importAll() });
  } catch (err) {
    return jsonError(err);
  }
}
