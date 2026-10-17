import { agentUrl } from "@/console/server/execute";

// POST /api/console/intake/transcribe  multipart: "audio" (a recording), "from" (who is speaking).
// Forwards to the agent API's speech-to-text (POST /api/voice/note) as an audio file that came with
// the case, so the browser needs no cross-origin call. -> { text, unclear } or { error }.
const MAX_AUDIO_BYTES = 25_000_000;

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Send the recording as a file." }, { status: 400 });
  }
  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) return Response.json({ error: "No recording was sent." }, { status: 400 });
  if (audio.size > MAX_AUDIO_BYTES) return Response.json({ error: "The recording is too large (25 MB max)." }, { status: 413 });

  const out = new FormData();
  out.set("audio", audio, audio instanceof File ? audio.name : "call.webm");
  out.set("mode", "demo");
  out.set("source", "audio_attachment");
  // A recording that came with the case can be in any language: detect it, and show the English too.
  out.set("languageCode", "auto");
  out.set("from", String(form.get("from") ?? "Caller"));
  out.set("caseText", String(form.get("caseText") ?? ""));
  try {
    const res = await fetch(`${agentUrl()}/api/voice/note`, { method: "POST", body: out, signal: AbortSignal.timeout(120_000) });
    const body = (await res.json().catch(() => ({}))) as { event?: { body?: string }; error?: string };
    if (!res.ok || !body.event?.body) {
      return Response.json({ error: body.error ? `Could not transcribe: ${body.error}` : "Could not transcribe the recording." }, { status: 502 });
    }
    const unclear = body.event.body.startsWith("[unclear transcription]");
    return Response.json({ text: body.event.body, unclear });
  } catch {
    return Response.json({ error: "The transcription service did not answer." }, { status: 502 });
  }
}
