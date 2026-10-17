// Splits a pasted email or message thread into separate messages. Pure, no I/O.
// Understands header blocks ("From:", "To:", "Subject:", "Date:", "Sent:", "Channel:"),
// "-----Original Message-----" / "Forwarded message" separators, and quoted replies
// ("On <date>, <name> wrote:" followed by "> " lines, nested to any depth).

export interface IntakeMessage {
  channel: string;
  from: string | null;
  to: string | null;
  subject: string | null;
  /** ISO time, or null when the message carries no date we can read. */
  date: string | null;
  body: string;
}

const HEADER = /^\s*(from|to|cc|subject|date|sent|channel)\s*:\s*(.*)$/i;
const WROTE = /^\s*On (.+),\s*([^,]+?)\s+wrote:\s*$/i;
const SEPARATOR = /^\s*-{2,}\s*(original message|forwarded message|begin forwarded message)\s*-{2,}\s*$/i;
const QUOTED = /^\s*>/;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** A date as written in an email header or reply line, as ISO. Null when it can't be read. */
export function parseDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim().replace(/\s+at\s+/i, " ").replace(/\bUTC\b|\bGMT\b/i, "Z").replace(/\s+Z$/, "Z");
  // "2026-02-25 09:00Z" / "2026-02-25 09:00" -> ISO; a time with no zone is read as UTC.
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(Z|[+-]\d{2}:?\d{2})?$/i);
  if (iso) {
    const zone = iso[5] ? (iso[5].toUpperCase() === "Z" ? "Z" : iso[5].replace(/^([+-]\d{2})(\d{2})$/, "$1:$2")) : "Z";
    s = `${iso[1]}T${iso[2].padStart(2, "0")}:${iso[3]}:${iso[4] ?? "00"}${zone}`;
  }
  // "Tue, 25 Feb 2026 09:00" (no zone) -> UTC.
  const dmy = s.match(/^(?:\w{3},?\s+)?(\d{1,2})\s+(\w{3})\w*\s+(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (dmy && MONTHS.includes(dmy[2].toLowerCase())) {
    const m = String(MONTHS.indexOf(dmy[2].toLowerCase()) + 1).padStart(2, "0");
    s = `${dmy[3]}-${m}-${dmy[1].padStart(2, "0")}T${dmy[4].padStart(2, "0")}:${dmy[5]}:${dmy[6] ?? "00"}Z`;
  }
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

interface Draft {
  headers: Record<string, string>;
  lines: string[];
}

function toMessage(d: Draft, channel: string): IntakeMessage | null {
  const body = d.lines.join("\n").replace(/^\s*\n/, "").trim();
  if (!body) return null;
  return {
    channel: d.headers.channel?.trim() || channel,
    from: d.headers.from?.trim() || null,
    to: d.headers.to?.trim() || null,
    subject: d.headers.subject?.trim() || null,
    date: parseDate(d.headers.date ?? d.headers.sent),
    body,
  };
}

function walk(lines: string[], first: Draft, channel: string, out: IntakeMessage[]): boolean {
  let cur = first;
  let sawReply = false;
  const flush = () => {
    const m = toMessage(cur, channel);
    if (m) out.push(m);
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (SEPARATOR.test(line)) {
      flush();
      sawReply = true;
      cur = { headers: {}, lines: [] };
      continue;
    }
    const wrote = line.match(WROTE);
    if (wrote && i + 1 < lines.length) {
      // Collect the quoted block that follows (blank lines inside it are kept).
      let j = i + 1;
      const inner: string[] = [];
      while (j < lines.length && (QUOTED.test(lines[j]) || (!lines[j].trim() && j + 1 < lines.length && QUOTED.test(lines[j + 1])))) {
        inner.push(lines[j].replace(/^\s*> ?/, ""));
        j++;
      }
      if (inner.length) {
        flush();
        sawReply = true;
        walk(inner, { headers: { from: wrote[2].replace(/\s*<[^>]*>\s*$/, ""), date: wrote[1] }, lines: [] }, channel, out);
        cur = { headers: {}, lines: [] };
        i = j - 1;
        continue;
      }
    }
    if (HEADER.test(line)) {
      // A run of header lines starts a new message only when it names a sender.
      let j = i;
      const headers: Record<string, string> = {};
      while (j < lines.length && HEADER.test(lines[j])) {
        const [, k, v] = lines[j].match(HEADER)!;
        const key = k.toLowerCase();
        if (!(key in headers)) headers[key] = v;
        j++;
      }
      if ("from" in headers) {
        flush();
        cur = { headers, lines: [] };
        i = j - 1;
        continue;
      }
    }
    cur.lines.push(line);
  }
  flush();
  return sawReply;
}

/**
 * Pasted text as messages, oldest first. When every message has a date they are sorted by it;
 * otherwise a reply thread (newest on top, older ones quoted below) is reversed, and plain
 * header blocks keep the order they were pasted in. Text with no headers is one message.
 */
export function splitThread(text: string, opts: { channel?: string } = {}): IntakeMessage[] {
  const channel = opts.channel ?? "Email";
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const msgs: IntakeMessage[] = [];
  const reply = walk(lines, { headers: {}, lines: [] }, channel, msgs);
  if (msgs.length > 1 && msgs.every((m) => m.date)) {
    return msgs.map((m, i) => ({ m, i })).sort((a, b) => Date.parse(a.m.date!) - Date.parse(b.m.date!) || a.i - b.i).map((x) => x.m);
  }
  return reply ? msgs.reverse() : msgs;
}
