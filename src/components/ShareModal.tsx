import React, { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Group, GroupMemberRole, OperationType } from '../types';
import { getUserRole, handleFirestoreError, cn } from '../utils';
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
  ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface ShareModalProps {
  group: Group;
  user: User;
  isOpen: boolean;
  onClose: () => void;
}

export default function ShareModal({ group, user, isOpen, onClose }: ShareModalProps) {
  const [emailInput, setEmailInput] = useState('');
  const [roleInput, setRoleInput] = useState<'editor' | 'viewer'>('editor');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Local state for instant optimistic UI updates (so deleted users vanish immediately!)
  const [localSharedUsers, setLocalSharedUsers] = useState<GroupMemberRole[]>(group.sharedUsers || []);

  useEffect(() => {
    setLocalSharedUsers(group.sharedUsers || []);
  }, [group.sharedUsers]);

  const currentUserRole = getUserRole(group, user.email, user.uid);
  const isOwner = currentUserRole === 'owner';
  const canManage = isOwner || currentUserRole === 'editor';

  if (!isOpen) return null;

  const joinLink = `${window.location.origin}${window.location.pathname}?join=${group.id}`;

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

    const newEntry: GroupMemberRole = {
      email: cleanEmail,
      role: roleInput,
      addedAt: Date.now()
    };

    // Optimistically add to local list immediately
    setLocalSharedUsers(prev => [...prev, newEntry]);
    setIsSubmitting(true);

    try {
      const updatedShared = [...(group.sharedUsers || []), newEntry];
      const updatedAllowedEmails = Array.from(new Set([
        ...(group.allowedEmails || []),
        cleanEmail
      ]));

      await updateDoc(doc(db, 'groups', group.id), {
        sharedUsers: updatedShared,
        allowedEmails: updatedAllowedEmails,
        ownerEmail: group.ownerEmail || user.email || ''
      });

      setEmailInput('');
      setSuccessMsg(`Přístup byl udělen pro ${cleanEmail}! Pošlete uživateli pozvánkový odkaz níže.`);
    } catch (err: any) {
      // Rollback on error
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
    const cleanTarget = targetEmail.toLowerCase();
    const targetUser = (group.sharedUsers || []).find(u => u.email.toLowerCase() === cleanTarget);

    if (!isOwner && targetUser?.role === 'editor') {
      setErrorMsg('Jako editor nemůžete měnit roli jiným editorům.');
      return;
    }

    // Optimistically update local state
    setLocalSharedUsers(prev => prev.map(u => u.email.toLowerCase() === cleanTarget ? { ...u, role: newRole } : u));

    setIsSubmitting(true);
    try {
      const updatedShared = (group.sharedUsers || []).map(u => 
        u.email.toLowerCase() === cleanTarget ? { ...u, role: newRole } : u
      );

      await updateDoc(doc(db, 'groups', group.id), {
        sharedUsers: updatedShared
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
    const targetUser = (group.sharedUsers || []).find(u => u.email.toLowerCase() === cleanTarget);

    if (!isOwner && targetUser?.role === 'editor') {
      setErrorMsg('Jako editor nemůžete odebrat z kasy jiné editory.');
      return;
    }

    // Optimistically remove from local state IMMEDIATELY so the row disappears at once!
    setLocalSharedUsers(prev => prev.filter(u => u.email.toLowerCase() !== cleanTarget));

    setIsSubmitting(true);
    try {
      const updatedShared = (group.sharedUsers || []).filter(u => u.email.toLowerCase() !== cleanTarget);
      const updatedAllowedEmails = (group.allowedEmails || []).filter(e => e.toLowerCase() !== cleanTarget);
      
      const removedUser = (group.sharedUsers || []).find(u => u.email.toLowerCase() === cleanTarget);
      const updatedMemberUids = (group.memberUids || []).filter(uid => uid !== removedUser?.uid);

      await updateDoc(doc(db, 'groups', group.id), {
        sharedUsers: updatedShared,
        allowedEmails: updatedAllowedEmails,
        memberUids: updatedMemberUids
      });
    } catch (err) {
      // Rollback on error
      setLocalSharedUsers(group.sharedUsers || []);
      handleFirestoreError(err, OperationType.UPDATE, `groups/${group.id}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLeaveGroup = async () => {
    if (isOwner) return;
    if (!confirm('Opravdu chcete opustit tuto sdílenou kasu? Přijdete k ní o přístup.')) return;

    setIsSubmitting(true);
    try {
      const userEmail = (user.email || '').toLowerCase();
      const updatedShared = (group.sharedUsers || []).filter(u => u.email.toLowerCase() !== userEmail && u.uid !== user.uid);
      const updatedAllowedEmails = (group.allowedEmails || []).filter(e => e.toLowerCase() !== userEmail);
      const updatedMemberUids = (group.memberUids || []).filter(uid => uid !== user.uid);

      await updateDoc(doc(db, 'groups', group.id), {
        sharedUsers: updatedShared,
        allowedEmails: updatedAllowedEmails,
        memberUids: updatedMemberUids
      });

      onClose();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `groups/${group.id}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyShareInfo = () => {
    const shareText = `Ahoj! Přidávám tě do týmové kasy "${group.name}".\n\nPřipoj se přihlášením přes svůj Google e-mail na tomto odkazu:\n${joinLink}`;
    navigator.clipboard.writeText(shareText);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
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
          className="relative w-full max-w-xl bg-white rounded-[2.5rem] shadow-2xl p-6 md:p-8 overflow-hidden border border-slate-100 max-h-[90vh] flex flex-col"
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
            {/* Direct Link Banner */}
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200/80 rounded-3xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Send className="w-4 h-4 text-blue-600" />
                  <h3 className="text-xs font-black uppercase tracking-wider text-blue-900">
                    Pozvánka kase a odkaz
                  </h3>
                </div>
                <button
                  onClick={copyShareInfo}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-blue-500/10 flex items-center gap-1.5 shrink-0"
                >
                  {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedLink ? 'Zkopírováno!' : 'Zkopírovat pozvánku'}
                </button>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed font-medium">
                Odkaz pošlete uživateli e-mailem nebo na WhatsApp. Jakmile se přihlásí se svým e-mailem, kasa se mu ihned otevře.
              </p>
              <div className="p-2.5 bg-white border border-blue-100 rounded-xl text-[11px] font-mono text-slate-600 truncate flex items-center justify-between">
                <span className="truncate pr-2">{joinLink}</span>
                <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              </div>
            </div>

            {/* Invite Form (only if Owner or Editor) */}
            {canManage ? (
              <div className="bg-slate-50 border border-slate-200/80 rounded-3xl p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-blue-600" />
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-700">
                    Udělit přístup novému e-mailu
                  </h3>
                </div>

                <form onSubmit={handleAddUser} className="space-y-3">
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1.5">
                      E-mailová adresa (Google účet)
                    </label>
                    <input
                      type="email"
                      placeholder="např. kamos@gmail.com"
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      className="w-full px-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1.5">
                      Oprávnění / Role
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setRoleInput('editor')}
                        className={cn(
                          "p-3 rounded-2xl border-2 text-left transition-all flex flex-col justify-between gap-1",
                          roleInput === 'editor'
                            ? "border-blue-600 bg-blue-50/60 text-blue-900"
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-extrabold text-xs flex items-center gap-1.5">
                            <Edit3 className="w-3.5 h-3.5 text-blue-600" />
                            Editor
                          </span>
                          {roleInput === 'editor' && <Check className="w-4 h-4 text-blue-600" />}
                        </div>
                        <span className="text-[10px] text-slate-500 font-medium">
                          Může zápis, úpravy, platby i členy.
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
                            Čtenář
                          </span>
                          {roleInput === 'viewer' && <Check className="w-4 h-4 text-amber-600" />}
                        </div>
                        <span className="text-[10px] text-slate-500 font-medium">
                          Pouze pro prohlížení, nic nemění.
                        </span>
                      </button>
                    </div>
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

                <div className="flex items-start gap-2 pt-1 text-[11px] text-slate-500">
                  <HelpCircle className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                  <p>
                    <strong>Poznámka:</strong> Aplikace neodesílá automatické e-maily. Po přidání e-mailu zašlete uživateli pozvánkový odkaz výše.
                  </p>
                </div>
              </div>
            ) : (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-800 space-y-1">
                <p className="font-bold">Jste v režimu Pouze pro čtení</p>
                <p>Nové uživatele může přidávat pouze Vlastník nebo Editor kasy.</p>
              </div>
            )}

            {/* List of Users with Access */}
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
                            {(!isOwner && su.role === 'editor') ? (
                              <span className="px-2.5 py-1 text-[10px] font-black uppercase tracking-wider rounded-lg bg-blue-100 text-blue-800">
                                Editor
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
                  onClick={handleLeaveGroup}
                  disabled={isSubmitting}
                  className="w-full py-3 px-4 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold rounded-2xl flex items-center justify-center gap-2 transition-all border border-rose-100"
                >
                  <LogOut className="w-4 h-4" />
                  Opustit tuto sdílenou kasu
                </button>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

