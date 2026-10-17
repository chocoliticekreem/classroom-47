import type { NextRequest } from "next/server";

const YOLO_URL = process.env.YOLO_URL ?? "http://127.0.0.1:8047";

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id") ?? "";
  try {
    const res = await fetch(`${YOLO_URL}/frame?id=${encodeURIComponent(id)}`, {
      signal: AbortSignal.timeout(4000),
    });
    return new Response(res.body, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("Content-Type") ?? "image/jpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json({ error: `YOLO service unreachable at ${YOLO_URL}` }, { status: 503 });
  }
}
