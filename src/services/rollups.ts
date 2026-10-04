import { collection, doc, getDoc, getDocs, query, where, writeBatch, limit, orderBy, startAfter, serverTimestamp, type Query, type QueryDocumentSnapshot, type QuerySnapshot } from 'firebase/firestore';
import { db } from '../firebase/app';
import type { DateRange } from '../domain/dates';
import { reconcileOrderPaid, type PaidMismatch } from '../domain/payments';
import type { Order, Payment } from '../domain/types';
import {
  combineDeltas,
  diffRollups,
  emptyRollup,
  isLegacyRollupDoc,
  REBUILD_BATCH_SIZE,
  normalizeRollup,
  isBoundedRange,
  orderContribution,
  paymentContribution,
  planRollupKeys,
  sumRollups,
  type RollupData,
  type RollupDelta,
} from '../domain/rollups';
import { COL, requireUid, writeAudit } from './firestore';
import { toOrder } from './orders';
import { toPayment } from './payments';

/** Small in-memory cache so switching tabs doesn't re-read the same docs. */
const cache = new Map<string, { at: number; data: unknown }>();
const TTL_MS = 20_000;

export function invalidateRollupCache(): void {
  cache.clear();
}

async function readKey(key: string): Promise<unknown> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  const snap = await getDoc(doc(db, COL.rollups, key));
  const data = snap.exists() ? snap.data() : null;
  cache.set(key, { at: Date.now(), data });
  return data;
}

/**
 * Statistics for a date range. Bounded ranges read the minimum set of
 * day/month docs (e.g. a financial year = 12 reads). Unbounded ("all time")
 * reads every monthly doc.
 */
