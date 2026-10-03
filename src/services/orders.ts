import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  startAfter,
  where,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase/app';
import { calculateOrder, type OrderFinancials } from '../domain/calc';
import { todayISO, yearOf, type DateRange } from '../domain/dates';
import { formatOrderNumber, nextSequence, orderCounterId } from '../domain/orderNumber';
import { emptyPaid, invalidPaidKeys } from '../domain/payments';
import { buildRateHistoryEntry, defaultRateFor, RATE_META, resolveRateSelection, type RateSelection } from '../domain/rates';
import { orderContribution } from '../domain/rollups';
import { buildSearchTokens } from '../domain/search';
import type {
  ExtractionStatus,
  Order,
  OrderStatus,
  PaidMap,
  PartyType,
  RateDecisionRecord,
  RateType,
  ReceiptImageRef,
  ReceiptSnapshot,
} from '../domain/types';
import { normalizeVehicleNumber, validateDispatchDate, validateOptionalText, validatePhone } from '../domain/validation';
import { AppError } from './errors';
import { COL, num, requireUid, str, strOrNull, toDate, updatedFields, writeAudit, writeRollupDeltas } from './firestore';
import { toParty } from './parties';

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function toPaid(raw: unknown): PaidMap {
  const p = emptyPaid();
  if (raw && typeof raw === 'object') {
    for (const k of Object.keys(p) as (keyof PaidMap)[]) p[k] = num((raw as Record<string, unknown>)[k]);
  }
  return p;
}

function line(raw: unknown): { id: string | null; name: string; ratePaise: number; amount: number } {
  const r = (raw ?? {}) as Record<string, unknown>;
  return { id: strOrNull(r.id), name: str(r.name), ratePaise: num(r.ratePaise), amount: num(r.amount) };
}

function toImageRef(raw: unknown): ReceiptImageRef {
  const i = (raw ?? {}) as Record<string, unknown>;
  return {
    provider: i.provider === 'FIREBASE_STORAGE' ? 'FIREBASE_STORAGE' : 'NONE',
    ref: strOrNull(i.ref),
    fileName: strOrNull(i.fileName),
    contentType: strOrNull(i.contentType),
    sizeBytes: typeof i.sizeBytes === 'number' ? i.sizeBytes : null,
  };
}

export function toOrder(id: string, d: DocumentData): Order {
  const r = (d.receipt ?? {}) as Record<string, unknown>;
  const ai = (r.ai ?? {}) as Record<string, unknown>;
  const b = (d.buyer ?? {}) as Record<string, unknown>;
  const pa = (d.paymentAgent ?? {}) as Record<string, unknown>;
  const fr = (d.freight ?? {}) as Record<string, unknown>;
  return {
    id,
    orderNumber: str(d.orderNumber),
    seq: num(d.seq),
    status: (['DRAFT', 'CONFIRMED', 'CANCELLED'].includes(str(d.status)) ? d.status : 'CONFIRMED') as OrderStatus,
    dispatchDate: str(d.dispatchDate),
    qtyKg: num(d.qtyKg),
    receipt: {
      image: toImageRef(r.image),
      receiptNumber: str(r.receiptNumber),
      driverName: str(r.driverName),
      driverPhone: str(r.driverPhone),
      vehicleNumber: str(r.vehicleNumber),
      destination: str(r.destination),
      dispatchDate: str(r.dispatchDate),
      netQtyKg: num(r.netQtyKg),
      ai: {
        status: (str(ai.status) || 'SKIPPED') as ExtractionStatus,
        model: strOrNull(ai.model),
        raw: strOrNull(ai.raw),
        error: strOrNull(ai.error),
      },
    },
    buyer: {
      id: str(b.id),
      name: str(b.name),
      ratePaise: num(b.ratePaise),
      gstBp: num(b.gstBp),
      baseAmount: num(b.baseAmount),
      gstAmount: num(b.gstAmount),
      grossAmount: num(b.grossAmount),
    },
    seller: line(d.seller),
    commission: line(d.commission),
    freight: { ...line(d.freight), destination: str(fr.destination) },
    paymentAgent: {
      id: strOrNull(pa.id),
      name: str(pa.name),
      ratePaise: num(pa.ratePaise),
      received: num(pa.received),
      deduction: num(pa.deduction),
      balance: num(pa.balance),
    },
    buyerId: str(d.buyerId),
    sellerId: str(d.sellerId),
    commissionAgentId: strOrNull(d.commissionAgentId),
    transporterId: strOrNull(d.transporterId),
    paymentAgentId: strOrNull(d.paymentAgentId),
    paid: toPaid(d.paid),
    lastPaymentId: strOrNull(d.lastPaymentId),
    counterId: strOrNull(d.counterId),
    rateDecisions: Array.isArray(d.rateDecisions) ? (d.rateDecisions as RateDecisionRecord[]) : [],
    searchTokens: Array.isArray(d.searchTokens) ? (d.searchTokens as string[]) : [],
    notes: str(d.notes),
    version: num(d.version, 1),
    cancelReason: strOrNull(d.cancelReason),
    demo: d.demo === true,
    createdAt: toDate(d.createdAt),
    createdBy: str(d.createdBy),
    updatedAt: toDate(d.updatedAt),
    updatedBy: str(d.updatedBy),
  };
}

