import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { PartySelect } from '../../components/PartySelect';
import { Badge, Button, Field, Notice, PageHeader, Panel, TextArea, TextInput } from '../../components/ui';
import { tryCalculateOrder } from '../../domain/calc';
import { todayISO } from '../../domain/dates';
import { EXTRACTION_FIELDS, FIELD_LABELS, emptyExtraction, type ExtractionField, type FieldStatus } from '../../domain/extraction';
import { formatDate, formatINR, formatPercent, formatQty, formatRate } from '../../domain/format';
import { can } from '../../domain/permissions';
import { defaultRateFor, type RateSelection } from '../../domain/rates';
import type { ExtractionStatus, Party, RateType } from '../../domain/types';
import { normalizeVehicleNumber, validateDispatchDate, validatePhone, validateQuantity, validateReceiptFile } from '../../domain/validation';
import { extractReceipt } from '../../services/ai';
import { friendlyError } from '../../services/errors';
import { uuid } from '../../services/firestore';
import { createOrder } from '../../services/orders';
import { createPreview, releasePreview } from '../../services/receiptImage';
import { NO_RECEIPT_IMAGE, receiptStorage } from '../../services/receiptStorage';
import { invalidateRollupCache } from '../../services/rollups';
import { useData } from '../../state/DataProvider';
import { useSession } from '../../state/SessionProvider';
import { useToast } from '../../state/ToastProvider';
import { MoneyFlow, RateField, emptyRate, parseRateInput, rateFromDefault, type RateState } from './orderParts';

type Step = 'receipt' | 'verify' | 'parties' | 'review';
const STEPS: { id: Step; label: string }[] = [
  { id: 'receipt', label: 'Receipt' },
  { id: 'verify', label: 'Check details' },
  { id: 'parties', label: 'Parties & rates' },
  { id: 'review', label: 'Review & confirm' },
];

type ReceiptForm = Record<ExtractionField, string>;
const emptyForm = (): ReceiptForm => ({ netQuantity: '', driverName: '', driverPhone: '', dispatchDate: todayISO(), vehicleNumber: '', receiptNumber: '', destination: '' });

type RateKey = 'buyerRate' | 'buyerGst' | 'sellerRate' | 'commissionRate' | 'freightRate' | 'paymentAgentRate';
const RATE_TYPE: Record<RateKey, RateType> = {
  buyerRate: 'BUYER_RATE',
  buyerGst: 'BUYER_GST',
  sellerRate: 'SELLER_RATE',
  commissionRate: 'COMMISSION_RATE',
  freightRate: 'FREIGHT_RATE',
  paymentAgentRate: 'PAYMENT_AGENT_RATE',
};

interface AiState {
  status: 'idle' | 'reading' | 'done' | 'failed' | 'skipped';
  statuses: Partial<Record<ExtractionField, FieldStatus>>;
  notes: Partial<Record<ExtractionField, string | null>>;
  raw: string | null;
  model: string | null;
  error: string | null;
  overall: ExtractionStatus;
}
const initialAi = (): AiState => ({ status: 'idle', statuses: {}, notes: {}, raw: null, model: null, error: null, overall: 'SKIPPED' });

