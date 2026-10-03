import { useMemo, useRef, useState } from 'react';
import { PartySelect } from '../../components/PartySelect';
import { AmountInput, Button, Field, Modal, Notice, Select, TextInput } from '../../components/ui';
import { todayISO } from '../../domain/dates';
import { formatINR } from '../../domain/format';
import { paiseToInput } from '../../domain/money';
import { CATEGORY_META, METHOD_LABELS, orderSettlement } from '../../domain/payments';
import { PAYMENT_CATEGORIES, PAYMENT_METHODS, type Order, type PaymentCategory, type PaymentMethod } from '../../domain/types';
import { validateAmount } from '../../domain/validation';
import { friendlyError } from '../../services/errors';
import { uuid } from '../../services/firestore';
import { recordPayment } from '../../services/payments';
import { invalidateRollupCache } from '../../services/rollups';
import { useToast } from '../../state/ToastProvider';

function partyOnOrder(order: Order, category: PaymentCategory): string | null {
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

export function PaymentFormDialog({
  order,
  initialCategory = 'BUYER_RECEIPT',
  initialPartyId = null,
  onClose,
  onSaved,
}: {
  order?: Order | null;
  initialCategory?: PaymentCategory;
  initialPartyId?: string | null;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const toast = useToast();
  const [category, setCategory] = useState<PaymentCategory>(initialCategory);
  const [partyId, setPartyId] = useState<string | null>(order ? partyOnOrder(order, initialCategory) : initialPartyId);
  const settlement = useMemo(() => {
    const key = CATEGORY_META[category].paidKey;
    return order && key ? orderSettlement(order, key) : null;
  }, [order, category]);
  const [amount, setAmount] = useState(settlement && settlement.outstanding > 0 ? paiseToInput(settlement.outstanding) : '');
  const [date, setDate] = useState(todayISO());
  const [method, setMethod] = useState<PaymentMethod>('BANK');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useRef(uuid());

  const meta = CATEGORY_META[category];
  const categories = order ? PAYMENT_CATEGORIES.filter((c) => CATEGORY_META[c].paidKey && partyOnOrder(order, c)) : PAYMENT_CATEGORIES;
  const amt = validateAmount(amount);
  const over = settlement && amt.ok && amt.value > settlement.outstanding;

  const changeCategory = (c: PaymentCategory) => {
    setCategory(c);
    if (order) {
      setPartyId(partyOnOrder(order, c));
      const k = CATEGORY_META[c].paidKey;
      const s = k ? orderSettlement(order, k) : null;
      setAmount(s && s.outstanding > 0 ? paiseToInput(s.outstanding) : '');
    } else if (CATEGORY_META[c].partyType !== CATEGORY_META[category].partyType) setPartyId(null);
  };

  const save = async () => {
    if (busy) return;
    if (!amt.ok) return setError(amt.error);
    if (over) return setError('This is more than the outstanding amount on this order. Record any extra as an on-account payment instead.');
    if (meta.partyType && !partyId) return setError('Select who this payment is for');
    setBusy(true);
    setError(null);
    try {
      const r = await recordPayment({
        idempotencyKey: key.current,
        category,
        date,
        amount: amt.value,
        partyId,
        orderId: order?.id ?? null,
        method,
        reference,
        notes,
      });
      invalidateRollupCache();
      toast.success(r.duplicate ? 'This payment was already recorded' : `${meta.label} of ${formatINR(amt.value)} recorded`);
      onSaved?.();
      onClose();
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={order ? `Record payment for ${order.orderNumber}` : 'Record payment'}
      onClose={busy ? () => undefined : onClose}
      dismissable={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy} onClick={() => void save()}>
            Record payment
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Payment type" htmlFor="p-cat" className="span-2">
          <Select id="p-cat" value={category} onChange={(e) => changeCategory(e.target.value as PaymentCategory)}>
            {categories.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_META[c].label}
              </option>
            ))}
          </Select>
        </Field>
        {meta.partyType ? (
          <Field label="Party" htmlFor="p-party" className="span-2">
            <PartySelect id="p-party" type={meta.partyType} value={partyId} onChange={(id) => setPartyId(id)} disabled={!!order} includeInactive />
          </Field>
        ) : null}
        {settlement && (
          <div className="span-2">
            <Notice tone="info">
              Due {formatINR(settlement.obligation)}, already paid {formatINR(settlement.paid)}, outstanding <strong>{formatINR(settlement.outstanding)}</strong>.
            </Notice>
          </div>
        )}
        <Field label="Amount *" htmlFor="p-amt" error={amount && !amt.ok ? amt.error : null}>
          <AmountInput id="p-amt" value={amount} onChange={setAmount} />
        </Field>
        <Field label="Date *" htmlFor="p-date">
          <TextInput id="p-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Method" htmlFor="p-method">
          <Select id="p-method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {METHOD_LABELS[m]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Reference" htmlFor="p-ref" hint="UTR, cheque no., etc.">
          <TextInput id="p-ref" value={reference} maxLength={80} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <Field label="Notes" htmlFor="p-notes" className="span-2">
          <TextInput id="p-notes" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {!order && meta.partyType && (
          <div className="span-2">
            <Notice>Not linked to a specific order: this counts towards the party's overall balance. To settle a specific order, record it from that order's page.</Notice>
          </div>
        )}
        {over && (
          <div className="span-2">
            <Notice tone="danger">This is more than the outstanding amount, so it can't be recorded against this order.</Notice>
          </div>
        )}
        {error && (
          <div className="span-2">
            <Notice tone="danger">{error}</Notice>
          </div>
        )}
      </div>
    </Modal>
  );
}