function tokensFor(o: {
  orderNumber: string;
  receipt: Pick<ReceiptSnapshot, 'vehicleNumber' | 'driverPhone' | 'receiptNumber' | 'driverName' | 'destination'>;
  names: string[];
}): string[] {
  return buildSearchTokens({
    exact: [o.orderNumber, o.receipt.vehicleNumber, o.receipt.driverPhone, o.receipt.receiptNumber],
    text: [o.receipt.driverName, o.receipt.destination, ...o.names],
  });
}

function financialFields(f: OrderFinancials) {
  return {
    buyer: {
      ratePaise: f.buyer.ratePaise,
      gstBp: f.buyer.gstBp,
      baseAmount: f.buyer.baseAmount,
      gstAmount: f.buyer.gstAmount,
      grossAmount: f.buyer.grossAmount,
    },
    seller: { ratePaise: f.seller.ratePaise, amount: f.seller.amount },
    commission: { ratePaise: f.commission.ratePaise, amount: f.commission.amount },
    freight: { ratePaise: f.freight.ratePaise, amount: f.freight.amount },
    paymentAgent: {
      ratePaise: f.paymentAgent.ratePaise,
      received: f.paymentAgent.received,
      deduction: f.paymentAgent.deduction,
      balance: f.paymentAgent.balance,
    },
  };
}

const MAX_RAW_AI = 8000;

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface ConfirmedReceipt extends Omit<ReceiptSnapshot, 'ai'> {
  ai: ReceiptSnapshot['ai'];
}

export interface CreateOrderInput {
  /** Client-generated once per order form; makes double-submits harmless. */
  idempotencyKey: string;
  orderPrefix: string;
  receipt: ConfirmedReceipt;
  buyerId: string;
  sellerId: string;
  commissionAgentId: string | null;
  transporterId: string | null;
  paymentAgentId: string | null;
  rates: {
    buyerRate: RateSelection;
    buyerGst: RateSelection;
    sellerRate: RateSelection;
    commissionRate: RateSelection | null;
    freightRate: RateSelection | null;
    paymentAgentRate: RateSelection | null;
  };
  notes: string;
  demo?: boolean;
}

export interface CreateOrderResult {
  id: string;
  orderNumber: string;
  duplicate: boolean;
}

const EXPECTED: Record<keyof CreateOrderInput['rates'], { rateType: RateType; partyType: PartyType }> = {
  buyerRate: { rateType: 'BUYER_RATE', partyType: 'BUYER' },
  buyerGst: { rateType: 'BUYER_GST', partyType: 'BUYER' },
  sellerRate: { rateType: 'SELLER_RATE', partyType: 'SELLER' },
  commissionRate: { rateType: 'COMMISSION_RATE', partyType: 'COMMISSION_AGENT' },
  freightRate: { rateType: 'FREIGHT_RATE', partyType: 'TRANSPORTER' },
  paymentAgentRate: { rateType: 'PAYMENT_AGENT_RATE', partyType: 'PAYMENT_AGENT' },
};

