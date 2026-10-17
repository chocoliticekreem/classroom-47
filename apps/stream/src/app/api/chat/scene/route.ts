import type { NextRequest } from "next/server";
import type { SceneDescription, SceneLine, SceneRequest, SceneResponse } from "@/agents/chat-crowd/scene";
import { grabFrame } from "./frame";
import { complete, repairJson, salvageObjects, wandbConfig, WandbError, type WandbConfig } from "./wandb";

const MAX_FRAME_BYTES = 400_000;
const VISION_TIMEOUT_MS = 15_000;
const TEXT_TIMEOUT_MS = 15_000;
const MIN_LINES = 6;
const MAX_LINES = 12;
const MAX_LINE_CHARS = 140;

const VISION_PROMPT = `You describe a single frame from a live IRL stream for a chat-simulation. Reply with STRICT JSON only, no markdown, no prose:
{"scene": "<one sentence, max 25 words: where this looks like and what is happening>",
 "notable": ["<3-6 concrete things a viewer would react to: landmarks, weather, traffic, queues, buses, light, signage>"],
 "mood": "<one or two words>",
 "safety_flags": ["<only real hazards visible, e.g. collision, fire, crowd crush; usually empty>"]}
Rules: never describe or identify people's faces, identities, clothing brands or number plates. Describe the place, weather, movement and objects.`;

const TEXT_SYSTEM = `You write live chat for a London IRL stream. Viewers are UK Gen-Z: lowercase, short, slangy but readable ("bro", "nah", "W", "mad", "innit", "is that...?"), no hashtags, no emoji (at most one line in the whole batch may have one). Lines react to what is ACTUALLY on screen right now, mixing: recognising the place or landmark, the weather/light, traffic or crowds, jokes, and questions to the streamer. Never mention faces, identities, or anything personal about people on screen. No slurs, no hate, no sexual content. Never say you are an AI or a simulation.
Reply with STRICT JSON only: {"lines":[{"username":"<one of the given usernames>","text":"<max 120 chars>","locationSignal":<true only if the line names or guesses the exact place>}]}`;

function textPrompt(body: SceneRequest, scene: SceneDescription) {
  const personas = body.personas.map((p) => `${p.username} (${p.archetype})`).join(", ");
  const topics = body.topics.length ? body.topics.slice(-8).join(" | ") : "(none yet)";
  const count = Math.min(MAX_LINES, MIN_LINES + Math.floor(body.viewers / 1000));
  return `Streamer claims to be around: ${body.location.name}, ${body.location.area}. ${body.viewers} watching.
What is on screen: ${scene.scene}
Notable: ${scene.notable.join("; ") || "nothing specific"}
Mood: ${scene.mood}
Recent chat (do not repeat): ${topics}
Write ${count} lines. Use ONLY these usernames, each at most once, matching their archetype (hype shouts, questioner asks, local knows the area, superfan adores the streamer, troll teases lightly, mod keeps order): ${personas}`;
}

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

function decodeFrame(frame: string): Buffer | null {
  const base64 = frame.replace(/^data:image\/\w+;base64,/, "");
  if (!/^[A-Za-z0-9+/=\s]+$/.test(base64)) return null;
  const buf = Buffer.from(base64, "base64");
  return buf.length > 0 && buf.length <= MAX_FRAME_BYTES ? buf : null;
}

async function describe(cfg: WandbConfig, jpeg: Buffer): Promise<SceneDescription> {
  const raw = await complete(
    cfg,
    cfg.visionModel,
    [
      {
        role: "user",
        content: [
          { type: "text", text: VISION_PROMPT },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${jpeg.toString("base64")}` } },
        ],
      },
    ],
    { maxTokens: 400, timeoutMs: VISION_TIMEOUT_MS, temperature: 0.2 },
  );
  const parsed = repairJson<Partial<SceneDescription>>(raw);
  if (!parsed || typeof parsed.scene !== "string") {
    throw new WandbError(`vision model returned non-JSON: ${raw.slice(0, 120)}`, 502);
  }
  const strings = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((s) => s.trim()).slice(0, 8) : [];
  return {
    scene: parsed.scene.trim().slice(0, 200),
    notable: strings(parsed.notable),
    mood: typeof parsed.mood === "string" ? parsed.mood.trim().slice(0, 40) : "neutral",
    safety_flags: strings(parsed.safety_flags),
  };
}

async function writeLines(cfg: WandbConfig, body: SceneRequest, scene: SceneDescription): Promise<SceneLine[]> {
  const raw = await complete(
    cfg,
    cfg.textModel,
    [
      { role: "system", content: TEXT_SYSTEM },
      { role: "user", content: textPrompt(body, scene) },
    ],
    { maxTokens: 900, timeoutMs: TEXT_TIMEOUT_MS, temperature: 0.9 },
  );
  const parsed = repairJson<{ lines?: unknown }>(raw);
  const items: unknown[] = Array.isArray(parsed?.lines) ? parsed.lines : salvageObjects(raw);
  const allowed = new Set(body.personas.map((p) => p.username));
  const seen = new Set<string>();
  const lines: SceneLine[] = [];
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const { username, text, locationSignal } = item as Record<string, unknown>;
    if (typeof username !== "string" || typeof text !== "string") continue;
    if (!allowed.has(username) || seen.has(username)) continue;
    const clean = text.replace(/\s+/g, " ").trim().slice(0, MAX_LINE_CHARS);
    if (!clean) continue;
    seen.add(username);
    lines.push({ username, text: clean, locationSignal: locationSignal === true || undefined });
    if (lines.length >= MAX_LINES) break;
  }
  if (lines.length === 0) throw new WandbError(`text model returned no usable lines: ${raw.slice(0, 200)}`, 502);
  return lines;
}

export async function POST(request: NextRequest) {
  const cfg = wandbConfig();
  if (!cfg) return Response.json({ error: "WANDB_API_KEY not configured" }, { status: 501 });

  let body: SceneRequest;
  try {
    body = (await request.json()) as SceneRequest;
  } catch {
    return badRequest("body must be JSON");
  }
  if (!body.location?.name || !Array.isArray(body.personas) || body.personas.length === 0) {
    return badRequest("location and personas are required");
  }
  body.topics = Array.isArray(body.topics) ? body.topics.filter((t) => typeof t === "string") : [];
  body.viewers = Number.isFinite(body.viewers) ? body.viewers : 0;

  const t0 = Date.now();
  let jpeg: Buffer | null = null;
  try {
    if (body.frame) jpeg = decodeFrame(body.frame);
    else if (body.videoUrl) jpeg = await grabFrame(body.videoUrl);
  } catch (err) {
    return Response.json({ error: `frame grab failed: ${(err as Error).message}` }, { status: 502 });
  }
  if (!jpeg) return badRequest("frame must be a JPEG ≤ 400 KB, or videoUrl an https clip");
  const t1 = Date.now();

  try {
    const scene = await describe(cfg, jpeg);
    const t2 = Date.now();
    const lines = await writeLines(cfg, body, scene);
    const t3 = Date.now();
    const out: SceneResponse = {
      ...scene,
      lines,
      models: { vision: cfg.visionModel, text: cfg.textModel },
      timings: { frameMs: t1 - t0, visionMs: t2 - t1, textMs: t3 - t2 },
    };
    return Response.json(out, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const status = err instanceof WandbError ? (err.status === 429 ? 429 : 502) : 504;
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status });
  }
}
