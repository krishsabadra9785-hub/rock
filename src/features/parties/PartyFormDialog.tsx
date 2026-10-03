import { useState } from 'react';
import { PartySelect } from '../../components/PartySelect';
import { AmountInput, Button, Field, Modal, Notice, TextArea, TextInput } from '../../components/ui';
import { bpToInput, parsePercent, parseRupees } from '../../domain/money';
import { RATE_META, RATE_TYPES_BY_PARTY } from '../../domain/rates';
import type { Party, PartyRates, PartyType, RateType } from '../../domain/types';
import { friendlyError } from '../../services/errors';
import { createParty, PARTY_LABELS, updateParty } from '../../services/parties';
import { useSession } from '../../state/SessionProvider';
import { useToast } from '../../state/ToastProvider';

export function PartyFormDialog({ type, party, onClose, onSaved }: { type: PartyType; party?: Party; onClose: () => void; onSaved?: (id: string) => void }) {
  const toast = useToast();
  const { settings } = useSession();
  const label = PARTY_LABELS[type].singular;
  const [name, setName] = useState(party?.name ?? '');
  const [phone, setPhone] = useState(party?.phone ?? '');
  const [address, setAddress] = useState(party?.address ?? '');
  const [gstin, setGstin] = useState(party?.gstin ?? '');
  const [notes, setNotes] = useState(party?.notes ?? '');
  const [agentId, setAgentId] = useState<string | null>(party?.defaults.commissionAgentId ?? null);
  const [transporterId, setTransporterId] = useState<string | null>(party?.defaults.transporterId ?? null);
  const [paId, setPaId] = useState<string | null>(party?.defaults.paymentAgentId ?? null);
  const [rateInputs, setRateInputs] = useState<Partial<Record<RateType, string>>>(type === 'BUYER' ? { BUYER_GST: bpToInput(settings.defaultGstBp) } : {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const defaults = { commissionAgentId: agentId, transporterId, paymentAgentId: paId };
      if (party) {
        await updateParty(party, { name, phone, address, gstin, notes, active: party.active, defaults });
        toast.success(`${name} updated`);
        onSaved?.(party.id);
      } else {
        const rates: PartyRates = {};
        for (const rt of RATE_TYPES_BY_PARTY[type]) {
          const raw = rateInputs[rt]?.trim();
          if (!raw) continue;
          const v = RATE_META[rt].unit === 'BASIS_POINTS' ? parsePercent(raw) : parseRupees(raw);
          if (v === null) throw new Error(`${RATE_META[rt].label} is not a valid number`);
          rates[rt] = v;
        }
        const id = await createParty(type, { name, phone, address, gstin, notes, active: true, rates, defaults });
        toast.success(`${label} ${name} added`);
        onSaved?.(id);
      }
      onClose();
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    }
  };

  const showGstin = type === 'BUYER' || type === 'SELLER';
  return (
    <Modal
      title={party ? `Edit ${party.name}` : `Add ${label.toLowerCase()}`}
      onClose={busy ? () => undefined : onClose}
      dismissable={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={() => void save()}>{party ? 'Save changes' : `Add ${label.toLowerCase()}`}</Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Name *" htmlFor="pf-name" className="span-2">
          <TextInput id="pf-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Phone" htmlFor="pf-phone">
          <TextInput id="pf-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        {showGstin ? (
          <Field label="GSTIN" htmlFor="pf-gstin">
            <TextInput id="pf-gstin" value={gstin} maxLength={15} onChange={(e) => setGstin(e.target.value.toUpperCase())} />
          </Field>
        ) : <div />}
        <Field label="Address" htmlFor="pf-address" className="span-2">
          <TextArea id="pf-address" value={address} maxLength={300} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        {!party &&
          RATE_TYPES_BY_PARTY[type].map((rt) => (
            <Field key={rt} label={`Default ${RATE_META[rt].label.toLowerCase()}`} htmlFor={`pf-${rt}`} hint="Pre-filled on new orders; can be changed later">
              <AmountInput
                id={`pf-${rt}`}
                value={rateInputs[rt] ?? ''}
                onChange={(v) => setRateInputs((r) => ({ ...r, [rt]: v }))}
                prefix={RATE_META[rt].unit === 'BASIS_POINTS' ? null : '₹'}
                suffix={RATE_META[rt].unit === 'BASIS_POINTS' ? '%' : '/MT'}
              />
            </Field>
          ))}
        {party && (
          <div className="span-2">
            <Notice>Rates are changed from the profile page with "Change rate", so every change is kept in rate history.</Notice>
          </div>
        )}
        {(type === 'BUYER' || type === 'SELLER') && (
          <>
            <Field label="Default commission agent" htmlFor="pf-agent">
              <PartySelect id="pf-agent" type="COMMISSION_AGENT" value={agentId} onChange={(id) => setAgentId(id)} allowNone />
            </Field>
            <Field label="Default transporter" htmlFor="pf-trn">
              <PartySelect id="pf-trn" type="TRANSPORTER" value={transporterId} onChange={(id) => setTransporterId(id)} allowNone />
            </Field>
          </>
        )}
        {type === 'BUYER' && (
          <Field label="Default payment agent" htmlFor="pf-pa">
            <PartySelect id="pf-pa" type="PAYMENT_AGENT" value={paId} onChange={(id) => setPaId(id)} allowNone noneLabel="Business default" />
          </Field>
        )}
        <Field label="Notes" htmlFor="pf-notes" className="span-2">
          <TextInput id="pf-notes" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {error && <div className="span-2"><Notice tone="danger">{error}</Notice></div>}
      </div>
    </Modal>
  );
}
