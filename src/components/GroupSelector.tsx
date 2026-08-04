import React, { useState, useEffect, FormEvent } from 'react';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, deleteDoc, doc, updateDoc, getDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Group, OperationType } from '../types';
import { handleFirestoreError, getUserRole, cn } from '../utils';
import { Plus, Trash2, Edit2, LogOut, Folder, Loader2, AlertTriangle, Share2, Crown, Edit3, Eye, Users, Link as LinkIcon, CheckCircle2, X, Search } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ThemeToggle from './ThemeToggle';
import ShareModal from './ShareModal';

interface GroupSelectorProps {
  onSelect: (group: Group) => void;
  onLogout: () => void;
}

export default function GroupSelector({ onSelect, onLogout }: GroupSelectorProps) {
  const [groupsMap, setGroupsMap] = useState<Record<string, Group>>({});
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [sharingGroup, setSharingGroup] = useState<Group | null>(null);

  // Join modal state
  const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);
  const [joinInput, setJoinInput] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinSuccess, setJoinSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.currentUser) return;
    const user = auth.currentUser;
    const userUid = user.uid;
    const userEmail = (user.email || '').toLowerCase();

    // Query 1: Owned groups
    const qOwner = query(
      collection(db, 'groups'),
      where('ownerId', '==', userUid)
    );

    // Query 2: Member UIDs contains userUid
    const qMember = query(
      collection(db, 'groups'),
      where('memberUids', 'array-contains', userUid)
    );

    // Query 3: Allowed emails contains userEmail
    const qEmail = userEmail ? query(
      collection(db, 'groups'),
      where('allowedEmails', 'array-contains', userEmail)
    ) : null;

    const mergeDocs = (snapshotDocs: any[]) => {
      setGroupsMap(prev => {
        const next = { ...prev };
        snapshotDocs.forEach(d => {
          const g = { id: d.id, ...d.data() } as Group;
          next[g.id] = g;

          // Auto-link user UID if email matched but UID wasn't in memberUids
          if (userEmail && g.allowedEmails?.includes(userEmail) && !g.memberUids?.includes(userUid)) {
            const updatedMemberUids = Array.from(new Set([...(g.memberUids || []), userUid]));
            const updatedSharedUsers = (g.sharedUsers || []).map(su => 
              su.email.toLowerCase() === userEmail ? { ...su, uid: userUid } : su
            );
            updateDoc(doc(db, 'groups', g.id), {
              memberUids: updatedMemberUids,
              sharedUsers: updatedSharedUsers
            }).catch(console.error);
          }
        });
        return next;
      });
      setLoading(false);
    };

    const unsubOwner = onSnapshot(qOwner, (snap) => mergeDocs(snap.docs), (err) => handleFirestoreError(err, OperationType.LIST, 'groups_owner'));
    const unsubMember = onSnapshot(qMember, (snap) => mergeDocs(snap.docs), (err) => handleFirestoreError(err, OperationType.LIST, 'groups_member'));
    const unsubEmail = qEmail ? onSnapshot(qEmail, (snap) => mergeDocs(snap.docs), (err) => handleFirestoreError(err, OperationType.LIST, 'groups_email')) : () => {};

    // Check URL for ?join=ID parameter
    const params = new URLSearchParams(window.location.search);
    const joinParam = params.get('join');
    if (joinParam) {
      setJoinInput(joinParam);
      setIsJoinModalOpen(true);
    }

    return () => {
      unsubOwner();
      unsubMember();
      unsubEmail();
    };
  }, []);

  const groups = (Object.values(groupsMap) as Group[]).sort((a, b) => a.name.localeCompare(b.name, 'cs-CZ'));

  const handleJoinByIdOrLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setJoinError(null);
    setJoinSuccess(null);

    let cleanId = joinInput.trim();
    if (!cleanId) return;

    if (cleanId.includes('join=')) {
      try {
        const url = new URL(cleanId);
        cleanId = url.searchParams.get('join') || cleanId;
      } catch {
        const match = cleanId.match(/join=([a-zA-Z0-9_-]+)/);
        if (match) cleanId = match[1];
      }
    }

    if (!auth.currentUser) return;
    const userEmail = (auth.currentUser.email || '').toLowerCase();
    const userUid = auth.currentUser.uid;

    setJoinLoading(true);
    try {
      const groupRef = doc(db, 'groups', cleanId);
      const snap = await getDoc(groupRef);

      if (!snap.exists()) {
        setJoinError('Kasa s tímto ID nebo odkazem nebyla nalezena. Zkontrolujte zadání.');
        return;
      }

      const gData = snap.data() as Omit<Group, 'id'>;
      const fetchedGroup: Group = { id: snap.id, ...gData };

      const isOwner = fetchedGroup.ownerId === userUid || (fetchedGroup.ownerEmail || '').toLowerCase() === userEmail;
      const isAllowedEmail = (fetchedGroup.allowedEmails || []).some(e => e.toLowerCase() === userEmail);
      const isMemberUid = (fetchedGroup.memberUids || []).includes(userUid);

      if (isOwner || isAllowedEmail || isMemberUid) {
        if (!isMemberUid) {
          const updatedMemberUids = Array.from(new Set([...(fetchedGroup.memberUids || []), userUid]));
          await updateDoc(groupRef, { memberUids: updatedMemberUids });
        }

        setGroupsMap(prev => ({ ...prev, [fetchedGroup.id]: fetchedGroup }));
        setJoinSuccess(`Úspěšně připojeno ke kase "${fetchedGroup.name}"!`);
        setTimeout(() => {
          setIsJoinModalOpen(false);
          onSelect(fetchedGroup);
        }, 1000);
      } else {
        setJoinError(`Kasa "${fetchedGroup.name}" existuje, ale váš přihlášený e-mail (${userEmail}) k ní nemá udělený přístup. Požádejte vlastníka kasy (${fetchedGroup.ownerEmail || 'zakladatele'}) o udělení přístupu.`);
      }
    } catch (err: any) {
      console.error('Error joining group:', err);
      setJoinError('Chyba při připojování ke kase: ' + (err.message || 'Neznámá chyba'));
    } finally {
      setJoinLoading(false);
    }
  };

  const addGroup = async () => {
    if (!newName.trim() || !auth.currentUser) return;
    try {
      await addDoc(collection(db, 'groups'), {
        name: newName.trim(),
        ownerId: auth.currentUser.uid,
        ownerEmail: auth.currentUser.email || '',
        memberUids: [auth.currentUser.uid],
        allowedEmails: auth.currentUser.email ? [auth.currentUser.email.toLowerCase()] : [],
        sharedUsers: [],
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
      setDeleteConfirmId(null);
      setGroupsMap(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
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
          <div className="flex flex-wrap items-center gap-3">
            <ThemeToggle />
            <button
              onClick={() => setIsJoinModalOpen(true)}
              className="flex items-center gap-2 bg-white text-slate-700 hover:text-blue-600 border border-bento-card-border px-5 py-4 rounded-2xl font-black text-sm uppercase tracking-wider hover:border-blue-300 transition-all shadow-sm"
            >
              <LinkIcon className="w-4 h-4 text-blue-600" />
              <span>Připojit přes odkaz</span>
            </button>
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
            {groups.map((group) => {
              const role = getUserRole(group, auth.currentUser?.email, auth.currentUser?.uid);
              const isOwner = role === 'owner';
              const isEditor = role === 'editor';
              const isViewer = role === 'viewer';
              const sharedCount = (group.sharedUsers || []).length;

              return (
                <motion.div
                  key={group.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileHover={{ scale: 1.01 }}
                  className="group bg-white border border-bento-card-border rounded-[2.5rem] p-8 shadow-sm hover:shadow-xl hover:shadow-slate-200/50 transition-all cursor-pointer flex flex-col justify-between h-64 relative overflow-hidden"
                  onClick={() => onSelect(group)}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center shadow-inner">
                        <Folder className="w-6 h-6" />
                      </div>
                      
                      {/* Role Pill Badge */}
                      {isOwner && (
                        <span className="px-3 py-1 bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-black uppercase tracking-wider rounded-xl flex items-center gap-1 shadow-sm">
                          <Crown className="w-3 h-3 text-amber-600" /> Vlastník
                        </span>
                      )}
                      {isEditor && (
                        <span className="px-3 py-1 bg-blue-50 border border-blue-200 text-blue-800 text-[10px] font-black uppercase tracking-wider rounded-xl flex items-center gap-1 shadow-sm">
                          <Edit3 className="w-3 h-3 text-blue-600" /> Editor
                        </span>
                      )}
                      {isViewer && (
                        <span className="px-3 py-1 bg-slate-100 border border-slate-200 text-slate-700 text-[10px] font-black uppercase tracking-wider rounded-xl flex items-center gap-1 shadow-sm">
                          <Eye className="w-3 h-3 text-amber-600" /> Čtenář
                        </span>
                      )}
                    </div>

                    {/* Quick Action Buttons */}
                    <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-all">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSharingGroup(group);
                        }}
                        title="Sdílet kasu"
                        className="p-2.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all"
                      >
                        <Share2 className="w-5 h-5" />
                      </button>

                      {(isOwner || isEditor) && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingGroupId(group.id);
                            setEditName(group.name);
                          }}
                          title="Upravit název"
                          className="p-2.5 text-slate-400 hover:text-bento-accent hover:bg-slate-50 rounded-xl transition-all"
                        >
                          <Edit2 className="w-5 h-5" />
                        </button>
                      )}

                      {isOwner && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConfirmId(group.id);
                          }}
                          title="Smazat kasu"
                          className="p-2.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-2xl font-black text-bento-text-main group-hover:text-bento-accent transition-colors truncate tracking-tight">
                      {group.name}
                    </h3>
                    
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
                      <p className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted">
                        {isOwner ? 'Vlastník: Vy' : `Vlastník: ${group.ownerEmail || 'Tým'}`}
                      </p>
                      
                      {sharedCount > 0 && (
                        <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2.5 py-0.5 rounded-md flex items-center gap-1">
                          <Users className="w-3 h-3" /> {sharedCount} {sharedCount === 1 ? 'osoba' : 'osob'}
                        </span>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}

            {groups.length === 0 && (
              <div className="col-span-full py-20 text-center bg-white border border-dashed border-slate-200 rounded-[2.5rem]">
                <Folder className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <h3 className="text-xl font-bold text-slate-700 mb-1">Zatím nemáte žádnou kasu</h3>
                <p className="text-slate-400 text-sm mb-6">Vytvořte novou kasu pro váš tým nebo si nechte nějakou nasdílet.</p>
                <button
                  onClick={() => setIsAdding(true)}
                  className="bg-bento-accent text-white px-6 py-3 rounded-2xl font-bold text-xs uppercase tracking-widest hover:bg-black transition-all inline-flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" /> Vytvořit první kasu
                </button>
              </div>
            )}
          </div>
        )}

        {/* Share Modal */}
        {sharingGroup && auth.currentUser && (
          <ShareModal
            group={sharingGroup}
            user={auth.currentUser}
            isOpen={!!sharingGroup}
            onClose={() => setSharingGroup(null)}
          />
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

        {/* Modal: Join via Link or ID */}
        <AnimatePresence>
          {isJoinModalOpen && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl relative"
              >
                <button
                  onClick={() => setIsJoinModalOpen(false)}
                  className="absolute top-6 right-6 p-2 text-slate-400 hover:text-slate-600 rounded-xl"
                >
                  <X className="w-5 h-5" />
                </button>

                <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mb-4">
                  <LinkIcon className="w-6 h-6" />
                </div>

                <h2 className="text-2xl font-black text-slate-900 mb-1 tracking-tight">Připojit se ke kase</h2>
                <p className="text-slate-500 text-xs mb-6">
                  Vložte odkaz nebo ID kasy, do které vám vlastník udělil přístup.
                </p>

                <form onSubmit={handleJoinByIdOrLink} className="space-y-4">
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1.5">
                      Odkaz nebo ID kasy
                    </label>
                    <input
                      type="text"
                      placeholder="Vložte odkaz (např. ?join=ID) nebo ID kasy..."
                      value={joinInput}
                      onChange={(e) => setJoinInput(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 text-slate-900 font-bold text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      autoFocus
                    />
                  </div>

                  {joinError && (
                    <p className="text-xs font-bold text-rose-600 bg-rose-50 p-3 rounded-xl border border-rose-100 leading-relaxed">
                      {joinError}
                    </p>
                  )}

                  {joinSuccess && (
                    <p className="text-xs font-bold text-emerald-700 bg-emerald-50 p-3 rounded-xl border border-emerald-100 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      {joinSuccess}
                    </p>
                  )}

                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setIsJoinModalOpen(false)}
                      className="flex-1 py-3.5 font-bold text-slate-500 hover:text-slate-800 text-xs uppercase tracking-wider"
                    >
                      Zrušit
                    </button>
                    <button
                      type="submit"
                      disabled={joinLoading || !joinInput.trim()}
                      className="flex-1 bg-blue-600 text-white font-black rounded-2xl py-3.5 text-xs uppercase tracking-wider hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/10 flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {joinLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                      Vyhledat & Otevřít
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Modal: Share Settings */}
        {sharingGroup && auth.currentUser && (
          <ShareModal
            group={sharingGroup}
            user={auth.currentUser}
            isOpen={!!sharingGroup}
            onClose={() => setSharingGroup(null)}
          />
        )}
      </div>
    </div>
  );
}
