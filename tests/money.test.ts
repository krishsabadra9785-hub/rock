import { describe, expect, it } from 'vitest';
import {
  amountForQuantity,
  averageRate,
  divRoundHalfUp,
  kgToInput,
  mtNumberToKg,
  paiseToInput,
  parsePercent,
  parseQuantityMt,
  parseRupees,
  percentOf,
  sumPaise,
} from '../src/domain/money';
import { formatINR, formatQty, formatRate, formatPercent, paiseToPlain, kgToPlainMt, formatDate } from '../src/domain/format';

describe('parsing', () => {
  it('parses rupees with Indian grouping and symbol', () => {
    expect(parseRupees('12,500')).toBe(1_250_000);
    expect(parseRupees('₹ 1,00,000.5')).toBe(10_000_050);
    expect(parseRupees('725')).toBe(72_500);
    expect(parseRupees('.5')).toBeNull();
  });
  it('rejects junk and too many decimals', () => {
    expect(parseRupees('')).toBeNull();
    expect(parseRupees('abc')).toBeNull();
    expect(parseRupees('1.234')).toBeNull();
    expect(parseRupees('-5')).toBeNull();
    expect(parseRupees('1e5')).toBeNull();
  });
  it('parses quantities to kg', () => {
    expect(parseQuantityMt('38.52')).toBe(38_520);
    expect(parseQuantityMt('25.450')).toBe(25_450);
    expect(parseQuantityMt('25.4501')).toBeNull();
    expect(parseQuantityMt('40')).toBe(40_000);
  });
  it('parses percentages to basis points', () => {
    expect(parsePercent('5')).toBe(500);
    expect(parsePercent('2.5')).toBe(250);
    expect(parsePercent('18.00')).toBe(1800);
  });
  it('converts AI numbers to kg without float drift', () => {
    expect(mtNumberToKg(38.52)).toBe(38_520);
    expect(mtNumberToKg(0.1 + 0.2)).toBe(300);
    expect(mtNumberToKg(-1)).toBeNull();
    expect(mtNumberToKg(Number.NaN)).toBeNull();
  });
  it('round-trips to input strings', () => {
    expect(paiseToInput(1_250_000)).toBe('12500');
    expect(paiseToInput(10_000_050)).toBe('100000.5');
    expect(kgToInput(25_450)).toBe('25.45');
    expect(kgToInput(38_520)).toBe('38.52');
  });
});

describe('arithmetic', () => {
  it('rounds half away from zero', () => {
    expect(divRoundHalfUp(5n, 2n)).toBe(3n);
    expect(divRoundHalfUp(4n, 2n)).toBe(2n);
    expect(divRoundHalfUp(-5n, 2n)).toBe(-3n);
    expect(divRoundHalfUp(7n, 3n)).toBe(2n);
  });
  it('multiplies quantity by rate', () => {
    expect(amountForQuantity(38_520, 85_000)).toBe(3_274_200);
  });
  it('computes percentages', () => {
    expect(percentOf(48_150_000, 500)).toBe(2_407_500);
  });
  it('sums safely', () => {
    expect(sumPaise([1, 2, 3])).toBe(6);
    expect(() => sumPaise([Number.MAX_SAFE_INTEGER, 1])).toThrow();
  });
  it('computes average rate per MT', () => {
    expect(averageRate(48_150_000, 38_520)).toBe(1_250_000);
    expect(averageRate(100, 0)).toBeNull();
  });
});

describe('formatting (Indian)', () => {
  it('formats lakhs with Indian grouping', () => {
    expect(formatINR(50_557_500)).toBe('₹5,05,575');
    expect(formatINR(3_274_200)).toBe('₹32,742');
    expect(formatINR(46_705_500)).toBe('₹4,67,055');
    expect(formatINR(1_000_000_000)).toBe('₹1,00,00,000');
  });
  it('shows paise only when present', () => {
    expect(formatINR(2_163_250)).toBe('₹21,632.50');
    expect(formatINR(-50_000)).toBe('-₹500');
    expect(formatINR(null)).toBe('—');
  });
  it('formats rates, quantities and percentages', () => {
    expect(formatRate(1_250_000)).toBe('₹12,500/MT');
    expect(formatQty(38_520)).toBe('38.52 MT');
    expect(formatQty(25_455)).toBe('25.455 MT');
    expect(formatPercent(500)).toBe('5%');
    expect(formatPercent(250)).toBe('2.5%');
  });
  it('formats plain values for CSV', () => {
    expect(paiseToPlain(50_557_500)).toBe('505575.00');
    expect(paiseToPlain(-5)).toBe('-0.05');
    expect(kgToPlainMt(25_450)).toBe('25.450');
  });
  it('formats dates', () => {
    expect(formatDate('2026-10-03')).toBe('3 Oct 2026');
  });
});
