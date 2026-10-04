import { describe, expect, it } from 'vitest';
import { calculateOrder } from '../src/domain/calc';
import { CATEGORY_META, emptyPaid, obligationAmount, orderSettlement, settlementStatus } from '../src/domain/payments';

const fin = calculateOrder({
  qtyKg: 38_520,
  buyerRatePaise: 1_250_000,
  gstBp: 500,
  sellerRatePaise: 970_000,
  commissionRatePaise: 72_500,
  freightRatePaise: 85_000,
  paymentAgentRatePaise: 100_000,
});
const order = {
  buyer: { ...fin.buyer, id: 'b', name: 'B' },
  seller: { ...fin.seller, id: 's', name: 'S' },
  commission: { ...fin.commission, id: 'c', name: 'C' },
  freight: { ...fin.freight, id: 't', name: 'T', destination: '' },
  paymentAgent: { ...fin.paymentAgent, id: 'p', name: 'P' },
  paid: emptyPaid(),
};

describe('outstanding & multiple payments', () => {
  it('obligations come from the order snapshot', () => {
    expect(obligationAmount(order, 'buyer')).toBe(50_557_500);
    expect(obligationAmount(order, 'seller')).toBe(37_364_400);
    expect(obligationAmount(order, 'commission')).toBe(2_792_700);
    expect(obligationAmount(order, 'freight')).toBe(3_274_200);
    expect(obligationAmount(order, 'paymentAgent')).toBe(3_852_000); // commission payable
  });

  it('supports several partial freight payments', () => {
    const payments = [1_000_000, 1_500_000, 774_200]; // ₹10,000 + ₹15,000 + ₹7,742
    let paid = 0;
    const statuses: string[] = [];
    for (const p of payments) {
      paid += p;
      statuses.push(orderSettlement({ ...order, paid: { ...emptyPaid(), freight: paid } }, 'freight').status);
    }
    expect(statuses).toEqual(['PARTIAL', 'PARTIAL', 'PAID']);
    expect(orderSettlement({ ...order, paid: { ...emptyPaid(), freight: paid } }, 'freight').outstanding).toBe(0);
  });

  it('computes outstanding after a part payment', () => {
    const s = orderSettlement({ ...order, paid: { ...emptyPaid(), buyer: 20_000_000 } }, 'buyer');
    expect(s.outstanding).toBe(30_557_500);
    expect(s.status).toBe('PARTIAL');
  });

  it('settlement status edge cases', () => {
    expect(settlementStatus(0, 0)).toBe('NOT_APPLICABLE');
    expect(settlementStatus(100, 0)).toBe('UNPAID');
    expect(settlementStatus(100, 150)).toBe('OVERPAID');
  });

  it('categories map to party types and order obligations', () => {
    expect(CATEGORY_META.TRANSPORTER_PAYMENT).toMatchObject({ partyType: 'TRANSPORTER', paidKey: 'freight' });
    expect(CATEGORY_META.PAYMENT_AGENT_SETTLEMENT).toMatchObject({ partyType: 'PAYMENT_AGENT', paidKey: 'paymentAgent', direction: 'OUT', label: 'Payment agent payment' });
    expect(CATEGORY_META.OTHER.paidKey).toBeNull();
  });
});
