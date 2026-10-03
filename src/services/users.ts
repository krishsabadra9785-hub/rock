import { collection, doc, getDocs, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, type Unsubscribe } from 'firebase/firestore';
import { db } from '../firebase/app';
import { ROLES, type Role, type UserProfile } from '../domain/types';
import { validateLoginId, validateName } from '../domain/validation';
import { AppError } from './errors';
import { COL, requireUid, str } from './firestore';

function toProfile(uid: string, d: Record<string, unknown> | undefined): UserProfile | null {
  if (!d) return null;
  const role = (ROLES as readonly string[]).includes(str(d.role)) ? (d.role as Role) : 'VIEW_ONLY';
  return { uid, loginId: str(d.loginId), displayName: str(d.displayName) || str(d.loginId), role, active: d.active === true };
}

/** Live profile for the signed-in user. `null` = no profile document (not yet authorised). */
export function subscribeUserProfile(
  uid: string,
  onValue: (p: UserProfile | null) => void,
  onError: (e: unknown) => void,
): Unsubscribe {
  return onSnapshot(doc(db, COL.users, uid), (s) => onValue(toProfile(uid, s.data())), onError);
}

export async function listUsers(): Promise<UserProfile[]> {
  const snap = await getDocs(query(collection(db, COL.users), orderBy('loginId')));
  return snap.docs.map((d) => toProfile(d.id, d.data())).filter((p): p is UserProfile => p !== null);
}

/**
 * Grants (or updates) app access for a Firebase Auth user. The Auth account
 * itself is created in the Firebase console (see README → "Adding employees").
 */
export async function upsertUser(input: { uid: string; loginId: string; displayName: string; role: Role; active: boolean }): Promise<void> {
  const actor = requireUid();
  const uid = input.uid.trim();
  if (!/^[A-Za-z0-9]{20,128}$/.test(uid)) throw new AppError('Paste the User UID from Firebase → Authentication → Users');
  const login = validateLoginId(input.loginId);
  if (!login.ok) throw new AppError(login.error);
  const name = validateName(input.displayName, 'Display name');
  if (!name.ok) throw new AppError(name.error);
  if (uid === actor && (input.role !== 'ADMIN' || !input.active)) {
    throw new AppError('You cannot remove your own administrator access');
  }
  await setDoc(
    doc(db, COL.users, uid),
    {
      loginId: login.value,
      displayName: name.value,
      role: input.role,
      active: input.active,
      updatedAt: serverTimestamp(),
      updatedBy: actor,
    },
    { merge: true },
  );
}

export async function updateOwnDisplayName(displayName: string): Promise<void> {
  const uid = requireUid();
  const name = validateName(displayName, 'Display name');
  if (!name.ok) throw new AppError(name.error);
  await updateDoc(doc(db, COL.users, uid), { displayName: name.value, updatedAt: serverTimestamp(), updatedBy: uid });
}
