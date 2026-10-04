import { MAX_PAYMENT_PAISE } from './validation';
import type { Paise } from './money';
import type { Order, PaidKey, PaidMap, PartyType, Payment, PaymentCategory, PaymentMethod, SettlementStatus } from './types';

export interface CategoryMeta {
  label: string;
  partyType: PartyType | null;
  /** Which order obligation this payment settles. */
  paidKey: PaidKey | null;
  /** Money coming in (receivable) vs going out (payable). */
  direction: 'IN' | 'OUT' | 'EITHER';
}

export const CATEGORY_META: Record<PaymentCategory, CategoryMeta> = {
  BUYER_RECEIPT: { label: 'Buyer receipt', partyType: 'BUYER', paidKey: 'buyer', direction: 'IN' },
  SELLER_PAYMENT: { label: 'Seller payment', partyType: 'SELLER', paidKey: 'seller', direction: 'OUT' },
  COMMISSION_PAYMENT: {
    label: 'Commission payment',
    partyType: 'COMMISSION_AGENT',
    paidKey: 'commission',
    direction: 'OUT',
  },
  TRANSPORTER_PAYMENT: {
    label: 'Transporter payment',
    partyType: 'TRANSPORTER',
    paidKey: 'freight',
    direction: 'OUT',
  },
  // Stored value kept for compatibility with existing data and rules; it now
  // means a payment WE make to the payment agent against its commission.
  PAYMENT_AGENT_SETTLEMENT: {
    label: 'Payment agent payment',
    partyType: 'PAYMENT_AGENT',
    paidKey: 'paymentAgent',
    direction: 'OUT',
  },
  OTHER: { label: 'Other', partyType: null, paidKey: null, direction: 'EITHER' },
};

export const METHOD_LABELS: Record<PaymentMethod, string> = {
  BANK: 'Bank transfer',
  UPI: 'UPI',
  CASH: 'Cash',
  CHEQUE: 'Cheque',
  OTHER: 'Other',
};

export const PARTY_TO_PAID_KEY: Record<PartyType, PaidKey> = {
  BUYER: 'buyer',
  SELLER: 'seller',
  COMMISSION_AGENT: 'commission',
  TRANSPORTER: 'freight',
  PAYMENT_AGENT: 'paymentAgent',
};

export const PARTY_TO_CATEGORY: Record<PartyType, PaymentCategory> = {
  BUYER: 'BUYER_RECEIPT',
  SELLER: 'SELLER_PAYMENT',
  COMMISSION_AGENT: 'COMMISSION_PAYMENT',
  TRANSPORTER: 'TRANSPORTER_PAYMENT',
  PAYMENT_AGENT: 'PAYMENT_AGENT_SETTLEMENT',
};

export function emptyPaid(): PaidMap {
  return { buyer: 0, seller: 0, commission: 0, freight: 0, paymentAgent: 0 };
}

/**
 * The amount an order owes/receives for each obligation.
 * - buyer: gross amount incl. GST (receivable)
 * - seller / commission / freight: payable
 * - paymentAgent: the agent's commission (qty × rate), payable
 */
export function obligationAmount(order: Pick<Order, 'buyer' | 'seller' | 'commission' | 'freight' | 'paymentAgent'>, key: PaidKey): Paise {
  switch (key) {
    case 'buyer':
      return order.buyer.grossAmount;
    case 'seller':
      return order.seller.amount;
    case 'commission':
      return order.commission.amount;
    case 'freight':
      return order.freight.amount;
    case 'paymentAgent':
      return order.paymentAgent.amount;
  }
}

export function outstanding(obligation: Paise, paid: Paise): Paise {
  return obligation - paid;
}

export function settlementStatus(obligation: Paise, paid: Paise): SettlementStatus {
  if (obligation <= 0 && paid <= 0) return 'NOT_APPLICABLE';
  if (paid <= 0) return 'UNPAID';
  if (paid < obligation) return 'PARTIAL';
  if (paid === obligation) return 'PAID';
  return 'OVERPAID';
}

export function orderSettlement(
  order: Pick<Order, 'buyer' | 'seller' | 'commission' | 'freight' | 'paymentAgent' | 'paid'>,
  key: PaidKey,
): { obligation: Paise; paid: Paise; outstanding: Paise; status: SettlementStatus } {
  const obligation = obligationAmount(order, key);
  const paid = order.paid?.[key] ?? 0;
  return { obligation, paid, outstanding: obligation - paid, status: settlementStatus(obligation, paid) };
}

export const STATUS_LABELS: Record<SettlementStatus, string> = {
  UNPAID: 'Unpaid',
  PARTIAL: 'Part paid',
  PAID: 'Paid',
  OVERPAID: 'Overpaid',
  NOT_APPLICABLE: '—',
};

// ---------------------------------------------------------------------------
// Payment integrity (mirrors firestore.rules; used by services and tests)
// ---------------------------------------------------------------------------

export { MAX_PAYMENT_PAISE };

export class PaymentIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentIntegrityError';
  }
}

