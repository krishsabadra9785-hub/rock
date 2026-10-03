import { useState } from 'react';
import { AmountInput, Button, Field, Modal, Notice, TextInput } from '../../components/ui';
import { formatPercent, formatRate } from '../../domain/format';
import { bpToInput, paiseToInput, parsePercent, parseRupees } from '../../domain/money';
import { defaultRateFor, RATE_META } from '../../domain/rates';
import type { Party, RateType } from '../../domain/types';
import { changeDefaultRate } from '../../services/parties';
import { friendlyError } from '../../services/errors';
import { useToast } from '../../state/ToastProvider';

export function ChangeRateDialog({ party, rateType, onClose }: { party: Party; rateType: RateType; onClose: () => void }) {
  const toast = useToast();
  const meta = RATE_META[rateType];
  const pct = meta.unit === 'BASIS_POINTS';
  const current = defaultRateFor(party.rates, rateType);
  const [input, setInput] = useState(current === null ? '' : pct ? bpToInput(current) : paiseToInput(current));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = pct ? parsePercent(input) : parseRupees(input);
  const fmt = (v: number | null) => (pct ? formatPercent(v) : formatRate(v));

  const save = async () => {
    if (value === null) return setError('Enter a valid number');
    if (pct && value > 2800) return setError('GST above 28% is not valid');
    setBusy(true);
    try {
      await changeDefaultRate(party, rateType, value, reason);
      toast.success(`${meta.label} for ${party.name} is now ${fmt(value)}`);
      onClose();
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Change ${meta.label.toLowerCase()}`}
      onClose={busy ? () => undefined : onClose}
      dismissable={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={() => void save()} disabled={value === null || value === current}>Save new default</Button>
        </>
      }
    >
      <div className="stack">
        <p>
          {party.name}: current default <strong>{fmt(current)}</strong>
        </p>
        <Field label="New default" htmlFor="cr-v">
          <AmountInput id="cr-v" value={input} onChange={setInput} prefix={pct ? null : '₹'} suffix={pct ? '%' : '/MT'} />
        </Field>
        <Field label="Reason (optional)" htmlFor="cr-r">
          <TextInput id="cr-r" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Market rate revised" />
        </Field>
        <Notice tone="info">Applies to orders created from now on. Existing orders keep the rates they were created with.</Notice>
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Modal>
  );
}
