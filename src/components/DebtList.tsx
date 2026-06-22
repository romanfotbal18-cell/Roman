import { useState, useEffect } from 'react';
import { collection, query, onSnapshot, addDoc, serverTimestamp, doc, updateDoc, writeBatch, deleteDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Group, Period, Member, Fine, OperationType, Transaction, Payment } from '../types';
import { handleFirestoreError, formatCurrency, cn } from '../utils';
import { Search, User as UserIcon, CheckCircle2, ChevronRight, History, CreditCard, X, Loader2, Trash2, Edit2, AlertCircle, Save, Download } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';

interface DebtListProps {
  group: Group;
  period: Period;
}

export default function DebtList({ group, period }: DebtListProps) {
  const [members, setMembers] = useState<Member[]>([]);
  const [fines, setFines] = useState<Fine[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'bank'>('cash');
  const [paymentNote, setPaymentNote] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);

  const exportToExcel = () => {
    const sortedForExport = [...members].sort((a, b) => getMemberDebt(b.id) - getMemberDebt(a.id));
    const exportData = sortedForExport
      .map(member => {
        const balance = getMemberDebt(member.id);
        if (balance === 0) return null;

        const unpaidMemberFines = fines.filter(f => f.memberId === member.id && !f.paid);
        const descriptions = unpaidMemberFines.map(f => {
          const remaining = f.amount - (f.paidAmount || 0);
          return `${f.reason} (${formatCurrency(remaining)})`;
        }).join(', ');

        return {
          'Jméno': member.name,
          'Částka (Kč)': balance,
          'Stav': balance < 0 ? 'Přeplatek (Nabito)' : 'Dluh',
          'Rozpis dluhů / Poznámka': balance < 0 ? 'Předplaceno na budoucí pokuty' : descriptions
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
      
      // Record payment
      const paymentRef = doc(collection(db, `groups/${group.id}/periods/${period.id}/payments`));
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

      // Record transaction
      batch.set(transactionRef, {
        amount: amount,
        type: 'income',
        source: 'fine_payment',
        category: 'Pokuta',
        note: `Platba od: ${selectedMember.name}${paymentNote ? ` (${paymentNote})` : ''}`,
        periodId: period.id,
        createdAt: timestamp,
        fromWho: selectedMember.name,
        paymentId: paymentRef.id
      });

      // Mark fines as paid if amount covers them fully or partially
      let remainingPayment = amount;
      const sortedUnpaidFines = [...unpaidFines].sort((a, b) => a.createdAt - b.createdAt);

      for (const fine of sortedUnpaidFines) {
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
      setIsPaymentModalOpen(false);
      setPaymentAmount('');
      setPaymentNote('');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'payment/transaction');
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
            onClick={exportToExcel}
            className="flex items-center justify-center gap-2 px-6 py-3 bg-white border border-bento-card-border rounded-xl hover:border-bento-accent/30 hover:bg-slate-50 transition-all text-sm font-black uppercase tracking-widest text-bento-text-muted hover:text-bento-accent shadow-sm active:scale-95 shrink-0"
            title="Exportovat do Excelu"
          >
            <Download className="w-4 h-4" />
            <span className="sm:hidden lg:inline">Exportovat</span>
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3">
          {filteredMembers.map((member) => {
            const debt = getMemberDebt(member.id);
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
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "px-3 py-1.5 rounded-lg font-bold text-xs",
                    debt > 0 
                      ? "bg-rose-50 text-rose-600" 
                      : (debt < 0 ? "bg-indigo-50 text-indigo-600" : "bg-emerald-50 text-emerald-600")
                  )}>
                    {debt < 0 ? formatCurrency(Math.abs(debt)) : formatCurrency(debt)}
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
                        const isPartial = (fine.paidAmount || 0) > 0;
                        const remainingDebt = fine.amount - (fine.paidAmount || 0);
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
                                {isPartial && ` • Uhrazeno: ${formatCurrency(fine.paidAmount)}`}
                              </span>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="flex flex-col items-end">
                                <span className="font-black text-sm text-rose-600">
                                  {formatCurrency(remainingDebt)}
                                </span>
                                {isPartial && <span className="text-[9px] font-bold text-slate-400">Zbývá z {formatCurrency(fine.amount)}</span>}
                              </div>
                              
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-2">
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
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setIsDeletingFine(fine);
                                  }}
                                  className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-slate-100 rounded-lg transition-all"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
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
                    <div className="flex justify-between items-end">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-bento-text-muted mb-1">Dlužná částka</p>
                        <p className={cn(
                          "text-4xl font-black tracking-tighter leading-none",
                          getMemberDebt(selectedMember.id) < 0 ? "text-indigo-600" : "text-bento-text-main"
                        )}>
                          {getMemberDebt(selectedMember.id) < 0 
                            ? formatCurrency(Math.abs(getMemberDebt(selectedMember.id))) 
                            : formatCurrency(getMemberDebt(selectedMember.id))}
                        </p>
                      </div>
                      {getMemberDebt(selectedMember.id) > 0 ? (
                        <div className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1.5 bg-rose-50 text-rose-500 rounded-lg animate-pulse">
                          Nevyrovnáno
                        </div>
                      ) : (getMemberDebt(selectedMember.id) < 0 && (
                        <div className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1.5 bg-indigo-50 text-indigo-500 rounded-lg">
                          Přeplatek
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => {
                        const debt = getMemberDebt(selectedMember.id);
                        setPaymentAmount(debt > 0 ? debt.toString() : '');
                        setPaymentDate(new Date().toISOString().split('T')[0]);
                        setIsPaymentModalOpen(true);
                      }}
                      className="btn-bento-primary w-full py-4 rounded-2xl shadow-xl shadow-bento-accent/15 flex items-center justify-center gap-3 transition-all hover:scale-[1.02] active:scale-98"
                    >
                      <CreditCard className="w-5 h-5" />
                      <span className="text-sm font-bold">Zapsat platbu</span>
                    </button>
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
                              {item.histType === 'payment' ? `Platba: ${item.paymentMethod === 'cash' ? 'Hotově' : 'Na účet'}` : (item as any).reason}
                            </span>
                            <span className="text-[10px] font-semibold text-bento-text-muted">
                              {new Date(item.createdAt).toLocaleDateString('cs-CZ')}
                              {item.histType === 'payment' && (item as any).note && ` • ${(item as any).note}`}
                            </span>
                          </div>
                          <span className={cn(
                            "text-xs font-black tracking-tight",
                            item.histType === 'payment' ? "text-emerald-600" : "text-slate-400"
                          )}>
                            {item.histType === 'payment' ? '+' : ''}{formatCurrency(item.amount)}
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
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md flex items-center justify-center p-4 z-50">
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl border border-bento-card-border"
            >
              <div className="flex justify-between items-center mb-8">
                <div>
                  <h2 className="text-2xl font-bold text-bento-text-main tracking-tight">Zapsat platbu</h2>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-bento-accent">Nová transakce</p>
                </div>
                <button onClick={() => setIsPaymentModalOpen(false)} className="p-2 text-bento-text-muted hover:bg-slate-50 rounded-xl transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-2">Částka k zaplacení</label>
                  <div className="relative group">
                    <input
                      type="number"
                      className="w-full px-5 py-4 bg-slate-50 border border-bento-card-border rounded-xl font-bold text-3xl focus:outline-none focus:ring-2 focus:ring-bento-accent/20 focus:border-bento-accent transition-all text-bento-text-main"
                      value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value)}
                    />
                    <span className="absolute right-5 top-1/2 -translate-y-1/2 font-bold text-slate-400">Kč</span>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-2">Datum platby</label>
                  <input
                    type="date"
                    className="w-full px-4 py-3 bg-slate-50 border border-bento-card-border rounded-xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-bento-accent/20 focus:border-bento-accent transition-all text-bento-text-main"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setPaymentMethod('cash')}
                    className={cn(
                      "flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-xs transition-all border",
                      paymentMethod === 'cash' 
                        ? "bg-white border-bento-accent text-bento-text-main shadow-sm" 
                        : "bg-slate-50 border-bento-card-border text-bento-text-muted hover:bg-white"
                    )}
                  >
                    Hotově
                  </button>
                  <button
                    onClick={() => setPaymentMethod('bank')}
                    className={cn(
                      "flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-xs transition-all border",
                      paymentMethod === 'bank' 
                        ? "bg-white border-bento-accent text-bento-text-main shadow-sm" 
                        : "bg-slate-50 border-bento-card-border text-bento-text-muted hover:bg-white"
                    )}
                  >
                    Na účet
                  </button>
                </div>

                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-2">Poznámka</label>
                  <textarea
                    className="w-full p-4 bg-slate-50 border border-bento-card-border rounded-xl h-20 text-xs font-medium resize-none focus:outline-none focus:ring-2 focus:ring-bento-accent/20 focus:border-bento-accent transition-all"
                    placeholder="Původ nebo účel platby..."
                    value={paymentNote}
                    onChange={(e) => setPaymentNote(e.target.value)}
                  />
                </div>

                <button
                  onClick={handlePayment}
                  className="btn-bento-primary w-full py-4 rounded-xl shadow-xl shadow-bento-accent/20"
                >
                  <CheckCircle2 className="w-5 h-5" />
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
                    <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-2">Sazba (Kč)</label>
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
                  <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-2">Celková částka (Kč)</label>
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
              <p className="text-sm text-bento-text-muted mb-8">Opravdu chcete smazat tento dluh v hodnotě {formatCurrency(isDeletingFine.amount)}?</p>

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
    </div>
  );
}
