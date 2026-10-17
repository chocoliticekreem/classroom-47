// Pure helpers for the voice UI: the live call transcript, and what to tell the user when the
// microphone cannot be used (they can always type the note instead).

export interface Line { role: "user" | "agent"; message: string }

/** Adds one final message from the call. Anything empty or not from the user or the agent is ignored. */
export function transcriptReducer(lines: Line[], msg: unknown): Line[] {
  if (!msg || typeof msg !== "object") return lines;
  const { message, role } = msg as { message?: unknown; role?: unknown };
  if (typeof message !== "string" || !message.trim()) return lines;
  if (role !== "user" && role !== "agent") return lines;
  // The voice model can write expression tags ("[happy]", "[laughs]") into what it says: not words.
  const text = role === "agent" ? message.replace(/\s*\[[a-z][a-z ]{1,24}\]/gi, "").replace(/\s{2,}/g, " ").trim() : message.trim();
  return text ? [...lines, { role, message: text }] : lines;
}

export function micErrorMessage(err: unknown): string {
  const name = err instanceof Error || (typeof DOMException !== "undefined" && err instanceof DOMException) ? (err as Error).name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Microphone blocked: type the note instead";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No microphone found: type the note instead";
  return "Recording failed: type the note instead";
}
