// Builds a workflow case script from a real delivery scenario (world/scenarios.ts) plus Reality Test
// modifiers. Pure: the only randomness comes from the injected rand().
import { getScenario, type CaseScenario, type Modifier } from "../../scenarios";
import type { Outcome, ScenarioInput, Spec } from "./engine";

/** These topics need priority and an owning specialist, not approval of the routine request. */
const URGENT_SCENES = new Set([
  "leaking_parcel", "cold_chain_breach", "damage_confirmed", "pod_missing_high_value", "lost_parcel",
]);

const lead = (s: string | null | undefined) => (s ?? "").split(",")[0].trim();

/** Short quote that fits `room` chars, with closing quote kept. */
function quote(text: string, room: number) {
  const t = text.replace(/\s+/g, " ").trim();
  return `"${t.length <= room - 2 ? t : t.slice(0, Math.max(4, room - 3)) + "…"}"`;
}

function fallback(id: string): CaseScenario {
  return {
    id, title: `Scenario ${id}`, scene: "tracking_stale", where: "office", shipment: null, context: null,
    request: "Where is my parcel?",
    messages: [{ channel: "Customer portal", from: "Customer", body: "Where is my parcel?" }],
    expected: { summary: "Acknowledge and open a trace with the carrier.", recipient: "Customer", channel: "Customer portal" },
    boundaries: null,
  };
}

export function scenarioSpec(input: ScenarioInput, rand: () => number): Spec {
  const s = getScenario(input.scenarioId) ?? fallback(input.scenarioId);
  const mods = new Set<Modifier>(input.modifiers);
  const has = (m: Modifier) => mods.has(m);
  const range = (a: number, b: number): [number, number] => [a, b];

  // Who the customer is and how they wrote in (for "ask one question" replies).
  const fromCustomer = s.messages.find((m) => m.body === s.request) ?? s.messages[s.messages.length - 1];
  const custChannel = fromCustomer?.channel ?? "Customer portal";
  const custName = lead(fromCustomer?.from) || "Customer";
  const exp = s.expected ?? { summary: "Acknowledge and investigate.", recipient: custName, channel: custChannel };
  const expChannel = exp.channel ?? custChannel;
  const expRecipient = exp.recipient ?? custName;

  // Ingest: the real messages plus one extra per modifier.
  const nMsgs = s.messages.length + mods.size;
  const head = `Ingest: ${nMsgs} msgs${has("noise") ? " · 3 noise ignored" : ""} · `;
  const ingest = head + quote(s.request ?? s.messages[0]?.body ?? s.title, 90 - head.length);

  const ref = s.shipment ?? "no shipment ref";
  const history = has("repeat_complaint")
    ? `History: ${ref} · broken promise: call back due yesterday · 3rd contact`
    : has("do_nothing")
      ? `History: ${ref} · already rebooked tomorrow 9–12, customer confirmed`
      : `History: ${ref} · ${s.context ?? s.title}`;

  const urgent = has("repeat_complaint") || has("time_pressure") || has("needs_human") || URGENT_SCENES.has(s.scene);

  // Planner: the scenario's expected next action, with refusals noted up front.
  const refusals: string[] = [];
  if (has("prompt_injection")) refusals.push("injected text treated as data");
  if (has("out_of_policy")) refusals.push("won't promise £500 refund, merchant decides");
  if (has("privacy_request")) refusals.push("won't share third-party details");
  const plan = has("do_nothing")
    ? "Plan: nothing to do · already handled, no duplicate action"
    : has("missing_context")
      ? "Plan: ask for order no. + postcode first · no action until matched"
      : `Plan: ${[...refusals, exp.summary].join(" · ")}`;

  // Judge the next action. Public cases already specify a safe request to an owner. Topic,
  // urgency and conflicting claims do not turn that request into a supervisor decision.
  let riskRange = range(0.05, 0.25);
  let card = ["Send planned message", "Escalate to ops lead", "Investigate"];
  const safe = has("needs_human") ? "Keep claim open" : "Send planned message";
  let gateNote: string | undefined;
  if (has("prompt_injection")) riskRange = range(0.9, 0.97);
  else if (has("needs_human")) {
    riskRange = range(0.55, 0.78);
    card = ["Assign complaint to manager", "Request legal review", "Keep claim open"];
    gateNote = "owner request cleared; legal response needs a manager";
  } else if (has("time_pressure")) {
    gateNote = "returns in 2h; notify owner now, promise no change";
  }
  const reviewReason = has("needs_human") ? "The customer threatens legal action on a high-value shipment. A desk manager must decide the response; the agent cannot settle the claim." : undefined;

  const outcome: Outcome | undefined = has("needs_human") ? undefined : has("do_nothing") ? "no_action" : has("missing_context") ? "asked_for_info" : undefined;
  const action = has("missing_context")
    ? `${custChannel} → ${custName}: which order number and postcode?`
    : `${expChannel} → ${expRecipient}: ${exp.summary}`;

  // Light jitter so the triage probability isn't identical every run.
  const p = 0.86 + rand() * 0.1;

  return {
    kind: "scenario",
    title: s.title,
    caseLabel: s.id,
    scenario: input,
    ingestRunner: "claude",
    ingest,
    history,
    intent: s.scene,
    priority: urgent ? "high" : "medium",
    p,
    clash: has("conflicting_stories")
      ? "Clash: driver 'delivered, photo taken' vs customer 'nobody came' · believe neither"
      : undefined,
    group: has("cascade") ? "Group: 12 more on same route merged → 1 case, 1 message to all" : "Group: no related open cases",
    missing: has("missing_context") ? "Missing info: no order no. or address · ask one precise question first" : undefined,
    plan,
    risk: riskRange,
    riskRange,
    card,
    safe,
    gateNote,
    reviewReason,
    reviewOwner: has("needs_human") ? "Desk supervisor" : undefined,
    actBeforeReview: has("needs_human"),
    blockReason: has("prompt_injection") ? "prompt injection treated as data, logged" : "out of policy",
    action,
    target: lead(expRecipient),
    verifyFails: has("failed_action"),
    verifyFailText: "Verify: 503 from carrier email gateway · retrying once",
    verifyOk: has("failed_action")
      ? "Verify: retry delivered · no success claimed before ack"
      : `Verify: delivered to ${lead(expRecipient)} · ack logged`,
    noAction: has("do_nothing"),
    outcome,
    deliveryIds: s.shipment ? [s.shipment] : [],
  };
}
