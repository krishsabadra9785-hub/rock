import { describe, expect, it } from 'vitest';
import { escapeCsvCell, toCsv } from '../src/domain/csv';
import { formatOrderNumber, formatPartyCode, nextSequence, orderCounterId, parseOrderNumber, sanitizePrefix } from '../src/domain/orderNumber';
import { buildSearchTokens, matchesQuery, queryToToken } from '../src/domain/search';
import { can } from '../src/domain/permissions';

describe('order numbering', () => {
  it('formats sequential numbers', () => {
    expect(formatOrderNumber('ROCK', 2026, 1)).toBe('ROCK-2026-000001');
    expect(formatOrderNumber('rock', 2026, 123456)).toBe('ROCK-2026-123456');
    expect(formatOrderNumber('ROCK', 2026, 1234567)).toBe('ROCK-2026-1234567');
  });
  it('sequence increments from the stored counter', () => {
    expect(nextSequence(undefined)).toBe(1);
    expect(nextSequence(41)).toBe(42);
    expect(() => nextSequence(-1)).toThrow();
  });
  it('parses and sanitises', () => {
    expect(parseOrderNumber('ROCK-2026-000042')).toEqual({ prefix: 'ROCK', year: 2026, seq: 42 });
    expect(parseOrderNumber('nope')).toBeNull();
    expect(sanitizePrefix('r o-ck!')).toBe('ROCK');
    expect(sanitizePrefix('')).toBe('ROCK');
    expect(orderCounterId(2026)).toBe('orders-2026');
    expect(formatPartyCode('BUYER', 7)).toBe('BUY-0007');
  });
  it('rejects invalid sequence or year', () => {
    expect(() => formatOrderNumber('ROCK', 2026, 0)).toThrow();
    expect(() => formatOrderNumber('ROCK', 1999, 1)).toThrow();
  });
});

describe('CSV export', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell(null)).toBe('');
  });
  it('neutralises formula injection but keeps negative numbers', () => {
    expect(escapeCsvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(escapeCsvCell('-500.00')).toBe('-500.00');
  });
  it('builds an Excel-friendly file', () => {
    const csv = toCsv([{ a: 1, b: 'x' }], [
      { header: 'A', value: (r) => r.a },
      { header: 'B', value: (r) => r.b },
    ]);
    expect(csv).toBe('\uFEFFA,B\r\n1,x\r\n');
  });
});

describe('search tokens', () => {
  const tokens = buildSearchTokens({
    exact: ['ROCK-2026-000123', 'MH12AB1234', '+91 98765 43210', 'WB-5521'],
    text: ['Rajesh Traders', 'Pune'],
  });
  it('indexes order number, vehicle, phone and receipt', () => {
    expect(tokens).toContain('rock2026000123');
    expect(tokens).toContain('123');
    expect(tokens).toContain('mh12ab1234');
    expect(tokens).toContain('9876543210');
    expect(tokens).toContain('wb5521');
  });
  it('indexes name prefixes', () => {
    expect(tokens).toContain('raj');
    expect(tokens).toContain('rajesh');
    expect(tokens).toContain('pun');
  });
  it('turns queries into tokens', () => {
    expect(queryToToken('MH 12 AB 1234')).toBe('mh12ab1234');
    expect(queryToToken('  Rajesh ')).toBe('rajesh');
    expect(queryToToken('   ')).toBeNull();
  });
  it('client-side match is case/format insensitive', () => {
    expect(matchesQuery(['MH12AB1234'], 'mh 12')).toBe(true);
    expect(matchesQuery(['Pune'], 'delhi')).toBe(false);
  });
});

describe('permissions', () => {
  it('view-only users cannot write', () => {
    expect(can('VIEW_ONLY', 'order.create')).toBe(false);
    expect(can('OPERATIONS', 'order.create')).toBe(true);
    expect(can('OPERATIONS', 'payment.create')).toBe(false);
    expect(can('ADMIN', 'users.manage')).toBe(true);
    expect(can(null, 'order.create')).toBe(false);
  });
});
