import { APP_NAME } from '../../config/brand';
import { useState, type FormEvent } from 'react';
import { Button, Field, Notice, TextInput } from '../../components/ui';
import { friendlyError } from '../../services/errors';
import { useSession } from '../../state/SessionProvider';
import { AuthLayout } from './AuthLayout';

export function LoginPage() {
  const { signIn, notice } = useSession();
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(loginId, password);
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <div>
        <h1>Sign in</h1>
        <p className="muted small" style={{ marginTop: 4 }}>
          Use your password once on this device. After that, your 4-digit PIN unlocks {APP_NAME}.
        </p>
      </div>
      {notice && <Notice tone="info">{notice}</Notice>}
      <form onSubmit={submit} className="stack" noValidate>
        <Field label="Login ID" htmlFor="loginId">
          <TextInput
            id="loginId"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={loginId}
            onChange={(e) => setLoginId(e.target.value)}
            placeholder="e.g. owner"
            required
          />
        </Field>
        <Field label="Password" htmlFor="password">
          <TextInput id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <Button type="submit" variant="primary" size="lg" block busy={busy}>
          Sign in
        </Button>
      </form>
      <p className="faint small">Forgotten your password? An administrator can reset it in the Firebase console.</p>
    </AuthLayout>
  );
}
