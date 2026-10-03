import { FirebaseError } from 'firebase/app';

/** Turns Firebase / network errors into plain-language messages for the UI. */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'app/error',
  ) {
    super(message);
    this.name = 'AppError';
  }
}

const MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'Login ID or password is incorrect.',
  'auth/wrong-password': 'Login ID or password is incorrect.',
  'auth/user-not-found': 'Login ID or password is incorrect.',
  'auth/invalid-email': 'That login ID is not valid.',
  'auth/user-disabled': 'This account has been disabled. Contact your administrator.',
  'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
  'auth/network-request-failed': 'No internet connection. Check your network and try again.',
  'auth/requires-recent-login': 'For your security, sign in with your password again first.',
  'auth/user-token-expired': 'Your session has expired. Sign in again.',
  'auth/weak-password': 'Choose a stronger password (at least 10 characters with letters and numbers).',
  'permission-denied': 'You do not have permission to do this. Ask an administrator to check your role.',
  unavailable: 'The database is unreachable right now. Check your internet connection and try again.',
  'deadline-exceeded': 'The request took too long. Check your connection and try again.',
  aborted: 'Someone else changed this record at the same time. Please try again.',
  'failed-precondition': 'The database needs an index or setup step. See README → Troubleshooting.',
  'resource-exhausted': 'Usage limit reached for today. Try again later or upgrade your Firebase plan.',
  unauthenticated: 'Your session has expired. Sign in again.',
  'not-found': 'That record no longer exists.',
};

export function errorCode(e: unknown): string {
  if (e instanceof AppError) return e.code;
  if (e instanceof FirebaseError) return e.code.replace(/^firestore\//, '');
  if (e && typeof e === 'object' && 'code' in e && typeof (e as { code: unknown }).code === 'string') {
    return (e as { code: string }).code;
  }
  return 'unknown';
}

export function friendlyError(e: unknown): string {
  if (e instanceof AppError) return e.message;
  const code = errorCode(e);
  if (MESSAGES[code]) return MESSAGES[code];
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 'You are offline. Reconnect and try again.';
  if (e instanceof Error && e.message) return e.message;
  return 'Something went wrong. Try again.';
}

export function isPermissionError(e: unknown): boolean {
  return errorCode(e) === 'permission-denied';
}

export function isAuthExpiredError(e: unknown): boolean {
  const c = errorCode(e);
  return c === 'unauthenticated' || c === 'auth/user-token-expired' || c === 'auth/requires-recent-login';
}
