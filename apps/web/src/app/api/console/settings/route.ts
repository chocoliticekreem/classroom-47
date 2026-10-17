import { connection } from "next/server";
import { jsonError } from "@/console/server/http";
import { settingsInfo } from "@/console/settings/server";

// GET /api/console/settings -> { agent, voice, secondOpinions, commit }. Presence only, never keys.
export async function GET() {
  await connection();
  try {
    return Response.json(await settingsInfo());
  } catch (err) {
    return jsonError(err);
  }
}
