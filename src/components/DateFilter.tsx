import { DATE_PRESETS, describeRange, financialYearFor, todayISO } from '../domain/dates';
import type { DateRangeState } from '../hooks/useDateRange';
import { useSession } from '../state/SessionProvider';

export function DateFilter({ state, hideAllTime }: { state: DateRangeState; hideAllTime?: boolean }) {
  const { settings } = useSession();
  const fyLabel = financialYearFor(todayISO(), settings.fyStartMonth).label;
  return (
    <div className="date-filter no-print">
      <div className="chips" role="group" aria-label="Date range">
        {DATE_PRESETS.filter((p) => !(hideAllTime && p.value === 'ALL_TIME')).map((p) => (
          <button key={p.value} type="button" className="chip" aria-pressed={state.preset === p.value} onClick={() => state.setPreset(p.value)}>
            {p.value === 'THIS_FY' ? fyLabel : p.label}
          </button>
        ))}
      </div>
      {state.preset === 'CUSTOM' && (
        <>
          <input
            type="date"
            className="input"
            aria-label="From date"
            value={state.custom.from ?? ''}
            onChange={(e) => state.setCustom({ ...state.custom, from: e.target.value || null })}
          />
          <input
            type="date"
            className="input"
            aria-label="To date"
            value={state.custom.to ?? ''}
            onChange={(e) => state.setCustom({ ...state.custom, to: e.target.value || null })}
          />
        </>
      )}
      <span className="range-label">{describeRange(state.range)}</span>
    </div>
  );
}