function validateReceipt(r: ConfirmedReceipt): void {
  if (!Number.isSafeInteger(r.netQtyKg) || r.netQtyKg <= 0) throw new AppError('Net quantity must be greater than 0');
  const date = validateDispatchDate(r.dispatchDate);
  if (!date.ok) throw new AppError(date.error);
  const phone = validatePhone(r.driverPhone);
  if (!phone.ok) throw new AppError(`Driver phone: ${phone.error}`);
  for (const [label, v] of [
    ['Driver name', r.driverName],
    ['Destination', r.destination],
    ['Receipt number', r.receiptNumber],
  ] as const) {
    const t = validateOptionalText(v, 120);
    if (!t.ok) throw new AppError(`${label}: ${t.error}`);
  }
}

export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  const uid = requireUid();
  validateReceipt(input.receipt);
  if (!input.buyerId) throw new AppError('Select a buyer');
  if (!input.sellerId) throw new AppError('Select a seller');
  if (!/^[A-Za-z0-9-]{16,64}$/.test(input.idempotencyKey)) throw new AppError('Invalid submission key');

  const partyIds: Record<PartyType, string | null> = {
    BUYER: input.buyerId,
    SELLER: input.sellerId,
    COMMISSION_AGENT: input.commissionAgentId,
    TRANSPORTER: input.transporterId,
    PAYMENT_AGENT: input.paymentAgentId,
  };

  // Every rate selection must belong to the party chosen for its role.
  for (const [key, sel] of Object.entries(input.rates) as [keyof CreateOrderInput['rates'], RateSelection | null][]) {
    const exp = EXPECTED[key];
    const pid = partyIds[exp.partyType];
    if (!pid) {
      if (sel) throw new AppError(`${RATE_META[exp.rateType].label} given without a party`);
      continue;
    }
    if (!sel) throw new AppError(`Missing ${RATE_META[exp.rateType].label}`);
    if (sel.rateType !== exp.rateType || sel.partyId !== pid) throw new AppError('Rate selection does not match the party');
  }

  const orderRef = doc(db, COL.orders, input.idempotencyKey);
  const year = yearOf(todayISO());
  const counterRef = doc(db, COL.counters, orderCounterId(year));

  return runTransaction(db, async (tx) => {
    // ---- reads (all before any write) ----
    const existing = await tx.get(orderRef);
    if (existing.exists()) {
      return { id: orderRef.id, orderNumber: str(existing.data().orderNumber), duplicate: true };
    }
    const counter = await tx.get(counterRef);
    const parties = new Map<PartyType, ReturnType<typeof toParty>>();
    for (const [type, id] of Object.entries(partyIds) as [PartyType, string | null][]) {
      if (!id) continue;
      const snap = await tx.get(doc(db, COL.parties, id));
      if (!snap.exists()) throw new AppError('A selected party no longer exists. Reselect and try again.');
      const p = toParty(snap.id, snap.data());
      if (p.type !== type) throw new AppError(`${p.name} is not a ${type.toLowerCase().replace('_', ' ')}`);
      if (!p.active) throw new AppError(`${p.name} is inactive. Reactivate it or choose another.`);
      parties.set(type, p);
    }

    // ---- compute ----
    const resolved = {
      buyerRate: resolveRateSelection(input.rates.buyerRate),
      buyerGst: resolveRateSelection(input.rates.buyerGst),
      sellerRate: resolveRateSelection(input.rates.sellerRate),
      commissionRate: input.rates.commissionRate ? resolveRateSelection(input.rates.commissionRate) : null,
      freightRate: input.rates.freightRate ? resolveRateSelection(input.rates.freightRate) : null,
      paymentAgentRate: input.rates.paymentAgentRate ? resolveRateSelection(input.rates.paymentAgentRate) : null,
    };
    const fin = calculateOrder({
      qtyKg: input.receipt.netQtyKg,
      buyerRatePaise: resolved.buyerRate.orderValue,
      gstBp: resolved.buyerGst.orderValue,
      sellerRatePaise: resolved.sellerRate.orderValue,
      commissionRatePaise: resolved.commissionRate?.orderValue ?? 0,
      freightRatePaise: resolved.freightRate?.orderValue ?? 0,
      paymentAgentRatePaise: resolved.paymentAgentRate?.orderValue ?? 0,
    });

    const seq = nextSequence(counter.exists() ? num(counter.data().seq) : undefined);
    const orderNumber = formatOrderNumber(input.orderPrefix, year, seq);
    const buyer = parties.get('BUYER')!;
    const seller = parties.get('SELLER')!;
    const agent = parties.get('COMMISSION_AGENT') ?? null;
    const transporter = parties.get('TRANSPORTER') ?? null;
    const pa = parties.get('PAYMENT_AGENT') ?? null;
    // Only confirmed text fields + image METADATA. Never image content.
    const receipt: ReceiptSnapshot = {
      image: {
        provider: input.receipt.image.provider,
        ref: input.receipt.image.provider === 'NONE' ? null : input.receipt.image.ref,
        fileName: input.receipt.image.fileName ? input.receipt.image.fileName.slice(0, 120) : null,
        contentType: input.receipt.image.contentType ? input.receipt.image.contentType.slice(0, 60) : null,
        sizeBytes: Number.isSafeInteger(input.receipt.image.sizeBytes) ? input.receipt.image.sizeBytes : null,
      },
      receiptNumber: input.receipt.receiptNumber.trim().slice(0, 120),
      driverName: input.receipt.driverName.trim().slice(0, 120),
      driverPhone: input.receipt.driverPhone.trim(),
      vehicleNumber: normalizeVehicleNumber(input.receipt.vehicleNumber).slice(0, 20),
      destination: input.receipt.destination.trim().slice(0, 120),
      dispatchDate: input.receipt.dispatchDate,
      netQtyKg: input.receipt.netQtyKg,
      ai: {
        status: input.receipt.ai.status,
        model: input.receipt.ai.model ? input.receipt.ai.model.slice(0, 80) : null,
        raw: input.receipt.ai.raw ? input.receipt.ai.raw.slice(0, MAX_RAW_AI) : null,
        error: input.receipt.ai.error ? input.receipt.ai.error.slice(0, 500) : null,
      },
    };
    const f = financialFields(fin);
    const orderData = {
      orderNumber,
      seq,
      counterId: counterRef.id,
      status: 'CONFIRMED' as OrderStatus,
      dispatchDate: receipt.dispatchDate,
      qtyKg: fin.qtyKg,
      receipt: { ...receipt, confirmedAt: serverTimestamp(), confirmedBy: uid },
      buyer: { id: buyer.id, name: buyer.name, ...f.buyer },
      seller: { id: seller.id, name: seller.name, ...f.seller },
      commission: { id: agent?.id ?? null, name: agent?.name ?? '', ...f.commission },
      freight: { id: transporter?.id ?? null, name: transporter?.name ?? '', destination: receipt.destination, ...f.freight },
      paymentAgent: { id: pa?.id ?? null, name: pa?.name ?? '', ...f.paymentAgent },
      buyerId: buyer.id,
      sellerId: seller.id,
      commissionAgentId: agent?.id ?? null,
      transporterId: transporter?.id ?? null,
      paymentAgentId: pa?.id ?? null,
      paid: emptyPaid(),
      lastPaymentId: null,
      rateDecisions: Object.values(resolved)
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .map((r) => r.record),
      searchTokens: tokensFor({
        orderNumber,
        receipt,
        names: [buyer.name, seller.name, agent?.name ?? '', transporter?.name ?? '', pa?.name ?? ''],
      }),
      notes: input.notes.trim().slice(0, 500),
      version: 1,
      cancelReason: null,
      ...(input.demo ? { demo: true } : {}),
      createdAt: serverTimestamp(),
      createdBy: uid,
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    };

    // ---- writes ----
    tx.set(counterRef, { seq, year, updatedAt: serverTimestamp() });
    tx.set(orderRef, orderData);

    // New defaults (grouped per party) + rate history.
    const updatesByParty = new Map<string, Record<string, unknown>>();
    for (const r of Object.values(resolved)) {
      if (!r || r.newDefault === null) continue;
      const meta = RATE_META[r.record.rateType];
      const party = parties.get(meta.partyType)!;
      const current = defaultRateFor(party.rates, r.record.rateType);
      if (current === r.newDefault) continue;
      const historyRef = doc(collection(db, COL.rateHistory));
      const u = updatesByParty.get(party.id) ?? {};
      u[`rates.${r.record.rateType}`] = r.newDefault;
      // Links the default change to its (new) history entry; required by the rules.
      u.lastRateChangeId = historyRef.id;
      updatesByParty.set(party.id, u);
      const h = buildRateHistoryEntry({
        partyId: party.id,
        partyType: party.type,
        rateType: r.record.rateType,
        oldRate: current,
        newRate: r.newDefault,
        effectiveFrom: receipt.dispatchDate,
        changedBy: uid,
        sourceOrderId: orderRef.id,
        sourceOrderNumber: orderNumber,
        reason: `Set as new default on order ${orderNumber}`,
      });
      tx.set(historyRef, { ...h, createdAt: serverTimestamp() });
    }
    for (const [pid, u] of updatesByParty) tx.update(doc(db, COL.parties, pid), { ...u, ...updatedFields(uid) });

    writeRollupDeltas(tx, [
      orderContribution({
        dispatchDate: orderData.dispatchDate,
        qtyKg: orderData.qtyKg,
        buyer: orderData.buyer,
        seller: orderData.seller,
        commission: orderData.commission,
        freight: orderData.freight,
        paymentAgent: orderData.paymentAgent,
        buyerId: orderData.buyerId,
        sellerId: orderData.sellerId,
        commissionAgentId: orderData.commissionAgentId,
        transporterId: orderData.transporterId,
        paymentAgentId: orderData.paymentAgentId,
      }),
    ]);
    writeAudit(tx, uid, {
      entityType: 'order',
      entityId: orderRef.id,
      action: 'CREATE',
      summary: `Created ${orderNumber}: ${buyer.name} ← ${seller.name}`,
    });
    return { id: orderRef.id, orderNumber, duplicate: false };
  });
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getOrder(id: string): Promise<Order | null> {
  const snap = await getDoc(doc(db, COL.orders, id));
  return snap.exists() ? toOrder(snap.id, snap.data()) : null;
}

