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
      ai: { status: 'SKIPPED', model: '', raw: '', error: '' },
    },
    buyer: { id: 'B1', name: 'Buyer', ratePaise: 1250000, gstBp: 500, baseAmount: 48150000, gstAmount: 2407500, grossAmount: 50557500 },
    seller: { id: 'S1', name: 'Seller', ratePaise: 970000, amount: 37364400 },
    commission: { id: 'A1', name: 'Agent', ratePaise: 72500, amount: 2792700 },
    freight: { id: 'T1', name: 'Trans', ratePaise: 85000, amount: 3274200, destination: 'Pune' },
    // Payment agent commission: payable we owe the agent = 38.52 × ₹1,000 = ₹38,520
    paymentAgent: { id: 'P1', name: 'PA', ratePaise: 100000, amount: 3852000 },
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
  it('rejects a tampered payment-agent commission', async () => {
    const pa = referenceOrder().paymentAgent;
    await assertFails(createOrderAs('ops', { paymentAgent: { ...pa, amount: 3852001 } }));
    await assertFails(createOrderAs('ops', { paymentAgent: { ...pa, amount: 3000000 } }));
    await assertFails(createOrderAs('ops', { paymentAgent: { ...pa, amount: 3852000.5 } }));
    await assertFails(createOrderAs('ops', { paymentAgent: { ...pa, ratePaise: 105000 } }));
  });
  it('rejects obsolete payment-agent fields (buyer money routed through the agent)', async () => {
    const pa = referenceOrder().paymentAgent;
    await assertFails(createOrderAs('ops', { paymentAgent: { ...pa, received: 50557500, balance: 46705500 } }));
    await assertFails(createOrderAs('ops', { paymentAgent: { id: 'P1', name: 'PA', ratePaise: 100000, received: 50557500, deduction: 3852000, balance: 46705500 } }));
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
  it('rejects non-string or oversized receipt text, and null where the app writes text', async () => {
    const r = referenceOrder().receipt;
    await assertFails(createOrderAs('ops', { receipt: { ...r, driverName: 'x'.repeat(800) } }));
    await assertFails(createOrderAs('ops', { receipt: { ...r, driverName: { nested: 'data' } } }));
    await assertFails(createOrderAs('ops', { receipt: { ...r, ai: { ...r.ai, raw: 'x'.repeat(9000) } } }));
    await assertFails(createOrderAs('ops', { receipt: { ...r, image: { ...r.image, provider: 'FIREBASE_STORAGE', ref: 'receipts/x.jpg' } } }));
  });
  it('accepts a payment-agent commission independent of the buyer amount (it is a payable)', async () => {
    // 38.52 × ₹14,000 = ₹5,39,280 commission: valid even though it exceeds the buyer gross
    await assertSucceeds(createOrderAs('ops', { paymentAgent: { id: 'P1', name: 'PA', ratePaise: 1400000, amount: 53928000 } }));
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
    // We pay the payment agent ₹10,000 of its ₹38,520 commission
    await assertSucceeds(payBatch(as('acc'), 'PAY1', { category: 'PAYMENT_AGENT_SETTLEMENT', partyId: 'P1', partyType: 'PAYMENT_AGENT', partyName: 'PA', amount: 1000000 }, { paymentAgent: 1000000 }));
  });
  it('rejects overpayment beyond the obligation (payment agent commission ₹38,520)', async () => {
    await assertFails(payBatch(as('acc'), 'PAY1', { category: 'PAYMENT_AGENT_SETTLEMENT', partyId: 'P1', partyType: 'PAYMENT_AGENT', partyName: 'PA', amount: 3852001 }, { paymentAgent: 3852001 }));
    await assertSucceeds(payBatch(as('acc'), 'PAY1', { category: 'PAYMENT_AGENT_SETTLEMENT', partyId: 'P1', partyType: 'PAYMENT_AGENT', partyName: 'PA', amount: 3852000 }, { paymentAgent: 3852000 }));
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
    const pa = snap.data()?.paymentAgent as { ratePaise: number; amount: number };
    if (pa.ratePaise !== 100000 || pa.amount !== 3852000) throw new Error('order snapshot changed');
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

describe('full application commits stay within Firestore rules limits', () => {
  // These replay the complete multi-document writes the app performs, because
  // Firestore's limits (1,000 expressions; 20 document lookups) apply per request.

  it('order + counter + new default rate + rate history + statistics + audit (as OPERATIONS)', async () => {
    // Transporter's saved default is ₹800/MT; this order uses ₹850 and makes it the new default.
    await seed(async (db) => updateDoc(doc(db, 'parties', 'T1'), { 'rates.FREIGHT_RATE': 80000 }));
    const db = as('ops');
    const b = writeBatch(db);
    b.set(doc(db, 'counters', 'orders-2026'), { seq: 1, year: 2026, updatedAt: serverTimestamp() });
    b.set(doc(db, 'orders', 'O1'), {
      ...referenceOrder({
        rateDecisions: [{ rateType: 'FREIGHT_RATE', partyId: 'T1', defaultValue: 80000, value: 85000, decision: 'NEW_DEFAULT' }],
      }),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    b.update(doc(db, 'parties', 'T1'), { 'rates.FREIGHT_RATE': 85000, lastRateChangeId: 'H1', updatedBy: 'ops', updatedAt: serverTimestamp() });
    b.set(doc(db, 'rateHistory', 'H1'), {
      partyId: 'T1', partyType: 'TRANSPORTER', rateType: 'FREIGHT_RATE', oldRate: 80000, newRate: 85000,
      effectiveFrom: '2026-10-03', changedBy: 'ops', sourceOrderId: 'O1', sourceOrderNumber: 'ROCK-2026-000001',
      reason: 'Set as new default on order ROCK-2026-000001', createdAt: serverTimestamp(),
    });
    const stats = {
      totals: { orders: 1, qtyKg: 38520, buyerBase: 48150000, gst: 2407500, buyerGross: 50557500, seller: 37364400, commission: 2792700, freight: 3274200, paCharge: 3852000 },
      parties: { BUYER: { B1: { n: 1, qtyKg: 38520, amount: 50557500, base: 48150000, gst: 2407500 } }, TRANSPORTER: { T1: { n: 1, qtyKg: 38520, amount: 3274200 } } },
      updatedAt: serverTimestamp(),
    };
    b.set(doc(db, 'rollups', 'D-2026-10-03'), { kind: 'D', key: '2026-10-03', ...stats }, { merge: true });
    b.set(doc(db, 'rollups', 'M-2026-10'), { kind: 'M', key: '2026-10', ...stats }, { merge: true });
    b.set(doc(db, 'auditLogs', 'L1'), { entityType: 'order', entityId: 'O1', action: 'CREATE', summary: 'Created ROCK-2026-000001: Buyer ← Seller', changes: null, reason: null, actorId: 'ops', at: serverTimestamp() });
    await assertSucceeds(b.commit());

    const saved = (await getDoc(doc(as('view'), 'orders', 'O1'))).data() as ReturnType<typeof referenceOrder>;
    const expect = (label: string, got: number, want: number) => {
      if (got !== want) throw new Error(`${label}: got ${got}, want ${want}`);
    };
    expect('buyer base', saved.buyer.baseAmount, 48150000);
    expect('GST', saved.buyer.gstAmount, 2407500);
    expect('buyer gross', saved.buyer.grossAmount, 50557500);
    expect('seller', saved.seller.amount, 37364400);
    expect('commission', saved.commission.amount, 2792700);
    expect('freight', saved.freight.amount, 3274200);
    expect('PA commission payable', saved.paymentAgent.amount, 3852000);
    if ('received' in saved.paymentAgent || 'balance' in saved.paymentAgent) throw new Error('obsolete payment-agent fields saved');
  });

  it('payment + order paid total + statistics + audit (as ACCOUNTS)', async () => {
    await seedOrder();
    const db = as('acc');
    const b = writeBatch(db);
    b.set(doc(db, 'payments', 'PAY1'), { ...payment(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    b.update(doc(db, 'orders', 'O1'), { 'paid.freight': 1000000, lastPaymentId: 'PAY1', updatedBy: 'acc', updatedAt: serverTimestamp() });
    const stats = { totals: { paid: { TRANSPORTER_PAYMENT: 1000000 } }, parties: { TRANSPORTER: { T1: { paid: 1000000 } } }, updatedAt: serverTimestamp() };
    b.set(doc(db, 'rollups', 'D-2026-10-04'), { kind: 'D', key: '2026-10-04', ...stats }, { merge: true });
    b.set(doc(db, 'rollups', 'M-2026-10'), { kind: 'M', key: '2026-10', ...stats }, { merge: true });
    b.set(doc(db, 'auditLogs', 'L2'), { entityType: 'payment', entityId: 'PAY1', action: 'CREATE', summary: 'Transporter payment ₹10,000 — Trans (ROCK-2026-000001)', changes: null, reason: null, actorId: 'acc', at: serverTimestamp() });
    await assertSucceeds(b.commit());
  });

  it('audited correction of a paid order stays valid (as ACCOUNTS)', async () => {
    await seedOrder({ paid: { buyer: 0, seller: 0, commission: 0, freight: 1000000, paymentAgent: 0 }, lastPaymentId: 'PAY0' });
    const o = referenceOrder();
    await assertSucceeds(updateDoc(doc(as('acc'), 'orders', 'O1'), {
      'receipt.driverName': 'Corrected Driver', notes: 'Name corrected', version: 2, updatedBy: 'acc',
    }));
    // A correction that drops freight below the ₹10,000 already paid is rejected.
    await assertFails(updateDoc(doc(as('acc'), 'orders', 'O1'), {
      freight: { ...o.freight, ratePaise: 0, amount: 0 }, version: 3, updatedBy: 'acc',
    }));
  });
});

describe('payment agent: payable model', () => {
  beforeEach(async () => seedOrder());
  const paPayment = (amount: number) => ({ category: 'PAYMENT_AGENT_SETTLEMENT', partyId: 'P1', partyType: 'PAYMENT_AGENT', partyName: 'PA', amount });

  it('₹38,520 owed → pay ₹10,000 (₹28,520 left) → void restores ₹38,520', async () => {
    const db = as('acc');
    await assertSucceeds(payBatch(db, 'PA1', paPayment(1000000), { paymentAgent: 1000000 }));
    const paid = ((await getDoc(doc(db, 'orders', 'O1'))).data() as { paid: { paymentAgent: number } }).paid.paymentAgent;
    if (3852000 - paid !== 2852000) throw new Error(`outstanding should be ₹28,520, got ${(3852000 - paid) / 100}`);
    const b = writeBatch(db);
    b.update(doc(db, 'payments', 'PA1'), { status: 'VOID', voidReason: 'Entered in error', updatedBy: 'acc' });
    b.update(doc(db, 'orders', 'O1'), { 'paid.paymentAgent': 0, lastPaymentId: 'PA1', updatedBy: 'acc' });
    await assertSucceeds(b.commit());
  });
  it('multiple part payments up to exactly ₹38,520, then nothing more', async () => {
    const db = as('acc');
    await assertSucceeds(payBatch(db, 'PA1', paPayment(1000000), { paymentAgent: 1000000 }));
    await assertSucceeds(payBatch(db, 'PA2', paPayment(2852000), { paymentAgent: 3852000 }));
    await assertFails(payBatch(db, 'PA3', paPayment(1), { paymentAgent: 3852001 }));
  });
  it('a payment-agent payment cannot move the buyer total or claim another party', async () => {
    const db = as('acc');
    await assertFails(payBatch(db, 'PA1', paPayment(1000000), { buyer: 1000000 }));
    await assertFails(payBatch(db, 'PA1', { ...paPayment(1000000), partyId: 'B1', partyType: 'BUYER' }, { paymentAgent: 1000000 }));
  });
  it('a correction cannot cut the commission below what was already paid to the agent', async () => {
    await seedOrder({ paid: { buyer: 0, seller: 0, commission: 0, freight: 0, paymentAgent: 1000000 }, lastPaymentId: 'PAY0' });
    await assertFails(updateDoc(doc(as('acc'), 'orders', 'O1'), { paymentAgent: { id: 'P1', name: 'PA', ratePaise: 0, amount: 0 }, version: 2, updatedBy: 'acc' }));
  });
});

describe('payment agent: orders saved under the obsolete model', () => {
  const legacyPa = { id: 'P1', name: 'PA', ratePaise: 100000, received: 50557500, deduction: 3852000, balance: 46705500 };

  it('payments against a legacy order are capped at its commission (old `deduction`)', async () => {
    await seedOrder({ paymentAgent: legacyPa });
    const db = as('acc');
    const p = { category: 'PAYMENT_AGENT_SETTLEMENT', partyId: 'P1', partyType: 'PAYMENT_AGENT', partyName: 'PA' };
    await assertFails(payBatch(db, 'PA1', { ...p, amount: 3852001 }, { paymentAgent: 3852001 }));
    await assertSucceeds(payBatch(db, 'PA1', { ...p, amount: 1000000 }, { paymentAgent: 1000000 }));
  });
  it('the upgrade (audited correction) to the current shape is accepted; a wrong amount is not', async () => {
    await seedOrder({ paymentAgent: legacyPa });
    const db = as('admin');
    await assertFails(updateDoc(doc(db, 'orders', 'O1'), { paymentAgent: { id: 'P1', name: 'PA', ratePaise: 100000, amount: 3852001 }, version: 2, updatedBy: 'admin' }));
    await assertSucceeds(updateDoc(doc(db, 'orders', 'O1'), { paymentAgent: { id: 'P1', name: 'PA', ratePaise: 100000, amount: 3852000 }, version: 2, updatedBy: 'admin' }));
  });
});

describe('statistics rebuild stays within Firestore rules limits', () => {
  it('admin rebuild batch: 10 full statistics documents (replace) + audit', async () => {
    const db = as('admin');
    const b = writeBatch(db);
    for (let d = 1; d <= 10; d++) {
      const key = `2026-10-${String(d).padStart(2, '0')}`;
      b.set(doc(db, 'rollups', `D-${key}`), {
        kind: 'D', key,
        totals: { orders: 1, qtyKg: 38520, buyerBase: 48150000, gst: 2407500, buyerGross: 50557500, seller: 37364400, commission: 2792700, freight: 3274200, paCharge: 3852000, paid: { PAYMENT_AGENT_SETTLEMENT: 1000000, BUYER_RECEIPT: 0 } },
        parties: { PAYMENT_AGENT: { P1: { n: 1, qtyKg: 38520, amount: 3852000, paid: 1000000, base: 0, gst: 0 } }, BUYER: { B1: { n: 1, qtyKg: 38520, amount: 50557500, paid: 0, base: 48150000, gst: 2407500 } } },
        updatedAt: serverTimestamp(),
      });
    }
    b.set(doc(db, 'auditLogs', 'RB1'), { entityType: 'system', entityId: 'rollups', action: 'REBUILD', summary: 'Rebuilt statistics', changes: null, reason: null, actorId: 'admin', at: serverTimestamp() });
    await assertSucceeds(b.commit());
  });
  it('admin can delete obsolete statistics documents in a rebuild; others cannot', async () => {
    await seed(async (db) => setDoc(doc(db, 'rollups', 'M-2026-09'), { kind: 'M', key: '2026-09', totals: { paBalance: 1 } }));
    await assertFails(deleteDoc(doc(as('acc'), 'rollups', 'M-2026-09')));
    const db = as('admin');
    const b = writeBatch(db);
    b.delete(doc(db, 'rollups', 'M-2026-09'));
    await assertSucceeds(b.commit());
  });
});
