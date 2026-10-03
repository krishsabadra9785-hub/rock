import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type DocumentData,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase/app';
import { formatPartyCode } from '../domain/orderNumber';
import { buildRateHistoryEntry, RATE_META, RATE_TYPES_BY_PARTY, defaultRateFor } from '../domain/rates';
import { todayISO } from '../domain/dates';
import { PARTY_TYPES, RATE_TYPES, type Party, type PartyInput, type PartyRates, type PartyType, type RateHistoryEntry, type RateType } from '../domain/types';
import { validateGstin, validateName, validateOptionalText, validatePhone } from '../domain/validation';
import { AppError } from './errors';
import { COL, createdFields, num, requireUid, str, strOrNull, toDate, updatedFields, writeAudit } from './firestore';

export const PARTY_LABELS: Record<PartyType, { singular: string; plural: string; path: string }> = {
  BUYER: { singular: 'Buyer', plural: 'Buyers', path: 'buyers' },
  SELLER: { singular: 'Seller', plural: 'Sellers', path: 'sellers' },
  COMMISSION_AGENT: { singular: 'Commission agent', plural: 'Commission agents', path: 'commission-agents' },
  TRANSPORTER: { singular: 'Transporter', plural: 'Transporters', path: 'transporters' },
  PAYMENT_AGENT: { singular: 'Payment agent', plural: 'Payment agents', path: 'payment-agents' },
};

export function partyTypeFromPath(path: string | undefined): PartyType | null {
  return (Object.keys(PARTY_LABELS) as PartyType[]).find((t) => PARTY_LABELS[t].path === path) ?? null;
}

function toRates(raw: unknown): PartyRates {
  const out: PartyRates = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const rt of RATE_TYPES) {
    const v = (raw as Record<string, unknown>)[rt];
    if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) out[rt] = v;
  }
  return out;
}

export function toParty(id: string, d: DocumentData): Party {
  const type = (PARTY_TYPES as readonly string[]).includes(str(d.type)) ? (d.type as PartyType) : 'BUYER';
  const defaults = (d.defaults ?? {}) as Record<string, unknown>;
  return {
    id,
    type,
    code: str(d.code),
    name: str(d.name),
    phone: str(d.phone),
    address: str(d.address),
    gstin: str(d.gstin),
    notes: str(d.notes),
    active: d.active !== false,
    rates: toRates(d.rates),
    defaults: {
      commissionAgentId: strOrNull(defaults.commissionAgentId),
      transporterId: strOrNull(defaults.transporterId),
      paymentAgentId: strOrNull(defaults.paymentAgentId),
    },
    demo: d.demo === true,
    createdAt: toDate(d.createdAt),
    createdBy: str(d.createdBy),
    updatedAt: toDate(d.updatedAt),
    updatedBy: str(d.updatedBy),
  };
}

/**
 * All parties, live. Master data for a small business is a few hundred
 * documents at most, so one listener feeds every dropdown and name lookup
 * (no N+1 reads when rendering tables).
 */
export function subscribeAllParties(onValue: (parties: Party[]) => void, onError: (e: unknown) => void): Unsubscribe {
  return onSnapshot(
    query(collection(db, COL.parties), orderBy('nameLower')),
    (snap) => onValue(snap.docs.map((d) => toParty(d.id, d.data()))),
    onError,
  );
}

function validateInput(type: PartyType, input: PartyInput): PartyInput {
  const name = validateName(input.name, 'Name');
  if (!name.ok) throw new AppError(name.error);
  const phone = validatePhone(input.phone);
  if (!phone.ok) throw new AppError(phone.error);
  const address = validateOptionalText(input.address, 300);
  if (!address.ok) throw new AppError(address.error);
  const notes = validateOptionalText(input.notes, 500);
  if (!notes.ok) throw new AppError(notes.error);
  const gstin = validateGstin(input.gstin);
  if (!gstin.ok) throw new AppError(gstin.error);
  const allowed = RATE_TYPES_BY_PARTY[type];
  const rates: PartyRates = {};
  for (const rt of allowed) {
    const v = input.rates[rt];
    if (v === undefined) continue;
    if (!Number.isSafeInteger(v) || v < 0) throw new AppError(`${RATE_META[rt].label} is invalid`);
    rates[rt] = v;
  }
  return {
    name: name.value,
    phone: phone.value,
    address: address.value,
    notes: notes.value,
    gstin: gstin.value,
    active: input.active,
    rates,
    defaults: {
      commissionAgentId: input.defaults.commissionAgentId || null,
      transporterId: input.defaults.transporterId || null,
      paymentAgentId: input.defaults.paymentAgentId || null,
    },
  };
}