export function subscribeOrder(id: string, onValue: (o: Order | null) => void, onError: (e: unknown) => void): Unsubscribe {
  return onSnapshot(doc(db, COL.orders, id), (s) => onValue(s.exists() ? toOrder(s.id, s.data()) : null), onError);
}

export const PARTY_FIELD: Record<PartyType, string> = {
  BUYER: 'buyerId',
  SELLER: 'sellerId',
  COMMISSION_AGENT: 'commissionAgentId',
  TRANSPORTER: 'transporterId',
  PAYMENT_AGENT: 'paymentAgentId',
};

export interface OrderQuery {
  range: DateRange;
  status: 'CONFIRMED' | 'CANCELLED';
  party?: { type: PartyType; id: string } | null;
  /** A single search token (see domain/search.ts). Takes precedence over `party`. */
  token?: string | null;
  direction?: 'desc' | 'asc';
  pageSize?: number;
}

export interface OrderPage {
  orders: Order[];
  cursor: QueryDocumentSnapshot | null;
}

/**
 * One indexed Firestore query per page. Filters Firestore can't combine
 * (e.g. search + party + payment status) are refined client-side by callers.
 */
export async function queryOrders(q: OrderQuery, after: QueryDocumentSnapshot | null = null): Promise<OrderPage> {
  const dir = q.direction ?? 'desc';
  const size = Math.min(q.pageSize ?? 50, 500);
  const c: QueryConstraint[] = [where('status', '==', q.status)];
  if (q.token) c.push(where('searchTokens', 'array-contains', q.token));
  else if (q.party) c.push(where(PARTY_FIELD[q.party.type], '==', q.party.id));
  if (q.range.from) c.push(where('dispatchDate', '>=', q.range.from));
  if (q.range.to) c.push(where('dispatchDate', '<=', q.range.to));
  c.push(orderBy('dispatchDate', dir), orderBy('seq', dir));
  if (after) c.push(startAfter(after));
  c.push(limit(size));
  const snap = await getDocs(query(collection(db, COL.orders), ...c));
  return {
    orders: snap.docs.map((d) => toOrder(d.id, d.data())),
    cursor: snap.docs.length === size ? snap.docs[snap.docs.length - 1]! : null,
  };
}

