import type { NextRequest } from "next/server";

const JAMCAM_YOLO_URL = process.env.JAMCAM_YOLO_URL ?? "http://127.0.0.1:8047";

export async function POST(request: NextRequest) {
  try {
    const res = await fetch(`${JAMCAM_YOLO_URL}/follow/frame?${request.nextUrl.searchParams.toString()}`, {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: await request.arrayBuffer(),
      signal: AbortSignal.timeout(8000),
    });
    return Response.json(await res.json(), { status: res.status });
  } catch {
    return Response.json(
      { error: `YOLO service unreachable at ${JAMCAM_YOLO_URL}. Start it: npm run yolo`, people: [], followers: 0 },
      { status: 503 },
    );
  }
}
