// Pure scene table: for every Scene, which prop kit stages it, its sign text and accent colour.
// The renderer (SceneProps.tsx) composes kits; this table keeps every scene distinct and testable.
import type { Modifier, Scene } from "../../scenarios";

export type Kit = "door" | "kerb" | "depot" | "docks" | "road" | "office";

export interface SceneSpec {
  kit: Kit;
  sign: string; // short sign / hologram text drawn on a canvas
  accent: string; // sign colour
  /** road scenes that sit on the centre line rather than the kerb */
  onRoad?: boolean;
}

const RED = "#e5383b";
const AMBER = "#f4a261";
const BLUE = "#3a86ff";
const GREEN = "#2a9d8f";
const ORANGE = "#ff6a1a";
const PURPLE = "#8e5bd8";

export const SCENES: Record<Scene, SceneSpec> = {
  // at the door
  door_slot_change: { kit: "door", sign: "SLOT 09-12 ?", accent: BLUE },
  address_incomplete: { kit: "kerb", sign: "FLAT ?", accent: AMBER },
  access_gated: { kit: "door", sign: "GATE CODE ?", accent: RED },
  call_before_arrival: { kit: "door", sign: "CALL FIRST", accent: BLUE },
  alternate_recipient: { kit: "door", sign: "LEAVE WITH NO.12", accent: GREEN },
  bulky_access: { kit: "door", sign: "WON'T FIT", accent: AMBER },
  failed_attempt_dispute: { kit: "door", sign: "WE MISSED YOU?", accent: RED },
  business_closed: { kit: "kerb", sign: "CLOSED 17:00", accent: RED },
  partial_delivery: { kit: "door", sign: "1 OF 2", accent: AMBER },
  delivered_not_received: { kit: "door", sign: "DELIVERED ✓", accent: GREEN },
  misdelivered_neighbour: { kit: "door", sign: "WRONG DOOR", accent: AMBER },
  misdelivered_wrong_customer: { kit: "door", sign: "WRONG HOUSE", accent: RED },
  wrong_item: { kit: "door", sign: "ORDERED: LAMP", accent: PURPLE },
  duplicate_shipment: { kit: "door", sign: "x2 SAME ORDER", accent: PURPLE },
  pod_missing_high_value: { kit: "kerb", sign: "£ NO PROOF", accent: RED },
  // damage and safety
  damage_evidence: { kit: "door", sign: "PHOTO EVIDENCE", accent: AMBER },
  damage_confirmed: { kit: "door", sign: "BROKEN", accent: RED },
  leaking_parcel: { kit: "depot", sign: "LEAK: HAZARD", accent: RED },
  cold_chain_breach: { kit: "road", sign: "+9°C", accent: RED },
  // pickup points and lockers
  pickup_point: { kit: "kerb", sign: "PICKUP 48h", accent: BLUE },
  locker_full: { kit: "kerb", sign: "FULL", accent: RED },
  // depot and network
  hold_delivery: { kit: "depot", sign: "ON HOLD", accent: AMBER },
  tracking_stale: { kit: "depot", sign: "LAST SCAN 3d AGO", accent: AMBER },
  misrouted_depot: { kit: "depot", sign: "WRONG BELT", accent: RED },
  return_deadline: { kit: "depot", sign: "RETURNS IN", accent: RED },
  lost_parcel: { kit: "depot", sign: "SEARCHING…", accent: BLUE },
  return_stuck_depot: { kit: "depot", sign: "STUCK: RETURNS", accent: AMBER },
  returned_to_sender: { kit: "depot", sign: "↩ TO SENDER", accent: PURPLE },
  cancel_before_dispatch: { kit: "depot", sign: "CANCELLED", accent: RED },
  // on the road
  vehicle_breakdown: { kit: "road", sign: "BREAKDOWN", accent: AMBER },
  severe_weather: { kit: "road", sign: "ROUTE SUSPENDED: STORM", accent: RED, onRoad: true },
  // returns
  return_label_missing: { kit: "door", sign: "NO LABEL", accent: AMBER },
  return_label_printer: { kit: "kerb", sign: "PRINTER ERR", accent: RED },
  return_collection_missed: { kit: "door", sign: "COLLECT 14:00 ?", accent: AMBER },
  heavy_item_collection: { kit: "door", sign: "2-PERSON LIFT", accent: BLUE },
  // business, freight and customs
  business_collection: { kit: "kerb", sign: "COLLECT 16:00", accent: BLUE },
  pallet_no_appointment: { kit: "kerb", sign: "NO SLOT BOOKED", accent: AMBER },
  pallet_no_forklift: { kit: "kerb", sign: "NO FORKLIFT", accent: RED },
  pallet_missing: { kit: "kerb", sign: "PALLET ?", accent: RED },
  freight_dimensions: { kit: "docks", sign: "1.2m x ?", accent: AMBER },
  customs_invoice: { kit: "docks", sign: "HELD: INVOICE", accent: RED },
  customs_broker: { kit: "docks", sign: "BROKER", accent: BLUE },
  import_charge: { kit: "docks", sign: "£ IMPORT DUTY", accent: AMBER },
  customs_last_mile: { kit: "docks", sign: "HANDOVER", accent: GREEN },
  // back office
  notification_broken: { kit: "office", sign: "SMS FAILED", accent: RED },
  refund_review_stalled: { kit: "office", sign: "REFUND REVIEW", accent: AMBER },
  billing_duplicate: { kit: "office", sign: "CHARGED x2", accent: RED },
  guarantee_refund: { kit: "office", sign: "LATE: GUARANTEE", accent: PURPLE },
};

export const MODIFIER_CHIP: Record<Modifier, string> = {
  conflicting_stories: "clash",
  failed_action: "tool fails",
  missing_context: "missing info",
  noise: "noise",
  needs_human: "needs human",
  out_of_policy: "out of policy",
  prompt_injection: "injection",
  privacy_request: "privacy",
  repeat_complaint: "3rd time",
  cascade: "cascade",
  time_pressure: "deadline",
  do_nothing: "already handled",
};

export const OUTCOME_LABEL: Record<import("../../bus").ScenarioOutcome, { text: string; color: string }> = {
  acted: { text: "Acted", color: GREEN },
  asked_for_info: { text: "Asked for info", color: BLUE },
  escalated: { text: "Escalated", color: AMBER },
  blocked: { text: "Blocked", color: RED },
  no_action: { text: "No action", color: "#8d99ae" },
  // PRD J3: the real agent's wait_until, refuse and route_to_owner.
  waiting: { text: "Waiting", color: "#8d99ae" },
  refused: { text: "Refused", color: RED },
  routed: { text: "Routed to owner", color: BLUE },
};

export const BRAND = ORANGE;
