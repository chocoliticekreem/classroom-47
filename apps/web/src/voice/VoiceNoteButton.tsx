"use client";
// Record a voice note (for example a driver who cannot type) and turn it into a case event. If the
// microphone is blocked or missing, the same note can be typed instead. The speaker can use any language:
// "Any language" lets the transcriber detect it, and the note says which one was heard.
import { useRef, useState } from "react";
import { sendRecordedNote, sendTypedNote, type ViewEvent, type VoiceSource } from "./api";
import { machineTranslation, spokenLanguage } from "./language";
import { micErrorMessage } from "./transcript";

const LANG_KEY = "rivet-note-language";
const extensionFor = (mime: string) => (mime.includes("ogg") ? "ogg" : mime.includes("mp4") ? "m4a" : "webm");

// The console's slot passes { caseId, from, onEvent }: number and time are optional, because the
// re-run builder renumbers new events and stamps them on the case's own timeline.
export function VoiceNoteButton({ from, caseId, caseText, languageCode = "auto", n = 0, at = "", source = "live_human", recordLabel = "🎙 Record voice note", onEvent }: {
  from: string;
  /** The record button's text, for example "🎙 Record as the driver". */
  recordLabel?: string;
  caseId?: string;
  /** The case so far, when known; otherwise the server looks it up by caseId. */
  caseText?: string;
  languageCode?: string;
  n?: number;
  at?: string;
  source?: VoiceSource;
  onEvent: (event: ViewEvent) => void;
}) {
  const [state, setState] = useState<"idle" | "recording" | "sending">("idle");
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  // The last choice is remembered on this browser, so a desk that works in several languages keeps it.
  const [lang, setLang] = useState(() => {
    try { return localStorage.getItem(LANG_KEY) ?? languageCode; } catch { return languageCode; }
  });
  const [heard, setHeard] = useState<{ language: string; english: string | null } | null>(null);
  const chooseLang = (value: string) => {
    setLang(value);
    try { localStorage.setItem(LANG_KEY, value); } catch { /* the choice still applies to this note */ }
  };
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  async function start() {
    setError(null);
    setHeard(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunks.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const mime = rec.mimeType || "audio/webm";
        setState("sending");
        try {
          const event = await sendRecordedNote({ audio: new Blob(chunks.current, { type: mime }), filename: `voice-note.${extensionFor(mime)}`, from, n, at, source, caseId, caseText, languageCode: lang });
          const language = spokenLanguage(event.body);
          setHeard(language ? { language, english: machineTranslation(event.body) } : null);
          onEvent(event);
        } catch (err) {
          setError(err instanceof Error ? err.message : "The voice note could not be sent");
        } finally {
          setState("idle");
        }
      };
      recorder.current = rec;
      rec.start();
      setState("recording");
    } catch (err) {
      setError(micErrorMessage(err));
    }
  }

  async function sendTyped() {
    if (!typed.trim()) return;
    setState("sending");
    try {
      onEvent(await sendTypedNote({ transcript: typed, from, n, at, source, caseId, caseText, languageCode: lang }));
      setTyped("");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The note could not be sent");
    } finally {
      setState("idle");
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-[#2a2a30] p-3 text-sm text-white">
      <div className="flex items-center gap-2">
        <span className="text-white/60">Voice note from {from}</span>
        {source === "simulated_persona" && <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-300">Simulated</span>}
        <label className="ml-auto flex items-center gap-1 text-[12px] text-white/50">
          Speaks
          <select value={lang} onChange={(e) => chooseLang(e.target.value)} disabled={state !== "idle"}
            className="rounded bg-black/30 px-1 py-0.5 text-white">
            <option value="en">English</option>
            <option value="auto">Any language</option>
          </select>
        </label>
      </div>
      {state === "recording" ? (
        <button type="button" onClick={() => recorder.current?.stop()} className="rounded bg-red-600 px-3 py-1.5 font-medium">● Stop and send</button>
      ) : (
        <button type="button" onClick={start} disabled={state === "sending"} className="rounded bg-[#ff6a1a] px-3 py-1.5 font-medium disabled:opacity-50">
          {state === "sending" ? "Transcribing…" : recordLabel}
        </button>
      )}
      {heard && (
        <div className="text-[12px] text-white/60">
          <p>Heard in {heard.language}. The desk works in English and keeps the driver&apos;s words.</p>
          {heard.english && <p className="mt-1 text-white/85">In English (machine translation): {heard.english}</p>}
        </div>
      )}
      {error && (
        <div className="flex flex-col gap-2">
          <p className="text-amber-300">{error}</p>
          <textarea value={typed} onChange={(e) => setTyped(e.target.value)} rows={2} placeholder="Type the note"
            className="rounded bg-black/30 p-2 text-white placeholder:text-white/30" />
          <button type="button" onClick={sendTyped} disabled={!typed.trim() || state === "sending"} className="rounded border border-white/20 px-3 py-1.5 disabled:opacity-50">Send typed note</button>
        </div>
      )}
    </div>
  );
}
