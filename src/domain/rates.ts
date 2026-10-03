import type { PartyRates, PartyType, RateDecisionRecord, RateType } from './types';

/**
 * The universal rate engine.
 *
 * One rule for every reusable rate (buyer rate, buyer GST, seller rate,
 * commission rate, freight rate, payment-agent rate, and any future type):
 *
 *   1. A new order is pre-filled with the party's CURRENT DEFAULT.
 *   2. If the user changes it, they choose:
 *        ORDER_ONLY  → the order uses the new value, the default is untouched.
 *        NEW_DEFAULT → the order uses the new value AND it becomes the default
 *                      for future orders (a rate-history entry is written).
 *   3. Orders store their own copy (snapshot) of every rate, so changing a
 *      default never touches historical orders.
 */

export type RateUnit = 'PAISE_PER_MT' | 'BASIS_POINTS';

export interface RateMeta {
  label: string;
  shortLabel: string;
  unit: RateUnit;
  partyType: PartyType;
}

export const RATE_META: Record<RateType, RateMeta> = {
  BUYER_RATE: { label: 'Buyer rate', shortLabel: 'Rate', unit: 'PAISE_PER_MT', partyType: 'BUYER' },
  BUYER_GST: { label: 'Buyer GST', shortLabel: 'GST', unit: 'BASIS_POINTS', partyType: 'BUYER' },
  SELLER_RATE: { label: 'Seller rate', shortLabel: 'Rate', unit: 'PAISE_PER_MT', partyType: 'SELLER' },
  COMMISSION_RATE: {
    label: 'Commission rate',
    shortLabel: 'Commission',
    unit: 'PAISE_PER_MT',
    partyType: 'COMMISSION_AGENT',
  },
  FREIGHT_RATE: { label: 'Freight rate', shortLabel: 'Freight', unit: 'PAISE_PER_MT', partyType: 'TRANSPORTER' },
  PAYMENT_AGENT_RATE: {
    label: 'Payment agent rate',
    shortLabel: 'Charge',
    unit: 'PAISE_PER_MT',
    partyType: 'PAYMENT_AGENT',
  },
};

export const RATE_TYPES_BY_PARTY: Record<PartyType, RateType[]> = {
  BUYER: ['BUYER_RATE', 'BUYER_GST'],
  SELLER: ['SELLER_RATE'],
  COMMISSION_AGENT: ['COMMISSION_RATE'],
  TRANSPORTER: ['FREIGHT_RATE'],
  PAYMENT_AGENT: ['PAYMENT_AGENT_RATE'],
};

/** The headline per-MT rate for each party type. */
export const PRIMARY_RATE: Record<PartyType, RateType> = {
  BUYER: 'BUYER_RATE',
  SELLER: 'SELLER_RATE',
  COMMISSION_AGENT: 'COMMISSION_RATE',
  TRANSPORTER: 'FREIGHT_RATE',
  PAYMENT_AGENT: 'PAYMENT_AGENT_RATE',
};

export type RateDecision = 'ORDER_ONLY' | 'NEW_DEFAULT';

export interface RateSelection {
  rateType: RateType;
  partyId: string;
  /** The party's default at the moment the order form loaded (null = none yet). */
  defaultValue: number | null;
  /** The value the user wants on this order. */
  value: number;
  decision: RateDecision;
}

export interface ResolvedRate {
  /** Value snapshotted onto the order. */
  orderValue: number;
  /** New master default to save, or null when the default doesn't change. */
  newDefault: number | null;
  record: RateDecisionRecord;
}

export function defaultRateFor(rates: PartyRates | undefined, rateType: RateType): number | null {
  const v = rates?.[rateType];
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
}

export function isRateChanged(sel: Pick<RateSelection, 'defaultValue' | 'value'>): boolean {
  return sel.defaultValue !== sel.value;
}

/**
 * Suggested decision when the user edits a field. When the party has no
 * default yet, the first value entered naturally becomes the default.
 */
export function suggestDecision(defaultValue: number | null): RateDecision {
  return defaultValue === null ? 'NEW_DEFAULT' : 'ORDER_ONLY';
}

export function resolveRateSelection(sel: RateSelection): ResolvedRate {
  if (!Number.isSafeInteger(sel.value) || sel.value < 0) {
    throw new Error(`Invalid value for ${RATE_META[sel.rateType].label}`);
  }
  const changed = isRateChanged(sel);
  const newDefault = changed && sel.decision === 'NEW_DEFAULT' ? sel.value : null;
  return {
    orderValue: sel.value,
    newDefault,
    record: {
      rateType: sel.rateType,
      partyId: sel.partyId,
      defaultValue: sel.defaultValue,
      value: sel.value,
      decision: changed ? sel.decision : 'UNCHANGED',
    },
  };
}

/** Returns a NEW rates object with the default replaced (never mutates). */
export function applyDefaultChange(rates: PartyRates, rateType: RateType, newValue: number): PartyRates {
  return { ...rates, [rateType]: newValue };
}

export interface RateHistoryDraft {
  partyId: string;
  partyType: PartyType;
  rateType: RateType;
  oldRate: number | null;
  newRate: number;
  effectiveFrom: string;
  changedBy: string;
  sourceOrderId: string | null;
  sourceOrderNumber: string | null;
  reason: string;
}

export function buildRateHistoryEntry(params: RateHistoryDraft): RateHistoryDraft {
  if (params.oldRate === params.newRate) {
    throw new Error('Rate history entries must record an actual change');
  }
  if (RATE_META[params.rateType].partyType !== params.partyType) {
    throw new Error(`${params.rateType} does not belong to ${params.partyType}`);
  }
  return { ...params };
}
