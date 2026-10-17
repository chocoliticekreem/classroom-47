// VoiceFx: pure mapping from bus events to city effects (PRD J3). No three.js, no React; the module
// renders whatever this state holds and resolves anchors to positions each frame.
//
//   scenario:staged  -> remembers where each case happened (and its van, if any)
//   call:ringing     -> a ringing phone above caller and callee, camera flies to the callee
//   call:connected   -> phones stop ringing (steady icon)
//   voice:utterance  -> a speech bubble on the speaking party (text revealed per the transcript-sync rules)
//   call:ended       -> phones and bubble fade out
//   voice:note_in    -> an envelope flies from the sender (driver) to the depot
//   decision:voice   -> an approval flash on the manager (depot) and on the HUD
// Everything voiced by a simulated persona carries simulated: true and is labelled SIMULATED.
import type { Party, VoiceSource, WorldEvent } from "../../bus";

export interface Point {
  x: number;
  z: number;
}

/** Where an effect sits: a live vehicle from the registry (with a fallback point), or a fixed point. */
export type Anchor = { kind: "vehicle"; vehicleId: string; fallback: Point } | { kind: "point"; x: number; z: number };

/** The depot (ZONES.depot centre): dispatch, the desk agent and the manager live here. */
export const DEPOT: Point = { x: 0, z: 285 };
/** Where a case with no staged scene happens (downtown centre). */
export const CITY_CENTRE: Point = { x: 0, z: 0 };
/** Effects fade over this long after their call ends. */
export const FADE_MS = 1200;
export const ENVELOPE_MS = 2600;
export const FLASH_MS = 2200;
/** A phone that rings this long without an answer is dropped. */
export const RING_TIMEOUT_MS = 60_000;

export interface Staged {
  runId: string;
  scenarioId: string;
  x: number;
  z: number;
  vehicleId?: string;
}

export interface PhoneFx {
  id: string;
  callId: string;
  party: Party;
  role: "caller" | "callee";
  anchor: Anchor;
  startedAt: number;
  connectedAt: number | null;
  endedAt: number | null;
  simulated: boolean;
}

export interface BubbleFx {
  id: string;
  callId: string;
  seq: number;
  speaker: Party;
  anchor: Anchor;
  startedAt: number;
  endedAt: number | null;
  simulated: boolean;
}

export interface EnvelopeFx {
  id: string;
  noteId: string;
  from: Anchor;
  to: Anchor;
  startedAt: number;
  simulated: boolean;
  label: string;
}

export interface FlashFx {
  id: string;
  caseId: string;
  optionId: string;
  by: Party;
  anchor: Anchor;
  startedAt: number;
  simulated: boolean;
}

interface CallCtx {
  caseId: string;
  caller: Party;
  callee: Party;
  callerAnchor: Anchor;
  calleeAnchor: Anchor;
  simulated: boolean;
}

export interface FxState {
  staged: Record<string, Staged>; // by runId
  latestStaged: string | null; // runId
  /** Anchors bound directly to a case id (e.g. by the scripted demo). */
  bound: Record<string, Staged>;
  calls: Record<string, CallCtx>;
  phones: PhoneFx[];
  bubbles: BubbleFx[];
  envelopes: EnvelopeFx[];
  flashes: FlashFx[];
}

export interface HudFlash {
  caseId: string;
  optionId: string;
  by: Party;
  simulated: boolean;
}

export interface FxResult {
  state: FxState;
  /** Fly the camera here (resolve a vehicle anchor to its current position). */
  focus?: Anchor;
  /** Flash the HUD (decision approved by voice). */
  hudFlash?: HudFlash;
}

export const emptyFx = (): FxState => ({
  staged: {}, latestStaged: null, bound: {}, calls: {}, phones: [], bubbles: [], envelopes: [], flashes: [],
});

const isSimulated = (s: VoiceSource) => s === "simulated_persona";
const DESK_ROLES = new Set(["manager", "dispatch", "desk_agent"]);
const MAX_STAGED = 30;

