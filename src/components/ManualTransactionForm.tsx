import { useState, useEffect } from 'react';
import { collection, addDoc, query, orderBy, onSnapshot, writeBatch, doc, getDocs, where } from 'firebase/firestore';
import { db } from '../firebase';
import { Group, Period, OperationType, Member } from '../types';
import { handleFirestoreError, getCurrencySymbol, cn, reconcileOverpaymentsForMember } from '../utils';
import { Calendar, Save, X, Plus, Users } from 'lucide-react';

interface ManualTransactionFormProps {
  group: Group;
  period: Period;
  type: 'income' | 'expense';
  onSuccess: () => void;
  onCancel: () => void;
}

export default function ManualTransactionForm({ group, period, type, onSuccess, onCancel }: ManualTransactionFormProps) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [category, setCategory] = useState('');
  const [fromWho, setFromWho] = useState('');
  const [transDate, setTransDate] = useState(new Date().toISOString().split('T')[0]);
  const [accountType, setAccountType] = useState<'cash' | 'bank'>('cash');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);

  // Added specialized state
  const [isSummary, setIsSummary] = useState(false);
  const [subItems, setSubItems] = useState<{ amount: string; fromWho: string; note: string }[]>([]);
  const [isDebtExpense, setIsDebtExpense] = useState(false);
  const [debtMembers, setDebtMembers] = useState<{ memberId: string; amount: string; memberName: string }[]>([]);
  const [cashboxPortion, setCashboxPortion] = useState('0');
  const [splitMode, setSplitMode] = useState<'equal' | 'custom'>('equal');
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [perMemberAmount, setPerMemberAmount] = useState('0');

  useEffect(() => {
    // Fetch members for debt expense
    const membersPath = `groups/${group.id}/periods/${period.id}/members`;
    const membersQuery = query(collection(db, membersPath), orderBy('name'));
    const unsubscribeMembers = onSnapshot(membersQuery, (snapshot) => {
      setMembers(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })) as Member[]);
    });

    return () => unsubscribeMembers();
  }, [group.id, period.id]);

  const incomeCategories = ['Zůstatek', 'Pokuta', 'Sponzor', 'Příspěvek', 'Jiné'];
  const expenseCategories = ['Akce', 'Nákup', 'Služby', 'Cestovné', 'Občerstvení', 'Jiné'];
  const categories = type === 'income' ? incomeCategories : expenseCategories;

  const handleSubmit = async () => {
    if (!amount) return;
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) return;

    setIsSubmitting(true);
    try {
      const getFallbackNote = () => {
        if (isSummary) return 'Souhrnný výdaj';
        if (isDebtExpense) return 'Výdaj na dluh';
        return type === 'income' ? 'Příjem' : 'Výdaj';
      };
      
      const finalNote = note || getFallbackNote();
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
      
      const batch = writeBatch(db);
      const transRef = doc(collection(db, transactionsPath));
      
      const transactionData = {
        amount: finalAmount,
        type: type,
        source: type === 'expense' ? 'expense' : 'external_income',
        note: finalNote,
        category: category || null,
        fromWho: fromWho || null,
        periodId: period.id,
        createdAt: createdAt,
        isSummary: isSummary,
        isDebtExpense: isDebtExpense,
        subItems: processedSubItems,
        debtDetails: processedDebtDetails,
        cashboxPortion: isDebtExpense ? parseFloat(cashboxPortion) || 0 : null,
        paymentMethod: accountType,
        account: accountType
      };

      batch.set(transRef, transactionData);

      // Add fines if it's a debt expense
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
              createdAt: createdAt,
              transactionId: transRef.id
            });
          }
        });
      }

      await batch.commit();

      if (isDebtExpense && processedDebtDetails) {
        for (const debt of processedDebtDetails) {
          if (debt.amount > 0) {
            await reconcileOverpaymentsForMember(db, group.id, period.id, debt.memberId);
          }
        }
      }

      onSuccess();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'transactions');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-3 max-w-md mx-auto max-h-[85vh] overflow-y-auto px-1 custom-scrollbar">
      {type === 'expense' && (
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
        <div className="relative">
          <input
            type="number"
            className="w-full bg-transparent border-0 font-black text-4xl focus:outline-none text-bento-text-main p-0"
            placeholder="0"
            value={amount}
            readOnly={isSummary || isDebtExpense}
            onChange={(e) => setAmount(e.target.value)}
          />
          <span className="absolute right-0 top-1/2 -translate-y-1/2 font-black text-slate-300 text-2xl tracking-tighter">{getCurrencySymbol(group.currency)}</span>
        </div>
      </div>

      <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 mb-2">
        <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-1.5">Účet / Způsob platby</label>
        <div className="flex bg-white p-1 rounded-xl border border-slate-200">
          <button
            type="button"
            onClick={() => setAccountType('cash')}
            className={cn(
              "flex-1 py-2 rounded-lg font-bold text-xs transition-all flex items-center justify-center gap-1.5",
              accountType === 'cash' ? "bg-amber-500 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
            )}
          >
            💵 Hotovost
          </button>
          <button
            type="button"
            onClick={() => setAccountType('bank')}
            className={cn(
              "flex-1 py-2 rounded-lg font-bold text-xs transition-all flex items-center justify-center gap-1.5",
              accountType === 'bank' ? "bg-indigo-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
            )}
          >
            🏦 Na účet
          </button>
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
            {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
          </select>
        </div>
      </div>

      <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100">
        <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-1">
          {type === 'income' ? 'Původ / Kdo' : 'Účel / Komu'}
        </label>
        <input
          type="text"
          className="w-full bg-transparent border-0 font-bold text-xs focus:outline-none text-bento-text-main p-0"
          placeholder={type === 'income' ? 'Jméno plátce nebo zdroj...' : 'Účel výdaje'}
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

      <div className="flex gap-3 pt-3">
        <button
          onClick={onCancel}
          className="flex-1 py-4 bg-slate-100 text-slate-500 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-200 transition-all"
        >
          Zrušit
        </button>
        <button
          onClick={handleSubmit}
          disabled={!amount || isSubmitting}
          className={cn(
            "flex-[2] py-4 rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] shadow-xl transition-all disabled:opacity-40 text-white",
            type === 'income' ? "bg-emerald-600 shadow-emerald-500/10" : "bg-rose-600 shadow-rose-500/10"
          )}
        >
          {isSubmitting ? 'Zapisuji...' : 'Potvrdit zápis'}
        </button>
      </div>
    </div>
  );
}