export async function loadRollup(range: DateRange): Promise<RollupData> {
  if (isBoundedRange(range)) {
    const keys = planRollupKeys(range);
    const docs = await Promise.all(keys.map(readKey));
    return sumRollups(docs);
  }
  const cacheKey = `ALL:${range.from ?? ''}:${range.to ?? ''}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data as RollupData;
  const snap = await getDocs(query(collection(db, COL.rollups), where('kind', '==', 'M')));
  const docs = snap.docs
    .filter((d) => {
      const month = String(d.data().key ?? '');
      if (range.from && month < range.from.slice(0, 7)) return false;
      if (range.to && month > range.to.slice(0, 7)) return false;
      return true;
    })
    .map((d) => d.data());
  const data = docs.length ? sumRollups(docs) : emptyRollup();
  cache.set(cacheKey, { at: Date.now(), data });
  return data;
}

interface SourceData {
  orders: Order[];
  payments: Payment[];
}

/** Reads every CONFIRMED order and every payment (the authoritative records). */
async function loadSourceRecords(onProgress?: (msg: string) => void): Promise<SourceData> {
  const orders: Order[] = [];
  const payments: Payment[] = [];
  let cursor: QueryDocumentSnapshot | null = null;
  do {
    const q: Query = cursor
      ? query(collection(db, COL.orders), where('status', '==', 'CONFIRMED'), orderBy('dispatchDate'), orderBy('seq'), startAfter(cursor), limit(500))
      : query(collection(db, COL.orders), where('status', '==', 'CONFIRMED'), orderBy('dispatchDate'), orderBy('seq'), limit(500));
    const snap: QuerySnapshot = await getDocs(q);
    for (const d of snap.docs) orders.push(toOrder(d.id, d.data()));
    onProgress?.(`Read ${orders.length} orders…`);
    cursor = snap.size === 500 ? snap.docs[snap.docs.length - 1]! : null;
  } while (cursor);
  cursor = null;
  do {
    const q: Query = cursor
      ? query(collection(db, COL.payments), orderBy('date'), startAfter(cursor), limit(500))
      : query(collection(db, COL.payments), orderBy('date'), limit(500));
    const snap: QuerySnapshot = await getDocs(q);
    for (const d of snap.docs) payments.push(toPayment(d.id, d.data()));
    onProgress?.(`Read ${payments.length} payments…`);
    cursor = snap.size === 500 ? snap.docs[snap.docs.length - 1]! : null;
  } while (cursor);
  return { orders, payments };
}

/** Statistics computed purely from source records: obligations − ACTIVE payments. */
export function computeRollupsFromSource(src: SourceData): Map<string, RollupData> {
  const deltas: RollupDelta[] = [];
  for (const o of src.orders) if (o.status === 'CONFIRMED') deltas.push(orderContribution(o));
  for (const p of src.payments) if (p.status === 'ACTIVE') deltas.push(paymentContribution(p));
  return combineDeltas(deltas);
}

export interface IntegrityReport {
  orders: number;
  payments: number;
  /** Order paid totals that differ from the sum of their ACTIVE payments. */
  paidMismatches: PaidMismatch[];
  /** Statistics documents that differ from a recomputation. */
  rollupMismatches: { key: string; fields: number }[];
  /** Statistics documents still written in the obsolete payment-agent format. */
  legacyDocs: number;
}

/** Read-only check: recomputes everything from orders + payments and reports differences. */
export async function checkIntegrity(onProgress?: (msg: string) => void): Promise<IntegrityReport> {
  const src = await loadSourceRecords(onProgress);
  const computed = computeRollupsFromSource(src);
  const stored = await getDocs(collection(db, COL.rollups));
  const storedMap = new Map<string, RollupData>(stored.docs.map((d): [string, RollupData] => [d.id, normalizeRollup(d.data())]));
  const legacyDocs = stored.docs.filter((d) => isLegacyRollupDoc(d.data())).length;
  const rollupMismatches: IntegrityReport['rollupMismatches'] = [];
  for (const key of new Set<string>([...computed.keys(), ...storedMap.keys()])) {
    const diff = diffRollups(storedMap.get(key) ?? emptyRollup(), computed.get(key) ?? emptyRollup());
    const n = Object.keys(diff).length;
    if (n > 0) rollupMismatches.push({ key, fields: n });
  }
  return {
    orders: src.orders.length,
    payments: src.payments.length,
    paidMismatches: reconcileOrderPaid(src.orders, src.payments),
    rollupMismatches,
    legacyDocs,
  };
}

/**
 * Recomputes every statistics document from the source-of-truth orders and
 * payments. Use if "Check figures" reports differences.
 * Reads every order and payment once (cost ≈ number of documents).
 */
export async function rebuildRollups(onProgress?: (msg: string) => void): Promise<{ orders: number; payments: number; docs: number }> {
  const uid = requireUid();
  const src = await loadSourceRecords(onProgress);
  const computed = computeRollupsFromSource(src);
  const existing = await getDocs(collection(db, COL.rollups));
  const ops: { key: string; data: RollupData | null }[] = [];
  for (const d of existing.docs) if (!computed.has(d.id)) ops.push({ key: d.id, data: null });
  for (const [key, data] of computed) ops.push({ key, data });

  // Small batches: every document's security rules share one request budget.
  for (let i = 0; i < ops.length; i += REBUILD_BATCH_SIZE) {
    const batch = writeBatch(db);
    for (const op of ops.slice(i, i + REBUILD_BATCH_SIZE)) {
      const ref = doc(db, COL.rollups, op.key);
      if (op.data === null) batch.delete(ref);
      // Full replacement (no merge): removes every obsolete payment-agent field.
      else batch.set(ref, { kind: op.key.startsWith('M-') ? 'M' : 'D', key: op.key.slice(2), totals: op.data.totals, parties: op.data.parties, updatedAt: serverTimestamp() });
    }
    if (i + REBUILD_BATCH_SIZE >= ops.length) {
      writeAudit(batch, uid, { entityType: 'system', entityId: 'rollups', action: 'REBUILD', summary: `Rebuilt statistics from ${src.orders.length} orders and ${src.payments.length} payments` });
    }
    await batch.commit();
    onProgress?.(`Saved ${Math.min(i + REBUILD_BATCH_SIZE, ops.length)} of ${ops.length} statistics documents…`);
  }
  invalidateRollupCache();
  return { orders: src.orders.length, payments: src.payments.length, docs: computed.size };
}
