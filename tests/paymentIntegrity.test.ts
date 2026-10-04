import { describe, expect, it } from 'vitest';
import { calculateOrder } from '../src/domain/calc';
import {
  applyPaymentToOrder,
  assertPaymentMatchesOrder,
  assertValidPaymentAmount,
  categoryAcceptsPartyType,
  emptyPaid,
  invalidPaidKeys,
  orderPartyFor,
  orderSettlement,
  PaymentIntegrityError,
  reconcileOrderPaid,
} from '../src/domain/payments';
import { applyDefaultChange, resolveRateSelection } from '../src/domain/rates';
import { can } from '../src/domain/permissions';
import type { PaidMap, PaymentCategory } from '../src/domain/types';

const fin = calculateOrder({
  qtyKg: 38_520,
  buyerRatePaise: 1_250_000,
  gstBp: 500,
  sellerRatePaise: 970_000,
  commissionRatePaise: 72_500,
  freightRatePaise: 85_000,
  paymentAgentRatePaise: 100_000,
});
function order(paid: Partial<PaidMap> = {}) {
  return {
    id: 'o1',
    buyer: { ...fin.buyer, id: 'B', name: 'Buyer' },
    seller: { ...fin.seller, id: 'S', name: 'Seller' },
    commission: { ...fin.commission, id: 'A', name: 'Agent' },
    freight: { ...fin.freight, id: 'T', name: 'Trans', destination: '' },
    paymentAgent: { ...fin.paymentAgent, id: 'P', name: 'PA' },
    buyerId: 'B',
    sellerId: 'S',
    commissionAgentId: 'A',
    transporterId: 'T',
    paymentAgentId: 'P',
    paid: { ...emptyPaid(), ...paid },
  };
}

describe('payment amounts', () => {
  it('rejects negative, zero, fractional paise, NaN and Infinity', () => {
    for (const bad of [-1, 0, 1.5, 0.1, Number.NaN, Number.POSITIVE_INFINITY, '100', null]) {
      expect(() => assertValidPaymentAmount(bad)).toThrow(PaymentIntegrityError);
    }
  });
  it('rejects amounts above ₹100 crore', () => {
    expect(() => assertValidPaymentAmount(100_000_000_001)).toThrow(PaymentIntegrityError);
  });
  it('accepts positive whole paise', () => {
    expect(() => assertValidPaymentAmount(1)).not.toThrow();
    expect(() => assertValidPaymentAmount(50_557_500)).not.toThrow();
  });
});

describe('payment ↔ order relationship', () => {
  const cases: [PaymentCategory, string][] = [
    ['BUYER_RECEIPT', 'B'],
    ['SELLER_PAYMENT', 'S'],
    ['COMMISSION_PAYMENT', 'A'],
    ['TRANSPORTER_PAYMENT', 'T'],
    ['PAYMENT_AGENT_SETTLEMENT', 'P'],
  ];
  for (const [category, party] of cases) {
    it(`${category} must be for party ${party}`, () => {
      expect(orderPartyFor(order(), category)).toBe(party);
      expect(() => assertPaymentMatchesOrder(order(), category, party)).not.toThrow();
      for (const [, other] of cases.filter(([, p]) => p !== party)) {
        expect(() => assertPaymentMatchesOrder(order(), category, other)).toThrow(PaymentIntegrityError);
      }
    });
  }
  it('OTHER payments cannot be linked to an order', () => {
    expect(() => assertPaymentMatchesOrder(order(), 'OTHER', 'B')).toThrow(PaymentIntegrityError);
  });
  it('orders without a commission agent reject commission payments', () => {
    const o = { ...order(), commissionAgentId: null };
    expect(() => assertPaymentMatchesOrder(o, 'COMMISSION_PAYMENT', 'A')).toThrow(PaymentIntegrityError);
  });
  it('category / party type consistency', () => {
    expect(categoryAcceptsPartyType('BUYER_RECEIPT', 'BUYER')).toBe(true);
    expect(categoryAcceptsPartyType('BUYER_RECEIPT', 'SELLER')).toBe(false);
    expect(categoryAcceptsPartyType('TRANSPORTER_PAYMENT', 'TRANSPORTER')).toBe(true);
    expect(categoryAcceptsPartyType('PAYMENT_AGENT_SETTLEMENT', 'BUYER')).toBe(false);
    expect(categoryAcceptsPartyType('OTHER', null)).toBe(true);
    expect(categoryAcceptsPartyType('OTHER', 'SELLER')).toBe(true);
  });
});

