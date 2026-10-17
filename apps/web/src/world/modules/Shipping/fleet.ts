// Shipping: vessel classes, the named fleet, container brands, and the ship-local layout of each class
// (where the bays, accommodation block, funnel and bow sit). Pure data + maths, no three.js.
import type { BerthId } from "../../berths";

/** Contract deck grid (berths.ts): 9 rows across, 10 bays along, 4 tiers. Pitches match deckSlotPosition(). */
export const ROW_PITCH = 2.62;
export const BAY_PITCH = 12.6;
export const TIER_H = 2.6;
export const CONTRACT_ROWS = 9;
export const CONTRACT_BAYS = 10;
export const CONTRACT_TIERS = 4;
/** Half length of the contract cargo block along the ship (bays centred on the ship's midpoint). */
export const CARGO_HALF = (CONTRACT_BAYS * BAY_PITCH) / 2; // 63
/** Main deck and hatch-cover top (containers sit on the hatch covers at y = HATCH_TOP, the contract's deckY). */
export const MAIN_DECK = 4.6;
export const HATCH_TOP = 5.5;
export const KEEL = -7.5;

export type ClassId = "feeder" | "panamax" | "neo" | "giant";

export interface VesselClass {
  id: ClassId;
  label: string;
  length: number;
  beam: number;
  /** Bridge position: aft (classic) or forward (24k TEU giants, with a separate engine house aft). */
  bridge: "aft" | "forward";
  /** Decorative (non-crane) bays forward/aft of the contract block. */
  decoFwd: number;
  decoAft: number;
  /** Highest tier the deck fill uses in the contract block, and in decorative bays. */
  maxTier: number;
  decoTiers: number;
  /** Which berths it fits (the giant only fits the long terminal quay). */
  berths: BerthId[];
  /** Cruise speed at sea (m/s). */
  cruise: number;
}

export const CLASSES: Record<ClassId, VesselClass> = {
  feeder: { id: "feeder", label: "Feeder 2,800 TEU", length: 176, beam: 26, bridge: "aft", decoFwd: 0, decoAft: 0, maxTier: 3, decoTiers: 3, berths: ["docks", "terminal"], cruise: 11 },
  panamax: { id: "panamax", label: "Panamax 5,000 TEU", length: 196, beam: 26, bridge: "aft", decoFwd: 0, decoAft: 0, maxTier: 4, decoTiers: 4, berths: ["docks", "terminal"], cruise: 10 },
  neo: { id: "neo", label: "Neo-Panamax 13,000 TEU", length: 222, beam: 26, bridge: "aft", decoFwd: 1, decoAft: 1, maxTier: 4, decoTiers: 5, berths: ["terminal"], cruise: 10 },
  giant: { id: "giant", label: "Megamax 24,000 TEU", length: 236, beam: 26.6, bridge: "forward", decoFwd: 1, decoAft: 2, maxTier: 4, decoTiers: 7, berths: ["terminal"], cruise: 9 },
};

export interface Livery {
  hull: string; // topside colour above the boot-top
  antifoul: string;
  house: string;
  funnel: string;
  stripe: string;
  hatch: string;
  deck: string;
  text: string; // hull lettering
  brand: string; // big hull lettering
}

export interface VesselSpec {
  name: string;
  cls: ClassId;
  livery: Livery;
  /** Preferred brand on its deck (weights the fill). */
  homeBrand: string;
}

/** Container brands: base colour + text. The first entry is "no brand" (plain leased boxes). */
export const BRANDS = [
  { name: "", color: "#8a9199" },
  { name: "HAMYWAY", color: "#ff6a1a" },
  { name: "MAERLIN", color: "#1f5fa8" },
  { name: "EVERGLOW", color: "#2f8a4a" },
  { name: "KOSKA", color: "#e3b62a" },
  { name: "SUDWIND", color: "#b8322b" },
  { name: "ONEWAVE", color: "#c2177a" },
] as const;
export const BRAND_NAMES = BRANDS.map((b) => b.name);
/** Plain (unbranded) box colours: leasing greys, rust, white, teal, navy. */
export const PLAIN_COLORS = ["#8a9199", "#a2392c", "#e6e6e2", "#2a8f8a", "#2c3e75", "#6d4c8c", "#c76b29", "#5b6b3a"];

export function brandIndex(name: string | undefined): number {
  if (!name) return 0;
  const i = BRAND_NAMES.indexOf(name.toUpperCase() as (typeof BRAND_NAMES)[number]);
  return i < 0 ? 0 : i;
}

