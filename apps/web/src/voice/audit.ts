// The post-call audit's result in one line for the call box (apps/api/src/voice/audit.ts does the check).
// A missing or failed audit is shown as "could not be checked", never as a pass.

export interface AuditResult {
  checked: number;
  flagged: { line: string; reasons: string[] }[];
  unchecked: boolean;
}

const UNCHECKED = { tone: "warn" as const, text: "After the call: the lines could not be checked. Read the transcript." };

export function auditLine(r: AuditResult | null): { tone: "ok" | "bad" | "warn"; text: string } | null {
  if (!r || r.unchecked) return UNCHECKED;
  if (!r.checked) return null;
  if (!r.flagged.length) return { tone: "ok", text: `After the call: the safety check flagged none of the ${r.checked} lines the agent said.` };
  const list = r.flagged.map((f) => `“${f.line}”${f.reasons.length ? ` (${f.reasons.join("; ")})` : ""}`).join("; ");
  return { tone: "bad", text: `After the call: ${r.flagged.length} of ${r.checked} lines flagged: ${list}` };
}
