import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../firebase/app';
import { validatePin } from '../domain/validation';
import { AppError } from './errors';
import { COL } from './firestore';

/**
 * 4-digit PIN = a quick UNLOCK for a device where the user has already signed
 * in with their Login ID + password. It is NOT the authorization layer: every
 * Firestore request is still authorised by the Firebase Auth session
 * and the security rules.
 *
 *  - The PIN is never stored. We store a PBKDF2-SHA-256 hash (random 16-byte
 *    salt, 310,000 iterations) in userSecurity/{uid}, readable only by that user.
 *  - 5 wrong PINs sign the device out completely; the password is then needed.
 *  - Changing the PIN requires the current password.
 *
 * Full threat model: docs/SECURITY.md.
 */

export const PIN_ITERATIONS = 310_000;
export const MAX_PIN_ATTEMPTS = 5;
const DELAY_AFTER = 3;
const DELAY_MS = 30_000;

export interface PinRecord {
  hash: string;
  salt: string;
  iterations: number;
}

const b64 = (bytes: ArrayBuffer | Uint8Array): string => {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s);
};
const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(pin: string, salt: Uint8Array, iterations: number, uid: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  // Bind the hash to the user so the same PIN gives different hashes per account.
  const key = await crypto.subtle.importKey('raw', enc.encode(`${uid}:${pin}`), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export async function hashPin(pin: string, uid: string): Promise<PinRecord> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(pin, salt, PIN_ITERATIONS, uid);
  return { hash: b64(hash), salt: b64(salt), iterations: PIN_ITERATIONS };
}

export async function verifyPinAgainst(pin: string, uid: string, record: PinRecord): Promise<boolean> {
  if (!/^\d{4}$/.test(pin)) return false;
  const actual = await derive(pin, unb64(record.salt), record.iterations, uid);
  return constantTimeEqual(actual, unb64(record.hash));
}

export async function loadPinRecord(uid: string): Promise<PinRecord | null> {
  const snap = await getDoc(doc(db, COL.userSecurity, uid));
  const d = snap.data();
  if (!d || typeof d.pinHash !== 'string' || typeof d.pinSalt !== 'string') return null;
  return { hash: d.pinHash, salt: d.pinSalt, iterations: typeof d.pinIterations === 'number' ? d.pinIterations : PIN_ITERATIONS };
}

export async function savePin(uid: string, pin: string): Promise<void> {
  const v = validatePin(pin);
  if (!v.ok) throw new AppError(v.error, 'pin/invalid');
  const rec = await hashPin(pin, uid);
  await setDoc(doc(db, COL.userSecurity, uid), {
    pinHash: rec.hash,
    pinSalt: rec.salt,
    pinIterations: rec.iterations,
    pinUpdatedAt: serverTimestamp(),
  });
}

// ---------------------------------------------------------------------------
// Attempt throttling (per device)
// ---------------------------------------------------------------------------

interface AttemptState {
  count: number;
  lockedUntil: number;
}

const attemptsKey = (uid: string) => `rock.pinAttempts.${uid}`;

export function getPinAttempts(uid: string): AttemptState {
  try {
    const raw = localStorage.getItem(attemptsKey(uid));
    if (!raw) return { count: 0, lockedUntil: 0 };
    const p = JSON.parse(raw) as Partial<AttemptState>;
    return { count: Number(p.count) || 0, lockedUntil: Number(p.lockedUntil) || 0 };
  } catch {
    return { count: 0, lockedUntil: 0 };
  }
}

export function recordFailedPin(uid: string): AttemptState {
  const s = getPinAttempts(uid);
  const count = s.count + 1;
  const lockedUntil = count >= DELAY_AFTER && count < MAX_PIN_ATTEMPTS ? Date.now() + DELAY_MS : 0;
  const next = { count, lockedUntil };
  try {
    localStorage.setItem(attemptsKey(uid), JSON.stringify(next));
  } catch {
    /* storage unavailable: throttling still applies for this page load */
  }
  return next;
}

export function clearPinAttempts(uid: string): void {
  try {
    localStorage.removeItem(attemptsKey(uid));
  } catch {
    /* ignore */
  }
}