/** The staged scene a case belongs to: bound directly, by run id, by scenario id inside the case id, else the latest. */
export function stagedFor(s: FxState, caseId: string): Staged | null {
  if (s.bound[caseId]) return s.bound[caseId];
  if (s.staged[caseId]) return s.staged[caseId];
  const runs = Object.values(s.staged);
  const hit = runs.find((r) => caseId.includes(r.runId)) ?? runs.find((r) => caseId.includes(r.scenarioId));
  if (hit) return hit;
  return s.latestStaged ? s.staged[s.latestStaged] ?? null : null;
}

/**
 * Where a party is in the city:
 * - a registered vehicle id (the party string itself) -> that vehicle;
 * - manager, dispatch, the desk agent -> the depot;
 * - the driver -> the case's van if the scene has one, else the scene;
 * - anyone else (the recipient, a named person) -> the case's scene, a few metres off, else downtown.
 */
export function partyAnchor(s: FxState, caseId: string, party: Party, isVehicle: (id: string) => boolean): Anchor {
  const p = String(party);
  if (isVehicle(p)) return { kind: "vehicle", vehicleId: p, fallback: CITY_CENTRE };
  if (DESK_ROLES.has(p)) return { kind: "point", ...DEPOT };
  const st = stagedFor(s, caseId);
  if (p === "driver") {
    if (st?.vehicleId) return { kind: "vehicle", vehicleId: st.vehicleId, fallback: { x: st.x, z: st.z } };
    return st ? { kind: "point", x: st.x, z: st.z } : { kind: "point", ...DEPOT };
  }
  return st ? { kind: "point", x: st.x + 6, z: st.z + 6 } : { kind: "point", ...CITY_CENTRE };
}

let seq = 0;
const fxId = (p: string) => `${p}-${(seq = (seq + 1) % 1e9)}`;

/** Applies one bus event. `isVehicle` asks the registry whether an id is a live vehicle. */
export function fxReduce(s: FxState, e: WorldEvent, now: number, isVehicle: (id: string) => boolean = () => false): FxResult {
  switch (e.type) {
    case "scenario:staged": {
      const staged = { ...s.staged, [e.runId]: { runId: e.runId, scenarioId: e.scenarioId, x: e.x, z: e.z, ...(e.vehicleId ? { vehicleId: e.vehicleId } : {}) } };
      const keys = Object.keys(staged);
      for (const k of keys.slice(0, Math.max(0, keys.length - MAX_STAGED))) delete staged[k];
      return { state: { ...s, staged, latestStaged: e.runId } };
    }
    case "call:ringing": {
      const callerAnchor = partyAnchor(s, e.caseId, e.caller, isVehicle);
      const calleeAnchor = partyAnchor(s, e.caseId, e.callee, isVehicle);
      const simulated = isSimulated(e.source);
      const ctx: CallCtx = { caseId: e.caseId, caller: e.caller, callee: e.callee, callerAnchor, calleeAnchor, simulated };
      const phones = s.phones.filter((p) => p.callId !== e.callId);
      phones.push(
        { id: fxId("phone"), callId: e.callId, party: e.caller, role: "caller", anchor: callerAnchor, startedAt: now, connectedAt: null, endedAt: null, simulated },
        { id: fxId("phone"), callId: e.callId, party: e.callee, role: "callee", anchor: calleeAnchor, startedAt: now, connectedAt: null, endedAt: null, simulated },
      );
      return { state: { ...s, calls: { ...s.calls, [e.callId]: ctx }, phones }, focus: calleeAnchor };
    }
    case "call:connected": {
      if (!s.calls[e.callId]) return { state: s };
      return { state: { ...s, phones: s.phones.map((p) => (p.callId === e.callId && p.connectedAt === null ? { ...p, connectedAt: now } : p)) } };
    }
    case "voice:utterance": {
      let calls = s.calls;
      let ctx = calls[e.callId];
      if (!ctx) {
        // An utterance with no ringing seen (joined late): place the call from the case.
        const a = partyAnchor(s, e.caseId, e.speaker, isVehicle);
        ctx = { caseId: e.caseId, caller: e.speaker, callee: e.speaker, callerAnchor: a, calleeAnchor: a, simulated: isSimulated(e.source) };
        calls = { ...calls, [e.callId]: ctx };
      }
      const anchor = e.speaker === ctx.caller ? ctx.callerAnchor : e.speaker === ctx.callee ? ctx.calleeAnchor : partyAnchor(s, e.caseId, e.speaker, isVehicle);
      // One bubble per speaker per call: the newest line replaces that speaker's previous one.
      const bubbles = s.bubbles.filter((b) => !(b.callId === e.callId && b.speaker === e.speaker));
      bubbles.push({ id: fxId("bubble"), callId: e.callId, seq: e.seq, speaker: e.speaker, anchor, startedAt: now, endedAt: null, simulated: isSimulated(e.source) || ctx.simulated });
      return { state: { ...s, calls, bubbles } };
    }
    case "call:ended": {
      const end = <T extends { callId: string; endedAt: number | null }>(x: T): T => (x.callId === e.callId && x.endedAt === null ? { ...x, endedAt: now } : x);
      return { state: { ...s, phones: s.phones.map(end), bubbles: s.bubbles.map(end) } };
    }
    case "voice:note_in": {
      const env: EnvelopeFx = {
        id: fxId("note"), noteId: e.noteId,
        from: partyAnchor(s, e.caseId, e.from, isVehicle),
        to: { kind: "point", ...DEPOT },
        startedAt: now, simulated: isSimulated(e.source),
        label: `Voice note from ${String(e.from)}`,
      };
      return { state: { ...s, envelopes: [...s.envelopes, env] } };
    }
    case "decision:voice": {
      const by = e.by || "manager";
      const anchor = partyAnchor(s, e.caseId, DESK_ROLES.has(String(by)) ? by : "manager", isVehicle);
      const simulated = isSimulated(e.source);
      const flash: FlashFx = { id: fxId("flash"), caseId: e.caseId, optionId: e.optionId, by, anchor, startedAt: now, simulated };
      return { state: { ...s, flashes: [...s.flashes, flash] }, hudFlash: { caseId: e.caseId, optionId: e.optionId, by, simulated } };
    }
    default:
      return { state: s };
  }
}

