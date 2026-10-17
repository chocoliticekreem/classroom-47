// A voice note spoken in another language starts with "[spoken in <Language>]" (apps/api/src/voice/notes.ts).

/** The language a note was spoken in, or null when it was English or not marked. */
export function spokenLanguage(body: string): string | null {
  return /^\[spoken in ([^\]]+)\]/.exec(body)?.[1] ?? null;
}

/** The English machine translation a note in another language carries, or null. */
export function machineTranslation(body: string): string | null {
  return /\[English, machine translation: (.*)\]$/.exec(body)?.[1] ?? null;
}
