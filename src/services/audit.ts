import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { db } from '../firebase/app';
import { COL, str, strOrNull, toDate } from './firestore';

export interface AuditLog {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  summary: string;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  reason: string | null;
  actorId: string;
  at: Date | null;
}

export async function listAuditLogs(entityId: string, max = 50): Promise<AuditLog[]> {
  const snap = await getDocs(query(collection(db, COL.auditLogs), where('entityId', '==', entityId), orderBy('at', 'desc'), limit(max)));
  return snap.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id,
      entityType: str(x.entityType),
      entityId: str(x.entityId),
      action: str(x.action),
      summary: str(x.summary),
      changes: (x.changes as AuditLog['changes']) ?? null,
      reason: strOrNull(x.reason),
      actorId: str(x.actorId),
      at: toDate(x.at),
    };
  });
}
