// Plain-words glossary: the ONE place internal names become words a person reads.
// (docs/plans/ui-simplify-brief.md). Extend it, never fork it. Unknown values fall back to a
// humanised version of the key, never to raw JSON or ids.

function fallback(s: string | null | undefined): string {
  if (!s) return "";
  const t = String(s).replace(/[_-]+/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
}

const NODE: Record<string, string> = {
  ingest: "Read the messages",
  history_lookup: "Check past orders",
  triage: "What kind of problem?",
  perspectives: "Second opinions",
  clash_check: "Do the stories match?",
  group_check: "Same cause as others?",
  missing_info: "Anything missing?",
  planner: "Plan the reply",
  safety_gate: "Safety check",
  human_decision: "Ask a person",
  action: "Send it",
  verify: "Did it work?",
  case_log: "Done",
  promise_tracker: "Follow up later",
  replan_route: "Change the route",
  learner: "Learn from it",
  event_router: "Sort the update",
  order_check: "Check the order",
  load_check: "Check the load",
  on_route_check: "Check on the road",
  proof_check: "Check the proof",
  aftercare_check: "Check afterwards",
};

/** Step name for a node type: "safety_gate" -> "Safety check". */
export function plainNode(type: string | null | undefined): string {
  if (!type) return "Step";
  return NODE[type] ?? fallback(type);
}

const OUTCOME: Record<string, string> = {
  acted: "Sent",
  escalated: "Needs a person",
  asked_for_info: "Asked a question",
  no_action: "Nothing to do",
  blocked: "Stopped",
  error: "Didn't finish",
};

/** Case result: "escalated" -> "Needs a person". null -> "Not finished". */
export function plainOutcome(o: string | null | undefined): string {
  if (!o) return "Not finished";
  return OUTCOME[o] ?? fallback(o);
}

const GATE: Record<string, string> = { allow: "OK", ask: "Ask a person", block: "Stop" };

/** Safety check verdict: allow / ask / block -> OK / Ask a person / Stop. */
export function plainGate(g: string | null | undefined): string {
  if (!g) return "";
  return GATE[g] ?? fallback(g);
}

/** Risk score 0..1 -> "low" | "medium" | "high" (same cut-offs as the default safety check). */
export function riskWord(n: number | null | undefined): "low" | "medium" | "high" | "" {
  if (typeof n !== "number" || !Number.isFinite(n)) return "";
  if (n < 0.3) return "low";
  if (n < 0.8) return "medium";
  return "high";
}

/** Money for a caption: 0.0781 -> "8¢", 0.002 -> "<1¢", 1.236 -> "$1.24". */
export function cents(usd: number | null | undefined): string {
  if (typeof usd !== "number" || !Number.isFinite(usd) || usd < 0) return "";
  if (usd === 0) return "0¢";
  if (usd < 0.005) return "<1¢";
  if (usd < 1) return `${Math.round(usd * 100)}¢`;
  return `$${usd.toFixed(2)}`;
}

const CASE_TYPE: Record<string, string> = {
  slot_change: "Change of time",
  address: "Address problem",
  access: "Couldn't get in",
  missed_or_failed_delivery: "Missed delivery",
  damage: "Damaged goods",
  damaged: "Damaged goods",
  lost_or_misdelivered: "Lost or wrong address",
  missing: "Lost or wrong address",
  cold_chain: "Chilled or frozen goods",
  returns: "Return",
  freight: "Big or bulk order",
  customs_and_charges: "Customs or charges",
  billing: "Bill or refund",
  safety: "Safety risk",
  formal_request: "Legal or formal request",
  other: "Something else",
};

/** Triage case type: "lost_or_misdelivered" -> "Lost or wrong address". */
export function plainCaseType(t: string | null | undefined): string {
  if (!t) return "";
  return CASE_TYPE[t] ?? fallback(t);
}

const DATASET: Record<string, string> = {
  public: "Sample cases",
  generated: "Generated cases",
  grounded: "Real-world cases",
  adversarial: "Trick cases",
  fixtures: "Hard cases",
  reality: "Test day cases",
  adhoc: "One-off cases",
  city: "City cases",
  haiku: "Extra written cases",
  bulk: "Bulk (rule-made)",
};

/** Where a case came from, in words. */
export function plainDataset(d: string | null | undefined): string {
  if (!d) return "";
  return DATASET[d] ?? fallback(d);
}

const STATUS: Record<string, string> = { running: "Working on it", success: "Finished", error: "Didn't finish" };

/**
 * Why a case run did not finish, in words a person can act on. The raw error can carry request
 * ids and provider text, so it is never shown; only the kind of failure is.
 */
export function plainFailure(error: string | null | undefined): string {
  if (!error) return "";
  if (/usage limit|credit balance|billing|quota/i.test(error)) return "The AI account has run out of credit. No case can run until it is topped up.";
  if (/\b401\b|\b403\b|authentication|api[- ]key|permission/i.test(error)) return "The AI key was refused. Check the key in the settings file.";
  if (/\b429\b|rate limit|overloaded|\b529\b/i.test(error)) return "The AI service is busy. Try again in a minute.";
  if (/did not answer|timed? ?out|exceeded \d+s/i.test(error)) return "It took too long and was stopped.";
  if (/ECONNREFUSED|fetch failed|network/i.test(error)) return "The agent is not reachable. Is it running?";
  if (/not valid|\b422\b/i.test(error)) return "This playbook has a problem, so it was not run.";
  return "Something went wrong before it could finish.";
}

/** Case run status: running / success / error. */
export function plainStatus(s: string | null | undefined): string {
  if (!s) return "";
  return STATUS[s] ?? fallback(s);
}

// ---------------------------------------------------------------------------------------------
// Step summaries (brief addendum). The backend writes developer summaries into each step's
// node_end.summary. NEVER render them raw: use plainStep(), which returns one short sentence or
// null (null = hide the step).

const LEAK = /\b(?:jev|claude|anthropic|sonnet|haiku|opus|or-?tools)[\w.-]*|\boutbox\b|\bconfig\w*|\btraces?\b|\brun_end\b|\bkeys?\b|\bjson\b/gi;
const DANGLING = /\s+\b(?:by|via|in|from|the|with|no|of|to|a|an)\b\s*(?=[;,.:)]|$)/gi;

