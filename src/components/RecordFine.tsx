import { useState, useEffect, useMemo } from 'react';
import { collection, query, onSnapshot, doc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { Group, Period, Member, FineTemplate, OperationType, MemberGroup } from '../types';
import { handleFirestoreError, cn } from '../utils';
import { Users, ReceiptText, CheckCircle2, ChevronRight, X, AlertCircle, Plus, Hash, Loader2, Layers, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface RecordFineProps {
  group: Group;
  period: Period;
  onSuccess?: () => void;
}

export default function RecordFine({ group, period, onSuccess }: RecordFineProps) {
  const [members, setMembers] = useState<Member[]>([]);
  const [templates, setTemplates] = useState<FineTemplate[]>([]);
  const [memberGroups, setMemberGroups] = useState<MemberGroup[]>([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [showAllGroups, setShowAllGroups] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<FineTemplate | null>(null);
  const [customReason, setCustomReason] = useState('');
  const [customAmount, setCustomAmount] = useState('');
  const [isCustom, setIsCustom] = useState(false);
  const [dynamicValue, setDynamicValue] = useState('');
  const [fineCount, setFineCount] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [templateSearchQuery, setTemplateSearchQuery] = useState('');

  useEffect(() => {
    const membersPath = `groups/${group.id}/periods/${period.id}/members`;
    const templatesPath = `groups/${group.id}/periods/${period.id}/fineTemplates`;

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

    return () => {
      unsubMembers();
      unsubTemplates();
      unsubMemberGroups();
    };
  }, [group.id, period.id]);

  const activeMembers = useMemo(() => members.filter(m => m.active), [members]);

  const filteredMembers = useMemo(() => {
    if (!searchQuery.trim()) return activeMembers;
    const query = searchQuery.toLowerCase().trim();
    return activeMembers.filter(m => m.name.toLowerCase().includes(query));
  }, [activeMembers, searchQuery]);

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
    // Get list of IDs that are both in this group and active in current period
    // Safely handle cases where memberIds might not be a standard array
    const rawMemberIds = Array.isArray(mg.memberIds) ? mg.memberIds : [];
    
    // Filter out null/undefined and empty strings from memberIds
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

    // Check if everything in this group is already selected
    const allInGroupSelected = availableIds.every(id => selectedMemberIds.includes(id));

    if (allInGroupSelected) {
      // If already fully selected, Clicking again de-selects all members of this group
      setSelectedMemberIds(prev => prev.filter(id => !availableIds.includes(id)));
      setActiveGroupId(null);
    } else {
      // Select all members of this group (additive)
      setSelectedMemberIds(prev => {
        const next = new Set([...prev, ...availableIds]);
        return Array.from(next);
      });
      setActiveGroupId(mg.id);
    }
  };

  const calculateAmount = () => {
    if (isCustom) return (parseFloat(customAmount) || 0) * fineCount;
    if (!selectedTemplate) return 0;
    if (selectedTemplate.type === 'dynamic') {
      const val = parseFloat(dynamicValue) || 0;
      return val * selectedTemplate.amount;
    }
    return selectedTemplate.amount * fineCount;
  };

  const handleRecord = async () => {
    if (selectedMemberIds.length === 0 || isSubmitting) return;
    
    const amount = calculateAmount();
    let reason = '';
    let q = 1;
    let up = 0;
    let u = '';
    
    if (isCustom) {
      reason = fineCount > 1 ? `${customReason} ${fineCount}x` : customReason;
      q = fineCount;
      up = parseFloat(customAmount) || 0;
    } else if (selectedTemplate) {
      if (selectedTemplate.type === 'dynamic') {
        reason = `${selectedTemplate.name} (${dynamicValue} ${selectedTemplate.unit})`;
        q = parseFloat(dynamicValue) || 0;
        up = selectedTemplate.amount;
        u = selectedTemplate.unit || '';
      } else {
        reason = fineCount > 1 ? `${selectedTemplate.name} ${fineCount}x` : selectedTemplate.name;
        q = fineCount;
        up = selectedTemplate.amount;
      }
    }

    if (!reason || amount <= 0) return;

    setIsSubmitting(true);
    try {
      const batch = writeBatch(db);
      const timestamp = Date.now();

      selectedMemberIds.forEach(memberId => {
        const fineRef = doc(collection(db, `groups/${group.id}/periods/${period.id}/fines`));
        batch.set(fineRef, {
          memberId,
          reason,
          amount,
          paidAmount: 0,
          paid: false,
          periodId: period.id,
          createdAt: timestamp,
          templateId: selectedTemplate?.id || null,
          quantity: q,
          unitPrice: up,
          unit: u
        });
      });

      await batch.commit();
      setSelectedMemberIds([]);
      setSelectedTemplate(null);
      setCustomReason('');
      setCustomAmount('');
      setDynamicValue('');
      setFineCount(1);
      setIsCustom(false);
      setSearchQuery('');
      setTemplateSearchQuery('');
      onSuccess?.();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'fines');
    } finally {
      setIsSubmitting(false);
    }
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
          <button 
            onClick={() => setSelectedMemberIds(activeMembers.map(m => m.id))}
            className="text-[10px] font-black text-bento-accent uppercase tracking-widest hover:bg-bento-accent/5 px-2 py-1 rounded-lg transition-all"
          >
            Označit vše
          </button>
        </div>
        
        {/* Search Input */}
        <div className="mb-6 relative">
          <input
            type="text"
            placeholder="Hledat člena nebo skupinu..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-transparent rounded-xl focus:bg-white focus:border-bento-accent/20 focus:outline-none focus:ring-4 focus:ring-bento-accent/5 text-xs font-bold transition-all placeholder:text-bento-text-muted/50"
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

        {/* Group Bubbles */}
        {filteredGroups.length > 0 && (
          <div className="mb-6 space-y-2">
            <div className="flex flex-wrap gap-2">
              {(() => {
                const groupsToDisplay = activeGroupId 
                  ? filteredGroups.filter(g => g.id === activeGroupId) 
                  : (showAllGroups || searchQuery ? filteredGroups : filteredGroups.slice(0, 8)); // Rough estimate for 2 rows
                
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
                <span>{member.name}</span>
                {isSelected && <CheckCircle2 className="w-4 h-4" />}
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
          <div className="flex gap-2 p-1 bg-slate-100/50 rounded-xl">
            <button
              onClick={() => setIsCustom(false)}
              className={cn(
                "flex-1 py-2 rounded-lg font-bold text-[11px] uppercase tracking-wider transition-all",
                !isCustom ? "bg-white text-bento-text-main shadow-sm" : "text-bento-text-muted"
              )}
            >
              Ze sazebníku
            </button>
            <button
              onClick={() => setIsCustom(true)}
              className={cn(
                "flex-1 py-2 rounded-lg font-bold text-[11px] uppercase tracking-wider transition-all",
                isCustom ? "bg-white text-bento-text-main shadow-sm" : "text-bento-text-muted"
              )}
            >
              Vlastní zadání
            </button>
          </div>

          {!isCustom ? (
            <div className="space-y-4">
              <div className="flex flex-col gap-3">
                <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted px-1">Výběr prohřešku</label>
                {/* Template Search */}
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
                            {template.amount} Kč / {template.unit}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="font-bold text-[11px] whitespace-nowrap">
                        {template.type === 'fixed' ? `${template.amount} Kč` : 'Dynamická'}
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
                  {selectedTemplate.type === 'dynamic' ? (
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
          ) : (
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block px-1 mb-1.5">Důvod pokuty</label>
                <input
                  type="text"
                  placeholder="Např. Pojmenování prohřešku..."
                  className="w-full px-4 py-3 bg-slate-50 border border-bento-card-border rounded-xl focus:outline-none focus:ring-2 focus:ring-bento-accent/10 text-sm font-medium"
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block px-1 mb-1.5">Částka (Kč/ks)</label>
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
            </div>
          )}

          <div className="pt-6 border-t border-bento-card-border">
            <div className="flex justify-between items-center mb-6">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-bento-text-muted mb-1">Výsledek</p>
                <p className="text-3xl font-black text-rose-500 tracking-tighter leading-none">{calculateAmount()} Kč</p>
                <p className="text-[10px] font-medium text-bento-text-muted mt-2">pro každého z {selectedMemberIds.length} členů</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase tracking-widest text-bento-text-muted mb-1">Celkem</p>
                <p className="text-lg font-bold text-bento-text-main tracking-tight">{calculateAmount() * selectedMemberIds.length} Kč</p>
              </div>
            </div>

            <button
              onClick={handleRecord}
              disabled={selectedMemberIds.length === 0 || calculateAmount() <= 0 || isSubmitting}
              className="btn-bento-primary w-full py-4 text-sm font-bold shadow-xl shadow-bento-accent/10 disabled:opacity-40"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Zapsat do systému
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
