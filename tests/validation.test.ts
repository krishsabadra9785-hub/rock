import { describe, expect, it } from 'vitest';
import {
  normalizeVehicleNumber,
  validateAmount,
  validateDispatchDate,
  validateGst,
  validateGstin,
  validateLoginId,
  validateNewPassword,
  validatePhone,
  validatePin,
  validateQuantity,
  validateRate,
  validateReceiptFile,
} from '../src/domain/validation';

const NOW = new Date(2026, 9, 3);

describe('validation', () => {
  it('quantity must be > 0 with ≤3 decimals', () => {
    expect(validateQuantity('38.52')).toEqual({ ok: true, value: 38_520 });
    expect(validateQuantity('0').ok).toBe(false);
    expect(validateQuantity('').ok).toBe(false);
    expect(validateQuantity('1.2345').ok).toBe(false);
    expect(validateQuantity('abc').ok).toBe(false);
    expect(validateQuantity('5000').ok).toBe(false); // 5000 MT is a typo
  });
  it('rates must be ≥ 0', () => {
    expect(validateRate('0')).toEqual({ ok: true, value: 0 });
    expect(validateRate('-1').ok).toBe(false);
    expect(validateRate('', { required: false })).toEqual({ ok: true, value: 0 });
    expect(validateRate('').ok).toBe(false);
  });
  it('GST must be a sensible slab', () => {
    expect(validateGst('5')).toEqual({ ok: true, value: 500 });
    expect(validateGst('0')).toEqual({ ok: true, value: 0 });
    expect(validateGst('40').ok).toBe(false);
  });
  it('payment amounts must be positive', () => {
    expect(validateAmount('1,000')).toEqual({ ok: true, value: 100_000 });
    expect(validateAmount('0').ok).toBe(false);
  });
  it('phone numbers', () => {
    expect(validatePhone('98765 43210')).toEqual({ ok: true, value: '9876543210' });
    expect(validatePhone('+91 98765-43210')).toEqual({ ok: true, value: '+919876543210' });
    expect(validatePhone('')).toEqual({ ok: true, value: '' });
    expect(validatePhone('', true).ok).toBe(false);
    expect(validatePhone('12345').ok).toBe(false);
    expect(validatePhone('1234567890').ok).toBe(false);
    expect(validatePhone('02224567890').ok).toBe(true);
  });
  it('dispatch dates', () => {
    expect(validateDispatchDate('2026-10-03', NOW).ok).toBe(true);
    expect(validateDispatchDate('2026-11-30', NOW).ok).toBe(false);
    expect(validateDispatchDate('2026-02-30', NOW).ok).toBe(false);
  });
  it('vehicle numbers normalise', () => {
    expect(normalizeVehicleNumber('mh 12-ab 1234')).toBe('MH12AB1234');
  });
  it('GSTIN', () => {
    expect(validateGstin('27abcde1234f1z5')).toEqual({ ok: true, value: '27ABCDE1234F1Z5' });
    expect(validateGstin('').ok).toBe(true);
    expect(validateGstin('XYZ').ok).toBe(false);
  });
  it('receipt files', () => {
    expect(validateReceiptFile({ type: 'image/jpeg', size: 2_000_000 }).ok).toBe(true);
    expect(validateReceiptFile({ type: 'application/pdf', size: 2_000_000 }).ok).toBe(true);
    expect(validateReceiptFile({ type: 'image/gif', size: 100 }).ok).toBe(false);
    expect(validateReceiptFile({ type: 'image/png', size: 11 * 1024 * 1024 }).ok).toBe(false);
    expect(validateReceiptFile({ type: 'image/png', size: 0 }).ok).toBe(false);
  });
  it('login IDs, PINs and passwords', () => {
    expect(validateLoginId('Owner')).toEqual({ ok: true, value: 'owner' });
    expect(validateLoginId('a').ok).toBe(false);
    expect(validateLoginId('me@example.com').ok).toBe(true);
    expect(validatePin('4829').ok).toBe(true);
    expect(validatePin('1234').ok).toBe(false);
    expect(validatePin('1111').ok).toBe(false);
    expect(validatePin('12a4').ok).toBe(false);
    expect(validatePin('12345').ok).toBe(false);
    expect(validateNewPassword('short1').ok).toBe(false);
    expect(validateNewPassword('longpassword').ok).toBe(false);
    expect(validateNewPassword('longpassword7').ok).toBe(true);
  });
});
