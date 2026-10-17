import { jsonError } from "@/console/server/http";
import { CENTS_PER_CASE, stampFor, tryRoot } from "@/console/server/realityTry";
import { UPLOAD_MAX_BYTES, UploadError, pruneStaged, stageUpload, type UploadEntry } from "@/console/server/realityUpload";

// POST /api/console/reality/try/upload (multipart: "file" parts, each with a parallel "path" part
// holding its relative path) -> { upload: { id, cases, bytes }, centsPerCase }.
// Stages the cases under runs/reality-try/.uploads/<id>/cases/1..N; nothing runs until
// POST /api/console/reality/try { upload: id, budget }.
export async function POST(req: Request) {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > UPLOAD_MAX_BYTES + 1024 * 1024) return Response.json({ error: `The upload is over ${UPLOAD_MAX_BYTES / 1024 / 1024} MB.` }, { status: 413 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Send the files as multipart/form-data." }, { status: 400 });
  }
  const files = form.getAll("file");
  const paths = form.getAll("path");
  try {
    const entries: UploadEntry[] = [];
    let total = 0;
    for (const [i, f] of files.entries()) {
      if (typeof f === "string") continue;
      total += f.size;
      if (total > UPLOAD_MAX_BYTES) throw new UploadError(`The upload is over ${UPLOAD_MAX_BYTES / 1024 / 1024} MB.`);
      const p = typeof paths[i] === "string" && paths[i] ? (paths[i] as string) : f.name;
      entries.push({ path: p, data: new Uint8Array(await f.arrayBuffer()) });
    }
    if (!entries.length) throw new UploadError("No files in the upload.");
    await pruneStaged(tryRoot());
    const upload = await stageUpload(entries, tryRoot(), stampFor(new Date()));
    return Response.json({ upload, centsPerCase: CENTS_PER_CASE });
  } catch (err) {
    return jsonError(err, err instanceof UploadError ? 400 : 500);
  }
}
