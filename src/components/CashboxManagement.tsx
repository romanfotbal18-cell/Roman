import { useState, useEffect } from 'react';
import { collection, query, onSnapshot, addDoc, updateDoc, deleteDoc, doc, orderBy, getDoc, writeBatch, getDocs, where, setDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Group, Period, Transaction, OperationType, Fine, Payment, Member } from '../types';
import { handleFirestoreError, formatCurrency, getCurrencySymbol, formatDate, cn, getUserRole } from '../utils';
import { TrendingUp, TrendingDown, ReceiptText, ListFilter, Plus, Search, Calendar, History, Wallet, X, Edit2, Trash2, Save, Trash, Users, UserPlus, Eye } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface CashboxManagementProps {
  group: Group;
  period: Period;
}

export default function CashboxManagement({ group, period }: CashboxManagementProps) {
  const userRole = getUserRole(group, auth.currentUser?.email, auth.currentUser?.uid);
  const isReadOnly = userRole === 'viewer';

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddingExpense, setIsAddingExpense] = useState(false);
  const [isAddingIncome, setIsAddingIncome] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [viewingTransaction, setViewingTransaction] = useState<Transaction | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [category, setCategory] = useState('');
  
  // Filter states
  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense'>('all');
  const [filterCategory, setFilterCategory] = useState('all');
  
  // Form states
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [fromWho, setFromWho] = useState('');
  const [transDate, setTransDate] = useState(new Date().toISOString().split('T')[0]);
  const [subItems, setSubItems] = useState<{ amount: string; fromWho: string; note: string }[]>([]);
  const [isSummary, setIsSummary] = useState(false);
  const [isDebtExpense, setIsDebtExpense] = useState(false);
  const [debtMembers, setDebtMembers] = useState<{ memberId: string; amount: string; memberName: string }[]>([]);
  const [cashboxPortion, setCashboxPortion] = useState('0');
  const [splitMode, setSplitMode] = useState<'equal' | 'custom'>('equal');
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [perMemberAmount, setPerMemberAmount] = useState('0');

  const incomeCategories = ['Zůstatek', 'Pokuta', 'Sponzor', 'Příspěvek', 'Jiné'];
  const expenseCategories = ['Akce', 'Nákup', 'Služby', 'Cestovné', 'Občerstvení', 'Jiné'];

  const filteredTransactions = transactions.filter(t => {
    const matchesType = filterType === 'all' || t.type === filterType;
    const matchesCategory = filterCategory === 'all' || t.category === filterCategory;
    return matchesType && matchesCategory;
  });

  const availableCategories = Array.from(new Set([
    ...(filterType === 'all' || filterType === 'income' ? incomeCategories : []),
    ...(filterType === 'all' || filterType === 'expense' ? expenseCategories : []),
    ...transactions
      .filter(t => filterType === 'all' || t.type === filterType)
      .map(t => t.category)
      .filter(Boolean) as string[]
  ])).sort();

  useEffect(() => {
    if (filterCategory !== 'all' && !availableCategories.includes(filterCategory)) {
      setFilterCategory('all');
    }
  }, [filterType, availableCategories, filterCategory]);

  useEffect(() => {
    const transactionsPath = `groups/${group.id}/periods/${period.id}/transactions`;
    const q = query(collection(db, transactionsPath), orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })) as Transaction[];
      const unique = data.filter((v, i, a) => a.findIndex(t => t.id === v.id) === i);
      setTransactions(unique);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, transactionsPath);
    });

    // Fetch members
    const membersPath = `groups/${group.id}/periods/${period.id}/members`;
    const membersQuery = query(collection(db, membersPath), orderBy('name'));
    const unsubscribeMembers = onSnapshot(membersQuery, (snapshot) => {
      setMembers(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })) as Member[]);
    });

    return () => {
      unsubscribe();
      unsubscribeMembers();
    };
  }, [group.id, period.id]);

  useEffect(() => {
    if (editingTransaction) {
      setAmount(Math.abs(editingTransaction.amount).toString());
      setNote(editingTransaction.note);
      setCategory(editingTransaction.category || '');
      setFromWho(editingTransaction.fromWho || '');
      setTransDate(new Date(editingTransaction.createdAt).toISOString().split('T')[0]);
      setIsSummary(editingTransaction.isSummary || false);
      setSubItems(editingTransaction.subItems?.map(item => ({
        amount: item.amount.toString(),
        fromWho: item.fromWho,
        note: item.note
      })) || []);
      setIsDebtExpense(editingTransaction.isDebtExpense || false);
      setDebtMembers(editingTransaction.debtDetails?.map(detail => ({
        memberId: detail.memberId,
        memberName: detail.memberName,
        amount: detail.amount.toString()
      })) || []);
      setSelectedMemberIds(editingTransaction.debtDetails?.map(d => d.memberId) || []);
      setCashboxPortion(editingTransaction.cashboxPortion?.toString() || '0');
      // If it's equal split, try to recover perMemberAmount
      if (editingTransaction.debtDetails && editingTransaction.debtDetails.length > 0) {
        const amounts = editingTransaction.debtDetails.map(d => d.amount);
        const allSame = amounts.every(a => a === amounts[0]);
        if (allSame) {
          setPerMemberAmount(amounts[0].toString());
          setSplitMode('equal');
        } else {
          setSplitMode('custom');
        }
      }
    } else {
      setAmount('');
      setNote('');
      setCategory('');
      setFromWho('');
      setTransDate(new Date().toISOString().split('T')[0]);
      setIsSummary(false);
      setSubItems([]);
      setIsDebtExpense(false);
      setDebtMembers([]);
      setCashboxPortion('0');
      setPerMemberAmount('0');
      setSelectedMemberIds([]);
      setSplitMode('equal');
    }
  }, [editingTransaction]);

  const handleSubmit = async (type: 'income' | 'expense') => {
    const getFallbackNote = () => {
      if (isSummary) return 'Souhrnný výdaj';
      if (isDebtExpense) return 'Výdaj na dluh';
      return type === 'income' ? 'Příjem' : 'Výdaj';
    };
    const finalNote = note || getFallbackNote();
    if (!amount) return;
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) return;

    try {
      const finalAmount = type === 'expense' ? -numAmount : numAmount;
      
      const processedSubItems = isSummary ? subItems.map(item => ({
        amount: parseFloat(item.amount) || 0,
        fromWho: item.fromWho,
        note: item.note
      })) : null;

      const processedDebtDetails = isDebtExpense ? debtMembers.map(item => ({
        memberId: item.memberId,
        memberName: item.memberName,
        amount: parseFloat(item.amount) || 0
      })) : null;

      // Merge selected date with current time to preserve record order within a day
      const now = new Date();
      const selectedDate = new Date(transDate);
      selectedDate.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
      const createdAt = selectedDate.getTime();
      
      const transactionsPath = `groups/${group.id}/periods/${period.id}/transactions`;
      
      const transactionData = {
        amount: finalAmount,
        note: finalNote,
        category: category || null,
        fromWho: fromWho || null,
        createdAt: createdAt,
        isSummary: isSummary,
        isDebtExpense: isDebtExpense,
        subItems: processedSubItems,
        debtDetails: processedDebtDetails,
        cashboxPortion: isDebtExpense ? parseFloat(cashboxPortion) || 0 : null
      };

      const batch = writeBatch(db);

      if (editingTransaction) {
        batch.set(doc(db, transactionsPath, editingTransaction.id), transactionData, { merge: true });

        // Handle fine sync if it was or is a debt expense
        if (editingTransaction.isDebtExpense || isDebtExpense) {
          const finesRef = collection(db, `groups/${group.id}/periods/${period.id}/fines`);
          const finesQuery = query(finesRef, where('transactionId', '==', editingTransaction.id));
          const finesSnap = await getDocs(finesQuery);
          
          finesSnap.docs.forEach(fineDoc => {
            batch.delete(doc(db, `groups/${group.id}/periods/${period.id}/fines`, fineDoc.id));
          });

          if (isDebtExpense && processedDebtDetails) {
            processedDebtDetails.forEach(debt => {
              if (debt.amount > 0) {
                const fineRef = doc(collection(db, `groups/${group.id}/periods/${period.id}/fines`));
                batch.set(fineRef, {
                  memberId: debt.memberId,
                  amount: debt.amount,
                  reason: finalNote,
                  paid: false,
                  paidAmount: 0,
                  periodId: period.id,
                  createdAt: createdAt || editingTransaction.createdAt,
                  transactionId: editingTransaction.id
                });
              }
            });
          }
        }
      } else {
        const transRef = doc(collection(db, transactionsPath));
        batch.set(transRef, {
          ...transactionData,
          type: type,
          source: type === 'expense' ? 'expense' : 'external_income',
          periodId: period.id,
        });

        // Add fines if it's a debt expense
        if (isDebtExpense && processedDebtDetails) {
          processedDebtDetails.forEach(debt => {
            if (debt.amount > 0) {
              const fineRef = doc(collection(db, `groups/${group.id}/periods/${period.id}/fines`));
              batch.set(fineRef, {
                memberId: debt.memberId,
                amount: debt.amount,
                reason: finalNote, // Task says fine name should be purpose
                paid: false,
                paidAmount: 0,
                periodId: period.id,
                createdAt: createdAt,
                transactionId: transRef.id // Link fine to transaction
              });
            }
          });
        }
      }

      await batch.commit();

      setAmount('');
      setNote('');
      setCategory('');
      setFromWho('');
      setSubItems([]);
      setIsSummary(false);
      setIsDebtExpense(false);
      setDebtMembers([]);
      setCashboxPortion('0');
      setSelectedMemberIds([]);
      setIsAddingExpense(false);
      setIsAddingIncome(false);
      setEditingTransaction(null);
    } catch (error) {
      const op = editingTransaction ? OperationType.UPDATE : OperationType.CREATE;
      handleFirestoreError(error, op, 'transactions');
    }
  };

  const handleDelete = async (transactionId: string) => {
    setIsDeleting(true);
    setError(null);
    try {
      const transaction = transactions.find(t => t.id === transactionId);
      if (!transaction) return;

      const batch = writeBatch(db);
      const transcRef = doc(db, `groups/${group.id}/periods/${period.id}/transactions`, transactionId);
      batch.delete(transcRef);

      if (transaction.source === 'fine_payment' && transaction.paymentId) {
        // Find corresponding payment
        const paymentRef = doc(db, `groups/${group.id}/periods/${period.id}/payments`, transaction.paymentId);
        const paymentSnap = await getDoc(paymentRef);
        
        if (paymentSnap.exists()) {
          const paymentData = paymentSnap.data() as Payment;
          const memberId = paymentData.memberId;
          const revertAmount = paymentData.amount;

          // Revert fines
          const finesRef = collection(db, `groups/${group.id}/periods/${period.id}/fines`);
          const finesQuery = query(finesRef, where('memberId', '==', memberId));
          const finesSnap = await getDocs(finesQuery);
          const memberFines = finesSnap.docs.map(d => ({ id: d.id, ...d.data() })) as Fine[];

          // Reverse chronological revert (from newest paid back to oldest)
          let remainingToRevert = revertAmount;
          const sortedFines = memberFines.sort((a, b) => b.createdAt - a.createdAt);

          for (const fine of sortedFines) {
            if (remainingToRevert <= 0) break;
            
            const currentPaid = fine.paidAmount || 0;
            if (currentPaid > 0) {
              const toSubtract = Math.min(currentPaid, remainingToRevert);
              batch.set(doc(db, `groups/${group.id}/periods/${period.id}/fines`, fine.id), {
                paidAmount: currentPaid - toSubtract,
                paid: false // Reverting always makes it unpaid 
              }, { merge: true });
              remainingToRevert -= toSubtract;
            }
          }
          
          batch.delete(paymentRef);
        }
      }

      // Handle debt expense fines deletion
      if (transaction.isDebtExpense) {
        const finesRef = collection(db, `groups/${group.id}/periods/${period.id}/fines`);
        const finesQuery = query(finesRef, where('transactionId', '==', transactionId));
        const finesSnap = await getDocs(finesQuery);
        finesSnap.docs.forEach(fineDoc => {
          batch.delete(doc(db, `groups/${group.id}/periods/${period.id}/fines`, fineDoc.id));
        });
      }

      await batch.commit();
      setViewingTransaction(null);
      setDeleteConfirmId(null);
    } catch (err) {
      console.error("Delete error:", err);
      setError("Nepodařilo se smazat transakci. Zkuste to prosím znovu.");
    } finally {
      setIsDeleting(false);
    }
  };

  const currentBalance = transactions.reduce((sum, t) => sum + t.amount, 0);

  return (
    <div className="space-y-6">
      {/* Header Summary */}
      <div className="grid grid-cols-1 md:grid-cols-6 gap-6">
        <div className="md:col-span-4 bento-card bg-white p-8 flex flex-row items-center justify-between shadow-sm">
          <div>
            <p className="text-[10px] font-black text-bento-text-muted uppercase tracking-[0.2em] mb-2">Dostupná hotovost</p>
            <p className="text-4xl font-black text-bento-text-main tracking-tighter">{formatCurrency(currentBalance, group.currency)}</p>
          </div>
          <div className="w-14 h-14 bg-bento-accent/10 text-bento-accent rounded-2xl flex items-center justify-center">
            <Wallet className="w-7 h-7" />
          </div>
        </div>
        
        {!isReadOnly ? (
          <div className="md:col-span-2 flex flex-col gap-4">
            <button
              onClick={() => setIsAddingIncome(true)}
              className="flex-1 btn-bento-primary bg-emerald-500 hover:bg-emerald-600 shadow-lg shadow-emerald-500/10"
            >
              <TrendingUp className="w-4 h-4" />
              <span className="text-xs uppercase tracking-widest">Zapsat příjem</span>
            </button>
            <button
              onClick={() => setIsAddingExpense(true)}
              className="flex-1 btn-bento-primary bg-rose-500 hover:bg-rose-600 shadow-lg shadow-rose-500/10"
            >
              <TrendingDown className="w-4 h-4" />
              <span className="text-xs uppercase tracking-widest">Zapsat výdaj</span>
            </button>
          </div>
        ) : (
          <div className="md:col-span-2 bg-amber-50 border border-amber-200 rounded-3xl p-6 flex items-center justify-center text-center">
            <p className="text-xs font-bold text-amber-800 flex items-center gap-2">
              <Eye className="w-5 h-5 text-amber-600 shrink-0" />
              <span>Pouze pro čtení — operace v pokladně jsou zakázány.</span>
            </p>
          </div>
        )}
      </div>

      {/* Transaction History */}
      <div className="bento-card bg-white shadow-sm overflow-hidden p-0">
        <div className="p-6 border-b border-bento-card-border flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-bento-accent"></div>
            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-bento-text-main">Historie transakcí</h3>
          </div>
          
          <div className="flex items-center gap-3 w-full md:w-auto overflow-x-auto pb-2 md:pb-0 custom-scrollbar">
            <div className="flex p-1 bg-slate-100 rounded-xl">
              <button
                onClick={() => setFilterType('all')}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                  filterType === 'all' ? "bg-white text-bento-text-main shadow-sm" : "text-bento-text-muted hover:text-bento-text-main"
                )}
              >
                Vše
              </button>
              <button
                onClick={() => setFilterType('income')}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                  filterType === 'income' ? "bg-white text-emerald-600 shadow-sm" : "text-bento-text-muted hover:text-emerald-500"
                )}
              >
                Příjmy
              </button>
              <button
                onClick={() => setFilterType('expense')}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                  filterType === 'expense' ? "bg-white text-rose-600 shadow-sm" : "text-bento-text-muted hover:text-rose-500"
                )}
              >
                Výdaje
              </button>
            </div>

            <div className="h-8 w-px bg-slate-200 hidden md:block"></div>

            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-bento-text-main focus:outline-none focus:ring-2 focus:ring-bento-accent/20 min-w-[120px]"
            >
              <option value="all">Všechny kategorie</option>
              {availableCategories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="divide-y divide-bento-card-border">
          {filteredTransactions.length > 0 ? (
            filteredTransactions.map((t) => (
              <button 
                key={t.id} 
                className="w-full text-left p-5 flex items-center justify-between hover:bg-slate-50 transition-colors group"
                onClick={() => setViewingTransaction(t)}
              >
                <div className="flex items-center gap-4">
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110",
                    t.amount > 0 ? "bg-emerald-50 text-emerald-500" : "bg-rose-50 text-rose-500"
                  )}>
                    {t.amount > 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                  </div>
                  <div>
                    <span className="font-bold text-sm text-bento-text-main block leading-tight mb-1">
                      {t.note}
                      {t.isSummary && (
                        <span className="ml-2 text-[8px] font-black uppercase tracking-widest bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                          Souhrnný
                        </span>
                      )}
                      {t.isDebtExpense && (
                        <span className="ml-2 text-[8px] font-black uppercase tracking-widest bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full">
                          Na dluh
                        </span>
                      )}
                    </span>
                    <div className="flex items-center gap-2 text-[10px] text-bento-text-muted font-bold uppercase tracking-wider">
                      <span>{formatDate(t.createdAt)}</span>
                      {t.category && (
                        <>
                          <span className="w-1 h-1 bg-slate-200 rounded-full" />
                          <span className="text-slate-500">{t.category}</span>
                        </>
                      )}
                      {t.fromWho && (
                        <>
                          <span className="w-1 h-1 bg-slate-200 rounded-full" />
                          <span className="text-bento-accent">{t.amount > 0 ? 'Původ' : 'Účel'}: {t.fromWho}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className={cn(
                    "text-base font-black tracking-tight",
                    t.amount > 0 ? "text-emerald-600" : "text-rose-600"
                  )}>
                    {t.amount > 0 ? '+' : ''}{formatCurrency(t.amount, group.currency)}
                  </div>
                </div>
              </button>
            ))
          ) : (
            <div className="text-center py-20 text-slate-400">
              <ReceiptText className="w-12 h-12 mx-auto mb-4 opacity-10" />
              <p className="text-xs font-bold uppercase tracking-widest px-8">Zatím žádné záznamy</p>
            </div>
          )}
        </div>
      </div>

      {/* Add / Edit Modal */}
      <AnimatePresence>
        {(isAddingIncome || isAddingExpense || editingTransaction) && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md flex items-center justify-center p-4 z-50">
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl border border-bento-card-border"
            >
              <div className="flex justify-between items-center mb-8">
                <div>
                  <h2 className="text-2xl font-bold text-bento-text-main tracking-tight">
                    {editingTransaction ? 'Upravit transakci' : (isAddingIncome ? 'Přidat příjem' : 'Zapsat výdaj')}
                  </h2>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-bento-accent">
                    {editingTransaction ? 'Úprava záznamu' : 'Manuální zápis'}
                  </p>
                </div>
                <button 
                  onClick={() => {
                    setIsAddingIncome(false);
                    setIsAddingExpense(false);
                    setEditingTransaction(null);
                  }} 
                  className="p-2 text-bento-text-muted hover:bg-slate-50 rounded-xl transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-2 custom-scrollbar">
                {isAddingExpense && !editingTransaction && (
                  <div className="flex items-center gap-2 mb-4 bg-slate-50 p-1.5 rounded-2xl border border-slate-100">
                    <button
                      onClick={() => {
                        setIsSummary(false);
                        setIsDebtExpense(false);
                        setCategory('');
                        setNote('');
                      }}
                      className={cn(
                        "flex-1 py-2 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all",
                        (!isSummary && !isDebtExpense) ? "bg-white text-bento-text-main shadow-sm border border-slate-200" : "text-bento-text-muted"
                      )}
                    >
                      Běžný
                    </button>
                    <button
                      onClick={() => {
                        setIsSummary(true);
                        setIsDebtExpense(false);
                        setCategory('Akce');
                        setNote('Souhrnný výdaj');
                      }}
                      className={cn(
                        "flex-1 py-2 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all",
                        isSummary ? "bg-white text-amber-600 shadow-sm border border-amber-200" : "text-bento-text-muted"
                      )}
                    >
                      Souhrnný
                    </button>
                    <button
                      onClick={() => {
                        setIsDebtExpense(true);
                        setIsSummary(false);
                        setCategory('Na dluh');
                        setNote('');
                      }}
                      className={cn(
                        "flex-1 py-2 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all",
                        isDebtExpense ? "bg-white text-indigo-600 shadow-sm border border-indigo-200" : "text-bento-text-muted"
                      )}
                    >
                      Na dluh
                    </button>
                  </div>
                )}

                <div className="bg-slate-50 p-4 rounded-[2rem] border border-slate-100 mb-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-1">
                    {isSummary || isDebtExpense ? `Celková částka (${getCurrencySymbol(group.currency)})` : `Částka (${getCurrencySymbol(group.currency)})`}
                  </label>
                  <div className="relative group">
                    <input
                      type="number"
                      autoFocus
                      className="w-full bg-transparent border-0 font-black text-4xl focus:outline-none text-bento-text-main p-0"
                      placeholder="0"
                      value={amount}
                      readOnly={isSummary || isDebtExpense}
                      onChange={(e) => {
                        const val = e.target.value;
                        setAmount(val);
                      }}
                    />
                    <span className="absolute right-0 top-1/2 -translate-y-1/2 font-black text-slate-300 text-2xl tracking-tighter">{getCurrencySymbol(group.currency)}</span>
                  </div>
                </div>

                {isDebtExpense && (
                  <div className="space-y-4 bg-slate-50 p-4 rounded-[2rem] border border-slate-100">
                    <div className="flex justify-between items-center mb-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted">Rozdělení dluhu</label>
                      <div className="flex bg-white p-1 rounded-lg border border-slate-100 shadow-sm">
                        <button
                          onClick={() => setSplitMode('equal')}
                          className={cn(
                            "px-2 py-1 rounded text-[8px] font-black uppercase tracking-widest transition-all",
                            splitMode === 'equal' ? "bg-indigo-50 text-indigo-600" : "text-slate-400"
                          )}
                        >
                          Rovnoměrně
                        </button>
                        <button
                          onClick={() => setSplitMode('custom')}
                          className={cn(
                            "px-2 py-1 rounded text-[8px] font-black uppercase tracking-widest transition-all",
                            splitMode === 'custom' ? "bg-indigo-50 text-indigo-600" : "text-slate-400"
                          )}
                        >
                          Vlastní
                        </button>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {splitMode === 'equal' && (
                        <div className="bg-white p-3 rounded-2xl border border-slate-100 shadow-sm">
                          <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-2">Částka na člena ({getCurrencySymbol(group.currency)})</label>
                          <input
                            type="number"
                            placeholder="0"
                            className="w-full bg-slate-50 border-0 font-bold text-lg focus:outline-none p-2 rounded-xl"
                            value={perMemberAmount}
                            onChange={(e) => {
                              const val = e.target.value;
                              setPerMemberAmount(val);
                              const numVal = parseFloat(val) || 0;
                              const portion = parseFloat(cashboxPortion) || 0;
                              const total = (numVal * selectedMemberIds.length) + portion;
                              setAmount(total.toString());
                              
                              setDebtMembers(selectedMemberIds.map(id => ({
                                memberId: id,
                                memberName: members.find(m => m.id === id)?.name || '',
                                amount: val
                              })));
                            }}
                          />
                        </div>
                      )}

                      <div className="bg-white p-3 rounded-2xl border border-slate-100 shadow-sm">
                        <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-2">Příspěvek z kasy ({getCurrencySymbol(group.currency)})</label>
                        <input
                          type="number"
                          placeholder="0"
                          className="w-full bg-slate-50 border-0 font-bold text-lg focus:outline-none p-2 rounded-xl"
                          value={cashboxPortion}
                          onChange={(e) => {
                            const val = e.target.value;
                            setCashboxPortion(val);
                            const portion = parseFloat(val) || 0;
                            
                            if (splitMode === 'equal') {
                              const perMemberNum = parseFloat(perMemberAmount) || 0;
                              const total = (perMemberNum * selectedMemberIds.length) + portion;
                              setAmount(total.toString());
                            } else {
                              const totalDebt = debtMembers.reduce((sum, d) => sum + (parseFloat(d.amount) || 0), 0);
                              setAmount((totalDebt + portion).toString());
                            }
                          }}
                        />
                        <p className="text-[9px] text-slate-400 mt-1 italic">Část, kterou pokladna zaplatí bez nároku na vrácení.</p>
                      </div>

                      <div className="bg-white p-3 rounded-2xl border border-slate-100 shadow-sm">
                        <div className="flex justify-between items-center mb-2">
                          <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block">Vybrat členy</label>
                          <button
                            onClick={() => {
                              const activeMembers = members.filter(m => m.active);
                              if (selectedMemberIds.length === activeMembers.length) {
                                setSelectedMemberIds([]);
                                if (splitMode === 'equal') {
                                  const portion = parseFloat(cashboxPortion) || 0;
                                  setAmount(portion.toString());
                                  setDebtMembers([]);
                                } else {
                                  setDebtMembers([]);
                                }
                              } else {
                                const allIds = activeMembers.map(m => m.id);
                                setSelectedMemberIds(allIds);
                                if (splitMode === 'equal') {
                                  const portion = parseFloat(cashboxPortion) || 0;
                                  const perMemberNum = parseFloat(perMemberAmount) || 0;
                                  const total = (perMemberNum * allIds.length) + portion;
                                  setAmount(total.toString());
                                  setDebtMembers(allIds.map(id => ({
                                    memberId: id,
                                    memberName: members.find(m => m.id === id)?.name || '',
                                    amount: perMemberAmount
                                  })));
                                } else {
                                  setDebtMembers(activeMembers.map(m => ({
                                    memberId: m.id,
                                    memberName: m.name,
                                    amount: debtMembers.find(dm => dm.memberId === m.id)?.amount || ''
                                  })));
                                }
                              }
                            }}
                            className="text-[9px] font-black uppercase text-indigo-500 hover:text-indigo-700 transition-colors"
                          >
                            {selectedMemberIds.length === members.filter(m => m.active).length ? 'Zrušit vše' : 'Vybrat vše'}
                          </button>
                        </div>
                        <div className="max-h-40 overflow-y-auto pr-1 space-y-1 custom-scrollbar">
                          {members.filter(m => m.active).map(member => (
                            <button
                              key={member.id}
                              onClick={() => {
                                const newSelection = selectedMemberIds.includes(member.id)
                                  ? selectedMemberIds.filter(id => id !== member.id)
                                  : [...selectedMemberIds, member.id];
                                setSelectedMemberIds(newSelection);
                                
                                if (splitMode === 'equal') {
                                  const portion = parseFloat(cashboxPortion) || 0;
                                  const perMemberNum = parseFloat(perMemberAmount) || 0;
                                  const total = (perMemberNum * newSelection.length) + portion;
                                  setAmount(total.toString());
                                  
                                  setDebtMembers(newSelection.map(id => ({
                                    memberId: id,
                                    memberName: members.find(m => m.id === id)?.name || '',
                                    amount: perMemberAmount
                                  })));
                                } else {
                                  // Join new members to debtMembers without clearing amounts
                                  setDebtMembers(newSelection.map(id => {
                                    const existing = debtMembers.find(dm => dm.memberId === id);
                                    return existing || { memberId: id, memberName: member.name, amount: '' };
                                  }));
                                }
                              }}
                              className={cn(
                                "w-full flex items-center justify-between p-2 rounded-lg text-left transition-all",
                                selectedMemberIds.includes(member.id) ? "bg-indigo-50 text-indigo-700" : "hover:bg-slate-50 text-slate-600"
                              )}
                            >
                              <span className="text-xs font-bold">{member.name}</span>
                              {selectedMemberIds.includes(member.id) && <Plus className="w-3 h-3 rotate-45" />}
                            </button>
                          ))}
                        </div>
                      </div>

                      {splitMode === 'custom' && selectedMemberIds.length > 0 && (
                        <div className="space-y-2">
                          <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mt-4 mb-2">Rozpis částek</label>
                          {debtMembers.map((dm, idx) => (
                            <div key={dm.memberId} className="flex items-center gap-2 bg-indigo-50/50 p-2 rounded-xl border border-indigo-100">
                              <span className="flex-1 text-[10px] font-black uppercase text-indigo-700 truncate">{dm.memberName}</span>
                              <div className="relative w-24">
                                <input
                                  type="number"
                                  className="w-full bg-white border border-indigo-200 rounded-lg p-1.5 text-xs font-bold text-indigo-600 pr-5 focus:outline-none"
                                  value={dm.amount}
                                  onChange={(e) => {
                                    const newDebt = [...debtMembers];
                                    newDebt[idx].amount = e.target.value;
                                    setDebtMembers(newDebt);
                                    
                                    // Update total amount
                                    const totalDebt = newDebt.reduce((sum, d) => sum + (parseFloat(d.amount) || 0), 0);
                                    const portion = parseFloat(cashboxPortion) || 0;
                                    setAmount((totalDebt + portion).toString());
                                  }}
                                />
                                <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-indigo-300">{getCurrencySymbol(group.currency)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {isSummary && (
                  <div className="space-y-3 bg-slate-50 p-4 rounded-[2rem] border border-slate-100">
                    <div className="flex justify-between items-center mb-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted">Položky výdaje</label>
                      <button
                        onClick={() => setSubItems([...subItems, { amount: '', fromWho: '', note: '' }])}
                        className="p-1.5 bg-white rounded-lg text-bento-accent hover:bg-slate-100 shadow-sm transition-all"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="space-y-3">
                      {subItems.map((item, idx) => (
                        <div key={idx} className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm space-y-2 relative">
                          <button
                            onClick={() => {
                              const newItems = subItems.filter((_, i) => i !== idx);
                              setSubItems(newItems);
                              const total = newItems.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
                              setAmount(total.toString());
                            }}
                            className="absolute -top-2 -right-2 w-6 h-6 bg-rose-50 text-rose-500 rounded-full flex items-center justify-center hover:bg-rose-100 border border-rose-100 shadow-sm z-10"
                          >
                            <X className="w-3 h-3" />
                          </button>
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              type="number"
                              placeholder="Částka"
                              className="w-full bg-slate-50 border-0 font-bold text-xs focus:outline-none p-2 rounded-lg"
                              value={item.amount}
                              onChange={(e) => {
                                const newItems = [...subItems];
                                newItems[idx].amount = e.target.value;
                                setSubItems(newItems);
                                const total = newItems.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
                                setAmount(total.toString());
                              }}
                            />
                            <input
                              type="text"
                              placeholder="Účel / Komu"
                              className="w-full bg-slate-50 border-0 font-bold text-xs focus:outline-none p-2 rounded-lg"
                              value={item.fromWho}
                              onChange={(e) => {
                                const newItems = [...subItems];
                                newItems[idx].fromWho = e.target.value;
                                setSubItems(newItems);
                              }}
                            />
                          </div>
                          <input
                            type="text"
                            placeholder="Popis položky..."
                            className="w-full bg-slate-50 border-0 font-medium text-xs focus:outline-none p-2 rounded-lg"
                            value={item.note}
                            onChange={(e) => {
                              const newItems = [...subItems];
                              newItems[idx].note = e.target.value;
                              setSubItems(newItems);
                            }}
                          />
                        </div>
                      ))}
                      {subItems.length === 0 && (
                        <p className="text-[10px] text-center text-slate-400 py-4 italic">Přidejte položky souhrnného výdaje</p>
                      )}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100">
                    <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-1">Datum</label>
                    <input
                      type="date"
                      className="w-full bg-transparent border-0 font-bold text-xs focus:outline-none text-bento-text-main p-0"
                      value={transDate}
                      onChange={(e) => setTransDate(e.target.value)}
                    />
                  </div>
                  <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100">
                    <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-1">Kategorie</label>
                    <select 
                      className="w-full bg-transparent border-0 font-bold text-xs focus:outline-none text-bento-text-main p-0 appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2024%2024%22%20stroke%3D%22currentColor%22%3E%3Cpath%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%222%22%20d%3D%22M19%209l-7%207-7-7%22%2F%3E%3C%2Fsvg%3E')] bg-[length:0.75em_0.75em] bg-[right_center] bg-no-repeat pr-4"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                    >
                      <option value="">Vyberte</option>
                      {(editingTransaction ? editingTransaction.type === 'income' : isAddingIncome) 
                        ? incomeCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)
                        : expenseCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)
                      }
                    </select>
                  </div>
                </div>

                <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100">
                  <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-1">
                    {(editingTransaction ? editingTransaction.type === 'income' : isAddingIncome) ? 'Původ / Kdo' : 'Účel / Komu'}
                  </label>
                  <input
                    type="text"
                    className="w-full bg-transparent border-0 font-bold text-xs focus:outline-none text-bento-text-main p-0"
                    placeholder={(editingTransaction ? editingTransaction.type === 'income' : isAddingIncome) ? 'Jméno plátce nebo zdroj...' : 'Účel výdaje'}
                    value={fromWho}
                    onChange={(e) => setFromWho(e.target.value)}
                  />
                </div>

                <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100">
                  <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-1">Popis transakce</label>
                  <textarea
                    className="w-full bg-transparent border-0 font-medium text-xs focus:outline-none text-bento-text-main p-0 h-16 resize-none"
                    placeholder="Důvod transakce..."
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>

                <button
                  onClick={() => handleSubmit(editingTransaction ? editingTransaction.type : (isAddingIncome ? 'income' : 'expense'))}
                  disabled={!amount}
                  className={cn(
                    "w-full py-4 rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] shadow-xl transition-all disabled:opacity-40 text-white",
                    (editingTransaction ? editingTransaction.type === 'income' : isAddingIncome) ? "bg-emerald-600 shadow-emerald-500/10" : "bg-rose-600 shadow-rose-500/10"
                  )}
                >
                  <Save className="w-4 h-4 ml-0 mr-2 inline" />
                  {editingTransaction ? 'Uložit změny' : 'Potvrdit zápis'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Detail Modal */}
      <AnimatePresence>
        {viewingTransaction && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md flex items-center justify-center p-4 z-50">
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl border border-bento-card-border max-h-[90vh] flex flex-col"
            >
              <div className="flex justify-between items-center mb-6 shrink-0">
                <div>
                  <h2 className="text-xl font-bold text-bento-text-main tracking-tight">Detail transakce</h2>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-bento-accent">Přehled záznamu</p>
                </div>
                <button onClick={() => setViewingTransaction(null)} className="p-2 text-bento-text-muted hover:bg-slate-50 rounded-xl transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4 overflow-y-auto flex-1 pr-2 custom-scrollbar mb-6">
                <div className={cn(
                  "p-4 rounded-2xl flex flex-col items-center justify-center gap-1",
                  viewingTransaction.amount > 0 ? "bg-emerald-50" : "bg-rose-50"
                )}>
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center",
                    viewingTransaction.amount > 0 ? "bg-emerald-100 text-emerald-600" : "bg-rose-100 text-rose-600"
                  )}>
                    {viewingTransaction.amount > 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                  </div>
                  <span className={cn(
                    "text-2xl font-black tracking-tighter",
                    viewingTransaction.amount > 0 ? "text-emerald-600" : "text-rose-600"
                  )}>
                    {viewingTransaction.amount > 0 ? '+' : ''}{formatCurrency(viewingTransaction.amount, group.currency)}
                  </span>
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between items-center py-2 border-b border-bento-card-border">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-bento-text-muted">Popis</span>
                    <span className="text-xs font-bold text-bento-text-main text-right ml-4">{viewingTransaction.note}</span>
                  </div>
                  {viewingTransaction.category && (
                    <div className="flex justify-between items-center py-2 border-b border-bento-card-border">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-bento-text-muted">Kategorie</span>
                      <span className="text-xs font-bold text-slate-600">{viewingTransaction.category}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center py-2 border-b border-bento-card-border">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-bento-text-muted">
                      {viewingTransaction.amount > 0 ? 'Původ / Kdo' : 'Účel / Komu'}
                    </span>
                    <span className="text-xs font-bold text-bento-accent">{viewingTransaction.fromWho || '—'}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-bento-card-border">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-bento-text-muted">Datum</span>
                    <span className="text-xs font-bold text-bento-text-main">{formatDate(viewingTransaction.createdAt)}</span>
                  </div>
                  <div className="flex justify-between items-center py-3 border-b border-bento-card-border">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-bento-text-muted">Typ</span>
                    <span className="text-[10px] font-black uppercase tracking-widest px-2 py-1 bg-slate-100 rounded-md">
                      {viewingTransaction.isDebtExpense ? 'Výdaj na dluh' : (viewingTransaction.isSummary ? 'Souhrnný výdaj' : (viewingTransaction.type === 'income' ? 'Příjem' : 'Výdaj'))}
                    </span>
                  </div>
                  {viewingTransaction.isDebtExpense && (
                    <div className="pt-4 animate-in fade-in slide-in-from-top-2">
                       <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-3 text-center">Rozpis dluhů</label>
                       <div className="space-y-2">
                          {viewingTransaction.cashboxPortion !== undefined && (viewingTransaction.cashboxPortion !== null) && viewingTransaction.cashboxPortion > 0 && (
                            <div className="bg-slate-100/50 p-3 rounded-2xl border border-slate-200">
                               <div className="flex justify-between items-center mb-1">
                                  <span className="text-xs font-black text-slate-600 italic">Příspěvek z kasy</span>
                                  <span className="text-xs font-black text-slate-600">{formatCurrency(viewingTransaction.cashboxPortion, group.currency)}</span>
                               </div>
                            </div>
                          )}
                          {viewingTransaction.debtDetails?.map((debt, idx) => (
                            <div key={idx} className="bg-indigo-50 p-3 rounded-2xl border border-indigo-100">
                              <div className="flex justify-between items-center mb-1">
                                <span className="text-xs font-black text-indigo-700">{debt.memberName}</span>
                                <span className="text-xs font-black text-indigo-600">{formatCurrency(debt.amount, group.currency)}</span>
                              </div>
                              <div className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">Převedeno do pokut</div>
                            </div>
                          ))}
                       </div>
                    </div>
                  )}
                  {viewingTransaction.isSummary && viewingTransaction.subItems && (
                    <div className="pt-4 animate-in fade-in slide-in-from-top-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-3 text-center">Rozpis položek</label>
                      <div className="space-y-2">
                        {viewingTransaction.subItems.map((item, idx) => (
                          <div key={idx} className="bg-slate-50 p-3 rounded-2xl border border-bento-card-border/50">
                            <div className="flex justify-between items-center mb-1">
                              <span className="text-xs font-black text-bento-text-main">{item.note}</span>
                              <span className="text-xs font-black text-rose-600">{formatCurrency(item.amount, group.currency)}</span>
                            </div>
                            <div className="text-[10px] font-bold text-bento-accent uppercase tracking-widest">
                              {viewingTransaction.amount > 0 ? 'Původ / Kdo' : 'Účel / Komu'}: {item.fromWho}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {!isReadOnly && (
                  <div className="grid grid-cols-2 gap-3 pt-6 border-t border-bento-card-border shrink-0">
                    <button
                      onClick={() => {
                        setEditingTransaction(viewingTransaction);
                        setViewingTransaction(null);
                      }}
                      className="flex-1 btn-bento-secondary py-3 text-xs font-bold"
                    >
                      <Edit2 className="w-4 h-4" />
                      Upravit
                    </button>
                    <button
                      onClick={() => setDeleteConfirmId(viewingTransaction.id)}
                      className="flex-1 bg-rose-50 text-rose-600 py-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 hover:bg-rose-100 transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                      Smazat
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {deleteConfirmId && (
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
              <h3 className="text-xl font-bold text-bento-text-main mb-2">Opravdu smazat?</h3>
              <p className="text-sm text-bento-text-muted mb-8">Tuto akci nelze vzít zpět. Transakce bude trvale odstraněna z historie.</p>
              
              {error && <p className="text-xs font-bold text-rose-500 mb-4">{error}</p>}

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => {
                    setDeleteConfirmId(null);
                    setError(null);
                  }}
                  disabled={isDeleting}
                  className="btn-bento-secondary py-3 text-xs font-bold"
                >
                  Zrušit
                </button>
                <button
                  onClick={() => handleDelete(deleteConfirmId)}
                  disabled={isDeleting}
                  className="bg-rose-600 text-white py-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 hover:bg-rose-700 transition-all shadow-lg shadow-rose-500/20 disabled:opacity-50"
                >
                  {isDeleting ? 'Mažu...' : 'Ano, smazat'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
