import { describe, expect, it } from 'vitest';
import { addDays, financialYearFor, isValidISODate, resolvePreset, weekRange, monthRange, inRange } from '../src/domain/dates';

const NOW = new Date(2026, 9, 3, 12, 0, 0); // Sat 3 Oct 2026

describe('financial year', () => {
  it('defaults to Indian April–March', () => {
    expect(financialYearFor('2026-10-03', 4)).toMatchObject({ start: '2026-04-01', end: '2027-03-31', label: 'FY 2026-27' });
    expect(financialYearFor('2026-03-31', 4)).toMatchObject({ start: '2025-04-01', end: '2026-03-31', label: 'FY 2025-26' });
    expect(financialYearFor('2026-04-01', 4).start).toBe('2026-04-01');
  });
  it('is configurable (January and July starts)', () => {
    expect(financialYearFor('2026-10-03', 1)).toMatchObject({ start: '2026-01-01', end: '2026-12-31', label: 'FY 2026' });
    expect(financialYearFor('2026-06-30', 7)).toMatchObject({ start: '2025-07-01', end: '2026-06-30' });
  });
  it('handles leap-year February ends', () => {
    expect(financialYearFor('2027-05-01', 3).end).toBe('2028-02-29');
  });
  it('rejects invalid start months', () => {
    expect(() => financialYearFor('2026-01-01', 13)).toThrow();
  });
});

describe('presets', () => {
  it('today / week (Mon–Sun) / month', () => {
    expect(resolvePreset('TODAY', { now: NOW, fyStartMonth: 4 })).toEqual({ from: '2026-10-03', to: '2026-10-03' });
    expect(resolvePreset('THIS_WEEK', { now: NOW, fyStartMonth: 4 })).toEqual({ from: '2026-09-28', to: '2026-10-04' });
    expect(resolvePreset('THIS_MONTH', { now: NOW, fyStartMonth: 4 })).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });
  it('financial year and all time', () => {
    expect(resolvePreset('THIS_FY', { now: NOW, fyStartMonth: 4 })).toEqual({ from: '2026-04-01', to: '2027-03-31' });
    expect(resolvePreset('ALL_TIME', { now: NOW, fyStartMonth: 4 })).toEqual({ from: null, to: null });
  });
  it('custom ranges are validated and swapped if reversed', () => {
    expect(resolvePreset('CUSTOM', { now: NOW, fyStartMonth: 4, custom: { from: '2026-10-10', to: '2026-10-01' } })).toEqual({
      from: '2026-10-01',
      to: '2026-10-10',
    });
    expect(resolvePreset('CUSTOM', { now: NOW, fyStartMonth: 4, custom: { from: 'junk', to: '2026-10-01' } })).toEqual({
      from: null,
      to: '2026-10-01',
    });
  });
});

describe('helpers', () => {
  it('validates ISO dates strictly', () => {
    expect(isValidISODate('2026-02-29')).toBe(false);
    expect(isValidISODate('2028-02-29')).toBe(true);
    expect(isValidISODate('2026-13-01')).toBe(false);
    expect(isValidISODate('03/10/2026')).toBe(false);
  });
  it('adds days across month/year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('week range when today is Monday and Sunday', () => {
    expect(weekRange('2026-09-28')).toEqual({ from: '2026-09-28', to: '2026-10-04' });
    expect(weekRange('2026-10-04')).toEqual({ from: '2026-09-28', to: '2026-10-04' });
  });
  it('month range and inRange', () => {
    expect(monthRange('2026-02-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(inRange('2026-10-03', { from: '2026-10-01', to: null })).toBe(true);
    expect(inRange('2026-09-30', { from: '2026-10-01', to: null })).toBe(false);
  });
});
