// Builds the case view the agent sees, exactly as scripts/eval/cases.mjs does, so a console
// "Execute" is the same input the eval scores. Pure: callers pass parsed files in.

export interface ViewEvent {
  n: number;
  timestamp: string;
  stage: string | null;
  channel: string | null;
  from: string | null;
  to: string | null;
  body: string;
}

export interface CaseView {
  id: string;
  track?: string;
  title: string | null;
  context: string | null;
  initial_request: string | null;
  events: ViewEvent[];
  attachments: { name: string; text: string | null }[];
}

interface RawPublic {
  id: string;
  track?: string;
  title?: string;
  context?: string;
  initial_request?: string;
  escalation_snapshot?: { last_event?: number } | null;
  events: ViewEvent[];
  attachments?: { name: string; text?: string | null }[];
}

/**
 * Public delivery case (data/cases/delivery/*.json). Mirrors publicCase() in cases.mjs: only events
 * up to the escalation snapshot, only attachments named in them, and title/context stripped
 * (they often state the answer) unless withContext.
 */
export function publicView(c: RawPublic, withContext = false): CaseView {
  const last = c.escalation_snapshot?.last_event;
  const events = last ? c.events.filter((e) => e.n <= last) : c.events;
  const seen = events.map((e) => e.body).join("\n");
  return {
    id: c.id,
    track: c.track,
    title: withContext ? (c.title ?? null) : null,
    context: withContext ? (c.context ?? null) : null,
    initial_request: c.initial_request ?? null,
    events,
    attachments: (c.attachments ?? []).filter((a) => seen.includes(a.name)) as CaseView["attachments"],
  };
}

interface RawGenerated {
  id: string;
  track?: string;
  title?: string;
  context?: string;
  initial_request?: string;
  events: ViewEvent[];
  attachments?: { name: string; text?: string | null; missing?: boolean; corrupt?: boolean }[];
}

/**
 * Generated, grounded or adversarial case (data/generated/delivery, data/adversarial/delivery).
 * Mirrors generatedCase() in cases.mjs: a missing attachment is left out, a corrupt one has no text.
 */
export function generatedView(c: RawGenerated): CaseView {
  return {
    id: c.id,
    track: c.track,
    title: c.title ?? null,
    context: c.context ?? null,
    initial_request: c.initial_request ?? null,
    events: c.events,
    attachments: (c.attachments ?? []).filter((a) => !a.missing).map((a) => ({ name: a.name, text: a.corrupt ? null : (a.text as string | null) })),
  };
}

function section(md: string, heading: string): string | null {
  const re = new RegExp(`^## ${heading}\\s*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m");
  const text = md.match(re)?.[1]?.trim();
  return text ? text : null;
}

/** Title line of a fixture index.md ("# Case 101: ..."). */
export function fixtureTitle(indexMd: string): string | null {
  return indexMd.match(/^# (.+)$/m)?.[1]?.trim() ?? null;
}

/** Events of a fixture history.md (docs/stress-test/fixtures/NNN/history.md). */
export function parseFixtureHistory(historyMd: string): ViewEvent[] {
  const out: ViewEvent[] = [];
  const blocks = historyMd.split(/^## (?=\d{4}-\d{2}-\d{2} )/m).slice(1);
  for (const block of blocks) {
    const head = block.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC\s*[—-]\s*event (\d+)/);
    if (!head) continue;
    const field = (name: string) => block.match(new RegExp(`^- \\*\\*${name}:\\*\\* (.*)$`, "m"))?.[1]?.trim() ?? null;
    const lines = block.split("\n").slice(1);
    const lastField = lines.findLastIndex((l) => /^- \*\*\w+:\*\*/.test(l));
    const body = lines.slice(lastField + 1).join("\n").replace(/<a id="[^"]*"><\/a>\s*$/, "").trim();
    out.push({
      n: Number(head[3]),
      timestamp: `${head[1]}T${head[2]}Z`,
      stage: field("Stage"),
      channel: field("Channel"),
      from: field("From"),
      to: field("To"),
      body,
    });
  }
  return out;
}

/**
 * A stress-test fixture as a view. Fixtures are written like generated cases (background context,
 * no answer in the title), so title and context are kept. Events stop at the escalation snapshot
 * stated in the Overview ("events 001–006").
 */
export function fixtureView(
  id: string,
  indexMd: string,
  historyMd: string,
  attachments: { name: string; text: string | null }[] = [],
): CaseView {
  const overview = section(indexMd, "Overview");
  const last = overview?.match(/events\s+\d+\s*[–-]\s*(\d+)/)?.[1];
  const all = parseFixtureHistory(historyMd);
  return {
    id,
    track: "delivery",
    title: fixtureTitle(indexMd),
    context: section(indexMd, "Context"),
    initial_request: section(indexMd, "Initial request"),
    events: last ? all.filter((e) => e.n <= Number(last)) : all,
    attachments,
  };
}

/** Attachment file names linked from a fixture's "## Attachments" section. */
export function fixtureAttachmentPaths(indexMd: string): string[] {
  const s = section(indexMd, "Attachments");
  if (!s) return [];
  return [...s.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]);
}
