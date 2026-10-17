"use client";
// Module: VoiceFx. The city's view of voice (PRD J3). Reacts to bus events:
//   call:ringing     ringing phone icons with pulsing rings above caller and callee, camera flies to the callee
//   call:connected / voice:utterance   a speech bubble on the speaking party, sized by its loudness
//                    (world/voice.ts registry), text revealed per the transcript-sync rules
//   voice:note_in    an envelope flies from the driver to the depot
//   decision:voice   an approval flash on the manager (depot) and on the HUD
//   call:ended       the phone icons fade
// Anything voiced by a simulated persona is labelled SIMULATED.
// window.__cityVoiceDemo() plays a scripted sequence of these events (VoiceFx/demo.ts).
// Event -> effect mapping is pure in VoiceFx/fx.ts; this file only draws it.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { AdditiveBlending, Vector3, type Group, type Sprite, type SpriteMaterial } from "three";
import { emit, on } from "../bus";
import { allVehicles, getVehicle } from "../registry";
import { useWorld } from "../store";
import { installVoiceAudio, loudness, revealedText, speakerKey } from "../voice";
import { demoScript, playScript } from "./VoiceFx/demo";
import {
  DEPOT, ENVELOPE_MS, FLASH_MS, emptyFx, envelopeProgress, fadeOut, fxBind, fxPrune, fxReduce,
  type Anchor, type BubbleFx, type EnvelopeFx, type FlashFx, type FxState, type HudFlash, type PhoneFx,
} from "./VoiceFx/fx";
import { voiceTextures } from "./VoiceFx/textures";

const isVehicle = (id: string) => Boolean(getVehicle(id));

/** Writes the anchor's ground position into `out`. */
function resolveAnchor(a: Anchor, out: Vector3): Vector3 {
  if (a.kind === "vehicle") {
    const v = getVehicle(a.vehicleId);
    if (v) return out.set(v.object.position.x, 0, v.object.position.z);
    return out.set(a.fallback.x, 0, a.fallback.z);
  }
  return out.set(a.x, 0, a.z);
}

/** Icon height above an anchor: above vans, above scenes, above the depot roofs. */
function iconHeight(a: Anchor): number {
  if (a.kind === "vehicle") return 9;
  if (a.x === DEPOT.x && a.z === DEPOT.z) return 26;
  return 12;
}

const ROLE_LABEL: Record<string, string> = {
  driver: "Driver", recipient: "Recipient", manager: "Desk manager", dispatch: "Dispatch", desk_agent: "Desk agent (AI)",
};
const roleLabel = (p: string) => ROLE_LABEL[p] ?? p;

const simTag: CSSProperties = {
  display: "inline-block", padding: "1px 5px", borderRadius: 4, background: "#f5a524", color: "#1a1206",
  font: "700 9px/1.3 Inter, system-ui, sans-serif", letterSpacing: 0.5, whiteSpace: "nowrap",
};

function SimulatedTag() {
  return <span style={simTag}>SIMULATED</span>;
}

// ---------- phone ----------

