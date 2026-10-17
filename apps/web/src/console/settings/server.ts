// Server side of the Settings tab: what is connected (presence only, never key values) and
// which build is running. Used by app/api/console/settings/route.ts.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { repoRoot } from "../server/db";
import { agentUrl } from "../server/execute";

const run = promisify(execFile);

export interface SettingsInfo {
  /** Agent API answered /api/health and has its writing-model key. */
  agent: boolean;
  /** The voice routes are there (a preflight to /api/voice/session is answered). */
  voice: boolean;
  /** The second-opinion key is set on the agent API (presence only). */
  secondOpinions: boolean;
  /** Short commit hash, or null when git is not available. */
  commit: string | null;
}

async function health(): Promise<{ ok: boolean; ready: boolean; jev: boolean }> {
  try {
    const res = await fetch(`${agentUrl()}/api/health`, { signal: AbortSignal.timeout(2000), cache: "no-store" });
    if (!res.ok) return { ok: false, ready: false, jev: false };
    const body = (await res.json()) as { agent?: { ready?: unknown; jev?: unknown } };
    return { ok: true, ready: body.agent?.ready === true, jev: body.agent?.jev === true };
  } catch {
    return { ok: false, ready: false, jev: false };
  }
}

async function voiceRoute(): Promise<boolean> {
  try {
    const res = await fetch(`${agentUrl()}/api/voice/session`, {
      method: "OPTIONS",
      signal: AbortSignal.timeout(2000),
      cache: "no-store",
    });
    return res.status !== 404 && res.status < 500;
  } catch {
    return false;
  }
}

let commitCache: string | null | undefined;
async function commit(): Promise<string | null> {
  if (commitCache !== undefined) return commitCache;
  try {
    const { stdout } = await run("git", ["rev-parse", "--short", "HEAD"], { cwd: repoRoot(), timeout: 2000 });
    commitCache = stdout.trim() || null;
  } catch {
    commitCache = null;
  }
  return commitCache;
}

export async function settingsInfo(): Promise<SettingsInfo> {
  const [h, voice, c] = await Promise.all([health(), voiceRoute(), commit()]);
  return { agent: h.ok && h.ready, voice: h.ok && voice, secondOpinions: h.ok && h.jev, commit: c };
}
