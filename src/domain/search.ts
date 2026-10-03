/**
 * Search tokens are stored on each order (bounded array) so Firestore can find
 * orders with a single `array-contains` query. Tokens are lowercase
 * alphanumerics; words also get prefixes (≥3 chars) so "raj" finds "Rajesh".
 */

export const MAX_SEARCH_TOKENS = 120;
const MIN_PREFIX = 3;
const MAX_PREFIX_WORD = 14;

export function normalizeToken(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2);
}

function prefixes(word: string): string[] {
  const out: string[] = [];
  const max = Math.min(word.length, MAX_PREFIX_WORD);
  for (let i = MIN_PREFIX; i <= max; i++) out.push(word.slice(0, i));
  if (word.length > MAX_PREFIX_WORD) out.push(word);
  return out;
}

export interface SearchFields {
  /** Matched as whole tokens only (order number, vehicle, phone, receipt no). */
  exact: (string | null | undefined)[];
  /** Split into words with prefixes (names, destination). */
  text: (string | null | undefined)[];
}

export function buildSearchTokens(fields: SearchFields): string[] {
  const set = new Set<string>();
  for (const raw of fields.exact) {
    if (!raw) continue;
    const t = normalizeToken(raw);
    if (t.length >= 2) set.add(t);
    // Also index the trailing number of order numbers / phones (e.g. "000123" and "123").
    const digits = raw.replace(/\D/g, '');
    if (digits.length >= 4) {
      set.add(digits);
      if (digits.length >= 10) set.add(digits.slice(-10));
    }
    const tail = /(\d+)\D*$/.exec(raw)?.[1];
    if (tail && tail.length >= 3) {
      set.add(tail);
      const trimmed = tail.replace(/^0+/, '');
      if (trimmed && trimmed !== tail) set.add(trimmed);
    }
  }
  for (const raw of fields.text) {
    if (!raw) continue;
    for (const w of words(raw)) for (const p of prefixes(w)) set.add(p);
  }
  return [...set].slice(0, MAX_SEARCH_TOKENS);
}

/** Turns a user query into the single best token for an array-contains query. */
export function queryToToken(q: string): string | null {
  const parts = q.trim().split(/\s+/).map(normalizeToken).filter(Boolean);
  if (parts.length === 0) return null;
  // Prefer the longest part (most selective), but a joined form handles "MH 12 AB 1234".
  const joined = parts.join('');
  if (parts.length > 1 && /\d/.test(joined) && /[a-z]/.test(joined)) return joined;
  return parts.reduce((a, b) => (b.length > a.length ? b : a)).slice(0, MAX_PREFIX_WORD);
}

/** Case-insensitive client-side match used for refining loaded lists. */
export function matchesQuery(haystack: (string | null | undefined)[], q: string): boolean {
  const needle = normalizeToken(q);
  if (!needle) return true;
  return haystack.some((h) => h && normalizeToken(h).includes(needle));
}
