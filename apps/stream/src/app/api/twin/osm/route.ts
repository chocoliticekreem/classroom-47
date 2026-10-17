import { loadGeometry } from "@/twin/osm";

export async function GET() {
  try {
    return Response.json(await loadGeometry());
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
