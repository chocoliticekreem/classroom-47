import type { NextRequest } from "next/server";
import { connection } from "next/server";
import { buildView, listCases } from "@/console/server/catalogue";
import { pickerPage, pickerSetOf } from "@/console/server/cityCatalogue";
import { jsonError } from "@/console/server/http";

// The city's Practice cases picker.
// GET /api/console/city/catalogue?set&q&offset&limit -> { sets, total, matched, offset, cases } (50 a page)
// GET /api/console/city/catalogue?id&dataset         -> { case: { id, dataset, title, view } } (the eval's escalation view)
export async function GET(req: NextRequest) {
  await connection();
  try {
    const p = req.nextUrl.searchParams;
    const id = p.get("id");
    if (id) {
      const built = await buildView(id, p.get("dataset"));
      if (!built || !pickerSetOf(built.entry.dataset)) return Response.json({ error: "unknown case" }, { status: 404 });
      return Response.json({ case: { ...built.entry, view: built.view } });
    }
    return Response.json(pickerPage(await listCases(), { set: p.get("set"), q: p.get("q"), offset: p.get("offset"), limit: p.get("limit") }));
  } catch (err) {
    return jsonError(err);
  }
}
