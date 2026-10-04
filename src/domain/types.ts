import type { BasisPoints, Kg, Paise } from './money';

// ---------------------------------------------------------------------------
// Users & roles
// ---------------------------------------------------------------------------

export const ROLES = ['ADMIN', 'ACCOUNTS', 'OPERATIONS', 'VIEW_ONLY'] as const;
export type Role = (typeof ROLES)[number];

export interface UserProfile {
  uid: string;
  loginId: string;
  displayName: string;
  role: Role;
  active: boolean;
}

// ---------------------------------------------------------------------------
// Parties (buyers, sellers, commission agents, transporters, payment agents)
// ---------------------------------------------------------------------------

export const PARTY_TYPES = ['BUYER', 'SELLER', 'COMMISSION_AGENT', 'TRANSPORTER', 'PAYMENT_AGENT'] as const;
export type PartyType = (typeof PARTY_TYPES)[number];

export const RATE_TYPES = [
  'BUYER_RATE',
  'BUYER_GST',
  'SELLER_RATE',
  'COMMISSION_RATE',
  'FREIGHT_RATE',
  'PAYMENT_AGENT_RATE',
] as const;
export type RateType = (typeof RATE_TYPES)[number];

/** Current default values per rate type. Paise/MT for rates, basis points for GST. */
export type PartyRates = Partial<Record<RateType, number>>;

export interface PartyDefaults {
  commissionAgentId?: string | null;
  transporterId?: string | null;
  paymentAgentId?: string | null;
}

export interface Party {
  id: string;
  type: PartyType;
  /** Human readable code, e.g. BUY-0001 */
  code: string;
  name: string;
  phone: string;
  address: string;
  gstin: string;
  notes: string;
  active: boolean;
  rates: PartyRates;
  defaults: PartyDefaults;
  demo?: boolean;
  createdAt: Date | null;
  createdBy: string;
  updatedAt: Date | null;
  updatedBy: string;
}

export type PartyInput = Pick<Party, 'name' | 'phone' | 'address' | 'gstin' | 'notes' | 'active' | 'defaults'> & {
  rates: PartyRates;
};

// ---------------------------------------------------------------------------
// Rate history
// ---------------------------------------------------------------------------

