import { useState, useEffect } from 'react';
import { collection, query, onSnapshot, addDoc, serverTimestamp, doc, updateDoc, writeBatch, deleteDoc, setDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Group, Period, Member, Fine, OperationType, Transaction, Payment } from '../types';
import { handleFirestoreError, formatCurrency, getCurrencySymbol, cn, getUserRole, reconcileOverpaymentsForMember, autoDeductExpenseFromEnvelopes } from '../utils';
import { Search, User as UserIcon, CheckCircle2, ChevronRight, History, CreditCard, X, Loader2, Trash2, Edit2, AlertCircle, Save, Download, Eye, ShoppingBag, Building2, Copy, Check, FileSpreadsheet, QrCode, HelpCircle, XCircle, Pin } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import ExportFinanceModal from './ExportFinanceModal';

interface DebtListProps {
  group: Group;
  period: Period;
}

export default function DebtList({ group, period }: DebtListProps) {
  const userRole = getUserRole(group, auth.currentUser?.email, auth.currentUser?.uid);
  const isReadOnly = userRole === 'viewer';

  const [members, setMembers] = useState<Member[]>([]);
  const [fines, setFines] = useState<Fine[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'bank' | 'purchase'>('cash');
  const [paymentNote, setPaymentNote] = useState('');
  const [purchaseCategory, setPurchaseCategory] = useState('Občerstvení');
  const [purchaseRecipient, setPurchaseRecipient] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);

  // Specific fine payment state
  const [selectedFineForPayment, setSelectedFineForPayment] = useState<Fine | null>(null);
  const [finePaymentAmount, setFinePaymentAmount] = useState('');
  const [finePaymentMethod, setFinePaymentMethod] = useState<'cash' | 'bank' | 'purchase'>('cash');
  const [finePaymentNote, setFinePaymentNote] = useState('');
  const [finePaymentDate, setFinePaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [finePurchaseCategory, setFinePurchaseCategory] = useState('Občerstvení');
  const [finePurchaseRecipient, setFinePurchaseRecipient] = useState('');

  // In-kind fine fulfillment / conversion state
  const [inKindModalFine, setInKindModalFine] = useState<Fine | null>(null);
  const [inKindChoice, setInKindChoice] = useState<'yes' | 'no' | null>(null);
  const [inKindConvertAmount, setInKindConvertAmount] = useState<string>('');
  const [isInKindSubmitting, setIsInKindSubmitting] = useState<boolean>(false);

  const handleInKindFulfill = async () => {
    if (!inKindModalFine || isInKindSubmitting) return;
    setIsInKindSubmitting(true);
    try {
      const fineRef = doc(db, `groups/${group.id}/periods/${period.id}/fines`, inKindModalFine.id);
      await setDoc(fineRef, {
        paid: true,
        paidAmount: 0,
        isFulfilledInKind: true,
        fulfilledAt: Date.now()
      }, { merge: true });
      
      setInKindModalFine(null);
      setInKindChoice(null);
      setInKindConvertAmount('');
    } catch (error) {
      console.error(error);
      handleFirestoreError(error, OperationType.UPDATE, 'fines');
    } finally {
      setIsInKindSubmitting(false);
    }
  };

  const handleInKindConvertToFinancial = async () => {
    if (!inKindModalFine || isInKindSubmitting) return;
    const amount = parseFloat(inKindConvertAmount);
    if (isNaN(amount) || amount <= 0) return;

    setIsInKindSubmitting(true);
    try {
      const fineRef = doc(db, `groups/${group.id}/periods/${period.id}/fines`, inKindModalFine.id);
      await setDoc(fineRef, {
        type: 'fixed',
        amount: amount,
        unitPrice: amount,
        isInKind: false,
        isFulfilledInKind: false,
        paid: false,
        paidAmount: 0
      }, { merge: true });

      setInKindModalFine(null);
      setInKindChoice(null);
      setInKindConvertAmount('');
    } catch (error) {
      console.error(error);
      handleFirestoreError(error, OperationType.UPDATE, 'fines');
    } finally {
      setIsInKindSubmitting(false);
    }
  };

  const handleCopyText = (text: string, label: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => {
      setCopiedText(null);
    }, 2000);
  };

  const handleDownloadQr = (qrUrl: string) => {
    if (!qrUrl) return;
    const link = document.createElement('a');
    link.href = qrUrl;
    link.download = `QR-platba-${group.name || 'kasa'}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCopyQrImage = async (qrUrl: string, label: string = 'qr_img') => {
    if (!qrUrl) return;
    try {
      if (qrUrl.startsWith('data:image')) {
        const res = await fetch(qrUrl);
        const blob = await res.blob();
        await navigator.clipboard.write([
          new ClipboardItem({ [blob.type]: blob })
        ]);
      } else {
        await navigator.clipboard.writeText(qrUrl);
      }
      setCopiedText(label);
      setTimeout(() => setCopiedText(null), 2000);
    } catch (err) {
      await navigator.clipboard.writeText(qrUrl);
      setCopiedText(label);
      setTimeout(() => setCopiedText(null), 2000);
    }
  };

  const exportToExcel = () => {
    const sortedForExport = members
      .filter(m => m.active !== false && !(m as any).isDeleted && !(m as any).deleted)
      .sort((a, b) => getMemberDebt(b.id) - getMemberDebt(a.id));

    const exportData = sortedForExport
      .map(member => {
        const balance = getMemberDebt(member.id);
        const unpaidMemberFines = fines.filter(f => f.memberId === member.id && !f.paid && (!f.periodId || f.periodId === period.id) && !(f as any).isDeleted && !(f as any).deleted);
        
        if (balance === 0 && unpaidMemberFines.length === 0) return null;

        const descriptions = unpaidMemberFines.map(f => {
          if (f.type === 'in_kind' || f.isInKind) {
            return `${f.reason} (Věcný trest)`;
          }
          const remaining = f.amount - (f.paidAmount || 0);
          return `${f.reason} (${formatCurrency(remaining, group.currency)})`;
        }).join(', ');

        return {
          'Jméno': member.name,
          [`Částka (${getCurrencySymbol(group.currency)})`]: balance,
          'Stav': balance < 0 ? 'Přeplatek (Nabito)' : (balance > 0 ? 'Dluh' : 'Věcné pokuty'),
          'Rozpis dluhů / Poznámka': balance < 0 
            ? (unpaidMemberFines.length > 0 ? `Přeplatek + ${descriptions}` : 'Předplaceno na budoucí pokuty') 
            : descriptions
        };
      })
      .filter(item => item !== null);

    if (exportData.length === 0) {
      alert('Žádná data k exportu.');
      return;
    }

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Bilance členů');

    // Auto-size columns
    const maxLenName = Math.max(...exportData.map(d => d['Jméno'].length), 10);
    const maxLenDesc = Math.max(...exportData.map(d => d['Rozpis dluhů / Poznámka'].length), 20);
    worksheet['!cols'] = [
      { wch: maxLenName + 2 },
      { wch: 15 },
      { wch: 20 },
      { wch: Math.min(maxLenDesc + 2, 100) }
    ];

    const fileName = `Bilance_${group.name}_${period.name}_${new Date().toLocaleDateString('cs-CZ')}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  };

  useEffect(() => {
    const membersPath = `groups/${group.id}/periods/${period.id}/members`;
    const finesPath = `groups/${group.id}/periods/${period.id}/fines`;
    const paymentsPath = `groups/${group.id}/periods/${period.id}/payments`;

    const unsubMembers = onSnapshot(collection(db, membersPath), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Member[];
      const unique = data.filter((v, i, a) => a.findIndex(t => t.id === v.id) === i);
      console.log(`[DebtList] Fetched ${unique.length} members`);
      setMembers(unique);
    }, (error) => {
      console.error('[DebtList] Members snapshot error:', error);
      handleFirestoreError(error, OperationType.LIST, membersPath);
    });

    const unsubFines = onSnapshot(collection(db, finesPath), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Fine[];
      const unique = data.filter((v, i, a) => a.findIndex(t => t.id === v.id) === i);
      console.log(`[DebtList] Fetched ${unique.length} fines`);
      setFines(unique);
    }, (error) => {
      console.error('[DebtList] Fines snapshot error:', error);
      handleFirestoreError(error, OperationType.LIST, finesPath);
    });

    const unsubPayments = onSnapshot(collection(db, paymentsPath), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Payment[];
      console.log(`[DebtList] Fetched ${data.length} payments`);
      setPayments(data);
    }, (error) => {
      console.error('[DebtList] Payments snapshot error:', error);
      handleFirestoreError(error, OperationType.LIST, paymentsPath);
    });

    return () => {
      unsubMembers();
      unsubFines();
      unsubPayments();
    };
  }, [group.id, period.id]);

  useEffect(() => {
    if (!members.length) return;
    
    members.forEach(member => {
      const memberPayments = payments.filter(p => p.memberId === member.id).reduce((s, p) => s + (p.amount || 0), 0);
      const memberFines = fines.filter(f => f.memberId === member.id);
      const memberPaidFines = memberFines.reduce((s, f) => s + (f.paidAmount || 0), 0);
      const totalMemberFines = memberFines.reduce((s, f) => s + (f.amount || 0), 0);
      const expectedPaidFines = Math.min(memberPayments, totalMemberFines);

      if (memberPaidFines !== expectedPaidFines) {
        reconcileOverpaymentsForMember(db, group.id, period.id, member.id);
      }
    });
  }, [members, fines, payments, group.id, period.id]);

  const [isEditingFine, setIsEditingFine] = useState<Fine | null>(null);
  const [isDeletingFine, setIsDeletingFine] = useState<Fine | null>(null);
  const [editFineReason, setEditFineReason] = useState('');
  const [editFineAmount, setEditFineAmount] = useState('');
  const [editFineQuantity, setEditFineQuantity] = useState<number>(1);
  const [editFineUnitPrice, setEditFineUnitPrice] = useState<number>(0);
  const [editFineDate, setEditFineDate] = useState('');

  const handleDeleteFine = async (fineId: string) => {
    try {
      const path = `groups/${group.id}/periods/${period.id}/fines`;
      console.log(`Attempting to delete fine ${fineId} from ${path}`);
      await deleteDoc(doc(db, path, fineId));
      console.log('Fine deleted successfully');
      setIsDeletingFine(null);
    } catch (error) {
      console.error('Delete fine error:', error);
      alert('Chyba při mazání pokuty: ' + (error instanceof Error ? error.message : 'Neznámá chyba'));
      handleFirestoreError(error, OperationType.DELETE, 'fines');
    }
  };

  const handleUpdateFine = async () => {
    if (!isEditingFine || !editFineReason || !editFineAmount) return;
    const amountNum = parseFloat(editFineAmount);
    if (isNaN(amountNum)) return;

    try {
      // The final reason logic was moved to the onChange of inputs to show live preview,
      // but we ensure it's correct here too just in case.
      const finalReason = editFineReason;

      const originalDate = new Date(isEditingFine.createdAt);
      const selectedDate = new Date(editFineDate);
      selectedDate.setHours(originalDate.getHours(), originalDate.getMinutes(), originalDate.getSeconds(), originalDate.getMilliseconds());
      const timestamp = isNaN(selectedDate.getTime()) ? isEditingFine.createdAt : selectedDate.getTime();

      await setDoc(doc(db, `groups/${group.id}/periods/${period.id}/fines`, isEditingFine.id), {
        reason: finalReason,
        amount: amountNum,
        quantity: editFineQuantity,
        unitPrice: editFineUnitPrice,
        paid: isEditingFine.paidAmount >= amountNum,
        createdAt: timestamp
      }, { merge: true });
      setIsEditingFine(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'fines');
    }
  };

  const updateReasonWithQuantity = (reason: string, q: number, unit?: string) => {
    if (!unit) {
      const base = reason.replace(/\s\d+x$/, '');
      return q > 1 ? `${base} ${q}x` : base;
    } else {
      const escapedUnit = unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const dynamicRegex = new RegExp(`\\(\\d+(\\.\\d+)?\\s${escapedUnit}\\)`);
      if (dynamicRegex.test(reason)) {
        return reason.replace(dynamicRegex, `(${q} ${unit})`);
      } else {
        // Fallback for dynamic pattern
        return reason.replace(/\(\d+(\.\d+)?\s/, `(${q} `);
      }
    }
  };

  const getMemberDebt = (memberId: string) => {
    const totalFines = fines
      .filter(f => f.memberId === memberId)
      .reduce((sum, f) => sum + f.amount, 0);
    const totalPayments = payments
      .filter(p => p.memberId === memberId)
      .reduce((sum, p) => sum + p.amount, 0);
    return totalFines - totalPayments;
  };

  const filteredMembers = members
    .filter(m => m.name.toLowerCase().includes(searchTerm.toLowerCase()))
    .sort((a, b) => {
      const debtA = getMemberDebt(a.id);
      const debtB = getMemberDebt(b.id);
      // Sort: Highest debt -> Zero -> Highest surplus (lowest negative)
      return debtB - debtA;
    });

  const memberFines = selectedMember 
    ? fines.filter(f => f.memberId === selectedMember.id)
    : [];

  const memberPayments = selectedMember
    ? payments.filter(p => p.memberId === selectedMember.id)
    : [];

  const unpaidFines = memberFines.filter(f => !f.paid);
  const paidFines = memberFines.filter(f => f.paid);

  const handlePayment = async () => {
    if (!selectedMember || !paymentAmount) return;
    const amount = parseFloat(paymentAmount);
    if (isNaN(amount) || amount <= 0) return;

    try {
      const batch = writeBatch(db);
      // Merge selected date with current time to preserve record order within a day
      const now = new Date();
      const selectedDate = new Date(paymentDate);
      selectedDate.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
      const timestamp = isNaN(selectedDate.getTime()) ? Date.now() : selectedDate.getTime();
      
      const paymentRef = doc(collection(db, `groups/${group.id}/periods/${period.id}/payments`));

      if (paymentMethod === 'purchase') {
        const incomeTransRef = doc(collection(db, `groups/${group.id}/periods/${period.id}/transactions`));
        const expenseTransRef = doc(collection(db, `groups/${group.id}/periods/${period.id}/transactions`));

        const displayNote = paymentNote.trim() || purchaseRecipient.trim() || purchaseCategory;

        batch.set(paymentRef, {
          memberId: selectedMember.id,
          amount: amount,
          paymentMethod: 'purchase',
          note: `Nákup pro tým: ${displayNote}`,
          periodId: period.id,
          createdAt: timestamp,
          transactionId: incomeTransRef.id
        });

        // 1. Income transaction (fine repayment)
        batch.set(incomeTransRef, {
          amount: amount,
          type: 'income',
          source: 'fine_payment',
          category: 'Pokuta',
          note: `Splacení dluhu nákupem: ${selectedMember.name}${displayNote ? ` (${displayNote})` : ''}`,
          periodId: period.id,
          createdAt: timestamp,
          fromWho: selectedMember.name,
          paymentId: paymentRef.id,
          paymentMethod: 'purchase',
          account: 'bank'
        });

        // 2. Expense transaction for the group purchase
        batch.set(expenseTransRef, {
          amount: -amount,
          type: 'expense',
          source: 'expense',
          category: purchaseCategory || 'Nákup pro tým',
          note: `Nákup pro tým: ${selectedMember.name}${paymentNote ? ` - ${paymentNote}` : ''}`,
          fromWho: purchaseRecipient.trim() || selectedMember.name,
          periodId: period.id,
          createdAt: timestamp + 1,
          paymentId: paymentRef.id,
          paymentMethod: 'purchase',
          account: 'bank'
        });

        await autoDeductExpenseFromEnvelopes(db, group.id, period.id, amount, 'bank', batch);
      } else {
        const transactionRef = doc(collection(db, `groups/${group.id}/periods/${period.id}/transactions`));

        batch.set(paymentRef, {
          memberId: selectedMember.id,
          amount: amount,
          paymentMethod: paymentMethod,
          note: paymentNote,
          periodId: period.id,
          createdAt: timestamp,
          transactionId: transactionRef.id
        });

        // Record standard transaction
        batch.set(transactionRef, {
          amount: amount,
          type: 'income',
          source: 'fine_payment',
          category: 'Pokuta',
          note: `Platba od: ${selectedMember.name}${paymentNote ? ` (${paymentNote})` : ''}`,
          periodId: period.id,
          createdAt: timestamp,
          fromWho: selectedMember.name,
          paymentId: paymentRef.id,
          paymentMethod: paymentMethod,
          account: paymentMethod === 'bank' ? 'bank' : 'cash'
        });
      }

      // Mark fines as paid if amount covers them fully or partially (prioritizing partially paid fines)
      let remainingPayment = amount;
      const sortedUnpaidFines = [...unpaidFines].sort((a, b) => {
        const isPartialA = (a.paidAmount || 0) > 0;
        const isPartialB = (b.paidAmount || 0) > 0;
        if (isPartialA && !isPartialB) return -1;
        if (!isPartialA && isPartialB) return 1;
        return a.createdAt - b.createdAt;
      });

      for (const fine of sortedUnpaidFines) {
        if (fine.type === 'in_kind' || fine.isInKind) continue;
        if (remainingPayment <= 0) break;

        const currentPaid = fine.paidAmount || 0;
        const needed = fine.amount - currentPaid;

        if (remainingPayment >= needed) {
          batch.set(doc(db, `groups/${group.id}/periods/${period.id}/fines`, fine.id), {
            paidAmount: fine.amount,
            paid: true
          }, { merge: true });
          remainingPayment -= needed;
        } else {
          batch.set(doc(db, `groups/${group.id}/periods/${period.id}/fines`, fine.id), {
            paidAmount: currentPaid + remainingPayment,
            paid: false
          }, { merge: true });
          remainingPayment = 0;
        }
      }

      await batch.commit();
      await reconcileOverpaymentsForMember(db, group.id, period.id, selectedMember.id);
      setIsPaymentModalOpen(false);
      setPaymentAmount('');
      setPaymentNote('');
      setPurchaseCategory('Občerstvení');
      setPurchaseRecipient('');
      setPaymentMethod('cash');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'payment/transaction');
    }
  };

  const openFinePaymentModal = (fine: Fine) => {
    const remaining = fine.amount - (fine.paidAmount || 0);
    setSelectedFineForPayment(fine);
    setFinePaymentAmount(remaining > 0 ? remaining.toString() : '');
    setFinePaymentDate(new Date().toISOString().split('T')[0]);
    setFinePaymentMethod('cash');
    setFinePaymentNote('');
    setFinePurchaseCategory('Občerstvení');
    setFinePurchaseRecipient('');
  };

  const handleFinePayment = async () => {
    if (!selectedMember || !selectedFineForPayment || !finePaymentAmount) return;
    const payAmount = parseFloat(finePaymentAmount);
    if (isNaN(payAmount) || payAmount <= 0) return;

    try {
      const batch = writeBatch(db);
      const now = new Date();
      const selectedDate = new Date(finePaymentDate);
      selectedDate.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
      const timestamp = isNaN(selectedDate.getTime()) ? Date.now() : selectedDate.getTime();

      const paymentRef = doc(collection(db, `groups/${group.id}/periods/${period.id}/payments`));
      const fineRef = doc(db, `groups/${group.id}/periods/${period.id}/fines`, selectedFineForPayment.id);

      const defaultFineNote = `Platba pokuty: ${selectedFineForPayment.reason}`;
      const userNote = finePaymentNote.trim();

      if (finePaymentMethod === 'purchase') {
        const incomeTransRef = doc(collection(db, `groups/${group.id}/periods/${period.id}/transactions`));
        const expenseTransRef = doc(collection(db, `groups/${group.id}/periods/${period.id}/transactions`));

        const displayNote = userNote || finePurchaseRecipient.trim() || finePurchaseCategory;

        batch.set(paymentRef, {
          memberId: selectedMember.id,
          amount: payAmount,
          paymentMethod: 'purchase',
          note: `Nákup pro tým (${selectedFineForPayment.reason}): ${displayNote}`,
          periodId: period.id,
          createdAt: timestamp,
          transactionId: incomeTransRef.id,
          fineId: selectedFineForPayment.id
        });

        // 1. Income transaction (fine repayment)
        batch.set(incomeTransRef, {
          amount: payAmount,
          type: 'income',
          source: 'fine_payment',
          category: 'Pokuta',
          note: `Splacení pokuty "${selectedFineForPayment.reason}" nákupem: ${selectedMember.name}${displayNote ? ` (${displayNote})` : ''}`,
          periodId: period.id,
          createdAt: timestamp,
          fromWho: selectedMember.name,
          paymentId: paymentRef.id,
          paymentMethod: 'purchase',
          account: 'bank'
        });

        // 2. Expense transaction for the group purchase
        batch.set(expenseTransRef, {
          amount: -payAmount,
          type: 'expense',
          source: 'expense',
          category: finePurchaseCategory || 'Nákup pro tým',
          note: `Nákup pro tým (${selectedFineForPayment.reason}): ${selectedMember.name}${userNote ? ` - ${userNote}` : ''}`,
          fromWho: finePurchaseRecipient.trim() || selectedMember.name,
          periodId: period.id,
          createdAt: timestamp + 1,
          paymentId: paymentRef.id,
          paymentMethod: 'purchase',
          account: 'bank'
        });

        await autoDeductExpenseFromEnvelopes(db, group.id, period.id, payAmount, 'bank', batch);
      } else {
        const transactionRef = doc(collection(db, `groups/${group.id}/periods/${period.id}/transactions`));

        const fullNote = userNote ? `${defaultFineNote} (${userNote})` : defaultFineNote;

        batch.set(paymentRef, {
          memberId: selectedMember.id,
          amount: payAmount,
          paymentMethod: finePaymentMethod,
          note: fullNote,
          periodId: period.id,
          createdAt: timestamp,
          transactionId: transactionRef.id,
          fineId: selectedFineForPayment.id
        });

        // Transaction
        batch.set(transactionRef, {
          amount: payAmount,
          type: 'income',
          source: 'fine_payment',
          category: 'Pokuta',
          note: `Platba pokuty "${selectedFineForPayment.reason}" od: ${selectedMember.name}${userNote ? ` (${userNote})` : ''}`,
          periodId: period.id,
          createdAt: timestamp,
          fromWho: selectedMember.name,
          paymentId: paymentRef.id,
          paymentMethod: finePaymentMethod,
          account: finePaymentMethod === 'bank' ? 'bank' : 'cash'
        });
      }

      // Update specific fine
      const currentPaid = selectedFineForPayment.paidAmount || 0;
      const newPaid = currentPaid + payAmount;
      const isFullyPaid = newPaid >= selectedFineForPayment.amount;

      batch.set(fineRef, {
        paidAmount: newPaid,
        paid: isFullyPaid
      }, { merge: true });

      await batch.commit();

      await reconcileOverpaymentsForMember(db, group.id, period.id, selectedMember.id);

      setSelectedFineForPayment(null);
      setFinePaymentAmount('');
      setFinePaymentNote('');
      setFinePurchaseCategory('Občerstvení');
      setFinePurchaseRecipient('');
      setFinePaymentMethod('cash');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'payment/fine');
    }
  };

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      {/* List Section */}
      <div className="flex-1 space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative group flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-bento-text-muted w-4 h-4 transition-colors group-focus-within:text-bento-accent" />
            <input
              type="text"
              placeholder="Hledat člena..."
              className="w-full pl-11 pr-4 py-3 bg-white border border-bento-card-border rounded-xl focus:outline-none focus:ring-2 focus:ring-bento-accent/20 focus:border-bento-accent/50 shadow-sm transition-all text-sm font-medium"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button
            onClick={() => setIsExportModalOpen(true)}
            className="flex items-center justify-center gap-2 px-6 py-3 bg-white border border-bento-card-border rounded-xl hover:border-emerald-300 hover:bg-emerald-50/50 transition-all text-sm font-black uppercase tracking-widest text-slate-700 hover:text-emerald-700 shadow-sm active:scale-95 shrink-0"
            title="Exportovat přehled financí"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            <span className="sm:hidden lg:inline">Export financí</span>
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3">
          {filteredMembers.map((member) => {
            const debt = getMemberDebt(member.id);
            const unpaidInKindFines = fines.filter(
              f => f.memberId === member.id && !f.paid && (f.type === 'in_kind' || f.isInKind) && !(f as any).isDeleted && !(f as any).deleted
            );
            const inKindCount = unpaidInKindFines.length;
            const isSelected = selectedMember?.id === member.id;
            return (
              <motion.button
                key={member.id}
                layoutId={member.id}
                onClick={() => setSelectedMember(member)}
                className={cn(
                  "flex items-center justify-between p-4 rounded-2xl border transition-all text-left",
                  isSelected 
                    ? "bg-white border-bento-accent shadow-lg shadow-bento-accent/5 ring-1 ring-bento-accent" 
                    : "bg-white border-bento-card-border text-bento-text-main hover:border-bento-accent/30 hover:shadow-sm"
                )}
              >
                <div className="flex items-center gap-4">
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center transition-colors",
                    isSelected ? "bg-bento-accent/10 text-bento-accent" : "bg-slate-100 text-bento-text-muted"
                  )}>
                    <UserIcon className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold block text-sm">{member.name}</span>
                      {member.birthDate && (
                        <span className="text-[10px] text-bento-text-muted font-medium">
                          {(() => {
                            const birth = new Date(member.birthDate);
                            const age = new Date().getFullYear() - birth.getFullYear();
                            const m_diff = new Date().getMonth() - birth.getMonth();
                            const isPastBirthday = m_diff > 0 || (m_diff === 0 && new Date().getDate() >= birth.getDate());
                            return isPastBirthday ? age : age - 1;
                          })()} let
                        </span>
                      )}
                      <div className={cn(
                        "w-1.5 h-1.5 rounded-full shadow-sm",
                        member.active ? "bg-emerald-500 shadow-emerald-200" : "bg-rose-500 shadow-rose-200"
                      )} />
                    </div>
                    <span className={cn(
                      "text-[10px] font-bold uppercase tracking-widest",
                      isSelected ? "text-bento-accent" : (member.active ? "text-emerald-600/70" : "text-rose-600/70")
                    )}>
                      {member.active ? 'Aktivní' : 'Neaktivní'}
                      {member.position && <span className="opacity-60"> • {member.position}</span>}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {inKindCount > 0 && (
                    <div 
                      className="flex items-center gap-1 bg-rose-50 border border-rose-200/90 text-rose-600 px-2 py-1 rounded-lg font-black text-xs shadow-2xs shrink-0"
                      title={`Má ${inKindCount}x věcnou pokutu (nepeněžní trest)`}
                    >
                      <Pin className="w-3.5 h-3.5 text-rose-600 fill-rose-500 shrink-0" />
                      {inKindCount > 1 && (
                        <span className="text-xs font-black text-rose-700">{inKindCount}x</span>
                      )}
                    </div>
                  )}
                  <div className={cn(
                    "px-3 py-1.5 rounded-lg font-bold text-xs",
                    debt > 0 
                      ? "bg-rose-50 text-rose-600" 
                      : (debt < 0 ? "bg-indigo-50 text-indigo-600" : "bg-emerald-50 text-emerald-600")
                  )}>
                    {debt < 0 ? formatCurrency(Math.abs(debt), group.currency) : formatCurrency(debt, group.currency)}
                  </div>
                  <ChevronRight className={cn(
                    "w-4 h-4 transition-transform",
                    isSelected ? "text-bento-accent rotate-90 lg:rotate-0 translate-x-1" : "text-bento-card-border"
                  )} />
                </div>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* Detail Section */}
      <AnimatePresence mode="wait">
        {selectedMember ? (
          <motion.div
            key="detail"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            className="lg:w-[420px] space-y-4"
          >
            <div className="bento-card shadow-xl sticky top-24">
              <div className="flex justify-between items-start mb-6">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 bg-slate-100 text-bento-text-main rounded-2xl flex items-center justify-center">
                    <UserIcon className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-bold text-bento-text-main leading-tight">{selectedMember.name}</h2>
                      <div className={cn(
                        "w-2 h-2 rounded-full",
                        selectedMember.active ? "bg-emerald-500" : "bg-rose-500"
                      )} />
                    </div>
                    <p className={cn(
                      "text-[11px] font-bold uppercase tracking-widest",
                      selectedMember.active ? "text-emerald-600" : "text-rose-600"
                    )}>
                      {selectedMember.active ? 'Aktivní člen' : 'Neaktivní člen'}
                    </p>
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedMember(null)}
                  className="p-2 text-bento-text-muted hover:bg-slate-50 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-6">
                {/* Unpaid Fines */}
                <div>
                  <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-bento-text-muted mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-1 h-1 rounded-full bg-rose-400"></div>
                      Nesplacené dluhy
                    </div>
                    <span className="text-rose-500">{unpaidFines.length}x</span>
                  </h3>
                  {unpaidFines.length > 0 ? (
                    <div className="space-y-2">
                      {unpaidFines.map(fine => {
                        const isInKind = fine.type === 'in_kind' || fine.isInKind;
                        const isPartial = !isInKind && (fine.paidAmount || 0) > 0;
                        const remainingDebt = isInKind ? 0 : fine.amount - (fine.paidAmount || 0);
                        return (
                          <div key={fine.id} className="group relative flex justify-between items-center p-3.5 bg-slate-50 rounded-xl border border-bento-card-border transition-all hover:bg-white hover:border-bento-accent/20">
                            <div className="flex flex-col flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-sm text-bento-text-main group-hover:text-bento-accent transition-colors">{fine.reason}</span>
                                {isPartial && (
                                  <span className="text-[9px] font-black px-1.5 py-0.5 bg-rose-100 text-rose-600 rounded-md uppercase tracking-tighter">Částečně</span>
                                )}
                              </div>
                              <span className="text-[10px] font-semibold text-bento-text-muted mt-0.5">
                                {new Date(fine.createdAt).toLocaleDateString('cs-CZ')}
                                {isPartial && ` • Uhrazeno: ${formatCurrency(fine.paidAmount, group.currency)}`}
                              </span>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="flex flex-col items-end">
                                {isInKind ? (
                                  <span className="font-extrabold text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded-lg border border-blue-100">
                                    Věcný trest
                                  </span>
                                ) : (
                                  <>
                                    <span className="font-black text-sm text-rose-600">
                                      {formatCurrency(remainingDebt, group.currency)}
                                    </span>
                                    {isPartial && <span className="text-[9px] font-bold text-slate-400">Zbývá z {formatCurrency(fine.amount, group.currency)}</span>}
                                  </>
                                )}
                              </div>
                              
                              {!isReadOnly && (
                                <div className="flex items-center gap-1.5 ml-2">
                                  {isInKind ? (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setInKindModalFine(fine);
                                        setInKindChoice(null);
                                        setInKindConvertAmount('');
                                      }}
                                      className="w-7 h-7 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-all active:scale-95 shadow-2xs shrink-0 flex items-center justify-center cursor-pointer"
                                      title="Vyhodnotit věcný trest / úkol"
                                    >
                                      <HelpCircle className="w-4 h-4 text-white" />
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openFinePaymentModal(fine);
                                      }}
                                      className="w-7 h-7 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-all active:scale-95 shadow-2xs shrink-0 flex items-center justify-center cursor-pointer"
                                      title="Zapsat platbu pro tuto pokutu"
                                    >
                                      <CreditCard className="w-3.5 h-3.5 text-white" />
                                    </button>
                                  )}
                                  <div className="flex items-center gap-0.5 opacity-80 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setEditFineReason(fine.reason);
                                        setEditFineAmount(fine.amount.toString());
                                        setEditFineQuantity(fine.quantity || 1);
                                        setEditFineUnitPrice(fine.unitPrice || fine.amount);
                                        setEditFineDate(new Date(fine.createdAt).toISOString().split('T')[0]);
                                        setIsEditingFine(fine);
                                      }}
                                      className="p-1.5 text-slate-400 hover:text-bento-accent hover:bg-slate-100 rounded-lg transition-all"
                                      title="Upravit pokutu"
                                    >
                                      <Edit2 className="w-3.5 h-3.5" />
                                    </button>
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setIsDeletingFine(fine);
                                      }}
                                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-slate-100 rounded-lg transition-all"
                                      title="Smazat pokutu"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-8 rounded-[2rem] bg-emerald-50/30 text-emerald-600 border border-emerald-100 border-dashed">
                      <CheckCircle2 className="w-8 h-8 mx-auto mb-2 opacity-40" />
                      <p className="text-xs font-black uppercase tracking-widest">Bez dluhů</p>
                    </div>
                  )}
                </div>

                <div className="pt-6 border-t border-bento-card-border">
                  <div className="flex flex-col gap-4">
                    {/* Debt amount & Record Payment button */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-slate-50 border border-slate-100 rounded-2xl">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-bento-text-muted">Dlužná částka</p>
                          {getMemberDebt(selectedMember.id) > 0 ? (
                            <div className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 bg-rose-50 text-rose-500 rounded-md animate-pulse">
                              Nevyrovnáno
                            </div>
                          ) : (getMemberDebt(selectedMember.id) < 0 && (
                            <div className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 bg-indigo-50 text-indigo-500 rounded-md">
                              Přeplatek
                            </div>
                          ))}
                        </div>
                        <p className={cn(
                          "text-3xl font-black tracking-tighter leading-none",
                          getMemberDebt(selectedMember.id) < 0 ? "text-indigo-600" : "text-bento-text-main"
                        )}>
                          {getMemberDebt(selectedMember.id) < 0 
                            ? formatCurrency(Math.abs(getMemberDebt(selectedMember.id)), group.currency) 
                            : formatCurrency(getMemberDebt(selectedMember.id), group.currency)}
                        </p>
                      </div>

                      {!isReadOnly ? (
                        <button
                          onClick={() => {
                            const debt = getMemberDebt(selectedMember.id);
                            setPaymentAmount(debt > 0 ? debt.toString() : '');
                            setPaymentDate(new Date().toISOString().split('T')[0]);
                            setIsPaymentModalOpen(true);
                          }}
                          className="btn-bento-primary px-5 py-3 rounded-xl shadow-lg shadow-bento-accent/15 flex items-center justify-center gap-2 transition-all hover:scale-[1.02] active:scale-95 shrink-0"
                        >
                          <CreditCard className="w-4 h-4" />
                          <span className="text-xs font-bold">Zapsat platbu</span>
                        </button>
                      ) : (
                        <p className="text-xs text-amber-700 bg-amber-50 px-3 py-2 rounded-xl border border-amber-200 font-bold flex items-center gap-2">
                          <Eye className="w-3.5 h-3.5 text-amber-600" />
                          Režim Čtenáře
                        </p>
                      )}
                    </div>

                    {/* Bank Account Connection for Debt Repayment */}
                    <div className="p-4 bg-indigo-50/60 border border-indigo-100 rounded-2xl space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 bg-indigo-600 text-white rounded-lg shadow-xs">
                            <Building2 className="w-3.5 h-3.5" />
                          </div>
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-wider text-indigo-900">Bankovní spojení pro úhradu</p>
                            {group.bankName && <p className="text-[10px] font-medium text-slate-500">{group.bankName}</p>}
                          </div>
                        </div>
                      </div>

                      {group.bankAccount ? (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between bg-white p-2.5 rounded-xl border border-indigo-200/80 shadow-2xs">
                            <div className="flex flex-col">
                              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Číslo účtu</span>
                              <span className="font-mono font-extrabold text-sm text-slate-900 select-all">{group.bankAccount}</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleCopyText(group.bankAccount!, 'account')}
                              className={cn(
                                "flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold text-xs transition-all",
                                copiedText === 'account'
                                  ? "bg-emerald-600 text-white shadow-xs"
                                  : "bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200"
                              )}
                              title="Kopírovat číslo účtu"
                            >
                              {copiedText === 'account' ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-emerald-100" />
                                  <span>Zkopírováno!</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5" />
                                  <span>Kopírovat</span>
                                </>
                              )}
                            </button>
                          </div>

                          {(group.bankVS || group.bankNote) && (
                            <div className="p-2.5 bg-white/70 rounded-xl border border-indigo-100/80 text-xs space-y-1">
                              {group.bankVS && (
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Variabilní symbol:</span>
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-mono font-bold text-slate-800">{group.bankVS}</span>
                                    <button
                                      type="button"
                                      onClick={() => handleCopyText(group.bankVS!, 'vs')}
                                      className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
                                      title="Kopírovat VS"
                                    >
                                      {copiedText === 'vs' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                                    </button>
                                  </div>
                                </div>
                              )}
                              {group.bankNote && (
                                <div className="text-[11px] text-slate-600 font-medium pt-0.5 border-t border-slate-100">
                                  <span className="text-slate-400 font-normal">Poznámka: </span>
                                  {group.bankNote}
                                </div>
                              )}
                            </div>
                          )}

                          {group.bankQrCodeUrl && (
                            <div className="p-3 bg-white rounded-xl border border-indigo-200/80 space-y-2 text-center shadow-2xs">
                              <span className="text-[10px] font-black uppercase tracking-wider text-indigo-900 block flex items-center justify-center gap-1">
                                <QrCode className="w-3.5 h-3.5 text-indigo-600" />
                                <span>QR kód pro platbu</span>
                              </span>
                              <div className="flex justify-center">
                                <img src={group.bankQrCodeUrl} alt="QR Platba" className="w-20 h-20 object-contain rounded-lg border border-slate-100 p-1 bg-white" />
                              </div>
                              <div className="flex items-center justify-center gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={() => handleCopyQrImage(group.bankQrCodeUrl!, 'qr_img_modal')}
                                  className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-bold flex items-center gap-1.5 border border-indigo-200 transition-all active:scale-95"
                                >
                                  {copiedText === 'qr_img_modal' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                                  <span>{copiedText === 'qr_img_modal' ? 'Zkopírováno!' : 'Kopírovat'}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDownloadQr(group.bankQrCodeUrl!)}
                                  className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-bold flex items-center gap-1.5 border border-emerald-200 transition-all active:scale-95"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                  <span>Stáhnout</span>
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="p-2.5 bg-white/80 rounded-xl border border-indigo-100 text-[11px] text-slate-500 font-medium leading-relaxed">
                          Číslo bankovního účtu kasy zatím nebylo v nastavení zadané.
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* History: Paid Fines & Payments */}
                <div className="pt-6 border-t border-bento-card-border">
                  <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-bento-text-muted mb-4 flex items-center gap-2">
                    <div className="w-1 h-1 rounded-full bg-slate-300"></div>
                    Historie záznamů
                  </h3>
                  
                  <div className="space-y-3 max-h-[280px] overflow-y-auto pr-2 custom-scrollbar">
                    {/* Unified history: Sorted by date */}
                    {[
                      ...paidFines.map(f => ({ ...f, histType: 'fine' })),
                      ...memberPayments.map(p => ({ ...p, histType: 'payment' }))
                    ]
                      .sort((a, b) => b.createdAt - a.createdAt)
                      .map((item, idx) => (
                        <div key={idx} className={cn(
                          "flex justify-between items-center p-3 rounded-2xl border transition-all",
                          item.histType === 'payment' ? "bg-emerald-50/20 border-emerald-100" : "bg-slate-50/50 border-transparent hover:bg-slate-50 hover:border-slate-200"
                        )}>
                          <div className="flex flex-col gap-0.5">
                            <span className={cn(
                              "text-xs font-bold",
                              item.histType === 'payment' ? "text-emerald-700" : "text-bento-text-main"
                            )}>
                              {item.histType === 'payment'
                                ? `Platba: ${item.paymentMethod === 'cash' ? 'Hotově' : item.paymentMethod === 'purchase' ? 'Nákup pro tým' : 'Na účet'}`
                                : (item as any).reason}
                            </span>
                            <span className="text-[10px] font-semibold text-bento-text-muted">
                              {new Date(item.createdAt).toLocaleDateString('cs-CZ')}
                              {item.histType === 'payment' && (item as any).note && ` • ${(item as any).note}`}
                            </span>
                          </div>
                          <span className={cn(
                            "text-xs font-black tracking-tight",
                            item.histType === 'payment' ? "text-emerald-600" : ((item as any).type === 'in_kind' || (item as any).isFulfilledInKind) ? "text-blue-600" : "text-slate-400"
                          )}>
                            {item.histType === 'payment'
                              ? `+${formatCurrency(item.amount, group.currency)}`
                              : ((item as any).type === 'in_kind' || (item as any).isFulfilledInKind)
                                ? 'Splněno věcně'
                                : formatCurrency(item.amount, group.currency)}
                          </span>
                        </div>
                      ))}
                    
                    {paidFines.length === 0 && memberPayments.length === 0 && (
                      <div className="text-center py-6 text-slate-300">
                        <History className="w-5 h-5 mx-auto mb-2 opacity-20" />
                        <p className="text-[10px] font-bold uppercase tracking-widest">Žádná historie</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        ) : (
          <div className="hidden lg:flex flex-1 items-center justify-center bg-white/50 rounded-3xl border border-dashed border-bento-card-border min-h-[400px]">
            <div className="text-center space-y-3">
              <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mx-auto shadow-sm border border-bento-card-border">
                <UserIcon className="w-6 h-6 text-slate-300" />
              </div>
              <p className="text-xs font-bold uppercase tracking-widest text-bento-text-muted">Vyberte člena</p>
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* Payment Modal */}
      <AnimatePresence>
        {isPaymentModalOpen && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 z-50">
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              className="bg-white rounded-3xl p-5 sm:p-6 max-w-md w-full shadow-2xl border border-bento-card-border max-h-[90vh] flex flex-col"
            >
              {/* Modal Header */}
              <div className="flex justify-between items-center mb-4 shrink-0">
                <div>
                  <h2 className="text-xl font-bold text-bento-text-main tracking-tight">Zapsat platbu</h2>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-bento-accent">Nová transakce</p>
                </div>
                <button onClick={() => setIsPaymentModalOpen(false)} className="p-2 text-bento-text-muted hover:bg-slate-50 rounded-xl transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Scrollable Form Content */}
              <div className="space-y-4 overflow-y-auto pr-1 flex-1">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-1">Částka k zaplacení</label>
                  <div className="relative group">
                    <input
                      type="number"
                      className="w-full px-4 py-2.5 bg-slate-50 border border-bento-card-border rounded-xl font-bold text-2xl focus:outline-none focus:ring-2 focus:ring-bento-accent/20 focus:border-bento-accent transition-all text-bento-text-main"
                      value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value)}
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 font-bold text-slate-400">{getCurrencySymbol(group.currency)}</span>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-1">Datum platby</label>
                  <input
                    type="date"
                    className="w-full px-3.5 py-2 bg-slate-50 border border-bento-card-border rounded-xl font-bold text-xs focus:outline-none focus:ring-2 focus:ring-bento-accent/20 focus:border-bento-accent transition-all text-bento-text-main"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                  />
                </div>

                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-1">Způsob úhrady</label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('cash')}
                      className={cn(
                        "flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-bold text-xs transition-all border",
                        paymentMethod === 'cash' 
                          ? "bg-white border-bento-accent text-bento-text-main shadow-sm ring-1 ring-bento-accent" 
                          : "bg-slate-50 border-bento-card-border text-bento-text-muted hover:bg-white"
                      )}
                    >
                      Hotově
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('bank')}
                      className={cn(
                        "flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-bold text-xs transition-all border",
                        paymentMethod === 'bank' 
                          ? "bg-white border-bento-accent text-bento-text-main shadow-sm ring-1 ring-bento-accent" 
                          : "bg-slate-50 border-bento-card-border text-bento-text-muted hover:bg-white"
                      )}
                    >
                      Na účet
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('purchase')}
                      className={cn(
                        "flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-bold text-xs transition-all border",
                        paymentMethod === 'purchase' 
                          ? "bg-indigo-50 border-indigo-500 text-indigo-700 shadow-sm ring-1 ring-indigo-500" 
                          : "bg-slate-50 border-bento-card-border text-bento-text-muted hover:bg-white"
                      )}
                    >
                      <ShoppingBag className="w-3.5 h-3.5" />
                      Nákup
                    </button>
                  </div>
                </div>

                {paymentMethod === 'bank' && group.bankAccount && (
                  <div className="p-3 bg-indigo-50/70 border border-indigo-100 rounded-xl space-y-2">
                    <div className="flex items-center justify-between text-xs text-indigo-950 font-bold">
                      <div className="flex items-center gap-1.5">
                        <Building2 className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                        <span>Účet kasy: <strong className="font-mono text-slate-900">{group.bankAccount}</strong></span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopyText(group.bankAccount!, 'modal_account')}
                        className="p-1 text-indigo-700 hover:text-indigo-900 bg-white rounded-md border border-indigo-200 text-[10px] font-bold flex items-center gap-1 px-2"
                      >
                        {copiedText === 'modal_account' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedText === 'modal_account' ? 'Zkopírováno' : 'Kopírovat'}</span>
                      </button>
                    </div>

                    {group.bankQrCodeUrl && (
                      <div className="pt-2 border-t border-indigo-100 flex items-center gap-3 bg-white p-2.5 rounded-lg">
                        <img src={group.bankQrCodeUrl} alt="QR Platba" className="w-16 h-16 object-contain rounded border" />
                        <div className="flex-1">
                          <p className="text-xs font-bold text-slate-800 flex items-center gap-1">
                            <QrCode className="w-3.5 h-3.5 text-indigo-600" />
                            <span>QR kód pro platbu</span>
                          </p>
                          <div className="flex gap-2 mt-1.5">
                            <button
                              type="button"
                              onClick={() => handleCopyQrImage(group.bankQrCodeUrl!, 'qr_modal_pay')}
                              className="px-2 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded text-[10px] font-bold flex items-center gap-1"
                            >
                              {copiedText === 'qr_modal_pay' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                              <span>{copiedText === 'qr_modal_pay' ? 'Zkopírováno' : 'Kopírovat'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDownloadQr(group.bankQrCodeUrl!)}
                              className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded text-[10px] font-bold flex items-center gap-1"
                            >
                              <Download className="w-3 h-3" />
                              <span>Stáhnout</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {paymentMethod === 'purchase' ? (
                  <>
                    <div className="p-2.5 bg-indigo-50/70 border border-indigo-100 rounded-xl text-xs text-indigo-900 space-y-0.5">
                      <p className="font-bold flex items-center gap-1.5 text-indigo-700 text-[11px]">
                        <ShoppingBag className="w-3.5 h-3.5 shrink-0 text-indigo-600" />
                        Nákup pro tým (věcné plnění)
                      </p>
                      <p className="text-[10px] leading-snug text-slate-600">
                        Sníží dluh člena a zároveň zapíše náklad týmu bez změny stavu kasy.
                      </p>
                    </div>

                    <div>
                      <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-1">Kategorie výdaje</label>
                      <div className="flex flex-wrap gap-1 mb-1.5">
                        {['Občerstvení', 'Vybavení', 'Cestovné', 'Akce', 'Ostatní'].map((cat) => (
                          <button
                            key={cat}
                            type="button"
                            onClick={() => setPurchaseCategory(cat)}
                            className={cn(
                              "px-2 py-0.5 rounded-lg text-[10px] font-bold transition-all border",
                              purchaseCategory === cat
                                ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                                : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                            )}
                          >
                            {cat}
                          </button>
                        ))}
                      </div>
                      <input
                        type="text"
                        placeholder="Vlastní kategorie..."
                        className="w-full px-3 py-2 bg-slate-50 border border-bento-card-border rounded-xl font-medium text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-bento-text-main"
                        value={purchaseCategory}
                        onChange={(e) => setPurchaseCategory(e.target.value)}
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-1">Účel / Obchod (např. Tesco)</label>
                      <input
                        type="text"
                        placeholder="Komu / Název obchodu..."
                        className="w-full px-3 py-2 bg-slate-50 border border-bento-card-border rounded-xl font-medium text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-bento-text-main"
                        value={purchaseRecipient}
                        onChange={(e) => setPurchaseRecipient(e.target.value)}
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-1">Popis / Poznámka</label>
                      <textarea
                        className="w-full p-2.5 bg-slate-50 border border-bento-card-border rounded-xl h-14 text-xs font-medium resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                        placeholder="Detail nakoupených věcí..."
                        value={paymentNote}
                        onChange={(e) => setPaymentNote(e.target.value)}
                      />
                    </div>
                  </>
                ) : (
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-1">Poznámka</label>
                    <textarea
                      className="w-full p-3 bg-slate-50 border border-bento-card-border rounded-xl h-16 text-xs font-medium resize-none focus:outline-none focus:ring-2 focus:ring-bento-accent/20 focus:border-bento-accent transition-all"
                      placeholder="Původ nebo účel platby..."
                      value={paymentNote}
                      onChange={(e) => setPaymentNote(e.target.value)}
                    />
                  </div>
                )}
              </div>

              {/* Fixed Footer */}
              <div className="pt-3 mt-3 border-t border-slate-100 shrink-0">
                <button
                  onClick={handlePayment}
                  className="btn-bento-primary w-full py-3 rounded-xl shadow-lg shadow-bento-accent/20 text-xs font-bold"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Potvrdit a zapsat
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Fine Modal */}
      <AnimatePresence>
        {isEditingFine && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md flex items-center justify-center p-4 z-[60]">
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl border border-bento-card-border"
            >
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h2 className="text-xl font-bold text-bento-text-main tracking-tight">Upravit pokutu</h2>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-bento-accent">Změna záznamu</p>
                </div>
                <button onClick={() => setIsEditingFine(null)} className="p-2 text-bento-text-muted hover:bg-slate-50 rounded-xl transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-2">Důvod</label>
                  <input
                    type="text"
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-bento-accent/20"
                    value={editFineReason}
                    onChange={(e) => setEditFineReason(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-2">Množství {isEditingFine.unit ? `(${isEditingFine.unit})` : '/ Počet'}</label>
                    <input
                      type="number"
                      step={isEditingFine.unit ? "0.1" : "1"}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-bento-accent/20"
                      value={editFineQuantity}
                      onChange={(e) => {
                        const q = parseFloat(e.target.value) || 0;
                        setEditFineQuantity(q);
                        setEditFineAmount((q * editFineUnitPrice).toString());
                        setEditFineReason(prev => updateReasonWithQuantity(prev, q, isEditingFine.unit));
                      }}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-2">Sazba ({getCurrencySymbol(group.currency)})</label>
                    <input
                      type="number"
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-bento-accent/20"
                      value={editFineUnitPrice}
                      onChange={(e) => {
                        const up = parseFloat(e.target.value) || 0;
                        setEditFineUnitPrice(up);
                        setEditFineAmount((editFineQuantity * up).toString());
                      }}
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-2">Celková částka ({getCurrencySymbol(group.currency)})</label>
                  <input
                    type="number"
                    className="w-full px-4 py-3 bg-slate-100 border border-slate-200 rounded-xl text-xl font-black text-rose-500 focus:outline-none"
                    value={editFineAmount}
                    readOnly
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-2">Datum zapsání</label>
                  <input
                    type="date"
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-bento-accent/20 focus:border-bento-accent transition-all text-bento-text-main"
                    value={editFineDate}
                    onChange={(e) => setEditFineDate(e.target.value)}
                  />
                </div>
                <button
                  onClick={handleUpdateFine}
                  className="btn-bento-primary w-full py-4 rounded-xl shadow-lg shadow-bento-accent/20 mt-4"
                >
                  <Save className="w-4 h-4 ml-0 mr-2 inline" />
                  Uložit změny
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Fine Modal */}
      <AnimatePresence>
        {isDeletingFine && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md flex items-center justify-center p-4 z-[60]">
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl border border-bento-card-border text-center"
            >
              <div className="w-16 h-16 bg-rose-50 text-rose-500 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <Trash2 className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold text-bento-text-main mb-2">Smazat pokutu?</h3>
              <p className="text-sm text-bento-text-muted mb-8">Opravdu chcete smazat tento dluh v hodnotě {formatCurrency(isDeletingFine.amount, group.currency)}?</p>

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setIsDeletingFine(null)}
                  className="btn-bento-secondary py-3 text-xs font-bold"
                >
                  Zrušit
                </button>
                <button
                  onClick={() => handleDeleteFine(isDeletingFine.id)}
                  className="bg-rose-600 text-white py-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 hover:bg-rose-700 transition-all shadow-lg shadow-rose-500/20"
                >
                  Ano, smazat
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Pay Specific Fine Modal */}
      <AnimatePresence>
        {selectedFineForPayment && selectedMember && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 z-[60]">
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              className="bg-white rounded-3xl p-5 sm:p-6 max-w-md w-full shadow-2xl border border-bento-card-border max-h-[90vh] flex flex-col"
            >
              {/* Modal Header */}
              <div className="flex justify-between items-center mb-4 shrink-0">
                <div>
                  <h2 className="text-xl font-bold text-bento-text-main tracking-tight">Zapsat platbu pokuty</h2>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">Úhrada konkrétní pokuty</p>
                </div>
                <button 
                  onClick={() => setSelectedFineForPayment(null)} 
                  className="p-2 text-bento-text-muted hover:bg-slate-50 rounded-xl transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Info card describing the fine */}
              <div className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-2xl mb-4 shrink-0 space-y-1">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Vybraná pokuta</p>
                <p className="text-sm font-extrabold text-slate-800">{selectedFineForPayment.reason}</p>
                <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-200/60 mt-1">
                  <span className="text-slate-500 font-medium">Člen: <strong>{selectedMember.name}</strong></span>
                  <span className="text-rose-600 font-black">
                    Zbývá: {formatCurrency(selectedFineForPayment.amount - (selectedFineForPayment.paidAmount || 0), group.currency)}
                  </span>
                </div>
              </div>

              {/* Scrollable Form Content */}
              <div className="space-y-4 overflow-y-auto pr-1 flex-1">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-1">Částka k zaplacení</label>
                  <div className="relative group">
                    <input
                      type="number"
                      className="w-full px-4 py-2.5 bg-slate-50 border border-bento-card-border rounded-xl font-bold text-2xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all text-bento-text-main"
                      value={finePaymentAmount}
                      onChange={(e) => setFinePaymentAmount(e.target.value)}
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 font-bold text-slate-400">{getCurrencySymbol(group.currency)}</span>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1 font-medium">Automaticky předvyplněno na celou zbývající hodnotu pokuty.</p>
                </div>

                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-1">Datum platby</label>
                  <input
                    type="date"
                    className="w-full px-3.5 py-2 bg-slate-50 border border-bento-card-border rounded-xl font-bold text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all text-bento-text-main"
                    value={finePaymentDate}
                    onChange={(e) => setFinePaymentDate(e.target.value)}
                  />
                </div>

                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-1">Způsob úhrady</label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setFinePaymentMethod('cash')}
                      className={cn(
                        "flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-bold text-xs transition-all border",
                        finePaymentMethod === 'cash' 
                          ? "bg-white border-emerald-500 text-bento-text-main shadow-sm ring-1 ring-emerald-500" 
                          : "bg-slate-50 border-bento-card-border text-bento-text-muted hover:bg-white"
                      )}
                    >
                      Hotově
                    </button>
                    <button
                      type="button"
                      onClick={() => setFinePaymentMethod('bank')}
                      className={cn(
                        "flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-bold text-xs transition-all border",
                        finePaymentMethod === 'bank' 
                          ? "bg-white border-emerald-500 text-bento-text-main shadow-sm ring-1 ring-emerald-500" 
                          : "bg-slate-50 border-bento-card-border text-bento-text-muted hover:bg-white"
                      )}
                    >
                      Na účet
                    </button>
                    <button
                      type="button"
                      onClick={() => setFinePaymentMethod('purchase')}
                      className={cn(
                        "flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-bold text-xs transition-all border",
                        finePaymentMethod === 'purchase' 
                          ? "bg-indigo-50 border-indigo-500 text-indigo-700 shadow-sm ring-1 ring-indigo-500" 
                          : "bg-slate-50 border-bento-card-border text-bento-text-muted hover:bg-white"
                      )}
                    >
                      <ShoppingBag className="w-3.5 h-3.5" />
                      Nákup
                    </button>
                  </div>
                </div>

                {finePaymentMethod === 'bank' && group.bankAccount && (
                  <div className="p-3 bg-indigo-50/70 border border-indigo-100 rounded-xl space-y-2">
                    <div className="flex items-center justify-between text-xs text-indigo-950 font-bold">
                      <div className="flex items-center gap-1.5">
                        <Building2 className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                        <span>Účet kasy: <strong className="font-mono text-slate-900">{group.bankAccount}</strong></span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopyText(group.bankAccount!, 'fine_modal_account')}
                        className="p-1 text-indigo-700 hover:text-indigo-900 bg-white rounded-md border border-indigo-200 text-[10px] font-bold flex items-center gap-1 px-2"
                      >
                        {copiedText === 'fine_modal_account' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedText === 'fine_modal_account' ? 'Zkopírováno' : 'Kopírovat'}</span>
                      </button>
                    </div>

                    {group.bankQrCodeUrl && (
                      <div className="pt-2 border-t border-indigo-100 flex items-center gap-3 bg-white p-2.5 rounded-lg">
                        <img src={group.bankQrCodeUrl} alt="QR Platba" className="w-16 h-16 object-contain rounded border" />
                        <div className="flex-1">
                          <p className="text-xs font-bold text-slate-800 flex items-center gap-1">
                            <QrCode className="w-3.5 h-3.5 text-indigo-600" />
                            <span>QR kód pro platbu</span>
                          </p>
                          <div className="flex gap-2 mt-1.5">
                            <button
                              type="button"
                              onClick={() => handleCopyQrImage(group.bankQrCodeUrl!, 'fine_qr_pay')}
                              className="px-2 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded text-[10px] font-bold flex items-center gap-1"
                            >
                              {copiedText === 'fine_qr_pay' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                              <span>{copiedText === 'fine_qr_pay' ? 'Zkopírováno' : 'Kopírovat'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDownloadQr(group.bankQrCodeUrl!)}
                              className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded text-[10px] font-bold flex items-center gap-1"
                            >
                              <Download className="w-3 h-3" />
                              <span>Stáhnout</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {finePaymentMethod === 'purchase' ? (
                  <>
                    <div className="p-2.5 bg-indigo-50/70 border border-indigo-100 rounded-xl text-xs text-indigo-900 space-y-0.5">
                      <p className="font-bold flex items-center gap-1.5 text-indigo-700 text-[11px]">
                        <ShoppingBag className="w-3.5 h-3.5 shrink-0 text-indigo-600" />
                        Nákup pro tým (věcné plnění)
                      </p>
                      <p className="text-[10px] leading-snug text-slate-600">
                        Sníží tuto konkrétní pokutu a zároveň zapíše náklad týmu.
                      </p>
                    </div>

                    <div>
                      <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-1">Kategorie výdaje</label>
                      <div className="flex flex-wrap gap-1 mb-1.5">
                        {['Občerstvení', 'Vybavení', 'Cestovné', 'Akce', 'Ostatní'].map((cat) => (
                          <button
                            key={cat}
                            type="button"
                            onClick={() => setFinePurchaseCategory(cat)}
                            className={cn(
                              "px-2 py-0.5 rounded-lg text-[10px] font-bold transition-all border",
                              finePurchaseCategory === cat
                                ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                                : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                            )}
                          >
                            {cat}
                          </button>
                        ))}
                      </div>
                      <input
                        type="text"
                        placeholder="Vlastní kategorie..."
                        className="w-full px-3 py-2 bg-slate-50 border border-bento-card-border rounded-xl font-medium text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-bento-text-main"
                        value={finePurchaseCategory}
                        onChange={(e) => setFinePurchaseCategory(e.target.value)}
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-1">Účel / Obchod</label>
                      <input
                        type="text"
                        placeholder="Komu / Název obchodu..."
                        className="w-full px-3 py-2 bg-slate-50 border border-bento-card-border rounded-xl font-medium text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-bento-text-main"
                        value={finePurchaseRecipient}
                        onChange={(e) => setFinePurchaseRecipient(e.target.value)}
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-1">Popis / Poznámka</label>
                      <textarea
                        className="w-full p-2.5 bg-slate-50 border border-bento-card-border rounded-xl h-14 text-xs font-medium resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                        placeholder="Detail nakoupených věcí..."
                        value={finePaymentNote}
                        onChange={(e) => setFinePaymentNote(e.target.value)}
                      />
                    </div>
                  </>
                ) : (
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-1">Poznámka</label>
                    <textarea
                      className="w-full p-3 bg-slate-50 border border-bento-card-border rounded-xl h-16 text-xs font-medium resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                      placeholder="Původ nebo účel platby..."
                      value={finePaymentNote}
                      onChange={(e) => setFinePaymentNote(e.target.value)}
                    />
                  </div>
                )}
              </div>

              {/* Fixed Footer */}
              <div className="pt-3 mt-3 border-t border-slate-100 shrink-0 flex gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedFineForPayment(null)}
                  className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-bold text-xs transition-colors"
                >
                  Zrušit
                </button>
                <button
                  type="button"
                  onClick={handleFinePayment}
                  className="flex-[2] py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-lg shadow-emerald-600/20 text-xs font-bold flex items-center justify-center gap-1.5 transition-all active:scale-95"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Potvrdit úhradu pokuty
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* In-Kind Fine Modal (Věcný trest) */}
      <AnimatePresence>
        {inKindModalFine && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-slate-100 space-y-5"
            >
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                    <HelpCircle className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-base text-bento-text-main">Vyhodnocení věcné pokuty</h3>
                    <p className="text-xs text-blue-700 font-bold truncate max-w-[240px]">
                      {inKindModalFine.reason}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setInKindModalFine(null);
                    setInKindChoice(null);
                    setInKindConvertAmount('');
                  }}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-3.5 bg-blue-50/70 border border-blue-100 rounded-2xl space-y-2 text-xs">
                <div className="text-slate-600 font-medium">Člen: <span className="font-bold text-slate-900">{selectedMember?.name}</span></div>
                <div className="text-slate-600 font-medium">Zapsáno: <span className="font-bold text-slate-900">{new Date(inKindModalFine.createdAt).toLocaleDateString('cs-CZ')}</span></div>
                
                <div className="pt-2 border-t border-blue-100/80 space-y-1.5">
                  <div className="flex items-center justify-between text-slate-700">
                    <span className="font-semibold text-slate-600">Název pokuty:</span>
                    <span className="font-extrabold text-blue-900 text-sm">
                      {inKindModalFine.reason}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-700">
                    <span className="font-semibold text-slate-600">Věc / Úkol:</span>
                    <span className="font-extrabold text-blue-700 text-sm">
                      {inKindModalFine.itemOrTask || inKindModalFine.unit || '-'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-700">
                    <span className="font-semibold text-slate-600">Množství:</span>
                    <span className="font-black text-blue-800 bg-blue-100/80 px-2.5 py-0.5 rounded-md text-xs">
                      {inKindModalFine.quantity || 1}x
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-xs font-bold text-bento-text-main block">Přinesl či splnil věcný trest?</label>
                
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setInKindChoice('yes')}
                    className={cn(
                      "p-4 rounded-2xl border-2 font-black text-sm flex flex-col items-center gap-2 transition-all cursor-pointer",
                      inKindChoice === 'yes'
                        ? "border-emerald-500 bg-emerald-50 text-emerald-700 shadow-sm"
                        : "border-slate-100 bg-slate-50 text-slate-600 hover:border-slate-200"
                    )}
                  >
                    <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                    <span>Ano (splněno)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setInKindChoice('no')}
                    className={cn(
                      "p-4 rounded-2xl border-2 font-black text-sm flex flex-col items-center gap-2 transition-all cursor-pointer",
                      inKindChoice === 'no'
                        ? "border-amber-500 bg-amber-50 text-amber-700 shadow-sm"
                        : "border-slate-100 bg-slate-50 text-slate-600 hover:border-slate-200"
                    )}
                  >
                    <XCircle className="w-6 h-6 text-amber-600" />
                    <span>Ne (převést na Kč)</span>
                  </button>
                </div>
              </div>

              {inKindChoice === 'yes' && (
                <div className="p-4 bg-emerald-50/70 border border-emerald-100 rounded-2xl space-y-3">
                  <p className="text-xs text-emerald-800 font-medium leading-relaxed">
                    Pokuta bude označena jako splněná a přesune se do historie splacených pokut.
                  </p>
                  <button
                    type="button"
                    disabled={isInKindSubmitting}
                    onClick={handleInKindFulfill}
                    className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-md shadow-emerald-600/20 transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95"
                  >
                    {isInKindSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    Potvrdit splnění trestu
                  </button>
                </div>
              )}

              {inKindChoice === 'no' && (
                <div className="p-4 bg-amber-50/70 border border-amber-100 rounded-2xl space-y-3">
                  <p className="text-xs text-amber-900 font-medium leading-relaxed">
                    Věcný trest nebyl splněn. Pokuta se změní na běžnou finanční pokutu. Napište kolik peněz bude člen platit:
                  </p>
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-amber-800 block mb-1">
                      Částka v {getCurrencySymbol(group.currency)}
                    </label>
                    <input
                      type="number"
                      min="1"
                      placeholder="Např. 50"
                      className="w-full px-4 py-2.5 bg-white border border-amber-200 rounded-xl font-bold text-base focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                      value={inKindConvertAmount}
                      onChange={(e) => setInKindConvertAmount(e.target.value)}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={isInKindSubmitting || !inKindConvertAmount || parseFloat(inKindConvertAmount) <= 0}
                    onClick={handleInKindConvertToFinancial}
                    className="w-full py-3 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-md shadow-amber-600/20 transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95"
                  >
                    {isInKindSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    Převést na finanční pokutu ({inKindConvertAmount || 0} {getCurrencySymbol(group.currency)})
                  </button>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ExportFinanceModal
        group={group}
        period={period}
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
      />
    </div>
  );
}
