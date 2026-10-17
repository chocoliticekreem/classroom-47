import { describe, expect, it } from "vitest";
import type { WorldEvent } from "../../bus";
import { DEPOT, FADE_MS, emptyFx, envelopeProgress, fadeOut, fxBind, fxPrune, fxReduce, partyAnchor, type FxState } from "./fx";

const run = (s: FxState, evs: [WorldEvent, number][], isVehicle?: (id: string) => boolean) => {
  let state = s;
  const out: ReturnType<typeof fxReduce>[] = [];
  for (const [e, t] of evs) {
    const r = fxReduce(state, e, t, isVehicle);
    out.push(r);
    state = r.state;
  }
  return { state, out };
};

const staged: WorldEvent = { type: "scenario:staged", runId: "R-1", scenarioId: "delivery-003", modifiers: [], x: 40, z: -20, vehicleId: "van-7" };
const ringing: WorldEvent = { type: "call:ringing", caseId: "AGT-001 · delivery-003", callId: "k1", caller: "desk_agent", callee: "driver", source: "simulated_persona", purpose: "check access" };

describe("VoiceFx event -> effect mapping", () => {
  it("call:ringing puts a phone on caller and callee and flies the camera to the callee's van", () => {
    const { state, out } = run(emptyFx(), [[staged, 0], [ringing, 10]]);
    expect(state.phones.map((p) => [p.role, p.party, p.anchor.kind])).toEqual([["caller", "desk_agent", "point"], ["callee", "driver", "vehicle"]]);
    expect(state.phones[0].anchor).toEqual({ kind: "point", ...DEPOT });
    expect(state.phones[1].anchor).toEqual({ kind: "vehicle", vehicleId: "van-7", fallback: { x: 40, z: -20 } });
    expect(out[1].focus).toEqual(state.phones[1].anchor);
    expect(state.phones.every((p) => p.simulated)).toBe(true);
  });

  it("without a van, the driver is at the case's scenario location; with no scene, at the depot", () => {
    const noVan: WorldEvent = { ...staged, vehicleId: undefined } as WorldEvent;
    const a = run(emptyFx(), [[noVan, 0]]).state;
    expect(partyAnchor(a, "R-1", "driver", () => false)).toEqual({ kind: "point", x: 40, z: -20 });
    expect(partyAnchor(emptyFx(), "x", "driver", () => false)).toEqual({ kind: "point", ...DEPOT });
    expect(partyAnchor(a, "R-1", "recipient", () => false)).toEqual({ kind: "point", x: 46, z: -14 });
  });

  it("a party that is a registered vehicle id is anchored on that vehicle", () => {
    expect(partyAnchor(emptyFx(), "c", "V-12", (id) => id === "V-12")).toMatchObject({ kind: "vehicle", vehicleId: "V-12" });
  });

  it("call:connected stops the ringing; voice:utterance puts a bubble on the speaking party", () => {
    const { state } = run(emptyFx(), [
      [staged, 0], [ringing, 10],
      [{ type: "call:connected", caseId: ringing.caseId, callId: "k1" }, 20],
      [{ type: "voice:utterance", caseId: ringing.caseId, callId: "k1", seq: 1, speaker: "driver", text: "hi", source: "simulated_persona" }, 30],
      [{ type: "voice:utterance", caseId: ringing.caseId, callId: "k1", seq: 2, speaker: "desk_agent", text: "hello", source: "live_human" }, 40],
      [{ type: "voice:utterance", caseId: ringing.caseId, callId: "k1", seq: 3, speaker: "driver", text: "again", source: "simulated_persona" }, 50],
    ]);
    expect(state.phones.every((p) => p.connectedAt === 20)).toBe(true);
    expect(state.bubbles.map((b) => [b.speaker, b.seq, b.anchor.kind])).toEqual([["desk_agent", 2, "point"], ["driver", 3, "vehicle"]]);
    // the call was simulated, so even the live-sourced line is labelled
    expect(state.bubbles.every((b) => b.simulated)).toBe(true);
  });

  it("call:ended fades the phones and bubbles, then they are pruned", () => {
    let { state } = run(emptyFx(), [
      [ringing, 0],
      [{ type: "voice:utterance", caseId: ringing.caseId, callId: "k1", seq: 1, speaker: "driver", text: "hi", source: "live_human" }, 5],
      [{ type: "call:ended", caseId: ringing.caseId, callId: "k1", reason: "completed" }, 100],
    ]);
    expect(state.phones.every((p) => p.endedAt === 100)).toBe(true);
    expect(fadeOut(100, 100 + FADE_MS / 2)).toBeCloseTo(0.5);
    expect(fxPrune(state, 150)).toBe(state); // unchanged: same object
    state = fxPrune(state, 100 + FADE_MS + 1);
    expect(state.phones).toEqual([]);
    expect(state.bubbles).toEqual([]);
    expect(state.calls).toEqual({});
  });

  it("voice:note_in flies an envelope from the driver to the depot", () => {
    const { state } = run(emptyFx(), [[staged, 0], [{ type: "voice:note_in", caseId: "R-1", noteId: "n1", from: "driver", source: "live_human", transcript: "gate shut" }, 10]]);
    expect(state.envelopes).toHaveLength(1);
    expect(state.envelopes[0]).toMatchObject({ from: { kind: "vehicle", vehicleId: "van-7" }, to: { kind: "point", ...DEPOT }, simulated: false });
    expect(envelopeProgress(10, 10)).toBe(0);
    expect(envelopeProgress(10, 1e9)).toBe(1);
  });

  it("decision:voice flashes the manager and the HUD", () => {
    const { state, out } = run(emptyFx(), [[{ type: "decision:voice", caseId: "c", optionId: "option-1", by: "manager", source: "simulated_persona", callId: "k1" }, 5]]);
    expect(state.flashes[0]).toMatchObject({ optionId: "option-1", anchor: { kind: "point", ...DEPOT }, simulated: true });
    expect(out[0].hudFlash).toEqual({ caseId: "c", optionId: "option-1", by: "manager", simulated: true });
  });

  it("ignores unrelated events and keeps the state object", () => {
    const s = emptyFx();
    expect(fxReduce(s, { type: "request:roadworks" }, 0).state).toBe(s);
  });

  it("a bound case anchors the demo without staging a scene", () => {
    const s = fxBind(emptyFx(), "voice-demo-1", { x: 5, z: 6, vehicleId: "van-1" });
    expect(partyAnchor(s, "voice-demo-1", "driver", () => false)).toMatchObject({ kind: "vehicle", vehicleId: "van-1", fallback: { x: 5, z: 6 } });
  });
});
