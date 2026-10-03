import { isValidISODate } from './dates';
import { kgToInput, mtNumberToKg } from './money';
import { normalizeVehicleNumber, validatePhone } from './validation';

/**
 * AI output is NEVER trusted. This module turns whatever the model returned
 * into editable form values plus a per-field status the UI can show:
 *   FOUND     – parsed and passes validation with good confidence
 *   UNCERTAIN – parsed, but low confidence or suspicious (needs a look)
 *   MISSING   – not present on the receipt / not detected
 *   INVALID   – present but unusable (wrong type/format); field left blank
 */

export const EXTRACTION_FIELDS = [
  'netQuantity',
  'driverName',
  'driverPhone',
  'dispatchDate',
  'vehicleNumber',
  'receiptNumber',
  'destination',
] as const;
export type ExtractionField = (typeof EXTRACTION_FIELDS)[number];

export type FieldStatus = 'FOUND' | 'UNCERTAIN' | 'MISSING' | 'INVALID';

export interface ExtractedField {
  /** String value ready for an input box ('' when missing/invalid). */
  value: string;
  status: FieldStatus;
  confidence: number | null;
  note: string | null;
}

export interface ParsedExtraction {
  fields: Record<ExtractionField, ExtractedField>;
  readable: boolean;
  modelNotes: string;
  /** SUCCESS: all key fields found; PARTIAL: something needs attention; FAILED: nothing usable. */
  overall: 'SUCCESS' | 'PARTIAL' | 'FAILED';
}

export const FIELD_LABELS: Record<ExtractionField, string> = {
  netQuantity: 'Net quantity (MT)',
  driverName: 'Driver name',
  driverPhone: 'Driver phone',
  dispatchDate: 'Dispatch date',
  vehicleNumber: 'Vehicle number',
  receiptNumber: 'Receipt / challan no.',
  destination: 'Destination',
};

export const CONFIDENCE_THRESHOLD = 0.75;
/** A single truck rarely carries more than this; larger values are probably kg read as MT. */
export const SUSPICIOUS_MT = 80;

export class ExtractionParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractionParseError';
  }
}

/** Removes ``` fences and surrounding prose, then JSON.parses. */
export function parseModelJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end <= start) throw new ExtractionParseError('The AI response did not contain JSON');
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    throw new ExtractionParseError('The AI response was not valid JSON');
  }
}

interface RawField {
  value?: unknown;
  unit?: unknown;
  confidence?: unknown;
}

function asRawField(v: unknown): RawField | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && !Array.isArray(v)) return v as RawField;
  // Tolerate models that return the bare value.
  return { value: v };
}

function confidenceOf(f: RawField | null): number | null {
  const c = f?.confidence;
  if (typeof c !== 'number' || !Number.isFinite(c)) return null;
  return Math.min(1, Math.max(0, c));
}

const missing = (): ExtractedField => ({ value: '', status: 'MISSING', confidence: null, note: null });
const invalid = (note: string, confidence: number | null): ExtractedField => ({
  value: '',
  status: 'INVALID',
  confidence,
  note,
});

function graded(value: string, confidence: number | null, note: string | null = null, forceUncertain = false): ExtractedField {
  const uncertain = forceUncertain || confidence === null || confidence < CONFIDENCE_THRESHOLD;
  return { value, status: uncertain ? 'UNCERTAIN' : 'FOUND', confidence, note: note ?? (uncertain && !forceUncertain ? 'Low confidence — please check' : null) };
}

function cleanString(v: unknown, max = 120): string | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  if (!s || /^(null|n\/?a|none|unknown|-)$/i.test(s)) return null;
  return s.slice(0, max);
}

function parseQuantity(f: RawField | null): ExtractedField {
  if (!f || f.value === null || f.value === undefined || f.value === '') return missing();
  const conf = confidenceOf(f);
  let num: number;
  if (typeof f.value === 'number') num = f.value;
  else if (typeof f.value === 'string') {
    const cleaned = f.value.replace(/,/g, '').match(/\d+(?:\.\d+)?/);
    if (!cleaned) return invalid('Could not read a number', conf);
    num = Number(cleaned[0]);
  } else return invalid('Not a number', conf);
  if (!Number.isFinite(num) || num <= 0) return invalid('Quantity must be greater than 0', conf);

  const unit = typeof f.unit === 'string' ? f.unit.trim().toUpperCase() : 'MT';
  let kg: number | null;
  let note: string | null = null;
  if (unit === 'KG' || unit === 'KGS') {
    kg = Math.round(num);
    note = `Converted from ${num} kg`;
  } else if (unit === 'QUINTAL' || unit === 'QTL') {
    kg = Math.round(num * 100);
    note = `Converted from ${num} quintal`;
  } else {
    kg = mtNumberToKg(num);
  }
  if (kg === null || kg <= 0) return invalid('Quantity could not be converted', conf);
  const suspicious = kg > SUSPICIOUS_MT * 1000;
  return graded(
    kgToInput(kg),
    conf,
    suspicious ? 'Unusually large — check whether this was kg, not MT' : note,
    suspicious || note !== null,
  );
}

