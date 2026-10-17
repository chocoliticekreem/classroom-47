// Catalogue of every flow NodeType (apps/api/src/lib/flow.ts): label, palette group, colour, icon
// key, default runners, and named outputs. Labels come from the shared plain-words glossary; the
// descriptions are our own short lines (never the Architect's prompt text).
import type { NodeType, Runner } from "../types";
import { plainGate, plainNode } from "../../ui/plain";

export type IconKey =
  | "router" | "box" | "scale" | "map" | "camera" | "heart"
  | "inbox" | "history" | "triage" | "users" | "clash" | "group" | "question"
  | "planner" | "shield" | "person" | "send" | "route" | "check"
  | "log" | "handshake" | "spark";

export type Group = "Watch" | "Understand" | "Judge" | "Plan" | "Control" | "Act" | "Record";

export interface NodeMeta {
  type: NodeType;
  label: string;
  description: string;
  group: Group;
  icon: IconKey;
  color: string; // accent for the icon tile and minimap
  runners: Runner[]; // default runners when dropped from the palette
  /** Named outputs. Absent = a single unnamed output. */
  outputs?: string[];
  defaultConfig?: Record<string, unknown>;
}

export const GATE_OUTPUTS = ["allow", "ask", "block"] as const;

const C = {
  watch: "#38bdf8",
  understand: "#60a5fa",
  judge: "#2dd4bf",
  plan: "#ff6a1a",
  control: "#f43f5e",
  act: "#22c55e",
  record: "#94a3b8",
};

export const NODE_META: Record<NodeType, NodeMeta> = {
  event_router: { type: "event_router", label: plainNode("event_router"), description: "Sends each update to the right check.", group: "Watch", icon: "router", color: C.watch, runners: ["code"] },
  order_check: { type: "order_check", label: plainNode("order_check"), description: "Is the order complete before it leaves?", group: "Watch", icon: "box", color: C.watch, runners: ["jev", "code"] },
  load_check: { type: "load_check", label: plainNode("load_check"), description: "Is the load on the right van?", group: "Watch", icon: "scale", color: C.watch, runners: ["code"] },
  on_route_check: { type: "on_route_check", label: plainNode("on_route_check"), description: "Is the delivery running late?", group: "Watch", icon: "map", color: C.watch, runners: ["code", "ortools"] },
  proof_check: { type: "proof_check", label: plainNode("proof_check"), description: "Does the proof match the address?", group: "Watch", icon: "camera", color: C.watch, runners: ["jev", "claude"] },
  aftercare_check: { type: "aftercare_check", label: plainNode("aftercare_check"), description: "Is a complaint or promise still open?", group: "Watch", icon: "heart", color: C.watch, runners: ["jev"] },

  ingest: { type: "ingest", label: plainNode("ingest"), description: "Reads every message and file.", group: "Understand", icon: "inbox", color: C.understand, runners: ["code", "claude"] },
  history_lookup: { type: "history_lookup", label: plainNode("history_lookup"), description: "Looks up the order and past contact.", group: "Understand", icon: "history", color: C.understand, runners: ["code"] },
  triage: { type: "triage", label: plainNode("triage"), description: "Sorts the problem and how urgent.", group: "Judge", icon: "triage", color: C.judge, runners: ["jev"] },
  perspectives: { type: "perspectives", label: plainNode("perspectives"), description: "Looks at the case from several sides.", group: "Judge", icon: "users", color: C.judge, runners: ["jev", "code"], defaultConfig: { rules: {} } },
  clash_check: { type: "clash_check", label: plainNode("clash_check"), description: "Checks if people's stories agree.", group: "Judge", icon: "clash", color: C.judge, runners: ["claude", "jev"] },
  group_check: { type: "group_check", label: plainNode("group_check"), description: "Is this part of a bigger problem?", group: "Judge", icon: "group", color: C.judge, runners: ["jev", "code"] },
  missing_info: { type: "missing_info", label: plainNode("missing_info"), description: "Do we need to ask something first?", group: "Judge", icon: "question", color: C.judge, runners: ["jev", "claude"] },

  planner: { type: "planner", label: plainNode("planner"), description: "Decides what to do and writes it.", group: "Plan", icon: "planner", color: C.plan, runners: ["claude"] },
  replan_route: { type: "replan_route", label: plainNode("replan_route"), description: "Moves stops between vans.", group: "Plan", icon: "route", color: C.plan, runners: ["ortools", "code"] },

  safety_gate: { type: "safety_gate", label: plainNode("safety_gate"), description: "Checks the plan is safe to send.", group: "Control", icon: "shield", color: C.control, runners: ["jev", "code"], outputs: [...GATE_OUTPUTS], defaultConfig: { allow_below: 0.3, block_above: 0.8 } },
  human_decision: { type: "human_decision", label: plainNode("human_decision"), description: "A person makes the call.", group: "Control", icon: "person", color: C.control, runners: ["claude", "code"] },

  action: { type: "action", label: plainNode("action"), description: "Sends the approved message.", group: "Act", icon: "send", color: C.act, runners: ["code"] },
  verify: { type: "verify", label: plainNode("verify"), description: "Checks the message got through.", group: "Act", icon: "check", color: C.act, runners: ["jev"] },

  case_log: { type: "case_log", label: plainNode("case_log"), description: "Writes down what happened.", group: "Record", icon: "log", color: C.record, runners: ["code"] },
  promise_tracker: { type: "promise_tracker", label: plainNode("promise_tracker"), description: "Chases promises before they're late.", group: "Record", icon: "handshake", color: C.record, runners: ["code"] },
  learner: { type: "learner", label: plainNode("learner"), description: "Learns from what people decide.", group: "Record", icon: "spark", color: C.record, runners: ["claude", "code"] },
};

