import { APP_NAME } from '../config/brand';
import { collection, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '../firebase/app';
import { COL } from './firestore';

const BACKUP_COLLECTIONS = [COL.settings, COL.parties, COL.rateHistory, COL.orders, COL.payments, COL.counters, COL.users] as const;

function plain(v: unknown): unknown {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, plain(x)]));
  }
  return v;
}

/**
 * Downloads a JSON copy of all business records (administrators only).
 * Receipt images are never stored in V1 (only confirmed text fields).
 * For scheduled, restorable backups see README → "Backups".
 */
export async function exportAllData(onProgress?: (msg: string) => void): Promise<Blob> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const name of BACKUP_COLLECTIONS) {
    onProgress?.(`Exporting ${name}…`);
    const snap = await getDocs(collection(db, name));
    out[name] = Object.fromEntries(snap.docs.map((d) => [d.id, plain(d.data())]));
  }
  const payload = { app: APP_NAME, format: 1, exportedAt: new Date().toISOString(), collections: out };
  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
}
