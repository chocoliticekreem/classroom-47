/**
 * Plain mutable agent storage shared between the simulation step and any renderer.
 * Nothing here is React state: renderers read the typed arrays each frame and check `version`
 * to know whether the layout changed. Slots 0..MAX_PEOPLE-1 are people, the rest vehicles.
 */

export const MAX_PEOPLE = 2500;
export const MAX_VEHICLES = 600;
export const MAX_AGENTS = MAX_PEOPLE + MAX_VEHICLES;

export const KIND_PERSON = 0;
export const KIND_VEHICLE = 1;

export interface AgentRegistry {
  /** World x, z in metres (already includes the sidewalk / lane offset). */
  x: Float32Array;
  z: Float32Array;
  /** Travel direction in radians, 0 = north (-z), clockwise. */
  heading: Float32Array;
  /** m/s along the segment. */
  speed: Float32Array;
  /** KIND_PERSON or KIND_VEHICLE. */
  kind: Uint8Array;
  /** 1 while the slot is live; dead slots must be skipped by renderers. */
  alive: Uint8Array;
  /** 0..1 spawn/despawn fade so agents never pop. */
  fade: Float32Array;
  /** Index into the field segment list the agent is on. */
  segment: Int32Array;
  /** Metres along the segment from a→b (dir=+1) or b→a (dir=-1). */
  along: Float32Array;
  dir: Int8Array;
  /** Signed lateral offset from the centreline in metres (+ = left of travel). */
  offset: Float32Array;
  /** Per-agent variation seed 0..1 (walk bob, colour, size). */
  seed: Float32Array;
  /** -1 when the agent is leaving; its fade runs down and the slot is freed at 0. */
  dying: Int8Array;
  /** Number of live people / vehicles after the last step. */
  livePeople: number;
  liveVehicles: number;
  /** Bumps once per simulation step. */
  version: number;
}

export const registry: AgentRegistry = {
  x: new Float32Array(MAX_AGENTS),
  z: new Float32Array(MAX_AGENTS),
  heading: new Float32Array(MAX_AGENTS),
  speed: new Float32Array(MAX_AGENTS),
  kind: new Uint8Array(MAX_AGENTS),
  alive: new Uint8Array(MAX_AGENTS),
  fade: new Float32Array(MAX_AGENTS),
  segment: new Int32Array(MAX_AGENTS),
  along: new Float32Array(MAX_AGENTS),
  dir: new Int8Array(MAX_AGENTS),
  offset: new Float32Array(MAX_AGENTS),
  seed: new Float32Array(MAX_AGENTS),
  dying: new Int8Array(MAX_AGENTS),
  livePeople: 0,
  liveVehicles: 0,
  version: 0,
};
