import { todayISO } from '../domain/dates';
import { parsePercent, parseQuantityMt, parseRupees } from '../domain/money';
import { AppError } from './errors';
import { uuid } from './firestore';
import { createOrder } from './orders';
import { createParty } from './parties';
import { recordPayment } from './payments';
import { invalidateRollupCache } from './rollups';

/**
 * Optional demo data (only visible when VITE_ENABLE_DEMO_TOOLS=true).
 * Creates parties and the reference 38.52 MT order from the specification,
 * through the SAME services real users use, all tagged `demo: true`.
 * Use a separate Firebase project for demos — financial records can't be deleted.
 */
export async function seedDemoData(orderPrefix: string, onProgress: (msg: string) => void): Promise<string> {
  const r = (s: string) => {
    const v = parseRupees(s);
    if (v === null) throw new AppError('bad demo rate');
    return v;
  };
  onProgress('Creating payment agent…');
  const paId = await createParty(
    'PAYMENT_AGENT',
    { name: 'Demo Payment Agent', phone: '9800000005', address: 'Mumbai', gstin: '', notes: '', active: true, rates: { PAYMENT_AGENT_RATE: r('1000') }, defaults: {} },
    { demo: true },
  );
  onProgress('Creating commission agent…');
  const agentId = await createParty(
    'COMMISSION_AGENT',
    { name: 'Demo Commission Agent', phone: '9800000003', address: 'Pune', gstin: '', notes: '', active: true, rates: { COMMISSION_RATE: r('725') }, defaults: {} },
    { demo: true },
  );
  onProgress('Creating transporter…');
  const transporterId = await createParty(
    'TRANSPORTER',
    { name: 'Demo Roadlines', phone: '9800000004', address: 'Nashik', gstin: '', notes: '', active: true, rates: { FREIGHT_RATE: r('850') }, defaults: {} },
    { demo: true },
  );
  onProgress('Creating buyer and seller…');
  const buyerId = await createParty(
    'BUYER',
    {
      name: 'Demo Buyer Industries',
      phone: '9800000001',
      address: 'Thane',
      gstin: '',
      notes: '',
      active: true,
      rates: { BUYER_RATE: r('12500'), BUYER_GST: parsePercent('5')! },
      defaults: { commissionAgentId: agentId, transporterId, paymentAgentId: paId },
    },
    { demo: true },
  );
  const sellerId = await createParty(
    'SELLER',
    { name: 'Demo Seller Minerals', phone: '9800000002', address: 'Raigad', gstin: '', notes: '', active: true, rates: { SELLER_RATE: r('9700') }, defaults: {} },
    { demo: true },
  );

  onProgress('Creating the 38.52 MT reference order…');
  const keep = 'ORDER_ONLY' as const;
  const result = await createOrder({
    idempotencyKey: uuid(),
    orderPrefix,
    receipt: {
      image: { provider: 'NONE', ref: null, fileName: null, contentType: null, sizeBytes: null },
      receiptNumber: 'DEMO-001',
      driverName: 'Demo Driver',
      driverPhone: '9800000009',
      vehicleNumber: 'MH12AB1234',
      destination: 'Thane',
      dispatchDate: todayISO(),
      netQtyKg: parseQuantityMt('38.52')!,
      ai: { status: 'SKIPPED', model: null, raw: null, error: null },
    },
    buyerId,
    sellerId,
    commissionAgentId: agentId,
    transporterId,
    paymentAgentId: paId,
    rates: {
      buyerRate: { rateType: 'BUYER_RATE', partyId: buyerId, defaultValue: r('12500'), value: r('12500'), decision: keep },
      buyerGst: { rateType: 'BUYER_GST', partyId: buyerId, defaultValue: 500, value: 500, decision: keep },
      sellerRate: { rateType: 'SELLER_RATE', partyId: sellerId, defaultValue: r('9700'), value: r('9700'), decision: keep },
      commissionRate: { rateType: 'COMMISSION_RATE', partyId: agentId, defaultValue: r('725'), value: r('725'), decision: keep },
      freightRate: { rateType: 'FREIGHT_RATE', partyId: transporterId, defaultValue: r('850'), value: r('850'), decision: keep },
      paymentAgentRate: { rateType: 'PAYMENT_AGENT_RATE', partyId: paId, defaultValue: r('1000'), value: r('1000'), decision: keep },
    },
    notes: 'Demo order — expected buyer total ₹5,05,575, balance after payment agent ₹4,67,055.',
    demo: true,
  });

  onProgress('Recording a part payment to the transporter…');
  await recordPayment({
    idempotencyKey: uuid(),
    category: 'TRANSPORTER_PAYMENT',
    date: todayISO(),
    amount: r('10000'),
    partyId: transporterId,
    orderId: result.id,
    method: 'UPI',
    reference: 'DEMO-UPI-1',
    notes: 'Demo advance',
    demo: true,
  });
  invalidateRollupCache();
  return result.orderNumber;
}
