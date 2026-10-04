import { addDays, daysInMonth, monthKeyOf, nextMonthKey, pad2, type DateRange } from './dates';
import type { Paise } from './money';
import { averageRate } from './money';
import { CATEGORY_META } from './payments';
import { PARTY_TYPES, PAYMENT_CATEGORIES, type Order, type PartyType, type Payment, type PaymentCategory } from './types';

/**
 * Rollups are small statistics documents (one per day "D-YYYY-MM-DD" and one
 * per month "M-YYYY-MM") that are updated with atomic increments in the same
 * Firestore transaction that creates / edits / cancels an order or records /
 * voids a payment. Dashboards read a handful of rollup docs instead of every
 * order. They are DERIVED data: Settings → Data → "Rebuild statistics"
 * recomputes them from orders and payments at any time.
 */

export interface RollupTotals {
  orders: number;
  qtyKg: number;
  buyerBase: Paise;
  gst: Paise;
  buyerGross: Paise;
  seller: Paise;
  commission: Paise;
  freight: Paise;
  /** Payment-agent commission (payable). */
  paCharge: Paise;
  paid: Record<PaymentCategory, Paise>;
}

/**
 * Per-party figures. `amount` is the party's obligation:
 * buyer gross (receivable), seller total, commission, freight or
 * payment-agent commission (payables).
 */
export interface PartyBucket {
  n: number;
  qtyKg: number;
  amount: Paise;
  paid: Paise;
  /** Buyer: base value excl. GST. */
  base: Paise;
  /** Buyer: GST. */
  gst: Paise;
}

export type PartyBuckets = Record<PartyType, Record<string, PartyBucket>>;

export interface RollupData {
  totals: RollupTotals;
  parties: PartyBuckets;
  /**
   * Number of source documents written under the obsolete payment-agent model
   * (set by sumRollups). When > 0 the payment-agent figures in this data are
   * WRONG (they hold buyer money) and statistics must be rebuilt.
   */
  legacyDocs?: number;
}

/**
 * Statistics documents are maintained with atomic increments, so documents
 * written by the obsolete payment-agent model keep their old figures (agent
 * bucket `amount` = buyer gross − commission) until rebuilt. They are
 * recognisable by fields only the old model wrote.
 */
export function isLegacyRollupDoc(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as { totals?: Record<string, unknown>; parties?: Record<string, Record<string, Record<string, unknown>> | undefined> };
  if (r.totals && ('paReceived' in r.totals || 'paBalance' in r.totals)) return true;
  const pa = r.parties?.PAYMENT_AGENT;
  if (pa) for (const b of Object.values(pa)) if (b && ('received' in b || 'charge' in b)) return true;
  return false;
}

/**
 * Documents per batch when rebuilding statistics. Firestore evaluates the
 * security rules of every document in a batch against ONE request budget
 * (1,000 expressions), so rebuild batches must stay small.
 */
export const REBUILD_BATCH_SIZE = 10;

export interface RollupDelta extends RollupData {
  date: string;
}

export function emptyTotals(): RollupTotals {
  const paid = {} as Record<PaymentCategory, Paise>;
  for (const c of PAYMENT_CATEGORIES) paid[c] = 0;
  return {
    orders: 0,
    qtyKg: 0,
    buyerBase: 0,
    gst: 0,
    buyerGross: 0,
    seller: 0,
    commission: 0,
    freight: 0,
    paCharge: 0,
    paid,
  };
}

export function emptyBucket(): PartyBucket {
  return { n: 0, qtyKg: 0, amount: 0, paid: 0, base: 0, gst: 0 };
}

export function emptyParties(): PartyBuckets {
  const p = {} as PartyBuckets;
  for (const t of PARTY_TYPES) p[t] = {};
  return p;
}

export function emptyRollup(): RollupData {
  return { totals: emptyTotals(), parties: emptyParties() };
}

export const dayKey = (iso: string): string => `D-${iso}`;
export const monthKey = (iso: string): string => `M-${monthKeyOf(iso)}`;

type OrderForRollup = Pick<
  Order,
  | 'dispatchDate'
  | 'qtyKg'
  | 'buyer'
  | 'seller'
  | 'commission'
  | 'freight'
  | 'paymentAgent'
  | 'buyerId'
  | 'sellerId'
  | 'commissionAgentId'
  | 'transporterId'
  | 'paymentAgentId'
>;

function bucket(partial: Partial<PartyBucket>): PartyBucket {
  return { ...emptyBucket(), ...partial };
}

