import { useEffect, useState } from 'react';
import { Button, Notice } from '../../components/ui';
import { friendlyError } from '../../services/errors';
import { useSession } from '../../state/SessionProvider';
import { AuthLayout } from './AuthLayout';
import { PinPad } from './PinPad';

export function LockScreen() {
  const { profile, unlock, signOut, attemptsLeft, throttledUntil, notice } = useSession();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [now, setNow] = useState(Date.now());

  const throttled = throttledUntil > now;
  useEffect(() => {
    if (!throttled) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [throttled]);

  const onComplete = async (pin: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await unlock(pin);
      if (r === 'wrong' || r === 'throttled') {
        setShake((s) => s + 1);
        setNow(Date.now());
        setMessage(r === 'wrong' ? 'Wrong PIN.' : null);
      }
    } catch (e) {
      setMessage(friendlyError(e));
      setShake((s) => s + 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <div style={{ textAlign: 'center' }}>
        <h1>Enter your PIN</h1>
        <p className="muted small" style={{ marginTop: 4 }}>
          {profile?.displayName ? `Signed in as ${profile.displayName}` : 'ROCK is locked'}
        </p>
      </div>
      {notice && <Notice tone="warn">{notice}</Notice>}
      <PinPad onComplete={onComplete} disabled={busy || throttled} shake={shake} />
      <div style={{ textAlign: 'center', minHeight: 40 }} aria-live="polite">
        {throttled ? (
          <p className="small" style={{ color: 'var(--warn)' }}>
            Too many attempts. Try again in {Math.ceil((throttledUntil - now) / 1000)} s.
          </p>
        ) : message ? (
          <p className="small" style={{ color: 'var(--danger)' }}>
            {message} {attemptsLeft < 5 && `${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} left before you must use your password.`}
          </p>
        ) : null}
      </div>
      <Button variant="ghost" onClick={() => void signOut()} block>
        Use password instead
      </Button>
    </AuthLayout>
  );
}