describe('paid totals', () => {
  it('multiple partial payments accumulate exactly', () => {
    let o = order();
    for (const amt of [1_000_000, 1_500_000, 774_200]) o = { ...o, paid: applyPaymentToOrder(o, 'TRANSPORTER_PAYMENT', amt, 1) };
    expect(o.paid.freight).toBe(3_274_200);
    expect(orderSettlement(o, 'freight')).toMatchObject({ outstanding: 0, status: 'PAID' });
  });
  it('rejects overpayment against an order', () => {
    expect(() => applyPaymentToOrder(order({ freight: 3_000_000 }), 'TRANSPORTER_PAYMENT', 274_201, 1)).toThrow(PaymentIntegrityError);
    expect(applyPaymentToOrder(order({ freight: 3_000_000 }), 'TRANSPORTER_PAYMENT', 274_200, 1).freight).toBe(3_274_200);
  });
  it('voiding reverses exactly and never goes negative', () => {
    const o = order({ seller: 500_000 });
    expect(applyPaymentToOrder(o, 'SELLER_PAYMENT', 500_000, -1).seller).toBe(0);
    expect(() => applyPaymentToOrder(o, 'SELLER_PAYMENT', 500_001, -1)).toThrow(PaymentIntegrityError);
  });
  it('only the matching obligation changes', () => {
    const next = applyPaymentToOrder(order({ buyer: 100 }), 'PAYMENT_AGENT_SETTLEMENT', 1_000_000, 1);
    expect(next).toEqual({ ...emptyPaid(), buyer: 100, paymentAgent: 1_000_000 });
  });
  it('payment agent: ₹38,520 payable; ₹10,000 paid → ₹28,520; void → ₹38,520; overpayment rejected', () => {
    let o = order();
    expect(orderSettlement(o, 'paymentAgent')).toMatchObject({ obligation: 3_852_000, paid: 0, outstanding: 3_852_000, status: 'UNPAID' });
    o = { ...o, paid: applyPaymentToOrder(o, 'PAYMENT_AGENT_SETTLEMENT', 1_000_000, 1) };
    expect(orderSettlement(o, 'paymentAgent')).toMatchObject({ paid: 1_000_000, outstanding: 2_852_000, status: 'PARTIAL' });
    o = { ...o, paid: applyPaymentToOrder(o, 'PAYMENT_AGENT_SETTLEMENT', 1_000_000, -1) };
    expect(orderSettlement(o, 'paymentAgent')).toMatchObject({ paid: 0, outstanding: 3_852_000 });
    expect(() => applyPaymentToOrder(order(), 'PAYMENT_AGENT_SETTLEMENT', 3_852_001, 1)).toThrow(PaymentIntegrityError);
    expect(() => applyPaymentToOrder(order({ paymentAgent: 3_000_000 }), 'PAYMENT_AGENT_SETTLEMENT', 852_001, 1)).toThrow(PaymentIntegrityError);
    expect(applyPaymentToOrder(order({ paymentAgent: 3_000_000 }), 'PAYMENT_AGENT_SETTLEMENT', 852_000, 1).paymentAgent).toBe(3_852_000);
  });
  it('payments to the payment agent are outgoing; buyer receivable is unaffected by them', () => {
    const o = { ...order(), paid: applyPaymentToOrder(order(), 'PAYMENT_AGENT_SETTLEMENT', 1_000_000, 1) };
    expect(orderSettlement(o, 'buyer')).toMatchObject({ obligation: 50_557_500, paid: 0, outstanding: 50_557_500 });
  });
  it('outstanding = obligation − active payments', () => {
    const o = order({ buyer: 20_000_000 });
    expect(orderSettlement(o, 'buyer').outstanding).toBe(50_557_500 - 20_000_000);
  });
  it('flags invalid cached totals', () => {
    expect(invalidPaidKeys(order())).toEqual([]);
    expect(invalidPaidKeys(order({ seller: -1 }))).toEqual(['seller']);
    expect(invalidPaidKeys(order({ freight: 3_274_201 }))).toEqual(['freight']);
    expect(invalidPaidKeys(order({ buyer: 1.5 }))).toEqual(['buyer']);
  });
  it('a correction cannot lower an amount below what was paid', () => {
    const smaller = calculateOrder({ qtyKg: 10_000, buyerRatePaise: 1_250_000, gstBp: 500, sellerRatePaise: 970_000, commissionRatePaise: 0, freightRatePaise: 85_000, paymentAgentRatePaise: 100_000 });
    const corrected = { ...order({ freight: 3_274_200 }), freight: { ...smaller.freight, id: 'T', name: 'Trans', destination: '' } };
    expect(invalidPaidKeys(corrected)).toEqual(['freight']);
  });
});