function parseDate(f: RawField | null): ExtractedField {
  const raw = cleanString(f?.value, 40);
  if (!raw) return missing();
  const conf = confidenceOf(f);
  if (isValidISODate(raw)) return graded(raw, conf);
  // Accept DD/MM/YYYY or DD-MM-YYYY (Indian convention) as a fallback.
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(raw);
  if (m) {
    const y = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
    const iso = `${y}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
    if (isValidISODate(iso)) return graded(iso, conf, 'Read as day/month/year — please check', true);
  }
  return invalid(`Unrecognised date "${raw}"`, conf);
}

function parsePhone(f: RawField | null): ExtractedField {
  const raw = cleanString(f?.value, 30);
  if (!raw) return missing();
  const conf = confidenceOf(f);
  const r = validatePhone(raw, true);
  if (!r.ok) return { value: raw, status: 'UNCERTAIN', confidence: conf, note: r.error };
  return graded(r.value, conf);
}

function parseVehicle(f: RawField | null): ExtractedField {
  const raw = cleanString(f?.value, 20);
  if (!raw) return missing();
  const conf = confidenceOf(f);
  const v = normalizeVehicleNumber(raw);
  if (v.length < 4) return { value: v, status: 'UNCERTAIN', confidence: conf, note: 'Looks incomplete' };
  // Typical Indian format: MH12AB1234 / KA01A1234 / 22BH1234AA
  const typical = /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{3,4}$/.test(v) || /^\d{2}BH\d{4}[A-Z]{1,2}$/.test(v);
  return graded(v, conf, typical ? null : 'Unusual format — please check', !typical);
}

function parseText(f: RawField | null, max = 120): ExtractedField {
  const raw = cleanString(f?.value, max);
  if (!raw) return missing();
  return graded(raw, confidenceOf(f));
}

export function parseExtraction(raw: unknown): ParsedExtraction {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ExtractionParseError('The AI response had an unexpected shape');
  }
  const r = raw as Record<string, unknown>;
  const fields: Record<ExtractionField, ExtractedField> = {
    netQuantity: parseQuantity(asRawField(r.netQuantity)),
    driverName: parseText(asRawField(r.driverName), 80),
    driverPhone: parsePhone(asRawField(r.driverPhone)),
    dispatchDate: parseDate(asRawField(r.dispatchDate)),
    vehicleNumber: parseVehicle(asRawField(r.vehicleNumber)),
    receiptNumber: parseText(asRawField(r.receiptNumber), 40),
    destination: parseText(asRawField(r.destination), 120),
  };
  const readable = r.readable !== false;
  const statuses = EXTRACTION_FIELDS.map((k) => fields[k].status);
  const found = statuses.filter((s) => s === 'FOUND' || s === 'UNCERTAIN').length;
  const overall: ParsedExtraction['overall'] =
    !readable || found === 0 ? 'FAILED' : statuses.every((s) => s === 'FOUND') ? 'SUCCESS' : 'PARTIAL';
  return {
    fields,
    readable,
    modelNotes: cleanString(r.notes, 300) ?? '',
    overall,
  };
}

export function emptyExtraction(): ParsedExtraction {
  const fields = {} as Record<ExtractionField, ExtractedField>;
  for (const k of EXTRACTION_FIELDS) fields[k] = missing();
  return { fields, readable: false, modelNotes: '', overall: 'FAILED' };
}

export const EXTRACTION_PROMPT = `You read Indian goods dispatch documents: weighbridge slips, delivery challans,
lorry receipts and e-way bills for bulk material sold by the metric tonne.
Extract only what is printed or clearly handwritten. Never guess or invent values.

Rules:
- netQuantity: the NET weight (gross minus tare). Never return gross or tare as net.
  Give the number exactly as shown and its unit ("MT", "KG" or "QUINTAL").
- dispatchDate: ISO format YYYY-MM-DD. Indian documents write dates day-first (DD/MM/YYYY).
- vehicleNumber: the truck registration, e.g. MH12AB1234.
- driverPhone: digits only.
- receiptNumber: the slip / challan / LR / bill number.
- destination: the "to", "consignee address" or "dispatched to" place.
- For every field give confidence between 0 and 1. If a field is absent or unreadable set value to null.
- Set readable to false if the image is not a dispatch document or is too blurry to read.`;
