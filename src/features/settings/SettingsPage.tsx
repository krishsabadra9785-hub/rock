import { useState } from 'react';
import { Badge, Button, Field, Notice, PageHeader, Panel, Select, Tabs, TextInput, AmountInput } from '../../components/ui';
import { PartySelect } from '../../components/PartySelect';
import { env } from '../../config/env';
import { financialYearFor, todayISO } from '../../domain/dates';
import { bpToInput, parsePercent } from '../../domain/money';
import { can, ROLE_LABELS } from '../../domain/permissions';
import { ROLES, type Role, type UserProfile } from '../../domain/types';
import { validateNewPassword, validatePin } from '../../domain/validation';
import { useAsync } from '../../hooks/useAsync';
import { changePassword, emailToLoginId } from '../../services/auth';
import { exportAllData } from '../../services/backup';
import { seedDemoData } from '../../services/demo';
import { friendlyError } from '../../services/errors';
import { rebuildRollups } from '../../services/rollups';
import { saveSettings } from '../../services/settings';
import { listUsers, updateOwnDisplayName, upsertUser } from '../../services/users';
import { receiptStorage } from '../../services/receiptStorage';
import { appCheck } from '../../firebase/app';
import { useSession } from '../../state/SessionProvider';
import { useToast } from '../../state/ToastProvider';
import { downloadBlob } from '../../utils/download';

type Tab = 'security' | 'business' | 'ai' | 'users' | 'data';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function useBusy() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<void>, ok?: string) => {
    setBusy(key);
    try {
      await fn();
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

function SecurityTab() {
  const { profile, user, settings, changePin } = useSession();
  const { busy, run } = useBusy();
  const [name, setName] = useState(profile?.displayName ?? '');
  const [pinPw, setPinPw] = useState('');
  const [newPin, setNewPin] = useState('');
  const [newPin2, setNewPin2] = useState('');
  const [curPw, setCurPw] = useState('');
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const pinCheck = newPin ? validatePin(newPin) : null;
  const pwCheck = pw1 ? validateNewPassword(pw1) : null;

  return (
    <div className="stack">
      <Panel title="Profile">
        <div className="form-grid">
          <Field label="Login ID" htmlFor="s-login"><TextInput id="s-login" value={profile?.loginId || emailToLoginId(user?.email)} disabled /></Field>
          <Field label="Role" htmlFor="s-role"><TextInput id="s-role" value={profile ? ROLE_LABELS[profile.role] : ''} disabled /></Field>
          <Field label="Display name" htmlFor="s-name"><TextInput id="s-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <div style={{ alignSelf: 'end' }}>
            <Button busy={busy === 'name'} onClick={() => void run('name', () => updateOwnDisplayName(name), 'Name updated')}>Save name</Button>
          </div>
        </div>
      </Panel>
      <Panel title="Change PIN">
        <div className="form-grid">
          <Field label="Current password" htmlFor="s-pinpw" hint="Required to change your PIN"><TextInput id="s-pinpw" type="password" autoComplete="current-password" value={pinPw} onChange={(e) => setPinPw(e.target.value)} /></Field>
          <div />
          <Field label="New 4-digit PIN" htmlFor="s-pin1" error={pinCheck && !pinCheck.ok ? pinCheck.error : null}><TextInput id="s-pin1" type="password" inputMode="numeric" maxLength={4} autoComplete="new-password" value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))} /></Field>
          <Field label="Repeat new PIN" htmlFor="s-pin2" error={newPin2 && newPin2 !== newPin ? "PINs don't match" : null}><TextInput id="s-pin2" type="password" inputMode="numeric" maxLength={4} autoComplete="new-password" value={newPin2} onChange={(e) => setNewPin2(e.target.value.replace(/\D/g, ''))} /></Field>
        </div>
        <div style={{ marginTop: 14 }}>
          <Button
            variant="primary"
            busy={busy === 'pin'}
            disabled={!pinPw || !pinCheck?.ok || newPin !== newPin2}
            onClick={() => void run('pin', async () => { await changePin(pinPw, newPin); setPinPw(''); setNewPin(''); setNewPin2(''); }, 'PIN changed')}
          >
            Change PIN
          </Button>
        </div>
      </Panel>
      <Panel title="Change password">
        <div className="form-grid">
          <Field label="Current password" htmlFor="s-cpw"><TextInput id="s-cpw" type="password" autoComplete="current-password" value={curPw} onChange={(e) => setCurPw(e.target.value)} /></Field>
          <div />
          <Field label="New password" htmlFor="s-pw1" hint="At least 10 characters with letters and numbers" error={pwCheck && !pwCheck.ok ? pwCheck.error : null}><TextInput id="s-pw1" type="password" autoComplete="new-password" value={pw1} onChange={(e) => setPw1(e.target.value)} /></Field>
          <Field label="Repeat new password" htmlFor="s-pw2" error={pw2 && pw2 !== pw1 ? "Passwords don't match" : null}><TextInput id="s-pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
        </div>
        <div style={{ marginTop: 14 }}>
          <Button
            variant="primary"
            busy={busy === 'pw'}
            disabled={!curPw || !pwCheck?.ok || pw1 !== pw2}
            onClick={() => void run('pw', async () => { await changePassword(curPw, pw1); setCurPw(''); setPw1(''); setPw2(''); }, 'Password changed')}
          >
            Change password
          </Button>
        </div>
      </Panel>
      <Notice tone="info">
        ROCK locks after {settings.autoLockMinutes} minutes without activity and asks for your password every {settings.maxSessionDays} days. Five wrong PINs sign this device out. Your PIN is never stored, only a salted hash of it.
      </Notice>
    </div>
  );
}

