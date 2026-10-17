// Pure camera helpers for CameraRig (no three.js, testable).
import { ZONES, type ZoneName } from "../../config";
import type { IncidentKind, IncidentStatus } from "../../store";

/** Hotkeys for the HUD to list. */
export const HOTKEYS: readonly { keys: string; action: string }[] = [
  { keys: "WASD / Arrows", action: "Pan" },
  { keys: "Q / E", action: "Rotate" },
  { keys: "R / F", action: "Zoom in / out" },
  { keys: "1-5", action: "Downtown, Docks, Countryside, Depot, Suburbs" },
  { keys: "V", action: "Follow a random delivery van" },
  { keys: "C", action: "Toggle cinematic tour" },
  { keys: "Esc", action: "Release follow / stop tour" },
  { keys: "Click vehicle / ground", action: "Follow / release" },
];

export const ZONE_KEYS: readonly ZoneName[] = ["downtown", "docks", "countryside", "depot", "suburbs"];

export const MIN_DIST = 25;
export const MAX_DIST = 1400; // the layer-2 world is ±1100 m
export const MAX_POLAR = 1.35;
/** The camera target is kept inside this half-extent (x and z). */
export const WORLD_HALF = 1100;

/** Calm MapControls tuning (mouse/trackpad drag). Wheel zoom is handled by CameraRig itself. */
export const CONTROL_TUNING = { panSpeed: 0.6, rotateSpeed: 0.4, zoomSpeed: 0.5, dampingFactor: 0.08 } as const;

/** Keyboard speeds, matched to the calmer controls. */
export const KEY_SPEED = {
  pan: 0.5, // fraction of the camera distance per second
  rotate: 0.75, // rad/s
  zoom: 0.85, // natural-log distance change per second
  response: 8, // 1/s, how fast held-key velocity eases in and out
} as const;

/** Home pose: a 3/4 aerial over downtown with the docks and highway in view. */
export const HOME_TARGET: readonly [number, number, number] = [55, 0, -10];
export const HOME_POS: readonly [number, number, number] = [-185, 215, 335];
/** Where the one-time intro swoop starts. */
export const INTRO_POS: readonly [number, number, number] = [-420, 520, 760];

/** Frame-rate independent exponential approach of `cur` toward `goal`. */
export function approach(cur: number, goal: number, rate: number, dt: number) {
  return cur + (goal - cur) * (1 - Math.exp(-rate * dt));
}

const WHEEL_LINE_PX = 16;
const WHEEL_PAGE_PX = 400;
/** Wheel delta in pixels regardless of deltaMode (0 px, 1 lines, 2 pages). */
export function wheelPixels(deltaY: number, deltaMode: number) {
  return deltaMode === 1 ? deltaY * WHEEL_LINE_PX : deltaMode === 2 ? deltaY * WHEEL_PAGE_PX : deltaY;
}

/**
 * Natural-log dolly amount for one wheel event (positive = zoom out). Proportional to the delta so trackpads
 * glide instead of stepping; pinch (ctrlKey) deltas are small so they get a bigger gain; a bit softer when far
 * out; capped per event so a fast mouse flick can't jump.
 */
export function wheelDollyLog(deltaY: number, deltaMode: number, pinch: boolean, distance: number) {
  if (!Number.isFinite(deltaY) || !Number.isFinite(distance)) return 0;
  const px = wheelPixels(deltaY, deltaMode);
  // Pinch: flat gain (a typical 0.5 s pinch, ~30 events x 4 px, is ~2x). Scroll: gentle, softer far out.
  const gain = pinch ? PINCH_GAIN : SCROLL_GAIN * (1 - 0.35 * clamp(distance / MAX_DIST, 0, 1));
  return clamp(px * gain, -0.22, 0.22);
}

/** Log-dolly per wheel pixel for a trackpad pinch (ctrl+wheel). ln(2) / 120 px ≈ 0.0058. */
export const PINCH_GAIN = 0.006;
/** Log-dolly per wheel pixel for plain wheel / two-finger scroll. */
export const SCROLL_GAIN = 0.0011;

/** Follow-cam distance limits (the chase camera keeps this distance; wheel/pinch adjust it). */
export const FOLLOW_DIST = { initial: 45, min: MIN_DIST, max: 400 } as const;

export interface WheelContext {
  ctrl: boolean; // pinch on a trackpad, or ctrl+wheel
  overCanvas: boolean; // pointer is over the 3D canvas (or a transparent overlay above it)
  overScrollableHud: boolean; // pointer is over a HUD list that can actually scroll
}

/**
 * What to do with a wheel event on /city. Pinch always blocks browser page zoom and zooms the camera unless it's
 * over a scrollable HUD list. Plain scroll zooms only over the canvas and otherwise scrolls the HUD normally.
 */
export function wheelAction(c: WheelContext): { prevent: boolean; zoom: boolean } {
  if (c.ctrl) return { prevent: true, zoom: !c.overScrollableHud };
  if (c.overScrollableHud) return { prevent: false, zoom: false };
  return { prevent: c.overCanvas, zoom: c.overCanvas };
}

/** New camera distance after a log dolly, clamped to the allowed range. */
export function dollyDistance(distance: number, logStep: number) {
  return clamp(distance * Math.exp(logStep), MIN_DIST, MAX_DIST);
}

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** True if both vectors are finite and the camera isn't sitting on its target. */
export function poseIsSane(pos: Vec3Like, target: Vec3Like) {
  const ok = (v: Vec3Like) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
  if (!ok(pos) || !ok(target)) return false;
  return Math.hypot(pos.x - target.x, pos.y - target.y, pos.z - target.z) > 1e-3;
}

export function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function easeInOutCubic(t: number) {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Camera position looking at (tx,ty,tz) from `azimuth` (0 = +z side), `elevation` above the ground plane, at `distance`. */
export function framePosition(
  tx: number, ty: number, tz: number, azimuth: number, elevation: number, distance: number,
): [number, number, number] {
  const h = Math.cos(elevation) * distance;
  return [tx + Math.sin(azimuth) * h, ty + Math.sin(elevation) * distance, tz + Math.cos(azimuth) * h];
}

/** Centre and a pleasant viewing distance for a zone. */
export function zoneFrame(zone: ZoneName) {
  const b = ZONES[zone];
  const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
  return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2, distance: clamp(span * 1.15, 120, 520) };
}

export interface TourIncident {
  id: string;
  kind: IncidentKind;
  x: number;
  z: number;
  status: IncidentStatus;
  createdAt: number;
}

export type TourShot =
  | { kind: "incident"; id: string; x: number; z: number }
  | { kind: "chase" }
  | { kind: "skyline" }
  | { kind: "docks" }
  | { kind: "roadworks" };

const SCENIC: readonly TourShot["kind"][] = ["chase", "skyline", "docks", "roadworks"];

/**
 * Next tour shot. Odd steps show an active incident (newest not yet shown, else newest);
 * everything else cycles the scenic shots.
 */
export function pickTourShot(step: number, incidents: readonly TourIncident[], shown: ReadonlySet<string>): TourShot {
  if (step % 2 === 1) {
    const active = incidents.filter((i) => i.status !== "cleared").sort((a, b) => b.createdAt - a.createdAt);
    const pick = active.find((i) => !shown.has(i.id)) ?? active[0];
    if (pick) return { kind: "incident", id: pick.id, x: pick.x, z: pick.z };
  }
  const k = SCENIC[Math.floor(step / (incidents.some((i) => i.status !== "cleared") ? 2 : 1)) % SCENIC.length];
  return { kind: k } as TourShot;
}