type OrderForPayments = Pick<
  Order,
  'buyer' | 'seller' | 'commission' | 'freight' | 'paymentAgent' | 'paid' | 'buyerId' | 'sellerId' | 'commissionAgentId' | 'transporterId' | 'paymentAgentId'
>;

/** Positive whole paise within limits. Rejects 0, negatives, fractions, NaN, Infinity. */
export function assertValidPaymentAmount(amount: unknown): asserts amount is number {
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount)) throw new PaymentIntegrityError('Amount must be a whole number of paise');
  if (amount <= 0) throw new PaymentIntegrityError('Amount must be greater than zero');
  if (amount > MAX_PAYMENT_PAISE) throw new PaymentIntegrityError('Amount is too large');
}

/** Whether a party of `partyType` may receive/pay a payment of `category`. */
export function categoryAcceptsPartyType(category: PaymentCategory, partyType: PartyType | null): boolean {
  const expected = CATEGORY_META[category].partyType;
  if (expected === null) return true; // OTHER: any party or none
  return partyType === expected;
}

/** The party on the order who is the counterparty for this category (null if none / OTHER). */
export function orderPartyFor(order: Pick<Order, 'buyerId' | 'sellerId' | 'commissionAgentId' | 'transporterId' | 'paymentAgentId'>, category: PaymentCategory): string | null {
  switch (CATEGORY_META[category].paidKey) {
    case 'buyer':
      return order.buyerId;
    case 'seller':
      return order.sellerId;
    case 'commission':
      return order.commissionAgentId;
    case 'freight':
      return order.transporterId;
    case 'paymentAgent':
      return order.paymentAgentId;
    default:
      return null;
  }
}

/** Throws unless the payment's category and party really belong to this order. */
export function assertPaymentMatchesOrder(order: OrderForPayments, category: PaymentCategory, partyId: string | null): void {
  if (!CATEGORY_META[category].paidKey) throw new PaymentIntegrityError('"Other" payments cannot be linked to an order');
  const expected = orderPartyFor(order, category);
  if (!expected) throw new PaymentIntegrityError(`This order has no party for ${CATEGORY_META[category].label.toLowerCase()}`);
  if (expected !== partyId) throw new PaymentIntegrityError('That party is not on this order for this payment type');
}

/**
 * New paid map after recording (sign +1) or voiding (sign −1) a payment.
 * Paid totals stay whole paise, never negative, never above the obligation.
 */
export function applyPaymentToOrder(order: OrderForPayments, category: PaymentCategory, amount: number, sign: 1 | -1): PaidMap {
  assertValidPaymentAmount(amount);
  const key = CATEGORY_META[category].paidKey;
  if (!key) throw new PaymentIntegrityError('"Other" payments cannot change order totals');
  const current = order.paid[key] ?? 0;
  const next = current + sign * amount;
  if (!Number.isSafeInteger(next) || next < 0) throw new PaymentIntegrityError('Paid total would become negative');
  const obligation = obligationAmount(order, key);
  if (next > Math.max(0, obligation)) {
    throw new PaymentIntegrityError(`This is more than the outstanding amount (${Math.max(0, obligation - current)} paise)`);
  }
  return { ...order.paid, [key]: next };
}

/** Keys whose paid total is invalid (non-integer, negative, or above the obligation). */
export function invalidPaidKeys(order: OrderForPayments): PaidKey[] {
  return (Object.keys(PARTY_TO_PAID_KEY_VALUES) as PaidKey[]).filter((k) => {
    const v = order.paid[k];
    return !Number.isSafeInteger(v) || v < 0 || (v > 0 && v > obligationAmount(order, k));
  });
}
const PARTY_TO_PAID_KEY_VALUES: Record<PaidKey, true> = { buyer: true, seller: true, commission: true, freight: true, paymentAgent: true };

export interface PaidMismatch {
  orderId: string;
  key: PaidKey;
  cached: number;
  fromPayments: number;
}

/** Recomputes each order's paid totals from ACTIVE payments and lists differences from the cached values. */
export function reconcileOrderPaid(
  orders: readonly (Pick<Order, 'id' | 'paid'>)[],
  payments: readonly Pick<Payment, 'orderId' | 'category' | 'amount' | 'status'>[],
): PaidMismatch[] {
  const sums = new Map<string, PaidMap>();
  for (const p of payments) {
    const key = CATEGORY_META[p.category].paidKey;
    if (p.status !== 'ACTIVE' || !p.orderId || !key) continue;
    const m = sums.get(p.orderId) ?? emptyPaid();
    m[key] += p.amount;
    sums.set(p.orderId, m);
  }
  const out: PaidMismatch[] = [];
  for (const o of orders) {
    const actual = sums.get(o.id) ?? emptyPaid();
    for (const k of Object.keys(actual) as PaidKey[]) {
      if ((o.paid[k] ?? 0) !== actual[k]) out.push({ orderId: o.id, key: k, cached: o.paid[k] ?? 0, fromPayments: actual[k] });
    }
  }
  return out;
}
