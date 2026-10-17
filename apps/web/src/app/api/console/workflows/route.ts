import { connection } from "next/server";
import { jsonError } from "@/console/server/http";
import { listWorkflows } from "@/console/server/store";

// GET /api/console/workflows -> { workflows }. Seeds from apps/api/flows/*.json; editor saves win.
export async function GET() {
  await connection();
  try {
    return Response.json({ workflows: await listWorkflows() });
  } catch (err) {
    return jsonError(err);
  }
}
