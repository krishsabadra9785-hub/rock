import { useState } from 'react';
import { Button, Notice } from '../../components/ui';
import { missingFirebaseConfig } from '../../config/env';
import { useSession } from '../../state/SessionProvider';
import { AuthLayout } from './AuthLayout';

export function LoadingScreen({ label = 'Loading ROCK…' }: { label?: string }) {
  return (
    <div style={{ minHeight: '100%', display: 'grid', placeItems: 'center' }} role="status">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', color: 'var(--muted)' }}>
        <span className="spinner" /> {label}
      </div>
    </div>
  );
}

export function NotAuthorizedScreen() {
  const { user, signOut, notice } = useSession();
  const [copied, setCopied] = useState(false);
  const uid = user?.uid ?? '';
  return (
    <AuthLayout>
      <h1>Your account isn't set up in ROCK yet</h1>
      <p className="muted">
        You signed in successfully, but this account has no active ROCK profile, so the database won't share any business data with it.
      </p>
      {notice && <Notice tone="warn">{notice}</Notice>}
      <Notice tone="info">
        <strong>If you are the owner setting up ROCK for the first time:</strong> in the Firebase console open Firestore Database, create a
        collection <code>users</code> with a document whose ID is exactly the User UID below, and add the fields shown in the README
        (section "Create the first administrator").
      </Notice>
      <div className="panel" style={{ padding: 14 }}>
        <div className="small muted">Your User UID</div>
        <code style={{ wordBreak: 'break-all', fontSize: '0.95rem' }}>{uid}</code>
        <div style={{ marginTop: 10 }}>
          <Button
            size="sm"
            onClick={() => {
              void navigator.clipboard?.writeText(uid).then(() => setCopied(true));
            }}
          >
            {copied ? 'Copied' : 'Copy UID'}
          </Button>
        </div>
      </div>
      <p className="muted small">Employees: ask your administrator to grant access in Settings → Users, then sign in again.</p>
      <Button onClick={() => void signOut()}>Sign out</Button>
    </AuthLayout>
  );
}

export function SetupRequiredScreen() {
  const missing = missingFirebaseConfig();
  return (
    <AuthLayout>
      <h1>Firebase isn't configured</h1>
      <p className="muted">ROCK needs your Firebase project settings before it can start. These values are missing:</p>
      <ul>
        {missing.map((m) => (
          <li key={m}>
            <code>{m}</code>
          </li>
        ))}
      </ul>
      <Notice tone="info">
        Copy <code>.env.example</code> to <code>.env.local</code>, fill in the values from Firebase → Project settings → Your apps, then
        restart <code>npm run dev</code> (or rebuild before deploying). See README → "Add your Firebase configuration".
      </Notice>
    </AuthLayout>
  );
}
