import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  updatePassword,
  type User,
} from 'firebase/auth';
import { auth } from '../firebase/app';
import { env } from '../config/env';
import { validateLoginId, validateNewPassword } from '../domain/validation';
import { AppError } from './errors';
import { clearPinAttempts } from './pin';

/**
 * Login IDs are a friendly front for Firebase email/password accounts:
 * "owner" → "owner@<VITE_LOGIN_EMAIL_DOMAIN>". Typing a full email also works.
 */
export function loginIdToEmail(loginId: string): string {
  const id = loginId.trim().toLowerCase();
  return id.includes('@') ? id : `${id}@${env.loginEmailDomain}`;
}

export function emailToLoginId(email: string | null | undefined): string {
  if (!email) return '';
  const suffix = `@${env.loginEmailDomain}`;
  return email.toLowerCase().endsWith(suffix) ? email.slice(0, -suffix.length) : email;
}

export async function signInWithPassword(loginId: string, password: string): Promise<User> {
  const id = validateLoginId(loginId);
  if (!id.ok) throw new AppError(id.error, 'auth/invalid-email');
  if (!password) throw new AppError('Enter your password', 'auth/missing-password');
  const cred = await signInWithEmailAndPassword(auth, loginIdToEmail(id.value), password);
  return cred.user;
}

export async function signOut(): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (uid) clearPinAttempts(uid);
  await fbSignOut(auth);
}

/** Re-confirms the password for sensitive changes (Firebase "recent login"). */
export async function reauthenticate(password: string): Promise<void> {
  const user = auth.currentUser;
  if (!user?.email) throw new AppError('Your session has expired. Sign in again.', 'unauthenticated');
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const v = validateNewPassword(newPassword);
  if (!v.ok) throw new AppError(v.error, 'auth/weak-password');
  if (currentPassword === newPassword) throw new AppError('The new password must be different', 'auth/weak-password');
  await reauthenticate(currentPassword);
  await updatePassword(auth.currentUser!, newPassword);
}

/** When the user last proved their password (Firebase auth_time claim). */
export async function lastPasswordSignIn(user: User): Promise<Date | null> {
  try {
    const result = await user.getIdTokenResult();
    return result.authTime ? new Date(result.authTime) : null;
  } catch {
    return null;
  }
}
