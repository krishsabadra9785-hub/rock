import type { Party, PartyType } from '../domain/types';
import { useData } from '../state/DataProvider';
import { PARTY_LABELS } from '../services/parties';
import { Select } from './ui';

/** Native select (best on phones) listing active parties of one type, plus the current value if inactive. */
export function PartySelect({
  type,
  value,
  onChange,
  allowNone,
  noneLabel = 'None',
  id,
  disabled,
  includeInactive,
}: {
  type: PartyType;
  value: string | null;
  onChange: (id: string | null, party: Party | null) => void;
  allowNone?: boolean;
  noneLabel?: string;
  id?: string;
  disabled?: boolean;
  includeInactive?: boolean;
}) {
  const { ofType, byId } = useData();
  const options = ofType(type, { includeInactive });
  const current = value ? byId.get(value) : undefined;
  const list = current && !options.includes(current) ? [current, ...options] : options;
  return (
    <Select
      id={id}
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => {
        const v = e.target.value || null;
        onChange(v, v ? byId.get(v) ?? null : null);
      }}
    >
      <option value="">{allowNone ? noneLabel : `Select ${PARTY_LABELS[type].singular.toLowerCase()}…`}</option>
      {list.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
          {p.code ? ` (${p.code})` : ''}
          {!p.active ? ' (inactive)' : ''}
        </option>
      ))}
    </Select>
  );
}
