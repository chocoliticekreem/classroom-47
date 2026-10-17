// Pure weather logic for the Sky module: a seeded looping schedule of
// clear -> overcast -> (drizzle | rain | storm) -> overcast, sampled into smooth parameters.
import { Color, Vector3 } from "three";
import type { SkyState } from "./skyState";

export type Weather = "clear" | "overcast" | "drizzle" | "rain" | "storm";

interface Params {
  cover: number; // cloud cover 0..1 (thicker clouds, greyer sky, dimmer sun)
  rain: number; // rain intensity 0..1
  storm: number; // 0..1, lightning allowed when high
}

const TARGETS: Record<Weather, Params> = {
  clear: { cover: 0.12, rain: 0, storm: 0 },
  overcast: { cover: 0.72, rain: 0, storm: 0 },
  drizzle: { cover: 0.85, rain: 0.3, storm: 0 },
  rain: { cover: 0.95, rain: 0.8, storm: 0 },
  storm: { cover: 1, rain: 1, storm: 1 },
};

export interface Segment {
  kind: Weather;
  start: number; // seconds into the loop
  dur: number;
}

export interface Schedule {
  segments: Segment[];
  period: number;
}

const TRANSITION = 12; // seconds to blend into each new segment

function prng(seed: number) {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Six weather cycles (one wet spell each), looping. Every loop has drizzle, rain and a storm. */
export function buildSchedule(seed: number): Schedule {
  const rnd = prng(seed);
  const bag: Weather[] = ["drizzle", "rain", "storm", "drizzle", "rain", "drizzle"];
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  const segments: Segment[] = [];
  let t = 0;
  const push = (kind: Weather, min: number, max: number) => {
    const dur = min + rnd() * (max - min);
    segments.push({ kind, start: t, dur });
    t += dur;
  };
  for (let c = 0; c < bag.length; c++) {
    push("clear", c === 0 ? 50 : 70, c === 0 ? 60 : 110);
    push("overcast", 25, 40);
    push(bag[c], 35, 55);
    push("overcast", 15, 25);
  }
  return { segments, period: t };
}

export interface WeatherState extends Params {
  weather: Weather;
}

export function createWeatherState(): WeatherState {
  return { weather: "clear", cover: 0, rain: 0, storm: 0 };
}

export function sampleWeather(s: Schedule, tSeconds: number, out: WeatherState): WeatherState {
  const t = ((tSeconds % s.period) + s.period) % s.period;
  let i = s.segments.length - 1;
  for (let j = 0; j < s.segments.length; j++) {
    if (s.segments[j].start <= t) i = j;
    else break;
  }
  const seg = s.segments[i];
  const prev = s.segments[(i - 1 + s.segments.length) % s.segments.length];
  const a = TARGETS[prev.kind];
  const b = TARGETS[seg.kind];
  let k = Math.min(1, (t - seg.start) / TRANSITION);
  k = k * k * (3 - 2 * k);
  // The very first segment of the first loop starts from its own target (no blend from the loop's end).
  const from = tSeconds < TRANSITION && i === 0 ? b : a;
  out.weather = seg.kind;
  out.cover = from.cover + (b.cover - from.cover) * k;
  out.rain = from.rain + (b.rain - from.rain) * k;
  out.storm = from.storm + (b.storm - from.storm) * k;
  return out;
}

/** Move `state` a fraction `k` (0..1) of the way toward explicit cover/rain/storm values. In place. */
export function blendParams(state: WeatherState, target: Params, k: number): WeatherState {
  const t = Math.max(0, Math.min(1, k));
  state.cover += (target.cover - state.cover) * t;
  state.rain += (target.rain - state.rain) * t;
  state.storm += (target.storm - state.storm) * t;
  return state;
}

/**
 * Ease `state` a fraction `k` (0..1) of the way toward a weather kind's targets and label it that kind.
 * Call every frame with k = 1 - exp(-dt / tau) for a frame-rate independent ease. In place.
 */
export function blendToward(state: WeatherState, kind: Weather, k: number): WeatherState {
  blendParams(state, TARGETS[kind], k);
  state.weather = kind;
  return state;
}

/** Ease `state` toward the sampled cycle weather `cycle` and take its label. In place. */
export function followCycle(state: WeatherState, cycle: WeatherState, k: number): WeatherState {
  blendParams(state, cycle, k);
  state.weather = cycle.weather;
  return state;
}

/** Per-frame ease factor that closes ~98% of the gap in `seconds` (exponential, frame-rate independent). */
export function easeFactor(dt: number, seconds: number): number {
  if (seconds <= 0) return 1;
  return 1 - Math.exp((-4 * Math.max(0, dt)) / seconds);
}

const _right = new Vector3();
const _up = new Vector3();
const UP = new Vector3(0, 1, 0);

/**
 * Snap a world point to the shadow map texel grid of a directional light looking along -lightDir,
 * so the shadow camera can follow the view without shimmering.
 */
export function snapToTexel(p: Vector3, lightDir: Vector3, texel: number, out: Vector3): Vector3 {
  _right.crossVectors(UP, lightDir);
  if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0);
  _right.normalize();
  _up.crossVectors(lightDir, _right).normalize();
  const a = Math.round(p.dot(_right) / texel) * texel;
  const b = Math.round(p.dot(_up) / texel) * texel;
  const c = p.dot(lightDir);
  return out.copy(_right).multiplyScalar(a).addScaledVector(_up, b).addScaledVector(lightDir, c);
}

// ---------- Apply weather to a sampled sky ----------
const _grey = new Color();
const _wet = new Color();

function desat(c: Color, amount: number, darken: number) {
  const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  _grey.setRGB(l * 0.95 * darken, l * darken, l * 1.08 * darken);
  c.lerp(_grey, amount);
}

/** Grey the sky, dim the sun, cool the light and hide stars according to cloud cover and rain. In place. */
export function applyWeather(sky: SkyState, w: WeatherState): SkyState {
  const c = Math.max(0, Math.min(1, (w.cover - 0.2) / 0.8)); // clear sky keeps its colours
  const r = w.rain;
  desat(sky.zenith, c * 0.8, 0.8 - 0.15 * r);
  desat(sky.horizon, c * 0.7, 0.88 - 0.12 * r);
  desat(sky.keyColor, c * 0.5, 1);
  desat(sky.hemiSky, c * 0.55, 1);
  desat(sky.cloud, c * 0.75, 0.82 - 0.25 * r);
  // wet sheen: cool the fill light a little when raining
  sky.hemiSky.multiply(_wet.setRGB(1 - 0.12 * r, 1 - 0.04 * r, 1 + 0.1 * r));
  sky.keyColor.multiply(_wet);
  sky.keyIntensity *= 1 - 0.68 * c - 0.12 * r;
  sky.hemiIntensity *= 1 + 0.12 * c - 0.08 * r;
  sky.stars *= 1 - c;
  sky.bloom *= 1 + 0.1 * r; // wet streets: lights bloom a touch more
  return sky;
}
