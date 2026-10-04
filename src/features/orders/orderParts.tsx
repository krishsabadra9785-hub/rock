import type { ReactNode } from 'react';
import { AmountInput, Field, Segmented } from '../../components/ui';
import type { OrderFinancials } from '../../domain/calc';
import { formatINR, formatPercent, formatRate } from '../../domain/format';
import { bpToInput, paiseToInput, parsePercent, parseRupees } from '../../domain/money';
import { suggestDecision, type RateDecision } from '../../domain/rates';

export interface RateState {
  partyId: string | null;
  /** Party default at the time it was selected (null = none yet). */
  defaultValue: number | null;
  input: string;
  decision: RateDecision;
}

export const emptyRate = (): RateState => ({ partyId: null, defaultValue: null, input: '', decision: 'ORDER_ONLY' });

export function rateFromDefault(partyId: string | null, def: number | null, unit: 'rate' | 'percent', fallback?: number | null): RateState {
  const initial = def ?? fallback ?? null;
  return {
    partyId,
    defaultValue: def,
    input: initial === null ? '' : unit === 'percent' ? bpToInput(initial) : paiseToInput(initial),
    decision: suggestDecision(def),
  };
}

export function parseRateInput(s: RateState, unit: 'rate' | 'percent'): number | null {
  if (!s.input.trim()) return null;
  return unit === 'percent' ? parsePercent(s.input) : parseRupees(s.input);
}

/**
 * A pre-filled rate. When the user changes it, they must say whether it's for
 * THIS ORDER ONLY or the NEW DEFAULT for future orders (universal rate rule).
 */
export function RateField({
  label,
  state,
  onChange,
  unit = 'rate',
  disabled,
  error,
  total,
  id,
}: {
  label: string;
  state: RateState;
  onChange: (s: RateState) => void;
  unit?: 'rate' | 'percent';
  disabled?: boolean;
  error?: string | null;
  total?: ReactNode;
  id: string;
}) {
  const parsed = parseRateInput(state, unit);
  const changed = parsed !== null && parsed !== state.defaultValue;
  const fmt = (v: number) => (unit === 'percent' ? formatPercent(v) : formatRate(v));
  return (
    <div className="rate-row">
      <Field
        label={label}
        htmlFor={id}
        error={error}
        hint={state.defaultValue === null ? 'No saved default yet' : `Saved default ${fmt(state.defaultValue)}`}
      >
        <AmountInput
          id={id}
          value={state.input}
          onChange={(input) => onChange({ ...state, input })}
          prefix={unit === 'percent' ? null : '₹'}
          suffix={unit === 'percent' ? '%' : '/MT'}
          disabled={disabled}
          invalid={!!error}
        />
      </Field>
      <div className="line-total" style={{ paddingBottom: 10, minWidth: 90, textAlign: 'right' }}>
        {total}
      </div>
      {changed && !disabled && (
        <div className="rate-choice">
          <span>
            {state.defaultValue === null ? 'Save this as the default?' : `Changed from ${fmt(state.defaultValue)}.`}
          </span>
          <Segmented
            label={`${label}: apply to`}
            value={state.decision}
            onChange={(decision) => onChange({ ...state, decision })}
            options={[
              { value: 'ORDER_ONLY', label: 'This order only' },
              { value: 'NEW_DEFAULT', label: 'New default going forward' },
            ]}
          />
        </div>
      )}
    </div>
  );
}

/** The haul line: what the buyer owes us, what we owe each party, and what is left. */
export function MoneyFlow({ fin }: { fin: OrderFinancials }) {
  const agentsAndFreight = fin.commission.amount + fin.freight.amount + fin.paymentAgent.amount;
  const remaining = fin.buyer.grossAmount - fin.seller.amount - agentsAndFreight;
  return (
    <div className="flow" aria-label="Money flow">
      <div className="flow-node">
        <div className="k">Buyer pays us (incl. GST)</div>
        <div className="v">{formatINR(fin.buyer.grossAmount)}</div>
        <div className="d">
          {formatINR(fin.buyer.baseAmount)} + {formatINR(fin.buyer.gstAmount)} GST
        </div>
      </div>
      <div className="flow-node minus">
        <div className="k">We pay the seller</div>
        <div className="v">{formatINR(fin.seller.amount)}</div>
        <div className="d">{formatRate(fin.seller.ratePaise)}</div>
      </div>
      <div className="flow-node minus">
        <div className="k">We pay agents & freight</div>
        <div className="v">{formatINR(agentsAndFreight)}</div>
        <div className="d">
          commission {formatINR(fin.commission.amount)}, freight {formatINR(fin.freight.amount)}, payment agent {formatINR(fin.paymentAgent.amount)}
        </div>
      </div>
      <div className="flow-node">
        <div className="k">Left after payouts</div>
        <div className="v">{formatINR(remaining)}</div>
        <div className="d">GST collected is not yet settled</div>
      </div>
    </div>
  );
}