function BusinessTab() {
  const { settings, profile } = useSession();
  const { busy, run } = useBusy();
  const editable = can(profile?.role, 'settings.write');
  const [f, setF] = useState({
    businessName: settings.businessName,
    orderPrefix: settings.orderPrefix,
    gst: bpToInput(settings.defaultGstBp),
    fyStartMonth: settings.fyStartMonth,
    defaultPaymentAgentId: settings.defaultPaymentAgentId,
    autoLockMinutes: String(settings.autoLockMinutes),
    maxSessionDays: String(settings.maxSessionDays),
  });
  const gst = parsePercent(f.gst);
  const save = () =>
    run(
      'biz',
      () => {
        if (gst === null || gst > 2800) throw new Error('Enter a valid default GST %');
        return saveSettings({
          businessName: f.businessName.trim() || 'ROCK',
          orderPrefix: f.orderPrefix,
          defaultGstBp: gst,
          fyStartMonth: f.fyStartMonth,
          defaultPaymentAgentId: f.defaultPaymentAgentId,
          autoLockMinutes: Math.max(1, Math.min(120, Number(f.autoLockMinutes) || 5)),
          maxSessionDays: Math.max(1, Math.min(90, Number(f.maxSessionDays) || 30)),
        });
      },
      'Settings saved',
    );
  return (
    <Panel title="Business defaults">
      {!editable && <div style={{ marginBottom: 14 }}><Notice>Only administrators can change these.</Notice></div>}
      <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="form-grid">
          <Field label="Business name" htmlFor="b-name"><TextInput id="b-name" value={f.businessName} onChange={(e) => setF({ ...f, businessName: e.target.value })} /></Field>
          <Field label="Order number prefix" htmlFor="b-prefix" hint={`Next orders look like ${f.orderPrefix.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'ROCK'}-${new Date().getFullYear()}-000123. Existing numbers never change.`}>
            <TextInput id="b-prefix" maxLength={10} value={f.orderPrefix} onChange={(e) => setF({ ...f, orderPrefix: e.target.value })} />
          </Field>
          <Field label="Default GST for new buyers" htmlFor="b-gst"><AmountInput id="b-gst" value={f.gst} onChange={(v) => setF({ ...f, gst: v })} prefix={null} suffix="%" /></Field>
          <Field label="Financial year starts" htmlFor="b-fy" hint={`Current: ${financialYearFor(todayISO(), f.fyStartMonth).label}`}>
            <Select id="b-fy" value={f.fyStartMonth} onChange={(e) => setF({ ...f, fyStartMonth: Number(e.target.value) })}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>1 {m}</option>)}
            </Select>
          </Field>
          <Field label="Default payment agent" htmlFor="b-pa"><PartySelect id="b-pa" type="PAYMENT_AGENT" value={f.defaultPaymentAgentId} onChange={(id) => setF({ ...f, defaultPaymentAgentId: id })} allowNone /></Field>
          <div />
          <Field label="Auto-lock after (minutes)" htmlFor="b-lock"><TextInput id="b-lock" inputMode="numeric" value={f.autoLockMinutes} onChange={(e) => setF({ ...f, autoLockMinutes: e.target.value.replace(/\D/g, '') })} /></Field>
          <Field label="Require password every (days)" htmlFor="b-days"><TextInput id="b-days" inputMode="numeric" value={f.maxSessionDays} onChange={(e) => setF({ ...f, maxSessionDays: e.target.value.replace(/\D/g, '') })} /></Field>
        </div>
      </fieldset>
      {editable && <div style={{ marginTop: 14 }}><Button variant="primary" busy={busy === 'biz'} onClick={() => void save()}>Save settings</Button></div>}
    </Panel>
  );
}

