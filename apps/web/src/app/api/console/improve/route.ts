import { jsonError, readBody } from "@/console/server/http";
import { improve } from "@/console/server/improve";

// POST /api/console/improve  body: { workflowId, testRunId } -> { proposal }. Calls the Architect; saves nothing.
export async function POST(req: Request) {
  const body = await readBody(req);
  if (!body) return Response.json({ error: "body must be a JSON object" }, { status: 400 });
  try {
    return Response.json({ proposal: await improve(body) });
  } catch (err) {
    return jsonError(err);
  }
}
