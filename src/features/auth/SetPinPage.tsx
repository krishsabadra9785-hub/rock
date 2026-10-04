import { APP_NAME } from '../../config/brand';
import { useState } from 'react';
import { Button, Notice } from '../../components/ui';
import { validatePin } from '../../domain/validation';
import { friendlyError } from '../../services/errors';
import { useSession } from '../../state/SessionProvider';
import { AuthLayout } from './AuthLayout';
import { PinPad } from './PinPad';

export function SetPinPage() {
  const { createPin, signOut } = useSession();
  const [first, setFirst] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);

  const onComplete = async (pin: string) => {
    setError(null);
    if (!first) {
      const v = validatePin(pin);
      if (!v.ok) {
        setError(v.error);
        setShake((s) => s + 1);
        return;
      }
      setFirst(pin);
      setShake((s) => s + 1); // clears the dots for the confirmation entry
      return;
    }
    if (pin !== first) {
      setError("The PINs didn't match. Start again.");
      setFirst(null);
      setShake((s) => s + 1);
      return;
    }
    setBusy(true);
    try {
      await createPin(pin);
    } catch (e) {
      setError(friendlyError(e));
      setFirst(null);
      setShake((s) => s + 1);
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <div style={{ textAlign: 'center' }}>
        <h1>{first ? 'Enter the PIN again' : 'Create a 4-digit PIN'}</h1>
        <p className="muted small" style={{ marginTop: 4 }}>
          You'll use this PIN to unlock {APP_NAME} on your devices. Your password is still needed every few weeks and for security changes.
        </p>
      </div>
      <PinPad onComplete={onComplete} disabled={busy} shake={shake} />
      {error && <Notice tone="danger">{error}</Notice>}
      <Button variant="ghost" block onClick={() => void signOut()}>
        Cancel and sign out
      </Button>
    </AuthLayout>
  );
}
