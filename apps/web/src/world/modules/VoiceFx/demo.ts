// window.__cityVoiceDemo(): a scripted voice sequence on the bus, so the city's voice effects can be shown
// before the voice layer lands. Every line is a simulated persona (labelled SIMULATED in the city).
// It never touches the agent, the console or any case data. Returns a cancel function.
import type { WorldEvent } from "../../bus";

export interface DemoStep {
  atMs: number;
  event: WorldEvent;
}

const LINES: { speaker: "desk_agent" | "driver"; text: string; durationMs: number }[] = [
  { speaker: "desk_agent", text: "Hi, this is the delivery desk assistant, an AI. This call is recorded for the case log. Are you safe to talk?", durationMs: 5200 },
  { speaker: "driver", text: "Yeah, I'm pulled over. The loading bay at Plover Arc is shut and nobody's answering the buzzer.", durationMs: 4600 },
  { speaker: "desk_agent", text: "Thanks. I can't promise a redelivery time, but I'll pass this to the team that owns the booking now.", durationMs: 4800 },
  { speaker: "driver", text: "Okay. I'll send you a voice note with the photo reference.", durationMs: 3000 },
];

/** The scripted sequence for one case and call (pure, so the order and timing are testable). */
export function demoScript(caseId: string, callId: string): DemoStep[] {
  const src = "simulated_persona" as const;
  const steps: DemoStep[] = [
    { atMs: 0, event: { type: "call:ringing", caseId, callId, caller: "desk_agent", callee: "driver", source: src, purpose: "Driver reports the loading bay is shut" } },
    { atMs: 3200, event: { type: "call:connected", caseId, callId } },
  ];
  let t = 3600;
  LINES.forEach((l, i) => {
    steps.push({ atMs: t, event: { type: "voice:utterance", caseId, callId, seq: i + 1, speaker: l.speaker, text: l.text, source: src, durationMs: l.durationMs } });
    t += l.durationMs + 450;
  });
  steps.push({ atMs: t, event: { type: "call:ended", caseId, callId, reason: "completed", summary: "Driver at Plover Arc: loading bay shut. Passed to the booking owner." } });
  t += 1500;
  steps.push({ atMs: t, event: { type: "voice:note_in", caseId, noteId: `${callId}-note`, from: "driver", source: src, transcript: "Photo ref P-2231, bay door down, no one on site.", durationMs: 2800 } });
  t += 3400;
  steps.push({
    atMs: t,
    event: {
      type: "decision:needed", caseId,
      card: {
        cardId: `${caseId}-card`, summary: "Bay shut at Plover Arc. Hold the parcel at the depot or reattempt tomorrow?",
        options: [{ id: "option-1", label: "Hold at depot", safe: true }, { id: "option-2", label: "Reattempt tomorrow" }],
        routeTo: "Desk manager", deadlineMs: 10 * 60_000, fallbackOptionId: "option-1",
      },
    },
  });
  t += 2600;
  steps.push({ atMs: t, event: { type: "decision:voice", caseId, optionId: "option-1", by: "manager", source: src, callId: `${callId}-approval` } });
  return steps;
}

/** Plays a script on the bus with timers. Returns cancel. */
export function playScript(steps: DemoStep[], emit: (e: WorldEvent) => void): () => void {
  const timers = steps.map((s) => setTimeout(() => emit(s.event), s.atMs));
  return () => timers.forEach(clearTimeout);
}
