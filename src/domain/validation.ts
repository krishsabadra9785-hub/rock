import { isValidISODate, todayISO, addDays } from './dates';
import { parsePercent, parseQuantityMt, parseRupees, type BasisPoints, type Kg, type Paise } from './money';

export type FieldResult<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T>(value: T): FieldResult<T> => ({ ok: true, value });
const fail = <T>(error: string): FieldResult<T> => ({ ok: false, error });

/** Max quantity per order: 1,000 MT — far above any truck, catches typos like 3852. */
export const MAX_QTY_KG = 1_000_000;
/** Max rate: ₹10,00,000 per MT. */
export const MAX_RATE_PAISE = 100_000_000;
/** Max single payment: ₹100 crore. */
export const MAX_PAYMENT_PAISE = 100_000_000_000;
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
export const ALLOWED_RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;

export function validateQuantity(input: string): FieldResult<Kg> {
  if (!input.trim()) return fail('Enter the net quantity');
  const kg = parseQuantityMt(input);
  if (kg === null) return fail('Use a number with up to 3 decimals, e.g. 38.52');
  if (kg <= 0) return fail('Quantity must be greater than 0');
  if (kg > MAX_QTY_KG) return fail('Quantity looks too large — check the decimal point');
  return ok(kg);
}

export function validateRate(input: string, opts: { required?: boolean } = {}): FieldResult<Paise> {
  if (!input.trim()) return opts.required === false ? ok(0) : fail('Enter a rate');
  const p = parseRupees(input);
  if (p === null) return fail('Use a rupee amount with up to 2 decimals');
  if (p < 0) return fail('Rate cannot be negative');
  if (p > MAX_RATE_PAISE) return fail('Rate looks too large');
  return ok(p);
}

export function validateGst(input: string): FieldResult<BasisPoints> {
  if (!input.trim()) return fail('Enter GST % (use 0 if none)');
  const bp = parsePercent(input);
  if (bp === null) return fail('Use a percentage with up to 2 decimals, e.g. 5');
  if (bp > 2800) return fail('GST above 28% is not a valid Indian GST slab');
  return ok(bp);
}

export function validateAmount(input: string): FieldResult<Paise> {
  if (!input.trim()) return fail('Enter an amount');
  const p = parseRupees(input);
  if (p === null) return fail('Use a rupee amount with up to 2 decimals');
  if (p <= 0) return fail('Amount must be greater than 0');
  if (p > MAX_PAYMENT_PAISE) return fail('Amount looks too large');
  return ok(p);
}

/** Indian mobile/landline or international. Empty allowed when not required. */
export function validatePhone(input: string, required = false): FieldResult<string> {
  const trimmed = input.trim();
  if (!trimmed) return required ? fail('Enter a phone number') : ok('');
  const digits = trimmed.replace(/[\s()-]/g, '');
  if (!/^\+?\d{6,15}$/.test(digits)) return fail('Use digits only, e.g. 9876543210');
  const national = digits.replace(/^\+?91(?=\d{10}$)/, '');
  if (/^\d{10}$/.test(national) && !/^[6-9]/.test(national) && !/^0/.test(national)) {
    // 10-digit numbers starting 1–5 are neither valid mobiles nor STD-prefixed landlines.
    return fail('Indian mobile numbers start with 6, 7, 8 or 9');
  }
  return ok(digits);
}

export function validateName(input: string, label = 'Name'): FieldResult<string> {
  const v = input.trim().replace(/\s+/g, ' ');
  if (!v) return fail(`Enter ${label.toLowerCase()}`);
  if (v.length > 120) return fail(`${label} is too long`);
  return ok(v);
}

export function validateOptionalText(input: string, max = 500): FieldResult<string> {
  const v = input.trim();
  if (v.length > max) return fail(`Keep this under ${max} characters`);
  return ok(v);
}

export function validateDispatchDate(input: string, now: Date = new Date()): FieldResult<string> {
  if (!input) return fail('Enter the dispatch date');
  if (!isValidISODate(input)) return fail('Enter a valid date');
  const today = todayISO(now);
  if (input > addDays(today, 7)) return fail('Dispatch date is more than a week in the future');
  return ok(input);
}

export function normalizeVehicleNumber(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function validateGstin(input: string): FieldResult<string> {
  const v = input.trim().toUpperCase();
  if (!v) return ok('');
  if (!/^\d{2}[A-Z0-9]{10}[A-Z0-9]Z[A-Z0-9]$/.test(v)) return fail('GSTIN should be 15 characters, e.g. 27ABCDE1234F1Z5');
  return ok(v);
}

export function validateReceiptFile(file: { type: string; size: number }): FieldResult<true> {
  if (!(ALLOWED_RECEIPT_TYPES as readonly string[]).includes(file.type)) {
    return fail('Upload a JPG, PNG, WEBP image or a PDF');
  }
  if (file.size <= 0) return fail('The file is empty');
  if (file.size > MAX_RECEIPT_BYTES) return fail('File is larger than 10 MB');
  return ok(true);
}

export const LOGIN_ID_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;

export function validateLoginId(input: string): FieldResult<string> {
  const v = input.trim().toLowerCase();
  if (!v) return fail('Enter your login ID');
  if (v.includes('@')) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? ok(v) : fail('Enter a valid login ID or email');
  }
  if (!LOGIN_ID_RE.test(v)) return fail('Login IDs are 3–32 letters, numbers, dots, dashes or underscores');
  return ok(v);
}

export function validatePin(pin: string): FieldResult<string> {
  if (!/^\d{4}$/.test(pin)) return fail('PIN must be exactly 4 digits');
  if (/^(\d)\1{3}$/.test(pin)) return fail('Avoid PINs with the same digit four times');
  if (['0123', '1234', '2345', '3456', '4567', '5678', '6789', '9876', '4321', '3210'].includes(pin)) {
    return fail('Avoid sequential PINs like 1234');
  }
  return ok(pin);
}

export function validateNewPassword(pw: string): FieldResult<string> {
  if (pw.length < 10) return fail('Use at least 10 characters');
  if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) return fail('Include both letters and numbers');
  return ok(pw);
}