/** What a confirmed order adds to statistics. sign = -1 removes it (cancel / edit). */
export function orderContribution(order: OrderForRollup, sign: 1 | -1 = 1): RollupDelta {
  const s = sign;
  const totals = emptyTotals();
  totals.orders = s;
  totals.qtyKg = s * order.qtyKg;
  totals.buyerBase = s * order.buyer.baseAmount;
  totals.gst = s * order.buyer.gstAmount;
  totals.buyerGross = s * order.buyer.grossAmount;
  totals.seller = s * order.seller.amount;
  totals.commission = s * order.commission.amount;
  totals.freight = s * order.freight.amount;
  totals.paCharge = s * order.paymentAgent.amount;

  const parties = emptyParties();
  const q = s * order.qtyKg;
  parties.BUYER[order.buyerId] = bucket({
    n: s,
    qtyKg: q,
    amount: s * order.buyer.grossAmount,
    base: s * order.buyer.baseAmount,
    gst: s * order.buyer.gstAmount,
  });
  parties.SELLER[order.sellerId] = bucket({ n: s, qtyKg: q, amount: s * order.seller.amount });
  if (order.commissionAgentId) {
    parties.COMMISSION_AGENT[order.commissionAgentId] = bucket({ n: s, qtyKg: q, amount: s * order.commission.amount });
  }
  if (order.transporterId) {
    parties.TRANSPORTER[order.transporterId] = bucket({ n: s, qtyKg: q, amount: s * order.freight.amount });
  }
  if (order.paymentAgentId) {
    parties.PAYMENT_AGENT[order.paymentAgentId] = bucket({
      n: s,
      qtyKg: q,
      amount: s * order.paymentAgent.amount,
    });
  }
  return { date: order.dispatchDate, totals, parties };
}

/** What an active payment adds to statistics. sign = -1 removes it (void). */
export function paymentContribution(
  payment: Pick<Payment, 'date' | 'amount' | 'category' | 'partyId' | 'partyType'>,
  sign: 1 | -1 = 1,
): RollupDelta {
  const totals = emptyTotals();
  totals.paid[payment.category] = sign * payment.amount;
  const parties = emptyParties();
  // "Other" payments never settle a party's order obligations.
  if (payment.partyId && payment.partyType && CATEGORY_META[payment.category].partyType) {
    parties[payment.partyType][payment.partyId] = bucket({ paid: sign * payment.amount });
  }
  return { date: payment.date, totals, parties };
}

/** Adds `b` into `a` (mutates and returns `a`). */
export function mergeInto(a: RollupData, b: RollupData): RollupData {
  const at = a.totals;
  const bt = b.totals;
  at.orders += bt.orders;
  at.qtyKg += bt.qtyKg;
  at.buyerBase += bt.buyerBase;
  at.gst += bt.gst;
  at.buyerGross += bt.buyerGross;
  at.seller += bt.seller;
  at.commission += bt.commission;
  at.freight += bt.freight;
  at.paCharge += bt.paCharge;
  for (const c of PAYMENT_CATEGORIES) at.paid[c] += bt.paid[c] ?? 0;
  for (const t of PARTY_TYPES) {
    const src = b.parties[t] ?? {};
    const dst = a.parties[t];
    for (const [id, bb] of Object.entries(src)) {
      const cur = dst[id] ?? emptyBucket();
      dst[id] = {
        n: cur.n + (bb.n ?? 0),
        qtyKg: cur.qtyKg + (bb.qtyKg ?? 0),
        amount: cur.amount + (bb.amount ?? 0),
        paid: cur.paid + (bb.paid ?? 0),
        base: cur.base + (bb.base ?? 0),
        gst: cur.gst + (bb.gst ?? 0),
      };
    }
  }
  return a;
}

/** Normalises a possibly-partial Firestore rollup document into full RollupData. */
export function normalizeRollup(raw: unknown): RollupData {
  const out = emptyRollup();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as { totals?: Partial<RollupTotals>; parties?: Partial<Record<PartyType, Record<string, Partial<PartyBucket>>>> };
  const partial: RollupData = { totals: { ...emptyTotals(), ...(r.totals ?? {}) }, parties: emptyParties() };
  partial.totals.paid = { ...emptyTotals().paid, ...(r.totals?.paid ?? {}) };
  for (const t of PARTY_TYPES) {
    for (const [id, b] of Object.entries(r.parties?.[t] ?? {})) {
      partial.parties[t][id] = { ...emptyBucket(), ...b };
    }
  }
  return mergeInto(out, partial);
}

export function sumRollups(docs: readonly unknown[]): RollupData {
  const acc = emptyRollup();
  let legacy = 0;
  for (const d of docs) {
    if (isLegacyRollupDoc(d)) legacy++;
    mergeInto(acc, normalizeRollup(d));
  }
  acc.legacyDocs = legacy;
  return acc;
}

/**
 * Chooses the fewest rollup docs covering an inclusive date range: whole
 * months use the monthly doc, partial months at the edges use daily docs.
 */
export function planRollupKeys(range: { from: string; to: string }): string[] {
  const { from, to } = range;
  if (from > to) return [];
  const keys: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    const mKey = monthKeyOf(cursor);
    const y = Number(mKey.slice(0, 4));
    const m = Number(mKey.slice(5, 7));
    const monthStart = `${mKey}-01`;
    const monthEnd = `${mKey}-${pad2(daysInMonth(y, m))}`;
    if (cursor === monthStart && monthEnd <= to) {
      keys.push(`M-${mKey}`);
      cursor = `${nextMonthKey(mKey)}-01`;
    } else {
      const stop = monthEnd < to ? monthEnd : to;
      let d = cursor;
      while (d <= stop) {
        keys.push(`D-${d}`);
        d = addDays(d, 1);
      }
      cursor = addDays(stop, 1);
    }
  }
  return keys;
}

