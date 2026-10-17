export type Archetype =
  | "hype"
  | "questioner"
  | "local"
  | "superfan"
  | "troll"
  | "mod";

export type Badge = "mod" | "vip" | "sub" | "founder" | "verified";

export interface Persona {
  id: string;
  username: string;
  color: string;
  archetype: Archetype;
  badges: Badge[];
  subMonths?: number;
}

export interface ChatMessage {
  id: string;
  personaId: string | null;
  username: string;
  color: string;
  badges: Badge[];
  text: string;
  timestamp: number;
  fromStreamer?: boolean;
  /** Message leaks or reacts to the streamer's physical location. */
  locationSignal?: boolean;
  highlight?: "donation" | "first" | "pinned";
  amount?: number;
}

export interface StreamLocation {
  id: string;
  name: string;
  area: string;
  lat: number;
  lon: number;
}

export type StreamSource =
  | { kind: "idle" }
  | { kind: "webcam" }
  | { kind: "url"; url: string; label: string }
  | { kind: "file"; url: string; label: string };

export interface StreamContext {
  streamer: string;
  title: string;
  location: StreamLocation;
  viewers: number;
  live: boolean;
  /** Set once the streamer has told chat where they are. */
  locationRevealedAt: number | null;
}