function AiTab() {
  const { settings, profile } = useSession();
  const { busy, run } = useBusy();
  const editable = can(profile?.role, 'settings.write');
  const [enabled, setEnabled] = useState(settings.aiEnabled);
  const [model, setModel] = useState(settings.aiModel);
  return (
    <div className="stack">
      <Panel title="Receipt reading">
        <dl className="kv">
          <dt>Service</dt><dd>Firebase AI Logic, Gemini Developer API (free tier, no billing)</dd>
          <dt>App Check</dt><dd>{appCheck ? <Badge tone="ok">On (reCAPTCHA v3)</Badge> : <Badge tone="warn">Not configured</Badge>}</dd>
          <dt>Receipt images</dt><dd>{receiptStorage.persistsImages ? 'Stored' : 'Used for reading only, never stored'}</dd>
        </dl>
        <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: '16px 0 0' }}>
          <div className="form-grid">
            <label className="check span-2"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Read receipts automatically when creating orders</label>
            <Field label="Model" htmlFor="ai-model" hint="Use a model available on the Gemini Developer API free tier, e.g. gemini-2.5-flash or gemini-2.5-flash-lite">
              <TextInput id="ai-model" value={model} onChange={(e) => setModel(e.target.value.trim())} />
            </Field>
          </div>
        </fieldset>
        {editable && <div style={{ marginTop: 14 }}><Button variant="primary" busy={busy === 'ai'} onClick={() => void run('ai', () => saveSettings({ aiEnabled: enabled, aiModel: model }), 'AI settings saved')}>Save</Button></div>}
      </Panel>
      <Notice tone="info">If the free AI quota runs out or reading fails, ROCK says so and you type the details yourself. It never switches to a paid service.</Notice>
    </div>
  );
}

