import { describe, expect, it } from 'vitest';
import { ExtractionParseError, parseExtraction, parseModelJson } from '../src/domain/extraction';

describe('AI extraction parsing', () => {
  it('parses a clean structured response', () => {
    const r = parseExtraction({
      netQuantity: { value: 38.52, unit: 'MT', confidence: 0.95 },
      driverName: { value: 'Ramesh Patil', confidence: 0.9 },
      driverPhone: { value: '9876543210', confidence: 0.92 },
      dispatchDate: { value: '2026-10-03', confidence: 0.9 },
      vehicleNumber: { value: 'MH 12 AB 1234', confidence: 0.88 },
      receiptNumber: { value: 'WB-5521', confidence: 0.9 },
      destination: { value: 'Pune', confidence: 0.8 },
      readable: true,
    });
    expect(r.overall).toBe('SUCCESS');
    expect(r.fields.netQuantity.value).toBe('38.52');
    expect(r.fields.vehicleNumber.value).toBe('MH12AB1234');
  });

  it('converts kg to MT and flags it for review', () => {
    const r = parseExtraction({ netQuantity: { value: '38,520', unit: 'KG', confidence: 0.9 } });
    expect(r.fields.netQuantity.value).toBe('38.52');
    expect(r.fields.netQuantity.status).toBe('UNCERTAIN');
  });

  it('flags implausibly large MT values', () => {
    const r = parseExtraction({ netQuantity: { value: 38520, unit: 'MT', confidence: 0.99 } });
    expect(r.fields.netQuantity.status).toBe('UNCERTAIN');
  });

  it('marks low confidence as uncertain and missing as missing', () => {
    const r = parseExtraction({ driverName: { value: 'R. Patil', confidence: 0.4 }, driverPhone: { value: null, confidence: 0 } });
    expect(r.fields.driverName.status).toBe('UNCERTAIN');
    expect(r.fields.driverPhone.status).toBe('MISSING');
    expect(r.fields.destination.status).toBe('MISSING');
    expect(r.overall).toBe('PARTIAL');
  });

  it('rejects wrong types instead of saving them', () => {
    const r = parseExtraction({ netQuantity: { value: { nested: true }, confidence: 1 }, dispatchDate: { value: 'yesterday', confidence: 1 } });
    expect(r.fields.netQuantity.status).toBe('INVALID');
    expect(r.fields.netQuantity.value).toBe('');
    expect(r.fields.dispatchDate.status).toBe('INVALID');
  });

  it('accepts DD/MM/YYYY but asks for confirmation', () => {
    const r = parseExtraction({ dispatchDate: { value: '03/10/2026', confidence: 0.9 } });
    expect(r.fields.dispatchDate.value).toBe('2026-10-03');
    expect(r.fields.dispatchDate.status).toBe('UNCERTAIN');
  });

  it('treats "null"/"N/A" strings as missing', () => {
    const r = parseExtraction({ receiptNumber: { value: 'N/A', confidence: 0.9 } });
    expect(r.fields.receiptNumber.status).toBe('MISSING');
  });

  it('unreadable documents fail overall', () => {
    expect(parseExtraction({ readable: false }).overall).toBe('FAILED');
    expect(parseExtraction({}).overall).toBe('FAILED');
  });

  it('throws on non-object responses', () => {
    expect(() => parseExtraction(null)).toThrow(ExtractionParseError);
    expect(() => parseExtraction([1, 2])).toThrow(ExtractionParseError);
  });

  it('extracts JSON from fenced or chatty model text', () => {
    expect(parseModelJson('```json\n{"readable":true}\n```')).toEqual({ readable: true });
    expect(parseModelJson('Here you go: {"a":1} thanks')).toEqual({ a: 1 });
    expect(() => parseModelJson('no json here')).toThrow(ExtractionParseError);
    expect(() => parseModelJson('{broken')).toThrow(ExtractionParseError);
  });
});
