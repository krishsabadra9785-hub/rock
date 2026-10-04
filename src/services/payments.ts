import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  startAfter,
  where,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '../firebase/app';
import { isValidISODate, type DateRange } from '../domain/dates';
import { applyPaymentToOrder, assertPaymentMatchesOrder, assertValidPaymentAmount, categoryAcceptsPartyType, CATEGORY_META, PaymentIntegrityError } from '../domain/payments';
import { paymentContribution } from '../domain/rollups';
import { PAYMENT_CATEGORIES, PAYMENT_METHODS, type PartyType, type Payment, type PaymentCategory, type PaymentMethod } from '../domain/types';
import { validateOptionalText } from '../domain/validation';
import { formatINR } from '../domain/format';
import { AppError } from './errors';
import { COL, num, requireUid, str, strOrNull, toDate, updatedFields, writeAudit, writeRollupDeltas } from './firestore';
import { toOrder } from './orders';
import { toParty } from './parties';

export function toPayment(id: string, d: DocumentData): Payment {
  return {
    id,
    category: ((PAYMENT_CATEGORIES as readonly string[]).includes(str(d.category)) ? d.category : 'OTHER') as PaymentCategory,
    date: str(d.date),
    amount: num(d.amount),
    partyId: strOrNull(d.partyId),
    partyType: (strOrNull(d.partyType) as PartyType | null) ?? null,
    partyName: str(d.partyName),
    orderId: strOrNull(d.orderId),
    orderNumber: strOrNull(d.orderNumber),
    method: ((PAYMENT_METHODS as readonly string[]).includes(str(d.method)) ? d.method : 'OTHER') as PaymentMethod,
    reference: str(d.reference),
    notes: str(d.notes),
    status: d.status === 'VOID' ? 'VOID' : 'ACTIVE',
    voidReason: strOrNull(d.voidReason),
    demo: d.demo === true,
    createdAt: toDate(d.createdAt),
    createdBy: str(d.createdBy),
    updatedAt: toDate(d.updatedAt),
    updatedBy: str(d.updatedBy),
  };
}

export interface PaymentInput {
  idempotencyKey: string;
  category: PaymentCategory;
  date: string;
  amount: number;
  partyId: string | null;
  orderId: string | null;
  method: PaymentMethod;
  reference: string;
  notes: string;
  demo?: boolean;
}

export async function recordPayment(input: PaymentInput): Promise<{ id: string; duplicate: boolean }> {
  const uid = requireUid();
  const meta = CATEGORY_META[input.category];
  try {
    assertValidPaymentAmount(input.amount);
  } catch (e) {
    throw new AppError(e instanceof Error ? e.message : 'Enter a valid amount');
  }
  if (!isValidISODate(input.date)) throw new AppError('Enter a valid payment date');
  if (meta.partyType && !input.partyId) throw new AppError('Select who this payment is for');
  for (const [label, v, max] of [
    ['Reference', input.reference, 80],
    ['Notes', input.notes, 500],
  ] as const) {
    const r = validateOptionalText(v, max);
    if (!r.ok) throw new AppError(`${label}: ${r.error}`);
  }
  if (!/^[A-Za-z0-9-]{16,64}$/.test(input.idempotencyKey)) throw new AppError('Invalid submission key');

  const payRef = doc(db, COL.payments, input.idempotencyKey);
  return runTransaction(db, async (tx) => {
    const existing = await tx.get(payRef);
    if (existing.exists()) return { id: payRef.id, duplicate: true };

    let partyName = '';
    let partyType: PartyType | null = null;
    if (input.partyId) {
      const ps = await tx.get(doc(db, COL.parties, input.partyId));
      if (!ps.exists()) throw new AppError('The selected party no longer exists');
      const p = toParty(ps.id, ps.data());
      if (!categoryAcceptsPartyType(input.category, p.type)) throw new AppError(`${p.name} is not the right kind of party for ${meta.label}`);
      partyName = p.name;
      partyType = p.type;
    }

    let orderNumber: string | null = null;
    if (input.orderId) {
      if (!meta.paidKey) throw new AppError('"Other" payments cannot be linked to an order');
      const os = await tx.get(doc(db, COL.orders, input.orderId));
      if (!os.exists()) throw new AppError('The linked order no longer exists');
      const o = toOrder(os.id, os.data());
      if (o.status !== 'CONFIRMED') throw new AppError('Payments cannot be recorded against a cancelled order');
      try {
        assertPaymentMatchesOrder(o, input.category, input.partyId);
        // Explicit new total computed from the value read in THIS transaction.
        // Firestore retries the transaction if the order changed meanwhile, and the
        // security rules re-check that it moved by exactly this payment's amount.
        const paid = applyPaymentToOrder(o, input.category, input.amount, 1);
        tx.update(os.ref, { [`paid.${meta.paidKey}`]: paid[meta.paidKey], lastPaymentId: payRef.id, ...updatedFields(uid) });
      } catch (e) {
        if (e instanceof PaymentIntegrityError) throw new AppError(`${o.orderNumber}: ${e.message.replace(/ \(\d+ paise\)$/, '')}.`);
        throw e;
      }
      orderNumber = o.orderNumber;
    }

    const data = {
      category: input.category,
      date: input.date,
      amount: input.amount,
      partyId: input.partyId,
      partyType,
      partyName: partyName.slice(0, 120),
      orderId: input.orderId,
      orderNumber,
      method: input.method,
      reference: input.reference.trim(),
      notes: input.notes.trim(),
      status: 'ACTIVE',
      voidReason: null,
      ...(input.demo ? { demo: true } : {}),
      createdAt: serverTimestamp(),
      createdBy: uid,
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    };
    tx.set(payRef, data);
    writeRollupDeltas(tx, [paymentContribution({ date: input.date, amount: input.amount, category: input.category, partyId: input.partyId, partyType })]);
    writeAudit(tx, uid, {
      entityType: 'payment',
      entityId: payRef.id,
      action: 'CREATE',
      summary: `${meta.label} ${formatINR(input.amount)}${partyName ? ` — ${partyName}` : ''}${orderNumber ? ` (${orderNumber})` : ''}`,
    });
    return { id: payRef.id, duplicate: false };
  });
}

