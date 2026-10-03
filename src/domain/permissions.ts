import type { Role } from './types';

export type Action =
  | 'order.create'
  | 'order.edit'
  | 'order.cancel'
  | 'party.write'
  | 'rate.change'
  | 'payment.create'
  | 'payment.void'
  | 'settings.write'
  | 'users.manage'
  | 'audit.read'
  | 'data.admin';

/** Must stay in sync with firestore.rules (see docs/SECURITY.md). */
const MATRIX: Record<Action, readonly Role[]> = {
  'order.create': ['ADMIN', 'ACCOUNTS', 'OPERATIONS'],
  'order.edit': ['ADMIN', 'ACCOUNTS'],
  'order.cancel': ['ADMIN'],
  'party.write': ['ADMIN', 'ACCOUNTS', 'OPERATIONS'],
  'rate.change': ['ADMIN', 'ACCOUNTS', 'OPERATIONS'],
  'payment.create': ['ADMIN', 'ACCOUNTS'],
  'payment.void': ['ADMIN', 'ACCOUNTS'],
  'settings.write': ['ADMIN'],
  'users.manage': ['ADMIN'],
  'audit.read': ['ADMIN', 'ACCOUNTS'],
  'data.admin': ['ADMIN'],
};

export function can(role: Role | null | undefined, action: Action): boolean {
  return !!role && MATRIX[action].includes(role);
}

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrator',
  ACCOUNTS: 'Accounts',
  OPERATIONS: 'Operations',
  VIEW_ONLY: 'View only',
};