function Phone({ fx }: { fx: PhoneFx }) {
  const tex = voiceTextures();
  const group = useRef<Group>(null);
  const icon = useRef<Sprite>(null);
  const rings = useRef<(Sprite | null)[]>([]);
  const tmp = useMemo(() => new Vector3(), []);
  const h = iconHeight(fx.anchor);

  useFrame(() => {
    const g = group.current;
    if (!g || !icon.current) return;
    const now = performance.now();
    resolveAnchor(fx.anchor, tmp);
    g.position.set(tmp.x, h, tmp.z);
    const fade = fadeOut(fx.endedAt, now);
    const ringing = fx.connectedAt === null && fx.endedAt === null;
    const m = icon.current.material as SpriteMaterial;
    m.opacity = fade;
    // Ringing: buzz in bursts (0.6 s on, 0.4 s off). Connected: steady and green-tinted.
    const phase = ((now - fx.startedAt) % 1000) / 1000;
    m.rotation = ringing && phase < 0.6 ? Math.sin(now * 0.06) * 0.28 : 0;
    m.color.set(ringing || fx.endedAt !== null ? "#ffffff" : "#b9f5d8");
    const s = 6.5 * (ringing ? 1 + 0.08 * Math.sin(now * 0.02) : 1);
    icon.current.scale.set(s, s, 1);
    for (let i = 0; i < rings.current.length; i++) {
      const r = rings.current[i];
      if (!r) continue;
      const rm = r.material as SpriteMaterial;
      if (!ringing) {
        rm.opacity = 0;
        continue;
      }
      const p = (((now - fx.startedAt) / 1100 + i * 0.5) % 1 + 1) % 1;
      const rs = 7 + p * 14;
      r.scale.set(rs, rs, 1);
      rm.opacity = (1 - p) * 0.85;
    }
  });

  return (
    <group ref={group}>
      {[0, 1].map((i) => (
        <sprite key={i} ref={(el) => { rings.current[i] = el; }} renderOrder={20}>
          <spriteMaterial map={tex.ring} color="#ff6a1a" transparent depthTest={false} depthWrite={false} blending={AdditiveBlending} />
        </sprite>
      ))}
      <sprite ref={icon} renderOrder={21}>
        <spriteMaterial map={tex.phone} transparent depthTest={false} depthWrite={false} />
      </sprite>
      <Html position={[0, -4.6, 0]} center zIndexRange={[40, 0]} style={{ pointerEvents: "none" }}>
        <div style={{ display: "flex", gap: 4, alignItems: "center", opacity: fx.endedAt === null ? 1 : 0, transition: "opacity 1s" }}>
          <span style={{ ...simTag, background: "rgba(20,22,28,0.85)", color: "#fff", fontWeight: 600 }}>{roleLabel(String(fx.party))}</span>
          {fx.simulated && <SimulatedTag />}
        </div>
      </Html>
    </group>
  );
}

// ---------- speech bubble ----------

const bubbleBox: CSSProperties = {
  maxWidth: 260, minWidth: 120, padding: "7px 10px 8px", borderRadius: 12, background: "rgba(255,255,255,0.96)",
  color: "#16181d", boxShadow: "0 6px 22px rgba(0,0,0,0.28)", font: "500 12px/1.35 Inter, system-ui, sans-serif",
  transformOrigin: "50% 100%", position: "relative",
};

function Bubble({ fx }: { fx: BubbleFx }) {
  const group = useRef<Group>(null);
  const box = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  const tmp = useMemo(() => new Vector3(), []);
  const smooth = useRef(0);
  const shown = useRef("");
  const key = speakerKey(fx.callId, String(fx.speaker));
  const h = iconHeight(fx.anchor) + 6;

  useFrame(() => {
    const now = performance.now();
    if (group.current) {
      resolveAnchor(fx.anchor, tmp);
      group.current.position.set(tmp.x, h, tmp.z);
    }
    const line = useWorld.getState().transcripts[fx.callId]?.find((l) => l.seq === fx.seq);
    const next = line ? revealedText(line, now) : "";
    if (text.current && next !== shown.current) {
      shown.current = next;
      text.current.textContent = next || "…";
    }
    const loud = loudness(key, now);
    smooth.current += (loud - smooth.current) * 0.35;
    if (box.current) {
      const s = 0.94 + smooth.current * 0.3;
      box.current.style.transform = `scale(${s.toFixed(3)})`;
      box.current.style.opacity = String(fadeOut(fx.endedAt, now));
      box.current.style.outline = smooth.current > 0.05 ? `${(1 + smooth.current * 3).toFixed(1)}px solid rgba(255,106,26,${(0.25 + smooth.current * 0.6).toFixed(2)})` : "none";
    }
  });

  return (
    <group ref={group}>
      <Html center zIndexRange={[45, 0]} style={{ pointerEvents: "none" }}>
        <div ref={box} style={bubbleBox}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 3 }}>
            <span style={{ font: "700 10px/1 Inter, system-ui, sans-serif", color: "#ff6a1a", letterSpacing: 0.3, textTransform: "uppercase" }}>
              {roleLabel(String(fx.speaker))}
            </span>
            {fx.simulated && <SimulatedTag />}
          </div>
          <span ref={text}>…</span>
          <span style={{ position: "absolute", left: "50%", bottom: -6, marginLeft: -6, width: 12, height: 12, background: "rgba(255,255,255,0.96)", transform: "rotate(45deg)" }} />
        </div>
      </Html>
    </group>
  );
}

