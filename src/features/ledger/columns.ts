import { formatDate, formatINR, formatPercent, formatQtyNumber, formatRate, kgToPlainMt, paiseToPlain } from '../../domain/format';
import { orderSettlement, STATUS_LABELS } from '../../domain/payments';
import type { Order, PaidKey, PartyType, SettlementStatus } from '../../domain/types';

export type LedgerKind = 'orders' | 'buyer' | 'seller' | 'commission' | 'freight' | 'paymentAgent';

export interface Column<T> {
  id: string;
  header: string;
  align?: 'right';
  text: (row: T) => string;
  csv: (row: T) => string | number | null;
  /** Values summed in the totals row (base units). */
  sum?: (row: T) => number;
  sumKind?: 'inr' | 'qty';
  link?: (row: T) => string | null;
  /** Column holds a payment-status badge. */
  status?: (row: T) => SettlementStatus;
  /** Sort key for client-side sorting. */
  sortValue?: (row: T) => number | string;
}

export const LEDGER_PAID_KEY: Record<Exclude<LedgerKind, 'orders'>, PaidKey> = {
  buyer: 'buyer',
  seller: 'seller',
  commission: 'commission',
  freight: 'freight',
  paymentAgent: 'paymentAgent',
};

export const LEDGER_PARTY_TYPE: Record<Exclude<LedgerKind, 'orders'>, PartyType> = {
  buyer: 'BUYER',
  seller: 'SELLER',
  commission: 'COMMISSION_AGENT',
  freight: 'TRANSPORTER',
  paymentAgent: 'PAYMENT_AGENT',
};

export const PARTY_LEDGER: Record<PartyType, Exclude<LedgerKind, 'orders'>> = {
  BUYER: 'buyer',
  SELLER: 'seller',
  COMMISSION_AGENT: 'commission',
  TRANSPORTER: 'freight',
  PAYMENT_AGENT: 'paymentAgent',
};

export const LEDGER_TITLES: Record<LedgerKind, string> = {
  orders: 'Orders',
  buyer: 'Buyer ledger (selling)',
  seller: 'Seller ledger (buying)',
  commission: 'Commission ledger',
  freight: 'Freight ledger',
  paymentAgent: 'Payment agent ledger',
};

const inr = (n: number) => formatINR(n);
const plain = (n: number) => paiseToPlain(n);

const orderNo: Column<Order> = {
  id: 'order',
  header: 'Order',
  text: (o) => o.orderNumber,
  csv: (o) => o.orderNumber,
  link: (o) => `/orders/${o.id}`,
  sortValue: (o) => o.orderNumber,
};
const date: Column<Order> = {
  id: 'date',
  header: 'Date',
  text: (o) => formatDate(o.dispatchDate),
  csv: (o) => o.dispatchDate,
  sortValue: (o) => o.dispatchDate,
};
const qty: Column<Order> = {
  id: 'qty',
  header: 'Qty (MT)',
  align: 'right',
  text: (o) => formatQtyNumber(o.qtyKg),
  csv: (o) => kgToPlainMt(o.qtyKg),
  sum: (o) => o.qtyKg,
  sumKind: 'qty',
  sortValue: (o) => o.qtyKg,
};
const money = (id: string, header: string, get: (o: Order) => number): Column<Order> => ({
  id,
  header,
  align: 'right',
  text: (o) => inr(get(o)),
  csv: (o) => plain(get(o)),
  sum: get,
  sumKind: 'inr',
  sortValue: get,
});
const rate = (id: string, header: string, get: (o: Order) => number): Column<Order> => ({
  id,
  header,
  align: 'right',
  text: (o) => formatRate(get(o)),
  csv: (o) => plain(get(o)),
  sortValue: get,
});
const text = (id: string, header: string, get: (o: Order) => string, link?: (o: Order) => string | null): Column<Order> => ({
  id,
  header,
  text: (o) => get(o) || '—',
  csv: (o) => get(o),
  link,
  sortValue: (o) => get(o).toLowerCase(),
});
const settlementCols = (key: PaidKey, paidLabel = 'Paid', outLabel = 'Outstanding'): Column<Order>[] => [
  money(`paid-${key}`, paidLabel, (o) => o.paid[key]),
  money(`out-${key}`, outLabel, (o) => orderSettlement(o, key).outstanding),
  {
    id: `status-${key}`,
    header: 'Status',
    text: (o) => STATUS_LABELS[orderSettlement(o, key).status],
    csv: (o) => STATUS_LABELS[orderSettlement(o, key).status],
    status: (o) => orderSettlement(o, key).status,
  },
];

