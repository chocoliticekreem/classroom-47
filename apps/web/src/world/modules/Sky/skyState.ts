// Pure day/night maths for the Sky module: sun/moon direction and a cyclic colour/intensity palette.
// Everything writes into a reusable SkyState so the per-frame path allocates nothing.
import { Color, Vector3 } from "three";

/** Real seconds per game hour. */
export const GAME_SECONDS_PER_HOUR = 20;

/** Nights (20:00-06:00) run this many times faster than days, so the city isn't dark for long. */
export const NIGHT_SPEEDUP = 3;

export function isNightHour(hour: number) {
  return hour >= 20 || hour < 6;
}

export function advanceHour(hour: number, dtSeconds: number, timeScale = 1): number {
  const rate = (isNightHour(hour) ? NIGHT_SPEEDUP : 1) * timeScale;
  const h = hour + (dtSeconds * rate) / GAME_SECONDS_PER_HOUR;
  return ((h % 24) + 24) % 24;
}

const TILT = (30 * Math.PI) / 180; // sun path leans south (+z), London-ish

/** Unit vector pointing at the sun. Rises in the east (+x) at 06:00, highest at 13:00, sets west (-x) at 20:00. */
export function sunDirection(hour: number, out: Vector3): Vector3 {
  const h = ((hour % 24) + 24) % 24;
  let phi: number;
  if (h >= 6 && h <= 20) phi = (Math.PI * (h - 6)) / 14;
  else phi = Math.PI + (Math.PI * ((h - 20 + 24) % 24)) / 10;
  const s = Math.sin(phi);
  return out.set(Math.cos(phi), s * Math.cos(TILT), s * Math.sin(TILT));
}

export interface SkyState {
  hour: number;
  sunDir: Vector3;
  moonDir: Vector3;
  /** Direction of the shadow-casting key light (sun by day, moon by night), always above the horizon. */
  keyDir: Vector3;
  zenith: Color;
  horizon: Color;
  keyColor: Color;
  keyIntensity: number;
  hemiSky: Color;
  hemiGround: Color;
  hemiIntensity: number;
  cloud: Color;
  stars: number; // 0..1
  bloom: number; // bloom intensity
}

export function createSkyState(): SkyState {
  return {
    hour: 0,
    sunDir: new Vector3(),
    moonDir: new Vector3(),
    keyDir: new Vector3(0, 1, 0),
    zenith: new Color(),
    horizon: new Color(),
    keyColor: new Color(),
    keyIntensity: 0,
    hemiSky: new Color(),
    hemiGround: new Color(),
    hemiIntensity: 0,
    cloud: new Color(),
    stars: 0,
    bloom: 0,
  };
}

interface Key {
  h: number;
  zenith: Color;
  horizon: Color;
  keyColor: Color;
  keyI: number;
  hemiSky: Color;
  hemiGround: Color;
  hemiI: number;
  cloud: Color;
  stars: number;
  bloom: number;
}

function k(
  h: number,
  zenith: string,
  horizon: string,
  keyColor: string,
  keyI: number,
  hemiSky: string,
  hemiGround: string,
  hemiI: number,
  cloud: string,
  stars: number,
  bloom: number,
): Key {
  return {
    h,
    zenith: new Color(zenith),
    horizon: new Color(horizon),
    keyColor: new Color(keyColor),
    keyI,
    hemiSky: new Color(hemiSky),
    hemiGround: new Color(hemiGround),
    hemiI,
    cloud: new Color(cloud),
    stars,
    bloom,
  };
}

// Sorted by hour. The cycle wraps from the last key back to the first (+24h).
const NIGHT = ["#050a1e", "#16224a", "#9fb4ff", 0.5, "#3c4f86", "#141a2a", 0.6, "#2a3352", 1, 1.35] as const;
const KEYS: Key[] = [
  k(0, ...NIGHT),
  k(4.6, "#081030", "#262c5c", "#9fb4ff", 0.5, "#3c4f86", "#141a2a", 0.6, "#2c3456", 1, 1.35),
  k(5.7, "#1f2a64", "#b86a8c", "#ffae8a", 0.45, "#7f7cb4", "#2e2a30", 0.62, "#b88ca4", 0.3, 1.15),
  k(6.7, "#4a7cc4", "#ffb27a", "#ffc48a", 1.5, "#b9c6e6", "#5a4a3a", 0.8, "#ffd7c2", 0, 0.9),
  k(8.5, "#3a82da", "#bcdcf5", "#fff1dc", 2.6, "#cfe2ff", "#5d6650", 0.95, "#ffffff", 0, 0.7),
  k(12, "#2e7ae0", "#cfe6f7", "#fffaf0", 3.0, "#d6e8ff", "#606a55", 1.0, "#ffffff", 0, 0.6),
  k(16, "#3780d8", "#d6e4ee", "#fff0d8", 2.7, "#d4e2f4", "#606652", 0.95, "#fbfbfb", 0, 0.65),
  k(17.8, "#4a6fb5", "#ffc184", "#ffb766", 2.1, "#e8c8b0", "#6a5038", 0.85, "#ffd2a8", 0, 0.8),
  k(19, "#3a3f8a", "#ff8a5c", "#ff8a50", 1.2, "#c89aa8", "#4a3330", 0.72, "#ff9f8a", 0, 1.0),
  k(19.8, "#23286a", "#e0708a", "#d08aa0", 0.55, "#8a7ab0", "#2e2836", 0.62, "#a07090", 0.2, 1.15),
  k(20.8, "#0e1645", "#363d72", "#a8b8ff", 0.5, "#53639a", "#1a1e2c", 0.6, "#3a4366", 0.8, 1.3),
  k(22, ...NIGHT),
];

