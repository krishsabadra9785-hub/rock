import type { Paise } from './money';
import type { Order, PaidKey, PaidMap, PartyType, PaymentCategory, PaymentMethod, SettlementStatus } from './types';

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
  PAYMENT_AGENT_SETTLEMENT: {
    label: 'Payment agent settlement',
    partyType: 'PAYMENT_AGENT',
    paidKey: 'paymentAgent',
    direction: 'IN',
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
 * - paymentAgent: balance after the agent's deduction, due to us from the agent
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
      return order.paymentAgent.balance;
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