// ---------- envelope ----------

function Envelope({ fx }: { fx: EnvelopeFx }) {
  const tex = voiceTextures();
  const sprite = useRef<Sprite>(null);
  const label = useRef<Group>(null);
  const a = useMemo(() => new Vector3(), []);
  const b = useMemo(() => new Vector3(), []);

  useFrame(() => {
    const sp = sprite.current;
    if (!sp) return;
    const now = performance.now();
    resolveAnchor(fx.from, a);
    resolveAnchor(fx.to, b);
    const p = envelopeProgress(fx.startedAt, now);
    const y0 = iconHeight(fx.from);
    const y1 = iconHeight(fx.to);
    sp.position.set(a.x + (b.x - a.x) * p, y0 + (y1 - y0) * p + Math.sin(Math.PI * p) * 45, a.z + (b.z - a.z) * p);
    const m = sp.material as SpriteMaterial;
    m.opacity = now - fx.startedAt < ENVELOPE_MS ? 1 : fadeOut(fx.startedAt + ENVELOPE_MS, now);
    m.rotation = Math.sin(now * 0.008) * 0.15;
    const s = 6 + Math.sin(Math.PI * p) * 2;
    sp.scale.set(s, s, 1);
    label.current?.position.set(sp.position.x, sp.position.y - 4.5, sp.position.z);
  });

  return (
    <>
      <sprite ref={sprite} renderOrder={22}>
        <spriteMaterial map={tex.envelope} transparent depthTest={false} depthWrite={false} />
      </sprite>
      <group ref={label}>
        <Html center zIndexRange={[40, 0]} style={{ pointerEvents: "none" }}>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <span style={{ ...simTag, background: "rgba(20,22,28,0.85)", color: "#fff", fontWeight: 600 }}>{fx.label}</span>
            {fx.simulated && <SimulatedTag />}
          </div>
        </Html>
      </group>
    </>
  );
}

// ---------- approval flash ----------

function Flash({ fx }: { fx: FlashFx }) {
  const tex = voiceTextures();
  const group = useRef<Group>(null);
  const ring = useRef<Sprite>(null);
  const check = useRef<Sprite>(null);
  const tmp = useMemo(() => new Vector3(), []);
  const h = iconHeight(fx.anchor);

  useFrame(() => {
    const now = performance.now();
    const t = Math.min(1, (now - fx.startedAt) / FLASH_MS);
    if (group.current) {
      resolveAnchor(fx.anchor, tmp);
      group.current.position.set(tmp.x, h, tmp.z);
    }
    if (ring.current) {
      const s = 6 + t * 46;
      ring.current.scale.set(s, s, 1);
      (ring.current.material as SpriteMaterial).opacity = (1 - t) * 0.95;
    }
    if (check.current) {
      const pop = t < 0.15 ? t / 0.15 : 1;
      const s = 9 * (0.6 + 0.4 * pop);
      check.current.scale.set(s, s, 1);
      (check.current.material as SpriteMaterial).opacity = t < 0.75 ? 1 : (1 - t) / 0.25;
    }
  });

  return (
    <group ref={group}>
      <sprite ref={ring} renderOrder={23}>
        <spriteMaterial map={tex.ring} color="#3ecf8e" transparent depthTest={false} depthWrite={false} blending={AdditiveBlending} />
      </sprite>
      <sprite ref={check} renderOrder={24}>
        <spriteMaterial map={tex.check} transparent depthTest={false} depthWrite={false} />
      </sprite>
      <Html position={[0, -6.5, 0]} center zIndexRange={[40, 0]} style={{ pointerEvents: "none" }}>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <span style={{ ...simTag, background: "#3ecf8e", color: "#05230f" }}>Approved by voice · {fx.optionId}</span>
          {fx.simulated && <SimulatedTag />}
        </div>
      </Html>
    </group>
  );
}

// ---------- HUD flash (DOM, outside the canvas) ----------