export function ledgerColumns(kind: LedgerKind): Column<Order>[] {
  switch (kind) {
    case 'orders':
      return [
        orderNo,
        date,
        text('buyer', 'Buyer', (o) => o.buyer.name, (o) => `/buyers/${o.buyerId}`),
        text('seller', 'Seller', (o) => o.seller.name, (o) => `/sellers/${o.sellerId}`),
        text('vehicle', 'Vehicle', (o) => o.receipt.vehicleNumber),
        qty,
        money('gross', 'Buyer total', (o) => o.buyer.grossAmount),
        money('sellerAmt', 'Seller total', (o) => o.seller.amount),
        {
          id: 'status-buyer',
          header: 'Buyer payment',
          text: (o) => STATUS_LABELS[orderSettlement(o, 'buyer').status],
          csv: (o) => STATUS_LABELS[orderSettlement(o, 'buyer').status],
          status: (o) => orderSettlement(o, 'buyer').status,
        },
      ];
    case 'buyer':
      return [
        orderNo,
        date,
        text('buyer', 'Buyer', (o) => o.buyer.name, (o) => `/buyers/${o.buyerId}`),
        qty,
        rate('rate', 'Rate', (o) => o.buyer.ratePaise),
        { id: 'gst', header: 'GST', align: 'right', text: (o) => formatPercent(o.buyer.gstBp), csv: (o) => o.buyer.gstBp / 100 },
        money('base', 'Base', (o) => o.buyer.baseAmount),
        money('gstAmt', 'GST amount', (o) => o.buyer.gstAmount),
        money('gross', 'Total', (o) => o.buyer.grossAmount),
        ...settlementCols('buyer', 'Received'),
      ];
    case 'seller':
      return [
        orderNo,
        date,
        text('seller', 'Seller', (o) => o.seller.name, (o) => `/sellers/${o.sellerId}`),
        qty,
        rate('rate', 'Rate', (o) => o.seller.ratePaise),
        money('amount', 'Purchase value', (o) => o.seller.amount),
        ...settlementCols('seller'),
      ];
    case 'commission':
      return [
        orderNo,
        date,
        text('agent', 'Agent', (o) => o.commission.name, (o) => (o.commissionAgentId ? `/commission-agents/${o.commissionAgentId}` : null)),
        text('buyer', 'Buyer', (o) => o.buyer.name),
        qty,
        rate('rate', 'Rate', (o) => o.commission.ratePaise),
        money('amount', 'Commission', (o) => o.commission.amount),
        ...settlementCols('commission'),
      ];
    case 'freight':
      return [
        orderNo,
        date,
        text('transporter', 'Transporter', (o) => o.freight.name, (o) => (o.transporterId ? `/transporters/${o.transporterId}` : null)),
        text('vehicle', 'Vehicle', (o) => o.receipt.vehicleNumber),
        text('destination', 'Dispatched to', (o) => o.freight.destination || o.receipt.destination),
        qty,
        rate('rate', 'Rate', (o) => o.freight.ratePaise),
        money('amount', 'Freight', (o) => o.freight.amount),
        ...settlementCols('freight'),
      ];
    case 'paymentAgent':
      return [
        orderNo,
        date,
        text('agent', 'Payment agent', (o) => o.paymentAgent.name, (o) => (o.paymentAgentId ? `/payment-agents/${o.paymentAgentId}` : null)),
        text('buyer', 'Buyer', (o) => o.buyer.name),
        qty,
        rate('rate', 'Rate/MT', (o) => o.paymentAgent.ratePaise),
        money('amount', 'Commission payable', (o) => o.paymentAgent.amount),
        ...settlementCols('paymentAgent'),
      ];
  }
}

/** Full-detail columns for the Orders CSV export (every stored figure). */
export function orderExportColumns(): Column<Order>[] {
  return [
    orderNo,
    { id: 'status', header: 'Status', text: (o) => o.status, csv: (o) => o.status },
    date,
    text('receiptNo', 'Receipt no.', (o) => o.receipt.receiptNumber),
    text('vehicle', 'Vehicle', (o) => o.receipt.vehicleNumber),
    text('driver', 'Driver', (o) => o.receipt.driverName),
    text('driverPhone', 'Driver phone', (o) => o.receipt.driverPhone),
    text('destination', 'Destination', (o) => o.receipt.destination),
    qty,
    text('buyer', 'Buyer', (o) => o.buyer.name),
    rate('buyerRate', 'Buyer rate', (o) => o.buyer.ratePaise),
    { id: 'gstPct', header: 'GST %', text: (o) => formatPercent(o.buyer.gstBp), csv: (o) => o.buyer.gstBp / 100 },
    money('base', 'Buyer base', (o) => o.buyer.baseAmount),
    money('gstAmt', 'GST amount', (o) => o.buyer.gstAmount),
    money('gross', 'Buyer total', (o) => o.buyer.grossAmount),
    text('seller', 'Seller', (o) => o.seller.name),
    rate('sellerRate', 'Seller rate', (o) => o.seller.ratePaise),
    money('sellerAmt', 'Seller total', (o) => o.seller.amount),
    text('agent', 'Commission agent', (o) => o.commission.name),
    rate('commRate', 'Commission rate', (o) => o.commission.ratePaise),
    money('comm', 'Commission', (o) => o.commission.amount),
    text('transporter', 'Transporter', (o) => o.freight.name),
    rate('freightRate', 'Freight rate', (o) => o.freight.ratePaise),
    money('freight', 'Freight', (o) => o.freight.amount),
    text('pa', 'Payment agent', (o) => o.paymentAgent.name),
    rate('paRate', 'Payment agent rate', (o) => o.paymentAgent.ratePaise),
    money('paCommission', 'Payment agent commission', (o) => o.paymentAgent.amount),
    money('paidBuyer', 'Received from buyer', (o) => o.paid.buyer),
    money('paidSeller', 'Paid to seller', (o) => o.paid.seller),
    money('paidComm', 'Commission paid', (o) => o.paid.commission),
    money('paidFreight', 'Freight paid', (o) => o.paid.freight),
    money('paidPa', 'Paid to payment agent', (o) => o.paid.paymentAgent),
    text('notes', 'Notes', (o) => o.notes),
    { id: 'cancelReason', header: 'Cancel reason', text: (o) => o.cancelReason ?? '', csv: (o) => o.cancelReason ?? '' },
  ];
}
