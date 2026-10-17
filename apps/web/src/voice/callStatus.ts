// The call's connection state in plain words for the call box. "disconnected" before a call reads as
// broken, so it says "ready".
const WORDS: Record<string, string> = { disconnected: "ready", connecting: "connecting", connected: "on the call", disconnecting: "ending" };

export function callStatusWord(status: string, agentSpeaking: boolean): string {
  const word = WORDS[status] ?? status;
  return status === "connected" && agentSpeaking ? `${word}, agent speaking` : word;
}
