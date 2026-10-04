/**
 * Money & quantity primitives.
 *
 * The app never does financial arithmetic with floating-point rupees.
 *
 *  - Money is stored as an integer number of PAISE   (₹1 = 100 paise).
 *  - Quantity is stored as an integer number of KG    (1 MT = 1000 kg), which
 *    gives exact support for up to 3 decimal places of MT (e.g. 25.450 MT).
 *  - Percentages (GST) are stored as integer BASIS POINTS (5% = 500 bp).
 *  - Multiplication is done with BigInt and rounded HALF-UP (away from zero)
 *    to the nearest paisa, exactly once per stored amount.
 *
 * See docs/ARCHITECTURE.md → "Money handling".
 */

/** Integer paise. */
export type Paise = number;
/** Integer kilograms (thousandths of a metric tonne). */
export type Kg = number;
/** Integer basis points (1/100th of a percent). */
export type BasisPoints = number;

export const KG_PER_MT = 1000;
export const PAISE_PER_RUPEE = 100;
export const BP_PER_PERCENT = 100;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

export function isSafeInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n);
}

/** Divides two BigInts rounding half away from zero. */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new MoneyError('Division by zero');
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = n / d;
  const r = n % d;
  const rounded = r * 2n >= d ? q + 1n : q;
  return negative ? -rounded : rounded;
}

function toSafeNumber(v: bigint): number {
  if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new MoneyError('Amount is too large to represent safely');
  }
  return Number(v);
}

function assertInt(value: number, label: string): void {
  if (!isSafeInt(value)) throw new MoneyError(`${label} must be a whole number of base units`);
}

/**
 * Amount (paise) = quantity (kg) × rate (paise per MT) ÷ 1000, rounded half-up.
 * Example: 38,520 kg × 1,250,000 paise/MT ÷ 1000 = 48,150,000 paise (₹4,81,500).
 */
export function amountForQuantity(qtyKg: Kg, ratePaisePerMt: Paise): Paise {
  assertInt(qtyKg, 'Quantity');
  assertInt(ratePaisePerMt, 'Rate');
  return toSafeNumber(divRoundHalfUp(BigInt(qtyKg) * BigInt(ratePaisePerMt), BigInt(KG_PER_MT)));
}

/** Percentage of an amount: amount × bp ÷ 10,000, rounded half-up. */
export function percentOf(amount: Paise, bp: BasisPoints): Paise {
  assertInt(amount, 'Amount');
  assertInt(bp, 'Percentage');
  return toSafeNumber(divRoundHalfUp(BigInt(amount) * BigInt(bp), 10_000n));
}

/** Sums integer amounts, guarding against unsafe totals. */
export function sumPaise(values: readonly number[]): number {
  let total = 0n;
  for (const v of values) {
    assertInt(v, 'Amount');
    total += BigInt(v);
  }
  return toSafeNumber(total);
}

/** Average rate (paise per MT) for a total amount over a quantity. Returns null when qty is 0. */
export function averageRate(totalAmount: Paise, qtyKg: Kg): Paise | null {
  if (!qtyKg) return null;
  assertInt(totalAmount, 'Amount');
  assertInt(qtyKg, 'Quantity');
  return toSafeNumber(divRoundHalfUp(BigInt(totalAmount) * BigInt(KG_PER_MT), BigInt(qtyKg)));
}

// ---------------------------------------------------------------------------
// Parsing user input (strings) into base units. Never uses parseFloat.
// ---------------------------------------------------------------------------

const DECIMAL_RE = /^(\d+)(?:\.(\d*))?$/;

/**
 * Parses a decimal string into an integer scaled by 10^scale.
 * Accepts Indian/Western grouping commas, ₹ symbol and surrounding spaces.
 * Returns null for empty/invalid input or when there are more decimals than `scale`.
 */
export function parseScaledDecimal(input: string, scale: number): number | null {
  const cleaned = input.replace(/[₹,\s]/g, '').replace(/^Rs\.?/i, '');
  if (cleaned === '' || cleaned === '.') return null;
  const m = DECIMAL_RE.exec(cleaned);
  if (!m) return null;
  const whole = m[1] ?? '0';
  const frac = m[2] ?? '';
  if (frac.length > scale) return null;
  const padded = (frac + '0'.repeat(scale)).slice(0, scale);
  const big = BigInt(whole) * 10n ** BigInt(scale) + BigInt(padded || '0');
  if (big > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(big);
}

/** "12,500" → 1250000 paise. Max 2 decimals. */
export function parseRupees(input: string): Paise | null {
  return parseScaledDecimal(input, 2);
}

/** "38.52" → 38520 kg. Max 3 decimals of MT. */
export function parseQuantityMt(input: string): Kg | null {
  return parseScaledDecimal(input, 3);
}

/** "5" → 500 bp, "2.5" → 250 bp. Max 2 decimals. */
export function parsePercent(input: string): BasisPoints | null {
  return parseScaledDecimal(input, 2);
}

/** Converts a JS number of MT (e.g. from AI output) to kg, refusing junk. */
export function mtNumberToKg(value: number): Kg | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  // Go through a fixed 3-decimal string so 38.52 doesn't become 38519.999…
  return parseQuantityMt(value.toFixed(3));
}

/** Scaled integer → plain decimal string for input fields, trimming trailing zeros. */
export function scaledToInputString(value: number, scale: number): string {
  const negative = value < 0;
  const abs = Math.abs(value);
  const factor = 10 ** scale;
  const whole = Math.trunc(abs / factor);
  const frac = String(abs % factor).padStart(scale, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${frac ? '.' + frac : ''}`;
}

export const paiseToInput = (p: Paise): string => scaledToInputString(p, 2);
export const kgToInput = (kg: Kg): string => scaledToInputString(kg, 3);
export const bpToInput = (bp: BasisPoints): string => scaledToInputString(bp, 2);

/**
 * Mirror of the Firestore rule `roundedProduct` (firestore.rules): true when
 * `amount` equals roundHalfUp(a × b ÷ div), checked with integer arithmetic only:
 *   amount·div − div/2 ≤ a·b < amount·div + div/2
 * Used by tests to prove the app's calculations always satisfy the database rules.
 */
export function isRoundedProduct(amount: number, a: number, b: number, div: 1000 | 10000): boolean {
  if (![amount, a, b].every(isSafeInt) || amount < 0) return false;
  const half = BigInt(div / 2);
  const p = BigInt(a) * BigInt(b);
  const scaled = BigInt(amount) * BigInt(div);
  return scaled - half <= p && p < scaled + half;
}
