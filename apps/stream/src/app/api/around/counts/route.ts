import type { NextRequest } from "next/server";

const YOLO_URL = process.env.YOLO_URL ?? "http://127.0.0.1:8047";

export async function GET(request: NextRequest) {
  const ids = request.nextUrl.searchParams.get("ids") ?? "";
  try {
    const res = await fetch(`${YOLO_URL}/counts?ids=${encodeURIComponent(ids)}`, {
      signal: AbortSignal.timeout(4000),
    });
    return Response.json(await res.json(), { status: res.status });
  } catch {
    return Response.json(
      { error: `YOLO service unreachable at ${YOLO_URL}. Start it: npm run yolo`, readings: [] },
      { status: 503 },
    );
  }
}
