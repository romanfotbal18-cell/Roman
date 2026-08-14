import { auth } from './firebase';
import { collection, query, where, getDocs, doc, getDoc, updateDoc, writeBatch, Firestore } from 'firebase/firestore';
import { OperationType, FirestoreErrorInfo, Group, UserRole, Fine, RecurringFine, GroupEnabledFeatures, Payment, FineTemplate, GroupedFineCategory } from './types';

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
      if (fine.type === 'in_kind' || fine.isInKind) {
        // Skip automatic monetary reconciliation for in-kind fines
        continue;
      }
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

export async function autoDeductExpenseFromEnvelopes(
  db: Firestore,
  groupId: string,
  periodId: string,
  expenseAmount: number,
  accountType: 'cash' | 'bank',
  batch: any,
  editingOldExpenseAmount: number = 0
) {
  const effectiveExpense = Math.max(0, expenseAmount - editingOldExpenseAmount);
  if (effectiveExpense <= 0) return;

  try {
    // 1. Get transactions to compute current balances
    const transSnap = await getDocs(
      collection(db, `groups/${groupId}/periods/${periodId}/transactions`)
    );
    const transList = transSnap.docs.map(d => d.data());

    const cashBalance = transList.reduce((sum, t) => {
      const acc = (t.account === 'bank' || t.paymentMethod === 'bank' || t.paymentMethod === 'purchase') ? 'bank' : 'cash';
      return acc === 'cash' ? sum + (t.amount || 0) : sum;
    }, 0);

    const bankBalance = transList.reduce((sum, t) => {
      const acc = (t.account === 'bank' || t.paymentMethod === 'bank' || t.paymentMethod === 'purchase') ? 'bank' : 'cash';
      return acc === 'bank' ? sum + (t.amount || 0) : sum;
    }, 0);

    const totalBalance = cashBalance + bankBalance;

    // 2. Get envelopes
    const envSnap = await getDocs(
      collection(db, `groups/${groupId}/periods/${periodId}/envelopes`)
    );
    const envelopes = envSnap.docs.map(d => ({
      id: d.id,
      ref: d.ref,
      ...d.data()
    })) as Array<{ id: string; ref: any; amount: number; type?: 'virtual' | 'cash' | 'bank' }>;

    const explicitCashEnvelopes = envelopes.filter(e => e.type === 'cash').reduce((sum, e) => sum + (e.amount || 0), 0);
    const explicitBankEnvelopes = envelopes.filter(e => e.type === 'bank').reduce((sum, e) => sum + (e.amount || 0), 0);
    const explicitVirtualTotal = envelopes.filter(e => e.type === 'virtual' || !e.type).reduce((sum, e) => sum + (e.amount || 0), 0);

    const bankCapacityForVirtual = Math.max(0, bankBalance - explicitBankEnvelopes);
    const allocatedBankForVirtual = Math.min(bankCapacityForVirtual, explicitVirtualTotal);
    const remainingVirtualAfterBank = explicitVirtualTotal - allocatedBankForVirtual;

    const cashCapacityForVirtual = Math.max(0, cashBalance - explicitCashEnvelopes);
    const allocatedCashForVirtual = Math.min(cashCapacityForVirtual, remainingVirtualAfterBank);

    const bankEnvelopesTotal = explicitBankEnvelopes + allocatedBankForVirtual;
    const cashEnvelopesTotal = explicitCashEnvelopes + allocatedCashForVirtual;
    const virtualEnvelopesTotal = explicitVirtualTotal - allocatedBankForVirtual - allocatedCashForVirtual;
    const totalInEnvelopes = explicitCashEnvelopes + explicitBankEnvelopes + explicitVirtualTotal;

    // 3. Fetch group to check enabled features
    const groupSnap = await getDoc(doc(db, `groups/${groupId}`));
    const groupData = groupSnap.exists() ? (groupSnap.data() as Group) : undefined;
    const showSplitAccounts = isFeatureEnabled(groupData, 'splitCashboxAccounts');

    let freeCashAvailable = 0;
    if (showSplitAccounts) {
      if (accountType === 'cash') {
        freeCashAvailable = Math.max(0, cashBalance - cashEnvelopesTotal);
      } else if (accountType === 'bank') {
        freeCashAvailable = Math.max(0, bankBalance - bankEnvelopesTotal);
      } else {
        freeCashAvailable = Math.max(0, totalBalance - totalInEnvelopes);
      }
    } else {
      freeCashAvailable = Math.max(0, totalBalance - totalInEnvelopes);
    }

    const deficit = effectiveExpense - freeCashAvailable;
    if (deficit <= 0) return; // Free cash is enough

    // Determine eligible envelopes
    const primaryType: 'cash' | 'bank' = accountType === 'cash' ? 'cash' : 'bank';

    // Priority 1: Envelopes matching primaryType with amount > 0
    const primaryEnvelopes = envelopes.filter(e => e.type === primaryType && (e.amount || 0) > 0);
    const primaryTotal = primaryEnvelopes.reduce((sum, e) => sum + e.amount, 0);

    let targetEnvelopes = [...primaryEnvelopes];
    let totalEligible = primaryTotal;

    // Fallback: Virtual envelopes, then remaining envelopes with amount > 0
    if (totalEligible < deficit) {
      const virtualEnvelopes = envelopes.filter(e => (e.type === 'virtual' || !e.type) && (e.amount || 0) > 0);
      const otherEnvelopes = envelopes.filter(e => e.type !== primaryType && e.type !== 'virtual' && e.type && (e.amount || 0) > 0);
      targetEnvelopes = [...targetEnvelopes, ...virtualEnvelopes, ...otherEnvelopes];
      totalEligible = targetEnvelopes.reduce((sum, e) => sum + e.amount, 0);
    }

    if (totalEligible <= 0) return;

    const amountToDeduct = Math.min(deficit, totalEligible);
    const isIntegerDeduction = Number.isInteger(amountToDeduct) && targetEnvelopes.every(e => Number.isInteger(e.amount));

    const updatesMap = new Map<string, { currentAmt: number; deductAmt: number }>();
    targetEnvelopes.forEach(e => {
      updatesMap.set(e.id, { currentAmt: e.amount, deductAmt: 0 });
    });

    if (isIntegerDeduction) {
      // Whole integer CZK distribution algorithm (e.g. 200 CZK from 3 envelopes -> 67, 67, 66 CZK)
      let remainingInt = Math.round(amountToDeduct);
      let active = targetEnvelopes.filter(e => e.amount > 0);

      while (remainingInt > 0 && active.length > 0) {
        const count = active.length;
        const baseShare = Math.floor(remainingInt / count);
        let remainder = remainingInt - (baseShare * count);

        let allocated = 0;
        const nextActive: typeof active = [];

        for (let i = 0; i < active.length; i++) {
          const env = active[i];
          const item = updatesMap.get(env.id)!;
          const availableInEnv = env.amount - item.deductAmt;

          let targetShare = baseShare + (remainder > 0 ? 1 : 0);
          if (remainder > 0) remainder--;

          const share = Math.min(availableInEnv, targetShare);
          if (share > 0) {
            item.deductAmt += share;
            allocated += share;
          }

          if (env.amount - item.deductAmt > 0) {
            nextActive.push(env);
          }
        }

        remainingInt -= allocated;
        if (allocated === 0) break;
        active = nextActive;
      }
    } else {
      // Fallback for fractional decimal amounts
      let remainingDec = Math.round(amountToDeduct * 100) / 100;
      let active = targetEnvelopes.filter(e => e.amount > 0);

      while (remainingDec > 0.001 && active.length > 0) {
        const count = active.length;
        const availTotal = active.reduce((sum, e) => sum + (e.amount - updatesMap.get(e.id)!.deductAmt), 0);
        if (availTotal <= 0) break;

        let allocated = 0;
        const nextActive: typeof active = [];

        for (let i = 0; i < active.length; i++) {
          const env = active[i];
          const item = updatesMap.get(env.id)!;
          const availableInEnv = env.amount - item.deductAmt;

          let share = 0;
          if (i === active.length - 1) {
            share = Math.min(availableInEnv, remainingDec);
          } else {
            const prop = (availableInEnv / availTotal) * remainingDec;
            share = Math.min(availableInEnv, Math.round(prop * 100) / 100);
          }

          if (share > 0) {
            item.deductAmt = Math.round((item.deductAmt + share) * 100) / 100;
            allocated += share;
          }

          if (env.amount - item.deductAmt > 0) {
            nextActive.push(env);
          }
        }

        remainingDec = Math.round((remainingDec - allocated) * 100) / 100;
        if (allocated === 0) break;
        active = nextActive;
      }
    }

    updatesMap.forEach(({ currentAmt, deductAmt }, envId) => {
      if (deductAmt > 0) {
        const envRef = doc(db, `groups/${groupId}/periods/${periodId}/envelopes/${envId}`);
        const newAmt = Math.max(0, Math.round((currentAmt - deductAmt) * 100) / 100);
        batch.update(envRef, { amount: newAmt });
      }
    });
  } catch (err) {
    console.error("Error in autoDeductExpenseFromEnvelopes:", err);
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
              recurringFineId: rf.id,
              createdByEmail: 'automat@kasa.app',
              createdByName: 'Automatická opakovaná pokuta'
            });

            const auditRef = doc(collection(db, `groups/${groupId}/periods/${periodId}/fineAuditLogs`));
            batch.set(auditRef, {
              action: 'created',
              fineId: fineRef.id,
              fineReason: `${rf.reason} (Automatická pokuta)`,
              amount: rf.amount,
              isInKind: false,
              quantity: rf.quantity || 1,
              memberId: mId,
              memberName: 'Člen',
              createdAt: timestamp,
              createdByEmail: 'automat@kasa.app',
              createdByName: 'Automatická opakovaná pokuta'
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

export async function redistributeEnvelopesOnSplitEnable(db: any, groupId: string, periodId: string) {
  try {
    const txSnap = await getDocs(collection(db, `groups/${groupId}/periods/${periodId}/transactions`));
    let cashBalance = 0;
    let bankBalance = 0;
    txSnap.docs.forEach(docSnap => {
      const data = docSnap.data();
      const account = data.account || (data.source === 'bank' || data.category === 'Banka' ? 'bank' : 'cash');
      const amount = data.amount || 0;
      if (account === 'bank') bankBalance += amount;
      else cashBalance += amount;
    });

    const envSnap = await getDocs(collection(db, `groups/${groupId}/periods/${periodId}/envelopes`));
    const envelopes = envSnap.docs.map(docSnap => ({
      id: docSnap.id,
      ref: docSnap.ref,
      ...docSnap.data()
    })) as Array<{ id: string; ref: any; name: string; amount: number; type?: 'virtual' | 'cash' | 'bank'; [key: string]: any }>;

    const explicitBankTotal = envelopes.filter(e => e.type === 'bank').reduce((sum, e) => sum + (e.amount || 0), 0);
    let remainingBankCapacity = Math.max(0, bankBalance - explicitBankTotal);

    const virtualEnvelopes = envelopes.filter(e => e.type === 'virtual' || !e.type);
    if (virtualEnvelopes.length === 0) return;

    const batch = writeBatch(db);

    for (const env of virtualEnvelopes) {
      const amt = env.amount || 0;
      if (amt <= 0) {
        batch.update(env.ref, { type: 'cash' });
        continue;
      }

      if (amt <= remainingBankCapacity) {
        batch.update(env.ref, { type: 'bank' });
        remainingBankCapacity -= amt;
      } else if (remainingBankCapacity > 0) {
        const bankPart = remainingBankCapacity;
        const cashPart = amt - remainingBankCapacity;

        batch.update(env.ref, { amount: bankPart, type: 'bank' });

        const newEnvRef = doc(collection(db, `groups/${groupId}/periods/${periodId}/envelopes`));
        batch.set(newEnvRef, {
          name: `${env.name} (v hotovosti)`,
          amount: cashPart,
          targetAmount: env.targetAmount || null,
          targetDate: env.targetDate || null,
          note: env.note || '',
          color: env.color || 'indigo',
          type: 'cash',
          periodId: periodId,
          createdAt: Date.now() + 1
        });

        remainingBankCapacity = 0;
      } else {
        batch.update(env.ref, { type: 'cash' });
      }
    }

    await batch.commit();
  } catch (error) {
    console.error("Chyba při přerozdělování obálek při aktivaci rozšířené pokladny:", error);
  }
}

export function isFineAutomatic(f: Fine): boolean {
  if (f.recurringFineId) return true;
  if (f.createdByEmail === 'automat@kasa.app') return true;
  if (f.createdByName === 'Automatická opakovaná pokuta') return true;
  const reasonLower = (f.reason || '').toLowerCase();
  if (
    reasonLower.includes('automatická pokuta') ||
    reasonLower.includes('aut. pokuty') ||
    reasonLower.includes('(automatická') ||
    reasonLower.includes('manuální spuštění aut. pokuty')
  ) {
    return true;
  }
  return false;
}

export function groupFinesIntoCategories(
  fines: Fine[],
  templates: FineTemplate[] = []
): GroupedFineCategory[] {
  const categoryMap = new Map<string, GroupedFineCategory>();

  fines.forEach(f => {
    let catName = 'Vlastní zadání';
    let isCustomCat = true;

    // 1. Try templateId
    if ((f as any).templateId) {
      const t = templates.find(tmpl => tmpl.id === (f as any).templateId);
      if (t) {
        catName = t.name.trim();
        isCustomCat = false;
      }
    }

    // 2. Match reason against templates
    if (isCustomCat && f.reason) {
      const rawReason = f.reason.trim();
      const cleanedReason = rawReason
        .replace(/\s*\([^)]*\)/g, '')
        .replace(/\s*-\s*.*$/g, '')
        .trim();

      const matchedTemplate = templates.find(tmpl => {
        const tName = tmpl.name.trim().toLowerCase();
        return (
          cleanedReason.toLowerCase() === tName ||
          rawReason.toLowerCase().startsWith(tName)
        );
      });

      if (matchedTemplate) {
        catName = matchedTemplate.name.trim();
        isCustomCat = false;
      }
    }

    // 3. Fallback to 'Vlastní zadání' if no template matched or custom
    if (isCustomCat) {
      catName = 'Vlastní zadání';
    }

    const isAuto = isFineAutomatic(f);
    const amt = f.amount || 0;
    const paid = f.paidAmount || 0;

    let cat = categoryMap.get(catName);
    if (!cat) {
      cat = {
        categoryName: catName,
        isCustomCategory: isCustomCat,
        totalCount: 0,
        totalAmount: 0,
        totalPaidAmount: 0,
        manualCount: 0,
        manualAmount: 0,
        autoCount: 0,
        autoAmount: 0,
        fines: []
      };
      categoryMap.set(catName, cat);
    }

    cat.totalCount += 1;
    cat.totalAmount += amt;
    cat.totalPaidAmount += paid;
    if (isAuto) {
      cat.autoCount += 1;
      cat.autoAmount += amt;
    } else {
      cat.manualCount += 1;
      cat.manualAmount += amt;
    }
    cat.fines.push(f);
  });

  // Generate customReasonBreakdown for 'Vlastní zadání'
  const resultList = Array.from(categoryMap.values()).map(cat => {
    if (cat.isCustomCategory) {
      const subMap = new Map<string, { reason: string; count: number; amount: number; manualCount: number; autoCount: number }>();
      cat.fines.forEach(f => {
        const r = f.reason ? f.reason.trim() : 'Vlastní pokuta';
        const isAuto = isFineAutomatic(f);
        const amt = f.amount || 0;
        const sub = subMap.get(r) || { reason: r, count: 0, amount: 0, manualCount: 0, autoCount: 0 };
        sub.count += 1;
        sub.amount += amt;
        if (isAuto) sub.autoCount += 1;
        else sub.manualCount += 1;
        subMap.set(r, sub);
      });
      cat.customReasonBreakdown = Array.from(subMap.values()).sort((a, b) => b.count - a.count);
    }
    return cat;
  });

  return resultList.sort((a, b) => b.totalCount - a.totalCount);
}
