import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../firebase/app';
import { DEFAULT_SETTINGS, type AppSettings, type UserProfile } from '../domain/types';
import { validatePin } from '../domain/validation';
import { lastPasswordSignIn, reauthenticate, signInWithPassword, signOut as authSignOut } from '../services/auth';
import { AppError, friendlyError } from '../services/errors';
import {
  clearPinAttempts,
  getPinAttempts,
  loadPinRecord,
  MAX_PIN_ATTEMPTS,
  recordFailedPin,
  savePin,
  verifyPinAgainst,
  type PinRecord,
} from '../services/pin';
import { subscribeSettings } from '../services/settings';
import { subscribeUserProfile } from '../services/users';
import { useIdleLock } from '../hooks/useIdleLock';

/**
 * Session states:
 *   loading      – waiting for Firebase Auth to restore any saved session
 *   signedOut    – show Login ID + password
 *   checking     – signed in; loading profile, settings and PIN status
 *   unauthorized – signed in but no active users/{uid} profile (rules deny data)
 *   needsPin     – just signed in with password and no PIN yet → create one
 *   locked       – saved session on this device → enter PIN to continue
 *   unlocked     – app is usable
 */
export type SessionStatus = 'loading' | 'signedOut' | 'checking' | 'unauthorized' | 'needsPin' | 'locked' | 'unlocked';

export type UnlockResult = 'ok' | 'wrong' | 'throttled' | 'signedOut';

interface SessionContextValue {
  status: SessionStatus;
  user: User | null;
  profile: UserProfile | null;
  settings: AppSettings;
  notice: string | null;
  attemptsLeft: number;
  throttledUntil: number;
  signIn: (loginId: string, password: string) => Promise<void>;
  signOut: (notice?: string) => Promise<void>;
  lock: () => void;
  unlock: (pin: string) => Promise<UnlockResult>;
  createPin: (pin: string) => Promise<void>;
  changePin: (currentPassword: string, newPin: string) => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null | undefined>(undefined);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [attempts, setAttempts] = useState({ count: 0, lockedUntil: 0 });

  const freshLogin = useRef(false);
  const gateDone = useRef(false);
  const pinRecord = useRef<PinRecord | null>(null);

  const doSignOut = useCallback(async (message?: string) => {
    gateDone.current = false;
    freshLogin.current = false;
    pinRecord.current = null;
    setNotice(message ?? null);
    try {
      await authSignOut();
    } catch {
      /* already signed out */
    }
  }, []);

