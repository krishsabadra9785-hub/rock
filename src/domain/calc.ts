import { amountForQuantity, isSafeInt, percentOf, type BasisPoints, type Kg, type Paise } from './money';

/**
 * Every rupee figure on an order is produced by this one function so the UI,
 * the saved snapshot, reports and tests can never disagree.
 *
 * Formulas (all amounts rounded half-up to the paisa, once):
 *   Buyer base          = qty × buyer rate
 *   GST                 = buyer base × GST%
 *   Buyer gross         = buyer base + GST
 *   Seller total        = qty × seller rate (all-inclusive)
 *   Commission          = qty × commission rate
 *   Freight             = qty × freight rate
 *   Payment agent gets  = buyer gross
 *   Payment agent charge= qty × payment-agent rate
 *   Balance passed on   = buyer gross − payment agent charge
 */

export interface OrderRateInputs {
  qtyKg: Kg;
  buyerRatePaise: Paise;
  gstBp: BasisPoints;
  sellerRatePaise: Paise;
  commissionRatePaise: Paise;
  freightRatePaise: Paise;
  paymentAgentRatePaise: Paise;
}

export interface OrderFinancials {
  qtyKg: Kg;
  buyer: {
    ratePaise: Paise;
    gstBp: BasisPoints;
    /** Per-MT rate including GST, for display (₹12,500 + 5% → ₹13,125). */
    effectiveRatePaise: Paise;
    baseAmount: Paise;
    gstAmount: Paise;
    grossAmount: Paise;
  };
  seller: { ratePaise: Paise; amount: Paise };
  commission: { ratePaise: Paise; amount: Paise };
  freight: { ratePaise: Paise; amount: Paise };
  paymentAgent: { ratePaise: Paise; received: Paise; deduction: Paise; balance: Paise };
}

export class CalculationError extends Error {
  constructor(public readonly field: keyof OrderRateInputs, message: string) {
    super(message);
    this.name = 'CalculationError';
  }
}

export const MAX_GST_BP = 10_000; // 100%

function check(field: keyof OrderRateInputs, value: number, allowZero: boolean): void {
  if (!isSafeInt(value)) throw new CalculationError(field, `${field} is not a valid number`);
  if (value < 0 || (!allowZero && value === 0)) {
    throw new CalculationError(field, allowZero ? `${field} cannot be negative` : `${field} must be greater than zero`);
  }
}

export function validateRateInputs(inputs: OrderRateInputs): void {
  check('qtyKg', inputs.qtyKg, false);
  check('buyerRatePaise', inputs.buyerRatePaise, true);
  check('gstBp', inputs.gstBp, true);
  if (inputs.gstBp > MAX_GST_BP) throw new CalculationError('gstBp', 'GST cannot exceed 100%');
  check('sellerRatePaise', inputs.sellerRatePaise, true);
  check('commissionRatePaise', inputs.commissionRatePaise, true);
  check('freightRatePaise', inputs.freightRatePaise, true);
  check('paymentAgentRatePaise', inputs.paymentAgentRatePaise, true);
}

export function calculateOrder(inputs: OrderRateInputs): OrderFinancials {
  validateRateInputs(inputs);
  const { qtyKg } = inputs;

  const baseAmount = amountForQuantity(qtyKg, inputs.buyerRatePaise);
  const gstAmount = percentOf(baseAmount, inputs.gstBp);
  const grossAmount = baseAmount + gstAmount;

  const paDeduction = amountForQuantity(qtyKg, inputs.paymentAgentRatePaise);

  return {
    qtyKg,
    buyer: {
      ratePaise: inputs.buyerRatePaise,
      gstBp: inputs.gstBp,
      effectiveRatePaise: inputs.buyerRatePaise + percentOf(inputs.buyerRatePaise, inputs.gstBp),
      baseAmount,
      gstAmount,
      grossAmount,
    },
    seller: { ratePaise: inputs.sellerRatePaise, amount: amountForQuantity(qtyKg, inputs.sellerRatePaise) },
    commission: {
      ratePaise: inputs.commissionRatePaise,
      amount: amountForQuantity(qtyKg, inputs.commissionRatePaise),
    },
    freight: { ratePaise: inputs.freightRatePaise, amount: amountForQuantity(qtyKg, inputs.freightRatePaise) },
    paymentAgent: {
      ratePaise: inputs.paymentAgentRatePaise,
      received: grossAmount,
      deduction: paDeduction,
      balance: grossAmount - paDeduction,
    },
  };
}

/** Safe variant for live UI previews: returns null instead of throwing. */
export function tryCalculateOrder(inputs: Partial<OrderRateInputs>): OrderFinancials | null {
  const full: OrderRateInputs = {
    qtyKg: inputs.qtyKg ?? 0,
    buyerRatePaise: inputs.buyerRatePaise ?? 0,
    gstBp: inputs.gstBp ?? 0,
    sellerRatePaise: inputs.sellerRatePaise ?? 0,
    commissionRatePaise: inputs.commissionRatePaise ?? 0,
    freightRatePaise: inputs.freightRatePaise ?? 0,
    paymentAgentRatePaise: inputs.paymentAgentRatePaise ?? 0,
  };
  try {
    return calculateOrder(full);
  } catch {
    return null;
  }
}
