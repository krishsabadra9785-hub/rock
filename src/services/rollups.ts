import { collection, doc, getDoc, getDocs, query, where, writeBatch, limit, orderBy, startAfter, serverTimestamp, type QueryDocumentSnapshot, type Query, type QuerySnapshot, type DocumentData } from 'firebase/firestore';
import { db } from '../firebase/app';
import type { DateRange } from '../domain/dates';
import {
  combineDeltas,
  emptyRollup,
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

/**
 * Recomputes every statistics document from the source-of-truth orders and
 * payments. Use after an import, or if figures ever look inconsistent.
 * Reads every order and payment once (cost ≈ number of documents).
 */
export async function rebuildRollups(onProgress?: (msg: string) => void): Promise<{ orders: number; payments: number; docs: number }> {
  const uid = requireUid();
  const deltas: RollupDelta[] = [];
  let orderCount = 0;
  let paymentCount = 0;

  let cursor: QueryDocumentSnapshot | null = null;
  do {
    const q: Query<DocumentData> = cursor
      ? query(collection(db, COL.orders), where('status', '==', 'CONFIRMED'), orderBy('dispatchDate'), orderBy('seq'), startAfter(cursor), limit(500))
      : query(collection(db, COL.orders), where('status', '==', 'CONFIRMED'), orderBy('dispatchDate'), orderBy('seq'), limit(500));
    const snap: QuerySnapshot<DocumentData> = await getDocs(q);
    for (const d of snap.docs) deltas.push(orderContribution(toOrder(d.id, d.data())));
    orderCount += snap.size;
    onProgress?.(`Read ${orderCount} orders…`);
    cursor = snap.size === 500 ? snap.docs[snap.docs.length - 1]! : null;
  } while (cursor);

  cursor = null;
  do {
    const q: Query<DocumentData> = cursor
      ? query(collection(db, COL.payments), orderBy('date'), startAfter(cursor), limit(500))
      : query(collection(db, COL.payments), orderBy('date'), limit(500));
    const snap: QuerySnapshot<DocumentData> = await getDocs(q);
    for (const d of snap.docs) {
      const p = toPayment(d.id, d.data());
      if (p.status === 'ACTIVE') deltas.push(paymentContribution(p));
    }
    paymentCount += snap.size;
    onProgress?.(`Read ${paymentCount} payments…`);
    cursor = snap.size === 500 ? snap.docs[snap.docs.length - 1]! : null;
  } while (cursor);

  const computed = combineDeltas(deltas);
  const existing = await getDocs(collection(db, COL.rollups));
  const ops: { key: string; data: RollupData | null }[] = [];
  for (const d of existing.docs) if (!computed.has(d.id)) ops.push({ key: d.id, data: null });
  for (const [key, data] of computed) ops.push({ key, data });

  for (let i = 0; i < ops.length; i += 400) {
    const batch = writeBatch(db);
    for (const op of ops.slice(i, i + 400)) {
      const ref = doc(db, COL.rollups, op.key);
      if (op.data === null) batch.delete(ref);
      else batch.set(ref, { kind: op.key.startsWith('M-') ? 'M' : 'D', key: op.key.slice(2), ...op.data, updatedAt: serverTimestamp() });
    }
    if (i + 400 >= ops.length) {
      writeAudit(batch, uid, { entityType: 'system', entityId: 'rollups', action: 'REBUILD', summary: `Rebuilt statistics from ${orderCount} orders and ${paymentCount} payments` });
    }
    await batch.commit();
    onProgress?.(`Saved ${Math.min(i + 400, ops.length)} of ${ops.length} statistics documents…`);
  }
  invalidateRollupCache();
  return { orders: orderCount, payments: paymentCount, docs: computed.size };
}
