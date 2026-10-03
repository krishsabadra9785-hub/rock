import {
  collection,
  doc,
  increment,
  serverTimestamp,
  Timestamp,
  type DocumentData,
  type Transaction,
  type WriteBatch,
} from 'firebase/firestore';
import { db, auth } from '../firebase/app';
import { combineDeltas, flattenDelta, type RollupDelta } from '../domain/rollups';
import { AppError } from './errors';

export const COL = {
  users: 'users',
  userSecurity: 'userSecurity',
  settings: 'settings',
  parties: 'parties',
  rateHistory: 'rateHistory',
  orders: 'orders',
  payments: 'payments',
  rollups: 'rollups',
  counters: 'counters',
  auditLogs: 'auditLogs',
} as const;

export function requireUid(): string {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new AppError('Your session has expired. Sign in again.', 'unauthenticated');
  return uid;
}

export function newId(col: string): string {
  return doc(collection(db, col)).id;
}

/** Firestore Timestamp | Date | null → Date | null */
export function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Timestamp) return v.toDate();
  if (v instanceof Date) return v;
  if (typeof v === 'object' && v !== null && 'toDate' in v && typeof (v as { toDate: unknown }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate();
  }
  return null;
}

export const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
export const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
export const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

export function createdFields(uid: string): DocumentData {
  return { createdAt: serverTimestamp(), createdBy: uid, updatedAt: serverTimestamp(), updatedBy: uid };
}

export function updatedFields(uid: string): DocumentData {
  return { updatedAt: serverTimestamp(), updatedBy: uid };
}

/** Converts {"a.b.c": 1} into {a:{b:{c: increment(1)}}} for set(..., {merge:true}). */
export function toIncrementTree(flat: Record<string, number>): DocumentData {
  const root: DocumentData = {};
  for (const [path, value] of Object.entries(flat)) {
    const parts = path.split('.');
    let node: DocumentData = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i]!;
      node[key] = (node[key] as DocumentData | undefined) ?? {};
      node = node[key] as DocumentData;
    }
    node[parts[parts.length - 1]!] = increment(value);
  }
  return root;
}

/** Applies rollup deltas (day + month docs) with atomic increments inside a transaction or batch. */
export function writeRollupDeltas(tx: Transaction | WriteBatch, deltas: RollupDelta[]): void {
  for (const [key, data] of combineDeltas(deltas)) {
    const flat = flattenDelta(data);
    if (Object.keys(flat).length === 0) continue;
    const ref = doc(db, COL.rollups, key);
    const kind = key.startsWith('M-') ? 'M' : 'D';
    (tx as Transaction).set(
      ref,
      { kind, key: key.slice(2), ...toIncrementTree(flat), updatedAt: serverTimestamp() },
      { merge: true },
    );
  }
}

export interface AuditEntry {
  entityType: 'order' | 'payment' | 'party' | 'settings' | 'user' | 'system';
  entityId: string;
  action: string;
  summary: string;
  changes?: Record<string, { from: unknown; to: unknown }>;
  reason?: string;
}

export function writeAudit(tx: Transaction | WriteBatch, uid: string, entry: AuditEntry): void {
  const ref = doc(collection(db, COL.auditLogs));
  (tx as Transaction).set(ref, {
    ...entry,
    changes: entry.changes ?? null,
    reason: entry.reason ?? null,
    actorId: uid,
    at: serverTimestamp(),
  });
}

/** Random UUID used for idempotency keys and storage object names. */
export function uuid(): string {
  const c: Crypto = globalThis.crypto;
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