export async function createParty(type: PartyType, raw: PartyInput, opts: { demo?: boolean } = {}): Promise<string> {
  const uid = requireUid();
  const input = validateInput(type, raw);
  const partyRef = doc(collection(db, COL.parties));
  const counterRef = doc(db, COL.counters, `party-${type}`);
  await runTransaction(db, async (tx) => {
    const counter = await tx.get(counterRef);
    const seq = num(counter.data()?.seq, 0) + 1;
    tx.set(counterRef, { seq, updatedAt: serverTimestamp() });
    tx.set(partyRef, {
      type,
      code: formatPartyCode(type, seq),
      name: input.name,
      nameLower: input.name.toLowerCase(),
      phone: input.phone,
      address: input.address,
      gstin: input.gstin,
      notes: input.notes,
      active: true,
      rates: input.rates,
      defaults: input.defaults,
      ...(opts.demo ? { demo: true } : {}),
      ...createdFields(uid),
    });
    // Initial rates are the first entries in rate history.
    for (const rt of RATE_TYPES_BY_PARTY[type]) {
      const v = input.rates[rt];
      if (v === undefined) continue;
      const h = buildRateHistoryEntry({
        partyId: partyRef.id,
        partyType: type,
        rateType: rt,
        oldRate: null,
        newRate: v,
        effectiveFrom: todayISO(),
        changedBy: uid,
        sourceOrderId: null,
        sourceOrderNumber: null,
        reason: 'Initial rate',
      });
      tx.set(doc(collection(db, COL.rateHistory)), { ...h, createdAt: serverTimestamp() });
    }
    writeAudit(tx, uid, { entityType: 'party', entityId: partyRef.id, action: 'CREATE', summary: `Added ${PARTY_LABELS[type].singular.toLowerCase()} ${input.name}` });
  });
  return partyRef.id;
}

/** Updates profile fields. Rates are changed only through changeDefaultRate (keeps history). */
export async function updateParty(party: Party, raw: Omit<PartyInput, 'rates'>): Promise<void> {
  const uid = requireUid();
  const input = validateInput(party.type, { ...raw, rates: {} });
  const ref = doc(db, COL.parties, party.id);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new AppError('This record no longer exists', 'not-found');
    const before = toParty(party.id, snap.data());
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const k of ['name', 'phone', 'address', 'gstin', 'notes', 'active'] as const) {
      if (before[k] !== input[k]) changes[k] = { from: before[k], to: input[k] };
    }
    tx.update(ref, {
      name: input.name,
      nameLower: input.name.toLowerCase(),
      phone: input.phone,
      address: input.address,
      gstin: input.gstin,
      notes: input.notes,
      active: input.active,
      defaults: input.defaults,
      ...updatedFields(uid),
    });
    writeAudit(tx, uid, {
      entityType: 'party',
      entityId: party.id,
      action: 'UPDATE',
      summary: `Updated ${input.name}`,
      changes,
    });
  });
}

export async function setPartyActive(party: Party, active: boolean): Promise<void> {
  await updateParty(party, { ...party, active });
}

/** Changes a party's default rate from its profile (not from an order) and records history. */
export async function changeDefaultRate(party: Party, rateType: RateType, newValue: number, reason: string): Promise<void> {
  const uid = requireUid();
  if (!RATE_TYPES_BY_PARTY[party.type].includes(rateType)) throw new AppError('That rate does not apply to this party');
  if (!Number.isSafeInteger(newValue) || newValue < 0) throw new AppError('Enter a valid rate');
  const ref = doc(db, COL.parties, party.id);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new AppError('This record no longer exists', 'not-found');
    const current = defaultRateFor(toRates(snap.data().rates), rateType);
    if (current === newValue) throw new AppError('That is already the current rate');
    const h = buildRateHistoryEntry({
      partyId: party.id,
      partyType: party.type,
      rateType,
      oldRate: current,
      newRate: newValue,
      effectiveFrom: todayISO(),
      changedBy: uid,
      sourceOrderId: null,
      sourceOrderNumber: null,
      reason: reason.trim().slice(0, 200),
    });
    tx.update(ref, { [`rates.${rateType}`]: newValue, ...updatedFields(uid) });
    tx.set(doc(collection(db, COL.rateHistory)), { ...h, createdAt: serverTimestamp() });
    writeAudit(tx, uid, {
      entityType: 'party',
      entityId: party.id,
      action: 'RATE_CHANGE',
      summary: `${RATE_META[rateType].label} for ${party.name}`,
      changes: { [rateType]: { from: current, to: newValue } },
      reason: h.reason,
    });
  });
}

export async function listRateHistory(partyId: string, max = 100): Promise<RateHistoryEntry[]> {
  const snap = await getDocs(
    query(collection(db, COL.rateHistory), where('partyId', '==', partyId), orderBy('createdAt', 'desc'), limit(max)),
  );
  return snap.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id,
      partyId: str(x.partyId),
      partyType: x.partyType as PartyType,
      rateType: x.rateType as RateType,
      oldRate: typeof x.oldRate === 'number' ? x.oldRate : null,
      newRate: num(x.newRate),
      effectiveFrom: str(x.effectiveFrom),
      changedBy: str(x.changedBy),
      sourceOrderId: strOrNull(x.sourceOrderId),
      sourceOrderNumber: strOrNull(x.sourceOrderNumber),
      reason: str(x.reason),
      createdAt: toDate(x.createdAt),
    };
  });
}