/** Drops finished effects. Returns the same object when nothing changed (so callers can skip a re-render). */
export function fxPrune(s: FxState, now: number): FxState {
  const phones = s.phones.filter((p) => (p.endedAt === null ? p.connectedAt !== null || now - p.startedAt < RING_TIMEOUT_MS : now - p.endedAt < FADE_MS));
  const bubbles = s.bubbles.filter((b) => b.endedAt === null || now - b.endedAt < FADE_MS);
  const envelopes = s.envelopes.filter((v) => now - v.startedAt < ENVELOPE_MS + FADE_MS);
  const flashes = s.flashes.filter((f) => now - f.startedAt < FLASH_MS);
  const liveCalls = new Set([...phones.map((p) => p.callId), ...bubbles.map((b) => b.callId)]);
  const callIds = Object.keys(s.calls);
  const keep = callIds.filter((id) => liveCalls.has(id));
  if (phones.length === s.phones.length && bubbles.length === s.bubbles.length && envelopes.length === s.envelopes.length
    && flashes.length === s.flashes.length && keep.length === callIds.length) return s;
  const calls: FxState["calls"] = {};
  for (const id of keep) calls[id] = s.calls[id];
  return { ...s, phones, bubbles, envelopes, flashes, calls };
}

/** 0..1 fade-out multiplier for an effect that ended at `endedAt`. */
export function fadeOut(endedAt: number | null, now: number): number {
  return endedAt === null ? 1 : Math.max(0, 1 - (now - endedAt) / FADE_MS);
}

/** Envelope flight: 0..1 progress with ease-in-out. */
export function envelopeProgress(startedAt: number, now: number): number {
  const t = Math.min(1, Math.max(0, (now - startedAt) / ENVELOPE_MS));
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/** Binds a case id to a place (and van) directly, for producers that never stage a scene (the scripted demo). */
export function fxBind(s: FxState, caseId: string, at: Omit<Staged, "runId" | "scenarioId">): FxState {
  return { ...s, bound: { ...s.bound, [caseId]: { runId: caseId, scenarioId: caseId, ...at } } };
}
