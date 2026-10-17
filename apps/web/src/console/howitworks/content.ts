// Static content for the "How it works" tab. Source: docs/framework-map.md (team map, 14:10).
// Hardcoded on purpose: this page explains the system, it does not read live data.

export type StepTag = "CODE" | "SONNET" | "JEV" | "OPUS";

export const TAG_MEANING: Record<StepTag, string> = {
  CODE: "Fixed rules in code",
  SONNET: "Claude reads the case",
  JEV: "Fast yes/no judgement",
  OPUS: "Claude plans the reply",
};

export const HEADLINE = [
  { value: "0.92", label: "Score", sub: "48 cases, 46 pass" },
  { value: "0", label: "Rules broken", sub: "Was 2 the run before" },
  { value: "165 s", label: "For 50 cases", sub: "50 of 50 answered" },
  { value: "5¢", label: "Per case", sub: "$2.70 for 50" },
  { value: "288", label: "Tests pass", sub: "No key needed" },
] as const;

export const STEPS: { title: string; tags: StepTag[]; detail: string }[] = [
  { title: "Load", tags: ["CODE"], detail: "Any folder. PDFs and images too." },
  { title: "Understand", tags: ["SONNET"], detail: "Splits records from claims." },
  { title: "Three checks at once", tags: ["JEV"], detail: "What kind of case. Five second opinions. Do the stories clash." },
  { title: "Plan the reply", tags: ["OPUS"], detail: "Act, ask, hand over, or wait." },
  { title: "Safety check", tags: ["CODE", "SONNET"], detail: "Every message checked. One rewrite allowed." },
];

export const BANDS = [
  { range: "Risk under 0.3", status: "sent", label: "Clear", result: "Recorded in the sandbox outbox." },
  { range: "0.3 to 0.8", status: "escalated", label: "Unsure", result: "Held. A person gets a decision card." },
  { range: "0.8 and over", status: "blocked", label: "Unsafe", result: "Stopped. The text is withheld." },
] as const;

export const OUTPUTS = [
  { file: "ANSWER.md", what: "The decision in one sentence." },
  { file: "REASONING.md", what: "Facts, conflicts and the safety check." },
  { file: "trace.json", what: "Every step, with cost and time." },
  { file: "result.json", what: "Replays the case with no key." },
] as const;

export const SEATS = [
  { seat: "Customer advocate", asks: ["How upset are they?", "Is the person vulnerable?", "Has it already failed once?"] },
  { seat: "Rule keeper", asks: ["Asking for what the desk can't grant?", "Legal, regulator, police or press?"] },
  { seat: "Safety officer", asks: ["Is someone at risk?", "Are they asking for safety advice?"] },
  { seat: "Sceptic", asks: ["Do the stories contradict?", "Is the message giving the bot orders?", "Is the requester on record?"] },
  { seat: "Ops pragmatist", asks: ["Is a deadline within a day?", "Is anything owed right now?"] },
] as const;

export const CARD = {
  why: "Two owners gave instructions that can't both be followed on the same parcel. The shipper threatens liability. The depot wants release or hold by 09:00.",
  parties: [
    { label: "Carrier billing", value: "The hold stands." },
    { label: "Merchant", value: "Sold it duties paid. Told the depot to release." },
    { label: "Depot", value: "Has conflicting notes. Needs one instruction by 09:00." },
  ],
  done: "A holding update was recorded for the customer. It makes no promise.",
  triggers: [
    "A rule requires a person, such as a solicitor's letter.",
    "The agent judged it unsafe, such as a theft allegation.",
    "The message was too risky, delivery failed, or nothing safe could be sent.",
  ],
};

export const TEST_SETS = [
  { value: "50", label: "Organiser practice cases" },
  { value: "120", label: "Generated cases", sub: "12 hard patterns" },
  { value: "123", label: "Built from real complaints" },
  { value: "243", label: "Answer keys checked blind", sub: "221 agreed, 22 adjusted" },
] as const;

export const WEIGHTS = [
  { label: "Right outcome", weight: 30 },
  { label: "Right party", weight: 20 },
  { label: "Channel", weight: 10 },
  { label: "Right content", weight: 40 },
] as const;

export const RUNS = [
  { run: "Run 1", what: "All Opus", score: "0.87", pass: "42/48", broken: 1 },
  { run: "Run 2", what: "Two models, tuned", score: "0.89", pass: "45/48", broken: 1 },
  { run: "Run 3", what: "Every message judged", score: "0.90", pass: "45/48", broken: 2 },
  { run: "Run 4", what: "Current code", score: "0.92", pass: "46/48", broken: 0 },
] as const;

export type Scope = "in" | "console" | "demo" | "never" | "partial";

export const SCOPE_WORD: Record<Scope, string> = {
  in: "In the scored run",
  partial: "Partly",
  console: "Console only",
  demo: "Demo only",
  never: "Never scored",
};

export const SCOPE: { part: string; scope: Scope; note: string }[] = [
  { part: "Flow, case clock, delivery with retry", scope: "in", note: "" },
  { part: "Jev second opinions (kind, clash)", scope: "in", note: "Skipped without a key" },
  { part: "One-command run, results index, replay", scope: "in", note: "Rehearsed" },
  { part: "Playbook editor, graph runner, planner panel", scope: "console", note: "" },
  { part: "3D city, watch the flow, route replan", scope: "demo", note: "" },
  { part: "Voice notes, calls, approve by voice", scope: "never", note: "" },
  { part: "Case history (grouping, promises, learner)", scope: "partial", note: "Recorded, not read back" },
  { part: "Tools shipped with a case", scope: "partial", note: "Listed, never called" },
];