  // 1. Firebase Auth session
  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      gateDone.current = false;
      pinRecord.current = null;
      setProfile(undefined);
      setSettingsLoaded(false);
      if (!u) {
        setStatus('signedOut');
        return;
      }
      setAttempts(getPinAttempts(u.uid));
      setStatus('checking');
    });
  }, []);

  // 2. Profile (authorisation) — live, so deactivation takes effect immediately
  useEffect(() => {
    if (!user) return;
    return subscribeUserProfile(
      user.uid,
      (p) => setProfile(p),
      (e) => {
        setProfile(null);
        setNotice(friendlyError(e));
      },
    );
  }, [user]);

  // 3. Settings, once authorised
  const authorised = !!profile && profile.active;
  useEffect(() => {
    if (!user || !authorised) return;
    return subscribeSettings(
      (s) => {
        setSettings(s);
        setSettingsLoaded(true);
      },
      () => setSettingsLoaded(true),
    );
  }, [user, authorised]);

  // 4. Gate: authorisation → session age → PIN
  useEffect(() => {
    if (!user || profile === undefined) return;
    if (!profile || !profile.active) {
      if (gateDone.current) {
        void doSignOut('Your access has been turned off. Contact your administrator.');
      } else {
        setStatus('unauthorized');
      }
      return;
    }
    if (gateDone.current || !settingsLoaded) return;
    gateDone.current = true;
    // Not cancelled on re-render (a profile/settings update mid-check must not
    // strand the gate); instead results are dropped if the user has changed.
    const stale = () => auth.currentUser?.uid !== user.uid;
    (async () => {
      try {
        if (!freshLogin.current) {
          const last = await lastPasswordSignIn(user);
          const maxAgeMs = settings.maxSessionDays * 86_400_000;
          if (!last || Date.now() - last.getTime() > maxAgeMs) {
            await doSignOut(`For security, sign in with your password every ${settings.maxSessionDays} days.`);
            return;
          }
        }
        const rec = await loadPinRecord(user.uid);
        if (stale()) return;
        pinRecord.current = rec;
        if (!rec) {
          if (freshLogin.current) setStatus('needsPin');
          else await doSignOut('Sign in with your password to set up your PIN.');
          return;
        }
        if (freshLogin.current) {
          freshLogin.current = false;
          setStatus('unlocked');
        } else {
          setStatus('locked');
        }
      } catch (e) {
        if (!stale()) {
          gateDone.current = false;
          setNotice(friendlyError(e));
          setStatus(freshLogin.current ? 'signedOut' : 'locked');
          if (freshLogin.current) void doSignOut(friendlyError(e));
        }
      }
    })();
  }, [user, profile, settingsLoaded, settings.maxSessionDays, doSignOut]);

  const signIn = useCallback(async (loginId: string, password: string) => {
    setNotice(null);
    freshLogin.current = true;
    try {
      const u = await signInWithPassword(loginId, password);
      clearPinAttempts(u.uid);
      setAttempts({ count: 0, lockedUntil: 0 });
    } catch (e) {
      freshLogin.current = false;
      throw e;
    }
  }, []);

  const lock = useCallback(() => {
    setStatus((s) => (s === 'unlocked' ? 'locked' : s));
  }, []);

  const unlock = useCallback(
    async (pin: string): Promise<UnlockResult> => {
      if (!user) return 'signedOut';
      const current = getPinAttempts(user.uid);
      if (current.lockedUntil > Date.now()) {
        setAttempts(current);
        return 'throttled';
      }
      let rec = pinRecord.current;
      if (!rec) {
        rec = await loadPinRecord(user.uid);
        pinRecord.current = rec;
      }
      if (!rec) {
        await doSignOut('Sign in with your password to set up your PIN.');
        return 'signedOut';
      }
      if (await verifyPinAgainst(pin, user.uid, rec)) {
        clearPinAttempts(user.uid);
        setAttempts({ count: 0, lockedUntil: 0 });
        setNotice(null);
        setStatus('unlocked');
        return 'ok';
      }
      const next = recordFailedPin(user.uid);
      setAttempts(next);
      if (next.count >= MAX_PIN_ATTEMPTS) {
        await doSignOut('Too many wrong PIN attempts. Sign in with your password.');
        return 'signedOut';
      }
      return next.lockedUntil > Date.now() ? 'throttled' : 'wrong';
    },
    [user, doSignOut],
  );

  const createPin = useCallback(
    async (pin: string) => {
      if (!user) throw new AppError('Your session has expired. Sign in again.', 'unauthenticated');
      const v = validatePin(pin);
      if (!v.ok) throw new AppError(v.error);
      await savePin(user.uid, pin);
      pinRecord.current = await loadPinRecord(user.uid);
      freshLogin.current = false;
      setStatus('unlocked');
    },
    [user],
  );

  const changePin = useCallback(
    async (currentPassword: string, newPin: string) => {
      if (!user) throw new AppError('Your session has expired. Sign in again.', 'unauthenticated');
      const v = validatePin(newPin);
      if (!v.ok) throw new AppError(v.error);
      await reauthenticate(currentPassword);
      await savePin(user.uid, newPin);
      pinRecord.current = await loadPinRecord(user.uid);
      clearPinAttempts(user.uid);
    },
    [user],
  );

  useIdleLock(status === 'unlocked', settings.autoLockMinutes, lock);

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      user,
      profile: profile ?? null,
      settings,
      notice,
      attemptsLeft: Math.max(0, MAX_PIN_ATTEMPTS - attempts.count),
      throttledUntil: attempts.lockedUntil,
      signIn,
      signOut: doSignOut,
      lock,
      unlock,
      createPin,
      changePin,
    }),
    [status, user, profile, settings, notice, attempts, signIn, doSignOut, lock, unlock, createPin, changePin],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}

/** Convenience: the signed-in profile (only call inside unlocked screens). */
export function useProfile(): UserProfile {
  const { profile } = useSession();
  if (!profile) throw new Error('No profile');
  return profile;
}
