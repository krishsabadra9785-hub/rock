import { useState } from 'react';
import { AmountInput, Button, Field, Modal, Notice, TextArea, TextInput } from '../../components/ui';
import { tryCalculateOrder } from '../../domain/calc';
import { formatINR } from '../../domain/format';
import { bpToInput, kgToInput, paiseToInput, parsePercent, parseQuantityMt, parseRupees } from '../../domain/money';
import type { Order } from '../../domain/types';
import { friendlyError } from '../../services/errors';
import { editOrder } from '../../services/orders';
import { invalidateRollupCache } from '../../services/rollups';
import { useToast } from '../../state/ToastProvider';

/** Corrections to a confirmed order: audited, reasoned, never touches master defaults. */
export function EditOrderDialog({ order, onClose }: { order: Order; onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    receiptNumber: order.receipt.receiptNumber,
    driverName: order.receipt.driverName,
    driverPhone: order.receipt.driverPhone,
    vehicleNumber: order.receipt.vehicleNumber,
    destination: order.receipt.destination,
    dispatchDate: order.dispatchDate,
    qty: kgToInput(order.qtyKg),
    buyerRate: paiseToInput(order.buyer.ratePaise),
    gst: bpToInput(order.buyer.gstBp),
    sellerRate: paiseToInput(order.seller.ratePaise),
    commissionRate: paiseToInput(order.commission.ratePaise),
    freightRate: paiseToInput(order.freight.ratePaise),
    paRate: paiseToInput(order.paymentAgent.ratePaise),
    notes: order.notes,
    reason: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: Extract<keyof typeof f, string>) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  const n = {
    qtyKg: parseQuantityMt(f.qty),
    buyerRatePaise: parseRupees(f.buyerRate),
    gstBp: parsePercent(f.gst),
    sellerRatePaise: parseRupees(f.sellerRate),
    commissionRatePaise: order.commissionAgentId ? parseRupees(f.commissionRate) : 0,
    freightRatePaise: order.transporterId ? parseRupees(f.freightRate) : 0,
    paymentAgentRatePaise: order.paymentAgentId ? parseRupees(f.paRate) : 0,
  };
  const fin = tryCalculateOrder({
    qtyKg: n.qtyKg ?? undefined,
    buyerRatePaise: n.buyerRatePaise ?? undefined,
    gstBp: n.gstBp ?? undefined,
    sellerRatePaise: n.sellerRatePaise ?? undefined,
    commissionRatePaise: n.commissionRatePaise ?? undefined,
    freightRatePaise: n.freightRatePaise ?? undefined,
    paymentAgentRatePaise: n.paymentAgentRatePaise ?? undefined,
  });

  const save = async () => {
    if (!fin || Object.values(n).some((v) => v === null)) return setError('Check the quantity and rates — one of them is not a valid number.');
    setBusy(true);
    setError(null);
    try {
      await editOrder(order.id, {
        expectedVersion: order.version,
        receiptNumber: f.receiptNumber,
        driverName: f.driverName,
        driverPhone: f.driverPhone,
        vehicleNumber: f.vehicleNumber,
        destination: f.destination,
        dispatchDate: f.dispatchDate,
        qtyKg: n.qtyKg!,
        buyerRatePaise: n.buyerRatePaise!,
        gstBp: n.gstBp!,
        sellerRatePaise: n.sellerRatePaise!,
        commissionRatePaise: n.commissionRatePaise!,
        freightRatePaise: n.freightRatePaise!,
        paymentAgentRatePaise: n.paymentAgentRatePaise!,
        notes: f.notes,
        reason: f.reason,
      });
      invalidateRollupCache();
      toast.success(`${order.orderNumber} corrected`);
      onClose();
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    }
  };

  const text = (k: Extract<keyof typeof f, string>, label: string, type = 'text') => (
    <Field label={label} htmlFor={`e-${k}`}>
      <TextInput id={`e-${k}`} type={type} value={f[k]} onChange={(e) => set(k)(e.target.value)} />
    </Field>
  );
  const amount = (k: Extract<keyof typeof f, string>, label: string, suffix = '/MT', disabled = false) => (
    <Field label={label} htmlFor={`e-${k}`}>
      <AmountInput id={`e-${k}`} value={f[k]} onChange={set(k)} suffix={suffix} prefix={suffix === '%' || suffix === 'MT' ? null : '₹'} disabled={disabled} />
    </Field>
  );

  return (
    <Modal
      wide
      title={`Correct ${order.orderNumber}`}
      onClose={busy ? () => undefined : onClose}
      dismissable={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={() => void save()} disabled={f.reason.trim().length < 3}>Save correction</Button>
        </>
      }
    >
      <div className="stack">
        <Notice tone="info">Corrections are recorded in the audit log with old and new values. Saved default rates for parties are not changed. To change a party, cancel this order and create a new one.</Notice>
        <div className="form-grid">
          {amount('qty', 'Net quantity', 'MT')}
          {text('dispatchDate', 'Dispatch date', 'date')}
          {text('vehicleNumber', 'Vehicle')}
          {text('receiptNumber', 'Receipt no.')}
          {text('driverName', 'Driver')}
          {text('driverPhone', 'Driver phone')}
          {text('destination', 'Destination')}
          <div />
          {amount('buyerRate', 'Buyer rate')}
          {amount('gst', 'GST', '%')}
          {amount('sellerRate', 'Seller rate')}
          {amount('commissionRate', 'Commission rate', '/MT', !order.commissionAgentId)}
          {amount('freightRate', 'Freight rate', '/MT', !order.transporterId)}
          {amount('paRate', 'Payment agent rate', '/MT', !order.paymentAgentId)}
          <Field label="Notes" htmlFor="e-notes" className="span-2">
            <TextInput id="e-notes" value={f.notes} onChange={(e) => set('notes')(e.target.value)} />
          </Field>
          <Field label="Reason for correction *" htmlFor="e-reason" className="span-2">
            <TextArea id="e-reason" value={f.reason} onChange={(e) => set('reason')(e.target.value)} placeholder="e.g. Weighbridge slip re-checked: net was 38.25 MT" />
          </Field>
        </div>
        {fin && (
          <Notice>
            New buyer total {formatINR(fin.buyer.grossAmount)} (was {formatINR(order.buyer.grossAmount)}); seller {formatINR(fin.seller.amount)}; payment agent commission {formatINR(fin.paymentAgent.amount)}.
          </Notice>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Modal>
  );
}
