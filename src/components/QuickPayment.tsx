import { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, doc, query, where, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Group, Period, Member, Fine, Payment, OperationType } from '../types';
import { handleFirestoreError, formatCurrency, getCurrencySymbol, cn, reconcileOverpaymentsForMember } from '../utils';
import { Search, ChevronRight, CreditCard, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface QuickPaymentProps {
  group: Group;
  period: Period;
  onSuccess: () => void;
  onCancel: () => void;
}

export default function QuickPayment({ group, period, onSuccess, onCancel }: QuickPaymentProps) {
  const [members, setMembers] = useState<Member[]>([]);
  const [fines, setFines] = useState<Fine[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'cash' | 'bank'>('cash');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const membersPath = `groups/${group.id}/periods/${period.id}/members`;
    const finesPath = `groups/${group.id}/periods/${period.id}/fines`;

    const unsubMembers = onSnapshot(collection(db, membersPath), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Member[];
      const unique = data.filter((v, i, a) => a.findIndex(t => t.id === v.id) === i);
      console.log(`[QuickPayment] Fetched ${unique.length} members`);
      setMembers(unique);
    }, (error) => {
      console.error('[QuickPayment] Members snapshot error:', error);
      handleFirestoreError(error, OperationType.LIST, membersPath);
    });

    const unsubFines = onSnapshot(collection(db, finesPath), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Fine[];
      const unique = data.filter((v, i, a) => a.findIndex(t => t.id === v.id) === i);
      console.log(`[QuickPayment] Fetched ${unique.length} fines`);
      setFines(unique);
    }, (error) => {
      console.error('[QuickPayment] Fines snapshot error:', error);
      handleFirestoreError(error, OperationType.LIST, finesPath);
    });

    return () => {
      unsubMembers();
      unsubFines();
    };
  }, [group.id, period.id]);

  const getMemberDebt = (memberId: string) => {
    return fines
      .filter(f => f.memberId === memberId && !f.paid)
      .reduce((sum, f) => sum + (f.amount - (f.paidAmount || 0)), 0);
  };

  const debtors = members
    .filter(m => getMemberDebt(m.id) > 0)
    .filter(m => m.name.toLowerCase().includes(searchTerm.toLowerCase()))
    .sort((a, b) => getMemberDebt(b.id) - getMemberDebt(a.id));

  const handlePayment = async () => {
    if (!selectedMember || !amount) return;
    const paymentAmount = parseFloat(amount);
    if (isNaN(paymentAmount) || paymentAmount <= 0) return;

    setIsSubmitting(true);
    // Merge selected date with current time to preserve record order within a day
    const now = new Date();
    const selectedDate = new Date(date);
    selectedDate.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
    const timestamp = isNaN(selectedDate.getTime()) ? Date.now() : selectedDate.getTime();
    
    try {
      const paymentRef = doc(collection(db, `groups/${group.id}/periods/${period.id}/payments`));
      const transactionRef = doc(collection(db, `groups/${group.id}/periods/${period.id}/transactions`));

      const paymentData = {
        memberId: selectedMember.id,
        amount: paymentAmount,
        paymentMethod: method,
        periodId: period.id,
        createdAt: timestamp,
        note: `Rychlá platba`,
        transactionId: transactionRef.id
      };

      // 1. Create payment record
      await setDoc(paymentRef, paymentData);

      // 2. Create cashbox transaction
      await setDoc(transactionRef, {
        amount: paymentAmount,
        type: 'income',
        source: 'fine_payment',
        category: 'Pokuta',
        note: `Platba pokuty: ${selectedMember.name}`,
        periodId: period.id,
        createdAt: timestamp,
        fromWho: selectedMember.name,
        paymentId: paymentRef.id,
        paymentMethod: method,
        account: method === 'bank' ? 'bank' : 'cash'
      });

      // 3. Mark fines as paid (greedily)
      let remaining = paymentAmount;
      const unpaidFines = fines
        .filter(f => f.memberId === selectedMember.id && !f.paid && !(f.type === 'in_kind' || f.isInKind))
        .sort((a, b) => {
          const isPartialA = (a.paidAmount || 0) > 0;
          const isPartialB = (b.paidAmount || 0) > 0;
          if (isPartialA && !isPartialB) return -1;
          if (!isPartialA && isPartialB) return 1;
          return a.createdAt - b.createdAt;
        });

      const finesPath = `groups/${group.id}/periods/${period.id}/fines`;
      for (const fine of unpaidFines) {
        if (remaining <= 0) break;
        
        const currentPaid = fine.paidAmount || 0;
        const needed = fine.amount - currentPaid;

        if (remaining >= needed) {
          await updateDoc(doc(db, finesPath, fine.id), { 
            paidAmount: fine.amount,
            paid: true 
          });
          remaining -= needed;
        } else {
          await updateDoc(doc(db, finesPath, fine.id), { 
            paidAmount: currentPaid + remaining,
            paid: false 
          });
          remaining = 0;
        }
      }

      await reconcileOverpaymentsForMember(db, group.id, period.id, selectedMember.id);

      onSuccess();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'payments');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-lg mx-auto">
      {!selectedMember ? (
        <>
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Hledat dlužníka..."
              className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 font-medium"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
            {debtors.length > 0 ? (
              debtors.map(member => (
                <button
                  key={member.id}
                  onClick={() => {
                    setSelectedMember(member);
                    setAmount(getMemberDebt(member.id).toString());
                  }}
                  className="w-full flex justify-between items-center p-4 bg-white border border-slate-100 rounded-2xl hover:border-blue-500/30 hover:shadow-lg hover:shadow-blue-500/5 transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400 group-hover:bg-blue-50 group-hover:text-blue-500 transition-colors">
                      <CreditCard className="w-5 h-5" />
                    </div>
                    <span className="font-bold text-sm text-slate-900">{member.name}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="font-black text-sm text-rose-600">{formatCurrency(getMemberDebt(member.id), group.currency)}</span>
                    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-blue-500 translate-x-0 group-hover:translate-x-1 transition-all" />
                  </div>
                </button>
              ))
            ) : (
              <div className="text-center py-12 text-slate-300">
                <CheckCircle2 className="w-12 h-12 mx-auto mb-3 opacity-20" />
                <p className="text-xs font-bold uppercase tracking-widest">Žádní dlužníci</p>
              </div>
            )}
          </div>
        </>
      ) : (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="space-y-6"
        >
          <div className="p-4 bg-blue-50/50 border border-blue-100 rounded-2xl flex justify-between items-center">
            <div>
              <p className="text-[10px] font-black uppercase text-blue-400 mb-1">Vybraný člen</p>
              <h4 className="font-black text-blue-900">{selectedMember.name}</h4>
            </div>
            <button 
              onClick={() => setSelectedMember(null)}
              className="text-[10px] font-black uppercase text-blue-600 hover:underline"
            >
              Změnit
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-2">Částka k zaplacení ({getCurrencySymbol(group.currency)})</label>
              <div className="relative">
                <input
                  type="number"
                  autoFocus
                  className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-black text-3xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                <span className="absolute right-5 top-1/2 -translate-y-1/2 font-black text-slate-400 text-xl">{getCurrencySymbol(group.currency)}</span>
              </div>
              <p className="text-[10px] text-slate-400 mt-2 font-bold italic">Dluh člena: {formatCurrency(getMemberDebt(selectedMember.id), group.currency)}</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setMethod('cash')}
                className={cn(
                  "p-4 rounded-2xl border-2 font-bold text-xs transition-all",
                  method === 'cash' ? "border-blue-600 bg-blue-50 text-blue-600 shadow-lg shadow-blue-500/10" : "border-slate-100 text-slate-400 hover:border-slate-200"
                )}
              >
                Hotově
              </button>
              <button
                onClick={() => setMethod('bank')}
                className={cn(
                  "p-4 rounded-2xl border-2 font-bold text-xs transition-all",
                  method === 'bank' ? "border-blue-600 bg-blue-50 text-blue-600 shadow-lg shadow-blue-500/10" : "border-slate-100 text-slate-400 hover:border-slate-200"
                )}
              >
                Na účet
              </button>
            </div>

            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-2">Datum platby</label>
              <input
                type="date"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 text-slate-900"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>

            <div className="flex gap-3 pt-4">
              <button
                onClick={onCancel}
                className="flex-1 py-4 bg-slate-100 text-slate-500 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-200"
              >
                Zrušit
              </button>
              <button
                onClick={handlePayment}
                disabled={!amount || isSubmitting}
                className="flex-[2] py-4 bg-blue-600 text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl shadow-blue-500/20 disabled:opacity-50"
              >
                {isSubmitting ? 'Zapisuji...' : 'Zapsat platbu'}
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