/** Loads every page for a query (reports/exports). Capped to protect read quotas. */
export async function queryAllOrders(q: Omit<OrderQuery, 'pageSize'>, cap = 5000): Promise<{ orders: Order[]; truncated: boolean }> {
  const all: Order[] = [];
  let cursor: QueryDocumentSnapshot | null = null;
  do {
    const page: OrderPage = await queryOrders({ ...q, pageSize: 500 }, cursor);
    all.push(...page.orders);
    cursor = page.cursor;
  } while (cursor && all.length < cap);
  return { orders: all.slice(0, cap), truncated: Boolean(cursor) || all.length > cap };
}

// ---------------------------------------------------------------------------
// Edit (corrections) & cancel
// ---------------------------------------------------------------------------

export interface OrderEditInput {
  expectedVersion: number;
  receiptNumber: string;
  driverName: string;
  driverPhone: string;
  vehicleNumber: string;
  destination: string;
  dispatchDate: string;
  qtyKg: number;
  buyerRatePaise: number;
  gstBp: number;
  sellerRatePaise: number;
  commissionRatePaise: number;
  freightRatePaise: number;
  paymentAgentRatePaise: number;
  notes: string;
  reason: string;
}

/**
 * Corrects a confirmed order. Parties can't be changed here (cancel and
 * re-create instead, so payments never point at the wrong party). Master
 * default rates are never touched by an edit. Every change is audit-logged
 * with before/after values and a mandatory reason.
 */
