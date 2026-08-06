import { auth } from './firebase';
import { OperationType, FirestoreErrorInfo, Group, UserRole } from './types';

export function getUserRole(group: Group, userEmail?: string | null, userUid?: string | null): UserRole {
  const currentUid = userUid || auth.currentUser?.uid;
  const currentEmail = (userEmail || auth.currentUser?.email || '').toLowerCase();

  if (!currentUid && !currentEmail) return 'viewer';
  if (group.ownerId === currentUid) return 'owner';

  if (group.sharedUsers && Array.isArray(group.sharedUsers)) {
    const match = group.sharedUsers.find(
      u => (currentUid && u.uid === currentUid) || (currentEmail && u.email?.toLowerCase() === currentEmail)
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

export function getCurrencySymbol(currencyCode: string = 'CZK'): string {
  const code = (currencyCode || 'CZK').toUpperCase().trim();
  switch (code) {
    case 'CZK':
    case 'KC':
    case 'KČ':
      return 'Kč';
    case 'EUR':
      return '€';
    case 'USD':
      return '$';
    case 'GBP':
      return '£';
    case 'PLN':
      return 'zł';
    case 'CHF':
      return 'CHF';
    case 'HUF':
      return 'Ft';
    default:
      return code || 'Kč';
  }
}

export function formatCurrency(amount: number, currencyCode: string = 'CZK') {
  const code = (currencyCode || 'CZK').toUpperCase().trim();
  try {
    return new Intl.NumberFormat('cs-CZ', {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch (e) {
    const symbol = getCurrencySymbol(currencyCode);
    return `${amount.toLocaleString('cs-CZ')} ${symbol}`;
  }
}

export function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium' }).format(timestamp);
}
