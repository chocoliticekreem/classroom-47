import type { Archetype } from "@/lib/types";

/** Wire format for POST /api/chat/scene. Shared by the route and useSceneChat. */
export interface SceneRequest {
  /** JPEG as a data URI or raw base64, ≤ 640 px wide. Omit when the canvas is tainted (cross-origin video). */
  frame?: string;
  /** Fallback when no frame could be captured client-side: the server grabs one from this clip. */
  videoUrl?: string;
  location: { name: string; area: string };
  viewers: number;
  topics: string[];
  personas: { username: string; archetype: Archetype }[];
}

export interface SceneDescription {
  scene: string;
  notable: string[];
  mood: string;
  safety_flags: string[];
}

export interface SceneLine {
  username: string;
  text: string;
  locationSignal?: boolean;
}

export interface SceneResponse extends SceneDescription {
  lines: SceneLine[];
  models: { vision: string; text: string };
  timings: { frameMs: number; visionMs: number; textMs: number };
}
