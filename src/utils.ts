import { auth } from './firebase';
import { collection, query, where, getDocs, doc, writeBatch, Firestore } from 'firebase/firestore';
import { OperationType, FirestoreErrorInfo, Group, UserRole, Fine } from './types';

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

export async function reconcileOverpaymentsForMember(
  db: Firestore,
  groupId: string,
  periodId: string,
  memberId: string
) {
  try {
    const paymentsSnap = await getDocs(
      query(collection(db, `groups/${groupId}/periods/${periodId}/payments`), where('memberId', '==', memberId))
    );
    const totalPayments = paymentsSnap.docs.reduce((sum, d) => sum + (d.data().amount || 0), 0);

    const finesSnap = await getDocs(
      query(collection(db, `groups/${groupId}/periods/${periodId}/fines`), where('memberId', '==', memberId))
    );
    const fines = finesSnap.docs
      .map(d => ({ id: d.id, ...d.data() } as Fine))
      .sort((a, b) => a.createdAt - b.createdAt);

    const batch = writeBatch(db);
    let updatedCount = 0;
    let remainingPayment = totalPayments;

    for (const fine of fines) {
      const allocated = Math.min(fine.amount, Math.max(0, remainingPayment));
      remainingPayment -= allocated;
      const isPaid = allocated >= fine.amount;

      if ((fine.paidAmount || 0) !== allocated || fine.paid !== isPaid) {
        batch.update(doc(db, `groups/${groupId}/periods/${periodId}/fines`, fine.id), {
          paidAmount: allocated,
          paid: isPaid
        });
        updatedCount++;
      }
    }

    if (updatedCount > 0) {
      await batch.commit();
    }
  } catch (err) {
    console.error('Error reconciling overpayments for member:', memberId, err);
  }
}
