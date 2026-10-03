/**
 * Security-rules tests for ROCK, run against the Firestore emulator with the
 * REAL firestore.rules file. Start from the project root:  npm run test:rules
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch, type Firestore } from 'firebase/firestore';

let env: RulesTestEnvironment;
const rules = readFileSync(fileURLToPath(new URL('../../firestore.rules', import.meta.url)), 'utf8');

// ---- users ----
const USERS = {
  admin: 'ADMIN',
  acc: 'ACCOUNTS',
  ops: 'OPERATIONS',
  view: 'VIEW_ONLY',
} as const;

// ---- 38.52 MT reference order (paise / kg / basis points) ----
function referenceOrder(over: Record<string, unknown> = {}) {
  return {
    orderNumber: 'ROCK-2026-000001',
    seq: 1,
    counterId: 'orders-2026',
    status: 'CONFIRMED',
    dispatchDate: '2026-10-03',
    qtyKg: 38520,
    receipt: {
      image: { provider: 'NONE', ref: null, fileName: 'slip.jpg', contentType: 'image/jpeg', sizeBytes: 2048 },
      receiptNumber: 'WB-1', driverName: 'Driver', driverPhone: '9800000009', vehicleNumber: 'MH12AB1234',
      destination: 'Pune', dispatchDate: '2026-10-03', netQtyKg: 38520,
      ai: { status: 'SKIPPED', model: null, raw: null, error: null },
    },
    buyer: { id: 'B1', name: 'Buyer', ratePaise: 1250000, gstBp: 500, baseAmount: 48150000, gstAmount: 2407500, grossAmount: 50557500 },
    seller: { id: 'S1', name: 'Seller', ratePaise: 970000, amount: 37364400 },
    commission: { id: 'A1', name: 'Agent', ratePaise: 72500, amount: 2792700 },
    freight: { id: 'T1', name: 'Trans', ratePaise: 85000, amount: 3274200, destination: 'Pune' },
    paymentAgent: { id: 'P1', name: 'PA', ratePaise: 100000, received: 50557500, deduction: 3852000, balance: 46705500 },
    buyerId: 'B1', sellerId: 'S1', commissionAgentId: 'A1', transporterId: 'T1', paymentAgentId: 'P1',
    paid: { buyer: 0, seller: 0, commission: 0, freight: 0, paymentAgent: 0 },
    lastPaymentId: null,
    rateDecisions: [],
    searchTokens: ['rock2026000001'],
    notes: '',
    version: 1,
    cancelReason: null,
    createdBy: 'ops', updatedBy: 'ops',
    ...over,
  };
}

function payment(over: Record<string, unknown> = {}) {
  return {
    category: 'TRANSPORTER_PAYMENT', date: '2026-10-04', amount: 1000000,
    partyId: 'T1', partyType: 'TRANSPORTER', partyName: 'Trans',
    orderId: 'O1', orderNumber: 'ROCK-2026-000001',
    method: 'UPI', reference: '', notes: '', status: 'ACTIVE', voidReason: null,
    createdBy: 'acc', updatedBy: 'acc',
    ...over,
  };
}

const as = (uid: keyof typeof USERS | 'stranger'): Firestore => env.authenticatedContext(uid).firestore() as unknown as Firestore;
const anon = (): Firestore => env.unauthenticatedContext().firestore() as unknown as Firestore;

async function seed(fn: (db: Firestore) => Promise<void>) {
  await env.withSecurityRulesDisabled(async (ctx) => fn(ctx.firestore() as unknown as Firestore));
}

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-rock', firestore: { rules } });
});
afterAll(async () => env?.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await seed(async (db) => {
    for (const [uid, role] of Object.entries(USERS)) await setDoc(doc(db, 'users', uid), { loginId: uid, displayName: uid, role, active: true });
    const party = (id: string, type: string, name: string, rates: Record<string, number>) =>
      setDoc(doc(db, 'parties', id), { type, code: 'BUY-0001', name, nameLower: name.toLowerCase(), phone: '', address: '', gstin: '', notes: '', active: true, rates, defaults: {}, createdBy: 'admin', updatedBy: 'admin' });
    await party('B1', 'BUYER', 'Buyer', { BUYER_RATE: 1250000, BUYER_GST: 500 });
    await party('S1', 'SELLER', 'Seller', { SELLER_RATE: 970000 });
    await party('A1', 'COMMISSION_AGENT', 'Agent', { COMMISSION_RATE: 72500 });
    await party('T1', 'TRANSPORTER', 'Trans', { FREIGHT_RATE: 85000 });
    await party('P1', 'PAYMENT_AGENT', 'PA', { PAYMENT_AGENT_RATE: 100000 });
  });
});

/** OPERATIONS user creates the reference order + counter atomically. */
async function createOrderAs(uid: keyof typeof USERS, over: Record<string, unknown> = {}) {
  const db = as(uid);
  const b = writeBatch(db);
  b.set(doc(db, 'counters', 'orders-2026'), { seq: 1, year: 2026 });
  b.set(doc(db, 'orders', 'O1'), { ...referenceOrder({ createdBy: uid, updatedBy: uid, ...over }), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  return b.commit();
}
async function seedOrder(over: Record<string, unknown> = {}) {
  await seed(async (db) => {
    await setDoc(doc(db, 'counters', 'orders-2026'), { seq: 1 });
    await setDoc(doc(db, 'orders', 'O1'), referenceOrder(over));
  });
}
/** ACCOUNTS records a payment and moves the order's paid total in one batch. */
function payBatch(db: Firestore, id: string, p: Record<string, unknown>, newPaid: Record<string, number>) {
  const b = writeBatch(db);
  b.set(doc(db, 'payments', id), { ...payment(p), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  b.update(doc(db, 'orders', 'O1'), { ...Object.fromEntries(Object.entries(newPaid).map(([k, v]) => [`paid.${k}`, v])), lastPaymentId: id, updatedBy: p.createdBy ?? 'acc', updatedAt: serverTimestamp() });
  return b.commit();
}

describe('access', () => {
  it('anonymous users can read nothing', async () => {
    await seedOrder();
    await assertFails(getDoc(doc(anon(), 'orders', 'O1')));
  });
  it('signed-in users without an active profile can read nothing', async () => {
    await seedOrder();
    await assertFails(getDoc(doc(as('stranger'), 'orders', 'O1')));
    await assertFails(setDoc(doc(as('stranger'), 'users', 'stranger'), { loginId: 'x', displayName: 'x', role: 'ADMIN', active: true }));
  });
  it('users cannot escalate their own role', async () => {
    await assertFails(updateDoc(doc(as('ops'), 'users', 'ops'), { role: 'ADMIN' }));
    await assertSucceeds(updateDoc(doc(as('ops'), 'users', 'ops'), { displayName: 'New name', updatedBy: 'ops' }));
  });
  it('userSecurity is private to its owner', async () => {
    const rec = { pinHash: 'x'.repeat(44), pinSalt: 'y'.repeat(24), pinIterations: 310000 };
    await assertSucceeds(setDoc(doc(as('ops'), 'userSecurity', 'ops'), rec));
    await assertFails(setDoc(doc(as('acc'), 'userSecurity', 'ops'), rec));
    await assertFails(getDoc(doc(as('admin'), 'userSecurity', 'ops')));
    await assertFails(setDoc(doc(as('ops'), 'userSecurity', 'ops'), { ...rec, pinIterations: 1 }));
  });
});

describe('orders: financial validation', () => {
  it('OPERATIONS can create the correct 38.52 MT order', async () => {
    await assertSucceeds(createOrderAs('ops'));
  });
  it('VIEW_ONLY cannot create orders', async () => {
    await assertFails(createOrderAs('view'));
  });
  it('rejects a wrong GST amount', async () => {
    await assertFails(createOrderAs('ops', { buyer: { ...referenceOrder().buyer, gstAmount: 2407501, grossAmount: 50557501 } }));
  });
  it('rejects a tampered payment-agent deduction or balance', async () => {
    const pa = referenceOrder().paymentAgent;
    await assertFails(createOrderAs('ops', { paymentAgent: { ...pa, deduction: 3000000, balance: 47557500 } }));
    await assertFails(createOrderAs('ops', { paymentAgent: { ...pa, balance: 46705501 } }));
    await assertFails(createOrderAs('ops', { paymentAgent: { ...pa, received: 50000000, balance: 46148000 } }));
  });
  it('rejects a seller amount that does not follow from qty × rate', async () => {
    await assertFails(createOrderAs('ops', { seller: { id: 'S1', name: 'Seller', ratePaise: 970000, amount: 37364401 } }));
  });
  it('rejects fractional paise and non-zero initial paid totals', async () => {
    await assertFails(createOrderAs('ops', { seller: { id: 'S1', name: 'Seller', ratePaise: 970000, amount: 37364400.5 } }));
    await assertFails(createOrderAs('ops', { paid: { buyer: 1, seller: 0, commission: 0, freight: 0, paymentAgent: 0 } }));
  });
  it('rejects a party of the wrong type or a fake name snapshot', async () => {
    await assertFails(createOrderAs('ops', { buyerId: 'S1', buyer: { ...referenceOrder().buyer, id: 'S1', name: 'Seller' } }));
    await assertFails(createOrderAs('ops', { buyer: { ...referenceOrder().buyer, name: 'Someone else' } }));
  });
  it('rejects order numbers not allocated by the counter in the same commit', async () => {
    const db = as('ops');
    await assertFails(setDoc(doc(db, 'orders', 'O1'), referenceOrder()));
  });
  it('rejects receipt image content in the order', async () => {
    await assertFails(createOrderAs('ops', { receipt: { ...referenceOrder().receipt, imageData: 'data:image/jpeg;base64,AAAA' } }));
    await assertFails(createOrderAs('ops', { receipt: { ...referenceOrder().receipt, image: { ...referenceOrder().receipt.image, ref: 'x'.repeat(50) } } }));
  });
  it('orders can never be deleted', async () => {
    await seedOrder();
    await assertFails(deleteDoc(doc(as('admin'), 'orders', 'O1')));
  });
  it('cancelled orders cannot become confirmed again', async () => {
    await seedOrder({ status: 'CANCELLED', cancelReason: 'Duplicate', version: 2 });
    await assertFails(updateDoc(doc(as('admin'), 'orders', 'O1'), { status: 'CONFIRMED', version: 3, updatedBy: 'admin' }));
  });
  it('only admins cancel, and only with nothing paid', async () => {
    await seedOrder();
    const cancel = { status: 'CANCELLED', cancelReason: 'Entered twice', version: 2 };
    await assertFails(updateDoc(doc(as('acc'), 'orders', 'O1'), { ...cancel, updatedBy: 'acc' }));
    await assertSucceeds(updateDoc(doc(as('admin'), 'orders', 'O1'), { ...cancel, updatedBy: 'admin' }));
  });
  it('corrections cannot change parties, numbers or paid totals', async () => {
    await seedOrder();
    await assertFails(updateDoc(doc(as('acc'), 'orders', 'O1'), { buyerId: 'B2', version: 2, updatedBy: 'acc' }));
    await assertFails(updateDoc(doc(as('acc'), 'orders', 'O1'), { orderNumber: 'ROCK-2026-000999', version: 2, updatedBy: 'acc' }));
  });
});

describe('payments ↔ paid totals', () => {
  beforeEach(async () => seedOrder());

  it('ACCOUNTS records a payment with the matching paid increment', async () => {
    await assertSucceeds(payBatch(as('acc'), 'PAY1', {}, { freight: 1000000 }));
  });
  it('OPERATIONS and VIEW_ONLY cannot record payments', async () => {
    await assertFails(payBatch(as('ops'), 'PAY1', { createdBy: 'ops', updatedBy: 'ops' }, { freight: 1000000 }));
    await assertFails(payBatch(as('view'), 'PAY1', { createdBy: 'view', updatedBy: 'view' }, { freight: 1000000 }));
  });
  it('a payment without the order update is rejected', async () => {
    await assertFails(setDoc(doc(as('acc'), 'payments', 'PAY1'), payment()));
  });
  it('an order paid change without a payment is rejected', async () => {
    await assertFails(updateDoc(doc(as('acc'), 'orders', 'O1'), { 'paid.freight': 1000000, updatedBy: 'acc' }));
    await assertFails(updateDoc(doc(as('acc'), 'orders', 'O1'), { 'paid.freight': 1000000, lastPaymentId: 'NOPE', updatedBy: 'acc' }));
  });
  it('the paid total must move by exactly the payment amount', async () => {
    await assertFails(payBatch(as('acc'), 'PAY1', {}, { freight: 2000000 }));
    await assertFails(payBatch(as('acc'), 'PAY1', {}, { freight: 1000000, buyer: 5 }));
  });
  it('the payment must be for the correct party in the correct role', async () => {
    await assertFails(payBatch(as('acc'), 'PAY1', { partyId: 'S1', partyType: 'SELLER', partyName: 'Seller' }, { freight: 1000000 }));
    await assertFails(payBatch(as('acc'), 'PAY1', { category: 'BUYER_RECEIPT', partyId: 'T1' }, { buyer: 1000000 }));
    await assertFails(payBatch(as('acc'), 'PAY1', { partyType: 'BUYER' }, { freight: 1000000 }));
  });
  it('each role maps to the right obligation, including the payment agent', async () => {
    await assertSucceeds(payBatch(as('acc'), 'PAY1', { category: 'PAYMENT_AGENT_SETTLEMENT', partyId: 'P1', partyType: 'PAYMENT_AGENT', partyName: 'PA', amount: 46705500 }, { paymentAgent: 46705500 }));
  });
  it('rejects overpayment beyond the obligation (PA balance ₹4,67,055)', async () => {
    await assertFails(payBatch(as('acc'), 'PAY1', { category: 'PAYMENT_AGENT_SETTLEMENT', partyId: 'P1', partyType: 'PAYMENT_AGENT', partyName: 'PA', amount: 46705501 }, { paymentAgent: 46705501 }));
    await assertFails(payBatch(as('acc'), 'PAY1', { amount: 3274201 }, { freight: 3274201 }));
  });
  it('rejects negative, zero and fractional amounts', async () => {
    await assertFails(payBatch(as('acc'), 'PAY1', { amount: -100 }, { freight: -100 }));
    await assertFails(payBatch(as('acc'), 'PAY1', { amount: 0 }, { freight: 0 }));
    await assertFails(payBatch(as('acc'), 'PAY1', { amount: 100.5 }, { freight: 100.5 }));
  });
  it('the same payment cannot be counted twice', async () => {
    await assertSucceeds(payBatch(as('acc'), 'PAY1', {}, { freight: 1000000 }));
    await assertFails(payBatch(as('acc'), 'PAY1', {}, { freight: 2000000 }));
  });
  it('voiding reverses the exact amount once; payments are never edited or deleted', async () => {
    await assertSucceeds(payBatch(as('acc'), 'PAY1', {}, { freight: 1000000 }));
    const db = as('acc');
    const voidBatch = (paid: number) => {
      const b = writeBatch(db);
      b.update(doc(db, 'payments', 'PAY1'), { status: 'VOID', voidReason: 'Entered in error', updatedBy: 'acc' });
      b.update(doc(db, 'orders', 'O1'), { 'paid.freight': paid, lastPaymentId: 'PAY1', updatedBy: 'acc' });
      return b.commit();
    };
    await assertFails(voidBatch(500000));
    await assertSucceeds(voidBatch(0));
    await assertFails(voidBatch(-1000000));
    await assertFails(updateDoc(doc(db, 'payments', 'PAY1'), { amount: 1, updatedBy: 'acc' }));
    await assertFails(deleteDoc(doc(as('admin'), 'payments', 'PAY1')));
  });
  it('payment relationship fields cannot be rewritten', async () => {
    await assertSucceeds(payBatch(as('acc'), 'PAY1', {}, { freight: 1000000 }));
    await assertFails(updateDoc(doc(as('acc'), 'payments', 'PAY1'), { partyId: 'S1', updatedBy: 'acc' }));
    await assertFails(updateDoc(doc(as('acc'), 'payments', 'PAY1'), { orderId: 'O2', updatedBy: 'acc' }));
  });
  it('on-account payments must name a party of the matching type', async () => {
    const db = as('acc');
    const p = { ...payment({ orderId: null, orderNumber: null }), createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
    await assertSucceeds(setDoc(doc(db, 'payments', 'PAY2'), p));
    await assertFails(setDoc(doc(db, 'payments', 'PAY3'), { ...p, partyId: 'B1' }));
  });
});

describe('parties and rate history', () => {
  it('VIEW_ONLY cannot write parties', async () => {
    await assertFails(updateDoc(doc(as('view'), 'parties', 'S1'), { name: 'X', updatedBy: 'view' }));
  });
  it('party type and code are immutable', async () => {
    await assertFails(updateDoc(doc(as('acc'), 'parties', 'S1'), { type: 'BUYER', updatedBy: 'acc' }));
    await assertFails(updateDoc(doc(as('acc'), 'parties', 'S1'), { code: 'SEL-9999', updatedBy: 'acc' }));
  });
  it('a default rate cannot change without a new history entry', async () => {
    await assertFails(updateDoc(doc(as('ops'), 'parties', 'S1'), { 'rates.SELLER_RATE': 1000000, updatedBy: 'ops' }));
  });
  it('a default rate change with a genuine history entry is accepted', async () => {
    const db = as('ops');
    const b = writeBatch(db);
    b.update(doc(db, 'parties', 'S1'), { 'rates.SELLER_RATE': 1000000, lastRateChangeId: 'H1', updatedBy: 'ops' });
    b.set(doc(db, 'rateHistory', 'H1'), {
      partyId: 'S1', partyType: 'SELLER', rateType: 'SELLER_RATE', oldRate: 970000, newRate: 1000000,
      effectiveFrom: '2026-10-04', changedBy: 'ops', sourceOrderId: null, sourceOrderNumber: null, reason: '', createdAt: serverTimestamp(),
    });
    await assertSucceeds(b.commit());
  });
  it('a history entry with a fake old rate is rejected', async () => {
    const db = as('ops');
    const b = writeBatch(db);
    b.update(doc(db, 'parties', 'S1'), { 'rates.SELLER_RATE': 1000000, lastRateChangeId: 'H1', updatedBy: 'ops' });
    b.set(doc(db, 'rateHistory', 'H1'), {
      partyId: 'S1', partyType: 'SELLER', rateType: 'SELLER_RATE', oldRate: 123, newRate: 1000000,
      effectiveFrom: '2026-10-04', changedBy: 'ops', sourceOrderId: null, sourceOrderNumber: null, reason: '', createdAt: serverTimestamp(),
    });
    await assertFails(b.commit());
  });
  it('rate history cannot be edited or deleted, even by admins', async () => {
    await seed(async (db) => setDoc(doc(db, 'rateHistory', 'H0'), { partyId: 'S1', newRate: 970000 }));
    await assertFails(updateDoc(doc(as('admin'), 'rateHistory', 'H0'), { newRate: 1 }));
    await assertFails(deleteDoc(doc(as('admin'), 'rateHistory', 'H0')));
  });
  it('changing a master rate does not touch existing orders', async () => {
    await seedOrder();
    const db = as('ops');
    const b = writeBatch(db);
    b.update(doc(db, 'parties', 'P1'), { 'rates.PAYMENT_AGENT_RATE': 105000, lastRateChangeId: 'H2', updatedBy: 'ops' });
    b.set(doc(db, 'rateHistory', 'H2'), {
      partyId: 'P1', partyType: 'PAYMENT_AGENT', rateType: 'PAYMENT_AGENT_RATE', oldRate: 100000, newRate: 105000,
      effectiveFrom: '2026-10-05', changedBy: 'ops', sourceOrderId: null, sourceOrderNumber: null, reason: '', createdAt: serverTimestamp(),
    });
    await assertSucceeds(b.commit());
    const snap = await getDoc(doc(as('view'), 'orders', 'O1'));
    const pa = snap.data()?.paymentAgent as { ratePaise: number; deduction: number; balance: number };
    if (pa.ratePaise !== 100000 || pa.deduction !== 3852000 || pa.balance !== 46705500) throw new Error('order snapshot changed');
  });
});

describe('rollups and audit log', () => {
  it('OPERATIONS cannot change payment totals in statistics', async () => {
    await assertFails(setDoc(doc(as('ops'), 'rollups', 'M-2026-10'), { kind: 'M', key: '2026-10', totals: { paid: { BUYER_RECEIPT: 999 } } }, { merge: true }));
    await assertSucceeds(setDoc(doc(as('ops'), 'rollups', 'M-2026-10'), { kind: 'M', key: '2026-10', totals: { orders: 1 } }, { merge: true }));
  });
  it('VIEW_ONLY cannot write statistics or audit entries', async () => {
    await assertFails(setDoc(doc(as('view'), 'rollups', 'M-2026-10'), { kind: 'M', key: '2026-10', totals: { orders: 1 } }));
    await assertFails(setDoc(doc(as('view'), 'auditLogs', 'L1'), { entityType: 'order', entityId: 'O1', action: 'X', summary: 'x', changes: null, reason: null, actorId: 'view' }));
  });
  it('audit entries are append-only and attributed to the caller', async () => {
    await assertFails(setDoc(doc(as('ops'), 'auditLogs', 'L1'), { entityType: 'order', entityId: 'O1', action: 'X', summary: 'x', changes: null, reason: null, actorId: 'admin' }));
    await assertSucceeds(setDoc(doc(as('ops'), 'auditLogs', 'L2'), { entityType: 'order', entityId: 'O1', action: 'X', summary: 'x', changes: null, reason: null, actorId: 'ops' }));
    await assertFails(updateDoc(doc(as('admin'), 'auditLogs', 'L2'), { summary: 'y' }));
    await assertFails(deleteDoc(doc(as('admin'), 'auditLogs', 'L2')));
  });
});
