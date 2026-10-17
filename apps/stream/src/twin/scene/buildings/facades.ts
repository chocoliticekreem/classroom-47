import * as THREE from "three";

/** Deterministic PRNG so the same footprint always gets the same look. */
export function seededRandom(seed: number) {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const c = (hex: string) => new THREE.Color(hex);

const BRICK = ["#8a5a44", "#7d4f3c", "#9c6b50", "#6b4636", "#755244", "#8c6246"].map(c);
const YELLOW_STOCK = ["#b09a72", "#a8946c", "#9d8a68"].map(c);
const SOOT = ["#5b5149", "#665e57", "#524c47"].map(c);
const STONE = ["#b8b0a0", "#a39d92", "#c7c0b0", "#9a968c"].map(c);
const RENDER = ["#cfc6b4", "#c4b9a6", "#b9b4a8"].map(c);
const CONCRETE = ["#7c7f84", "#9a9c9e", "#6d7075", "#8a8c8e"].map(c);
const GLASS = ["#2b3d52", "#31475d", "#3a4a55", "#2f5256", "#26364a"].map(c);
const ROOF = ["#3a3d42", "#44474d", "#34373b"].map(c);
const SLATE = ["#4a4f58", "#3f444c"].map(c);
const TERRACOTTA = ["#8a4b38", "#7c4333", "#94553f"].map(c);

export type Material = "brick" | "stone" | "concrete" | "glass";

export const STONE_TRIM = c("#b2aa9a");
export const METAL_TRIM = c("#1a2026");
export const PLINTH_STONE = c("#5d5a56");
export const PLANT = c("#6a6d72");
export const BITUMEN = c("#2c2f33");
export const GLASS_PLINTH = c("#1b232c");

function pick<T>(list: T[], r: number): T {
  return list[Math.min(list.length - 1, Math.floor(r * list.length))];
}

/** Material family from height and a roll; tall buildings skew to glass, small ones to brick. */
export function chooseMaterial(height: number, roll: number): Material {
  if (height > 60) return roll < 0.55 ? "glass" : roll < 0.8 ? "concrete" : roll < 0.9 ? "stone" : "brick";
  if (height > 25) return roll < 0.15 ? "glass" : roll < 0.4 ? "concrete" : roll < 0.7 ? "stone" : "brick";
  return roll < 0.7 ? "brick" : roll < 0.85 ? "stone" : "concrete";
}

/** Linear-space wall albedo with per-building variation, blending any tagged OSM colour in. */
export function wallColour(material: Material, tagged: string | undefined, rnd: () => number, out: THREE.Color): THREE.Color {
  const roll = rnd();
  if (material === "glass") out.copy(pick(GLASS, roll));
  else if (material === "concrete") out.copy(pick(CONCRETE, roll));
  else if (material === "stone") out.copy(roll < 0.5 ? pick(STONE, rnd()) : pick(RENDER, rnd()));
  else out.copy(roll < 0.62 ? pick(BRICK, rnd()) : roll < 0.8 ? pick(YELLOW_STOCK, rnd()) : pick(SOOT, rnd()));
  if (tagged && material !== "glass") {
    try {
      out.lerp(new THREE.Color(tagged), 0.6);
    } catch {
      // unparsable OSM colour: keep the palette pick
    }
  }
  out.offsetHSL((rnd() - 0.5) * 0.02, (rnd() - 0.5) * 0.08, (rnd() - 0.5) * 0.06);
  return out;
}

export function roofColour(pitched: boolean, rnd: () => number, out: THREE.Color): THREE.Color {
  if (!pitched) return out.copy(pick(ROOF, rnd()));
  return out.copy(rnd() < 0.55 ? pick(SLATE, rnd()) : pick(TERRACOTTA, rnd()));
}
