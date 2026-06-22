import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Group, OperationType } from '../types';
import { handleFirestoreError, cn } from '../utils';
import { Plus, Trash2, Edit2, LogOut, Folder, Loader2, AlertTriangle, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ThemeToggle from './ThemeToggle';

interface GroupSelectorProps {
  onSelect: (group: Group) => void;
  onLogout: () => void;
}

export default function GroupSelector({ onSelect, onLogout }: GroupSelectorProps) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.currentUser) return;

    const q = query(
      collection(db, 'groups'),
      where('ownerId', '==', auth.currentUser.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const groupsData = snapshot.docs.map(doc => ({
        ...doc.data(),
        id: doc.id
      })) as Group[];
      setGroups(groupsData);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'groups');
    });

    return unsubscribe;
  }, []);

  const addGroup = async () => {
    if (!newName.trim() || !auth.currentUser) return;
    try {
      await addDoc(collection(db, 'groups'), {
        name: newName.trim(),
        ownerId: auth.currentUser.uid,
        createdAt: serverTimestamp()
      });
      setNewName('');
      setIsAdding(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'groups');
    }
  };

  const updateGroup = async (id: string) => {
    if (!editName.trim()) return;
    try {
      await updateDoc(doc(db, 'groups', id), {
        name: editName.trim()
      });
      setEditingGroupId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `groups/${id}`);
    }
  };

  const deleteGroup = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'groups', id));
      console.log('Group deleted successfully:', id);
      setDeleteConfirmId(null);
    } catch (error) {
      console.error('Delete group error:', error);
      alert('Chyba při mazání kasy: ' + (error instanceof Error ? error.message : 'Neznámá chyba'));
      handleFirestoreError(error, OperationType.DELETE, `groups/${id}`);
    }
  };

  return (
    <div className="min-h-screen bg-bento-bg p-6 md:p-12 lg:p-20">
      <div className="max-w-[1200px] mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-16">
          <div>
            <h1 className="text-6xl font-black text-bento-text-main tracking-tighter mb-3 uppercase bg-gradient-to-r from-bento-text-main to-bento-accent bg-clip-text text-transparent">Moje Kasa</h1>
            <p className="text-bento-text-muted text-base max-w-sm">Vyberte skupinu nebo tým pro správu pokladny.</p>
          </div>
          <div className="flex items-center gap-4">
            <ThemeToggle />
            <button
              onClick={() => setIsAdding(true)}
              className="group flex items-center gap-3 bg-bento-accent text-white px-6 py-4 rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-black transition-all shadow-xl shadow-bento-accent/20 active:scale-95"
            >
              <div className="w-6 h-6 rounded-lg bg-white/20 flex items-center justify-center">
                <Plus className="w-4 h-4" />
              </div>
              Vytvořit kasu
            </button>
            <button
              onClick={onLogout}
              className="flex items-center gap-2 text-bento-text-muted hover:text-bento-text-main transition-colors px-6 py-4 rounded-2xl bg-white border border-bento-card-border shadow-sm"
            >
              <LogOut className="w-5 h-5" />
              <span className="font-bold text-sm uppercase tracking-widest">Odhlásit</span>
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-10 h-10 animate-spin text-bento-accent" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {/* Group Cards */}
            {groups.map((group) => (
              <motion.div
                key={group.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                whileHover={{ scale: 1.01 }}
                className="group h-56 bg-white border border-bento-card-border rounded-[2.5rem] p-8 shadow-sm hover:shadow-xl hover:shadow-slate-200/50 transition-all cursor-pointer flex flex-col justify-between"
                onClick={() => onSelect(group)}
              >
                <div className="flex justify-between items-start">
                  <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center">
                    <Folder className="w-5 h-5" />
                  </div>
                  
                  {/* Actions (visible on hover) */}
                  <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-all translate-x-2 group-hover:translate-x-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingGroupId(group.id);
                        setEditName(group.name);
                      }}
                      className="p-2.5 text-slate-400 hover:text-bento-accent hover:bg-slate-50 rounded-xl transition-all"
                    >
                      <Edit2 className="w-5 h-5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteConfirmId(group.id);
                      }}
                      className="p-2.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                <div>
                  <h3 className="text-xl font-bold text-bento-text-main group-hover:text-bento-accent transition-colors truncate">
                    {group.name}
                  </h3>
                  <p className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted mt-1">Vlastník: Vy</p>
                </div>
              </motion.div>
            ))}
          </div>
        )}

        {/* Create Dialog */}
        <AnimatePresence>
          {isAdding && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl"
              >
                <h2 className="text-2xl font-bold mb-6">Nová Kasa</h2>
                <div className="space-y-4">
                  <input
                    autoFocus
                    type="text"
                    placeholder="Název (např. Karviná, Škola)"
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addGroup()}
                  />
                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={() => setIsAdding(false)}
                      className="flex-1 px-4 py-3 text-slate-600 font-medium hover:bg-slate-50 rounded-xl transition-all"
                    >
                      Zrušit
                    </button>
                    <button
                      onClick={addGroup}
                      disabled={!newName.trim()}
                      className="flex-1 bg-blue-600 text-white font-bold py-3 rounded-xl disabled:opacity-50 hover:bg-blue-700 transition-all"
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
          {editingGroupId && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl"
              >
                <h2 className="text-2xl font-bold mb-6">Upravit Kasu</h2>
                <div className="space-y-4">
                  <input
                    autoFocus
                    type="text"
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && updateGroup(editingGroupId)}
                  />
                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={() => setEditingGroupId(null)}
                      className="flex-1 px-4 py-3 text-slate-600 font-medium hover:bg-slate-50 rounded-xl transition-all"
                    >
                      Zrušit
                    </button>
                    <button
                      onClick={() => updateGroup(editingGroupId)}
                      disabled={!editName.trim()}
                      className="flex-1 bg-blue-600 text-white font-bold py-3 rounded-xl disabled:opacity-50 hover:bg-blue-700 transition-all"
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
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl"
              >
                <div className="w-16 h-16 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mb-6 mx-auto">
                  <AlertTriangle className="w-8 h-8" />
                </div>
                <h2 className="text-2xl font-bold text-center mb-2">Smazat Kasu?</h2>
                <p className="text-slate-500 text-center mb-8">Tento krok nelze vzít zpět. Dojde ke smazání všech dat v této kase.</p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setDeleteConfirmId(null)}
                    className="flex-1 px-4 py-3 text-slate-600 font-medium hover:bg-slate-50 rounded-xl transition-all"
                  >
                    Zrušit
                  </button>
                  <button
                    onClick={() => deleteGroup(deleteConfirmId)}
                    className="flex-1 bg-red-600 text-white font-bold py-3 rounded-xl hover:bg-red-700 transition-all"
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
