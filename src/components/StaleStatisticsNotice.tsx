import type { RollupData } from '../domain/rollups';
import { can } from '../domain/permissions';
import { useSession } from '../state/SessionProvider';
import { ButtonLink, Notice } from './ui';

/**
 * Shown wherever totals come from statistics documents that still contain
 * figures from the obsolete payment-agent model. Those totals are wrong until
 * an administrator runs the repair in Settings → Data.
 */
export function StaleStatisticsNotice({ data }: { data: (RollupData | undefined)[] }) {
  const { profile } = useSession();
  if (!data.some((d) => (d?.legacyDocs ?? 0) > 0)) return null;
  return (
    <Notice tone="warn" icon="alert">
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span>
          Some summary figures were saved under the old Payment Agent model, so payment-agent totals and averages on this page are wrong.
          {can(profile?.role, 'data.admin') ? ' Run the repair in Settings → Data.' : ' Ask an administrator to run the repair in Settings → Data.'}
          {' '}Order ledgers are correct.
        </span>
        {can(profile?.role, 'data.admin') && <ButtonLink size="sm" to="/settings">Open Settings</ButtonLink>}
      </div>
    </Notice>
  );
}
