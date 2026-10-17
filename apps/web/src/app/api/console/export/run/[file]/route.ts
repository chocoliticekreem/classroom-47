import type { NextRequest } from "next/server";
import { findCase } from "@/console/server/catalogue";
import { jsonError } from "@/console/server/http";
import { ensureImported } from "@/console/server/importer";
import { getExecution } from "@/console/server/store";
import { runBaseName, runFiles } from "@/console/export/runFiles";
import { makeZip } from "@/console/export/zip";

// GET /api/console/export/run/:id.zip  -> ANSWER.md, steps.md, trace.json, messages.json, run.json
//                                        (+ REASONING.md when stored), all from the stored run.
// GET /api/console/export/run/:id.json -> the same files as one JSON download: { files: { name: content } }.
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/console/export/run/[file]">) {
  const { file } = await ctx.params;
  const m = /^(.+)\.(zip|json)$/.exec(decodeURIComponent(file));
  if (!m) return Response.json({ error: "ask for <run id>.zip or <run id>.json" }, { status: 400 });
  const [, id, kind] = m;
  try {
    await ensureImported();
    const stored = getExecution(id);
    if (!stored) return Response.json({ error: `no run ${id}` }, { status: 404 });
    // Console runs store no title; the case file has one.
    const title = stored.title && stored.title !== stored.caseId ? stored.title : ((await findCase(stored.caseId, stored.dataset))?.title ?? stored.title);
    const execution = { ...stored, title };
    const files = runFiles(execution);
    const base = runBaseName(execution);
    const headers = { "cache-control": "no-store", "content-disposition": `attachment; filename="${base}.${kind}"` };
    if (kind === "json") {
      return Response.json({ files: Object.fromEntries(files.map((f) => [f.name, f.content])) }, { headers });
    }
    const zip = makeZip(files.map((f) => ({ name: `${base}/${f.name}`, content: f.content })));
    return new Response(zip.buffer as ArrayBuffer, { headers: { ...headers, "content-type": "application/zip" } });
  } catch (err) {
    return jsonError(err);
  }
}