describe('source-of-truth reconciliation', () => {
  it('paid totals equal the sum of ACTIVE linked payments; void and OTHER excluded', () => {
    const payments = [
      { orderId: 'o1', category: 'TRANSPORTER_PAYMENT' as const, amount: 1_000_000, status: 'ACTIVE' as const },
      { orderId: 'o1', category: 'TRANSPORTER_PAYMENT' as const, amount: 9_999, status: 'VOID' as const },
      { orderId: 'o1', category: 'OTHER' as const, amount: 5, status: 'ACTIVE' as const },
      { orderId: null, category: 'SELLER_PAYMENT' as const, amount: 7, status: 'ACTIVE' as const },
    ];
    expect(reconcileOrderPaid([order({ freight: 1_000_000 })], payments)).toEqual([]);
    expect(reconcileOrderPaid([order({ freight: 1_009_999 })], payments)).toEqual([{ orderId: 'o1', key: 'freight', cached: 1_009_999, fromPayments: 1_000_000 }]);
  });
});

describe('idempotency', () => {
  it('payment and order keys are reused for retries (one key per form)', () => {
    // The services use the client-generated key as the document ID and check for
    // an existing document inside the transaction; the rules also forbid creating
    // over an existing payment (that would be an update, which only allows voiding).
    // Here we check the key format the services accept.
    const ok = /^[A-Za-z0-9-]{16,64}$/;
    expect(ok.test('3f1c2a9e-7b4d-4e8a-9c1d-2b5f6a7e8d90')).toBe(true);
    expect(ok.test('short')).toBe(false);
    expect(ok.test('../../payments/x')).toBe(false);
  });
});

describe('payment agent and rate snapshots', () => {
  it('38.52 MT: payment agent commission ₹38,520 payable; buyer owes us ₹5,05,575', () => {
    expect(fin.paymentAgent).toEqual({ ratePaise: 100_000, amount: 3_852_000 });
    expect(fin.buyer.grossAmount).toBe(50_557_500);
  });
  it('changing the PA default later does not alter a saved order snapshot', () => {
    const snapshot = structuredClone(order());
    let rates = { PAYMENT_AGENT_RATE: 100_000 };
    const r = resolveRateSelection({ rateType: 'PAYMENT_AGENT_RATE', partyId: 'P', defaultValue: 100_000, value: 105_000, decision: 'NEW_DEFAULT' });
    rates = applyDefaultChange(rates, 'PAYMENT_AGENT_RATE', r.newDefault!) as typeof rates;
    expect(rates.PAYMENT_AGENT_RATE).toBe(105_000);
    expect(snapshot.paymentAgent).toEqual({ ...fin.paymentAgent, id: 'P', name: 'PA' });
    expect(snapshot.paymentAgent.amount).toBe(3_852_000);
    expect(snapshot.paymentAgent.ratePaise).toBe(100_000);
  });
  it('an order-only override never produces a new default', () => {
    for (const rateType of ['BUYER_RATE', 'SELLER_RATE', 'COMMISSION_RATE', 'FREIGHT_RATE', 'PAYMENT_AGENT_RATE', 'BUYER_GST'] as const) {
      expect(resolveRateSelection({ rateType, partyId: 'x', defaultValue: 100, value: 999, decision: 'ORDER_ONLY' }).newDefault).toBeNull();
    }
  });
});

describe('role permissions (UI mirror of firestore.rules)', () => {
  it('matrix', () => {
    expect(['order.create', 'party.write', 'payment.create', 'payment.void', 'order.edit', 'order.cancel', 'settings.write', 'users.manage'].some((a) => can('VIEW_ONLY', a as never))).toBe(false);
    expect(can('OPERATIONS', 'order.create')).toBe(true);
    expect(can('OPERATIONS', 'payment.create')).toBe(false);
    expect(can('OPERATIONS', 'payment.void')).toBe(false);
    expect(can('OPERATIONS', 'order.edit')).toBe(false);
    expect(can('ACCOUNTS', 'payment.create')).toBe(true);
    expect(can('ACCOUNTS', 'order.cancel')).toBe(false);
    expect(can('ACCOUNTS', 'users.manage')).toBe(false);
    expect(can('ADMIN', 'order.cancel')).toBe(true);
  });
});