export function isBoundedRange(range: DateRange): range is { from: string; to: string } {
  return Boolean(range.from && range.to);
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

export interface PartySummary {
  orders: number;
  qtyKg: number;
  amount: Paise;
  paid: Paise;
  outstanding: Paise;
  base: Paise;
  gst: Paise;
  /** Average per-MT rate (buyer: excl. GST). */
  averageRate: Paise | null;
}

export function partySummary(data: RollupData, type: PartyType, id: string): PartySummary {
  const b = data.parties[type][id] ?? emptyBucket();
  const rateBasis = type === 'BUYER' ? b.base : b.amount;
  return {
    orders: b.n,
    qtyKg: b.qtyKg,
    amount: b.amount,
    paid: b.paid,
    outstanding: b.amount - b.paid,
    base: b.base,
    gst: b.gst,
    averageRate: averageRate(rateBasis, b.qtyKg),
  };
}

export interface BreakdownRow {
  id: string;
  n: number;
  qtyKg: number;
  amount: Paise;
  paid: Paise;
  outstanding: Paise;
}

export function breakdown(data: RollupData, type: PartyType): BreakdownRow[] {
  return Object.entries(data.parties[type])
    .filter(([, b]) => b.n !== 0 || b.amount !== 0 || b.paid !== 0)
    .map(([id, b]) => ({
      id,
      n: b.n,
      qtyKg: b.qtyKg,
      amount: b.amount,
      paid: b.paid,
      outstanding: b.amount - b.paid,
    }))
    .sort((x, y) => y.amount - x.amount);
}

export interface OutstandingSummary {
  receivables: Paise;
  payables: Paise;
  buyer: Paise;
  seller: Paise;
  commission: Paise;
  freight: Paise;
  paymentAgent: Paise;
}

/** Outstanding positions from all-time totals (obligations − payments). */
export function outstandingSummary(totals: RollupTotals): OutstandingSummary {
  const buyer = totals.buyerGross - totals.paid.BUYER_RECEIPT;
  const seller = totals.seller - totals.paid.SELLER_PAYMENT;
  const commission = totals.commission - totals.paid.COMMISSION_PAYMENT;
  const freight = totals.freight - totals.paid.TRANSPORTER_PAYMENT;
  const paymentAgent = totals.paCharge - totals.paid.PAYMENT_AGENT_SETTLEMENT;
  return { receivables: buyer, payables: seller + commission + freight + paymentAgent, buyer, seller, commission, freight, paymentAgent };
}

export function totalPaidIn(totals: RollupTotals): Paise {
  return PAYMENT_CATEGORIES.filter((c) => CATEGORY_META[c].direction === 'IN').reduce((s, c) => s + totals.paid[c], 0);
}

/** Flattens a delta into dotted field paths → numbers (non-zero only), for Firestore increments. */
export function flattenDelta(delta: RollupData): Record<string, number> {
  const out: Record<string, number> = {};
  const t = delta.totals;
  const scalar: (keyof Omit<RollupTotals, 'paid'>)[] = [
    'orders',
    'qtyKg',
    'buyerBase',
    'gst',
    'buyerGross',
    'seller',
    'commission',
    'freight',
    'paCharge',
  ];
  for (const k of scalar) if (t[k]) out[`totals.${k}`] = t[k];
  for (const c of PAYMENT_CATEGORIES) if (t.paid[c]) out[`totals.paid.${c}`] = t.paid[c];
  for (const type of PARTY_TYPES) {
    for (const [id, b] of Object.entries(delta.parties[type])) {
      for (const [field, value] of Object.entries(b) as [keyof PartyBucket, number][]) {
        if (value) out[`parties.${type}.${id}.${field}`] = value;
      }
    }
  }
  return out;
}

/** Combines several deltas that hit the same rollup key (e.g. edit = remove old + add new). */
export function combineDeltas(deltas: readonly RollupDelta[]): Map<string, RollupData> {
  const byKey = new Map<string, RollupData>();
  for (const d of deltas) {
    for (const key of [dayKey(d.date), monthKey(d.date)]) {
      const acc = byKey.get(key) ?? emptyRollup();
      mergeInto(acc, d);
      byKey.set(key, acc);
    }
  }
  return byKey;
}

/** Differences between stored and recomputed statistics (dotted path → [stored, computed]). */
export function diffRollups(stored: RollupData, computed: RollupData): Record<string, [number, number]> {
  const a = flattenDelta(stored);
  const b = flattenDelta(computed);
  const out: Record<string, [number, number]> = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if ((a[k] ?? 0) !== (b[k] ?? 0)) out[k] = [a[k] ?? 0, b[k] ?? 0];
  }
  return out;
}
