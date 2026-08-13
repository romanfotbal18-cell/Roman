import { useState, useEffect, useMemo } from 'react';
import { collection, query, onSnapshot, doc, writeBatch, addDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Group, Period, Member, FineTemplate, OperationType, MemberGroup, RecurringFine } from '../types';
import { handleFirestoreError, getCurrencySymbol, cn, getUserRole, reconcileOverpaymentsForMember, checkAndExecuteRecurringFines } from '../utils';
import { Users, ReceiptText, CheckCircle2, ChevronRight, X, AlertCircle, Plus, Hash, Loader2, Layers, ChevronDown, Eye, Zap, Repeat, Play, Pause, Trash2, Edit2, CalendarDays } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface RecordFineProps {
  group: Group;
  period: Period;
  onSuccess?: () => void;
}

export default function RecordFine({ group, period, onSuccess }: RecordFineProps) {
  const userRole = getUserRole(group, auth.currentUser?.email, auth.currentUser?.uid);
  const isReadOnly = userRole === 'viewer';

  const [members, setMembers] = useState<Member[]>([]);
  const [templates, setTemplates] = useState<FineTemplate[]>([]);
  const [memberGroups, setMemberGroups] = useState<MemberGroup[]>([]);
  const [recurringFines, setRecurringFines] = useState<RecurringFine[]>([]);

  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [showAllGroups, setShowAllGroups] = useState(false);

  // Tab mode for fine recording
  const [fineTab, setFineTab] = useState<'template' | 'custom' | 'recurring'>('template');
  const [recurringSubTab, setRecurringSubTab] = useState<'create' | 'list'>('create');

  // One-time fine state
  const [selectedTemplate, setSelectedTemplate] = useState<FineTemplate | null>(null);
  const [customReason, setCustomReason] = useState('');
  const [customAmount, setCustomAmount] = useState('');
  const [customIsInKind, setCustomIsInKind] = useState(false);
  const [dynamicValue, setDynamicValue] = useState('');
  const [fineCount, setFineCount] = useState(1);

  // Recurring fine form state
  const [recurringSource, setRecurringSource] = useState<'template' | 'custom'>('template');
  const [recurringSelectedTemplate, setRecurringSelectedTemplate] = useState<FineTemplate | null>(null);
  const [recurringCustomReason, setRecurringCustomReason] = useState('');
  const [recurringCustomAmount, setRecurringCustomAmount] = useState('');
  const [recurringInterval, setRecurringInterval] = useState<'monthly' | 'weekly' | 'quarterly' | 'yearly' | 'custom_days'>('monthly');
  const [recurringIntervalDays, setRecurringIntervalDays] = useState('14');
  const [recurringStartDate, setRecurringStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [recurringDurationType, setRecurringDurationType] = useState<'indefinite' | 'until_date' | 'max_occurrences'>('indefinite');
  const [recurringEndDate, setRecurringEndDate] = useState('');
  const [recurringOccurrencesLimit, setRecurringOccurrencesLimit] = useState('6');
  const [recurringNote, setRecurringNote] = useState('');
  const [editingRecurringFineId, setEditingRecurringFineId] = useState<string | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [templateSearchQuery, setTemplateSearchQuery] = useState('');
  const [memberSortOption, setMemberSortOption] = useState<'name' | 'age-asc' | 'age-desc'>('name');
  const [recordedNotice, setRecordedNotice] = useState<string | null>(null);

  const formatMemberAgeAndBirth = (birthDate?: string) => {
    if (!birthDate) return null;
    const birth = new Date(birthDate);
    if (isNaN(birth.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const mDiff = today.getMonth() - birth.getMonth();
    if (mDiff < 0 || (mDiff === 0 && today.getDate() < birth.getDate())) {
      age--;
    }
    const formattedDate = birth.toLocaleDateString('cs-CZ');
    return `${age} let (${formattedDate})`;
  };

  useEffect(() => {
    // Check and execute pending automatic fines on load
    checkAndExecuteRecurringFines(db, group.id, period.id);

    const membersPath = `groups/${group.id}/periods/${period.id}/members`;
    const templatesPath = `groups/${group.id}/periods/${period.id}/fineTemplates`;
    const rfPath = `groups/${group.id}/periods/${period.id}/recurringFines`;

    const unsubMembers = onSnapshot(collection(db, membersPath), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Member[];
      const unique = data.filter((v, i, a) => a.findIndex(t => t.id === v.id) === i);
      setMembers(unique);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, membersPath);
    });

    const unsubTemplates = onSnapshot(collection(db, templatesPath), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as FineTemplate[];
      const unique = data.filter((v, i, a) => a.findIndex(t => t.id === v.id) === i);
      setTemplates(unique.sort((a, b) => (a.order || 0) - (b.order || 0)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, templatesPath);
    });

    const unsubMemberGroups = onSnapshot(collection(db, `groups/${group.id}/periods/${period.id}/memberGroups`), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as MemberGroup[];
      setMemberGroups(data.sort((a, b) => (a.order || 0) - (b.order || 0)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `groups/${group.id}/periods/${period.id}/memberGroups`);
    });

    const unsubRecurring = onSnapshot(collection(db, rfPath), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as RecurringFine[];
      setRecurringFines(data.sort((a, b) => b.createdAt - a.createdAt));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, rfPath);
    });

    return () => {
      unsubMembers();
      unsubTemplates();
      unsubMemberGroups();
      unsubRecurring();
    };
  }, [group.id, period.id]);

  const activeMembers = useMemo(() => members.filter(m => m.active), [members]);

  const filteredMembers = useMemo(() => {
    let list = [...activeMembers];

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      list = list.filter(m =>
        m.name.toLowerCase().includes(query) ||
        (m.position && m.position.toLowerCase().includes(query))
      );
    }

    list.sort((a, b) => {
      if (memberSortOption === 'name') {
        return a.name.localeCompare(b.name, 'cs');
      }
      if (memberSortOption === 'age-asc') {
        const dateA = a.birthDate ? new Date(a.birthDate).getTime() : -Infinity;
        const dateB = b.birthDate ? new Date(b.birthDate).getTime() : -Infinity;
        if (dateA === dateB) return a.name.localeCompare(b.name, 'cs');
        return dateB - dateA;
      }
      if (memberSortOption === 'age-desc') {
        const dateA = a.birthDate ? new Date(a.birthDate).getTime() : Infinity;
        const dateB = b.birthDate ? new Date(b.birthDate).getTime() : Infinity;
        if (dateA === dateB) return a.name.localeCompare(b.name, 'cs');
        return dateA - dateB;
      }
      return 0;
    });

    return list;
  }, [activeMembers, searchQuery, memberSortOption]);

  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return memberGroups;
    const query = searchQuery.toLowerCase().trim();
    return memberGroups.filter(g => g.name.toLowerCase().includes(query));
  }, [memberGroups, searchQuery]);

  const filteredTemplates = useMemo(() => {
    let result = [...templates];
    if (templateSearchQuery.trim()) {
      const q = templateSearchQuery.toLowerCase().trim();
      result = result.filter(t => t.name.toLowerCase().includes(q));
    }
    return result;
  }, [templates, templateSearchQuery]);

  const toggleMember = (id: string) => {
    setSelectedMemberIds(prev => 
      prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]
    );
  };

  const handleGroupSelection = (mg: MemberGroup) => {
    const rawMemberIds = Array.isArray(mg.memberIds) ? mg.memberIds : [];
    const groupIdsStrings = rawMemberIds
      .filter(id => id !== null && id !== undefined && (typeof id === 'string' || typeof id === 'number'))
      .map(id => String(id).trim().toLowerCase());
    
    if (groupIdsStrings.length === 0) return;

    const availableIds = activeMembers
      .filter(m => {
        const mid = String(m.id).trim().toLowerCase();
        return groupIdsStrings.includes(mid);
      })
      .map(m => m.id);
    
    if (availableIds.length === 0) return;

    const allInGroupSelected = availableIds.every(id => selectedMemberIds.includes(id));

    if (allInGroupSelected) {
      setSelectedMemberIds(prev => prev.filter(id => !availableIds.includes(id)));
      setActiveGroupId(null);
    } else {
      setSelectedMemberIds(prev => {
        const next = new Set([...prev, ...availableIds]);
        return Array.from(next);
      });
      setActiveGroupId(mg.id);
    }
  };

  const calculateAmount = () => {
    if (fineTab === 'custom') return customIsInKind ? 0 : (parseFloat(customAmount) || 0) * fineCount;
    if (fineTab === 'template') {
      if (!selectedTemplate) return 0;
      if (selectedTemplate.type === 'in_kind') return 0;
      if (selectedTemplate.type === 'dynamic') {
        const val = parseFloat(dynamicValue) || 0;
        return val * selectedTemplate.amount;
      }
      return selectedTemplate.amount * fineCount;
    }
    return 0;
  };

  const isCurrentInKind = (fineTab === 'custom' && customIsInKind) || (fineTab === 'template' && selectedTemplate?.type === 'in_kind');
  const isValidSelection = isCurrentInKind
    ? (fineTab === 'custom' ? customReason.trim().length > 0 : !!selectedTemplate)
    : (calculateAmount() > 0 && (fineTab === 'custom' ? customReason.trim().length > 0 : !!selectedTemplate));

  const handleRecord = async () => {
    if (selectedMemberIds.length === 0 || isSubmitting) return;
    
    const amount = calculateAmount();
    let reason = '';
    let q = 1;
    let up = 0;
    let u = '';
    let isInKind = false;
    let fineType: 'fixed' | 'dynamic' | 'in_kind' = 'fixed';
    
    if (fineTab === 'custom') {
      if (customIsInKind) {
        isInKind = true;
        fineType = 'in_kind';
        reason = customReason;
        q = fineCount;
        u = customReason;
      } else {
        reason = fineCount > 1 ? `${customReason} ${fineCount}x` : customReason;
        q = fineCount;
        up = parseFloat(customAmount) || 0;
      }
    } else if (fineTab === 'template' && selectedTemplate) {
      if (selectedTemplate.type === 'in_kind') {
        isInKind = true;
        fineType = 'in_kind';
        const templateQty = selectedTemplate.quantity || 1;
        const totalQty = templateQty * fineCount;
        const itemName = selectedTemplate.itemOrTask || selectedTemplate.unit || selectedTemplate.name;
        reason = selectedTemplate.name;
        q = totalQty;
        u = itemName;
      } else if (selectedTemplate.type === 'dynamic') {
        fineType = 'dynamic';
        reason = `${selectedTemplate.name} (${dynamicValue} ${selectedTemplate.unit})`;
        q = parseFloat(dynamicValue) || 0;
        up = selectedTemplate.amount;
        u = selectedTemplate.unit || '';
      } else {
        fineType = 'fixed';
        reason = fineCount > 1 ? `${selectedTemplate.name} ${fineCount}x` : selectedTemplate.name;
        q = fineCount;
        up = selectedTemplate.amount;
      }
    }

    if (!reason || (!isInKind && amount <= 0)) return;

    setIsSubmitting(true);
    try {
      const batch = writeBatch(db);
      const timestamp = Date.now();

      selectedMemberIds.forEach(memberId => {
        const fineRef = doc(collection(db, `groups/${group.id}/periods/${period.id}/fines`));
        batch.set(fineRef, {
          memberId,
          reason,
          amount: isInKind ? 0 : amount,
          paidAmount: 0,
          paid: false,
          periodId: period.id,
          createdAt: timestamp,
          templateId: selectedTemplate?.id || null,
          quantity: q,
          unitPrice: up,
          unit: u,
          type: fineType,
          isInKind: isInKind,
          itemOrTask: u
        });
      });

      await batch.commit();

      for (const memberId of selectedMemberIds) {
        await reconcileOverpaymentsForMember(db, group.id, period.id, memberId);
      }

      // Keep members selected after recording fine as requested by user
      const count = selectedMemberIds.length;
      setRecordedNotice(`Pokuta byla úspěšně zapsána pro ${count} ${count === 1 ? 'člena' : (count >= 2 && count <= 4 ? 'členy' : 'členů')}! Členové zůstávají označeni.`);
      setTimeout(() => setRecordedNotice(null), 5000);

      setSelectedTemplate(null);
      setCustomReason('');
      setCustomAmount('');
      setDynamicValue('');
      setFineCount(1);
      setTemplateSearchQuery('');
      onSuccess?.();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'fines');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveRecurringFine = async () => {
    if (isSubmitting) return;

    if (selectedMemberIds.length === 0) {
      alert('Vyberte prosím alespoň jednoho hříšníka z nabídky vlevo!');
      return;
    }

    let reason = '';
    let amount = 0;
    let templateId: string | undefined = undefined;

    if (recurringSource === 'template') {
      if (!recurringSelectedTemplate) {
        alert('Vyberte prosím položku ze sazebníku!');
        return;
      }
      reason = recurringSelectedTemplate.name;
      amount = parseFloat(recurringCustomAmount) || recurringSelectedTemplate.amount || 0;
      templateId = recurringSelectedTemplate.id;
    } else {
      reason = recurringCustomReason.trim();
      amount = parseFloat(recurringCustomAmount) || 0;
    }

    if (!reason) {
      alert('Zadejte prosím důvod pokuty!');
      return;
    }

    if (amount <= 0) {
      alert('Zadejte platnou částku pokuty vyšší než 0!');
      return;
    }

    setIsSubmitting(true);
    try {
      const rfPath = `groups/${group.id}/periods/${period.id}/recurringFines`;
      const dayOfPeriod = new Date(recurringStartDate).getDate();

      const payload = {
        reason,
        amount,
        memberIds: selectedMemberIds,
        interval: recurringInterval,
        intervalDays: recurringInterval === 'custom_days' ? (parseInt(recurringIntervalDays, 10) || 14) : null,
        dayOfPeriod,
        startDate: recurringStartDate,
        endDate: recurringDurationType === 'until_date' ? (recurringEndDate || null) : null,
        durationType: recurringDurationType,
        occurrencesLimit: recurringDurationType === 'max_occurrences' ? (parseInt(recurringOccurrencesLimit, 10) || 1) : null,
        occurrencesCount: editingRecurringFineId ? (recurringFines.find(r => r.id === editingRecurringFineId)?.occurrencesCount || 0) : 0,
        nextDueDate: recurringStartDate,
        active: true,
        groupId: group.id,
        periodId: period.id,
        createdAt: Date.now(),
        templateId: templateId || null,
        note: recurringNote.trim() || null
      };

      if (editingRecurringFineId) {
        await updateDoc(doc(db, rfPath, editingRecurringFineId), payload);
      } else {
        await addDoc(collection(db, rfPath), payload);
      }

      await checkAndExecuteRecurringFines(db, group.id, period.id);

      setEditingRecurringFineId(null);
      setRecurringCustomReason('');
      setRecurringCustomAmount('');
      setRecurringSelectedTemplate(null);
      setRecurringNote('');
      setRecurringSubTab('list');
      alert('Automatická pokuta byla úspěšně uložena!');
      onSuccess?.();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `groups/${group.id}/periods/${period.id}/recurringFines`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleActiveRecurring = async (rf: RecurringFine) => {
    if (isReadOnly) return;
    try {
      const rfPath = `groups/${group.id}/periods/${period.id}/recurringFines`;
      await updateDoc(doc(db, rfPath, rf.id), {
        active: !rf.active
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'recurringFines');
    }
  };

  const handleDeleteRecurring = async (rfId: string) => {
    if (isReadOnly) return;
    try {
      const rfPath = `groups/${group.id}/periods/${period.id}/recurringFines`;
      await deleteDoc(doc(db, rfPath, rfId));
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'recurringFines');
    }
  };

  const handleExecuteNowRecurring = async (rf: RecurringFine) => {
    if (isReadOnly || isSubmitting || !rf.memberIds || rf.memberIds.length === 0) return;
    setIsSubmitting(true);
    try {
      const batch = writeBatch(db);
      const timestamp = Date.now();

      rf.memberIds.forEach(memberId => {
        const fineRef = doc(collection(db, `groups/${group.id}/periods/${period.id}/fines`));
        batch.set(fineRef, {
          memberId,
          reason: `${rf.reason} (Manuální spuštění aut. pokuty)`,
          amount: rf.amount,
          paidAmount: 0,
          paid: false,
          periodId: period.id,
          createdAt: timestamp,
          templateId: rf.templateId || null,
          quantity: 1,
          unitPrice: rf.amount,
          unit: '',
          recurringFineId: rf.id
        });
      });

      await batch.commit();

      for (const mId of rf.memberIds) {
        await reconcileOverpaymentsForMember(db, group.id, period.id, mId);
      }

      const rfPath = `groups/${group.id}/periods/${period.id}/recurringFines`;
      await updateDoc(doc(db, rfPath, rf.id), {
        lastGeneratedAt: new Date().toISOString().split('T')[0],
        occurrencesCount: (rf.occurrencesCount || 0) + 1
      });

      onSuccess?.();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'fines');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditRecurring = (rf: RecurringFine) => {
    setEditingRecurringFineId(rf.id);
    setSelectedMemberIds(rf.memberIds || []);
    if (rf.templateId) {
      setRecurringSource('template');
      const t = templates.find(temp => temp.id === rf.templateId);
      setRecurringSelectedTemplate(t || null);
    } else {
      setRecurringSource('custom');
      setRecurringCustomReason(rf.reason);
      setRecurringCustomAmount(String(rf.amount));
    }
    setRecurringInterval(rf.interval);
    if (rf.intervalDays) setRecurringIntervalDays(String(rf.intervalDays));
    setRecurringStartDate(rf.startDate || new Date().toISOString().split('T')[0]);
    setRecurringDurationType(rf.durationType || 'indefinite');
    if (rf.endDate) setRecurringEndDate(rf.endDate);
    if (rf.occurrencesLimit) setRecurringOccurrencesLimit(String(rf.occurrencesLimit));
    if (rf.note) setRecurringNote(rf.note);

    setFineTab('recurring');
    setRecurringSubTab('create');
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Step 1: Member Selection */}
      <div className="bento-card shadow-sm h-fit">
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-bento-accent"></div>
            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-bento-text-muted">Vyběr hříšníků</h3>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {selectedMemberIds.length > 0 && (
              <button 
                type="button"
                onClick={() => {
                  setSelectedMemberIds([]);
                  setActiveGroupId(null);
                }}
                className="text-[10px] font-black text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200/60 px-2.5 py-1 rounded-lg transition-all uppercase tracking-widest flex items-center gap-1 cursor-pointer"
                title="Zrušit označení všech členů"
              >
                <X className="w-3 h-3" />
                Zrušit výběr ({selectedMemberIds.length})
              </button>
            )}
            {selectedMemberIds.length < activeMembers.length && (
              <button 
                type="button"
                onClick={() => setSelectedMemberIds(activeMembers.map(m => m.id))}
                className="text-[10px] font-black text-bento-accent uppercase tracking-widest hover:bg-bento-accent/5 px-2.5 py-1 rounded-lg transition-all cursor-pointer"
              >
                Označit vše
              </button>
            )}
          </div>
        </div>
        
        {/* Search Input & Sort Dropdown */}
        <div className="mb-6 flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              placeholder="Hledat člena nebo skupinu..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-8 py-2.5 bg-slate-50 border border-transparent rounded-xl focus:bg-white focus:border-bento-accent/20 focus:outline-none focus:ring-4 focus:ring-bento-accent/5 text-xs font-bold transition-all placeholder:text-bento-text-muted/50"
            />
            <div className="absolute left-3.5 top-1/2 -translate-y-1/2">
              <Users className="w-3.5 h-3.5 text-bento-text-muted" />
            </div>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-slate-200 rounded-full transition-all"
              >
                <X className="w-3 h-3 text-bento-text-muted" />
              </button>
            )}
          </div>

          <select
            value={memberSortOption}
            onChange={(e) => setMemberSortOption(e.target.value as 'name' | 'age-asc' | 'age-desc')}
            className="px-3 py-2.5 bg-slate-50 border border-transparent rounded-xl focus:bg-white focus:border-bento-accent/20 focus:outline-none text-xs font-bold text-slate-700 transition-all cursor-pointer"
          >
            <option value="name">A-Z</option>
            <option value="age-asc">Nejmladší</option>
            <option value="age-desc">Nejstarší</option>
          </select>
        </div>

        {/* Group Bubbles */}
        {filteredGroups.length > 0 && (
          <div className="mb-6 space-y-2">
            <div className="flex flex-wrap gap-2">
              {(() => {
                const groupsToDisplay = activeGroupId 
                  ? filteredGroups.filter(g => g.id === activeGroupId) 
                  : (showAllGroups || searchQuery ? filteredGroups : filteredGroups.slice(0, 8));
                
                return groupsToDisplay.map(mg => (
                  <button
                    key={mg.id}
                    onClick={() => handleGroupSelection(mg)}
                    className={cn(
                      "px-4 py-1.5 rounded-full text-[11px] font-black uppercase tracking-wider transition-all border-2 active:scale-95",
                      activeGroupId === mg.id 
                        ? "bg-bento-accent border-bento-accent text-white shadow-lg shadow-bento-accent/20"
                        : "bg-white border-slate-100 text-bento-text-muted hover:border-slate-200"
                    )}
                  >
                    {mg.name}
                  </button>
                ));
              })()}
              
              {!activeGroupId && filteredGroups.length > 8 && !showAllGroups && !searchQuery && (
                <button
                  onClick={() => setShowAllGroups(true)}
                  className="px-4 py-1.5 rounded-full text-[11px] font-black uppercase tracking-wider text-bento-accent hover:bg-bento-accent/5 transition-all flex items-center gap-1.5"
                >
                  Více <ChevronDown className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}
        
        <div className="space-y-1.5 max-h-[380px] overflow-y-auto pr-2 custom-scrollbar">
          {filteredMembers.length > 0 ? filteredMembers.map(member => {
            const isSelected = selectedMemberIds.includes(member.id);
            const metaString = [
              formatMemberAgeAndBirth(member.birthDate),
              member.position
            ].filter(Boolean).join(' • ');

            return (
              <button
                key={member.id}
                onClick={() => toggleMember(member.id)}
                className={cn(
                  "w-full flex items-center justify-between p-3.5 rounded-xl border transition-all text-sm font-bold",
                  isSelected
                    ? "bg-bento-accent border-bento-accent text-white shadow-md shadow-bento-accent/10"
                    : "bg-slate-50 border-transparent text-bento-text-main hover:bg-white hover:border-bento-card-border"
                )}
              >
                <div className="flex flex-col text-left min-w-0 pr-2">
                  <span className="truncate">{member.name}</span>
                  {metaString && (
                    <span className={cn(
                      "text-[10px] font-normal leading-tight transition-colors truncate mt-0.5",
                      isSelected ? "text-white/80" : "text-slate-400"
                    )}>
                      {metaString}
                    </span>
                  )}
                </div>
                {isSelected && <CheckCircle2 className="w-4 h-4 shrink-0 ml-2" />}
              </button>
            );
          }) : (
            <div className="py-12 text-center">
              <Users className="w-8 h-8 text-bento-text-muted/20 mx-auto mb-3" />
              <p className="text-xs font-bold text-bento-text-muted">Nenalezen žádný člen</p>
            </div>
          )}
        </div>

        <div className="mt-6 pt-4 border-t border-bento-card-border">
          <p className="text-[10px] font-bold uppercase tracking-widest text-bento-text-muted">Vybraných členů: <span className="text-bento-text-main">{selectedMemberIds.length}</span></p>
        </div>
      </div>

      {/* Step 2: Fine Detail */}
      <div className="bento-card shadow-sm">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-1.5 h-1.5 rounded-full bg-rose-400"></div>
          <h3 className="text-xs font-black uppercase tracking-[0.2em] text-bento-text-muted">Detail pokuty</h3>
        </div>

        <div className="space-y-6">
          {/* 3 Main Fine Recording Tabs */}
          <div className="flex gap-1.5 p-1 bg-slate-100/50 rounded-xl">
            <button
              onClick={() => setFineTab('template')}
              className={cn(
                "flex-1 py-2 rounded-lg font-bold text-[10px] uppercase tracking-wider transition-all",
                fineTab === 'template' ? "bg-white text-bento-text-main shadow-sm" : "text-bento-text-muted hover:text-bento-text-main"
              )}
            >
              Ze sazebníku
            </button>
            <button
              onClick={() => setFineTab('custom')}
              className={cn(
                "flex-1 py-2 rounded-lg font-bold text-[10px] uppercase tracking-wider transition-all",
                fineTab === 'custom' ? "bg-white text-bento-text-main shadow-sm" : "text-bento-text-muted hover:text-bento-text-main"
              )}
            >
              Vlastní zadání
            </button>
            <button
              onClick={() => setFineTab('recurring')}
              className={cn(
                "flex-1 py-2 rounded-lg font-bold text-[10px] uppercase tracking-wider transition-all flex items-center justify-center gap-1.5",
                fineTab === 'recurring' ? "bg-purple-600 text-white shadow-sm" : "text-purple-600 hover:bg-purple-50"
              )}
            >
              <Zap className="w-3 h-3" />
              Automatická
              {recurringFines.length > 0 && (
                <span className={cn(
                  "px-1.5 py-0.2 rounded-full text-[9px] font-black",
                  fineTab === 'recurring' ? "bg-white/20 text-white" : "bg-purple-100 text-purple-700"
                )}>
                  {recurringFines.length}
                </span>
              )}
            </button>
          </div>

          {fineTab === 'template' ? (
            <div className="space-y-4">
              <div className="flex flex-col gap-3">
                <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted px-1">Výběr prohřešku</label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Hledat prohřešek..."
                    value={templateSearchQuery}
                    onChange={(e) => setTemplateSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-transparent rounded-xl focus:bg-white focus:border-bento-accent/20 focus:outline-none focus:ring-4 focus:ring-bento-accent/5 text-[11px] font-bold transition-all placeholder:text-bento-text-muted/50"
                  />
                  <div className="absolute left-3.5 top-1/2 -translate-y-1/2">
                    <ReceiptText className="w-3.5 h-3.5 text-bento-text-muted" />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
                {filteredTemplates.map(template => (
                  <button
                    key={template.id}
                    onClick={() => setSelectedTemplate(template)}
                    className={cn(
                      "w-full flex items-center justify-between p-3.5 rounded-xl border transition-all text-left group",
                      selectedTemplate?.id === template.id
                        ? "bg-slate-900 border-slate-900 text-white shadow-lg"
                        : "bg-slate-50 border-transparent text-bento-text-main hover:bg-white hover:border-bento-card-border"
                    )}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0 pr-4">
                      <div className="min-w-0">
                        <span className="font-bold block text-sm leading-tight truncate">{template.name}</span>
                        {template.type === 'dynamic' && (
                          <span className={cn("text-[10px] font-medium", selectedTemplate?.id === template.id ? "text-white/60" : "text-bento-text-muted")}>
                            {template.amount} {getCurrencySymbol(group.currency)} / {template.unit}
                          </span>
                        )}
                        {template.type === 'in_kind' && (
                          <span className={cn("text-[10px] font-medium block mt-0.5", selectedTemplate?.id === template.id ? "text-blue-300" : "text-blue-600 font-bold")}>
                            {template.quantity || 1}x {template.itemOrTask || template.unit || 'úkol/věc'}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className={cn(
                        "font-bold text-[11px] whitespace-nowrap px-2 py-0.5 rounded-md",
                        template.type === 'in_kind'
                          ? (selectedTemplate?.id === template.id ? "bg-blue-500/30 text-blue-200" : "bg-blue-100 text-blue-700")
                          : ""
                      )}>
                        {template.type === 'fixed'
                          ? `${template.amount} ${getCurrencySymbol(group.currency)}`
                          : template.type === 'in_kind'
                            ? 'Věcná pokuta'
                            : 'Dynamická'}
                      </span>
                    </div>
                  </button>
                ))}
              </div>

              {selectedTemplate && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="p-4 bg-bento-accent/5 border border-bento-accent/10 rounded-xl space-y-4 mt-2"
                >
                  {selectedTemplate.type === 'in_kind' ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest">Věcný trest / úkol</span>
                        <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-100">Bezplatná pokuta (0 Kč)</span>
                      </div>
                      <div className="p-2.5 bg-blue-50/60 rounded-lg border border-blue-100 text-xs flex flex-col gap-1">
                        <div className="flex justify-between items-center">
                          <span className="text-slate-600 font-medium">Věc / Úkol z ceníku:</span>
                          <span className="font-extrabold text-blue-800">
                            {selectedTemplate.itemOrTask || selectedTemplate.unit || selectedTemplate.name}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-slate-600 font-medium">Základní množství v sazebníku:</span>
                          <span className="font-bold text-slate-800">{selectedTemplate.quantity || 1}x</span>
                        </div>
                        {fineCount > 1 && (
                          <div className="flex justify-between items-center pt-1 border-t border-blue-200/60 font-bold text-blue-900">
                            <span>Celkem k odevzdání/splnění:</span>
                            <span className="text-sm font-black">{(selectedTemplate.quantity || 1) * fineCount}x</span>
                          </div>
                        )}
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-bento-accent uppercase tracking-widest">Počet násobků (kolikrát udělit?)</label>
                        <div className="flex items-center gap-3">
                          <button 
                            type="button"
                            onClick={() => setFineCount(Math.max(1, fineCount - 1))}
                            className="w-10 h-10 rounded-lg bg-white border border-bento-accent/20 flex items-center justify-center text-bento-accent hover:bg-bento-accent hover:text-white transition-all"
                          >
                            <X className="w-4 h-4 rotate-45 transform" />
                          </button>
                          <input
                            type="number"
                            min="1"
                            className="w-full px-4 py-2 bg-white border border-bento-accent/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-bento-accent/10 font-bold text-center text-sm"
                            value={fineCount}
                            onChange={(e) => setFineCount(Math.max(1, parseInt(e.target.value) || 1))}
                          />
                          <button 
                            type="button"
                            onClick={() => setFineCount(fineCount + 1)}
                            className="w-10 h-10 rounded-lg bg-white border border-bento-accent/20 flex items-center justify-center text-bento-accent hover:bg-bento-accent hover:text-white transition-all"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : selectedTemplate.type === 'dynamic' ? (
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-bento-accent uppercase tracking-widest">Kolikrát? ({selectedTemplate.unit})</label>
                      <div className="relative">
                        <input
                          type="number"
                          autoFocus
                          className="w-full px-4 py-2.5 bg-white border border-bento-accent/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-bento-accent/10 font-bold text-sm"
                          value={dynamicValue}
                          onChange={(e) => setDynamicValue(e.target.value)}
                        />
                        <Hash className="absolute right-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-bento-accent opacity-40" />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-bento-accent uppercase tracking-widest">Počet (kolikrát zapsat?)</label>
                      <div className="flex items-center gap-3">
                        <button 
                          type="button"
                          onClick={() => setFineCount(Math.max(1, fineCount - 1))}
                          className="w-10 h-10 rounded-lg bg-white border border-bento-accent/20 flex items-center justify-center text-bento-accent hover:bg-bento-accent hover:text-white transition-all"
                        >
                          <X className="w-4 h-4 rotate-45 transform" />
                        </button>
                        <input
                          type="number"
                          min="1"
                          className="w-full px-4 py-2 bg-white border border-bento-accent/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-bento-accent/10 font-bold text-center text-sm"
                          value={fineCount}
                          onChange={(e) => setFineCount(Math.max(1, parseInt(e.target.value) || 1))}
                        />
                        <button 
                          type="button"
                          onClick={() => setFineCount(fineCount + 1)}
                          className="w-10 h-10 rounded-lg bg-white border border-bento-accent/20 flex items-center justify-center text-bento-accent hover:bg-bento-accent hover:text-white transition-all"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </div>
          ) : fineTab === 'custom' ? (
            <div className="space-y-4">
              {/* Type selection: Finanční vs Věcný trest */}
              <div className="flex gap-2 p-1 bg-slate-100 rounded-xl">
                <button
                  type="button"
                  onClick={() => setCustomIsInKind(false)}
                  className={cn(
                    "flex-1 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all",
                    !customIsInKind ? "bg-white text-bento-text-main shadow-xs" : "text-bento-text-muted hover:text-bento-text-main"
                  )}
                >
                  Finanční pokuta
                </button>
                <button
                  type="button"
                  onClick={() => setCustomIsInKind(true)}
                  className={cn(
                    "flex-1 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all",
                    customIsInKind ? "bg-blue-600 text-white shadow-xs" : "text-bento-text-muted hover:text-blue-600"
                  )}
                >
                  Věcný trest / úkol
                </button>
              </div>

              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block px-1 mb-1.5">
                  {customIsInKind ? 'Věc / Úkol / Prohřešek' : 'Důvod pokuty'}
                </label>
                <input
                  type="text"
                  placeholder={customIsInKind ? "Marlenka, přinést kávu, úklid..." : "Např. Pojmenování prohřešku..."}
                  className="w-full px-4 py-3 bg-slate-50 border border-bento-card-border rounded-xl focus:outline-none focus:ring-2 focus:ring-bento-accent/10 text-sm font-medium"
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                />
              </div>

              {customIsInKind ? (
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block px-1 mb-1.5">Množství</label>
                  <input
                    type="number"
                    min="1"
                    className="w-full px-4 py-3 bg-slate-50 border border-bento-card-border rounded-xl focus:outline-none focus:ring-2 focus:ring-bento-accent/10 font-bold text-xl text-center"
                    value={fineCount}
                    onChange={(e) => setFineCount(Math.max(1, parseInt(e.target.value) || 1))}
                  />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block px-1 mb-1.5">Částka ({getCurrencySymbol(group.currency)}/ks)</label>
                    <input
                      type="number"
                      placeholder="0"
                      className="w-full px-4 py-3 bg-slate-50 border border-bento-card-border rounded-xl focus:outline-none focus:ring-2 focus:ring-bento-accent/10 font-bold text-xl"
                      value={customAmount}
                      onChange={(e) => setCustomAmount(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block px-1 mb-1.5">Počet</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        className="w-full px-4 py-3 bg-slate-50 border border-bento-card-border rounded-xl focus:outline-none focus:ring-2 focus:ring-bento-accent/10 font-bold text-xl text-center"
                        value={fineCount}
                        onChange={(e) => setFineCount(Math.max(1, parseInt(e.target.value) || 1))}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Automatic Recurring Fine View */
            <div className="space-y-4">
              <div className="flex gap-2 border-b border-slate-100 pb-3">
                <button
                  type="button"
                  onClick={() => {
                    setEditingRecurringFineId(null);
                    setRecurringSubTab('create');
                  }}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all flex items-center gap-1.5",
                    recurringSubTab === 'create'
                      ? "bg-purple-50 text-purple-700 border border-purple-200"
                      : "text-slate-500 hover:bg-slate-50"
                  )}
                >
                  <Plus className="w-3.5 h-3.5" />
                  {editingRecurringFineId ? 'Upravit automatickou' : 'Vytvořit novou'}
                </button>
                <button
                  type="button"
                  onClick={() => setRecurringSubTab('list')}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all flex items-center gap-1.5",
                    recurringSubTab === 'list'
                      ? "bg-purple-50 text-purple-700 border border-purple-200"
                      : "text-slate-500 hover:bg-slate-50"
                  )}
                >
                  <Repeat className="w-3.5 h-3.5" />
                  Správa ({recurringFines.length})
                </button>
              </div>

              {recurringSubTab === 'create' ? (
                <div className="space-y-4 text-xs font-medium max-h-[380px] overflow-y-auto pr-1 custom-scrollbar">
                  {/* Choice: From template vs custom */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block">Zdroj pokuty</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setRecurringSource('template')}
                        className={cn(
                          "p-2.5 rounded-xl border font-bold text-left transition-all",
                          recurringSource === 'template' ? "border-purple-600 bg-purple-50/50 text-purple-900" : "border-slate-200 bg-slate-50 text-slate-600"
                        )}
                      >
                        Ze sazebníku
                      </button>
                      <button
                        type="button"
                        onClick={() => setRecurringSource('custom')}
                        className={cn(
                          "p-2.5 rounded-xl border font-bold text-left transition-all",
                          recurringSource === 'custom' ? "border-purple-600 bg-purple-50/50 text-purple-900" : "border-slate-200 bg-slate-50 text-slate-600"
                        )}
                      >
                        Vlastní prohřešek
                      </button>
                    </div>
                  </div>

                  {recurringSource === 'template' ? (
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block">Vyberte pokutu ze sazebníku</label>
                      <select
                        value={recurringSelectedTemplate?.id || ''}
                        onChange={(e) => {
                          const t = templates.find(temp => temp.id === e.target.value);
                          setRecurringSelectedTemplate(t || null);
                        }}
                        className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                      >
                        <option value="">-- Vyberte položku --</option>
                        {templates.map(t => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({t.amount} {getCurrencySymbol(group.currency)})
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-1">Důvod pokuty</label>
                        <input
                          type="text"
                          placeholder="Např. Měsíční klubový příspěvek"
                          value={recurringCustomReason}
                          onChange={(e) => setRecurringCustomReason(e.target.value)}
                          className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-1">Částka ({getCurrencySymbol(group.currency)})</label>
                        <input
                          type="number"
                          placeholder="100"
                          value={recurringCustomAmount}
                          onChange={(e) => setRecurringCustomAmount(e.target.value)}
                          className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                        />
                      </div>
                    </div>
                  )}

                  {/* Interval / Frequency */}
                  <div className="space-y-2 pt-2 border-t border-slate-100">
                    <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block">Interval opakování</label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {[
                        { id: 'monthly', label: 'Měsíčně' },
                        { id: 'weekly', label: 'Týdně' },
                        { id: 'quarterly', label: 'Čtvrtletně' },
                        { id: 'yearly', label: 'Ročně' },
                        { id: 'custom_days', label: 'X dní' },
                      ].map(opt => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setRecurringInterval(opt.id as any)}
                          className={cn(
                            "py-2 px-3 rounded-xl border font-bold text-center text-[11px] transition-all",
                            recurringInterval === opt.id ? "bg-purple-600 border-purple-600 text-white shadow-sm" : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>

                    {recurringInterval === 'custom_days' && (
                      <div className="mt-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-1">Počet dní mezi zápisy</label>
                        <input
                          type="number"
                          min="1"
                          value={recurringIntervalDays}
                          onChange={(e) => setRecurringIntervalDays(e.target.value)}
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold"
                        />
                      </div>
                    )}
                  </div>

                  {/* Start Date */}
                  <div className="space-y-2 pt-2 border-t border-slate-100">
                    <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block">Datum prvního zápisu</label>
                    <input
                      type="date"
                      value={recurringStartDate}
                      onChange={(e) => setRecurringStartDate(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700"
                    />
                  </div>

                  {/* Duration / Expiration ("trvanlivost jak dlouho má jet pokuta") */}
                  <div className="space-y-2 pt-2 border-t border-slate-100">
                    <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block">Trvanlivost (Jak dlouho má jet pokuta?)</label>
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 p-2 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer font-bold text-[11px]">
                        <input
                          type="radio"
                          name="durationType"
                          checked={recurringDurationType === 'indefinite'}
                          onChange={() => setRecurringDurationType('indefinite')}
                          className="text-purple-600 focus:ring-purple-500"
                        />
                        <span>Do odvolání (trvalá)</span>
                      </label>

                      <label className="flex items-center gap-2 p-2 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer font-bold text-[11px]">
                        <input
                          type="radio"
                          name="durationType"
                          checked={recurringDurationType === 'until_date'}
                          onChange={() => setRecurringDurationType('until_date')}
                          className="text-purple-600 focus:ring-purple-500"
                        />
                        <span>Do určitého data</span>
                      </label>

                      {recurringDurationType === 'until_date' && (
                        <div className="pl-6">
                          <input
                            type="date"
                            value={recurringEndDate}
                            onChange={(e) => setRecurringEndDate(e.target.value)}
                            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl font-bold"
                          />
                        </div>
                      )}

                      <label className="flex items-center gap-2 p-2 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer font-bold text-[11px]">
                        <input
                          type="radio"
                          name="durationType"
                          checked={recurringDurationType === 'max_occurrences'}
                          onChange={() => setRecurringDurationType('max_occurrences')}
                          className="text-purple-600 focus:ring-purple-500"
                        />
                        <span>Určitý počet opakování</span>
                      </label>

                      {recurringDurationType === 'max_occurrences' && (
                        <div className="pl-6">
                          <input
                            type="number"
                            min="1"
                            placeholder="Např. 6"
                            value={recurringOccurrencesLimit}
                            onChange={(e) => setRecurringOccurrencesLimit(e.target.value)}
                            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl font-bold"
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Selected Members Summary */}
                  <div className="p-3 bg-purple-50/50 border border-purple-100 rounded-xl space-y-1">
                    <p className="text-[10px] font-black uppercase tracking-widest text-purple-700">Příjemci automatické pokuty</p>
                    <p className="text-xs font-bold text-slate-800">
                      {selectedMemberIds.length > 0
                        ? `Vybráno ${selectedMemberIds.length} členů (zvoleno vlevo)`
                        : '⚠️ Vyberte hříšníky v levém panelu!'}
                    </p>
                  </div>

                  {/* Save Button */}
                  <button
                    type="button"
                    onClick={handleSaveRecurringFine}
                    disabled={isReadOnly || isSubmitting}
                    className="btn-bento-primary w-full py-3.5 bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs rounded-xl shadow-lg shadow-purple-600/20 disabled:opacity-40"
                  >
                    {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                    {editingRecurringFineId ? 'Uložit změny' : 'Vytvořit automatickou pokutu'}
                  </button>
                </div>
              ) : (
                /* List of Automatic Fines */
                <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1 custom-scrollbar">
                  {recurringFines.length > 0 ? (
                    recurringFines.map(rf => {
                      const isExpired =
                        (rf.durationType === 'until_date' && rf.endDate && rf.nextDueDate > rf.endDate) ||
                        (rf.durationType === 'max_occurrences' && rf.occurrencesLimit && (rf.occurrencesCount || 0) >= rf.occurrencesLimit);

                      return (
                        <div
                          key={rf.id}
                          className={cn(
                            "p-3.5 rounded-xl border transition-all space-y-2",
                            !rf.active
                              ? "bg-slate-50 border-slate-200 opacity-60"
                              : isExpired
                              ? "bg-amber-50/30 border-amber-200 opacity-70"
                              : "bg-white border-purple-100 shadow-sm hover:border-purple-300"
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <h4 className="font-bold text-sm text-slate-800 leading-tight">{rf.reason}</h4>
                              <p className="text-xs font-black text-purple-600 mt-0.5">
                                {rf.amount} {getCurrencySymbol(group.currency)}
                              </p>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span
                                className={cn(
                                  "px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider",
                                  !rf.active
                                    ? "bg-slate-200 text-slate-600"
                                    : isExpired
                                    ? "bg-amber-100 text-amber-800"
                                    : "bg-emerald-100 text-emerald-800"
                                )}
                              >
                                {!rf.active ? 'Pozastaveno' : isExpired ? 'Ukončeno' : 'Aktivní'}
                              </span>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-1.5 text-[10px] font-medium text-slate-500 pt-1 border-t border-slate-100">
                            <div>
                              <span className="font-bold text-slate-700 block">Interval:</span>
                              {rf.interval === 'monthly' && 'Měsíčně'}
                              {rf.interval === 'weekly' && 'Týdně'}
                              {rf.interval === 'quarterly' && 'Čtvrtletně'}
                              {rf.interval === 'yearly' && 'Ročně'}
                              {rf.interval === 'custom_days' && `Každých ${rf.intervalDays || 14} dní`}
                            </div>
                            <div>
                              <span className="font-bold text-slate-700 block">Trvanlivost:</span>
                              {rf.durationType === 'indefinite' && 'Do odvolání'}
                              {rf.durationType === 'until_date' && `Do ${rf.endDate}`}
                              {rf.durationType === 'max_occurrences' && `Opakování: ${rf.occurrencesCount || 0}/${rf.occurrencesLimit}`}
                            </div>
                            <div>
                              <span className="font-bold text-slate-700 block">Příští zápis:</span>
                              <span className="font-bold text-purple-700">{rf.nextDueDate}</span>
                            </div>
                            <div>
                              <span className="font-bold text-slate-700 block">Členů:</span>
                              {rf.memberIds?.length || 0} vybraných
                            </div>
                          </div>

                          {/* Action Buttons */}
                          {!isReadOnly && (
                            <div className="flex items-center justify-end gap-1.5 pt-2 border-t border-slate-100">
                              <button
                                type="button"
                                onClick={() => handleExecuteNowRecurring(rf)}
                                title="Zapsat ihned všem vybraným členům"
                                className="px-2 py-1 bg-purple-50 text-purple-700 hover:bg-purple-100 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-all"
                              >
                                <Play className="w-3 h-3" /> Zapsat ihned
                              </button>
                              <button
                                type="button"
                                onClick={() => handleToggleActiveRecurring(rf)}
                                className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-all"
                                title={rf.active ? 'Pozastavit' : 'Aktivovat'}
                              >
                                {rf.active ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleEditRecurring(rf)}
                                className="p-1.5 text-slate-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-all"
                                title="Upravit"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteRecurring(rf.id)}
                                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                                title="Smazat"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="py-8 text-center text-slate-400">
                      <Repeat className="w-8 h-8 mx-auto mb-2 opacity-20" />
                      <p className="text-xs font-bold">Žádné automatické pokuty nebyly vytvořeny.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {fineTab !== 'recurring' && (
            <div className="pt-6 border-t border-bento-card-border">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-bento-text-muted mb-1">
                    {isCurrentInKind ? 'Výsledek (Věcná pokuta)' : 'Výsledek'}
                  </p>
                  {isCurrentInKind ? (
                    <div>
                      <p className="text-2xl font-black text-blue-600 tracking-tight leading-none">Bezplatná (0 {getCurrencySymbol(group.currency)})</p>
                      <p className="text-[10px] font-medium text-bento-text-muted mt-2">
                        {fineTab === 'custom' ? (customReason || 'Věcný trest') : (selectedTemplate?.name || 'Věcný trest')} ({fineCount}x) pro každého z {selectedMemberIds.length} členů
                      </p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-3xl font-black text-rose-500 tracking-tighter leading-none">{calculateAmount()} {getCurrencySymbol(group.currency)}</p>
                      <p className="text-[10px] font-medium text-bento-text-muted mt-2">pro každého z {selectedMemberIds.length} členů</p>
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-bento-text-muted mb-1">
                    {isCurrentInKind ? 'Typ pokuty' : 'Celkem'}
                  </p>
                  {isCurrentInKind ? (
                    <span className="px-3 py-1 bg-blue-100 text-blue-700 font-black text-xs rounded-lg inline-block">Věcná / Úkol</span>
                  ) : (
                    <p className="text-lg font-bold text-bento-text-main tracking-tight">{calculateAmount() * selectedMemberIds.length} {getCurrencySymbol(group.currency)}</p>
                  )}
                </div>
              </div>

              <AnimatePresence>
                {recordedNotice && (
                  <motion.div
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-bold mb-4 flex items-center gap-2"
                  >
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>{recordedNotice}</span>
                  </motion.div>
                )}
              </AnimatePresence>

              {isReadOnly && (
                <p className="text-xs font-bold text-amber-700 bg-amber-50 p-3 rounded-xl border border-amber-200 mb-4 text-center flex items-center justify-center gap-2">
                  <Eye className="w-4 h-4 text-amber-600" />
                  Jste v režimu Pouze pro čtení. Nemáte oprávnění zapisovat pokuty.
                </p>
              )}

              <button
                onClick={handleRecord}
                disabled={isReadOnly || selectedMemberIds.length === 0 || !isValidSelection || isSubmitting}
                className="btn-bento-primary w-full py-4 text-sm font-bold shadow-xl shadow-bento-accent/10 disabled:opacity-40"
              >
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                {isReadOnly 
                  ? 'Zápis zakázán (Čtenář)' 
                  : isCurrentInKind 
                    ? `Zapsat věcnou pokutu (0 Kč)` 
                    : 'Zapsat do systému'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