/** Payments are never deleted; voiding reverses their effect and keeps the record. */
export async function voidPayment(id: string, reason: string): Promise<void> {
  const uid = requireUid();
  const why = reason.trim();
  if (why.length < 3) throw new AppError('Give a short reason for voiding');
  const ref = doc(db, COL.payments, id);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new AppError('This payment no longer exists', 'not-found');
    const p = toPayment(snap.id, snap.data());
    if (p.status === 'VOID') throw new AppError('This payment is already void');
    const meta = CATEGORY_META[p.category];
    if (p.orderId && meta.paidKey) {
      const oref = doc(db, COL.orders, p.orderId);
      const os = await tx.get(oref);
      if (!os.exists()) throw new AppError('The linked order no longer exists');
      const paid = applyPaymentToOrder(toOrder(os.id, os.data()), p.category, p.amount, -1);
      tx.update(oref, { [`paid.${meta.paidKey}`]: paid[meta.paidKey], lastPaymentId: p.id, ...updatedFields(uid) });
    }
    tx.update(ref, { status: 'VOID', voidReason: why.slice(0, 300), ...updatedFields(uid) });
    writeRollupDeltas(tx, [paymentContribution(p, -1)]);
    writeAudit(tx, uid, { entityType: 'payment', entityId: id, action: 'VOID', summary: `Voided ${meta.label} ${formatINR(p.amount)}`, reason: why });
  });
}

export interface PaymentQuery {
  range: DateRange;
  category?: PaymentCategory | null;
  partyId?: string | null;
  orderId?: string | null;
  pageSize?: number;
}

export async function queryPayments(
  q: PaymentQuery,
  after: QueryDocumentSnapshot | null = null,
): Promise<{ payments: Payment[]; cursor: QueryDocumentSnapshot | null }> {
  const size = Math.min(q.pageSize ?? 50, 500);
  const c: QueryConstraint[] = [];
  if (q.orderId) c.push(where('orderId', '==', q.orderId));
  else if (q.partyId) c.push(where('partyId', '==', q.partyId));
  else if (q.category) c.push(where('category', '==', q.category));
  if (q.range.from) c.push(where('date', '>=', q.range.from));
  if (q.range.to) c.push(where('date', '<=', q.range.to));
  c.push(orderBy('date', 'desc'), orderBy('createdAt', 'desc'));
  if (after) c.push(startAfter(after));
  c.push(limit(size));
  const snap = await getDocs(query(collection(db, COL.payments), ...c));
  let payments = snap.docs.map((d) => toPayment(d.id, d.data()));
  // Second filter applied client-side when two were requested.
  if (q.category && (q.partyId || q.orderId)) payments = payments.filter((p) => p.category === q.category);
  return { payments, cursor: snap.docs.length === size ? snap.docs[snap.docs.length - 1]! : null };
}

export async function queryAllPayments(q: Omit<PaymentQuery, 'pageSize'>, cap = 5000): Promise<{ payments: Payment[]; truncated: boolean }> {
  const all: Payment[] = [];
  let cursor: QueryDocumentSnapshot | null = null;
  do {
    const page: { payments: Payment[]; cursor: QueryDocumentSnapshot | null } = await queryPayments({ ...q, pageSize: 500 }, cursor);
    all.push(...page.payments);
    cursor = page.cursor;
  } while (cursor && all.length < cap);
  return { payments: all.slice(0, cap), truncated: Boolean(cursor) };
}
