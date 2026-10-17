import type { NextRequest } from "next/server";
import path from "node:path";
import { jsonError } from "@/console/server/http";
import { realityFiles } from "@/console/server/reality";
import { tryCaseInput, tryRunDir } from "@/console/server/realityTry";

// GET /api/console/reality/:caseId -> { answerMd, reasoningMd }, read-only from ANSWERS/<caseId>/,
// or from runs/reality-try/<run>/ANSWERS/<caseId>/ with ?source=try&run=<stamp> (plus caseMd, the case input).
export async function GET(req: NextRequest, ctx: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await ctx.params;
  try {
    const sp = req.nextUrl.searchParams;
    const name = decodeURIComponent(caseId);
    if (sp.get("source") === "try") {
      const dir = tryRunDir(sp.get("run"));
      if (!dir) return Response.json({ error: "no such try run" }, { status: 400 });
      const files = await realityFiles(name, path.join(dir, "ANSWERS"));
      if (!files) return Response.json({ error: `no Reality case folder ${caseId}` }, { status: 404 });
      return Response.json({ ...files, caseMd: await tryCaseInput(dir, name) });
    }
    const files = await realityFiles(name);
    if (!files) return Response.json({ error: `no Reality case folder ${caseId}` }, { status: 404 });
    return Response.json(files);
  } catch (err) {
    return jsonError(err);
  }
}
