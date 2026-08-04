import { auth } from './firebase';
import { OperationType, FirestoreErrorInfo, Group, UserRole } from './types';

export function getUserRole(group: Group, userEmail?: string | null, userUid?: string | null): UserRole {
  const currentUid = userUid || auth.currentUser?.uid;
  const currentEmail = (userEmail || auth.currentUser?.email || '').toLowerCase();

  if (!currentUid && !currentEmail) return 'viewer';
  if (group.ownerId === currentUid) return 'owner';

  if (group.sharedUsers && Array.isArray(group.sharedUsers)) {
    const match = group.sharedUsers.find(
      u => (currentUid && u.uid === currentUid) || (currentEmail && u.email.toLowerCase() === currentEmail)
    );
    if (match) {
      return match.role;
    }
  }

  if (currentEmail && group.allowedEmails && Array.isArray(group.allowedEmails)) {
    if (group.allowedEmails.some(e => e.toLowerCase() === currentEmail)) {
      return 'editor';
    }
  }

  return 'viewer';
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

export function formatCurrency(amount: number) {
  return new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK' }).format(amount);
}

export function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium' }).format(timestamp);
}
