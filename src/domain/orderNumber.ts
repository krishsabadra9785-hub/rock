/**
 * Order numbers look like ROCK-2026-000001. The sequence restarts each
 * calendar year and is allocated inside a Firestore transaction on
 * counters/orders-YYYY, so two people confirming at the same time can never
 * receive the same number (Firestore retries the losing transaction).
 */

export const SEQ_DIGITS = 6;

export function sanitizePrefix(prefix: string): string {
  const p = prefix.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  return p || 'ROCK';
}

export function formatOrderNumber(prefix: string, year: number, seq: number): string {
  if (!Number.isInteger(seq) || seq < 1) throw new Error('Sequence must be a positive integer');
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error('Invalid year');
  return `${sanitizePrefix(prefix)}-${year}-${String(seq).padStart(SEQ_DIGITS, '0')}`;
}

export function parseOrderNumber(value: string): { prefix: string; year: number; seq: number } | null {
  const m = /^([A-Z0-9]{1,10})-(\d{4})-(\d+)$/.exec(value.trim().toUpperCase());
  if (!m) return null;
  return { prefix: m[1]!, year: Number(m[2]), seq: Number(m[3]) };
}

export function orderCounterId(year: number): string {
  return `orders-${year}`;
}

/** Next sequence given the stored counter (undefined when the year has no orders yet). */
export function nextSequence(current: number | undefined): number {
  if (current === undefined) return 1;
  if (!Number.isInteger(current) || current < 0) throw new Error('Corrupt order counter');
  return current + 1;
}

export const PARTY_CODE_PREFIX = {
  BUYER: 'BUY',
  SELLER: 'SEL',
  COMMISSION_AGENT: 'AGT',
  TRANSPORTER: 'TRN',
  PAYMENT_AGENT: 'PAG',
} as const;

export function formatPartyCode(type: keyof typeof PARTY_CODE_PREFIX, seq: number): string {
  return `${PARTY_CODE_PREFIX[type]}-${String(seq).padStart(4, '0')}`;
}
