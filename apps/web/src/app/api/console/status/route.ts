import { connection } from "next/server";
import { listCases } from "@/console/server/catalogue";
import { dbPath } from "@/console/server/db";
import { agentHealthy, agentUrl } from "@/console/server/execute";
import { jsonError } from "@/console/server/http";
import { ensureImported } from "@/console/server/importer";
import { counts, seedWorkflows } from "@/console/server/store";

// GET /api/console/status -> { agentApi, agentUrl, dbPath, counts }.
export async function GET() {
  await connection();
  try {
    const [agentApi, cases] = await Promise.all([agentHealthy(), listCases(), seedWorkflows(), ensureImported()]);
    const c = counts();
    for (const k of cases) c[`cases_${k.dataset}`] = (c[`cases_${k.dataset}`] ?? 0) + 1;
    return Response.json({ agentApi, agentUrl: agentUrl(), dbPath: dbPath(), counts: c });
  } catch (err) {
    return jsonError(err);
  }
}
