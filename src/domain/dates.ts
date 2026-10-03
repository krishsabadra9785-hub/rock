/**
 * Dates in ROCK are business dates stored as ISO strings (YYYY-MM-DD) in the
 * user's local calendar. ISO strings sort lexicographically, so they can be
 * range-queried in Firestore without timezone surprises.
 */

export type DatePreset = 'TODAY' | 'THIS_WEEK' | 'THIS_MONTH' | 'THIS_FY' | 'ALL_TIME' | 'CUSTOM';

export const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: 'TODAY', label: 'Today' },
  { value: 'THIS_WEEK', label: 'This week' },
  { value: 'THIS_MONTH', label: 'This month' },
  { value: 'THIS_FY', label: 'Financial year' },
  { value: 'ALL_TIME', label: 'All time' },
  { value: 'CUSTOM', label: 'Custom' },
];

export interface DateRange {
  /** Inclusive. null = unbounded. */
  from: string | null;
  /** Inclusive. null = unbounded. */
  to: string | null;
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function todayISO(now: Date = new Date()): string {
  return toISODate(now);
}

export function isValidISODate(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = ISO_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

export function parseISO(s: string): Date {
  const m = ISO_RE.exec(s);
  if (!m) throw new Error(`Invalid date: ${s}`);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function addDays(iso: string, days: number): string {
  const d = parseISO(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export interface FinancialYear {
  start: string;
  end: string;
  /** e.g. "FY 2026-27" (or "FY 2026" when it matches the calendar year). */
  label: string;
  startYear: number;
}

/** Financial year containing `iso`, for a year starting on day 1 of `startMonth` (1–12). */
export function financialYearFor(iso: string, startMonth: number): FinancialYear {
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) {
    throw new Error('Financial year start month must be 1–12');
  }
  const d = parseISO(iso);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const startYear = m >= startMonth ? y : y - 1;
  const start = `${startYear}-${pad2(startMonth)}-01`;
  const endDate = new Date(startYear + 1, startMonth - 1, 0); // day before next start
  const end = toISODate(endDate);
  const label =
    startMonth === 1 ? `FY ${startYear}` : `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
  return { start, end, label, startYear };
}

/** Week runs Monday–Sunday. */
export function weekRange(iso: string): DateRange {
  const d = parseISO(iso);
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  const from = addDays(iso, -dow);
  return { from, to: addDays(from, 6) };
}

export function monthRange(iso: string): DateRange {
  const d = parseISO(iso);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  return { from: `${y}-${pad2(m)}-01`, to: `${y}-${pad2(m)}-${pad2(daysInMonth(y, m))}` };
}

export function resolvePreset(
  preset: DatePreset,
  opts: { now?: Date; fyStartMonth: number; custom?: DateRange },
): DateRange {
  const today = todayISO(opts.now ?? new Date());
  switch (preset) {
    case 'TODAY':
      return { from: today, to: today };
    case 'THIS_WEEK':
      return weekRange(today);
    case 'THIS_MONTH':
      return monthRange(today);
    case 'THIS_FY': {
      const fy = financialYearFor(today, opts.fyStartMonth);
      return { from: fy.start, to: fy.end };
    }
    case 'ALL_TIME':
      return { from: null, to: null };
    case 'CUSTOM': {
      const c = opts.custom ?? { from: null, to: null };
      const from = c.from && isValidISODate(c.from) ? c.from : null;
      const to = c.to && isValidISODate(c.to) ? c.to : null;
      if (from && to && from > to) return { from: to, to: from };
      return { from, to };
    }
  }
}

export function inRange(iso: string, range: DateRange): boolean {
  if (range.from && iso < range.from) return false;
  if (range.to && iso > range.to) return false;
  return true;
}

export function describeRange(range: DateRange): string {
  if (!range.from && !range.to) return 'All time';
  if (range.from && range.to && range.from === range.to) return range.from;
  return `${range.from ?? 'start'} → ${range.to ?? 'today'}`;
}

export function yearOf(iso: string): number {
  return Number(iso.slice(0, 4));
}

export function monthKeyOf(iso: string): string {
  return iso.slice(0, 7);
}

/** "2026-10" → "2026-11" */
export function nextMonthKey(key: string): string {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  return m === 12 ? `${y + 1}-01` : `${y}-${pad2(m + 1)}`;
}