const _blend = new Vector3();

export function sampleSky(hour: number, out: SkyState): SkyState {
  const h = ((hour % 24) + 24) % 24;
  out.hour = h;

  let i = KEYS.length - 1;
  for (let j = 0; j < KEYS.length; j++) if (KEYS[j].h <= h) i = j;
  const a = KEYS[i];
  const b = KEYS[(i + 1) % KEYS.length];
  const span = (b.h - a.h + 24) % 24 || 24;
  let t = ((h - a.h + 24) % 24) / span;
  t = t * t * (3 - 2 * t); // smoothstep between keys

  out.zenith.lerpColors(a.zenith, b.zenith, t);
  out.horizon.lerpColors(a.horizon, b.horizon, t);
  out.keyColor.lerpColors(a.keyColor, b.keyColor, t);
  out.hemiSky.lerpColors(a.hemiSky, b.hemiSky, t);
  out.hemiGround.lerpColors(a.hemiGround, b.hemiGround, t);
  out.cloud.lerpColors(a.cloud, b.cloud, t);
  out.keyIntensity = a.keyI + (b.keyI - a.keyI) * t;
  out.hemiIntensity = a.hemiI + (b.hemiI - a.hemiI) * t;
  out.stars = a.stars + (b.stars - a.stars) * t;
  out.bloom = a.bloom + (b.bloom - a.bloom) * t;

  sunDirection(h, out.sunDir);
  sunDirection(h + 12, out.moonDir);

  // Key light: blend from sun to moon as the sun goes down, with a bit of "up" so it never flips under.
  const ws = Math.min(1, Math.max(0, (out.sunDir.y + 0.1) / 0.4));
  const wSun = ws * ws * (3 - 2 * ws);
  _blend.copy(out.sunDir).multiplyScalar(wSun).addScaledVector(out.moonDir, 1 - wSun);
  _blend.y += 0.3;
  if (_blend.y < 0.25) _blend.y = 0.25;
  out.keyDir.copy(_blend).normalize();
  return out;
}

// ---------- Colour grade (post-processing) ----------

export interface Grade {
  saturation: number; // HueSaturation (-1..1)
  contrast: number; // BrightnessContrast (-1..1)
  brightness: number;
  vignette: number; // Vignette darkness
}

export function createGrade(): Grade {
  return { saturation: 0, contrast: 0, brightness: 0, vignette: 0.4 };
}

function bump(h: number, centre: number, width: number) {
  const d = Math.abs(h - centre) / width;
  return d >= 1 ? 0 : 1 - d * d * (3 - 2 * d);
}

/** How "golden hour" it is (0..1): sunrise around 06:50, sunset around 18:40. */
export function goldenness(hour: number) {
  const h = ((hour % 24) + 24) % 24;
  return Math.max(bump(h, 6.9, 1.3), bump(h, 18.6, 1.5));
}

/**
 * Cinematic grade: warm, saturated, a touch of contrast at golden hour; cool, contrasty, slightly desaturated
 * at night (so emissives pop); flat and muted under heavy cloud.
 */
export function gradeFor(hour: number, night: number, cover: number, out: Grade): Grade {
  const g = goldenness(hour);
  const overcast = Math.max(0, cover - 0.3) / 0.7;
  out.saturation = 0.08 + 0.14 * g - 0.12 * night - 0.18 * overcast;
  out.contrast = 0.04 + 0.08 * g + 0.1 * night - 0.04 * overcast;
  out.brightness = 0.01 * g - 0.015 * overcast;
  out.vignette = 0.38 + 0.12 * g + 0.17 * night + 0.05 * overcast;
  return out;
}
