import path from "node:path";
import { connection } from "next/server";
import { dbPath, getDb, repoRoot } from "@/console/server/db";
import { jsonError } from "@/console/server/http";
import { ensureImported } from "@/console/server/importer";
import { buildEvidencePack } from "@/console/export/report";
import { loadPackInput, type PackDb } from "@/console/export/reportData";

// GET /api/console/export/evidence-pack -> results.md: the real eval results per case set, in the
// eval/results.md layout. `node scripts/export-evidence.mjs` writes the same file into the repo.
export async function GET(req: Request) {
  await connection();
  try {
    await ensureImported();
    const label = path.relative(repoRoot(), dbPath()) || dbPath();
    const md = buildEvidencePack(loadPackInput(getDb() as unknown as PackDb, label));
    const inline = new URL(req.url).searchParams.get("view") === "1";
    return new Response(md, {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "cache-control": "no-store",
        ...(inline ? {} : { "content-disposition": 'attachment; filename="results.md"' }),
      },
    });
  } catch (err) {
    return jsonError(err);
  }
}
