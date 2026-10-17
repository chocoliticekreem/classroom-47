import type { NextRequest } from "next/server";

const JAMCAM_YOLO_URL = process.env.JAMCAM_YOLO_URL ?? "http://127.0.0.1:8047";

export async function GET(request: NextRequest) {
  const ids = request.nextUrl.searchParams.get("ids") ?? "";
  try {
    const res = await fetch(`${JAMCAM_YOLO_URL}/tracks?ids=${encodeURIComponent(ids)}`, {
      signal: AbortSignal.timeout(4000),
    });
    return Response.json(await res.json(), { status: res.status });
  } catch {
    return Response.json(
      { error: `YOLO service unreachable at ${JAMCAM_YOLO_URL}. Start it: npm run yolo`, clips: [] },
      { status: 503 },
    );
  }
}