function UsersTab() {
  const { busy, run } = useBusy();
  const users = useAsync(listUsers, []);
  const empty = { uid: '', loginId: '', displayName: '', role: 'OPERATIONS' as Role, active: true };
  const [f, setF] = useState(empty);
  const edit = (u: UserProfile) => setF({ uid: u.uid, loginId: u.loginId, displayName: u.displayName, role: u.role, active: u.active });
  return (
    <div className="stack">
      <Panel title="People with access" bodyless>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Name</th><th>Login ID</th><th>Role</th><th>Status</th><th /></tr></thead>
            <tbody>
              {(users.data ?? []).map((u) => (
                <tr key={u.uid}>
                  <td>{u.displayName}</td><td>{u.loginId}</td><td>{ROLE_LABELS[u.role]}</td>
                  <td>{u.active ? <Badge tone="ok">Active</Badge> : <Badge>Off</Badge>}</td>
                  <td><Button size="sm" variant="ghost" onClick={() => edit(u)}>Edit</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title={f.uid && users.data?.some((u) => u.uid === f.uid) ? 'Edit access' : 'Grant access'}>
        <Notice>First create the person's account in Firebase console → Authentication → Users → Add user, using the email <code>loginid@{env.loginEmailDomain}</code> and a strong temporary password. Then paste their User UID here.</Notice>
        <div className="form-grid" style={{ marginTop: 14 }}>
          <Field label="User UID" htmlFor="u-uid" className="span-2"><TextInput id="u-uid" value={f.uid} onChange={(e) => setF({ ...f, uid: e.target.value.trim() })} /></Field>
          <Field label="Login ID" htmlFor="u-login"><TextInput id="u-login" value={f.loginId} onChange={(e) => setF({ ...f, loginId: e.target.value })} /></Field>
          <Field label="Display name" htmlFor="u-name"><TextInput id="u-name" value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} /></Field>
          <Field label="Role" htmlFor="u-role">
            <Select id="u-role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </Select>
          </Field>
          <label className="check" style={{ alignSelf: 'end', paddingBottom: 10 }}><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Access active</label>
        </div>
        <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
          <Button variant="primary" busy={busy === 'user'} onClick={() => void run('user', async () => { await upsertUser(f); setF(empty); users.reload(); }, 'Access saved')}>Save access</Button>
          {f.uid && <Button onClick={() => setF(empty)}>Clear</Button>}
        </div>
      </Panel>
    </div>
  );
}

function DataTab() {
  const { settings } = useSession();
  const { busy, run } = useBusy();
  const [progress, setProgress] = useState('');
  return (
    <div className="stack">
      <Panel title="Backup">
        <p className="muted" style={{ marginBottom: 12 }}>Downloads every business record (parties, orders, payments, rate history, settings) as a JSON file. Keep it somewhere safe; it contains confidential data.</p>
        <Button icon="download" busy={busy === 'export'} onClick={() => void run('export', async () => { const b = await exportAllData(setProgress); downloadBlob(`rock-backup-${todayISO()}.json`, b); setProgress(''); }, 'Backup downloaded')}>Download backup</Button>
      </Panel>
      <Panel title="Rebuild statistics">
        <p className="muted" style={{ marginBottom: 12 }}>Dashboards use summary documents kept up to date with every order and payment. If figures ever look wrong, rebuild them from the original records. This reads every order and payment once.</p>
        <Button icon="refresh" busy={busy === 'rebuild'} onClick={() => void run('rebuild', async () => { const r = await rebuildRollups(setProgress); setProgress(`Done: ${r.orders} orders, ${r.payments} payments.`); }, 'Statistics rebuilt')}>Rebuild statistics</Button>
      </Panel>
      {env.enableDemoTools && (
        <Panel title="Demo data">
          <Notice tone="warn">Use only in a test Firebase project. Demo records are real financial records and can't be deleted.</Notice>
          <div style={{ marginTop: 12 }}>
            <Button busy={busy === 'demo'} onClick={() => void run('demo', async () => { const n = await seedDemoData(settings.orderPrefix, setProgress); setProgress(`Created ${n}.`); }, 'Demo data created')}>Load demo data (38.52 MT reference order)</Button>
          </div>
        </Panel>
      )}
      {progress && <Notice>{progress}</Notice>}
    </div>
  );
}

export default function SettingsPage() {
  const { profile } = useSession();
  const admin = can(profile?.role, 'users.manage');
  const [tab, setTab] = useState<Tab>('security');
  const tabs: { value: Tab; label: string }[] = [
    { value: 'security', label: 'Profile & security' },
    { value: 'business', label: 'Business' },
    { value: 'ai', label: 'AI receipt reading' },
    ...(admin ? ([{ value: 'users', label: 'Users' }, { value: 'data', label: 'Data' }] as { value: Tab; label: string }[]) : []),
  ];
  return (
    <div>
      <PageHeader title="Settings" />
      <Tabs<Tab> tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'security' && <SecurityTab />}
      {tab === 'business' && <BusinessTab />}
      {tab === 'ai' && <AiTab />}
      {tab === 'users' && admin && <UsersTab />}
      {tab === 'data' && admin && <DataTab />}
    </div>
  );
}