export async function editOrder(id: string, input: OrderEditInput): Promise<void> {
  const uid = requireUid();
  const reason = input.reason.trim();
  if (reason.length < 3) throw new AppError('Give a short reason for this correction');
  validateReceipt({
    image: { provider: 'NONE', ref: null, fileName: null, contentType: null, sizeBytes: null },
    receiptNumber: input.receiptNumber,
    driverName: input.driverName,
    driverPhone: input.driverPhone,
    vehicleNumber: input.vehicleNumber,
    destination: input.destination,
    dispatchDate: input.dispatchDate,
    netQtyKg: input.qtyKg,
    ai: { status: 'SKIPPED', model: null, raw: null, error: null },
  });
  const ref = doc(db, COL.orders, id);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new AppError('This order no longer exists', 'not-found');
    const before = toOrder(snap.id, snap.data());
    if (before.status !== 'CONFIRMED') throw new AppError('Only confirmed orders can be corrected');
    if (before.version !== input.expectedVersion) {
      throw new AppError('This order was changed by someone else. Reload it and try again.', 'aborted');
    }
    const fin = calculateOrder({
      qtyKg: input.qtyKg,
      buyerRatePaise: input.buyerRatePaise,
      gstBp: input.gstBp,
      sellerRatePaise: input.sellerRatePaise,
      commissionRatePaise: before.commissionAgentId ? input.commissionRatePaise : 0,
      freightRatePaise: before.transporterId ? input.freightRatePaise : 0,
      paymentAgentRatePaise: before.paymentAgentId ? input.paymentAgentRatePaise : 0,
    });
    const f = financialFields(fin);
    const receipt = {
      ...before.receipt,
      receiptNumber: input.receiptNumber.trim(),
      driverName: input.driverName.trim(),
      driverPhone: input.driverPhone.trim(),
      vehicleNumber: normalizeVehicleNumber(input.vehicleNumber),
      destination: input.destination.trim(),
      dispatchDate: input.dispatchDate,
      netQtyKg: fin.qtyKg,
    };
    const after: Order = {
      ...before,
      dispatchDate: input.dispatchDate,
      qtyKg: fin.qtyKg,
      receipt,
      buyer: { ...before.buyer, ...f.buyer },
      seller: { ...before.seller, ...f.seller },
      commission: { ...before.commission, ...f.commission },
      freight: { ...before.freight, ...f.freight, destination: receipt.destination },
      paymentAgent: { ...before.paymentAgent, ...f.paymentAgent },
      notes: input.notes.trim().slice(0, 500),
    };

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const track = (key: string, a: unknown, b: unknown) => {
      if (a !== b) changes[key] = { from: a, to: b };
    };
    track('dispatchDate', before.dispatchDate, after.dispatchDate);
    track('qtyKg', before.qtyKg, after.qtyKg);
    track('receiptNumber', before.receipt.receiptNumber, receipt.receiptNumber);
    track('driverName', before.receipt.driverName, receipt.driverName);
    track('driverPhone', before.receipt.driverPhone, receipt.driverPhone);
    track('vehicleNumber', before.receipt.vehicleNumber, receipt.vehicleNumber);
    track('destination', before.receipt.destination, receipt.destination);
    track('buyer.ratePaise', before.buyer.ratePaise, after.buyer.ratePaise);
    track('buyer.gstBp', before.buyer.gstBp, after.buyer.gstBp);
    track('buyer.grossAmount', before.buyer.grossAmount, after.buyer.grossAmount);
    track('seller.ratePaise', before.seller.ratePaise, after.seller.ratePaise);
    track('commission.ratePaise', before.commission.ratePaise, after.commission.ratePaise);
    track('freight.ratePaise', before.freight.ratePaise, after.freight.ratePaise);
    track('paymentAgent.ratePaise', before.paymentAgent.ratePaise, after.paymentAgent.ratePaise);
    track('notes', before.notes, after.notes);
    if (Object.keys(changes).length === 0) throw new AppError('Nothing was changed');
    const tooLow = invalidPaidKeys(after);
    if (tooLow.length > 0) {
      throw new AppError(`This correction makes an amount smaller than what has already been paid (${tooLow.join(', ')}). Void the extra payment first.`);
    }

    tx.update(ref, {
      dispatchDate: after.dispatchDate,
      qtyKg: after.qtyKg,
      'receipt.receiptNumber': receipt.receiptNumber,
      'receipt.driverName': receipt.driverName,
      'receipt.driverPhone': receipt.driverPhone,
      'receipt.vehicleNumber': receipt.vehicleNumber,
      'receipt.destination': receipt.destination,
      'receipt.dispatchDate': receipt.dispatchDate,
      'receipt.netQtyKg': receipt.netQtyKg,
      buyer: after.buyer,
      seller: after.seller,
      commission: after.commission,
      freight: after.freight,
      paymentAgent: after.paymentAgent,
      notes: after.notes,
      searchTokens: tokensFor({
        orderNumber: before.orderNumber,
        receipt,
        names: [before.buyer.name, before.seller.name, before.commission.name, before.freight.name, before.paymentAgent.name],
      }),
      version: before.version + 1,
      ...updatedFields(uid),
    });
    writeRollupDeltas(tx, [orderContribution(before, -1), orderContribution(after, 1)]);
    writeAudit(tx, uid, {
      entityType: 'order',
      entityId: id,
      action: 'EDIT',
      summary: `Corrected ${before.orderNumber}`,
      changes,
      reason,
    });
  });
}

export async function cancelOrder(id: string, reason: string): Promise<void> {
  const uid = requireUid();
  const why = reason.trim();
  if (why.length < 3) throw new AppError('Give a short reason for cancelling');
  const ref = doc(db, COL.orders, id);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new AppError('This order no longer exists', 'not-found');
    const o = toOrder(snap.id, snap.data());
    if (o.status !== 'CONFIRMED') throw new AppError('This order is already cancelled');
    if (Object.values(o.paid).some((v) => v !== 0)) {
      throw new AppError('This order has payments recorded against it. Void those payments first.');
    }
    tx.update(ref, { status: 'CANCELLED', cancelReason: why.slice(0, 300), version: o.version + 1, ...updatedFields(uid) });
    writeRollupDeltas(tx, [orderContribution(o, -1)]);
    writeAudit(tx, uid, { entityType: 'order', entityId: id, action: 'CANCEL', summary: `Cancelled ${o.orderNumber}`, reason: why });
  });
}
