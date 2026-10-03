import type { BasisPoints, Kg, Paise } from './money';

const inrWhole = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const inrPaise = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const qtyFmt = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
const intFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const pctFmt = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/**
 * Formats paise as Indian rupees: 50557500 → "₹5,05,575".
 * Paise are shown only when the amount isn't a whole rupee: "₹5,05,575.50".
 */
export function formatINR(paise: Paise | null | undefined): string {
  if (paise === null || paise === undefined || !Number.isFinite(paise)) return '—';
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const text = abs % 100 === 0 ? inrWhole.format(abs / 100) : inrPaise.format(abs / 100);
  return negative ? `-${text}` : text;
}

/** "₹12,500/MT" */
export function formatRate(paisePerMt: Paise | null | undefined): string {
  if (paisePerMt === null || paisePerMt === undefined) return '—';
  return `${formatINR(paisePerMt)}/MT`;
}

/** 38520 → "38.52" (min 2, max 3 decimals). */
export function formatQtyNumber(kg: Kg | null | undefined): string {
  if (kg === null || kg === undefined || !Number.isFinite(kg)) return '—';
  return qtyFmt.format(kg / 1000);
}

/** 38520 → "38.52 MT" */
export function formatQty(kg: Kg | null | undefined): string {
  const n = formatQtyNumber(kg);
  return n === '—' ? n : `${n} MT`;
}

/** 500 → "5%" */
export function formatPercent(bp: BasisPoints | null | undefined): string {
  if (bp === null || bp === undefined) return '—';
  return `${pctFmt.format(bp / 100)}%`;
}

export function formatCount(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return intFmt.format(n);
}

/** Plain rupee number for CSV exports: 50557550 → "505575.50" (no symbol, no grouping). */
export function paiseToPlain(paise: Paise): string {
  const negative = paise < 0;
  const abs = Math.abs(paise);
  return `${negative ? '-' : ''}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Plain MT number for CSV exports: 25450 → "25.450". */
export function kgToPlainMt(kg: Kg): string {
  const negative = kg < 0;
  const abs = Math.abs(kg);
  return `${negative ? '-' : ''}${Math.trunc(abs / 1000)}.${String(abs % 1000).padStart(3, '0')}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-03" → "3 Oct 2026" */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? ''} ${m[1]}`;
}

export function formatDateTime(d: Date | null | undefined): string {
  if (!d) return '—';
  return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}
