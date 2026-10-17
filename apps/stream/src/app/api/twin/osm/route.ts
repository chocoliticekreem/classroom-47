import { CACHE_STATIC, json } from "@/lib/server/json";
import { loadGeometry } from "@/twin/osm";

export async function GET(request: Request) {
  try {
    return json(await loadGeometry(), request, CACHE_STATIC);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
