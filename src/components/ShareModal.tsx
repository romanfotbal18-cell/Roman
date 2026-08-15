import React, { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { doc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Group, GroupMemberRole, OperationType } from '../types';
import { getUserRole, handleFirestoreError, generateShareCode, cn } from '../utils';
import { 
  Share2, 
  X, 
  UserPlus, 
  Eye, 
  Edit3, 
  Trash2, 
  Check, 
  Copy, 
  Info, 
  Loader2, 
  Crown,
  LogOut,
  Send,
  HelpCircle,
  ExternalLink,
  AlertTriangle,
  KeyRound,
  RefreshCw,
  MessageCircle,
  ShieldCheck
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface ShareModalProps {
  group: Group;
  user: User;
  isOpen: boolean;
  onClose: () => void;
  onLeave?: () => void;
}

export default function ShareModal({ group, user, isOpen, onClose, onLeave }: ShareModalProps) {
  const [emailInput, setEmailInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [isRegeneratingCode, setIsRegeneratingCode] = useState(false);

  // Local state for instant optimistic UI updates
  const [localSharedUsers, setLocalSharedUsers] = useState<GroupMemberRole[]>(group.sharedUsers || []);

  useEffect(() => {
    setLocalSharedUsers(group.sharedUsers || []);
  }, [group.sharedUsers]);

  const currentUserRole = getUserRole(group, user.email, user.uid);
  const isOwner = currentUserRole === 'owner';
  const canManage = isOwner || currentUserRole === 'editor';

  const [roleInput, setRoleInput] = useState<'editor' | 'viewer'>(isOwner ? 'editor' : 'viewer');

  useEffect(() => {
    if (!isOwner) {
      setRoleInput('viewer');
    }
  }, [isOwner]);

  // Ensure group has a shareCode
  useEffect(() => {
    if (!group.shareCode && isOwner && isOpen) {
      const newCode = generateShareCode();
      updateDoc(doc(db, 'groups', group.id), { shareCode: newCode }).catch(console.error);
    }
  }, [group.id, group.shareCode, isOwner, isOpen]);

  if (!isOpen) return null;

  const currentCode = group.shareCode || group.id;
  const joinLink = `${window.location.origin}${window.location.pathname}?join=${currentCode}`;

  const handleRegenerateCode = async () => {
    if (!isOwner) return;
    setIsRegeneratingCode(true);
    try {
      const newCode = generateShareCode();
      await updateDoc(doc(db, 'groups', group.id), { shareCode: newCode });
      setSuccessMsg(`Byl vygenerován nový kód kasy: ${newCode}`);
    } catch (err: any) {
      setErrorMsg('Chyba při změně kódu kasy: ' + (err.message || 'Neznámá chyba'));
    } finally {
      setIsRegeneratingCode(false);
    }
  };

  const copyDirectLink = () => {
    navigator.clipboard.writeText(joinLink);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const copyCodeOnly = () => {
    navigator.clipboard.writeText(currentCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const copyFullInvite = () => {
    const shareText = `Ahoj! Zvu tě ke sledování naší týmové kasy "${group.name}".\n\n📌 Kód kasy pro připojení: ${currentCode}\n🔗 Přímý odkaz pro otevření:\n${joinLink}\n\nPo přihlášení Google účtem se ti kasa automaticky otevře v režimu pro čtení (uvidíš přehledy, dluhy a statistiky).`;
    navigator.clipboard.writeText(shareText);
    setCopiedInvite(true);
    setTimeout(() => setCopiedInvite(false), 2500);
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const cleanEmail = emailInput.trim().toLowerCase();

    if (!cleanEmail) {
      setErrorMsg('Zadejte platnou e-mailovou adresu.');
      return;
    }

    if (!cleanEmail.includes('@') || !cleanEmail.includes('.')) {
      setErrorMsg('Formát e-mailu není správný.');
      return;
    }

    if (cleanEmail === (user.email || '').toLowerCase() || cleanEmail === (group.ownerEmail || '').toLowerCase()) {
      setErrorMsg('Nemůžete sdílet kasu sami se sebou (jste vlastníkem).');
      return;
    }

    if (localSharedUsers.some(u => u.email.toLowerCase() === cleanEmail)) {
      setErrorMsg('Tento e-mail již má k této kase přístup.');
      return;
    }

    const newRole = isOwner ? roleInput : 'viewer';
    const newEntry: GroupMemberRole = {
      email: cleanEmail,
      role: newRole,
      addedAt: Date.now()
    };

    setLocalSharedUsers(prev => [...prev, newEntry]);
    setIsSubmitting(true);

    try {
      const updatedShared = [...(group.sharedUsers || []), newEntry];
      const updatedAllowedEmails = Array.from(new Set([
        ...(group.allowedEmails || []),
        cleanEmail
      ]));
      const viewerEmails = updatedShared.filter(u => u.role === 'viewer' && u.email).map(u => u.email.toLowerCase());
      const viewerUids = updatedShared.filter(u => u.role === 'viewer' && u.uid).map(u => u.uid!);

      await updateDoc(doc(db, 'groups', group.id), {
        sharedUsers: updatedShared,
        allowedEmails: updatedAllowedEmails,
        viewerEmails,
        viewerUids,
        ownerEmail: group.ownerEmail || user.email || ''
      });

      setEmailInput('');
      setSuccessMsg(`Přístup v roli ${newRole === 'editor' ? 'Editor' : 'Čtenář'} byl úspěšně udělen pro ${cleanEmail}!`);
    } catch (err: any) {
      setLocalSharedUsers(group.sharedUsers || []);
      console.error('Error sharing group:', err);
      setErrorMsg('Chyba při sdílení kasy: ' + (err.message || 'Neznámá chyba'));
      handleFirestoreError(err, OperationType.UPDATE, `groups/${group.id}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateRole = async (targetEmail: string, newRole: 'editor' | 'viewer') => {
    if (!canManage) return;
    if (!isOwner) {
      setErrorMsg('Pouze vlastník kasy může měnit role uživatelům.');
      return;
    }
    const cleanTarget = targetEmail.toLowerCase();

    setLocalSharedUsers(prev => prev.map(u => (u.email?.toLowerCase() === cleanTarget) ? { ...u, role: newRole } : u));

    setIsSubmitting(true);
    try {
      const updatedShared = (group.sharedUsers || []).map(u => 
        (u.email?.toLowerCase() === cleanTarget) ? { ...u, role: newRole } : u
      );
      const viewerEmails = updatedShared.filter(u => u.role === 'viewer' && u.email).map(u => u.email.toLowerCase());
      const viewerUids = updatedShared.filter(u => u.role === 'viewer' && u.uid).map(u => u.uid!);

      await updateDoc(doc(db, 'groups', group.id), {
        sharedUsers: updatedShared,
        viewerEmails,
        viewerUids
      });
    } catch (err) {
      setLocalSharedUsers(group.sharedUsers || []);
      handleFirestoreError(err, OperationType.UPDATE, `groups/${group.id}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemoveUser = async (targetEmail: string) => {
    if (!canManage) return;
    const cleanTarget = targetEmail.toLowerCase();
    const targetUser = (group.sharedUsers || []).find(u => u.email?.toLowerCase() === cleanTarget);

    if (!isOwner && targetUser?.role === 'editor') {
      setErrorMsg('Jako editor nemůžete odebrat z kasy jiné editory.');
      return;
    }

    setLocalSharedUsers(prev => prev.filter(u => u.email?.toLowerCase() !== cleanTarget));

    setIsSubmitting(true);
    try {
      const updatedShared = (group.sharedUsers || []).filter(u => u.email?.toLowerCase() !== cleanTarget);
      const updatedAllowedEmails = (group.allowedEmails || []).filter(e => e.toLowerCase() !== cleanTarget);
      
      const removedUser = (group.sharedUsers || []).find(u => u.email?.toLowerCase() === cleanTarget);
      const updatedMemberUids = (group.memberUids || []).filter(uid => removedUser?.uid ? uid !== removedUser.uid : true);
      const viewerEmails = updatedShared.filter(u => u.role === 'viewer' && u.email).map(u => u.email.toLowerCase());
      const viewerUids = updatedShared.filter(u => u.role === 'viewer' && u.uid).map(u => u.uid!);

      await updateDoc(doc(db, 'groups', group.id), {
        sharedUsers: updatedShared,
        allowedEmails: updatedAllowedEmails,
        memberUids: updatedMemberUids,
        viewerEmails,
        viewerUids
      });
    } catch (err) {
      setLocalSharedUsers(group.sharedUsers || []);
      handleFirestoreError(err, OperationType.UPDATE, `groups/${group.id}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLeaveGroup = async () => {
    if (isOwner) return;

    setIsSubmitting(true);
    try {
      const userEmail = (user.email || '').toLowerCase();
      const userUid = user.uid || auth.currentUser?.uid || '';

      const updatedShared = (group.sharedUsers || []).filter(u => 
        (u.email ? u.email.toLowerCase() : '') !== userEmail && (userUid ? u.uid !== userUid : true)
      );
      const updatedAllowedEmails = (group.allowedEmails || []).filter(e => e.toLowerCase() !== userEmail);
      const updatedMemberUids = (group.memberUids || []).filter(uid => userUid ? uid !== userUid : true);
      const viewerEmails = updatedShared.filter(u => u.role === 'viewer' && u.email).map(u => u.email.toLowerCase());
      const viewerUids = updatedShared.filter(u => u.role === 'viewer' && u.uid).map(u => u.uid!);

      await updateDoc(doc(db, 'groups', group.id), {
        sharedUsers: updatedShared,
        allowedEmails: updatedAllowedEmails,
        memberUids: updatedMemberUids,
        viewerEmails,
        viewerUids
      });

      setShowLeaveConfirm(false);
      onClose();
      onLeave?.();
    } catch (err) {
      console.error('Error leaving group:', err);
      handleFirestoreError(err, OperationType.UPDATE, `groups/${group.id}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
        />

        {/* Dialog Window */}
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 15 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 15 }}
          className="relative w-full max-w-2xl bg-white rounded-[2.5rem] shadow-2xl p-6 md:p-8 overflow-hidden border border-slate-100 max-h-[90vh] flex flex-col"
        >
          {/* Header */}
          <div className="flex justify-between items-start mb-6 shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center shadow-inner">
                <Share2 className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-2xl font-black text-slate-900 tracking-tight">Sdílení kasy</h2>
                <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">
                  {group.name}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-2xl transition-all"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          <div className="overflow-y-auto custom-scrollbar pr-1 space-y-6 flex-1">
            {/* 1. READER QUICK SHARING SECTION (Code & Link) */}
            <div className="bg-gradient-to-br from-blue-50/90 via-indigo-50/50 to-slate-50 border border-blue-200/80 rounded-3xl p-5 md:p-6 space-y-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="p-1.5 bg-blue-600 text-white rounded-lg">
                    <KeyRound className="w-4 h-4" />
                  </span>
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-wider text-blue-950">
                      Rychlé sdílení pro čtenáře
                    </h3>
                    <p className="text-[11px] text-slate-500 font-medium">
                      Nemusíte ručně zadávat e-maily – kdokoliv se připojí přes kód nebo odkaz, získá roli Čtenáře.
                    </p>
                  </div>
                </div>

                <span className="px-2.5 py-1 bg-amber-100 text-amber-900 rounded-lg text-[10px] font-black uppercase tracking-wider flex items-center gap-1 shrink-0">
                  <Eye className="w-3 h-3 text-amber-700" /> Čtenář
                </span>
              </div>

              {/* Code Box & Direct Link Box */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                {/* Short Code Card */}
                <div className="p-4 bg-white border border-blue-100 rounded-2xl flex flex-col justify-between space-y-2 shadow-xs">
                  <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-slate-400">
                    <span>Kód kasy pro vstup</span>
                    {isOwner && (
                      <button
                        type="button"
                        onClick={handleRegenerateCode}
                        disabled={isRegeneratingCode}
                        title="Vygenerovat nový kód"
                        className="text-slate-400 hover:text-blue-600 flex items-center gap-1 transition-colors font-bold text-[9px]"
                      >
                        <RefreshCw className={cn("w-3 h-3", isRegeneratingCode && "animate-spin")} />
                        <span>Nový kód</span>
                      </button>
                    )}
                  </div>
                  
                  <div className="flex items-center justify-between gap-2 min-w-0">
                    <span className="font-mono text-base font-black tracking-wider text-slate-900 bg-slate-50 px-2.5 py-1.5 rounded-xl border border-slate-200/60 shrink-0">
                      {currentCode}
                    </span>
                    <button
                      type="button"
                      onClick={copyCodeOnly}
                      className="px-2.5 py-1.5 bg-slate-900 hover:bg-black text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 shadow-sm"
                    >
                      {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedCode ? 'Zkopírováno' : 'Kód'}</span>
                    </button>
                  </div>
                </div>

                {/* Direct Link Card */}
                <div className="p-4 bg-white border border-blue-100 rounded-2xl flex flex-col justify-between space-y-2 shadow-xs">
                  <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-slate-400">
                    <span>Přímý odkaz</span>
                    <ExternalLink className="w-3 h-3 text-slate-400" />
                  </div>
                  
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[11px] font-mono text-slate-600 truncate bg-slate-50 px-3 py-2 rounded-xl border border-slate-200/60 flex-1">
                      {joinLink}
                    </div>
                    <button
                      type="button"
                      onClick={copyDirectLink}
                      className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 shadow-sm"
                    >
                      {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedLink ? 'Zkopírováno' : 'Odkaz'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Full Chat Invitation Button */}
              <div className="pt-1 flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={copyFullInvite}
                  className="w-full py-2.5 px-4 bg-white hover:bg-blue-50 border border-blue-200 text-blue-800 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-xs"
                >
                  <MessageCircle className="w-4 h-4 text-emerald-600" />
                  {copiedInvite ? (
                    <span className="text-emerald-700 flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" /> Text pozvánky byl zkopírován do schránky!
                    </span>
                  ) : (
                    <span>Zkopírovat celou pozvánku (pro WhatsApp / SMS / Messenger)</span>
                  )}
                </button>
              </div>

              {/* Reader Explainer */}
              <div className="p-3 bg-white/80 border border-blue-200/60 rounded-2xl flex items-start gap-2.5 text-xs text-slate-600">
                <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <p className="leading-relaxed">
                  <strong>Bezpečný přístup Čtenáře:</strong> Přes tento kód a odkaz se kdokoliv dostane do kasy <em>pouze pro prohlížení</em> (vidí pokuty, platby a grafy, ale nemůže nic měnit ani mazat). <strong>Editora</strong> můžete pozvat níže zadáním jeho e-mailu.
                </p>
              </div>
            </div>

            {/* 2. INVITE EDITOR (OR SPECIFIC EMAIL) SECTION */}
            {canManage ? (
              <div className="bg-slate-50 border border-slate-200/80 rounded-3xl p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-blue-600" />
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">
                      Pozvat Editora nebo konkrétní e-mail
                    </h3>
                    <p className="text-[11px] text-slate-500 font-medium">
                      Roli Editora (plná práva na zápis pokut, plateb a úprav) může udělit pouze Vlastník kasy.
                    </p>
                  </div>
                </div>

                <form onSubmit={handleAddUser} className="space-y-3">
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1.5">
                      E-mailová adresa (Google účet)
                    </label>
                    <input
                      type="email"
                      placeholder="např. pokladnik@gmail.com"
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      className="w-full px-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1.5">
                      Oprávnění / Role pro tento e-mail
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        disabled={!isOwner}
                        onClick={() => {
                          if (isOwner) setRoleInput('editor');
                        }}
                        className={cn(
                          "p-3 rounded-2xl border-2 text-left transition-all flex flex-col justify-between gap-1",
                          roleInput === 'editor'
                            ? "border-blue-600 bg-blue-50/60 text-blue-900"
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
                          !isOwner && "opacity-50 cursor-not-allowed bg-slate-100"
                        )}
                        title={!isOwner ? "Roli Editora může udělit pouze Vlastník kasy" : undefined}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-extrabold text-xs flex items-center gap-1.5">
                            <Edit3 className="w-3.5 h-3.5 text-blue-600" />
                            Editor (Plný přístup)
                          </span>
                          {roleInput === 'editor' && <Check className="w-4 h-4 text-blue-600" />}
                        </div>
                        <span className="text-[10px] text-slate-500 font-medium">
                          {!isOwner ? 'Udělit může pouze Vlastník' : 'Může zapisovat pokuty, platby, výdaje a spravovat členy.'}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setRoleInput('viewer')}
                        className={cn(
                          "p-3 rounded-2xl border-2 text-left transition-all flex flex-col justify-between gap-1",
                          roleInput === 'viewer'
                            ? "border-amber-500 bg-amber-50/60 text-amber-900"
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-extrabold text-xs flex items-center gap-1.5">
                            <Eye className="w-3.5 h-3.5 text-amber-600" />
                            Čtenář (Pouze prohlížení)
                          </span>
                          {roleInput === 'viewer' && <Check className="w-4 h-4 text-amber-600" />}
                        </div>
                        <span className="text-[10px] text-slate-500 font-medium">
                          Může nahlížet na data, nic nemění ani nemaže.
                        </span>
                      </button>
                    </div>

                    {!isOwner && (
                      <p className="mt-2 text-[10px] text-amber-700 bg-amber-50 p-2.5 rounded-xl border border-amber-200 font-bold leading-relaxed">
                        Jako Editor můžete zvát nové členy pouze v roli Čtenáře. Roli Editora může udělit pouze Vlastník kasy.
                      </p>
                    )}
                  </div>

                  {errorMsg && (
                    <p className="text-xs font-bold text-rose-600 bg-rose-50 p-3 rounded-xl border border-rose-100">
                      {errorMsg}
                    </p>
                  )}

                  {successMsg && (
                    <p className="text-xs font-bold text-emerald-700 bg-emerald-50 p-3 rounded-xl border border-emerald-100">
                      {successMsg}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={isSubmitting || !emailInput.trim()}
                    className="w-full bg-blue-600 text-white font-black py-3.5 px-5 rounded-2xl text-xs uppercase tracking-wider hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/10 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isSubmitting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <UserPlus className="w-4 h-4" />
                    )}
                    Udělit přístup ke kase
                  </button>
                </form>
              </div>
            ) : (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-800 space-y-1">
                <p className="font-bold">Jste v režimu Pouze pro čtení</p>
                <p>Nové uživatele a editory může přidávat pouze Vlastník nebo Editor kasy.</p>
              </div>
            )}

            {/* 3. LIST OF USERS WITH ACCESS */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-500">
                  Kdo má přístup ({1 + localSharedUsers.length})
                </h3>
              </div>

              <div className="divide-y divide-slate-100 border border-slate-200/80 rounded-2xl bg-white overflow-hidden shadow-sm">
                {/* Owner Row */}
                <div className="p-4 flex items-center justify-between bg-slate-50/50">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center font-bold text-xs">
                      <Crown className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="font-bold text-xs text-slate-900">
                        {group.ownerEmail || 'Vlastník kasy'}
                      </p>
                      <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                        Vlastník (Zakladatel)
                      </p>
                    </div>
                  </div>
                  <span className="px-3 py-1 bg-amber-100 text-amber-800 text-[10px] font-black uppercase tracking-wider rounded-lg flex items-center gap-1">
                    <Crown className="w-3 h-3" /> Vlastník
                  </span>
                </div>

                {/* Shared Users Rows */}
                {localSharedUsers.map((su) => {
                  const isMe = user.email?.toLowerCase() === su.email.toLowerCase();

                  return (
                    <div key={su.email} className="p-4 flex items-center justify-between hover:bg-slate-50/60 transition-colors">
                      <div className="flex items-center gap-3 min-w-0 flex-1 pr-2">
                        <div className={cn(
                          "w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs shrink-0",
                          su.role === 'editor' ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"
                        )}>
                          {su.role === 'editor' ? <Edit3 className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-bold text-xs text-slate-900 truncate flex items-center gap-1.5">
                            {su.email}
                            {isMe && <span className="text-[10px] text-blue-600 font-black">(Vy)</span>}
                          </p>
                          <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                            {su.role === 'editor' ? 'Editor • Plný přístup' : 'Čtenář • Pouze prohlížení'}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {canManage ? (
                          <>
                            {/* Role Switcher */}
                            {!isOwner ? (
                              <span className={cn(
                                "px-2.5 py-1 text-[10px] font-black uppercase tracking-wider rounded-lg",
                                su.role === 'editor' ? "bg-blue-100 text-blue-800" : "bg-amber-100 text-amber-800"
                              )}>
                                {su.role === 'editor' ? 'Editor' : 'Čtenář'}
                              </span>
                            ) : (
                              <select
                                value={su.role}
                                onChange={(e) => handleUpdateRole(su.email, e.target.value as 'editor' | 'viewer')}
                                disabled={isSubmitting}
                                className="text-[11px] font-bold bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl px-2.5 py-1.5 cursor-pointer text-slate-700 focus:outline-none"
                              >
                                <option value="editor">Editor (Plný)</option>
                                <option value="viewer">Čtenář (Prohlížení)</option>
                              </select>
                            )}

                            {/* Remove button */}
                            {(!isOwner && su.role === 'editor') ? (
                              <span className="p-1.5 text-slate-300 cursor-not-allowed" title="Jako editor nemůžete odebrat jiného editora">
                                <Trash2 className="w-4 h-4 opacity-30" />
                              </span>
                            ) : (
                              <button
                                onClick={() => handleRemoveUser(su.email)}
                                disabled={isSubmitting}
                                title="Odebrat přístup"
                                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </>
                        ) : (
                          <span className={cn(
                            "px-2.5 py-1 text-[10px] font-black uppercase tracking-wider rounded-lg",
                            su.role === 'editor' ? "bg-blue-100 text-blue-800" : "bg-amber-100 text-amber-800"
                          )}>
                            {su.role === 'editor' ? 'Editor' : 'Čtenář'}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}

                {localSharedUsers.length === 0 && (
                  <div className="p-6 text-center text-slate-400">
                    <Info className="w-6 h-6 mx-auto mb-1 opacity-50" />
                    <p className="text-xs font-bold">Kasa zatím nebyla nikomu nasdílena.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Leave Group Button if user is shared viewer/editor */}
            {!isOwner && (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setShowLeaveConfirm(true)}
                  disabled={isSubmitting}
                  className="w-full py-3 px-4 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold rounded-2xl flex items-center justify-center gap-2 transition-all border border-rose-100 cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  Opustit tuto sdílenou kasu
                </button>
              </div>
            )}
          </div>
        </motion.div>

        {/* Leave Confirmation Modal Overlay */}
        <AnimatePresence>
          {showLeaveConfirm && (
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
                    Opravdu chcete opustit kasu <span className="font-bold text-slate-800">"{group.name}"</span>? Okamžitě přijdete o přístup ke všem datům a zpátky se nedostanete, dokud se znovu nepřipojíte přes kód nebo odkaz.
                  </p>
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowLeaveConfirm(false)}
                    disabled={isSubmitting}
                    className="flex-1 py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all cursor-pointer"
                  >
                    Zrušit
                  </button>
                  <button
                    type="button"
                    onClick={handleLeaveGroup}
                    disabled={isSubmitting}
                    className="flex-1 py-3 px-4 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-rose-600/20 cursor-pointer"
                  >
                    {isSubmitting ? (
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
    </AnimatePresence>
  );
}