/**
 * Strip leak words (model/runner names, outbox, config, trace, run_end, key, json), JSON-ish
 * blobs and snake_case from any user-visible string. Returns "" when nothing readable is left.
 */
export function scrubLeaks(text: string | null | undefined): string {
  if (!text) return "";
  let s = String(text)
    .replace(/\{[^{}]*\}|\[[^[\]]*\]/g, " ") // JSON-ish blobs
    .replace(LEAK, " ")
    .replace(/\b([A-Za-z]+(?:_[A-Za-z0-9]+)+)\b/g, (m) => m.replace(/_/g, " ").toLowerCase())
    .replace(/\s+/g, " ");
  for (let i = 0; i < 3; i++) s = s.replace(DANGLING, "");
  s = s
    .replace(/\(\s*\)/g, "")
    .replace(/\s+([;,.:)])/g, "$1")
    .replace(/([;,:])(?=[;,.:])/g, "")
    .replace(/^[\s;,.:·-]+|[\s;,:·-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return s;
}

/** Node ids used in traces -> node types. */
const NODE_ALIAS: Record<string, string> = {
  gate: "safety_gate",
  log: "case_log",
  history: "history_lookup",
  clash: "clash_check",
  human: "human_decision",
  plan: "planner",
  missing: "missing_info",
  group: "group_check",
  act: "action",
};

const STEP_PREFIX = new Set([...Object.keys(NODE), ...Object.keys(NODE_ALIAS)]);

function shorten(s: string, max = 60): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > 30 ? cut.slice(0, sp) : cut).replace(/[\s,;:.-]+$/, "")}…`;
}

const n = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const plural = (k: number, one: string, many: string) => (k === 1 ? one : many);

/** Recipient/owner names are plain already, but scrub them anyway. */
function who(x: unknown): string {
  return typeof x === "string" ? shorten(scrubLeaks(x), 40) : "";
}

/**
 * One short plain sentence for a finished step, or null to hide it.
 *   plainStep("triage", "missed_or_failed_delivery · medium") -> "Problem: missed delivery"
 *   plainStep("perspectives", "skipped: no Jev key")            -> null
 * `nodeType` may be a node type or a trace node id ("gate", "log"). `output` is node_end.output.
 */
export function plainStep(
  nodeType: string | null | undefined,
  summary: string | null | undefined,
  output?: unknown,
): string | null {
  const rawType = (nodeType ?? "").trim();
  const type = NODE_ALIAS[rawType] ?? rawType;
  let s = (summary ?? "").trim();
  // Some views prefix the node id ("triage: …"); drop it once.
  const pre = /^([a-z_]+):\s*/.exec(s);
  if (pre && STEP_PREFIX.has(pre[1]) && (NODE_ALIAS[pre[1]] ?? pre[1]) === type) s = s.slice(pre[0].length);
  const out = (output && typeof output === "object" ? output : {}) as Record<string, unknown>;
  const step = plainNode(type);

  if (/^failed\b/i.test(s)) return `${step}: didn't finish`;

  switch (type) {
    case "ingest":
      return "Read the messages";

    case "history_lookup": {
      const m = /(\d+)\s+open commitments?/i.exec(s);
      const k = m ? Number(m[1]) : 0;
      return k > 0 ? `Found ${k} open ${plural(k, "promise", "promises")}` : "Checked past orders";
    }

    case "triage": {
      const t = typeof out.caseType === "string" ? out.caseType : s.split("·")[0].trim();
      const word = plainCaseType(t);
      return word ? `Problem: ${word.toLowerCase()}` : "Sorted the problem";
    }

    case "perspectives": {
      if (/skipped|no .*key|error|failed/i.test(s) || /skipped/.test(String(out.status ?? ""))) return null;
      return /needs a human/i.test(s) ? "Second opinions: ask a person" : "Got second opinions";
    }

    case "clash_check": {
      const m = /^\d+\s+conflicts?:\s*(.+)$/i.exec(s);
      if (m) {
        const why = shorten(scrubLeaks(m[1]));
        return why ? `The stories don't match: ${why}` : "The stories don't match";
      }
      if (out.clash === true || /may conflict/i.test(s)) return "The stories may not match";
      return "The stories match";
    }

    case "group_check":
      return /\b(\d+)\b/.test(s) && !/^0\b|no /i.test(s) ? "Same cause as other cases" : "Checked for the same cause";

    case "missing_info":
      return out.missing === true || /missing|ask/i.test(s) ? "Something is missing" : "Nothing missing";

    case "planner": {
      const kind = /^(act|ask_for_info|escalate_to_human|wait_no_action)\b/.exec(s)?.[1];
      const next = (out.nextAction ?? null) as Record<string, unknown> | null;
      const to = who(next?.recipient);
      if (kind === "escalate_to_human") return "Plan: ask a person";
      if (kind === "wait_no_action") return "Plan: nothing to do";
      if (kind === "ask_for_info") return to ? `Plan: ask ${to} a question` : "Plan: ask a question";
      if (kind === "act" || next) return to ? `Plan: send a message to ${to}` : "Plan: send a message";
      return "Planned the reply";
    }

    case "safety_gate": {
      const decision = typeof out.decision === "string" ? out.decision : null;
      if (decision === "block") return "Safety check stopped it";
      if (/^nothing to send/i.test(s)) return "Safety check: nothing to send";
      const m = /(\d+)\s+of\s+(\d+)\s+messages?\s+cleared/i.exec(s);
      const held = m ? Number(m[2]) - Number(m[1]) : 0;
      if (held > 0) return `Safety check: ${held} held for a person`;
      if (decision === "ask") return "Safety check: held for a person";
      return "Safety check passed";
    }

    case "human_decision": {
      const m = /^Answered by [^:]*:\s*(.+)$/i.exec(s);
      if (m) return `A person chose: ${shorten(scrubLeaks(m[1]), 50)}`;
      return "A person needs to decide";
    }

    case "action": {
      const m = /^(\d+)\s+of\s+\d+\s+messages?/i.exec(s);
      const k = m ? Number(m[1]) : n(out.ok === false ? 0 : null);
      if (k === 0) return "No message sent";
      if (k !== null && k > 1) return `${k} messages sent`;
      return "Message sent";
    }

    case "verify": {
      const m = /^(\d+)\s+messages?\s+(?:\(s\)\s+)?not delivered/i.exec(s.replace("message(s)", "messages"));
      if (m) {
        const k = Number(m[1]);
        return `${k} ${plural(k, "message", "messages")} not delivered`;
      }
      return out.ok === false ? "Not delivered yet" : "Sent, waiting for a reply";
    }

    case "case_log":
      return null;

    case "promise_tracker":
      return "Will follow up later";

    case "replan_route":
      return "Changed the route";

    default: {
      if (/^skipped\b/i.test(s)) return null;
      const clean = shorten(scrubLeaks(s));
      return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : rawType ? step : null;
    }
  }
}

// Added by the review-desk agent.
/** Who a held case goes to: "desk_duty_supervisor" -> "Desk supervisor". */
export function plainOwner(o: string | null | undefined): string {
  if (!o) return "A team lead";
  const raw = scrubLeaks(String(o).replace(/[_-]+/g, " ").replace(/\bduty\b/gi, " "));
  const id = /_/.test(String(o)) || raw === raw.toLowerCase();
  const t = (id ? raw.toLowerCase() : raw).replace(/\bon call\b/gi, "on-call").replace(/\s+/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "A team lead";
}
