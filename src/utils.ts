import { auth } from './firebase';
import { collection, query, where, getDocs, doc, updateDoc, writeBatch, Firestore } from 'firebase/firestore';
import { OperationType, FirestoreErrorInfo, Group, UserRole, Fine, RecurringFine, GroupEnabledFeatures, Payment } from './types';

export function isFeatureEnabled(group: Group | undefined, featureKey: keyof GroupEnabledFeatures): boolean {
  if (!group || !group.enabledFeatures) return true;
  const val = group.enabledFeatures[featureKey];
  return val !== undefined ? val : true;
}

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
    const payments = paymentsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Payment));

    const finesSnap = await getDocs(
      query(collection(db, `groups/${groupId}/periods/${periodId}/fines`), where('memberId', '==', memberId))
    );
    const fines = finesSnap.docs
      .map(d => ({ id: d.id, ...d.data() } as Fine));

    // Group payments into targeted vs general
    const fineTargetedMap: Record<string, number> = {};
    let generalPaymentPool = 0;

    payments.forEach(p => {
      if (p.fineId) {
        fineTargetedMap[p.fineId] = (fineTargetedMap[p.fineId] || 0) + (p.amount || 0);
      } else {
        generalPaymentPool += (p.amount || 0);
      }
    });

    // Prioritize partially paid fines so general payments complete partially paid fines first
    fines.sort((a, b) => {
      const targetedA = Math.min(a.amount, fineTargetedMap[a.id] || 0);
      const targetedB = Math.min(b.amount, fineTargetedMap[b.id] || 0);
      const isPartialA = targetedA > 0 || ((a.paidAmount || 0) > 0 && !a.paid);
      const isPartialB = targetedB > 0 || ((b.paidAmount || 0) > 0 && !b.paid);

      if (isPartialA && !isPartialB) return -1;
      if (!isPartialA && isPartialB) return 1;
      return a.createdAt - b.createdAt;
    });

    const batch = writeBatch(db);
    let updatedCount = 0;

    for (const fine of fines) {
      const targeted = fineTargetedMap[fine.id] || 0;
      const allocatedFromTargeted = Math.min(fine.amount, targeted);
      const surplusTargeted = Math.max(0, targeted - fine.amount);

      // Surplus from fine-targeted payments feeds into general payment pool
      generalPaymentPool += surplusTargeted;

      const needed = fine.amount - allocatedFromTargeted;
      const allocatedFromGeneral = Math.min(needed, Math.max(0, generalPaymentPool));
      generalPaymentPool -= allocatedFromGeneral;

      const totalAllocated = allocatedFromTargeted + allocatedFromGeneral;
      const isPaid = totalAllocated >= fine.amount;

      if ((fine.paidAmount || 0) !== totalAllocated || fine.paid !== isPaid) {
        batch.update(doc(db, `groups/${groupId}/periods/${periodId}/fines`, fine.id), {
          paidAmount: totalAllocated,
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

export function calculateNextDueDate(
  currentDateStr: string,
  interval: 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom_days',
  intervalDays?: number,
  dayOfPeriod?: number
): string {
  const parts = currentDateStr.split('-');
  let year = parseInt(parts[0], 10);
  let month = parseInt(parts[1], 10) - 1; // 0-based
  let day = parseInt(parts[2], 10);

  const date = new Date(year, month, day);

  switch (interval) {
    case 'weekly':
      date.setDate(date.getDate() + 7);
      break;
    case 'custom_days':
      date.setDate(date.getDate() + (intervalDays || 14));
      break;
    case 'monthly': {
      month += 1;
      if (month > 11) {
        month = 0;
        year += 1;
      }
      const targetDay = dayOfPeriod || day;
      const daysInTargetMonth = new Date(year, month + 1, 0).getDate();
      const finalDay = Math.min(targetDay, daysInTargetMonth);
      date.setFullYear(year, month, finalDay);
      break;
    }
    case 'quarterly': {
      month += 3;
      if (month > 11) {
        month = month % 12;
        year += 1;
      }
      const targetDay = dayOfPeriod || day;
      const daysInTargetMonth = new Date(year, month + 1, 0).getDate();
      const finalDay = Math.min(targetDay, daysInTargetMonth);
      date.setFullYear(year, month, finalDay);
      break;
    }
    case 'yearly': {
      year += 1;
      const targetDay = dayOfPeriod || day;
      const daysInTargetMonth = new Date(year, month + 1, 0).getDate();
      const finalDay = Math.min(targetDay, daysInTargetMonth);
      date.setFullYear(year, month, finalDay);
      break;
    }
  }

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export async function checkAndExecuteRecurringFines(
  db: Firestore,
  groupId: string,
  periodId: string
) {
  try {
    const rfPath = `groups/${groupId}/periods/${periodId}/recurringFines`;
    const snap = await getDocs(query(collection(db, rfPath), where('active', '==', true)));
    if (snap.empty) return;

    const todayStr = new Date().toISOString().split('T')[0];

    for (const docSnap of snap.docs) {
      const rf = { id: docSnap.id, ...docSnap.data() } as RecurringFine;

      if (!rf.active || !rf.nextDueDate) continue;

      if (rf.nextDueDate <= todayStr) {
        // Check if expired before executing
        if (rf.durationType === 'until_date' && rf.endDate && rf.nextDueDate > rf.endDate) {
          await updateDoc(doc(db, rfPath, rf.id), { active: false });
          continue;
        }

        const count = rf.occurrencesCount || 0;
        if (rf.durationType === 'max_occurrences' && rf.occurrencesLimit && count >= rf.occurrencesLimit) {
          await updateDoc(doc(db, rfPath, rf.id), { active: false });
          continue;
        }

        // Record fine for all target members
        if (rf.memberIds && rf.memberIds.length > 0) {
          const batch = writeBatch(db);
          const timestamp = Date.now();

          for (const mId of rf.memberIds) {
            const fineRef = doc(collection(db, `groups/${groupId}/periods/${periodId}/fines`));
            batch.set(fineRef, {
              memberId: mId,
              reason: `${rf.reason} (Automatická pokuta)`,
              amount: rf.amount,
              paidAmount: 0,
              paid: false,
              periodId,
              createdAt: timestamp,
              templateId: rf.templateId || null,
              quantity: rf.quantity || 1,
              unitPrice: rf.unitPrice || rf.amount,
              unit: rf.unit || '',
              recurringFineId: rf.id
            });
          }

          await batch.commit();

          for (const mId of rf.memberIds) {
            await reconcileOverpaymentsForMember(db, groupId, periodId, mId);
          }
        }

        const newNextDueDate = calculateNextDueDate(rf.nextDueDate, rf.interval, rf.intervalDays, rf.dayOfPeriod);
        const newCount = count + 1;

        let shouldDeactivate = false;
        if (rf.durationType === 'until_date' && rf.endDate && newNextDueDate > rf.endDate) {
          shouldDeactivate = true;
        }
        if (rf.durationType === 'max_occurrences' && rf.occurrencesLimit && newCount >= rf.occurrencesLimit) {
          shouldDeactivate = true;
        }

        await updateDoc(doc(db, rfPath, rf.id), {
          lastGeneratedAt: todayStr,
          nextDueDate: newNextDueDate,
          occurrencesCount: newCount,
          active: !shouldDeactivate
        });
      }
    }
  } catch (err) {
    console.error('Error executing recurring fines:', err);
  }
}

export function getRecurringFineOccurrencesInRange(
  rf: RecurringFine,
  rangeStart: string,
  rangeEnd: string,
  currencySymbol: string
) {
  if (!rf || !rf.active || !rf.nextDueDate) return [];

  const results: {
    id: string;
    name: string;
    date: string;
    isRecurringFine: boolean;
    recurringFine: RecurringFine;
  }[] = [];

  const baseDateStr = rf.nextDueDate || rf.startDate;
  if (!baseDateStr) return [];

  let current = new Date(baseDateStr + 'T00:00:00');
  const endLimitDate = rf.endDate ? new Date(rf.endDate + 'T23:59:59') : null;

  let occurrencesDone = rf.occurrencesCount || 0;
  const maxLimit = rf.durationType === 'max_occurrences' ? (rf.occurrencesLimit || 1) : Infinity;

  let stepCount = 0;
  const maxSteps = 1000;

  while (stepCount < maxSteps) {
    stepCount++;
    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, '0');
    const day = String(current.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;

    if (rf.durationType === 'max_occurrences' && occurrencesDone >= maxLimit) {
      break;
    }

    if (rf.durationType === 'until_date' && endLimitDate && current > endLimitDate) {
      break;
    }

    if (dateStr > rangeEnd) {
      break;
    }

    if (dateStr >= rangeStart && dateStr <= rangeEnd) {
      results.push({
        id: `recurring-${rf.id}-${dateStr}`,
        name: `⚡ Aut. pokuta: ${rf.reason} (${rf.amount} ${currencySymbol})`,
        date: dateStr,
        isRecurringFine: true,
        recurringFine: rf
      });
    }

    occurrencesDone++;

    const prevYear = current.getFullYear();
    const prevMonth = current.getMonth();
    const prevDate = current.getDate();

    if (rf.interval === 'weekly') {
      current.setDate(current.getDate() + 7);
    } else if (rf.interval === 'monthly') {
      current.setMonth(current.getMonth() + 1);
    } else if (rf.interval === 'quarterly') {
      current.setMonth(current.getMonth() + 3);
    } else if (rf.interval === 'yearly') {
      current.setFullYear(current.getFullYear() + 1);
    } else if (rf.interval === 'custom_days') {
      const days = rf.intervalDays && rf.intervalDays > 0 ? rf.intervalDays : 1;
      current.setDate(current.getDate() + days);
    } else {
      current.setDate(current.getDate() + 7);
    }

    if (current.getFullYear() === prevYear && current.getMonth() === prevMonth && current.getDate() === prevDate) {
      break;
    }
  }

  return results;
}
