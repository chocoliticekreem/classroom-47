import { connection, type NextRequest } from "next/server";
import path from "node:path";
import { jsonError } from "@/console/server/http";
import { answersDir } from "@/console/server/reality";
import { tryRunDir } from "@/console/server/realityTry";
import { answersTree } from "@/console/server/answersTree";

// GET /api/console/reality/files[?source=try&run=<stamp>] -> { root, tree }: the ANSWERS/ folder
// (or a try run's) as a file tree. Read-only; built by listing directories.
export async function GET(req: NextRequest) {
  await connection();
  try {
    const sp = req.nextUrl.searchParams;
    let root = answersDir();
    let label = "ANSWERS";
    if (sp.get("source") === "try") {
      const dir = tryRunDir(sp.get("run"));
      if (!dir) return Response.json({ error: "no such try run" }, { status: 400 });
      root = path.join(dir, "ANSWERS");
      label = `runs/reality-try/${sp.get("run")}/ANSWERS`;
    }
    return Response.json({ root: label, tree: await answersTree(root) });
  } catch (err) {
    return jsonError(err);
  }
}
