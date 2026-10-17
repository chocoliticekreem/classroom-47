// Fuzzy matching for the ⌘K palette. Pure, no deps.
//
//   fuzzyMatch("rn 24", "Run case delivery-024") -> { score, ranges } | null
//
// Every space-separated word of the query must appear in the text as an in-order subsequence
// (case-insensitive). Matches that start words, run on consecutively or sit near the start
// score higher, so "nc" finds "New case" before "Open the city".

export interface FuzzyMatch {
  score: number;
  /** Matched character spans in `text`, [start, end) and merged, for highlighting. */
  ranges: [number, number][];
}

const isBoundary = (text: string, i: number) => i === 0 || /[\s\-_/:.(]/.test(text[i - 1]);

/** Best greedy match of one word. Tries every start position of its first letter, keeps the best. */
function matchWord(word: string, text: string, lower: string): { score: number; idx: number[] } | null {
  let best: { score: number; idx: number[] } | null = null;
  for (let start = lower.indexOf(word[0]); start !== -1; start = lower.indexOf(word[0], start + 1)) {
    const idx = [start];
    let ti = start + 1;
    for (let wi = 1; wi < word.length; wi++) {
      // Prefer the next word start for this letter, then any occurrence.
      let next = -1;
      for (let j = ti; j < lower.length; j++) {
        if (lower[j] !== word[wi]) continue;
        if (j === ti || isBoundary(text, j)) { next = j; break; }
        if (next === -1) next = j;
      }
      if (next === -1) { idx.length = 0; break; }
      idx.push(next);
      ti = next + 1;
    }
    if (!idx.length) continue;
    let score = 0;
    for (let k = 0; k < idx.length; k++) {
      score += 1;
      if (isBoundary(text, idx[k])) score += 3;
      if (k > 0 && idx[k] === idx[k - 1] + 1) score += 2;
      else if (k > 0) score -= Math.min(3, (idx[k] - idx[k - 1] - 1) * 0.25);
    }
    if (idx[0] === 0) score += 2;
    score -= idx[0] * 0.02;
    if (!best || score > best.score) best = { score, idx };
  }
  return best;
}

function toRanges(indices: number[]): [number, number][] {
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && last[1] === i) last[1] = i + 1;
    else out.push([i, i + 1]);
  }
  return out;
}

export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return { score: 0, ranges: [] };
  const lower = text.toLowerCase();
  let score = 0;
  const all: number[] = [];
  for (const w of words) {
    const m = matchWord(w, text, lower);
    if (!m) return null;
    score += m.score;
    all.push(...m.idx);
  }
  // A literal substring hit of the whole query is the strongest signal.
  if (lower.includes(query.trim().toLowerCase())) score += 4;
  return { score, ranges: toRanges(all) };
}

export interface Searchable {
  title: string;
  keywords?: readonly string[];
}

/**
 * Rank items by query. Matches against the title, then keywords (keyword hits score a bit
 * lower and don't highlight). Empty query keeps the input order. Stable for ties.
 */
export function fuzzyRank<T extends Searchable>(query: string, items: readonly T[], limit = Infinity): { item: T; match: FuzzyMatch }[] {
  const q = query.trim();
  if (!q) return items.slice(0, limit).map((item) => ({ item, match: { score: 0, ranges: [] } }));
  const hits: { item: T; match: FuzzyMatch; order: number }[] = [];
  items.forEach((item, order) => {
    let match = fuzzyMatch(q, item.title);
    for (const k of item.keywords ?? []) {
      const km = fuzzyMatch(q, k);
      if (km && (!match || km.score * 0.8 > match.score)) match = { score: km.score * 0.8, ranges: [] };
    }
    if (match) hits.push({ item, match, order });
  });
  hits.sort((a, b) => b.match.score - a.match.score || a.order - b.order);
  return hits.slice(0, limit).map(({ item, match }) => ({ item, match }));
}
