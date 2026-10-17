// Small helpers shared by the /api/console route handlers.
export function jsonError(err: unknown, status = 500): Response {
  const message = err instanceof Error ? err.message : String(err);
  const code = typeof (err as { status?: unknown })?.status === "number" ? (err as { status: number }).status : status;
  const problems = (err as { problems?: unknown })?.problems;
  return Response.json(Array.isArray(problems) && problems.length ? { error: message, problems } : { error: message }, { status: code });
}

export async function readBody<T = Record<string, unknown>>(req: Request): Promise<T | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as T) : null;
  } catch {
    return null;
  }
}
