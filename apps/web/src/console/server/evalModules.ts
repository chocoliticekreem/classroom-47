// Loads the team's eval code (scripts/eval/*.mjs) at runtime, outside the bundler, so the console
// scores with exactly the judge and answer keys `npm run eval` uses. Also makes the judge's
// ANTHROPIC_API_KEY available from apps/api/.env(.local) when the web server was started without it.
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot } from "./db";

export interface Expected {
  acceptable_dispositions: string[];
  acceptable_actions: { recipient: string; channel: string; summary: string }[];
  must: string[];
  must_not: string[];
  reference_message: string | null;
}
export interface AgentResult {
  outcome: string;
  nextAction: { recipient: string; channel: string; message: string } | null;
  handoff: string | null;
  wontDo: string[];
  /** Every message that went out, the first included (schema.mjs AgentResult.messages). */
  messages?: { recipient: string; channel: string; message: string }[];
}
export interface Judgement {
  recipient_match: boolean;
  content: "wrong" | "partial" | "right";
  must_missed: string[];
  violations: { rule: string; evidence: string }[];
  note: string;
}
export interface Verdict {
  score: number;
  pass: boolean;
  critical: boolean;
  completed: boolean;
  parts: { disposition?: number; recipient?: number; channel?: number; content?: number };
}
export interface EvalCase { id: string; set: string; mutation: string; view: unknown; expected: Expected }

export interface EvalModules {
  judge(view: unknown, expected: Expected, result: AgentResult): Promise<Judgement>;
  scoreCase(expected: Expected, result: AgentResult, judgement: Judgement | null): Verdict;
  PASS_AT: number;
  traceToResult(trace: unknown): AgentResult;
  loadCases(set: string, opts?: { withContext?: boolean }): Promise<EvalCase[]>;
  MUTATIONS: Record<string, { brief: string; dispositions: string[] }>;
}

const FILES = ["score.mjs", "agents.mjs", "cases.mjs", "mutations.mjs"];
const fileOf = (rel: string) => path.join(repoRoot(), "scripts", "eval", rel);

// Node caches an ES module per URL for the life of the process. The query string carries the
// files' mtimes so an edited eval script (a new case set, a scoring change) is picked up without a restart.
async function load(rel: string, version: string): Promise<Record<string, unknown>> {
  const url = `${pathToFileURL(fileOf(rel)).href}?v=${version}`;
  return import(/* turbopackIgnore: true */ /* webpackIgnore: true */ url);
}

function versionOf(): string {
  return FILES.map((f) => {
    try {
      return String(Math.floor(statSync(fileOf(f)).mtimeMs));
    } catch {
      return "0";
    }
  }).join("-");
}

const g = globalThis as unknown as { __consoleEval?: Promise<EvalModules>; __consoleEvalVersion?: string };

export function evalModules(): Promise<EvalModules> {
  const version = versionOf();
  if (g.__consoleEvalVersion !== version) {
    g.__consoleEval = undefined;
    g.__consoleEvalVersion = version;
  }
  g.__consoleEval ??= (async () => {
    const [score, agents, cases, mutations] = await Promise.all(FILES.map((f) => load(f, version)));
    return {
      judge: score.judge as EvalModules["judge"],
      scoreCase: score.scoreCase as EvalModules["scoreCase"],
      PASS_AT: score.PASS_AT as number,
      traceToResult: agents.traceToResult as EvalModules["traceToResult"],
      loadCases: cases.loadCases as EvalModules["loadCases"],
      MUTATIONS: mutations.MUTATIONS as EvalModules["MUTATIONS"],
    };
  })().catch((err) => {
    g.__consoleEval = undefined;
    throw err;
  });
  return g.__consoleEval;
}

/** Value of KEY in a dotenv file's text, or null. Handles quotes and `export`. */
export function dotenvValue(text: string, key: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || m[1] !== key) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    return v || null;
  }
  return null;
}

/**
 * Makes sure the judge can reach Claude: if neither ANTHROPIC_API_KEY nor ANTHROPIC_AUTH_TOKEN is set,
 * read them from apps/api/.env.local then apps/api/.env (server-side only; never logged or returned).
 */
export function ensureJudgeKey(): boolean {
  const keys = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"] as const;
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    for (const file of [".env.local", ".env"]) {
      let text: string;
      try {
        text = readFileSync(path.join(repoRoot(), "apps", "api", file), "utf8");
      } catch {
        continue;
      }
      for (const k of keys) {
        const v = dotenvValue(text, k);
        if (v && !process.env[k]) process.env[k] = v;
      }
      if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) break;
    }
  }
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}
