import { connection, type NextRequest } from "next/server";
import path from "node:path";
import { jsonError } from "@/console/server/http";
import { answersDir } from "@/console/server/reality";
import { tryRunDir } from "@/console/server/realityTry";
import { DOWNLOAD_CAP_BYTES, isSafeRelPath, readTreeFile } from "@/console/server/answersTree";

// GET /api/console/reality/files/raw?path=<rel>[&source=try&run=<stamp>][&download=1]
//   -> { path, size, text, truncated } (text cut at 1 MB), or the whole file as an attachment.
// Only files found by listing the folder are served; ".." and absolute paths are refused.
export async function GET(req: NextRequest) {
  await connection();
  try {
    const sp = req.nextUrl.searchParams;
    let root = answersDir();
    if (sp.get("source") === "try") {
      const dir = tryRunDir(sp.get("run"));
      if (!dir) return Response.json({ error: "no such try run" }, { status: 400 });
      root = path.join(dir, "ANSWERS");
    }
    const rel = sp.get("path");
    if (!isSafeRelPath(rel)) return Response.json({ error: "bad path" }, { status: 400 });
    const download = sp.get("download") === "1";
    const file = await readTreeFile(root, rel, download ? DOWNLOAD_CAP_BYTES : undefined);
    if (!file) return Response.json({ error: "no such file" }, { status: 404 });
    if (download) {
      const name = file.path.split("/").join("-");
      const type = name.endsWith(".json") ? "application/json" : "text/plain";
      return new Response(file.text, {
        headers: { "content-type": `${type}; charset=utf-8`, "content-disposition": `attachment; filename="${name}"` },
      });
    }
    return Response.json(file);
  } catch (err) {
    return jsonError(err);
  }
}
