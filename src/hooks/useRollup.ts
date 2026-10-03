import type { DateRange } from '../domain/dates';
import type { RollupData } from '../domain/rollups';
import { loadRollup } from '../services/rollups';
import { useAsync, type AsyncState } from './useAsync';

export function useRollup(range: DateRange): AsyncState<RollupData> {
  return useAsync(() => loadRollup(range), [range.from, range.to]);
}
