import { connection, type NextRequest } from "next/server";
import { jsonError } from "@/console/server/http";
import { ensureImported, refreshAnswersIfChanged } from "@/console/server/importer";
import { diskReport, realityReport } from "@/console/server/reality";
import { readTryRun, tryRunDir } from "@/console/server/realityTry";
import path from "node:path";

// GET /api/console/reality -> { cases, summary, runlog }: the Reality Test run in ANSWERS/
// (npm run reality), one row per case folder, re-imported whenever the folder changes.
// GET /api/console/reality?source=try&run=<stamp> -> the same for a "Try it now" run
// (runs/reality-try/<stamp>/ANSWERS, read from disk), plus { tryRun }.
export async function GET(req: NextRequest) {
  await connection();
  try {
    const sp = req.nextUrl.searchParams;
    if (sp.get("source") === "try") {
      const dir = tryRunDir(sp.get("run"));
      if (!dir) return Response.json({ error: "no such try run" }, { status: 400 });
      const tryRun = await readTryRun(dir);
      if (!tryRun) return Response.json({ error: "no such try run" }, { status: 404 });
      const report = await diskReport(path.join(dir, "ANSWERS"));
      return Response.json({ ...report, summary: { ...report.summary, total: Math.max(report.summary.total, tryRun.n) }, tryRun });
    }
    await ensureImported();
    await refreshAnswersIfChanged();
    return Response.json(await realityReport());
  } catch (err) {
    return jsonError(err);
  }
}