export default function CreateOrderPage() {
  const { settings, profile } = useSession();
  const { byId } = useData();
  const toast = useToast();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('receipt');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [ai, setAi] = useState<AiState>(initialAi);
  const [form, setForm] = useState<ReceiptForm>(emptyForm);
  const [formErrors, setFormErrors] = useState<Partial<Record<ExtractionField, string>>>({});
  const [drag, setDrag] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const [buyerId, setBuyerId] = useState<string | null>(null);
  const [sellerId, setSellerId] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [transporterId, setTransporterId] = useState<string | null>(null);
  const [paId, setPaId] = useState<string | null>(null);
  const [rates, setRates] = useState<Record<RateKey, RateState>>({
    buyerRate: emptyRate(),
    buyerGst: emptyRate(),
    sellerRate: emptyRate(),
    commissionRate: emptyRate(),
    freightRate: emptyRate(),
    paymentAgentRate: emptyRate(),
  });
  const [notes, setNotes] = useState('');
  const [partyErrors, setPartyErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const idempotencyKey = useRef(uuid());
  const aiRun = useRef(0);

  // Discard the temporary image whenever it changes or the page is left.
  useEffect(() => () => releasePreview(previewUrl), [previewUrl]);

  const allowed = can(profile?.role, 'order.create');

  // ---------- Receipt ----------
  const runAi = useCallback(
    async (f: File) => {
      const run = ++aiRun.current;
      setAi({ ...initialAi(), status: 'reading' });
      try {
        const r = await extractReceipt(f, settings.aiModel);
        if (run !== aiRun.current) return;
        const next = emptyForm();
        const statuses: AiState['statuses'] = {};
        const fieldNotes: AiState['notes'] = {};
        for (const k of EXTRACTION_FIELDS) {
          const fld = r.parsed.fields[k];
          statuses[k] = fld.status;
          fieldNotes[k] = fld.note;
          if (fld.value) next[k] = fld.value;
        }
        setForm(next);
        setAi({
          status: r.parsed.overall === 'FAILED' ? 'failed' : 'done',
          statuses,
          notes: fieldNotes,
          raw: r.raw,
          model: r.model,
          error: r.parsed.overall === 'FAILED' ? (r.parsed.readable ? 'Nothing usable was found on this receipt.' : 'The receipt could not be read clearly.') : null,
          overall: r.parsed.overall,
        });
      } catch (e) {
        if (run !== aiRun.current) return;
        const empty = emptyExtraction();
        setAi({
          ...initialAi(),
          status: 'failed',
          statuses: Object.fromEntries(EXTRACTION_FIELDS.map((k) => [k, empty.fields[k].status])),
          error: friendlyError(e),
          overall: 'FAILED',
        });
      }
      setStep('verify');
    },
    [settings.aiModel],
  );

  const acceptFile = (f: File | undefined | null) => {
    if (!f) return;
    const v = validateReceiptFile(f);
    if (!v.ok) {
      setFileError(v.error);
      return;
    }
    setFileError(null);
    setFile(f);
    setPreviewUrl(createPreview(f));
    setForm(emptyForm());
    if (settings.aiEnabled && navigator.onLine) void runAi(f);
    else {
      setAi({ ...initialAi(), status: 'skipped', error: !navigator.onLine ? 'You are offline, so the receipt was not read automatically.' : null });
      setStep('verify');
    }
  };
  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    acceptFile(e.target.files?.[0]);
    e.target.value = '';
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    acceptFile(e.dataTransfer.files?.[0]);
  };
  const enterManually = () => {
    aiRun.current++;
    setAi({ ...initialAi(), status: 'skipped' });
    setStep('verify');
  };

  const confirmReceipt = () => {
    const errs: Partial<Record<ExtractionField, string>> = {};
    const q = validateQuantity(form.netQuantity);
    if (!q.ok) errs.netQuantity = q.error;
    const d = validateDispatchDate(form.dispatchDate);
    if (!d.ok) errs.dispatchDate = d.error;
    const p = validatePhone(form.driverPhone);
    if (!p.ok) errs.driverPhone = p.error;
    setFormErrors(errs);
    if (Object.keys(errs).length === 0) setStep('parties');
  };

  // ---------- Parties ----------
  const setRate = (key: RateKey, s: RateState) => setRates((r) => ({ ...r, [key]: s }));

  const selectAgent = (id: string | null, p: Party | null) => {
    setAgentId(id);
    setRate('commissionRate', id ? rateFromDefault(id, defaultRateFor(p?.rates, 'COMMISSION_RATE'), 'rate') : emptyRate());
  };
  const selectTransporter = (id: string | null, p: Party | null) => {
    setTransporterId(id);
    setRate('freightRate', id ? rateFromDefault(id, defaultRateFor(p?.rates, 'FREIGHT_RATE'), 'rate') : emptyRate());
  };
  const selectPa = (id: string | null, p: Party | null) => {
    setPaId(id);
    setRate('paymentAgentRate', id ? rateFromDefault(id, defaultRateFor(p?.rates, 'PAYMENT_AGENT_RATE'), 'rate') : emptyRate());
  };
  const selectBuyer = (id: string | null, p: Party | null) => {
    setBuyerId(id);
    if (!id || !p) {
      setRate('buyerRate', emptyRate());
      setRate('buyerGst', emptyRate());
      return;
    }
    setRate('buyerRate', rateFromDefault(id, defaultRateFor(p.rates, 'BUYER_RATE'), 'rate'));
    setRate('buyerGst', rateFromDefault(id, defaultRateFor(p.rates, 'BUYER_GST'), 'percent', settings.defaultGstBp));
    const d = p.defaults;
    if (d.commissionAgentId && byId.get(d.commissionAgentId)?.active) selectAgent(d.commissionAgentId, byId.get(d.commissionAgentId) ?? null);
    if (d.transporterId && byId.get(d.transporterId)?.active) selectTransporter(d.transporterId, byId.get(d.transporterId) ?? null);
    const paDefault = d.paymentAgentId ?? settings.defaultPaymentAgentId;
    if (paDefault && byId.get(paDefault)?.active) selectPa(paDefault, byId.get(paDefault) ?? null);
  };
  const selectSeller = (id: string | null, p: Party | null) => {
    setSellerId(id);
    setRate('sellerRate', id && p ? rateFromDefault(id, defaultRateFor(p.rates, 'SELLER_RATE'), 'rate') : emptyRate());
    const a = p?.defaults.commissionAgentId;
    if (!agentId && a && byId.get(a)?.active) selectAgent(a, byId.get(a) ?? null);
    const t = p?.defaults.transporterId;
    if (!transporterId && t && byId.get(t)?.active) selectTransporter(t, byId.get(t) ?? null);
  };

  // Pre-select the business-wide default payment agent once.
  useEffect(() => {
    if (!paId && settings.defaultPaymentAgentId) {
      const p = byId.get(settings.defaultPaymentAgentId);
      if (p?.active) selectPa(p.id, p);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.defaultPaymentAgentId, byId]);

  const qtyKg = validateQuantity(form.netQuantity).ok ? (validateQuantity(form.netQuantity) as { ok: true; value: number }).value : 0;
  const parsed = {
    buyerRate: parseRateInput(rates.buyerRate, 'rate'),
    buyerGst: parseRateInput(rates.buyerGst, 'percent'),
    sellerRate: parseRateInput(rates.sellerRate, 'rate'),
    commissionRate: agentId ? parseRateInput(rates.commissionRate, 'rate') : 0,
    freightRate: transporterId ? parseRateInput(rates.freightRate, 'rate') : 0,
    paymentAgentRate: paId ? parseRateInput(rates.paymentAgentRate, 'rate') : 0,
  };
  const fin = useMemo(
    () =>
      tryCalculateOrder({
        qtyKg,
        buyerRatePaise: parsed.buyerRate ?? undefined,
        gstBp: parsed.buyerGst ?? undefined,
        sellerRatePaise: parsed.sellerRate ?? undefined,
        commissionRatePaise: parsed.commissionRate ?? undefined,
        freightRatePaise: parsed.freightRate ?? undefined,
        paymentAgentRatePaise: parsed.paymentAgentRate ?? undefined,
      }),
    [qtyKg, parsed.buyerRate, parsed.buyerGst, parsed.sellerRate, parsed.commissionRate, parsed.freightRate, parsed.paymentAgentRate],
  );

  const validateParties = (): boolean => {
    const e: Record<string, string> = {};
    if (!buyerId) e.buyer = 'Select a buyer';
    if (!sellerId) e.seller = 'Select a seller';
    if (parsed.buyerRate === null) e.buyerRate = 'Enter the buyer rate';
    if (parsed.buyerGst === null) e.buyerGst = 'Enter GST % (0 if none)';
    else if (parsed.buyerGst > 2800) e.buyerGst = 'GST above 28% is not valid';
    if (parsed.sellerRate === null) e.sellerRate = 'Enter the seller rate';
    if (agentId && parsed.commissionRate === null) e.commissionRate = 'Enter the commission rate (0 if none)';
    if (transporterId && parsed.freightRate === null) e.freightRate = 'Enter the freight rate (0 if none)';
    if (paId && parsed.paymentAgentRate === null) e.paymentAgentRate = 'Enter the payment agent rate (0 if none)';
    setPartyErrors(e);
    return Object.keys(e).length === 0;
  };

  // ---------- Submit ----------
  const selection = (key: RateKey, partyId: string, value: number): RateSelection => ({
    rateType: RATE_TYPE[key],
    partyId,
    defaultValue: rates[key].defaultValue,
    value,
    decision: rates[key].decision,
  });

  const submit = async () => {
    if (submitting || !fin || !buyerId || !sellerId) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const image = file ? await receiptStorage.save(file, { orderKey: idempotencyKey.current }) : NO_RECEIPT_IMAGE;
      const result = await createOrder({
        idempotencyKey: idempotencyKey.current,
        orderPrefix: settings.orderPrefix,
        receipt: {
          image,
          receiptNumber: form.receiptNumber.trim(),
          driverName: form.driverName.trim(),
          driverPhone: form.driverPhone.trim(),
          vehicleNumber: normalizeVehicleNumber(form.vehicleNumber),
          destination: form.destination.trim(),
          dispatchDate: form.dispatchDate,
          netQtyKg: qtyKg,
          ai: {
            status: ai.status === 'skipped' || ai.status === 'idle' ? 'SKIPPED' : ai.overall,
            model: ai.model,
            raw: ai.raw,
            error: ai.error,
          },
        },
        buyerId,
        sellerId,
        commissionAgentId: agentId,
        transporterId,
        paymentAgentId: paId,
        rates: {
          buyerRate: selection('buyerRate', buyerId, parsed.buyerRate!),
          buyerGst: selection('buyerGst', buyerId, parsed.buyerGst!),
          sellerRate: selection('sellerRate', sellerId, parsed.sellerRate!),
          commissionRate: agentId ? selection('commissionRate', agentId, parsed.commissionRate!) : null,
          freightRate: transporterId ? selection('freightRate', transporterId, parsed.freightRate!) : null,
          paymentAgentRate: paId ? selection('paymentAgentRate', paId, parsed.paymentAgentRate!) : null,
        },
        notes,
      });
      invalidateRollupCache();
      // The order is saved: discard the temporary receipt image now.
      releasePreview(previewUrl);
      setPreviewUrl(null);
      setFile(null);
      idempotencyKey.current = uuid();
      toast.success(result.duplicate ? `Order ${result.orderNumber} was already saved` : `Order ${result.orderNumber} created`);
      navigate(`/orders/${result.id}`, { replace: true });
    } catch (e) {
      setSubmitError(friendlyError(e));
      setSubmitting(false);
    }
  };

  if (!allowed) {
    return (
      <>
        <PageHeader title="Create order" />
        <Notice tone="warn">Your role can view records but not create orders. Ask an administrator if you need this.</Notice>
      </>
    );
  }

  const currentIdx = STEPS.findIndex((s) => s.id === step);
  const statusLabel = (k: ExtractionField) => {
    const s = ai.statuses[k];
    if (!s || ai.status === 'skipped') return null;
    const text = { FOUND: 'Read from receipt', UNCERTAIN: 'Please check', MISSING: 'Not found', INVALID: 'Could not read' }[s];
    return <span className={`field-status ${s}`}>{text}</span>;
  };

  const preview = previewUrl && file && (
    <div className="receipt-preview">
      {file.type === 'application/pdf' ? <iframe src={previewUrl} title="Receipt preview" /> : <img src={previewUrl} alt="Receipt preview" />}
    </div>
  );

  return (
    <div>
      <PageHeader title="Create order" sub="Receipt → check details → parties & rates → confirm" />
      <ol className="steps" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s.id} className={`step ${i < currentIdx ? 'done' : ''} ${i === currentIdx ? 'current' : ''}`} aria-current={i === currentIdx ? 'step' : undefined} style={{ listStyle: 'none' }}>
            {s.label}
          </li>
        ))}
      </ol>

      {step === 'receipt' && (
        <div className="stack">
          {ai.status === 'reading' ? (
            <Panel>
              <div className="grid-2">
                {preview}
                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 12 }}>
                  <h2>Reading the receipt…</h2>
                  <p className="muted">This usually takes a few seconds. You can skip it and type the details yourself.</p>
                  <div className="progress" aria-hidden="true">
                    <div style={{ width: '60%' }} />
                  </div>
                  <div>
                    <Button onClick={enterManually}>Skip and enter manually</Button>
                  </div>
                </div>
              </div>
            </Panel>
          ) : (
            <div
              className={`dropzone ${drag ? 'drag' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={onDrop}
            >
              <Icon name="file" size={34} />
              <h3>Add the weighbridge slip or challan</h3>
              <p className="muted small">JPG, PNG, WEBP or PDF up to 10 MB. The image is only used to read the details on this device — it isn't saved.</p>
              <div className="dropzone-actions">
                <label className="btn btn-primary btn-lg">
                  <Icon name="camera" size={16} /> Take photo
                  <input type="file" accept="image/*" capture="environment" onChange={onPick} hidden />
                </label>
                <label className="btn btn-lg">
                  <Icon name="upload" size={16} /> Choose file
                  <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={onPick} hidden />
                </label>
              </div>
              <div style={{ marginTop: 14 }}>
                <Button variant="ghost" onClick={enterManually}>
                  No receipt? Enter details manually
                </Button>
              </div>
            </div>
          )}
          {fileError && <Notice tone="danger">{fileError}</Notice>}
          {!settings.aiEnabled && <Notice tone="info">Automatic receipt reading is turned off in Settings. You'll type the details after choosing a file.</Notice>}
        </div>
      )}

      {step === 'verify' && (
        <div className={preview ? 'grid-2' : ''}>
          {preview && <div>{preview}</div>}
          <Panel title="Check receipt details">
            <div className="stack">
              {ai.status === 'done' && ai.overall === 'SUCCESS' && <Notice tone="ok">All fields were read. Check them against the receipt before confirming.</Notice>}
              {ai.status === 'done' && ai.overall === 'PARTIAL' && <Notice tone="warn">Some fields need attention — they're highlighted below.</Notice>}
              {ai.status === 'failed' && (
                <Notice tone="warn" icon="alert">
                  {ai.error ?? 'The receipt could not be read automatically.'} Enter the details below.
                  {file && settings.aiEnabled && (
                    <div style={{ marginTop: 8 }}>
                      <Button size="sm" icon="refresh" onClick={() => void runAi(file)}>
                        Try reading again
                      </Button>
                    </div>
                  )}
                </Notice>
              )}
              {ai.status === 'skipped' && ai.error && <Notice tone="info">{ai.error}</Notice>}
              <div className="form-grid">
                {EXTRACTION_FIELDS.map((k) => {
                  const uncertain = ai.statuses[k] === 'UNCERTAIN' && ai.status !== 'skipped';
                  const note = ai.notes[k];
                  return (
                    <Field
                      key={k}
                      label={FIELD_LABELS[k] + (k === 'netQuantity' || k === 'dispatchDate' ? ' *' : '')}
                      htmlFor={`f-${k}`}
                      extra={statusLabel(k)}
                      error={formErrors[k]}
                      hint={note ?? undefined}
                      className={k === 'destination' ? 'span-2' : ''}
                    >
                      <TextInput
                        id={`f-${k}`}
                        type={k === 'dispatchDate' ? 'date' : 'text'}
                        inputMode={k === 'netQuantity' ? 'decimal' : k === 'driverPhone' ? 'tel' : undefined}
                        className={uncertain ? 'is-uncertain' : ''}
                        invalid={!!formErrors[k]}
                        value={form[k]}
                        onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                      />
                    </Field>
                  );
                })}
              </div>
            </div>
            <div className="wizard-foot">
              <Button onClick={() => setStep('receipt')}>Back</Button>
              <Button variant="primary" onClick={confirmReceipt} disabled={ai.status === 'reading'}>
                Confirm receipt details
              </Button>
            </div>
          </Panel>
        </div>
      )}

      {step === 'parties' && (
        <div className="stack">
          <Notice tone="info">
            {formatQty(qtyKg)} dispatched {formatDate(form.dispatchDate)}
            {form.vehicleNumber && ` on ${normalizeVehicleNumber(form.vehicleNumber)}`}. Rates are pre-filled from each party's saved default.
          </Notice>
          <Panel bodyless>
            <div className="party-block">
              <h3>Buyer</h3>
              <div className="form-grid">
                <Field label="Buyer *" htmlFor="buyer" error={partyErrors.buyer}>
                  <PartySelect id="buyer" type="BUYER" value={buyerId} onChange={selectBuyer} />
                </Field>
                <div />
                <RateField id="r-buyer" label="Buyer rate (excl. GST)" state={rates.buyerRate} onChange={(s) => setRate('buyerRate', s)} disabled={!buyerId} error={partyErrors.buyerRate} total={fin && formatINR(fin.buyer.baseAmount)} />
                <RateField id="r-gst" label="GST" unit="percent" state={rates.buyerGst} onChange={(s) => setRate('buyerGst', s)} disabled={!buyerId} error={partyErrors.buyerGst} total={fin && formatINR(fin.buyer.gstAmount)} />
              </div>
              {fin && (
                <p className="small muted" style={{ marginTop: 8 }}>
                  Buyer total {formatINR(fin.buyer.grossAmount)} ({formatRate(fin.buyer.effectiveRatePaise)} incl. GST)
                </p>
              )}
            </div>
            <div className="party-block">
              <h3>Seller</h3>
              <div className="form-grid">
                <Field label="Seller *" htmlFor="seller" error={partyErrors.seller}>
                  <PartySelect id="seller" type="SELLER" value={sellerId} onChange={selectSeller} />
                </Field>
                <RateField id="r-seller" label="Seller rate (all-inclusive)" state={rates.sellerRate} onChange={(s) => setRate('sellerRate', s)} disabled={!sellerId} error={partyErrors.sellerRate} total={fin && formatINR(fin.seller.amount)} />
              </div>
            </div>
            <div className="party-block">
              <h3>Commission agent</h3>
              <div className="form-grid">
                <Field label="Agent" htmlFor="agent" hint="Changing the agent here affects this order only">
                  <PartySelect id="agent" type="COMMISSION_AGENT" value={agentId} onChange={selectAgent} allowNone noneLabel="No commission agent" />
                </Field>
                <RateField id="r-comm" label="Commission rate" state={rates.commissionRate} onChange={(s) => setRate('commissionRate', s)} disabled={!agentId} error={partyErrors.commissionRate} total={fin && agentId ? formatINR(fin.commission.amount) : null} />
              </div>
            </div>
            <div className="party-block">
              <h3>Transporter</h3>
              <div className="form-grid">
                <Field label="Transporter" htmlFor="transporter">
                  <PartySelect id="transporter" type="TRANSPORTER" value={transporterId} onChange={selectTransporter} allowNone noneLabel="No transporter" />
                </Field>
                <RateField id="r-freight" label="Freight rate" state={rates.freightRate} onChange={(s) => setRate('freightRate', s)} disabled={!transporterId} error={partyErrors.freightRate} total={fin && transporterId ? formatINR(fin.freight.amount) : null} />
              </div>
            </div>
            <div className="party-block">
              <h3>Payment agent</h3>
              <div className="form-grid">
                <Field label="Payment agent" htmlFor="pa">
                  <PartySelect id="pa" type="PAYMENT_AGENT" value={paId} onChange={selectPa} allowNone noneLabel="No payment agent" />
                </Field>
                <RateField id="r-pa" label="Payment agent rate" state={rates.paymentAgentRate} onChange={(s) => setRate('paymentAgentRate', s)} disabled={!paId} error={partyErrors.paymentAgentRate} total={fin && paId ? formatINR(fin.paymentAgent.deduction) : null} />
              </div>
            </div>
            <div className="party-block">
              <Field label="Notes (optional)" htmlFor="notes">
                <TextArea id="notes" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
              </Field>
            </div>
          </Panel>
          <div className="wizard-foot">
            <Button onClick={() => setStep('verify')}>Back</Button>
            <Button variant="primary" onClick={() => validateParties() && setStep('review')}>
              Review order
            </Button>
          </div>
        </div>
      )}

      {step === 'review' && fin && (
        <div className="stack">
          <Panel title="Where the money goes" bodyless>
            <MoneyFlow fin={fin} />
          </Panel>
          <div className="grid-2">
            <Panel title="Receipt">
              <dl className="kv">
                <dt>Quantity</dt>
                <dd className="strong">{formatQty(qtyKg)}</dd>
                <dt>Dispatch date</dt>
                <dd>{formatDate(form.dispatchDate)}</dd>
                <dt>Vehicle</dt>
                <dd>{normalizeVehicleNumber(form.vehicleNumber) || '—'}</dd>
                <dt>Driver</dt>
                <dd>{form.driverName || '—'}</dd>
                <dt>Driver phone</dt>
                <dd>{form.driverPhone || '—'}</dd>
                <dt>Destination</dt>
                <dd>{form.destination || '—'}</dd>
                <dt>Receipt no.</dt>
                <dd>{form.receiptNumber || '—'}</dd>
                <dt>Read by AI</dt>
                <dd>{ai.status === 'done' ? <Badge tone="info">Yes, then checked by you</Badge> : 'No — entered manually'}</dd>
              </dl>
              {preview && <div style={{ marginTop: 12 }}>{preview}</div>}
            </Panel>
            <Panel title="Figures">
              <dl className="kv">
                <dt>Buyer</dt>
                <dd className="strong">{byId.get(buyerId!)?.name}</dd>
                <dt>Base rate / GST</dt>
                <dd>
                  {formatRate(fin.buyer.ratePaise)} + {formatPercent(fin.buyer.gstBp)}
                </dd>
                <dt>Base / GST</dt>
                <dd>
                  {formatINR(fin.buyer.baseAmount)} + {formatINR(fin.buyer.gstAmount)}
                </dd>
                <dt>Buyer total</dt>
                <dd className="strong">{formatINR(fin.buyer.grossAmount)}</dd>
                <dt>Seller</dt>
                <dd>
                  {byId.get(sellerId!)?.name}: {formatRate(fin.seller.ratePaise)} = <strong>{formatINR(fin.seller.amount)}</strong>
                </dd>
                <dt>Commission</dt>
                <dd>{agentId ? `${byId.get(agentId)?.name}: ${formatRate(fin.commission.ratePaise)} = ${formatINR(fin.commission.amount)}` : 'None'}</dd>
                <dt>Freight</dt>
                <dd>{transporterId ? `${byId.get(transporterId)?.name}: ${formatRate(fin.freight.ratePaise)} = ${formatINR(fin.freight.amount)}` : 'None'}</dd>
                <dt>Payment agent</dt>
                <dd>
                  {paId
                    ? `${byId.get(paId)?.name}: receives ${formatINR(fin.paymentAgent.received)}, keeps ${formatINR(fin.paymentAgent.deduction)} (${formatRate(fin.paymentAgent.ratePaise)}), balance ${formatINR(fin.paymentAgent.balance)}`
                    : 'None'}
                </dd>
              </dl>
              {(Object.keys(rates) as RateKey[]).some((k) => rates[k].partyId && rates[k].decision === 'NEW_DEFAULT' && parseRateInput(rates[k], k === 'buyerGst' ? 'percent' : 'rate') !== rates[k].defaultValue) && (
                <div style={{ marginTop: 12 }}>
                  <Notice tone="warn">Some changed rates will become the new default for future orders. Past orders keep their own rates.</Notice>
                </div>
              )}
            </Panel>
          </div>
          {submitError && <Notice tone="danger">{submitError}</Notice>}
          <div className="wizard-foot">
            <Button onClick={() => setStep('parties')} disabled={submitting}>
              Back
            </Button>
            <Button variant="primary" size="lg" busy={submitting} onClick={() => void submit()}>
              Confirm order
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
