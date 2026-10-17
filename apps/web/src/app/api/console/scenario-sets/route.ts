import { connection } from "next/server";
import { listCasesWithMutation } from "@/console/server/catalogue";
import { jsonError } from "@/console/server/http";
import { listSets } from "@/console/server/scenarios";

// GET /api/console/scenario-sets -> { sets: [{ id, label, count, filters? }] }. Filters are mutation names.
export async function GET() {
  await connection();
  try {
    return Response.json({ sets: listSets(await listCasesWithMutation()) });
  } catch (err) {
    return jsonError(err);
  }
}
