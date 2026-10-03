import { useMemo, useState } from 'react';
import { isValidISODate, resolvePreset, type DatePreset, type DateRange } from '../domain/dates';
import { useSession } from '../state/SessionProvider';

export interface DateRangeState {
  preset: DatePreset;
  setPreset: (p: DatePreset) => void;
  custom: DateRange;
  setCustom: (r: DateRange) => void;
  range: DateRange;
}

/** Date-filter state that respects the configured financial year. */
export function useDateRange(initial: DatePreset = 'THIS_MONTH', initialCustom?: DateRange): DateRangeState {
  const { settings } = useSession();
  const [preset, setPreset] = useState<DatePreset>(initialCustom ? 'CUSTOM' : initial);
  const [custom, setCustom] = useState<DateRange>(initialCustom ?? { from: null, to: null });
  const range = useMemo(
    () => resolvePreset(preset, { fyStartMonth: settings.fyStartMonth, custom }),
    [preset, custom, settings.fyStartMonth],
  );
  return { preset, setPreset, custom, setCustom, range };
}

/** Encodes a range for drill-down links: "?from=2026-10-01&to=2026-10-31" (empty = all time). */
export function rangeQuery(range: DateRange): string {
  const p = new URLSearchParams();
  p.set('from', range.from ?? '');
  p.set('to', range.to ?? '');
  return p.toString();
}

/** Reads a range from drill-down links; undefined when the URL has none. */
export function rangeFromSearch(params: URLSearchParams): DateRange | undefined {
  if (!params.has('from') && !params.has('to')) return undefined;
  const from = params.get('from');
  const to = params.get('to');
  return { from: from && isValidISODate(from) ? from : null, to: to && isValidISODate(to) ? to : null };
}