export const ALL_NODE_TYPES = Object.keys(NODE_META) as NodeType[];
export const GROUP_ORDER: Group[] = ["Watch", "Understand", "Judge", "Plan", "Control", "Act", "Record"];
export const ALL_RUNNERS: Runner[] = ["jev", "claude", "code", "ortools"];

export const RUNNER_STYLE: Record<Runner, { label: string; fg: string; bg: string }> = {
  jev: { label: "Jev", fg: "#c4b5fd", bg: "rgba(167,139,250,0.14)" },
  claude: { label: "Claude", fg: "#f0a27a", bg: "rgba(217,119,87,0.16)" },
  code: { label: "code", fg: "#cbd5e1", bg: "rgba(148,163,184,0.14)" },
  ortools: { label: "OR-Tools", fg: "#86efac", bg: "rgba(34,197,94,0.14)" },
};

export function metaFor(type: string): NodeMeta {
  return (NODE_META as Record<string, NodeMeta>)[type] ?? {
    type: type as NodeType, label: plainNode(type), description: "A custom step.", group: "Record",
    icon: "spark", color: C.record, runners: ["code"],
  };
}

/** Display title of a node: its `name` when the flow gives one (optional, not yet in every flow), else the type label. */
export function nodeTitle(node: { type: string; name?: unknown }): string {
  return typeof node.name === "string" && node.name.trim() ? node.name.trim() : plainNode(node.type);
}

const WHEN_WORDS: Record<string, string> = {
  ok: "Worked", failed: "Didn't work", retry: "Try again", approve: "Approved", reject: "Turned down",
  fallback: "No answer", force_human: "Needs a person", brief: "Go on", missing: "Something missing",
  complete: "All there", clash: "Stories differ", consistent: "Stories match", linked: "Same cause",
  single: "On its own", proceed: "Go ahead", other: "Anything else",
};

/** A branch label in plain words: OK / Ask a person / Stop for safety checks, words for the rest. */
export function plainWhen(when: string | undefined): string {
  if (!when) return "";
  const w = when.toLowerCase();
  if (w === "allow" || w === "ask" || w === "block") return plainGate(w);
  if (WHEN_WORDS[w]) return WHEN_WORDS[w];
  const t = when.replace(/[_-]+/g, " ").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}

/** Palette search: matches label, type, group or description, case-insensitive. */
export function searchNodeTypes(q: string): NodeMeta[] {
  const s = q.trim().toLowerCase();
  const all = ALL_NODE_TYPES.map((t) => NODE_META[t]);
  if (!s) return all;
  return all.filter((m) =>
    [m.label, m.type, m.group, m.description].some((f) => f.toLowerCase().includes(s)));
}
