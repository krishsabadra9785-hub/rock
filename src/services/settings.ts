import { LEGACY_DEFAULT_BUSINESS_NAME } from '../config/brand';
import { doc, onSnapshot, serverTimestamp, writeBatch, type Unsubscribe } from 'firebase/firestore';
import { db } from '../firebase/app';
import { env } from '../config/env';
import { sanitizePrefix } from '../domain/orderNumber';
import { DEFAULT_SETTINGS, type AppSettings } from '../domain/types';
import { AppError } from './errors';
import { COL, num, requireUid, str, strOrNull, writeAudit } from './firestore';

const SETTINGS_DOC = 'app';

export function normalizeSettings(d: Record<string, unknown> | undefined): AppSettings {
  const s = d ?? {};
  const fy = num(s.fyStartMonth, DEFAULT_SETTINGS.fyStartMonth);
  return {
    // Earlier versions stored the old product name as the default business name.
    businessName:
      !str(s.businessName) || str(s.businessName) === LEGACY_DEFAULT_BUSINESS_NAME ? DEFAULT_SETTINGS.businessName : str(s.businessName),
    orderPrefix: sanitizePrefix(str(s.orderPrefix, DEFAULT_SETTINGS.orderPrefix)),
    defaultGstBp: Math.max(0, Math.min(2800, Math.round(num(s.defaultGstBp, DEFAULT_SETTINGS.defaultGstBp)))),
    fyStartMonth: fy >= 1 && fy <= 12 ? Math.round(fy) : 4,
    defaultPaymentAgentId: strOrNull(s.defaultPaymentAgentId),
    autoLockMinutes: Math.max(1, Math.min(120, Math.round(num(s.autoLockMinutes, DEFAULT_SETTINGS.autoLockMinutes)))),
    maxSessionDays: Math.max(1, Math.min(90, Math.round(num(s.maxSessionDays, DEFAULT_SETTINGS.maxSessionDays)))),
    aiEnabled: s.aiEnabled === undefined ? true : s.aiEnabled === true,
    aiModel: str(s.aiModel) || env.aiModel,
  };
}

export function subscribeSettings(onValue: (s: AppSettings) => void, onError: (e: unknown) => void): Unsubscribe {
  return onSnapshot(doc(db, COL.settings, SETTINGS_DOC), (snap) => onValue(normalizeSettings(snap.data())), onError);
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<void> {
  const uid = requireUid();
  if (patch.fyStartMonth !== undefined && (patch.fyStartMonth < 1 || patch.fyStartMonth > 12)) {
    throw new AppError('Financial year must start in month 1–12');
  }
  if (patch.aiModel !== undefined && !/^[a-z0-9.-]{3,60}$/.test(patch.aiModel)) {
    throw new AppError('Model name can contain lowercase letters, numbers, dots and dashes');
  }
  const clean: Record<string, unknown> = { ...patch };
  if (patch.orderPrefix !== undefined) clean.orderPrefix = sanitizePrefix(patch.orderPrefix);
  const batch = writeBatch(db);
  batch.set(doc(db, COL.settings, SETTINGS_DOC), { ...clean, updatedAt: serverTimestamp(), updatedBy: uid }, { merge: true });
  writeAudit(batch, uid, {
    entityType: 'settings',
    entityId: SETTINGS_DOC,
    action: 'UPDATE',
    summary: `Updated settings: ${Object.keys(patch).join(', ')}`,
  });
  await batch.commit();
}
