import { describe, expect, it } from 'vitest';
import { calculateOrder } from '../src/domain/calc';
import {
  breakdown,
  combineDeltas,
  flattenDelta,
  orderContribution,
  outstandingSummary,
  partySummary,
  paymentContribution,
  planRollupKeys,
  sumRollups,
  emptyRollup,
  mergeInto,
} from '../src/domain/rollups';

function order(date: string, qtyKg = 38_520, overrides: { sellerId?: string } = {}) {
  const f = calculateOrder({
    qtyKg,
    buyerRatePaise: 1_250_000,
    gstBp: 500,
    sellerRatePaise: 970_000,
    commissionRatePaise: 72_500,
    freightRatePaise: 85_000,
    paymentAgentRatePaise: 100_000,
  });
  return {
    dispatchDate: date,
    qtyKg,
    buyer: { ...f.buyer, id: 'B1', name: 'Buyer' },
    seller: { ...f.seller, id: overrides.sellerId ?? 'S1', name: 'Seller' },
    commission: { ...f.commission, id: 'A1', name: 'Agent' },
    freight: { ...f.freight, id: 'T1', name: 'Trans', destination: '' },
    paymentAgent: { ...f.paymentAgent, id: 'P1', name: 'PA' },
    buyerId: 'B1',
    sellerId: overrides.sellerId ?? 'S1',
    commissionAgentId: 'A1',
    transporterId: 'T1',
    paymentAgentId: 'P1',
  };
}

describe('rollup contributions', () => {
  it('an order adds every total and party bucket', () => {
    const d = orderContribution(order('2026-10-03'));
    expect(d.totals).toMatchObject({
      orders: 1,
      qtyKg: 38_520,
      buyerBase: 48_150_000,
      gst: 2_407_500,
      buyerGross: 50_557_500,
      seller: 37_364_400,
      commission: 2_792_700,
      freight: 3_274_200,
      paCharge: 3_852_000,
      paReceived: 50_557_500,
      paBalance: 46_705_500,
    });
    expect(d.parties.BUYER.B1).toMatchObject({ n: 1, amount: 50_557_500, base: 48_150_000 });
    expect(d.parties.PAYMENT_AGENT.P1).toMatchObject({ amount: 46_705_500, charge: 3_852_000, received: 50_557_500 });
  });

  it('cancellation (sign −1) exactly reverses the order', () => {
    const o = order('2026-10-03');
    const sum = sumRollups([orderContribution(o), orderContribution(o, -1)]);
    expect(sum.totals.orders).toBe(0);
    expect(sum.totals.buyerGross).toBe(0);
    expect(sum.parties.SELLER.S1?.amount).toBe(0);
  });

  it('payments reduce party outstanding', () => {
    const data = sumRollups([
      orderContribution(order('2026-10-03')),
      paymentContribution({ date: '2026-10-04', amount: 1_000_000, category: 'TRANSPORTER_PAYMENT', partyId: 'T1', partyType: 'TRANSPORTER' }),
      paymentContribution({ date: '2026-10-05', amount: 2_274_200, category: 'TRANSPORTER_PAYMENT', partyId: 'T1', partyType: 'TRANSPORTER' }),
    ]);
    const t = partySummary(data, 'TRANSPORTER', 'T1');
    expect(t).toMatchObject({ orders: 1, qtyKg: 38_520, amount: 3_274_200, paid: 3_274_200, outstanding: 0, averageRate: 85_000 });
  });

  it('voiding a payment restores the outstanding', () => {
    const p = { date: '2026-10-04', amount: 500_000, category: 'SELLER_PAYMENT' as const, partyId: 'S1', partyType: 'SELLER' as const };
    const data = sumRollups([orderContribution(order('2026-10-03')), paymentContribution(p), paymentContribution(p, -1)]);
    expect(partySummary(data, 'SELLER', 'S1').outstanding).toBe(37_364_400);
  });

  it('buyer average rate excludes GST', () => {
    const data = sumRollups([orderContribution(order('2026-10-03')), orderContribution(order('2026-10-04', 25_450))]);
    const b = partySummary(data, 'BUYER', 'B1');
    expect(b.orders).toBe(2);
    expect(b.qtyKg).toBe(63_970);
    expect(b.averageRate).toBe(1_250_000);
  });

  it('outstanding receivables and payables', () => {
    const data = sumRollups([
      orderContribution(order('2026-10-03')),
      paymentContribution({ date: '2026-10-04', amount: 50_557_500, category: 'BUYER_RECEIPT', partyId: 'B1', partyType: 'BUYER' }),
    ]);
    const o = outstandingSummary(data.totals);
    expect(o.receivables).toBe(0);
    expect(o.payables).toBe(37_364_400 + 2_792_700 + 3_274_200);
    expect(o.paymentAgent).toBe(46_705_500);
  });

  it('breakdown groups by party and sorts by amount', () => {
    const data = sumRollups([
      orderContribution(order('2026-10-03', 10_000, { sellerId: 'S1' })),
      orderContribution(order('2026-10-03', 30_000, { sellerId: 'S2' })),
    ]);
    const rows = breakdown(data, 'SELLER');
    expect(rows.map((r) => r.id)).toEqual(['S2', 'S1']);
    expect(rows[0]!.qtyKg).toBe(30_000);
  });

  it('flattens to dotted increment paths with no zeros', () => {
    const flat = flattenDelta(orderContribution(order('2026-10-03')));
    expect(flat['totals.buyerGross']).toBe(50_557_500);
    expect(flat['parties.BUYER.B1.amount']).toBe(50_557_500);
    expect(flat['parties.SELLER.S1.received']).toBeUndefined();
    expect(Object.values(flat).every((v) => v !== 0)).toBe(true);
  });

  it('an edit that moves the date touches day + month docs for both dates', () => {
    const before = order('2026-09-30');
    const after = order('2026-10-01', 40_000);
    const byKey = combineDeltas([orderContribution(before, -1), orderContribution(after, 1)]);
    expect([...byKey.keys()].sort()).toEqual(['D-2026-09-30', 'D-2026-10-01', 'M-2026-09', 'M-2026-10']);
    expect(byKey.get('M-2026-09')!.totals.orders).toBe(-1);
    expect(byKey.get('D-2026-10-01')!.totals.qtyKg).toBe(40_000);
  });

  it('normalises partial documents from Firestore', () => {
    const acc = emptyRollup();
    mergeInto(acc, sumRollups([{ totals: { orders: 2 } }, null, { parties: { BUYER: { X: { n: 1 } } } }]));
    expect(acc.totals.orders).toBe(2);
    expect(acc.totals.paid.BUYER_RECEIPT).toBe(0);
    expect(acc.parties.BUYER.X).toMatchObject({ n: 1, amount: 0 });
  });
});

