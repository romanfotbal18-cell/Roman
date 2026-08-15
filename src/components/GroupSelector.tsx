import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, deleteDoc, doc, updateDoc, getDoc, getDocs } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Group, GroupMemberRole, OperationType } from '../types';
import { handleFirestoreError, getUserRole, generateShareCode, cn } from '../utils';
import { 
  Plus, 
  Trash2, 
  Edit2, 
  LogOut, 
  Folder, 
  Loader2, 
  AlertTriangle, 
  Share2, 
  Crown, 
  Edit3, 
  Eye, 
  Users, 
  Link as LinkIcon, 
  CheckCircle2, 
  X, 
  Search,
  KeyRound,
  Copy,
  Check,
  ShieldCheck
} from 'lucide-react';
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
  const [leavingGroup, setLeavingGroup] = useState<Group | null>(null);
  const [isLeavingLoading, setIsLeavingLoading] = useState(false);
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);

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

          // Auto-generate shareCode if missing and user is owner
          if (!g.shareCode && g.ownerId === userUid) {
            const newCode = generateShareCode();
            updateDoc(doc(db, 'groups', g.id), { shareCode: newCode }).catch(console.error);
          }

          // Auto-link user UID if email matched but UID wasn't in memberUids
          if (userEmail && g.allowedEmails?.includes(userEmail) && !g.memberUids?.includes(userUid)) {
            const updatedMemberUids = Array.from(new Set([...(g.memberUids || []), userUid]));
            const updatedSharedUsers = (g.sharedUsers || []).map(su => 
              su.email.toLowerCase() === userEmail ? { ...su, uid: userUid } : su
            );
            const viewerEmails = updatedSharedUsers.filter(u => u.role === 'viewer' && u.email).map(u => u.email.toLowerCase());
            const viewerUids = updatedSharedUsers.filter(u => u.role === 'viewer' && u.uid).map(u => u.uid!);

            updateDoc(doc(db, 'groups', g.id), {
              memberUids: updatedMemberUids,
              sharedUsers: updatedSharedUsers,
              viewerEmails,
              viewerUids
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

    // Check URL for ?join= parameter
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

    let rawInput = joinInput.trim();
    if (!rawInput) return;

    // Parse URL if user pasted full link
    if (rawInput.includes('join=')) {
      try {
        const url = new URL(rawInput);
        rawInput = url.searchParams.get('join') || rawInput;
      } catch {
        const match = rawInput.match(/join=([a-zA-Z0-9_-]+)/);
        if (match) rawInput = match[1];
      }
    }

    if (!auth.currentUser) return;
    const userEmail = (auth.currentUser.email || '').toLowerCase();
    const userUid = auth.currentUser.uid;

    setJoinLoading(true);
    try {
      let matchedGroupDoc: any = null;

      // 1. Try finding group by shareCode (case-insensitive search)
      const upperCode = rawInput.toUpperCase();
      const codeQuery = query(collection(db, 'groups'), where('shareCode', '==', upperCode));
      const codeSnap = await getDocs(codeQuery);

      if (!codeSnap.empty) {
        matchedGroupDoc = codeSnap.docs[0];
      } else {
        // Also check exact case shareCode
        const exactCodeQuery = query(collection(db, 'groups'), where('shareCode', '==', rawInput));
        const exactCodeSnap = await getDocs(exactCodeQuery);
        if (!exactCodeSnap.empty) {
          matchedGroupDoc = exactCodeSnap.docs[0];
        }
      }

      // 2. If not found by shareCode, try finding by document ID
      if (!matchedGroupDoc) {
        try {
          const directRef = doc(db, 'groups', rawInput);
          const directSnap = await getDoc(directRef);
          if (directSnap.exists()) {
            matchedGroupDoc = directSnap;
          }
        } catch {
          // Direct ID lookup failed
        }
      }

      if (!matchedGroupDoc || !matchedGroupDoc.exists()) {
        setJoinError('Kasa s tímto kódem nebo odkazem nebyla nalezena. Zkontrolujte prosím správnost kódu.');
        return;
      }

      const gData = matchedGroupDoc.data() as Omit<Group, 'id'>;
      const fetchedGroup: Group = { id: matchedGroupDoc.id, ...gData };

      const isOwner = fetchedGroup.ownerId === userUid || (fetchedGroup.ownerEmail || '').toLowerCase() === userEmail;
      const isMember = (fetchedGroup.memberUids || []).includes(userUid);
      const isAllowedEmail = userEmail && (fetchedGroup.allowedEmails || []).some(e => e.toLowerCase() === userEmail);

      // If user is already registered in group, open right away
      if (isOwner || isMember || isAllowedEmail) {
        if (!isMember) {
          const updatedMemberUids = Array.from(new Set([...(fetchedGroup.memberUids || []), userUid]));
          await updateDoc(doc(db, 'groups', fetchedGroup.id), { memberUids: updatedMemberUids });
        }

        setGroupsMap(prev => ({ ...prev, [fetchedGroup.id]: fetchedGroup }));
        setJoinSuccess(`Otevírám kasu "${fetchedGroup.name}"...`);

        // Clean query parameter from URL
        window.history.replaceState({}, document.title, window.location.pathname);

        setTimeout(() => {
          setIsJoinModalOpen(false);
          onSelect(fetchedGroup);
        }, 800);
        return;
      }

      // User is new -> Auto-join as 'viewer' (Read-only access)
      const newSharedEntry: GroupMemberRole = {
        email: userEmail || 'Host',
        uid: userUid,
        role: 'viewer',
        addedAt: Date.now()
      };

      const updatedSharedUsers = [...(fetchedGroup.sharedUsers || []), newSharedEntry];
      const updatedMemberUids = Array.from(new Set([...(fetchedGroup.memberUids || []), userUid]));
      const updatedViewerUids = Array.from(new Set([...(fetchedGroup.viewerUids || []), userUid]));
      const updatedViewerEmails = userEmail 
        ? Array.from(new Set([...(fetchedGroup.viewerEmails || []).map(e => e.toLowerCase()), userEmail]))
        : (fetchedGroup.viewerEmails || []);
      const updatedAllowedEmails = userEmail
        ? Array.from(new Set([...(fetchedGroup.allowedEmails || []).map(e => e.toLowerCase()), userEmail]))
        : (fetchedGroup.allowedEmails || []);

      await updateDoc(doc(db, 'groups', fetchedGroup.id), {
        sharedUsers: updatedSharedUsers,
        memberUids: updatedMemberUids,
        viewerUids: updatedViewerUids,
        viewerEmails: updatedViewerEmails,
        allowedEmails: updatedAllowedEmails
      });

      const joinedGroup: Group = {
        ...fetchedGroup,
        sharedUsers: updatedSharedUsers,
        memberUids: updatedMemberUids,
        viewerUids: updatedViewerUids,
        viewerEmails: updatedViewerEmails,
        allowedEmails: updatedAllowedEmails
      };

      setGroupsMap(prev => ({ ...prev, [joinedGroup.id]: joinedGroup }));
      setJoinSuccess(`Úspěšně jste se připojili ke kase "${joinedGroup.name}" jako Čtenář!`);

      // Clean query parameter from URL
      window.history.replaceState({}, document.title, window.location.pathname);

      setTimeout(() => {
        setIsJoinModalOpen(false);
        onSelect(joinedGroup);
      }, 1000);
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
      const shareCode = generateShareCode();
      await addDoc(collection(db, 'groups'), {
        name: newName.trim(),
        ownerId: auth.currentUser.uid,
        ownerEmail: auth.currentUser.email || '',
        shareCode: shareCode,
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

  const handleConfirmLeaveGroup = async () => {
    if (!leavingGroup || !auth.currentUser) return;
    const user = auth.currentUser;
    const userEmail = (user.email || '').toLowerCase();
    const userUid = user.uid;
    const gId = leavingGroup.id;

    setIsLeavingLoading(true);
    try {
      const updatedShared = (leavingGroup.sharedUsers || []).filter(u => 
        (u.email ? u.email.toLowerCase() : '') !== userEmail && (userUid ? u.uid !== userUid : true)
      );
      const updatedAllowedEmails = (leavingGroup.allowedEmails || []).filter(e => e.toLowerCase() !== userEmail);
      const updatedMemberUids = (leavingGroup.memberUids || []).filter(uid => userUid ? uid !== userUid : true);
      const viewerEmails = updatedShared.filter(u => u.role === 'viewer' && u.email).map(u => u.email.toLowerCase());
      const viewerUids = updatedShared.filter(u => u.role === 'viewer' && u.uid).map(u => u.uid!);

      await updateDoc(doc(db, 'groups', gId), {
        sharedUsers: updatedShared,
        allowedEmails: updatedAllowedEmails,
        memberUids: updatedMemberUids,
        viewerEmails,
        viewerUids
      });

      setGroupsMap(prev => {
        const next = { ...prev };
        delete next[gId];
        return next;
      });
      setLeavingGroup(null);
    } catch (err) {
      console.error('Error leaving group:', err);
      handleFirestoreError(err, OperationType.UPDATE, `groups/${gId}`);
    } finally {
      setIsLeavingLoading(false);
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

  const handleCopyCode = (e: React.MouseEvent, group: Group) => {
    e.stopPropagation();
    const code = group.shareCode || group.id;
    navigator.clipboard.writeText(code);
    setCopiedCodeId(group.id);
    setTimeout(() => setCopiedCodeId(null), 2000);
  };

  return (
    <div className="min-h-screen bg-bento-bg p-6 md:p-12 lg:p-20">
      <div className="max-w-[1200px] mx-auto">
        {/* Top Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-16">
          <div>
            <h1 className="text-6xl font-black text-bento-text-main tracking-tighter mb-3 uppercase bg-gradient-to-r from-bento-text-main to-bento-accent bg-clip-text text-transparent">
              Moje Kasa
            </h1>
            <p className="text-bento-text-muted text-base max-w-sm">
              Vyberte skupinu nebo tým pro správu pokladny.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <ThemeToggle />

            {/* Quick Join Button */}
            <button
              onClick={() => {
                setJoinError(null);
                setJoinSuccess(null);
                setJoinInput('');
                setIsJoinModalOpen(true);
              }}
              className="flex items-center gap-2 bg-white text-slate-700 hover:text-blue-600 border border-bento-card-border px-5 py-4 rounded-2xl font-black text-sm uppercase tracking-wider hover:border-blue-300 transition-all shadow-sm cursor-pointer"
            >
              <KeyRound className="w-4 h-4 text-blue-600" />
              <span>Zadat kód kasy</span>
            </button>

            {/* Create Cashbox Button */}
            <button
              onClick={() => setIsAdding(true)}
              className="group flex items-center gap-3 bg-bento-accent text-white px-6 py-4 rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-black transition-all shadow-xl shadow-bento-accent/20 active:scale-95 cursor-pointer"
            >
              <div className="w-6 h-6 rounded-lg bg-white/20 flex items-center justify-center">
                <Plus className="w-4 h-4" />
              </div>
              Vytvořit kasu
            </button>

            {/* Logout Button */}
            <button
              onClick={onLogout}
              className="flex items-center gap-2 text-bento-text-muted hover:text-bento-text-main transition-colors px-6 py-4 rounded-2xl bg-white border border-bento-card-border shadow-sm cursor-pointer"
            >
              <LogOut className="w-5 h-5" />
              <span className="font-bold text-sm uppercase tracking-widest">Odhlásit</span>
            </button>
          </div>
        </div>

        {/* Loading Spinner */}
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
              const displayCode = group.shareCode || group.id.substring(0, 6).toUpperCase();
              const isCopied = copiedCodeId === group.id;

              return (
                <motion.div
                  key={group.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileHover={{ scale: 1.01 }}
                  className="group bg-white border border-bento-card-border rounded-[2.5rem] p-8 shadow-sm hover:shadow-xl hover:shadow-slate-200/50 transition-all cursor-pointer flex flex-col justify-between h-72 relative overflow-hidden"
                  onClick={() => onSelect(group)}
                >
                  {/* Top Bar inside Card */}
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <div className="w-11 h-11 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center shadow-inner shrink-0">
                        <Folder className="w-5 h-5" />
                      </div>
                      
                      {/* Role Pill Badge */}
                      {isOwner && (
                        <span className="px-2.5 py-1 bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-black uppercase tracking-wider rounded-xl flex items-center gap-1 shadow-xs">
                          <Crown className="w-3 h-3 text-amber-600" /> Vlastník
                        </span>
                      )}
                      {isEditor && (
                        <span className="px-2.5 py-1 bg-blue-50 border border-blue-200 text-blue-800 text-[10px] font-black uppercase tracking-wider rounded-xl flex items-center gap-1 shadow-xs">
                          <Edit3 className="w-3 h-3 text-blue-600" /> Editor
                        </span>
                      )}
                      {isViewer && (
                        <span className="px-2.5 py-1 bg-slate-100 border border-slate-200 text-slate-700 text-[10px] font-black uppercase tracking-wider rounded-xl flex items-center gap-1 shadow-xs">
                          <Eye className="w-3 h-3 text-amber-600" /> Čtenář
                        </span>
                      )}
                    </div>

                    {/* Quick Action Buttons */}
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSharingGroup(group);
                        }}
                        title="Sdílet kasu"
                        className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all"
                      >
                        <Share2 className="w-4 h-4" />
                      </button>

                      {(isOwner || isEditor) && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingGroupId(group.id);
                            setEditName(group.name);
                          }}
                          title="Upravit název"
                          className="p-2 text-slate-400 hover:text-bento-accent hover:bg-slate-50 rounded-xl transition-all"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                      )}

                      {isOwner && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConfirmId(group.id);
                          }}
                          title="Smazat kasu"
                          className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}

                      {!isOwner && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setLeavingGroup(group);
                          }}
                          title="Opustit kasu"
                          className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all"
                        >
                          <LogOut className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Share Code Bar */}
                  <div className="my-auto">
                    <div 
                      onClick={(e) => handleCopyCode(e, group)}
                      title="Kliknutím zkopírujete kód kasy pro sdílení"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-50 hover:bg-blue-50 border border-slate-200/80 hover:border-blue-200 rounded-lg text-slate-600 hover:text-blue-700 transition-colors text-[11px] font-mono font-bold mb-2 cursor-pointer"
                    >
                      <KeyRound className="w-3 h-3 text-slate-400" />
                      <span>Kód: {displayCode}</span>
                      {isCopied ? <Check className="w-3 h-3 text-emerald-600 ml-1" /> : <Copy className="w-3 h-3 text-slate-400 opacity-60 hover:opacity-100 ml-1" />}
                    </div>

                    <h3 className="text-2xl font-black text-bento-text-main group-hover:text-bento-accent transition-colors truncate tracking-tight">
                      {group.name}
                    </h3>
                  </div>

                  {/* Bottom Info Bar */}
                  <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                    <p className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted truncate max-w-[150px]">
                      {isOwner ? 'Vlastník: Vy' : `Vlastník: ${group.ownerEmail || 'Tým'}`}
                    </p>
                    
                    {sharedCount > 0 && (
                      <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2.5 py-0.5 rounded-md flex items-center gap-1 shrink-0">
                        <Users className="w-3 h-3" /> {sharedCount} {sharedCount === 1 ? 'člen' : sharedCount < 5 ? 'členové' : 'členů'}
                      </span>
                    )}
                  </div>
                </motion.div>
              );
            })}

            {/* Empty State */}
            {groups.length === 0 && (
              <div className="col-span-full py-20 text-center bg-white border border-dashed border-slate-200 rounded-[2.5rem] p-8">
                <Folder className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <h3 className="text-xl font-bold text-slate-700 mb-1">Zatím nemáte žádnou kasu</h3>
                <p className="text-slate-400 text-sm mb-6 max-w-md mx-auto">
                  Vytvořte novou kasu pro váš tým nebo se připojte ke stávající kase zadáním jejího 6-místného kódu.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <button
                    onClick={() => setIsAdding(true)}
                    className="bg-bento-accent text-white px-6 py-3.5 rounded-2xl font-bold text-xs uppercase tracking-widest hover:bg-black transition-all inline-flex items-center gap-2 cursor-pointer shadow-lg shadow-bento-accent/10"
                  >
                    <Plus className="w-4 h-4" /> Vytvořit první kasu
                  </button>
                  <button
                    onClick={() => setIsJoinModalOpen(true)}
                    className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-6 py-3.5 rounded-2xl font-bold text-xs uppercase tracking-widest transition-all inline-flex items-center gap-2 cursor-pointer"
                  >
                    <KeyRound className="w-4 h-4" /> Zadat kód kasy
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Modal: Share Settings */}
        {sharingGroup && auth.currentUser && (
          <ShareModal
            group={sharingGroup}
            user={auth.currentUser}
            isOpen={!!sharingGroup}
            onClose={() => setSharingGroup(null)}
          />
        )}

        {/* Modal: Create Group Dialog */}
        <AnimatePresence>
          {isAdding && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl"
              >
                <h2 className="text-2xl font-black text-slate-900 mb-2 tracking-tight">Nová kasa</h2>
                <p className="text-slate-500 text-xs mb-6">Zadejte název pro novou pokladnu.</p>
                
                <input
                  type="text"
                  placeholder="např. Fotbalový tým, Kancelář..."
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addGroup()}
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 text-slate-900 font-bold text-sm mb-6 focus:outline-none focus:ring-2 focus:ring-bento-accent"
                  autoFocus
                />
                
                <div className="flex gap-3">
                  <button
                    onClick={() => setIsAdding(false)}
                    className="flex-1 py-3 font-bold text-slate-500 hover:text-slate-800 text-xs uppercase tracking-wider cursor-pointer"
                  >
                    Zrušit
                  </button>
                  <button
                    onClick={addGroup}
                    disabled={!newName.trim()}
                    className="flex-1 bg-bento-accent text-white font-black rounded-2xl py-3 text-xs uppercase tracking-wider hover:bg-black transition-all disabled:opacity-50 cursor-pointer shadow-lg shadow-bento-accent/20"
                  >
                    Vytvořit
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Modal: Edit Group Name Dialog */}
        <AnimatePresence>
          {editingGroupId && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl"
              >
                <h2 className="text-2xl font-black text-slate-900 mb-2 tracking-tight">Upravit název</h2>
                <p className="text-slate-500 text-xs mb-6">Změňte název pokladny.</p>
                
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && updateGroup(editingGroupId)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 text-slate-900 font-bold text-sm mb-6 focus:outline-none focus:ring-2 focus:ring-bento-accent"
                  autoFocus
                />
                
                <div className="flex gap-3">
                  <button
                    onClick={() => setEditingGroupId(null)}
                    className="flex-1 py-3 font-bold text-slate-500 hover:text-slate-800 text-xs uppercase tracking-wider cursor-pointer"
                  >
                    Zrušit
                  </button>
                  <button
                    onClick={() => updateGroup(editingGroupId)}
                    disabled={!editName.trim()}
                    className="flex-1 bg-bento-accent text-white font-black rounded-2xl py-3 text-xs uppercase tracking-wider hover:bg-black transition-all disabled:opacity-50 cursor-pointer shadow-lg shadow-bento-accent/20"
                  >
                    Uložit
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Modal: Delete Group Confirmation */}
        <AnimatePresence>
          {deleteConfirmId && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl text-center space-y-4"
              >
                <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-900 tracking-tight">Smazat pokladnu?</h2>
                  <p className="text-slate-500 text-xs mt-2 leading-relaxed">
                    Opravdu chcete smazat tuto kasu? Tato akce je nevratná a smaže všechna data, období i pokuty.
                  </p>
                </div>
                
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => setDeleteConfirmId(null)}
                    className="flex-1 py-3 font-bold text-slate-500 hover:text-slate-800 text-xs uppercase tracking-wider cursor-pointer"
                  >
                    Zrušit
                  </button>
                  <button
                    onClick={() => deleteGroup(deleteConfirmId)}
                    className="flex-1 bg-rose-600 text-white font-black rounded-2xl py-3 text-xs uppercase tracking-wider hover:bg-rose-700 transition-all cursor-pointer shadow-lg shadow-rose-600/20"
                  >
                    Smazat
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Modal: Join Group by Code or Link */}
        <AnimatePresence>
          {isJoinModalOpen && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-white rounded-[2.5rem] p-8 max-w-md w-full shadow-2xl border border-slate-100"
              >
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center shadow-inner">
                      <KeyRound className="w-6 h-6" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-black text-slate-900 tracking-tight">Připojit se ke kase</h2>
                      <p className="text-slate-400 text-xs font-bold uppercase tracking-wider">
                        Rychlý přístup pro čtenáře
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setIsJoinModalOpen(false)}
                    className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="p-3 bg-blue-50/80 border border-blue-200/60 rounded-2xl flex items-start gap-2.5 text-xs text-blue-900 mb-5">
                  <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                  <p className="leading-relaxed font-medium">
                    Zadejte <strong>kód kasy</strong> (např. <code>K8M4P2</code>) nebo vložte pozvánkový odkaz. Připojíte se automaticky v roli <strong>Čtenáře</strong> (prohlížení financí a pokut).
                  </p>
                </div>

                <form onSubmit={handleJoinByIdOrLink} className="space-y-4">
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1.5">
                      Kód kasy nebo odkaz
                    </label>
                    <input
                      type="text"
                      placeholder="např. K8M4P2 nebo vložte odkaz..."
                      value={joinInput}
                      onChange={(e) => setJoinInput(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 text-slate-900 font-bold text-sm tracking-wide focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase placeholder:normal-case placeholder:font-normal placeholder:tracking-normal"
                      autoFocus
                    />
                  </div>

                  {joinError && (
                    <p className="text-xs font-bold text-rose-600 bg-rose-50 p-3.5 rounded-xl border border-rose-100 leading-relaxed">
                      {joinError}
                    </p>
                  )}

                  {joinSuccess && (
                    <p className="text-xs font-bold text-emerald-700 bg-emerald-50 p-3.5 rounded-xl border border-emerald-100 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>{joinSuccess}</span>
                    </p>
                  )}

                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setIsJoinModalOpen(false)}
                      className="flex-1 py-3.5 font-bold text-slate-500 hover:text-slate-800 text-xs uppercase tracking-wider cursor-pointer"
                    >
                      Zrušit
                    </button>
                    <button
                      type="submit"
                      disabled={joinLoading || !joinInput.trim()}
                      className="flex-1 bg-blue-600 text-white font-black rounded-2xl py-3.5 text-xs uppercase tracking-wider hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/10 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                    >
                      {joinLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                      Připojit se
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Modal: Leave Group Confirmation */}
        <AnimatePresence>
          {leavingGroup && (
            <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white rounded-3xl p-6 max-w-sm w-full border border-slate-200 shadow-2xl text-center space-y-4"
              >
                <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900">Opustit sdílenou kasu?</h3>
                  <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                    Opravdu chcete opustit kasu <span className="font-bold text-slate-800">"{leavingGroup.name}"</span>? Okamžitě přijdete o přístup ke všem datům a zpátky se nedostanete, dokud se znovu nepřipojíte přes kód nebo odkaz.
                  </p>
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setLeavingGroup(null)}
                    disabled={isLeavingLoading}
                    className="flex-1 py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all cursor-pointer"
                  >
                    Zrušit
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmLeaveGroup}
                    disabled={isLeavingLoading}
                    className="flex-1 py-3 px-4 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-rose-600/20 cursor-pointer"
                  >
                    {isLeavingLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <LogOut className="w-4 h-4" />
                        Ano, opustit
                      </>
                    )}
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