function flashHud(h: HudFlash) {
  if (typeof document === "undefined") return;
  const root = document.createElement("div");
  root.setAttribute("data-voicefx-hud", "");
  Object.assign(root.style, {
    position: "fixed", inset: "0", pointerEvents: "none", zIndex: "60",
    boxShadow: "inset 0 0 0 3px rgba(62,207,142,0.9), inset 0 0 80px rgba(62,207,142,0.45)",
  } satisfies Partial<CSSStyleDeclaration>);
  const pill = document.createElement("div");
  Object.assign(pill.style, {
    position: "absolute", top: "18px", left: "50%", transform: "translateX(-50%)", padding: "8px 14px",
    borderRadius: "999px", background: "rgba(10,30,20,0.92)", color: "#3ecf8e", border: "1px solid rgba(62,207,142,0.6)",
    font: "600 13px/1.2 Inter, system-ui, sans-serif", display: "flex", gap: "8px", alignItems: "center", whiteSpace: "nowrap",
  } satisfies Partial<CSSStyleDeclaration>);
  pill.textContent = `Approved by voice: ${h.optionId} · ${roleLabel(String(h.by))} · ${h.caseId}`;
  if (h.simulated) {
    const tag = document.createElement("span");
    Object.assign(tag.style, simTag as Partial<CSSStyleDeclaration>);
    tag.textContent = "SIMULATED";
    pill.appendChild(tag);
  }
  root.appendChild(pill);
  document.body.appendChild(root);
  const anim = root.animate([{ opacity: 0 }, { opacity: 1, offset: 0.08 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { duration: 2600, easing: "ease-out" });
  anim.onfinish = () => root.remove();
  setTimeout(() => root.remove(), 3500);
}

// ---------- module ----------

let demoNo = 0;

export default function VoiceFx() {
  const [fx, setFx] = useState<FxState>(emptyFx);
  const fxRef = useRef<FxState>(fx);
  const lastPrune = useRef(0);
  const focusTmp = useMemo(() => new Vector3(), []);

  useEffect(() => {
    installVoiceAudio();
    const commit = (next: FxState) => {
      if (next === fxRef.current) return;
      fxRef.current = next;
      setFx(next);
    };
    const off = on((e) => {
      const r = fxReduce(fxRef.current, e, performance.now(), isVehicle);
      commit(r.state);
      if (r.focus) {
        resolveAnchor(r.focus, focusTmp);
        useWorld.getState().setFocus({ x: focusTmp.x, z: focusTmp.z });
      }
      if (r.hudFlash) flashHud(r.hudFlash);
    });

    let cancel: (() => void) | null = null;
    const w = window as unknown as { __cityVoiceDemo?: () => string };
    w.__cityVoiceDemo = () => {
      cancel?.();
      demoNo += 1;
      const caseId = `voice-demo-${demoNo}`;
      const callId = `call-demo-${demoNo}`;
      // Put the driver on a live van if one is driving; otherwise near the depot gate.
      let van: { id: string; x: number; z: number } | null = null;
      for (const v of allVehicles()) {
        if (v.kind !== "van") continue;
        van = { id: v.id, x: v.object.position.x, z: v.object.position.z };
        if (!v.stopped) break;
      }
      commit(fxBind(fxRef.current, caseId, van ? { x: van.x, z: van.z, vehicleId: van.id } : { x: DEPOT.x + 30, z: DEPOT.z - 60 }));
      cancel = playScript(demoScript(caseId, callId), emit);
      return caseId;
    };
    return () => {
      off();
      cancel?.();
      if (w.__cityVoiceDemo) delete w.__cityVoiceDemo;
    };
  }, [focusTmp]);

  useFrame(() => {
    const now = performance.now();
    if (now - lastPrune.current < 500) return;
    lastPrune.current = now;
    const next = fxPrune(fxRef.current, now);
    if (next !== fxRef.current) {
      fxRef.current = next;
      setFx(next);
    }
  });

  return (
    <group name="VoiceFx">
      {fx.phones.map((p) => <Phone key={p.id} fx={p} />)}
      {fx.bubbles.map((b) => <Bubble key={b.id} fx={b} />)}
      {fx.envelopes.map((v) => <Envelope key={v.id} fx={v} />)}
      {fx.flashes.map((f) => <Flash key={f.id} fx={f} />)}
    </group>
  );
}