export interface RateHistoryEntry {
  id: string;
  partyId: string;
  partyType: PartyType;
  rateType: RateType;
  oldRate: number | null;
  newRate: number;
  /** ISO date (YYYY-MM-DD) from which the new default applies. */
  effectiveFrom: string;
  changedBy: string;
  sourceOrderId: string | null;
  sourceOrderNumber: string | null;
  reason: string;
  createdAt: Date | null;
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export type OrderStatus = 'DRAFT' | 'CONFIRMED' | 'CANCELLED';

export type ExtractionStatus = 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'SKIPPED';

/**
 * Where the receipt image lives. In V1 provider is always 'NONE': the image
 * was read in the browser and discarded; only metadata is kept.
 */
export interface ReceiptImageRef {
  provider: 'NONE' | 'FIREBASE_STORAGE';
  ref: string | null;
  fileName: string | null;
  contentType: string | null;
  sizeBytes: number | null;
}

export interface ReceiptSnapshot {
  image: ReceiptImageRef;
  receiptNumber: string;
  driverName: string;
  driverPhone: string;
  vehicleNumber: string;
  destination: string;
  dispatchDate: string;
  netQtyKg: Kg;
  ai: {
    status: ExtractionStatus;
    model: string | null;
    /** Raw model JSON, truncated to a safe length. Never authoritative. */
    raw: string | null;
    error: string | null;
  };
}

export interface BuyerLine {
  id: string;
  name: string;
  ratePaise: Paise;
  gstBp: BasisPoints;
  baseAmount: Paise;
  gstAmount: Paise;
  grossAmount: Paise;
}

export interface SimpleLine {
  id: string | null;
  name: string;
  ratePaise: Paise;
  amount: Paise;
}

/**
 * Payment agent line: `amount` = qty × rate, a commission WE OWE the agent.
 * (Orders saved under the obsolete model stored `received`/`deduction`/
 * `balance` instead; they are read with charge = `deduction` and the old
 * received/balance values are ignored. See docs/DATABASE_SCHEMA.md.)
 */
export type PaymentAgentLine = SimpleLine;

export type PaidKey = 'buyer' | 'seller' | 'commission' | 'freight' | 'paymentAgent';
export type PaidMap = Record<PaidKey, Paise>;

export interface RateDecisionRecord {
  rateType: RateType;
  partyId: string;
  defaultValue: number | null;
  value: number;
  decision: 'ORDER_ONLY' | 'NEW_DEFAULT' | 'UNCHANGED';
}

export interface Order {
  id: string;
  orderNumber: string;
  seq: number;
  status: OrderStatus;
  dispatchDate: string;
  qtyKg: Kg;
  receipt: ReceiptSnapshot;
  buyer: BuyerLine;
  seller: SimpleLine;
  commission: SimpleLine;
  freight: SimpleLine & { destination: string };
  paymentAgent: PaymentAgentLine;
  // Flattened ids for indexed queries
  buyerId: string;
  sellerId: string;
  commissionAgentId: string | null;
  transporterId: string | null;
  paymentAgentId: string | null;
  paid: PaidMap;
  /** True when this order still uses the obsolete payment-agent fields (see PaymentAgentLine). */
  paymentAgentLegacy?: boolean;
  /** Payment whose creation/void last moved `paid` (required by the security rules). */
  lastPaymentId: string | null;
  /** Counter document that allocated the order number, e.g. "orders-2026". */
  counterId: string | null;
  rateDecisions: RateDecisionRecord[];
  searchTokens: string[];
  notes: string;
  version: number;
  cancelReason: string | null;
  demo?: boolean;
  createdAt: Date | null;
  createdBy: string;
  updatedAt: Date | null;
  updatedBy: string;
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export const PAYMENT_CATEGORIES = [
  'BUYER_RECEIPT',
  'SELLER_PAYMENT',
  'COMMISSION_PAYMENT',
  'TRANSPORTER_PAYMENT',
  'PAYMENT_AGENT_SETTLEMENT',
  'OTHER',
] as const;
export type PaymentCategory = (typeof PAYMENT_CATEGORIES)[number];

export const PAYMENT_METHODS = ['BANK', 'UPI', 'CASH', 'CHEQUE', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type PaymentStatus = 'ACTIVE' | 'VOID';

export interface Payment {
  id: string;
  category: PaymentCategory;
  date: string;
  amount: Paise;
  partyId: string | null;
  partyType: PartyType | null;
  partyName: string;
  orderId: string | null;
  orderNumber: string | null;
  method: PaymentMethod;
  reference: string;
  notes: string;
  status: PaymentStatus;
  voidReason: string | null;
  demo?: boolean;
  createdAt: Date | null;
  createdBy: string;
  updatedAt: Date | null;
  updatedBy: string;
}

export type SettlementStatus = 'UNPAID' | 'PARTIAL' | 'PAID' | 'OVERPAID' | 'NOT_APPLICABLE';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface AppSettings {
  businessName: string;
  orderPrefix: string;
  defaultGstBp: BasisPoints;
  /** 1–12; 4 = April (Indian financial year). */
  fyStartMonth: number;
  defaultPaymentAgentId: string | null;
  autoLockMinutes: number;
  /** Full sign-in (password) required after this many days, even with a PIN. */
  maxSessionDays: number;
  aiEnabled: boolean;
  aiModel: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  businessName: 'Sabadra Minerals',
  orderPrefix: 'ROCK',
  defaultGstBp: 500,
  fyStartMonth: 4,
  defaultPaymentAgentId: null,
  autoLockMinutes: 5,
  maxSessionDays: 30,
  aiEnabled: true,
  aiModel: 'gemini-2.5-flash',
};
