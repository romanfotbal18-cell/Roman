import { useState, useEffect } from 'react';
import { collection, query, onSnapshot, addDoc, serverTimestamp, deleteDoc, doc, updateDoc, orderBy, getDocs, writeBatch, where } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Group, Period, OperationType } from '../types';
import { handleFirestoreError, cn } from '../utils';
import { Plus, Trash2, Edit2, ArrowLeft, Calendar, Loader2, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface PeriodSelectorProps {
  group: Group;
  onSelect: (period: Period) => void;
  onBack: () => void;
}

export default function PeriodSelector({ group, onSelect, onBack }: PeriodSelectorProps) {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [copySettings, setCopySettings] = useState(false);
  const [sourceGroupId, setSourceGroupId] = useState('');
  const [sourcePeriods, setSourcePeriods] = useState<Period[]>([]);
  const [sourcePeriodId, setSourcePeriodId] = useState('');
  const [editingPeriodId, setEditingPeriodId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, `groups/${group.id}/periods`),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const periodsData = snapshot.docs.map(doc => ({
        ...doc.data(),
        id: doc.id
      })) as Period[];
      setPeriods(periodsData);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `groups/${group.id}/periods`);
    });

    return unsubscribe;
  }, [group.id]);

  useEffect(() => {
    if (!auth.currentUser) return;

    const q = query(
      collection(db, 'groups'),
      where('ownerId', '==', auth.currentUser.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      setGroups(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Group[]);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!sourceGroupId) {
      setSourcePeriods([]);
      return;
    }

    const unsub = onSnapshot(collection(db, `groups/${sourceGroupId}/periods`), (snapshot) => {
      setSourcePeriods(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Period[]);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `groups/${sourceGroupId}/periods`);
    });

    return () => unsub();
  }, [sourceGroupId]);

  const addPeriod = async () => {
    if (!newName.trim()) return;
    try {
      const newPeriodRef = await addDoc(collection(db, `groups/${group.id}/periods`), {
        name: newName.trim(),
        groupId: group.id,
        createdAt: Date.now()
      });

      // Copy settings if requested
      if (copySettings && sourceGroupId && sourcePeriodId) {
        // Copy members
        const sourceMembersSnapshot = await getDocs(collection(db, `groups/${sourceGroupId}/periods/${sourcePeriodId}/members`));
        const membersBatch = writeBatch(db);
        sourceMembersSnapshot.docs.forEach(memberDoc => {
          const newMemberRef = doc(collection(db, `groups/${group.id}/periods/${newPeriodRef.id}/members`));
          const { id, ...data } = memberDoc.data();
          membersBatch.set(newMemberRef, { ...data, id: newMemberRef.id, groupId: group.id });
        });
        await membersBatch.commit();

        // Copy templates
        const sourceTemplatesSnapshot = await getDocs(collection(db, `groups/${sourceGroupId}/periods/${sourcePeriodId}/fineTemplates`));
        const templatesBatch = writeBatch(db);
        sourceTemplatesSnapshot.docs.forEach(templateDoc => {
          const newTemplateRef = doc(collection(db, `groups/${group.id}/periods/${newPeriodRef.id}/fineTemplates`));
          const { id, ...data } = templateDoc.data();
          templatesBatch.set(newTemplateRef, { ...data, id: newTemplateRef.id, groupId: group.id });
        });
        await templatesBatch.commit();
      }

      setNewName('');
      setCopySettings(false);
      setSourceGroupId('');
      setSourcePeriodId('');
      setIsAdding(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `groups/${group.id}/periods`);
    }
  };

  const updatePeriod = async (id: string) => {
    if (!editName.trim()) return;
    try {
      await updateDoc(doc(db, `groups/${group.id}/periods`, id), {
        name: editName.trim()
      });
      setEditingPeriodId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `groups/${group.id}/periods/${id}`);
    }
  };

  const deletePeriod = async (id: string) => {
    try {
      await deleteDoc(doc(db, `groups/${group.id}/periods`, id));
      console.log('Period deleted successfully:', id);
      setDeleteConfirmId(null);
    } catch (error) {
      console.error('Delete period error:', error);
      alert('Chyba při mazání období: ' + (error instanceof Error ? error.message : 'Neznámá chyba'));
      handleFirestoreError(error, OperationType.DELETE, `groups/${group.id}/periods/${id}`);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-12">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-8 mb-16">
          <div className="flex items-center gap-6">
            <button
              onClick={onBack}
              className="p-4 text-bento-text-muted hover:text-bento-text-main bg-white rounded-2xl border border-bento-card-border shadow-sm transition-all active:scale-95"
            >
              <ArrowLeft className="w-6 h-6" />
            </button>
            <div>
              <div className="flex items-center gap-2 text-bento-accent font-black text-[10px] uppercase tracking-[0.2em] mb-1">
                <span>{group.name}</span>
              </div>
              <h1 className="text-5xl font-bold text-bento-text-main tracking-tight uppercase">Vyberte období</h1>
            </div>
          </div>

          <button
            onClick={() => setIsAdding(true)}
            className="group flex items-center gap-3 bg-bento-accent text-white px-6 py-4 rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-black transition-all shadow-xl shadow-bento-accent/20 active:scale-95"
          >
            <div className="w-6 h-6 rounded-lg bg-white/20 flex items-center justify-center">
              <Plus className="w-4 h-4" />
            </div>
            Vytvořit období
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-10 h-10 animate-spin text-bento-accent" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {periods.map((period) => (
              <motion.div
                key={period.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                whileHover={{ scale: 1.01 }}
                className="group h-48 bg-white border border-bento-card-border rounded-[2.5rem] p-8 shadow-sm hover:shadow-xl hover:shadow-slate-200/50 transition-all cursor-pointer flex flex-col justify-between"
                onClick={() => onSelect(period)}
              >
                <div className="flex justify-between items-start">
                  <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center">
                    <Calendar className="w-5 h-5" />
                  </div>
                  
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingPeriodId(period.id);
                        setEditName(period.name);
                      }}
                      className="p-2 text-slate-400 hover:text-bento-accent hover:bg-slate-50 rounded-xl transition-all"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteConfirmId(period.id);
                      }}
                      className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div>
                  <h3 className="text-xl font-bold text-bento-text-main group-hover:text-bento-accent transition-colors truncate">
                    {period.name}
                  </h3>
                  <p className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted mt-1">
                    Vytvořeno: {new Date(period.createdAt).toLocaleDateString('cs-CZ')}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        )}

        {/* Create Dialog */}
        <AnimatePresence>
          {isAdding && (
            <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md flex items-center justify-center p-4 z-50">
              <motion.div
                initial={{ scale: 0.95, opacity: 0, y: 10 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 10 }}
                className="bg-white rounded-[2.5rem] p-10 max-w-sm w-full shadow-2xl border border-bento-card-border"
              >
                <div className="flex justify-between items-center mb-8">
                  <div>
                    <h2 className="text-2xl font-bold tracking-tight">Nové období</h2>
                    <p className="text-[10px] font-black uppercase tracking-widest text-bento-accent">Přihlášení sezóny</p>
                  </div>
                  <button onClick={() => setIsAdding(false)} className="p-2 text-slate-400 hover:bg-slate-50 rounded-xl transition-colors">
                    <Plus className="w-5 h-5 rotate-45" />
                  </button>
                </div>

                <div className="space-y-6">
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-3">Název období</label>
                    <input
                      autoFocus
                      type="text"
                      placeholder="např. Sezóna 24/25"
                      className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold focus:outline-none focus:ring-4 focus:ring-bento-accent/10 focus:border-bento-accent/50 transition-all"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addPeriod()}
                    />
                  </div>

                  <div className="space-y-4">
                    <button
                      onClick={() => setCopySettings(!copySettings)}
                      className="flex items-center gap-3 group/cb"
                    >
                      <div className={cn(
                        "w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all",
                        copySettings ? "bg-bento-accent border-bento-accent" : "border-slate-200 group-hover/cb:border-bento-accent/50"
                      )}>
                        {copySettings && <Plus className="w-4 h-4 text-white" />}
                      </div>
                      <span className="text-sm font-bold text-bento-text-main">Kopírovat nastavení</span>
                    </button>

                    <AnimatePresence>
                      {copySettings && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden space-y-4"
                        >
                          <div className="pt-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-3">Zdrojová kasa</label>
                            <select
                              value={sourceGroupId}
                              onChange={(e) => {
                                setSourceGroupId(e.target.value);
                                setSourcePeriodId('');
                              }}
                              className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold focus:outline-none focus:ring-4 focus:ring-bento-accent/10 focus:border-bento-accent/50 transition-all"
                            >
                              <option value="">Vyberte kasu...</option>
                              {groups.map(g => (
                                <option key={g.id} value={g.id}>{g.name}{g.id === group.id ? ' (Aktuální)' : ''}</option>
                              ))}
                            </select>
                          </div>

                          {sourceGroupId && (
                            <motion.div
                              initial={{ opacity: 0, y: -10 }}
                              animate={{ opacity: 1, y: 0 }}
                            >
                              <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-3">Zdrojové období</label>
                              <select
                                value={sourcePeriodId}
                                onChange={(e) => setSourcePeriodId(e.target.value)}
                                className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold focus:outline-none focus:ring-4 focus:ring-bento-accent/10 focus:border-bento-accent/50 transition-all"
                              >
                                <option value="">Vyberte období...</option>
                                {sourcePeriods.map(p => (
                                  <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                              </select>
                            </motion.div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={() => setIsAdding(false)}
                      className="flex-1 py-4 text-[10px] font-black uppercase tracking-widest text-bento-text-muted hover:bg-slate-50 rounded-2xl transition-all"
                    >
                      Zrušit
                    </button>
                    <button
                      onClick={addPeriod}
                      disabled={!newName.trim()}
                      className="flex-1 btn-bento-primary py-4 rounded-2xl shadow-xl shadow-bento-accent/10 disabled:opacity-50"
                    >
                      Vytvořit
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Edit Dialog */}
        <AnimatePresence>
          {editingPeriodId && (
            <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md flex items-center justify-center p-4 z-50">
              <motion.div
                initial={{ scale: 0.95, opacity: 0, y: 10 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 10 }}
                className="bg-white rounded-[2.5rem] p-10 max-w-sm w-full shadow-2xl border border-bento-card-border"
              >
                <div className="flex justify-between items-center mb-8">
                  <div>
                    <h2 className="text-2xl font-bold tracking-tight">Upravit období</h2>
                    <p className="text-[10px] font-black uppercase tracking-widest text-bento-accent">Změna názvu</p>
                  </div>
                  <button onClick={() => setEditingPeriodId(null)} className="p-2 text-slate-400 hover:bg-slate-50 rounded-xl">
                    <Plus className="w-5 h-5 rotate-45" />
                  </button>
                </div>

                <div className="space-y-6">
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-3">Název období</label>
                    <input
                      autoFocus
                      type="text"
                      className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold focus:outline-none focus:ring-4 focus:ring-bento-accent/10 focus:border-bento-accent/50 transition-all"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && updatePeriod(editingPeriodId)}
                    />
                  </div>
                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={() => setEditingPeriodId(null)}
                      className="flex-1 py-4 text-[10px] font-black uppercase tracking-widest text-bento-text-muted hover:bg-slate-50 rounded-2xl transition-all"
                    >
                      Zrušit
                    </button>
                    <button
                      onClick={() => updatePeriod(editingPeriodId)}
                      disabled={!editName.trim()}
                      className="flex-1 btn-bento-primary py-4 rounded-2xl shadow-xl shadow-bento-accent/10 disabled:opacity-50"
                    >
                      Uložit
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Delete Confirm */}
        <AnimatePresence>
          {deleteConfirmId && (
            <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md flex items-center justify-center p-4 z-50">
              <motion.div
                initial={{ scale: 0.95, opacity: 0, y: 10 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 10 }}
                className="bg-white rounded-[2.5rem] p-10 max-w-sm w-full shadow-2xl text-center border border-bento-card-border"
              >
                <div className="w-20 h-20 bg-rose-50 text-rose-500 rounded-3xl flex items-center justify-center mb-8 mx-auto">
                  <AlertTriangle className="w-10 h-10" />
                </div>
                <h2 className="text-2xl font-bold mb-3 tracking-tight">Smazat období?</h2>
                <p className="text-sm font-medium text-bento-text-muted mb-10 leading-relaxed px-4">
                  Odstraněním období smažete všechny <span className="text-rose-500 font-bold">pokuty a transakce</span> v něm obsažené. Akce je nevratná.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setDeleteConfirmId(null)}
                    className="flex-1 py-4 text-[10px] font-black uppercase tracking-widest text-bento-text-muted hover:bg-slate-50 rounded-2xl transition-all"
                  >
                    Zrušit
                  </button>
                  <button
                    onClick={() => deletePeriod(deleteConfirmId)}
                    className="flex-1 bg-rose-600 text-white text-[10px] font-black uppercase tracking-widest py-4 rounded-2xl hover:bg-rose-700 transition-all shadow-xl shadow-rose-600/10"
                  >
                    Smazat vše
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
