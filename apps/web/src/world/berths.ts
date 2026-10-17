// Port operations contract: which ship is at which berth, and its live deck cargo, so the Shipping
// module (moves ships: sea lanes, anchorage, tugs, berthing, departure) and the crane owners
// (Docks STS cranes at berth "docks", ContainerTerminal STS cranes at berth "terminal") stay in sync.
// Mutable singletons, read and written every frame; no React state. Owners:
//   - Shipping writes: ship, phase, deck grid at arrival, heading/position while moving.
//   - Crane modules write: deck slot changes as they discharge/load (take/put), and `craneDone`.
//   - Shipping reads `phase === "working"` + `craneDone` to decide when to depart.

export type BerthId = "docks" | "terminal";

export type ShipPhase =
  | "empty" // no ship at the berth
  | "approaching" // ship moving in from anchorage with tugs; cranes idle, booms up
  | "mooring" // alongside, lines going out (~6 s)
  | "working" // cranes discharge then load; ship's deck stack changes
  | "unmooring" // lines in, tugs attach (~6 s)
  | "departing"; // ship moving out to sea; cranes idle

export interface DeckSlot {
  /** Container present at this deck slot and tier, or null. Colour is a CSS hex string. */
  color: string | null;
  brand?: string;
}

export interface BerthState {
  id: BerthId;
  /** Berth line: the ship's centreline x when moored, and the z range of the quay it uses. */
  quayX: number;
  zMin: number;
  zMax: number;
  phase: ShipPhase;
  phaseStartedAt: number; // performance.now() ms
  shipName: string | null;
  /** Deck grid: rows (across the beam) × bays (along the ship) × tiers (stack height). */
  rows: number;
  bays: number;
  tiers: number;
  deck: DeckSlot[]; // length rows*bays*tiers, index = (bay * rows + row) * tiers + tier
  /** Ship pose while it's at or near the berth (the Shipping module updates it every frame). */
  x: number;
  z: number;
  heading: number; // radians, three.js rotation.y
  bob: number; // vertical offset from waves
  /** Set true by the crane owner when discharge + load are finished for this call. */
  craneDone: boolean;
  /** Counters for the HUD/console: boxes moved off and on during the current call. */
  discharged: number;
  loaded: number;
}

export function deckIndex(b: BerthState, bay: number, row: number, tier: number) {
  return (bay * b.rows + row) * b.tiers + tier;
}

/** World position of a deck slot's container centre for the berth's current ship pose (ship along z). */
export function deckSlotPosition(b: BerthState, bay: number, row: number, tier: number, deckY = 5.5) {
  const across = (row - (b.rows - 1) / 2) * 2.62;
  const along = (bay - (b.bays - 1) / 2) * 12.6;
  return { x: b.x + across, y: deckY + b.bob + 1.3 + tier * 2.6, z: b.z + along };
}

function makeBerth(id: BerthId, quayX: number, zMin: number, zMax: number, rows: number, bays: number, tiers: number): BerthState {
  return {
    id, quayX, zMin, zMax, phase: "empty", phaseStartedAt: 0, shipName: null,
    rows, bays, tiers, deck: Array.from({ length: rows * bays * tiers }, () => ({ color: null })),
    x: quayX + 400, z: (zMin + zMax) / 2, heading: 0, bob: 0, craneDone: false, discharged: 0, loaded: 0,
  };
}

/** The two container berths. Coordinates match the existing Docks and ContainerTerminal layouts. */
export const BERTHS: Record<BerthId, BerthState> = {
  docks: makeBerth("docks", 354, -77, 77, 9, 10, 4),
  terminal: makeBerth("terminal", 354, 146, 304, 9, 10, 4),
};