describe('rollup key planner', () => {
  it('uses one monthly doc for a full month', () => {
    expect(planRollupKeys({ from: '2026-10-01', to: '2026-10-31' })).toEqual(['M-2026-10']);
  });
  it('uses daily docs for a partial week', () => {
    expect(planRollupKeys({ from: '2026-09-28', to: '2026-10-04' })).toEqual([
      'D-2026-09-28', 'D-2026-09-29', 'D-2026-09-30', 'D-2026-10-01', 'D-2026-10-02', 'D-2026-10-03', 'D-2026-10-04',
    ]);
  });
  it('a financial year is 12 monthly docs', () => {
    const keys = planRollupKeys({ from: '2026-04-01', to: '2027-03-31' });
    expect(keys).toHaveLength(12);
    expect(keys[0]).toBe('M-2026-04');
    expect(keys[11]).toBe('M-2027-03');
  });
  it('mixes edges and full months', () => {
    const keys = planRollupKeys({ from: '2026-01-30', to: '2026-03-02' });
    expect(keys).toEqual(['D-2026-01-30', 'D-2026-01-31', 'M-2026-02', 'D-2026-03-01', 'D-2026-03-02']);
  });
  it('single day and reversed range', () => {
    expect(planRollupKeys({ from: '2026-10-03', to: '2026-10-03' })).toEqual(['D-2026-10-03']);
    expect(planRollupKeys({ from: '2026-10-04', to: '2026-10-03' })).toEqual([]);
  });
});
