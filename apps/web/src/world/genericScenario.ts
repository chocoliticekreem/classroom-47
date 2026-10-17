// A case from any set (generated, trick, city, bulk, haiku, hard) staged in the city: the HUD fetches its
// escalation view from the server and turns it into a CaseScenario here, so it goes through the same path as
// the 50 public cases (Scenarios module -> scenario:staged -> WorkflowDriver). The scene is a generic one near a
// delivery stop, nudged by a few keywords; it never picks scenes with side effects (storm closures, breakdowns).
import type { CaseScenario, Scene, Where } from "./scenarios";

export interface PickedCase {
  id: string;
  dataset: string;
  title: string | null;
  view: {
    context: string | null;
    initial_request?: string | null;
    events: { n: number; timestamp: string; stage: string | null; channel: string | null; from: string | null; to: string | null; body: string }[];
  };
}

const RULES: [RegExp, Scene, Where][] = [
  [/customs|import|duty|broker|invoice/, "customs_invoice", "docks"],
  [/pallet|freight|forklift/, "pallet_missing", "downtown"],
  [/refund|billing|charged|compensation|notification|sms/, "refund_review_stalled", "office"],
  [/damage|broken|crushed|leak/, "damage_evidence", "suburbs"],
  [/return|label/, "return_label_missing", "suburbs"],
  [/locker|pickup point|pick-up point|collection point/, "locker_full", "downtown"],
  [/depot|lost|tracking|scan|misrout/, "tracking_stale", "depot"],
];

/** Scene and area for a case, from its title and text. Default: a door in the suburbs. */
export function pickScene(text: string): { scene: Scene; where: Where } {
  const t = text.toLowerCase();
  for (const [re, scene, where] of RULES) if (re.test(t)) return { scene, where };
  return { scene: "failed_attempt_dispute", where: "suburbs" };
}

/** Short title for the scene card: drops a "Case 001:" / "Case:" prefix. */
export function cleanTitle(title: string | null, id: string): string {
  const t = (title ?? "").replace(/^case\s*[\w-]*\s*:\s*/i, "").trim();
  return t || id;
}

export function genericScenario(c: PickedCase): CaseScenario {
  const title = cleanTitle(c.title, c.id);
  const { scene, where } = pickScene(`${c.title ?? ""} ${c.view.context ?? ""}`);
  const events = c.view.events.filter((e) => typeof e.body === "string" && e.body.trim());
  // A view with no events still needs one message for the agent: use the opening request.
  const sent = events.length || !c.view.initial_request
    ? events
    : [{ n: 1, timestamp: "", stage: "Escalation", channel: null, from: null, to: "Rivet Delivery Desk", body: c.view.initial_request }];
  return {
    id: c.id,
    title,
    scene,
    where,
    shipment: null,
    context: c.view.context,
    request: c.view.initial_request ?? null,
    messages: sent.map((e) => ({ channel: e.channel, from: e.from, body: e.body })),
    expected: null,
    boundaries: null,
    dataset: c.dataset,
    sign: c.id.toUpperCase(),
    view: { context: c.view.context, events: sent },
  };
}
