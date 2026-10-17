// The one place the console learns where the voice layer's components live.
// Turbopack refuses to compile a dynamic import of a folder that does not exist yet, so the loaders are
// explicit. When apps/web/src/voice lands (voice plan Task 6), the voice layer adds one line per
// component here, e.g.
//   VoiceNoteButton: () => import("@/voice/VoiceNoteButton"),
//   CallDrawer: () => import("@/voice/CallDrawer"),
//   ApproveByVoice: () => import("@/voice/ApproveByVoice"),
// A missing entry, a failed import or a component that throws renders the "Voice not connected" placeholder.
// Components may also register at runtime with registerVoiceComponent() (e.g. from a dev bench).
import type { VoiceComponentName } from "./voiceSlots";

export const VOICE_LOADERS: Partial<Record<VoiceComponentName, () => Promise<Record<string, unknown>>>> = {
  VoiceNoteButton: () => import("@/voice/VoiceNoteButton"),
  CallDrawer: () => import("@/voice/CallDrawer"),
  ApproveByVoice: () => import("@/voice/ApproveByVoice"),
};

const registered = new Map<VoiceComponentName, unknown>();

export function registerVoiceComponent(name: VoiceComponentName, component: unknown) {
  registered.set(name, component);
}

export function registeredVoiceComponent(name: VoiceComponentName): unknown {
  return registered.get(name);
}
