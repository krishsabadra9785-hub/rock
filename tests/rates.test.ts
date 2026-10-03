import { describe, expect, it } from 'vitest';
import {
  applyDefaultChange,
  buildRateHistoryEntry,
  defaultRateFor,
  isRateChanged,
  resolveRateSelection,
  suggestDecision,
  type RateDecision,
} from '../src/domain/rates';
import { calculateOrder } from '../src/domain/calc';
import type { PartyRates } from '../src/domain/types';

/**
 * In-memory simulation of the universal rate behaviour used by the order
 * service: pre-fill from default → user value + decision → snapshot on order
 * → optionally update default + write history.
 */
function simulate() {
  let rates: PartyRates = { SELLER_RATE: 100_000 }; // ₹1,000/MT
  const orders: { n: number; ratePaise: number; amount: number }[] = [];
  const history: { oldRate: number | null; newRate: number; sourceOrder: number }[] = [];

  function createOrder(n: number, entered?: number, decision: RateDecision = 'ORDER_ONLY') {
    const prefilled = defaultRateFor(rates, 'SELLER_RATE');
    const resolved = resolveRateSelection({
      rateType: 'SELLER_RATE',
      partyId: 'sellerA',
      defaultValue: prefilled,
      value: entered ?? prefilled ?? 0,
      decision,
    });
    const fin = calculateOrder({
      qtyKg: 10_000,
      buyerRatePaise: 0,
      gstBp: 0,
      sellerRatePaise: resolved.orderValue,
      commissionRatePaise: 0,
      freightRatePaise: 0,
      paymentAgentRatePaise: 0,
    });
    // Snapshot copy — never a reference to the master.
    orders.push({ n, ratePaise: fin.seller.ratePaise, amount: fin.seller.amount });
    if (resolved.newDefault !== null) {
      history.push({ oldRate: prefilled, newRate: resolved.newDefault, sourceOrder: n });
      rates = applyDefaultChange(rates, 'SELLER_RATE', resolved.newDefault);
    }
    return { prefilled, resolved };
  }
  return { createOrder, orders, history, getRates: () => rates };
}

describe('universal rate carry-forward', () => {
  it('orders 1–10 pre-fill the default ₹1,000', () => {
    const s = simulate();
    for (let i = 1; i <= 10; i++) expect(s.createOrder(i).prefilled).toBe(100_000);
    expect(s.orders.every((o) => o.ratePaise === 100_000)).toBe(true);
    expect(s.history).toHaveLength(0);
  });

  it('THIS ORDER ONLY change does not move the default', () => {
    const s = simulate();
    for (let i = 1; i <= 10; i++) s.createOrder(i);
    s.createOrder(11, 101_000, 'ORDER_ONLY');
    expect(s.orders[10]!.ratePaise).toBe(101_000);
    expect(s.createOrder(12).prefilled).toBe(100_000);
    expect(s.history).toHaveLength(0);
  });

  it('NEW DEFAULT change carries forward and is recorded in history', () => {
    const s = simulate();
    for (let i = 1; i <= 10; i++) s.createOrder(i);
    s.createOrder(11, 101_000, 'NEW_DEFAULT');
    expect(s.createOrder(12).prefilled).toBe(101_000);
    expect(s.createOrder(13).prefilled).toBe(101_000);
    expect(s.history).toEqual([{ oldRate: 100_000, newRate: 101_000, sourceOrder: 11 }]);
  });

  it('historical orders keep their original rate and amount', () => {
    const s = simulate();
    for (let i = 1; i <= 10; i++) s.createOrder(i);
    const before = s.orders.map((o) => ({ ...o }));
    s.createOrder(11, 101_000, 'NEW_DEFAULT');
    s.createOrder(12, 105_000, 'NEW_DEFAULT');
    expect(s.orders.slice(0, 10)).toEqual(before);
    expect(s.orders[0]!.ratePaise).toBe(100_000);
    expect(s.orders[0]!.amount).toBe(1_000_000); // 10 MT × ₹1,000
    expect(s.getRates().SELLER_RATE).toBe(105_000);
  });

  it('choosing NEW DEFAULT without changing the value is a no-op', () => {
    const r = resolveRateSelection({ rateType: 'SELLER_RATE', partyId: 'x', defaultValue: 100, value: 100, decision: 'NEW_DEFAULT' });
    expect(r.newDefault).toBeNull();
    expect(r.record.decision).toBe('UNCHANGED');
  });

  it('first value for a party with no default suggests NEW DEFAULT', () => {
    expect(suggestDecision(null)).toBe('NEW_DEFAULT');
    expect(suggestDecision(5)).toBe('ORDER_ONLY');
    const r = resolveRateSelection({ rateType: 'FREIGHT_RATE', partyId: 't', defaultValue: null, value: 85_000, decision: 'NEW_DEFAULT' });
    expect(r.newDefault).toBe(85_000);
  });

  it('works identically for every rate type including GST and payment agent', () => {
    for (const rateType of ['BUYER_RATE', 'BUYER_GST', 'COMMISSION_RATE', 'FREIGHT_RATE', 'PAYMENT_AGENT_RATE'] as const) {
      const r = resolveRateSelection({ rateType, partyId: 'p', defaultValue: 100_000, value: 105_000, decision: 'NEW_DEFAULT' });
      expect(r.newDefault).toBe(105_000);
      expect(r.record.rateType).toBe(rateType);
    }
  });

  it('applyDefaultChange does not mutate the original', () => {
    const original: PartyRates = { BUYER_RATE: 1 };
    const next = applyDefaultChange(original, 'BUYER_RATE', 2);
    expect(original.BUYER_RATE).toBe(1);
    expect(next.BUYER_RATE).toBe(2);
  });

  it('defaultRateFor ignores invalid stored values', () => {
    expect(defaultRateFor({ BUYER_RATE: -5 }, 'BUYER_RATE')).toBeNull();
    expect(defaultRateFor(undefined, 'BUYER_RATE')).toBeNull();
    expect(isRateChanged({ defaultValue: null, value: 0 })).toBe(true);
  });

  it('rate history entries require a real change of a matching party type', () => {
    const base = {
      partyId: 'p',
      partyType: 'PAYMENT_AGENT' as const,
      rateType: 'PAYMENT_AGENT_RATE' as const,
      oldRate: 100_000,
      newRate: 105_000,
      effectiveFrom: '2026-10-03',
      changedBy: 'uid',
      sourceOrderId: 'o1',
      sourceOrderNumber: 'ROCK-2026-000011',
      reason: '',
    };
    expect(buildRateHistoryEntry(base).newRate).toBe(105_000);
    expect(() => buildRateHistoryEntry({ ...base, newRate: 100_000 })).toThrow();
    expect(() => buildRateHistoryEntry({ ...base, partyType: 'BUYER' })).toThrow();
  });
});