const navy = { antifoul: "#a3302a", house: "#f2f0ea", deck: "#4a5a52", text: "#ffffff" };
export const FLEET: VesselSpec[] = [
  { name: "HAMYWAY STAR", cls: "panamax", homeBrand: "HAMYWAY", livery: { ...navy, hull: "#1f2e4a", funnel: "#ff6a1a", stripe: "#ffffff", hatch: "#3d5163", brand: "HAMYWAY" } },
  { name: "MAERLIN ENDURANCE", cls: "neo", homeBrand: "MAERLIN", livery: { ...navy, hull: "#24427f", funnel: "#24427f", stripe: "#7fc4ff", hatch: "#4b6178", brand: "MAERLIN" } },
  { name: "EVERGLOW HARMONY", cls: "panamax", homeBrand: "EVERGLOW", livery: { ...navy, hull: "#2d6b3f", funnel: "#2d6b3f", stripe: "#f2f0ea", hatch: "#55705c", brand: "EVERGLOW" } },
  { name: "KOSKA PIONEER", cls: "feeder", homeBrand: "KOSKA", livery: { ...navy, hull: "#3a4a5a", funnel: "#e3b62a", stripe: "#1f2e4a", hatch: "#6b6f74", brand: "KOSKA" } },
  { name: "ONEWAVE TITAN", cls: "giant", homeBrand: "ONEWAVE", livery: { ...navy, hull: "#b0176f", funnel: "#b0176f", stripe: "#f2f0ea", hatch: "#5a3a52", brand: "ONEWAVE" } },
  { name: "SUDWIND EXPRESS", cls: "panamax", homeBrand: "SUDWIND", livery: { ...navy, hull: "#2b2d31", funnel: "#b8322b", stripe: "#ffffff", hatch: "#4b4f55", brand: "SUDWIND" } },
];

export function fits(spec: VesselSpec, berth: BerthId) {
  return CLASSES[spec.cls].berths.includes(berth);
}

// ---------- ship-local layout (local +z = bow, local +x = port) ----------

export interface ShipLayout {
  half: number; // half length
  beam: number;
  /** Bay centres (ship-local z) for decorative bays. Contract bays are at bayZ(k). */
  decoBays: number[];
  /** Accommodation block z range and the bridge-front direction (+1 = faces bow). */
  house: { z0: number; z1: number };
  /** Separate engine house + funnel (giant) or funnel right behind the house. */
  funnel: { z0: number; z1: number; onHouse: boolean };
  /** Where the bow taper starts and the stern run begins. */
  bowStart: number;
  sternStart: number;
  /** Height of the bridge deck floor (above stacks so the officers can see over the boxes). */
  bridgeY: number;
}

/** Contract bay centre, ship-local z. Bay 0 is at local +z (the bow) so that with the ship moored bow-north
 *  (heading = PI) bay 0 sits at the berth's zMin side, exactly as deckSlotPosition() expects. */
export function bayZ(bay: number) {
  return -(bay - (CONTRACT_BAYS - 1) / 2) * BAY_PITCH;
}
/** Contract row centre, ship-local x (row 0 is the landward side when moored bow-north). */
export function rowX(row: number) {
  return -(row - (CONTRACT_ROWS - 1) / 2) * ROW_PITCH;
}

export function shipLayout(cls: VesselClass): ShipLayout {
  const half = cls.length / 2;
  const decoBays: number[] = [];
  let fwd = CARGO_HALF + 0.3; // running cursor forward of the contract block
  let aft = -CARGO_HALF - 0.3; // running cursor aft
  let house = { z0: 0, z1: 0 };
  let funnel = { z0: 0, z1: 0, onHouse: true };
  if (cls.bridge === "forward") {
    house = { z0: fwd, z1: fwd + 12 };
    fwd += 12.4;
    for (let i = 0; i < cls.decoFwd; i++) decoBays.push(fwd + BAY_PITCH / 2 + i * BAY_PITCH);
    fwd += cls.decoFwd * BAY_PITCH;
    for (let i = 0; i < cls.decoAft; i++) decoBays.push(aft - BAY_PITCH / 2 - i * BAY_PITCH);
    aft -= cls.decoAft * BAY_PITCH + 0.4;
    funnel = { z0: aft - 9, z1: aft, onHouse: false };
    aft -= 9;
  } else {
    const hl = cls.id === "feeder" ? 11 : 13;
    house = { z0: aft - hl, z1: aft };
    aft -= hl;
    funnel = { z0: aft - 6.5, z1: aft, onHouse: true };
    aft -= 6.8;
    for (let i = 0; i < cls.decoAft; i++) decoBays.push(aft - BAY_PITCH / 2 - i * BAY_PITCH);
    aft -= cls.decoAft * BAY_PITCH;
    for (let i = 0; i < cls.decoFwd; i++) decoBays.push(fwd + BAY_PITCH / 2 + i * BAY_PITCH);
    fwd += cls.decoFwd * BAY_PITCH;
  }
  const tallest = Math.max(cls.maxTier, cls.decoTiers);
  return {
    half,
    beam: cls.beam,
    decoBays,
    house,
    funnel,
    bowStart: Math.min(half - 20, fwd + 1),
    sternStart: Math.max(-half + 14, aft - 1),
    bridgeY: HATCH_TOP + tallest * TIER_H + 4.2,
  };
}
