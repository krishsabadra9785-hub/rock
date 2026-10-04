import { describe, expect, it } from 'vitest';
import { calculateOrder, CalculationError, tryCalculateOrder, type OrderRateInputs } from '../src/domain/calc';
import { formatINR } from '../src/domain/format';
import { parseQuantityMt, parseRupees, parsePercent } from '../src/domain/money';

/** The reference transaction from the specification (section 19 / 42). */
const REFERENCE: OrderRateInputs = {
  qtyKg: parseQuantityMt('38.52')!,
  buyerRatePaise: parseRupees('12500')!,
  gstBp: parsePercent('5')!,
  sellerRatePaise: parseRupees('9700')!,
  commissionRatePaise: parseRupees('725')!,
  freightRatePaise: parseRupees('850')!,
  paymentAgentRatePaise: parseRupees('1000')!,
};

describe('reference order 38.52 MT', () => {
  const r = calculateOrder(REFERENCE);

  it('stores quantity exactly', () => {
    expect(r.qtyKg).toBe(38520);
  });
  it('buyer base = ₹4,81,500', () => {
    expect(r.buyer.baseAmount).toBe(48_150_000);
    expect(formatINR(r.buyer.baseAmount)).toBe('₹4,81,500');
  });
  it('GST 5% = ₹24,075', () => {
    expect(r.buyer.gstAmount).toBe(2_407_500);
    expect(formatINR(r.buyer.gstAmount)).toBe('₹24,075');
  });
  it('buyer total = ₹5,05,575', () => {
    expect(r.buyer.grossAmount).toBe(50_557_500);
    expect(formatINR(r.buyer.grossAmount)).toBe('₹5,05,575');
  });
  it('effective buyer rate incl. GST = ₹13,125/MT', () => {
    expect(r.buyer.effectiveRatePaise).toBe(1_312_500);
  });
  it('seller total = ₹3,73,644', () => {
    expect(r.seller.amount).toBe(37_364_400);
    expect(formatINR(r.seller.amount)).toBe('₹3,73,644');
  });
  it('commission = ₹27,927', () => {
    expect(r.commission.amount).toBe(2_792_700);
    expect(formatINR(r.commission.amount)).toBe('₹27,927');
  });
  it('freight = ₹32,742', () => {
    expect(r.freight.amount).toBe(3_274_200);
    expect(formatINR(r.freight.amount)).toBe('₹32,742');
  });
  it('payment agent commission = ₹38,520 (a payable we owe the agent)', () => {
    expect(r.paymentAgent).toEqual({ ratePaise: 100_000, amount: 3_852_000 });
    expect(formatINR(r.paymentAgent.amount)).toBe('₹38,520');
  });
  it('the buyer gross is NOT assigned to the payment agent; no "balance after deduction" exists', () => {
    expect(r.buyer.grossAmount).toBe(50_557_500);
    expect(Object.keys(r.paymentAgent).sort()).toEqual(['amount', 'ratePaise']);
    expect(JSON.stringify(r).includes('46705500')).toBe(false);
  });
  it('stores base, GST and gross separately and they reconcile', () => {
    expect(r.buyer.baseAmount + r.buyer.gstAmount).toBe(r.buyer.grossAmount);
    expect(r.buyer.gstBp).toBe(500);
    expect(r.buyer.ratePaise).toBe(1_250_000);
  });
});

describe('GST', () => {
  it('handles 0% GST', () => {
    const r = calculateOrder({ ...REFERENCE, gstBp: 0 });
    expect(r.buyer.gstAmount).toBe(0);
    expect(r.buyer.grossAmount).toBe(r.buyer.baseAmount);
  });
  it('handles 18% GST', () => {
    const r = calculateOrder({ ...REFERENCE, gstBp: 1800 });
    expect(r.buyer.gstAmount).toBe(8_667_000); // 481500 × 18% = 86,670
  });
  it('handles fractional GST like 2.5% with half-up rounding', () => {
    // 0.333 MT × ₹101 = ₹33.633 → 3363.3 paise → 3363; GST 2.5% = 84.075 → 84 paise
    const r = calculateOrder({ ...REFERENCE, qtyKg: 333, buyerRatePaise: 10_100, gstBp: 250 });
    expect(r.buyer.baseAmount).toBe(3363);
    expect(r.buyer.gstAmount).toBe(84);
  });
  it('rejects GST over 100%', () => {
    expect(() => calculateOrder({ ...REFERENCE, gstBp: 10_001 })).toThrow(CalculationError);
  });
});

describe('decimal quantities & rounding', () => {
  it('handles 3-decimal quantities (25.450 MT)', () => {
    const r = calculateOrder({ ...REFERENCE, qtyKg: parseQuantityMt('25.450')! });
    expect(r.qtyKg).toBe(25450);
    expect(r.seller.amount).toBe(24_686_500); // 25.45 × 9700 = 2,46,865
    expect(r.freight.amount).toBe(2_163_250); // 25.45 × 850 = 21,632.50
    expect(formatINR(r.freight.amount)).toBe('₹21,632.50');
  });
  it('rounds half-up to the paisa', () => {
    // 0.001 MT × ₹0.05/MT = 0.005 paise → 0; 0.001 × ₹5 = 0.5 paise → 1
    expect(calculateOrder({ ...REFERENCE, qtyKg: 1, freightRatePaise: 500 }).freight.amount).toBe(1);
    expect(calculateOrder({ ...REFERENCE, qtyKg: 1, freightRatePaise: 499 }).freight.amount).toBe(0);
  });
  it('avoids floating point error (0.1 + 0.2 style)', () => {
    const r = calculateOrder({ ...REFERENCE, qtyKg: parseQuantityMt('0.3')!, sellerRatePaise: parseRupees('0.1')! });
    expect(r.seller.amount).toBe(3); // 0.3 × ₹0.10 = ₹0.03 exactly
  });
  it('zero rates give zero amounts (no commission agent)', () => {
    const r = calculateOrder({ ...REFERENCE, commissionRatePaise: 0 });
    expect(r.commission.amount).toBe(0);
  });
});

describe('validation inside calculation', () => {
  it('rejects zero quantity', () => {
    expect(() => calculateOrder({ ...REFERENCE, qtyKg: 0 })).toThrow(CalculationError);
  });
  it('rejects negative rates', () => {
    expect(() => calculateOrder({ ...REFERENCE, sellerRatePaise: -1 })).toThrow(CalculationError);
  });
  it('rejects NaN and fractional base units', () => {
    expect(() => calculateOrder({ ...REFERENCE, qtyKg: Number.NaN })).toThrow(CalculationError);
    expect(() => calculateOrder({ ...REFERENCE, buyerRatePaise: 12.5 })).toThrow(CalculationError);
  });
  it('payment-agent commission is independent of the buyer amount', () => {
    // Even a commission above the buyer total is just a (large) payable; nothing is deducted from buyer money.
    const big = calculateOrder({ ...REFERENCE, paymentAgentRatePaise: 1_400_000 });
    expect(big.paymentAgent.amount).toBe(53_928_000);
    expect(big.buyer.grossAmount).toBe(50_557_500);
  });
  it('tryCalculateOrder returns null instead of throwing', () => {
    expect(tryCalculateOrder({ qtyKg: 0 })).toBeNull();
    expect(tryCalculateOrder(REFERENCE)?.buyer.grossAmount).toBe(50_557_500);
  });
});
