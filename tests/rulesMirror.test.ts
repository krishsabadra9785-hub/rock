import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { calculateOrder } from '../src/domain/calc';
import { isRoundedProduct } from '../src/domain/money';
import { diffRollups, emptyRollup, orderContribution, sumRollups } from '../src/domain/rollups';

/**
 * The security rules re-derive every order amount with integer arithmetic
 * (`roundedProduct`). These tests prove the app's BigInt calculation always
 * satisfies that exact rule formula — otherwise legitimate orders would be
 * rejected — and that tampered amounts never do.
 */

let seed = 20261003;
const rand = (max: number) => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed % (max + 1);
};

describe('rules arithmetic mirror', () => {
  it('the rules file contains the same formula', () => {
    const rules = readFileSync(fileURLToPath(new URL('../firestore.rules', import.meta.url)), 'utf8');
    expect(rules.includes('amount * div - half <= a * b')).toBe(true);
    expect(rules.includes('a * b < amount * div + half')).toBe(true);
    expect(rules.includes('d.paymentAgent.balance == d.paymentAgent.received - d.paymentAgent.deduction')).toBe(true);
    expect(rules.includes('d.paymentAgent.received == d.buyer.grossAmount')).toBe(true);
    expect(rules.includes('d.buyer.grossAmount == d.buyer.baseAmount + d.buyer.gstAmount')).toBe(true);
  });

  it('38.52 MT reference order satisfies every rule check', () => {
    const f = calculateOrder({ qtyKg: 38_520, buyerRatePaise: 1_250_000, gstBp: 500, sellerRatePaise: 970_000, commissionRatePaise: 72_500, freightRatePaise: 85_000, paymentAgentRatePaise: 100_000 });
    expect(isRoundedProduct(f.buyer.baseAmount, 38_520, 1_250_000, 1000)).toBe(true);
    expect(isRoundedProduct(f.buyer.gstAmount, f.buyer.baseAmount, 500, 10000)).toBe(true);
    expect(isRoundedProduct(f.seller.amount, 38_520, 970_000, 1000)).toBe(true);
    expect(isRoundedProduct(f.commission.amount, 38_520, 72_500, 1000)).toBe(true);
    expect(isRoundedProduct(f.freight.amount, 38_520, 85_000, 1000)).toBe(true);
    expect(isRoundedProduct(f.paymentAgent.deduction, 38_520, 100_000, 1000)).toBe(true);
    expect(f.paymentAgent.balance).toBe(f.paymentAgent.received - f.paymentAgent.deduction);
  });

  it('5,000 random orders: app amounts always pass; ±1 paisa always fails', () => {
    for (let i = 0; i < 5000; i++) {
      const qtyKg = 1 + rand(999_999);
      const rate = rand(100_000_000);
      const gstBp = rand(2800);
      const f = calculateOrder({ qtyKg, buyerRatePaise: rate, gstBp, sellerRatePaise: rate, commissionRatePaise: rate, freightRatePaise: rate, paymentAgentRatePaise: rate });
      expect(isRoundedProduct(f.buyer.baseAmount, qtyKg, rate, 1000)).toBe(true);
      expect(isRoundedProduct(f.buyer.gstAmount, f.buyer.baseAmount, gstBp, 10000)).toBe(true);
      expect(isRoundedProduct(f.buyer.baseAmount + 1, qtyKg, rate, 1000)).toBe(false);
      if (f.buyer.baseAmount > 0) expect(isRoundedProduct(f.buyer.baseAmount - 1, qtyKg, rate, 1000)).toBe(false);
      expect(isRoundedProduct(f.buyer.gstAmount + 1, f.buyer.baseAmount, gstBp, 10000)).toBe(false);
    }
  });

  it('largest allowed values stay within 64-bit rule integers', () => {
    const f = calculateOrder({ qtyKg: 1_000_000, buyerRatePaise: 100_000_000, gstBp: 2800, sellerRatePaise: 0, commissionRatePaise: 0, freightRatePaise: 0, paymentAgentRatePaise: 0 });
    // base × gst and qty × rate products evaluated by the rules must be < 2^63
    expect(BigInt(f.buyer.baseAmount) * 2800n < 2n ** 63n).toBe(true);
    expect(1_000_000n * 100_000_000n < 2n ** 63n).toBe(true);
  });

  it('rejects fractional or negative inputs', () => {
    expect(isRoundedProduct(1.5, 1, 1, 1000)).toBe(false);
    expect(isRoundedProduct(-1, 1, 1, 1000)).toBe(false);
  });
});

describe('statistics verification', () => {
  it('diffRollups reports tampered dashboard totals and nothing for matching data', () => {
    const f = calculateOrder({ qtyKg: 38_520, buyerRatePaise: 1_250_000, gstBp: 500, sellerRatePaise: 970_000, commissionRatePaise: 72_500, freightRatePaise: 85_000, paymentAgentRatePaise: 100_000 });
    const o = {
      dispatchDate: '2026-10-03', qtyKg: 38_520,
      buyer: { ...f.buyer, id: 'B', name: 'B' }, seller: { ...f.seller, id: 'S', name: 'S' },
      commission: { ...f.commission, id: 'A', name: 'A' }, freight: { ...f.freight, id: 'T', name: 'T', destination: '' },
      paymentAgent: { ...f.paymentAgent, id: 'P', name: 'P' },
      buyerId: 'B', sellerId: 'S', commissionAgentId: 'A', transporterId: 'T', paymentAgentId: 'P',
    };
    const computed = sumRollups([orderContribution(o)]);
    expect(diffRollups(structuredClone(computed), computed)).toEqual({});
    const tampered = structuredClone(computed);
    tampered.totals.paid.BUYER_RECEIPT = 1;
    expect(Object.keys(diffRollups(tampered, computed))).toEqual(['totals.paid.BUYER_RECEIPT']);
    expect(Object.keys(diffRollups(emptyRollup(), computed)).length).toBeGreaterThan(5);
  });
});
