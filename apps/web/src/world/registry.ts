// Live vehicle registry: every moving vehicle registers here so others can see it
// (traffic spacing, crashes picking victims, camera follow, minimap). Mutable, read every frame.
import type { Object3D } from "three";

export type VehicleKind =
  | "car" | "taxi" | "bus" | "van" | "truck" | "police" | "ambulance" | "fire" | "roadworks" | "tow"
  | "cyclist" // a bike + rider; can be hit (Collisions turns that into a cyclist_hit incident)
  | "motorcade"; // an escorted VIP vehicle (other traffic must yield, never crash into it)

export interface VehicleEntry {
  id: string;
  kind: VehicleKind;
  object: Object3D; // the vehicle's root group; read object.position / rotation.y
  edgeKey: string | null; // road it's on now
  from: string | null; // node it's coming from
  to: string | null; // node it's heading to
  t: number; // 0..1 along from->to
  speed: number; // m/s right now
  stopped: boolean; // true when parked, crashed, queued
  /** Owner can implement: make this vehicle crash now (it stops, tilts, smokes). Return false to refuse. */
  crash?: () => boolean;
}

const vehicles = new Map<string, VehicleEntry>();

export function registerVehicle(v: VehicleEntry) {
  vehicles.set(v.id, v);
  return () => vehicles.delete(v.id);
}

export function getVehicle(id: string) {
  return vehicles.get(id);
}

export function allVehicles(): IterableIterator<VehicleEntry> {
  return vehicles.values();
}

/** Vehicles on the same directed lane (from->to) ahead of `t`, nearest first. For following distance. */
export function vehiclesAhead(from: string, to: string, t: number, selfId: string): VehicleEntry[] {
  const out: VehicleEntry[] = [];
  for (const v of vehicles.values()) if (v.id !== selfId && v.from === from && v.to === to && v.t > t) out.push(v);
  return out.sort((a, b) => a.t - b.t);
}

let seq = 0;
export function nextId(prefix: string) {
  seq += 1;
  return `${prefix}-${seq}`;
}
