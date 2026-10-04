import { describe, expect, it } from 'vitest';
import { calculateOrder } from '../src/domain/calc';
import { formatINR, formatRate } from '../src/domain/format';
import {
  combineDeltas,
  diffRollups,
  isLegacyRollupDoc,
  normalizeRollup,
  orderContribution,
  partySummary,
  paymentContribution,
  REBUILD_BATCH_SIZE,
  sumRollups,
} from '../src/domain/rollups';

/**
 * Production regression: four orders at ₹1,000/MT payment-agent rate.
 *   38.52 + 37.60 + 38.76 + 37.90 = 152.78 MT  →  commission ₹1,52,780, average ₹1,000/MT.
 * The live summary showed ₹18,32,331.10 and ₹11,993.27/MT because its statistics
 * documents were written by the obsolete model (agent "balance" = buyer gross − commission).
 */
const QTYS_KG = [38_520, 37_600, 38_760, 37_900];
const BUYER_RATES = [1_250_000, 1_210_000, 1_275_000, 1_190_000]; // deliberately different buyer rates
const PAID_TO_AGENT = 11_636_000; // ₹1,16,360 actually paid to the agent

function order(i: number) {
  const f = calculateOrder({
    qtyKg: QTYS_KG[i]!,
    buyerRatePaise: BUYER_RATES[i]!,
    gstBp: 500,
    sellerRatePaise: 970_000,
    commissionRatePaise: 72_500,
    freightRatePaise: 85_000,
    paymentAgentRatePaise: 100_000,
  });
  return {
    dispatchDate: `2026-10-0${i + 1}`,
    qtyKg: QTYS_KG[i]!,
    buyer: { ...f.buyer, id: 'B1', name: 'Buyer' },
    seller: { ...f.seller, id: 'S1', name: 'Seller' },
    commission: { ...f.commission, id: 'A1', name: 'Agent' },
    freight: { ...f.freight, id: 'T1', name: 'Trans', destination: '' },
    paymentAgent: { ...f.paymentAgent, id: 'P1', name: 'PA' },
    buyerId: 'B1', sellerId: 'S1', commissionAgentId: 'A1', transporterId: 'T1', paymentAgentId: 'P1',
  };
}
const ORDERS = [0, 1, 2, 3].map(order);
const AGENT_PAYMENT = { date: '2026-10-05', amount: PAID_TO_AGENT, category: 'PAYMENT_AGENT_SETTLEMENT' as const, partyId: 'P1', partyType: 'PAYMENT_AGENT' as const };

/** What "Rebuild statistics" computes: orders + ACTIVE payments, from scratch. */
function rebuilt() {
  const byKey = combineDeltas([...ORDERS.map((o) => orderContribution(o)), paymentContribution(AGENT_PAYMENT)]);
  return sumRollups([...byKey.entries()].filter(([k]) => k.startsWith('M-')).map(([, v]) => v));
}

describe('payment agent statistics: production regression (4 orders)', () => {
  it('each order commission is quantity × ₹1,000', () => {
    expect(ORDERS.map((o) => o.paymentAgent.amount)).toEqual([3_852_000, 3_760_000, 3_876_000, 3_790_000]);
  });

  it('rebuilt statistics: charges ₹1,52,780, average ₹1,000/MT, paid ₹1,16,360, outstanding ₹36,420', () => {
    const s = partySummary(rebuilt(), 'PAYMENT_AGENT', 'P1');
    expect(s.orders).toBe(4);
    expect(s.qtyKg).toBe(152_780);
    expect(s.amount).toBe(15_278_000);
    expect(formatINR(s.amount)).toBe('₹1,52,780');
    expect(s.averageRate).toBe(100_000);
    expect(formatRate(s.averageRate)).toBe('₹1,000/MT');
    expect(s.paid).toBe(PAID_TO_AGENT);
    expect(s.outstanding).toBe(15_278_000 - PAID_TO_AGENT);
    expect(formatINR(s.outstanding)).toBe('₹36,420');
    expect(rebuilt().totals.paCharge).toBe(15_278_000);
  });

  it('buyer money never enters payment-agent statistics (independent of buyer rates and GST)', () => {
    const s = partySummary(rebuilt(), 'PAYMENT_AGENT', 'P1');
    expect(s.base).toBe(0);
    expect(s.gst).toBe(0);
    const totalBuyerGross = ORDERS.reduce((sum, o) => sum + o.buyer.grossAmount, 0);
    expect(s.amount === totalBuyerGross).toBe(false);
    expect(s.amount).toBe(ORDERS.reduce((sum, o) => sum + o.paymentAgent.amount, 0));
  });

  it('a statistics document from the obsolete model reproduces the wrong live figures and is detected', () => {
    // As written by the old code: agent bucket amount = Σ(buyer gross − commission), plus old-only fields.
    const legacy = {
      kind: 'M',
      key: '2026-10',
      totals: { orders: 4, qtyKg: 152_780, paCharge: 15_278_000, paReceived: 198_511_110, paBalance: 183_233_110, paid: { PAYMENT_AGENT_SETTLEMENT: PAID_TO_AGENT } },
      parties: { PAYMENT_AGENT: { P1: { n: 4, qtyKg: 152_780, amount: 183_233_110, received: 198_511_110, charge: 15_278_000, paid: PAID_TO_AGENT } } },
    };
    expect(isLegacyRollupDoc(legacy)).toBe(true);
    const stale = sumRollups([legacy]);
    expect(stale.legacyDocs).toBe(1);
    const wrong = partySummary(stale, 'PAYMENT_AGENT', 'P1');
    expect(formatINR(wrong.amount)).toBe('₹18,32,331.10');
    expect(formatRate(wrong.averageRate)).toBe('₹11,993.27/MT');
    expect(formatINR(wrong.outstanding)).toBe('₹17,15,971.10');
    // "Check figures" flags the difference against a recomputation from the orders…
    expect(Object.keys(diffRollups(normalizeRollup(legacy), rebuilt())).includes('parties.PAYMENT_AGENT.P1.amount')).toBe(true);
    // …and the rebuild result is correct and no longer legacy.
    expect(partySummary(rebuilt(), 'PAYMENT_AGENT', 'P1').amount).toBe(15_278_000);
    expect(rebuilt().legacyDocs).toBe(0);
  });

  it('current-format documents are not flagged; a legacy doc anywhere in a range is', () => {
    const current = { kind: 'M', key: '2026-10', ...rebuilt() };
    expect(isLegacyRollupDoc(current)).toBe(false);
    expect(isLegacyRollupDoc({ totals: { paBalance: 1 } })).toBe(true);
    expect(isLegacyRollupDoc({ parties: { PAYMENT_AGENT: { P1: { charge: 1 } } } })).toBe(true);
    expect(sumRollups([current, { totals: { paReceived: 5 } }]).legacyDocs).toBe(1);
    expect(isLegacyRollupDoc(null)).toBe(false);
  });

  it('voiding the agent payment restores the full ₹1,52,780 payable', () => {
    const byKey = combineDeltas([...ORDERS.map((o) => orderContribution(o)), paymentContribution(AGENT_PAYMENT), paymentContribution(AGENT_PAYMENT, -1)]);
    const data = sumRollups([...byKey.entries()].filter(([k]) => k.startsWith('M-')).map(([, v]) => v));
    expect(partySummary(data, 'PAYMENT_AGENT', 'P1').outstanding).toBe(15_278_000);
  });

  it('rebuild writes small batches (rules share one request budget)', () => {
    expect(REBUILD_BATCH_SIZE <= 10).toBe(true);
  });
});
