import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, onSnapshot, addDoc, deleteDoc, doc, updateDoc, writeBatch, getDocs, where, setDoc, orderBy } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Group, Member, FineTemplate, OperationType, Period, MemberGroup, Event, GroupMemberRole } from '../types';
import { handleFirestoreError, cn, getUserRole, getCurrencySymbol, formatCurrency } from '../utils';
import { Plus, Trash2, Edit2, Users, ReceiptText, AlertTriangle, X, Hash, ChevronDown, Save, CheckSquare, Square, Copy, Check, Loader2, Layers, GripVertical, Calendar as CalendarIcon, Info, ChevronLeft, ChevronRight, Cake, Share2, Crown, Eye, Edit3, UserPlus, LogOut, Coins } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { SortableItem } from './SortableItem';
import ShareModal from './ShareModal';

interface SettingsProps {
  group: Group;
  period: Period;
}

export default function Settings({ group, period }: SettingsProps) {
  const [members, setMembers] = useState<Member[]>([]);
  const [templates, setTemplates] = useState<FineTemplate[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [memberGroups, setMemberGroups] = useState<MemberGroup[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [activeTab, setActiveTab] = useState<'members' | 'templates' | 'events' | 'sharing'>('templates');

  const userRole = getUserRole(group, auth.currentUser?.email, auth.currentUser?.uid);
  const isReadOnly = userRole === 'viewer';
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);

  // Currency Settings
  const currentCurrency = group.currency || 'CZK';
  const [isUpdatingCurrency, setIsUpdatingCurrency] = useState(false);

  const handleCurrencyChange = async (newCurrency: string) => {
    if (isReadOnly || isUpdatingCurrency) return;
    const cleanCurrency = newCurrency.trim().toUpperCase();
    if (!cleanCurrency) return;
    setIsUpdatingCurrency(true);
    try {
      await updateDoc(doc(db, 'groups', group.id), {
        currency: cleanCurrency
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `groups/${group.id}`);
    } finally {
      setIsUpdatingCurrency(false);
    }
  };

  // Event Modal State
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [eventName, setEventName] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [eventDescription, setEventDescription] = useState('');
  const [eventIsImportant, setEventIsImportant] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);

  // Event filters
  const [eventSearchTerm, setEventSearchTerm] = useState('');
  const [eventFilter, setEventFilter] = useState<'all' | 'important' | 'birthdays'>('all');

  // Calendar state
  const [calendarDate, setCalendarDate] = useState(new Date());

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Batch actions state
  const [isBatchCopyModalOpen, setIsBatchCopyModalOpen] = useState(false);
  const [targetGroupId, setTargetGroupId] = useState('');
  const [targetPeriods, setTargetPeriods] = useState<Period[]>([]);
  const [targetPeriodId, setTargetPeriodId] = useState('');
  const [isBatchDeleteConfirmOpen, setIsBatchDeleteConfirmOpen] = useState(false);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);

  // Member Modal State
  const [isMemberModalOpen, setIsMemberModalOpen] = useState(false);
  const [memberName, setMemberName] = useState('');
  const [memberBirthDate, setMemberBirthDate] = useState('');
  const [memberPosition, setMemberPosition] = useState('');
  const [editingMember, setEditingMember] = useState<Member | null>(null);

  // Group Modal State
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupMemberIds, setGroupMemberIds] = useState<Set<string>>(new Set());
  const [editingMemberGroup, setEditingMemberGroup] = useState<MemberGroup | null>(null);

  // Template Modal State
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateAmount, setTemplateAmount] = useState('');
  const [templateType, setTemplateType] = useState<'fixed' | 'dynamic'>('fixed');
  const [templateUnit, setTemplateUnit] = useState('');
  const [editingTemplate, setEditingTemplate] = useState<FineTemplate | null>(null);
  const [templateSearchTerm, setTemplateSearchTerm] = useState('');
  
  // Member and Group filters
  const [memberSearchTerm, setMemberSearchTerm] = useState('');
  const [groupSearchTerm, setGroupSearchTerm] = useState('');
  const [memberSortOption, setMemberSortOption] = useState<'name' | 'age-asc' | 'age-desc'>('name');
  const [groupSortOption, setGroupSortOption] = useState<'order' | 'name'>('order');
  const [memberStatusFilter, setMemberStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [memberPositionFilter, setMemberPositionFilter] = useState('all');

  // Delete Confirm State
  const [deleteId, setDeleteId] = useState<{ id: string, type: 'member' | 'template' | 'memberGroup', name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const onDragEnd = async (event: any) => {
    if (isReadOnly) return;
    const { active, over, type } = event;
    if (!over || active.id === over.id) return;

    if (type === 'groups') {
      const oldIndex = memberGroups.findIndex((mg) => mg.id === active.id);
      const newIndex = memberGroups.findIndex((mg) => mg.id === over.id);
      const newGroups = arrayMove(memberGroups, oldIndex, newIndex);
      setMemberGroups(newGroups);
      try {
        const batch = writeBatch(db);
        newGroups.forEach((mg: MemberGroup, i) => {
          batch.update(doc(db, `groups/${group.id}/periods/${period.id}/memberGroups`, mg.id), { order: i });
        });
        await batch.commit();
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, 'memberGroups/order');
      }
    } else if (type === 'templates') {
      const oldIndex = templates.findIndex((t) => t.id === active.id);
      const newIndex = templates.findIndex((t) => t.id === over.id);
      const newTemplates = arrayMove(templates, oldIndex, newIndex);
      setTemplates(newTemplates);
      try {
        const batch = writeBatch(db);
        newTemplates.forEach((t: FineTemplate, i) => {
          batch.update(doc(db, `groups/${group.id}/periods/${period.id}/fineTemplates`, t.id), { order: i });
        });
        await batch.commit();
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, 'fineTemplates/order');
      }
    }
  };

  useEffect(() => {
    const unsubMembers = onSnapshot(collection(db, `groups/${group.id}/periods/${period.id}/members`), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })) as Member[];
      const unique = data.filter((v, i, a) => a.findIndex(t => t.id === v.id) === i);
      const sorted = unique.sort((a, b) => {
        if (a.active === b.active) {
          return a.name.localeCompare(b.name, 'cs-CZ');
        }
        return a.active ? -1 : 1;
      });
      setMembers(sorted);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `groups/${group.id}/periods/${period.id}/members`);
    });

    const unsubTemplates = onSnapshot(collection(db, `groups/${group.id}/periods/${period.id}/fineTemplates`), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })) as FineTemplate[];
      const unique = data.filter((v, i, a) => a.findIndex(t => t.id === v.id) === i);
      setTemplates(unique.sort((a, b) => (a.order || 0) - (b.order || 0)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `groups/${group.id}/periods/${period.id}/fineTemplates`);
    });

    const unsubMemberGroups = onSnapshot(collection(db, `groups/${group.id}/periods/${period.id}/memberGroups`), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })) as MemberGroup[];
      setMemberGroups(data.sort((a, b) => (a.order || 0) - (b.order || 0)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `groups/${group.id}/periods/${period.id}/memberGroups`);
    });

    const unsubEvents = onSnapshot(query(collection(db, `groups/${group.id}/periods/${period.id}/events`), orderBy('date', 'asc')), (snapshot) => {
      setEvents(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })) as Event[]);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `groups/${group.id}/periods/${period.id}/events`);
    });

    return () => {
      unsubMembers();
      unsubTemplates();
      unsubMemberGroups();
      unsubEvents();
    };
  }, [group.id, period.id]);

  useEffect(() => {
    if (!auth.currentUser) return;

    // Fetch all groups for copying
    const qGroups = query(
      collection(db, 'groups'),
      where('ownerId', '==', auth.currentUser.uid)
    );

    const unsubGroups = onSnapshot(qGroups, (snapshot) => {
      setGroups(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Group[]);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'groups');
    });
    
    // Fetch all periods for this group
    const unsubPeriods = onSnapshot(collection(db, `groups/${group.id}/periods`), (snapshot) => {
      setPeriods(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Period[]);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `groups/${group.id}/periods`);
    });

    return () => {
      unsubGroups();
      unsubPeriods();
    };
  }, [group.id]);

  useEffect(() => {
    if (!targetGroupId) {
      setTargetPeriods([]);
      return;
    }

    const unsub = onSnapshot(collection(db, `groups/${targetGroupId}/periods`), (snapshot) => {
      setTargetPeriods(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Period[]);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `groups/${targetGroupId}/periods`);
    });

    return () => unsub();
  }, [targetGroupId]);

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const toggleSelectAll = () => {
    const currentItems = activeTab === 'templates' ? templates : members;
    if (selectedIds.size === currentItems.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(currentItems.map(i => i.id)));
    }
  };

  const handleBatchDelete = async () => {
    if (isReadOnly || selectedIds.size === 0 || isBatchProcessing) return;
    setIsBatchProcessing(true);
    try {
      const subPath = activeTab === 'members' ? 'members' : 'fineTemplates';
      const path = `groups/${group.id}/periods/${period.id}/${subPath}`;
      console.log(`Attempting batch delete of ${selectedIds.size} items from ${path}`);
      
      const batch = writeBatch(db);

      if (activeTab === 'members') {
        const finesPath = `groups/${group.id}/periods/${period.id}/fines`;
        const paymentsPath = `groups/${group.id}/periods/${period.id}/payments`;
        const groupsPath = `groups/${group.id}/periods/${period.id}/memberGroups`;
        
        // Track updated memberIds for groups to batch update them only once if multiple members deleted
        const updatedGroups = new Map<string, string[]>();

        for (const memberId of selectedIds) {
          const finesSnap = await getDocs(query(collection(db, finesPath), where('memberId', '==', memberId)));
          const paymentsSnap = await getDocs(query(collection(db, paymentsPath), where('memberId', '==', memberId)));
          
          finesSnap.forEach(d => batch.delete(d.ref));
          paymentsSnap.forEach(d => batch.delete(d.ref));
          batch.delete(doc(db, path, memberId));

          // Also remove from local group state tracking to update them collectively
          memberGroups.forEach(mg => {
            if (mg.memberIds.includes(memberId)) {
              const currentIds = updatedGroups.has(mg.id) ? updatedGroups.get(mg.id)! : mg.memberIds;
              updatedGroups.set(mg.id, currentIds.filter(id => id !== memberId));
            }
          });
        }

        // Apply group updates
        updatedGroups.forEach((newIds, mgId) => {
          batch.update(doc(db, groupsPath, mgId), { memberIds: newIds });
        });
      } else {
        selectedIds.forEach(id => {
          batch.delete(doc(db, path, id));
        });
      }

      await batch.commit();
      console.log('Batch delete successful');
      setSelectedIds(new Set());
      setIsBatchDeleteConfirmOpen(false);
    } catch (error) {
      console.error('Batch delete error:', error);
      setIsBatchDeleteConfirmOpen(false);
      alert('Chyba při hromadném mazání: ' + (error instanceof Error ? error.message : 'Neznámá chyba'));
      handleFirestoreError(error, OperationType.DELETE, activeTab);
    } finally {
      setIsBatchProcessing(false);
    }
  };

  const handleBatchCopy = async () => {
    if (isReadOnly || !targetGroupId || !targetPeriodId) return;
    setIsBatchProcessing(true);
    try {
      const batch = writeBatch(db);
      const itemsToCopy = activeTab === 'templates' 
        ? templates.filter(t => selectedIds.has(t.id))
        : members.filter(m => selectedIds.has(m.id));

      if (activeTab === 'templates') {
        itemsToCopy.forEach(item => {
          const newRef = doc(collection(db, `groups/${targetGroupId}/periods/${targetPeriodId}/fineTemplates`));
          const { id, ...data } = item as FineTemplate;
          batch.set(newRef, { ...data, id: newRef.id, groupId: targetGroupId });
        });
      } else {
        itemsToCopy.forEach(item => {
          const newRef = doc(collection(db, `groups/${targetGroupId}/periods/${targetPeriodId}/members`));
          const { id, ...data } = item as Member;
          batch.set(newRef, { ...data, id: newRef.id, groupId: targetGroupId });
        });
      }

      await batch.commit();
      setSelectedIds(new Set());
      setIsBatchCopyModalOpen(false);
      setTargetGroupId('');
      setTargetPeriodId('');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `batch_copy_${activeTab}`);
    } finally {
      setIsBatchProcessing(false);
    }
  };

  const saveMember = async () => {
    if (isReadOnly || !memberName.trim() || isSaving) return;
    setIsSaving(true);
    try {
      const memberPath = `groups/${group.id}/periods/${period.id}/members`;
      const data = {
        name: memberName.trim(),
        birthDate: memberBirthDate || null,
        position: memberPosition.trim() || null,
        groupId: group.id,
        active: editingMember ? editingMember.active : true
      };

      if (editingMember) {
        await setDoc(doc(db, memberPath, editingMember.id), data, { merge: true });
      } else {
        const newRef = doc(collection(db, memberPath));
        await setDoc(newRef, {
          ...data,
          id: newRef.id
        });
      }
      setIsMemberModalOpen(false);
      setMemberName('');
      setMemberBirthDate('');
      setMemberPosition('');
      setEditingMember(null);
    } catch (error) {
      console.error(error);
      setIsMemberModalOpen(false); // Close even on error to prevent stuck UI
      handleFirestoreError(error, OperationType.WRITE, `groups/${group.id}/periods/${period.id}/members`);
    } finally {
      setIsSaving(false);
    }
  };

  const saveTemplate = async () => {
    const amount = parseFloat(templateAmount);
    if (isReadOnly || !templateName.trim() || isNaN(amount) || isSaving) return;
    setIsSaving(true);
    try {
      const templatePath = `groups/${group.id}/periods/${period.id}/fineTemplates`;
      const data = {
        name: templateName.trim(),
        amount: amount,
        type: templateType,
        unit: templateType === 'dynamic' ? templateUnit : null,
        groupId: group.id,
        order: editingTemplate ? (editingTemplate.order ?? templates.length) : templates.length
      };
      if (editingTemplate) {
        await setDoc(doc(db, templatePath, editingTemplate.id), data, { merge: true });
      } else {
        const newRef = doc(collection(db, templatePath));
        await setDoc(newRef, {
            ...data,
            id: newRef.id
          });
      }
      setIsTemplateModalOpen(false);
      setTemplateName('');
      setTemplateAmount('');
      setTemplateType('fixed');
      setTemplateUnit('');
      setEditingTemplate(null);
    } catch (error) {
      console.error(error);
      setIsTemplateModalOpen(false); // Close even on error to prevent stuck UI
      handleFirestoreError(error, OperationType.WRITE, `groups/${group.id}/periods/${period.id}/fineTemplates`);
    } finally {
      setIsSaving(false);
    }
  };

  const saveMemberGroup = async () => {
    if (isReadOnly || !groupName.trim() || isSaving) return;
    setIsSaving(true);
    try {
      const gPath = `groups/${group.id}/periods/${period.id}/memberGroups`;
      const data = {
        name: groupName.trim(),
        memberIds: Array.from(groupMemberIds),
        groupId: group.id,
        order: editingMemberGroup ? (editingMemberGroup.order ?? memberGroups.length) : memberGroups.length
      };

      if (editingMemberGroup) {
        await updateDoc(doc(db, gPath, editingMemberGroup.id), data);
      } else {
        await addDoc(collection(db, gPath), data);
      }
      setIsGroupModalOpen(false);
      setGroupName('');
      setGroupMemberIds(new Set());
      setEditingMemberGroup(null);
    } catch (error) {
      console.error('Error saving group:', error);
      setIsGroupModalOpen(false); // Close on error to prevent stuck UI
      handleFirestoreError(error, OperationType.WRITE, `groups/${group.id}/periods/${period.id}/memberGroups`);
    } finally {
      setIsSaving(false);
    }
  };

  const saveEvent = async () => {
    if (isReadOnly || !eventName.trim() || !eventDate || isSaving) return;
    setIsSaving(true);
    try {
      const eventPath = `groups/${group.id}/periods/${period.id}/events`;
      const data = {
        name: eventName.trim(),
        date: eventDate,
        description: eventDescription.trim(),
        isImportant: eventIsImportant,
        groupId: group.id,
        periodId: period.id,
        createdAt: Date.now()
      };

      if (editingEvent) {
        await updateDoc(doc(db, eventPath, editingEvent.id), data);
      } else {
        await addDoc(collection(db, eventPath), data);
      }
      setIsEventModalOpen(false);
      setEventName('');
      setEventDate('');
      setEventDescription('');
      setEventIsImportant(false);
      setEditingEvent(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `groups/${group.id}/periods/${period.id}/events`);
    } finally {
      setIsSaving(false);
    }
  };

  const deleteItem = async () => {
    if (isReadOnly || !deleteId || isDeleting) return;
    const itemToDelete = { ...deleteId };
    setIsDeleting(true);
    try {
      const subPaths: Record<string, string> = {
        member: 'members',
        template: 'fineTemplates',
        memberGroup: 'memberGroups',
        event: 'events'
      };
      const subPath = subPaths[itemToDelete.type];
      const path = `groups/${group.id}/periods/${period.id}/${subPath}`;
      console.log(`Attempting to delete ${itemToDelete.id} from ${path}`);
      
      const batch = writeBatch(db);
      
      // If deleting a member, also delete their fines, payments and remove from groups
      if (itemToDelete.type === 'member') {
        const finesPath = `groups/${group.id}/periods/${period.id}/fines`;
        const paymentsPath = `groups/${group.id}/periods/${period.id}/payments`;
        const groupsPath = `groups/${group.id}/periods/${period.id}/memberGroups`;
        
        const finesSnap = await getDocs(query(collection(db, finesPath), where('memberId', '==', itemToDelete.id)));
        const paymentsSnap = await getDocs(query(collection(db, paymentsPath), where('memberId', '==', itemToDelete.id)));
        
        finesSnap.forEach(d => batch.delete(d.ref));
        paymentsSnap.forEach(d => batch.delete(d.ref));

        // Remove from all groups they belong to
        memberGroups.forEach(mg => {
          if (mg.memberIds.includes(itemToDelete.id)) {
            const updatedIds = mg.memberIds.filter(id => id !== itemToDelete.id);
            batch.update(doc(db, groupsPath, mg.id), { memberIds: updatedIds });
          }
        });
      }

      batch.delete(doc(db, path, itemToDelete.id));
      await batch.commit();

      console.log('Delete successful');
      setDeleteId(null);
    } catch (error) {
      console.error('Delete error:', error);
      alert('Chyba při mazání: ' + (error instanceof Error ? error.message : 'Neznámá chyba'));
      setDeleteId(null);
      handleFirestoreError(error, OperationType.DELETE, itemToDelete.type);
    } finally {
      setIsDeleting(false);
    }
  };

  const toggleMemberStatus = async (member: Member) => {
    if (isReadOnly) return;
    try {
      await updateDoc(doc(db, `groups/${group.id}/periods/${period.id}/members`, member.id), {
        active: !member.active
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `members/${member.id}`);
    }
  };

  const positions = useMemo(() => {
    const p = new Set<string>();
    members.forEach(m => {
      if (m.position) p.add(m.position);
    });
    return Array.from(p).sort();
  }, [members]);

  const filteredAndSortedMembers = useMemo(() => {
    return members
      .filter(m => {
        const matchesSearch = m.name.toLowerCase().includes(memberSearchTerm.toLowerCase()) || 
                             (m.position?.toLowerCase().includes(memberSearchTerm.toLowerCase()));
        const matchesStatus = memberStatusFilter === 'all' || 
                             (memberStatusFilter === 'active' ? m.active : !m.active);
        const matchesPosition = memberPositionFilter === 'all' || m.position === memberPositionFilter;
        return matchesSearch && matchesStatus && matchesPosition;
      })
      .sort((a, b) => {
        if (memberSortOption === 'name') {
          if (a.active === b.active) {
            return a.name.localeCompare(b.name, 'cs-CZ');
          }
          return a.active ? -1 : 1;
        }

        if (memberSortOption === 'age-asc' || memberSortOption === 'age-desc') {
          const dateA = a.birthDate ? new Date(a.birthDate).getTime() : (memberSortOption === 'age-asc' ? Infinity : -Infinity);
          const dateB = b.birthDate ? new Date(b.birthDate).getTime() : (memberSortOption === 'age-asc' ? Infinity : -Infinity);
          
          if (memberSortOption === 'age-asc') {
            return dateA - dateB; // Oldest first
          } else {
            return dateB - dateA; // Youngest first
          }
        }
        
        return 0;
      });
  }, [members, memberSearchTerm, memberSortOption, memberStatusFilter, memberPositionFilter]);

  const filteredTemplates = useMemo(() => {
    return templates.filter(t => t.name.toLowerCase().includes(templateSearchTerm.toLowerCase()));
  }, [templates, templateSearchTerm]);

  const filteredAndSortedGroups = useMemo(() => {
    return [...memberGroups]
      .filter(mg => mg.name.toLowerCase().includes(groupSearchTerm.toLowerCase()))
      .sort((a, b) => {
        if (groupSortOption === 'name') {
          return a.name.localeCompare(b.name, 'cs-CZ');
        }
        return (a.order || 0) - (b.order || 0);
      });
  }, [memberGroups, groupSearchTerm, groupSortOption]);

  const filteredEvents = useMemo(() => {
    let result = [...events];

    if (eventFilter === 'important') {
      result = result.filter(e => e.isImportant);
    } else if (eventFilter === 'birthdays') {
      return []; // Handled separately in the list UI as virtual items if needed
    }

    if (eventSearchTerm.trim()) {
      const q = eventSearchTerm.toLowerCase().trim();
      result = result.filter(e => e.name.toLowerCase().includes(q) || e.description?.toLowerCase().includes(q));
    }

    return result;
  }, [events, eventSearchTerm, eventFilter]);

  const birthdayEvents = useMemo(() => {
    return members.filter(m => m.birthDate).map(m => ({
      id: `birthday-${m.id}`,
      name: `Narozeniny: ${m.name}`,
      date: m.birthDate!,
      isBirthday: true,
      member: m
    }));
  }, [members]);

  const allCalendarItems = useMemo(() => {
    const birthdayItems = birthdayEvents.map(b => {
      // For calendar, we need to show birthdays in the current calendar year/view
      const bDate = new Date(b.date);
      const year = calendarDate.getFullYear();
      const dateInCurrentYear = new Date(year, bDate.getMonth(), bDate.getDate());
      const age = year - bDate.getFullYear();
      
      return {
        ...b,
        name: `${b.name} (${age}. narozeniny)`,
        date: dateInCurrentYear.toISOString().split('T')[0]
      };
    });

    return [...events, ...birthdayItems];
  }, [events, birthdayEvents, calendarDate]);

  const sortedEventsAndBirthdays = useMemo(() => {
    const virtualBirthdays = birthdayEvents.map(b => {
      const now = new Date();
      const bDate = new Date(b.date);
      let year = now.getFullYear();
      let date = new Date(year, bDate.getMonth(), bDate.getDate());
      
      // If birthday already happened this year, show it for next year in the list
      if (date < new Date(now.setHours(0,0,0,0))) {
        date = new Date(year + 1, bDate.getMonth(), bDate.getDate());
      }

      const age = date.getFullYear() - bDate.getFullYear();
      
      return {
        ...b,
        name: `${b.name} (${age}. narozeniny)`,
        date: date.toISOString().split('T')[0],
        originalBirthDay: bDate.getDate(),
        originalBirthMonth: bDate.getMonth()
      };
    });

    let combined: any[] = [];
    if (eventFilter === 'all') {
      combined = [...events, ...virtualBirthdays];
    } else if (eventFilter === 'important') {
      combined = events.filter(e => e.isImportant);
    } else if (eventFilter === 'birthdays') {
      combined = virtualBirthdays;
    }

    if (eventSearchTerm.trim()) {
      const q = eventSearchTerm.toLowerCase().trim();
      combined = combined.filter(item => item.name.toLowerCase().includes(q) || (item.description?.toLowerCase().includes(q)));
    }

    return combined.sort((a, b) => a.date.localeCompare(b.date));
  }, [events, birthdayEvents, eventFilter, eventSearchTerm]);

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex gap-2 p-1 bg-slate-100/50 rounded-xl w-fit">
        <button
          onClick={() => {
            setActiveTab('templates');
            setSelectedIds(new Set());
          }}
          className={cn(
            "flex items-center gap-2 px-6 py-2.5 rounded-lg font-bold text-[11px] uppercase tracking-wider transition-all",
            activeTab === 'templates' ? "bg-white text-bento-text-main shadow-sm" : "text-bento-text-muted hover:text-bento-text-main"
          )}
        >
          <ReceiptText className="w-4 h-4" />
          Sazebník
        </button>
        <button
          onClick={() => {
            setActiveTab('members');
            setSelectedIds(new Set());
          }}
          className={cn(
            "flex items-center gap-2 px-6 py-2.5 rounded-lg font-bold text-[11px] uppercase tracking-wider transition-all",
            activeTab === 'members' ? "bg-white text-bento-text-main shadow-sm" : "text-bento-text-muted hover:text-bento-text-main"
          )}
        >
          <Users className="w-4 h-4" />
          Členové
        </button>
        <button
          onClick={() => {
            setActiveTab('events');
            setSelectedIds(new Set());
          }}
          className={cn(
            "flex items-center gap-2 px-6 py-2.5 rounded-lg font-bold text-[11px] uppercase tracking-wider transition-all",
            activeTab === 'events' ? "bg-white text-bento-text-main shadow-sm" : "text-bento-text-muted hover:text-bento-text-main"
          )}
        >
          <CalendarIcon className="w-4 h-4" />
          Události
        </button>
        <button
          onClick={() => {
            setActiveTab('sharing');
            setSelectedIds(new Set());
          }}
          className={cn(
            "flex items-center gap-2 px-6 py-2.5 rounded-lg font-bold text-[11px] uppercase tracking-wider transition-all",
            activeTab === 'sharing' ? "bg-white text-bento-text-main shadow-sm" : "text-bento-text-muted hover:text-bento-text-main"
          )}
        >
          <Share2 className="w-4 h-4 text-blue-600" />
          Sdílení kasy
        </button>
      </div>

      {activeTab === 'templates' && (
        <div className="space-y-6">
          {/* Currency Settings Card (Compact) */}
          <div className="bg-white px-4 py-3 rounded-xl border border-slate-200/80 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="p-2 bg-amber-50 text-amber-600 rounded-xl border border-amber-100 shrink-0">
                <Coins className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-black uppercase tracking-wider text-bento-text-main truncate">
                    Měna pokladny
                  </h3>
                  {isUpdatingCurrency && <Loader2 className="w-3 h-3 animate-spin text-indigo-500 shrink-0" />}
                </div>
                <p className="text-[11px] text-slate-500 font-medium truncate">
                  Sazebník, zůstatek a transakce
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
              <select
                disabled={isReadOnly || isUpdatingCurrency}
                value={currentCurrency}
                onChange={(e) => handleCurrencyChange(e.target.value)}
                className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 cursor-pointer disabled:opacity-60"
              >
                <option value="CZK">🇨🇿 CZK (Kč)</option>
                <option value="EUR">🇪🇺 EUR (€)</option>
                <option value="USD">🇺🇸 USD ($)</option>
                <option value="GBP">🇬🇧 GBP (£)</option>
                <option value="PLN">🇵🇱 PLN (zł)</option>
                <option value="CHF">🇨🇭 CHF</option>
                <option value="HUF">🇭🇺 HUF (Ft)</option>
                {!['CZK', 'EUR', 'USD', 'GBP', 'PLN', 'CHF', 'HUF'].includes(currentCurrency) && (
                  <option value={currentCurrency}>{currentCurrency} ({getCurrencySymbol(currentCurrency)})</option>
                )}
              </select>
            </div>
          </div>

          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 px-1">
            <div className="flex-1 space-y-4">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-bento-accent"></div>
                <h2 className="text-xs font-black uppercase tracking-[0.2em] text-bento-text-muted">Sazebník prohřešků</h2>
              </div>
              
              <div className="flex flex-wrap items-center gap-3">
                {/* Search */}
                <div className="relative w-full md:w-64">
                  <input
                    type="text"
                    placeholder="Hledat v sazebníku..."
                    className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-bento-accent/10 transition-all"
                    value={templateSearchTerm}
                    onChange={(e) => setTemplateSearchTerm(e.target.value)}
                  />
                  <ReceiptText className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button 
                onClick={toggleSelectAll}
                className="p-2.5 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl transition-colors text-bento-text-muted flex items-center gap-2"
                title="Vybrat vše"
              >
                {selectedIds.size === templates.length && templates.length > 0 ? (
                  <CheckSquare className="w-4 h-4 text-bento-accent" />
                ) : (
                  <Square className="w-4 h-4" />
                )}
                <span className="text-[10px] font-bold uppercase">Vybrat vše</span>
              </button>
              <button
                onClick={() => {
                  setEditingTemplate(null);
                  setTemplateName('');
                  setTemplateAmount('');
                  setTemplateType('fixed');
                  setTemplateUnit('');
                  setIsTemplateModalOpen(true);
                }}
                className="px-5 py-3 bg-bento-accent text-white rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2 hover:bg-black transition-all shadow-lg shadow-bento-accent/10 active:scale-95"
              >
                <Plus className="w-4 h-4" />
                Nová položka
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={(e) => onDragEnd({ ...e, type: 'templates' })}
            >
              <SortableContext
                items={filteredTemplates.map(t => t.id)}
                strategy={verticalListSortingStrategy}
              >
                {filteredTemplates.map(t => (
                  <SortableItem key={t.id} id={t.id}>
                    <div 
                      onClick={() => toggleSelect(t.id)}
                      className={cn(
                        "bg-white px-3 py-2.5 flex items-center justify-between group shadow-sm cursor-pointer transition-all border-2 rounded-xl relative overflow-hidden",
                        selectedIds.has(t.id) ? "border-bento-accent bg-bento-accent/5" : "border-slate-100 hover:border-slate-200"
                      )}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className={cn(
                          "w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors shrink-0",
                          selectedIds.has(t.id) ? "bg-bento-accent border-bento-accent" : "border-slate-300"
                        )}>
                          {selectedIds.has(t.id) && <Check className="w-2.5 h-2.5 text-white" />}
                        </div>
                        <div className="text-left min-w-0 pr-2">
                          <h3 className="font-bold text-bento-text-main text-[13px] leading-tight truncate">{t.name}</h3>
                          <p className="text-bento-accent font-black text-[10px] tracking-tight flex items-center gap-2">
                            {t.amount} {getCurrencySymbol(currentCurrency)}{t.type === 'dynamic' ? ` / ${t.unit}` : ''}
                            <GripVertical className="w-3 h-3 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingTemplate(t);
                            setTemplateName(t.name);
                            setTemplateAmount(t.amount.toString());
                            setTemplateType(t.type);
                            setTemplateUnit(t.unit || '');
                            setIsMemberModalOpen(false);
                            setIsGroupModalOpen(false);
                            setIsTemplateModalOpen(true);
                          }}
                          className="p-1 text-slate-400 hover:text-bento-accent hover:bg-bento-accent/5 rounded-md transition-all opacity-0 group-hover:opacity-100"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteId({ id: t.id, type: 'template', name: t.name });
                          }}
                          className="p-1 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-md transition-all opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </SortableItem>
                ))}
              </SortableContext>
            </DndContext>
            {templates.length === 0 && (
              <div className="sm:col-span-2 lg:col-span-3 xl:col-span-4 text-center py-12 bg-slate-50/50 border border-dashed border-slate-200 rounded-2xl">
                <ReceiptText className="w-8 h-8 text-slate-300 mx-auto mb-2 opacity-20" />
                <p className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted">Sazebník je prázdný</p>
              </div>
            )}
          </div>
        </div>
      )}
      {activeTab === 'members' && (
        <div className="space-y-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 px-1">
            <div className="flex-1 space-y-4">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-bento-accent"></div>
                <h2 className="text-xs font-black uppercase tracking-[0.2em] text-bento-text-muted">Seznam členů</h2>
              </div>
              
              <div className="flex flex-wrap items-center gap-3">
                {/* Search */}
                <div className="relative w-full md:w-64">
                  <input
                    type="text"
                    placeholder="Hledat člena..."
                    className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-bento-accent/10 transition-all"
                    value={memberSearchTerm}
                    onChange={(e) => setMemberSearchTerm(e.target.value)}
                  />
                  <Users className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                </div>

                {/* Sort */}
                <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2">
                  <span className="text-[10px] font-black uppercase tracking-tight text-slate-400">Řazení:</span>
                  <select 
                    className="text-xs font-bold bg-transparent focus:outline-none cursor-pointer"
                    value={memberSortOption}
                    onChange={(e) => setMemberSortOption(e.target.value as any)}
                  >
                    <option value="name">A - Z</option>
                    <option value="age-asc">Od nejstaršího</option>
                    <option value="age-desc">Od nejmladšího</option>
                  </select>
                </div>

                {/* Status Filter */}
                <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2">
                  <span className="text-[10px] font-black uppercase tracking-tight text-slate-400">Stav:</span>
                  <select 
                    className="text-xs font-bold bg-transparent focus:outline-none cursor-pointer"
                    value={memberStatusFilter}
                    onChange={(e) => setMemberStatusFilter(e.target.value as any)}
                  >
                    <option value="all">Všichni</option>
                    <option value="active">Aktivní</option>
                    <option value="inactive">Neaktivní</option>
                  </select>
                </div>

                {/* Position Filter */}
                {positions.length > 0 && (
                  <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2">
                    <span className="text-[10px] font-black uppercase tracking-tight text-slate-400">Pozice:</span>
                    <select 
                      className="text-xs font-bold bg-transparent focus:outline-none cursor-pointer max-w-[120px]"
                      value={memberPositionFilter}
                      onChange={(e) => setMemberPositionFilter(e.target.value)}
                    >
                      <option value="all">Všechny</option>
                      {positions.map(p => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button 
                onClick={toggleSelectAll}
                className="p-2.5 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl transition-colors text-bento-text-muted flex items-center gap-2"
                title="Vybrat vše"
              >
                {selectedIds.size === members.length && members.length > 0 ? (
                  <CheckSquare className="w-4 h-4 text-bento-accent" />
                ) : (
                  <Square className="w-4 h-4" />
                )}
                <span className="text-[10px] font-bold uppercase">Vybrat vše</span>
              </button>
            <button
                onClick={() => {
                  setEditingMember(null);
                  setMemberName('');
                  setMemberBirthDate('');
                  setMemberPosition('');
                  setIsMemberModalOpen(true);
                }}
                className="px-5 py-3 bg-bento-accent text-white rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2 hover:bg-black transition-all shadow-lg shadow-bento-accent/10 active:scale-95"
              >
                <Plus className="w-4 h-4" />
                Nový člen
              </button>
            </div>
          </div>

          <div className="bento-card bg-white shadow-sm overflow-hidden p-0 divide-y divide-bento-card-border">
            {filteredAndSortedMembers.length > 0 ? filteredAndSortedMembers.map(m => (
              <div 
                key={m.id} 
                onClick={() => toggleSelect(m.id)}
                className={cn(
                  "p-4 flex items-center justify-between hover:bg-slate-50 transition-colors group cursor-pointer",
                  selectedIds.has(m.id) && "bg-bento-accent/5 hover:bg-bento-accent/10"
                )}
              >
                <div className="flex items-center gap-4">
                  <div className={cn(
                    "w-4 h-4 rounded border-2 flex items-center justify-center transition-colors",
                    selectedIds.has(m.id) ? "bg-bento-accent border-bento-accent" : "border-slate-200"
                  )}>
                    {selectedIds.has(m.id) && <Check className="w-3 h-3 text-white" />}
                  </div>
                  <div className={cn(
                    "w-9 h-9 rounded-xl flex items-center justify-center font-black text-xs transition-all",
                    m.active ? "bg-emerald-50 text-emerald-600 shadow-sm shadow-emerald-500/5" : "bg-slate-100 text-slate-400"
                  )}>
                    {m.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="text-left w-full min-w-0 pr-4">
                    <div className="flex items-baseline gap-2 mb-0.5">
                      <h3 className="font-bold text-sm text-bento-text-main leading-none">{m.name}</h3>
                      {m.birthDate && (
                        <span className="text-[10px] font-bold text-bento-text-muted">
                          {(() => {
                            const birth = new Date(m.birthDate);
                            const age = new Date().getFullYear() - birth.getFullYear();
                            const m_diff = new Date().getMonth() - birth.getMonth();
                            const isPastBirthday = m_diff > 0 || (m_diff === 0 && new Date().getDate() >= birth.getDate());
                            const finalAge = isPastBirthday ? age : age - 1;
                            return `${finalAge} let, ${birth.toLocaleDateString('cs-CZ')}`;
                          })()}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleMemberStatus(m);
                        }}
                        className={cn(
                          "text-[9px] font-black uppercase tracking-widest hover:underline transition-colors shrink-0",
                          m.active ? "text-emerald-500" : "text-bento-text-muted"
                        )}
                      >
                        {m.active ? 'Aktivní' : 'Neaktivní'}
                      </button>
                      {m.position && (
                        <span className="text-[9px] font-black uppercase tracking-widest text-bento-accent opacity-60 truncate pl-4">
                          {m.position}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingMember(m);
                      setMemberName(m.name);
                      setMemberBirthDate(m.birthDate || '');
                      setMemberPosition(m.position || '');
                      setIsMemberModalOpen(true);
                    }}
                    className="p-2 text-slate-400 hover:text-bento-accent hover:bg-bento-accent/5 rounded-xl transition-all"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteId({ id: m.id, type: 'member', name: m.name });
                    }}
                    className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )) : (
              <div className="text-center py-16 text-slate-400">
                <Users className="w-10 h-10 mx-auto mb-3 opacity-10" />
                <p className="text-[10px] font-black uppercase tracking-widest">Žádní členové</p>
              </div>
            )}
          </div>

          {/* Member Groups Section */}
          <div className="space-y-6 pt-10">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 px-1">
              <div className="flex-1 space-y-4">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-bento-accent"></div>
                  <h2 className="text-xs font-black uppercase tracking-[0.2em] text-bento-text-muted">Seznam skupin</h2>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {/* Search for groups */}
                  <div className="relative w-full md:w-64">
                    <input
                      type="text"
                      placeholder="Hledat skupinu..."
                      className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-bento-accent/10 transition-all"
                      value={groupSearchTerm}
                      onChange={(e) => setGroupSearchTerm(e.target.value)}
                    />
                    <Layers className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  </div>

                  {/* Sort for groups */}
                  <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2">
                    <span className="text-[10px] font-black uppercase tracking-tight text-slate-400">Řazení:</span>
                    <select 
                      className="text-xs font-bold bg-transparent focus:outline-none cursor-pointer"
                      value={groupSortOption}
                      onChange={(e) => setGroupSortOption(e.target.value as any)}
                    >
                      <option value="order">Vlastní pořadí</option>
                      <option value="name">A - Z</option>
                    </select>
                  </div>
                </div>
              </div>
              <button
                onClick={() => {
                  setEditingMemberGroup(null);
                  setGroupName('');
                  setGroupMemberIds(new Set());
                  setIsMemberModalOpen(false);
                  setIsTemplateModalOpen(false);
                  setIsGroupModalOpen(true);
                }}
                className="px-5 py-3 bg-white border border-slate-200 hover:border-slate-300 rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2 transition-all active:scale-95"
              >
                <Plus className="w-4 h-4" />
                Nová skupina
              </button>
            </div>

            <div className="space-y-4">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={(e) => onDragEnd({ ...e, type: 'groups' })}
              >
                <SortableContext
                  items={filteredAndSortedGroups.map(mg => mg.id as string)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="bento-card bg-white shadow-sm overflow-hidden p-0 divide-y divide-bento-card-border">
                    {filteredAndSortedGroups.length > 0 ? filteredAndSortedGroups.map(mg => (
                      <SortableItem key={mg.id} id={mg.id}>
                        <div className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors group cursor-grab active:cursor-grabbing">
                          <div className="flex items-center gap-4">
                            <div className="w-9 h-9 rounded-xl bg-bento-accent/5 text-bento-accent flex items-center justify-center">
                              <Layers className="w-4 h-4" />
                            </div>
                            <div className="text-left">
                              <h3 className="font-bold text-sm text-bento-text-main leading-none mb-1">{mg.name}</h3>
                              <p className="text-[9px] font-black uppercase tracking-widest text-bento-text-muted flex items-center gap-2">
                                {mg.memberIds.length} Členů
                                <GripVertical className="w-3 h-3 text-slate-300" />
                              </p>
                            </div>
                          </div>
                          <div className="flex gap-1.5">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingMemberGroup(mg);
                                setGroupName(mg.name);
                                setGroupMemberIds(new Set(mg.memberIds));
                                setIsMemberModalOpen(false);
                                setIsTemplateModalOpen(false);
                                setIsGroupModalOpen(true);
                              }}
                              className="p-2 text-slate-400 hover:text-bento-accent hover:bg-bento-accent/5 rounded-xl transition-all"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteId({ id: mg.id, type: 'memberGroup', name: mg.name });
                              }}
                              className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </SortableItem>
                    )) : (
                      <div className="text-center py-16 text-slate-400">
                        <Layers className="w-10 h-10 mx-auto mb-3 opacity-10" />
                        <p className="text-[10px] font-black uppercase tracking-widest">Žádné skupiny</p>
                      </div>
                    )}
                  </div>
                </SortableContext>
              </DndContext>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'events' && (
        <div className="space-y-8">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 px-1">
            <div className="flex-1 space-y-4">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-bento-accent"></div>
                <h2 className="text-xs font-black uppercase tracking-[0.2em] text-bento-text-muted">Připravované události</h2>
              </div>
              
              <div className="flex flex-wrap items-center gap-3">
                {/* Search */}
                <div className="relative w-full md:w-64">
                  <input
                    type="text"
                    placeholder="Hledat událost..."
                    className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-bento-accent/10 transition-all"
                    value={eventSearchTerm}
                    onChange={(e) => setEventSearchTerm(e.target.value)}
                  />
                  <CalendarIcon className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                </div>

                {/* Filter */}
                <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2">
                  <span className="text-[10px] font-black uppercase tracking-tight text-slate-400">Filtr:</span>
                  <select 
                    className="text-xs font-bold bg-transparent focus:outline-none cursor-pointer"
                    value={eventFilter}
                    onChange={(e) => setEventFilter(e.target.value as any)}
                  >
                    <option value="all">Vše</option>
                    <option value="important">Důležité</option>
                    <option value="birthdays">Narozeniny</option>
                  </select>
                </div>
              </div>
            </div>

            <button
              onClick={() => {
                setEditingEvent(null);
                setEventName('');
                setEventDate('');
                setEventDescription('');
                setEventIsImportant(false);
                setIsEventModalOpen(true);
              }}
              className="px-5 py-3 bg-bento-accent text-white rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2 transition-all active:scale-95 shadow-lg shadow-bento-accent/10"
            >
              <Plus className="w-4 h-4" />
              Nová událost
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Events List */}
            <div className="lg:col-span-7 space-y-4">
              <div className="bento-card bg-white shadow-sm overflow-hidden p-0 divide-y divide-bento-card-border">
                {sortedEventsAndBirthdays.length > 0 ? sortedEventsAndBirthdays.map(item => {
                  const isBirthday = 'isBirthday' in item;
                  return (
                    <div 
                      key={item.id} 
                      className={cn(
                        "p-5 flex items-center justify-between border-l-4 transition-all",
                        isBirthday ? "border-l-indigo-400 bg-indigo-50/10" : 
                        (item.isImportant ? "border-l-rose-500 bg-rose-50/10" : "border-l-transparent hover:bg-slate-50")
                      )}
                    >
                      <div className="flex items-center gap-5 min-w-0 flex-1">
                        <div className="flex flex-col items-center justify-center w-12 h-12 bg-white border border-slate-100 rounded-xl shadow-sm shrink-0">
                          <span className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted leading-none mb-1">
                            {new Date(item.date).toLocaleDateString('cs-CZ', { month: 'short' }).replace('.', '').toUpperCase()}
                          </span>
                          <span className="text-lg font-black text-bento-text-main leading-none">
                            {new Date(item.date).getDate()}
                          </span>
                        </div>
                        <div className="min-w-0 pr-4">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-bold text-sm text-bento-text-main leading-tight truncate">{item.name}</h3>
                            {item.isImportant && (
                              <span className="bg-rose-500 text-white text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-sm">
                                Důležité
                              </span>
                            )}
                            {isBirthday && (
                              <Cake className="w-3.5 h-3.5 text-indigo-500" />
                            )}
                          </div>
                          {item.description && (
                            <p className="text-xs text-bento-text-muted mt-1 line-clamp-1">{item.description}</p>
                          )}
                          {!isBirthday && (
                            <p className="text-[10px] font-black uppercase tracking-widest text-bento-accent/60 mt-1.5">
                              {new Date(item.date).getFullYear()} • {new Date(item.date).toLocaleDateString('cs-CZ', { weekday: 'long' })}
                            </p>
                          )}
                          {isBirthday && (
                            <p className="text-[10px] font-black uppercase tracking-widest text-indigo-500/60 mt-1.5">
                              Narozeniny
                            </p>
                          )}
                        </div>
                      </div>
                      
                      {!isBirthday && (
                        <div className="flex gap-1.5 shrink-0">
                          <button
                            onClick={() => {
                              setEditingEvent(item);
                              setEventName(item.name);
                              setEventDate(item.date);
                              setEventDescription(item.description || '');
                              setEventIsImportant(item.isImportant);
                              setIsEventModalOpen(true);
                            }}
                            className="p-2 text-slate-400 hover:text-bento-accent hover:bg-bento-accent/5 rounded-xl transition-all"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setDeleteId({ id: item.id, type: 'event' as any, name: item.name })}
                            className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                }) : (
                  <div className="text-center py-20 text-slate-400">
                    <CalendarIcon className="w-12 h-12 mx-auto mb-4 opacity-10" />
                    <p className="text-sm font-bold opacity-30">Žádné události k zobrazení</p>
                  </div>
                )}
              </div>
            </div>

            {/* Calendar View */}
            <div className="lg:col-span-5">
              <div className="bento-card bg-white shadow-sm p-6 sticky top-8">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="font-bold text-sm text-bento-text-main">
                    {calendarDate.toLocaleDateString('cs-CZ', { month: 'long', year: 'numeric' })}
                  </h3>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1))}
                      className="p-2 hover:bg-slate-50 rounded-lg transition-colors border border-slate-100"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => setCalendarDate(new Date())}
                      className="px-3 py-2 hover:bg-slate-50 rounded-lg transition-colors border border-slate-100 text-[10px] font-bold uppercase"
                    >
                      Dnes
                    </button>
                    <button 
                      onClick={() => setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1))}
                      className="p-2 hover:bg-slate-50 rounded-lg transition-colors border border-slate-100"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-7 mb-2">
                  {['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'].map(d => (
                    <div key={d} className="text-center text-[9px] font-black uppercase tracking-widest text-slate-300 py-2">
                      {d}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-1">
                  {(() => {
                    const firstDayOfMonth = new Date(calendarDate.getFullYear(), calendarDate.getMonth(), 1);
                    const lastDayOfMonth = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 0);
                    
                    // Adjust for Monday start (0=Sun in JS)
                    let startDay = firstDayOfMonth.getDay() - 1;
                    if (startDay === -1) startDay = 6;
                    
                    const days = [];
                    // Padding for start of month
                    for (let i = 0; i < startDay; i++) {
                      days.push(<div key={`pad-${i}`} className="h-10 opacity-0" />);
                    }
                    
                    // Real days
                    for (let d = 1; d <= lastDayOfMonth.getDate(); d++) {
                      const dateStr = `${calendarDate.getFullYear()}-${String(calendarDate.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                      const dayEvents = allCalendarItems.filter(e => e.date === dateStr);
                      const isToday = new Date().toISOString().split('T')[0] === dateStr;
                      const hasImportant = dayEvents.some(e => e.isImportant);
                      const hasBirthday = dayEvents.some(e => (e as any).isBirthday);
                      const hasEvent = dayEvents.length > 0;

                      days.push(
                        <div 
                          key={d} 
                          className={cn(
                            "h-10 rounded-xl border flex flex-col items-center justify-center relative group transition-all",
                            isToday ? "bg-bento-accent border-bento-accent text-white shadow-lg shadow-bento-accent/20" : "bg-white border-slate-50 hover:border-slate-200"
                          )}
                        >
                          <span className={cn("text-[11px] font-bold", isToday ? "text-white" : "text-bento-text-main")}>{d}</span>
                          <div className="flex gap-0.5 mt-1">
                            {hasImportant && <div className={cn("w-1 h-1 rounded-full", isToday ? "bg-white" : "bg-rose-500")} />}
                            {hasBirthday && <div className={cn("w-1 h-1 rounded-full", isToday ? "bg-white" : "bg-indigo-400")} />}
                            {hasEvent && !hasImportant && <div className={cn("w-1 h-1 rounded-full", isToday ? "bg-white" : "bg-bento-accent")} />}
                          </div>

                          {/* Hover Tooltip */}
                          {dayEvents.length > 0 && (
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-slate-900 text-white p-3 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none shadow-2xl">
                              <div className="space-y-2">
                                {dayEvents.map(e => (
                                  <div key={e.id} className="flex items-start gap-2">
                                    {(e as any).isBirthday ? <Cake className="w-3 h-3 text-indigo-400 mt-0.5 shrink-0" /> : <div className={cn("w-2 h-2 rounded-full mt-1 shrink-0", e.isImportant ? "bg-rose-500" : "bg-bento-accent")} />}
                                    <span className="text-[10px] font-bold leading-tight">{e.name}</span>
                                  </div>
                                ))}
                              </div>
                              <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-slate-900" />
                            </div>
                          )}
                        </div>
                      );
                    }
                    return days;
                  })()}
                </div>

                <div className="mt-8 pt-6 border-t border-slate-100 grid grid-cols-2 gap-4">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-rose-500" />
                    <span className="text-[10px] font-bold text-bento-text-muted uppercase">Důležité</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-indigo-400" />
                    <span className="text-[10px] font-bold text-bento-text-muted uppercase">Narozeniny</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-bento-accent" />
                    <span className="text-[10px] font-bold text-bento-text-muted uppercase">Událost</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'sharing' && (
        <div className="space-y-6">
          <div className="flex items-center gap-2 px-1">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-600"></div>
            <h2 className="text-xs font-black uppercase tracking-[0.2em] text-bento-text-muted">Sdílení kasy a přístupová práva</h2>
          </div>

          <div className="bg-white border border-bento-card-border rounded-[2.5rem] p-8 shadow-sm">
            <div className="max-w-2xl space-y-6">
              <p className="text-sm text-slate-500 leading-relaxed">
                Můžete nasdílet celou kasu <strong>{group.name}</strong> dalším lidem (podle jejich e-mailového účtu Google).
                Určete, zda mohou kasu běžně spravovat a zapisovat do ní (<strong>Editor</strong>) nebo pouze vše prohlížet a rozklikávat bez možností úprav (<strong>Čtenář</strong>).
              </p>

              <div className="p-6 bg-slate-50 border border-slate-200 rounded-3xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center font-bold">
                    <Share2 className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-base text-slate-900">Správa sdílení a rolí</h3>
                    <p className="text-xs text-slate-500">Přidat uživatele, změnit role nebo odebrat přístup</p>
                  </div>
                </div>

                <button
                  onClick={() => setIsShareModalOpen(true)}
                  className="bg-blue-600 text-white font-black py-3.5 px-6 rounded-2xl text-xs uppercase tracking-wider hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/10 flex items-center gap-2 whitespace-nowrap"
                >
                  <UserPlus className="w-4 h-4" />
                  Spravovat sdílení
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Item Modal (Unified for Members/Templates/Groups/Events) */}
      <AnimatePresence>
        {(isMemberModalOpen || isTemplateModalOpen || isGroupModalOpen || isEventModalOpen) && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md flex items-center justify-center p-4 z-[100]">
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl border border-bento-card-border max-h-[90vh] overflow-y-auto"
            >
              <div className="flex justify-between items-center mb-8">
                <div>
                  <h2 className="text-2xl font-bold tracking-tight text-bento-text-main">
                    {isMemberModalOpen ? (editingMember ? 'Upravit' : 'Přidat') : 
                     isTemplateModalOpen ? (editingTemplate ? 'Upravit' : 'Přidat') :
                     isGroupModalOpen ? (editingMemberGroup ? 'Upravit' : 'Přidat') :
                     (editingEvent ? 'Upravit' : 'Přidat')}
                  </h2>
                  <p className="text-[10px] font-black uppercase tracking-widest text-bento-accent">
                    {isMemberModalOpen ? 'Člen týmu' : isTemplateModalOpen ? 'Sazebník' : isGroupModalOpen ? 'Skupina členů' : 'Událost'}
                  </p>
                </div>
                <button 
                  onClick={() => {
                    setIsMemberModalOpen(false);
                    setIsTemplateModalOpen(false);
                    setIsGroupModalOpen(false);
                    setIsEventModalOpen(false);
                  }} 
                  className="p-2 text-bento-text-muted hover:bg-slate-50 rounded-xl transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {isMemberModalOpen ? (
                <div className="space-y-6">
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-2">Celé jméno</label>
                    <input
                      autoFocus
                      type="text"
                      className="w-full px-5 py-4 bg-slate-50 border border-bento-card-border rounded-xl focus:outline-none focus:ring-2 focus:ring-bento-accent/10 font-bold text-sm transition-all"
                      value={memberName}
                      onChange={(e) => setMemberName(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-2">Datum narození</label>
                      <input
                        type="date"
                        className="w-full px-4 py-3 bg-slate-50 border border-bento-card-border rounded-xl focus:outline-none focus:ring-2 focus:ring-bento-accent/10 font-bold text-xs transition-all"
                        value={memberBirthDate}
                        onChange={(e) => setMemberBirthDate(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-2">Pozice / Funkce</label>
                      <input
                        type="text"
                        placeholder="Specifikace pozice..."
                        className="w-full px-4 py-3 bg-slate-50 border border-bento-card-border rounded-xl focus:outline-none focus:ring-2 focus:ring-bento-accent/10 font-bold text-xs transition-all"
                        value={memberPosition}
                        onChange={(e) => setMemberPosition(e.target.value)}
                      />
                    </div>
                  </div>
                  <button
                    disabled={isSaving}
                    onClick={saveMember}
                    className="w-full btn-bento-primary py-4 text-xs font-bold shadow-xl shadow-bento-accent/10 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isSaving ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    {editingMember ? 'Uložit změny' : 'Uložit záznam'}
                  </button>
                </div>
              ) : isTemplateModalOpen ? (
                <div className="space-y-6">
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-2">Název prohřešku</label>
                    <input
                      autoFocus
                      type="text"
                      className="w-full px-5 py-4 bg-slate-50 border border-bento-card-border rounded-xl focus:outline-none focus:ring-2 focus:ring-bento-accent/10 font-bold text-sm transition-all"
                      placeholder="Pojmenování prohřešku..."
                      value={templateName}
                      onChange={(e) => setTemplateName(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-2">Typ výpočtu</label>
                    <div className="flex gap-2 p-1 bg-slate-100/50 rounded-xl">
                      <button
                        onClick={() => setTemplateType('fixed')}
                        className={cn(
                          "flex-1 py-2.5 rounded-lg font-bold text-[10px] uppercase tracking-wider transition-all",
                          templateType === 'fixed' ? "bg-white text-bento-text-main shadow-sm" : "text-bento-text-muted"
                        )}
                      >
                        Pevná taxa
                      </button>
                      <button
                        onClick={() => setTemplateType('dynamic')}
                        className={cn(
                          "flex-1 py-2.5 rounded-lg font-bold text-[10px] uppercase tracking-wider transition-all",
                          templateType === 'dynamic' ? "bg-white text-bento-text-main shadow-sm" : "text-bento-text-muted"
                        )}
                      >
                        Za jednotku
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-2">
                        {templateType === 'fixed' ? `Sazba (${getCurrencySymbol(currentCurrency)})` : `${getCurrencySymbol(currentCurrency)}/jedn.`}
                      </label>
                      <input
                        type="number"
                        className="w-full px-5 py-3.5 bg-slate-50 border border-bento-card-border rounded-xl focus:outline-none focus:ring-2 focus:ring-bento-accent/10 font-bold text-base transition-all"
                        value={templateAmount}
                        onChange={(e) => setTemplateAmount(e.target.value)}
                      />
                    </div>
                    {templateType === 'dynamic' && (
                      <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-2">Jednotka</label>
                        <input
                          type="text"
                          placeholder="min, km..."
                          className="w-full px-5 py-3.5 bg-slate-50 border border-bento-card-border rounded-xl focus:outline-none focus:ring-2 focus:ring-bento-accent/10 font-bold text-base transition-all"
                          value={templateUnit}
                          onChange={(e) => setTemplateUnit(e.target.value)}
                        />
                      </div>
                    )}
                  </div>

                  <button
                    disabled={isSaving}
                    onClick={saveTemplate}
                    className="w-full btn-bento-primary py-4 text-xs font-bold shadow-xl shadow-bento-accent/10 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isSaving ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    {editingTemplate ? 'Uložit změny' : 'Uložit do sazebníku'}
                  </button>
                </div>
              ) : isGroupModalOpen ? (
                <div className="space-y-6">
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-2">Název skupiny</label>
                    <input
                      autoFocus
                      type="text"
                      className="w-full px-5 py-4 bg-slate-50 border border-bento-card-border rounded-xl focus:outline-none focus:ring-2 focus:ring-bento-accent/10 font-bold text-sm transition-all"
                      placeholder="Pojmenování týmu..."
                      value={groupName}
                      onChange={(e) => setGroupName(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-2">Členové skupiny</label>
                    <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                      {members.map(m => (
                        <div 
                          key={m.id}
                          onClick={() => {
                            const newIds = new Set(groupMemberIds);
                            if (newIds.has(m.id)) newIds.delete(m.id);
                            else newIds.add(m.id);
                            setGroupMemberIds(newIds);
                          }}
                          className={cn(
                            "flex items-center justify-between p-3 rounded-xl border-2 transition-all cursor-pointer",
                            groupMemberIds.has(m.id) ? "border-bento-accent bg-bento-accent/5" : "border-slate-50 bg-slate-50"
                          )}
                        >
                          <span className={cn("text-xs font-bold", groupMemberIds.has(m.id) ? "text-bento-text-main" : "text-bento-text-muted")}>
                            {m.name}
                          </span>
                          <div className={cn(
                            "w-4 h-4 rounded border flex items-center justify-center",
                            groupMemberIds.has(m.id) ? "bg-bento-accent border-bento-accent" : "border-slate-300 bg-white"
                          )}>
                            {groupMemberIds.has(m.id) && <Check className="w-3 h-3 text-white" />}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <button
                    disabled={isSaving || !groupName.trim() || groupMemberIds.size === 0}
                    onClick={saveMemberGroup}
                    className="w-full btn-bento-primary py-4 text-xs font-bold shadow-xl shadow-bento-accent/10 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isSaving ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    {editingMemberGroup ? 'Uložit změny' : 'Vytvořit skupinu'}
                  </button>
                </div>
              ) : (
                <div className="space-y-6">
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-2">Název události</label>
                    <input
                      autoFocus
                      type="text"
                      className="w-full px-5 py-4 bg-slate-50 border border-bento-card-border rounded-xl focus:outline-none focus:ring-2 focus:ring-bento-accent/10 font-bold text-sm transition-all"
                      placeholder="Název události..."
                      value={eventName}
                      onChange={(e) => setEventName(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-2">Datum konání</label>
                    <input
                      type="date"
                      className="w-full px-5 py-4 bg-slate-50 border border-bento-card-border rounded-xl focus:outline-none focus:ring-2 focus:ring-bento-accent/10 font-bold text-sm transition-all"
                      value={eventDate}
                      onChange={(e) => setEventDate(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-2">Popis / Co se musí udělat</label>
                    <textarea
                      placeholder="Zadejte detaily..."
                      className="w-full px-5 py-4 bg-slate-50 border border-bento-card-border rounded-xl focus:outline-none focus:ring-2 focus:ring-bento-accent/10 font-bold text-sm transition-all resize-none h-32"
                      value={eventDescription}
                      onChange={(e) => setEventDescription(e.target.value)}
                    />
                  </div>

                  <div 
                    onClick={() => setEventIsImportant(!eventIsImportant)}
                    className={cn(
                      "flex items-center justify-between p-5 rounded-2xl border-2 transition-all cursor-pointer",
                      eventIsImportant ? "border-rose-500 bg-rose-50" : "border-slate-50 bg-slate-50"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center",
                        eventIsImportant ? "bg-rose-500 text-white" : "bg-white text-slate-400"
                      )}>
                        <AlertTriangle className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="font-bold text-sm text-bento-text-main">Důležitá událost</p>
                        <p className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted">Vyšší vizuální priorita</p>
                      </div>
                    </div>
                    <div className={cn(
                      "w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors",
                      eventIsImportant ? "bg-rose-500 border-rose-500" : "bg-white border-slate-200"
                    )}>
                      {eventIsImportant && <Check className="w-4 h-4 text-white" />}
                    </div>
                  </div>

                  <button
                    disabled={isSaving || !eventName.trim() || !eventDate}
                    onClick={saveEvent}
                    className="w-full btn-bento-primary py-4 text-xs font-bold shadow-xl shadow-bento-accent/10 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isSaving ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    {editingEvent ? 'Uložit změny' : 'Založit událost'}
                  </button>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Batch Action Toolbar */}
      <AnimatePresence>
        {selectedIds.size > 0 && !isMemberModalOpen && !isTemplateModalOpen && !isGroupModalOpen && !isEventModalOpen && !isBatchCopyModalOpen && !isBatchDeleteConfirmOpen && !deleteId && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-bento-sidebar text-white px-8 py-4 rounded-3xl shadow-2xl flex items-center gap-8 z-[60] border border-white/10"
          >
            <div className="flex items-center gap-2 border-r border-white/10 pr-8">
              <span className="text-xl font-black tabular-nums">{selectedIds.size}</span>
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Vybráno</span>
            </div>
            
            <div className="flex items-center gap-4">
              {activeTab === 'members' && selectedIds.size > 1 && (
                <button
                  onClick={() => {
                    setEditingMemberGroup(null);
                    setGroupName('');
                    setGroupMemberIds(new Set(selectedIds));
                    setIsMemberModalOpen(false);
                    setIsTemplateModalOpen(false);
                    setIsGroupModalOpen(true);
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-bento-accent text-white rounded-xl transition-all text-sm font-bold shadow-lg shadow-bento-accent/20"
                >
                  <Plus className="w-4 h-4" />
                  Vytvořit skupinu
                </button>
              )}
              <button
                onClick={() => setIsBatchCopyModalOpen(true)}
                className="flex items-center gap-2 px-4 py-2 hover:bg-white/10 rounded-xl transition-all text-sm font-bold"
              >
                <Copy className="w-4 h-4" />
                Kopírovat
              </button>
              <button
                onClick={() => setIsBatchDeleteConfirmOpen(true)}
                className="flex items-center gap-2 px-4 py-2 hover:bg-rose-500/20 text-rose-400 rounded-xl transition-all text-sm font-bold"
              >
                <Trash2 className="w-4 h-4" />
                Smazat vybrané
              </button>
            </div>

            <button
              onClick={() => setSelectedIds(new Set())}
              className="p-2 text-slate-400 hover:bg-white/10 rounded-xl transition-all"
            >
              <X className="w-5 h-5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Individual Delete Confirmation */}
      <AnimatePresence>
        {deleteId && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md flex items-center justify-center p-4 z-[110]">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl text-center border border-bento-card-border"
            >
              <div className="w-16 h-16 bg-rose-50 text-rose-500 rounded-2xl flex items-center justify-center mb-6 mx-auto">
                <Trash2 className="w-8 h-8" />
              </div>
              <h2 className="text-xl font-bold mb-2">Smazat položku?</h2>
              <p className="text-sm font-bold text-bento-text-main mb-1">{deleteId.name}</p>
              <p className="text-xs text-bento-text-muted mb-8">
                Opravdu chcete smazat tuto položku? Tato akce je nevratná.
              </p>
              <div className="flex gap-3">
                <button
                  disabled={isDeleting}
                  onClick={() => setDeleteId(null)}
                  className="flex-1 py-3 text-[11px] font-black uppercase tracking-widest text-bento-text-muted hover:bg-slate-50 rounded-xl disabled:opacity-50"
                >
                  Zrušit
                </button>
                <button
                  disabled={isDeleting}
                  onClick={deleteItem}
                  className="flex-1 bg-rose-600 text-white text-[11px] font-black uppercase tracking-widest py-3 rounded-xl shadow-lg shadow-rose-600/10 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  Smazat
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Batch Delete Confirmation */}
      <AnimatePresence>
        {isBatchDeleteConfirmOpen && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md flex items-center justify-center p-4 z-[110]">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl text-center border border-bento-card-border"
            >
              <div className="w-16 h-16 bg-rose-50 text-rose-500 rounded-2xl flex items-center justify-center mb-6 mx-auto">
                <AlertTriangle className="w-8 h-8" />
              </div>
              <h2 className="text-xl font-bold mb-2">Smazat {selectedIds.size} položek?</h2>
              <p className="text-xs text-bento-text-muted mb-8">
                Opravdu chcete hromadně smazat vybrané položky? Tato akce je nevratná.
              </p>
              <div className="flex gap-3">
                <button
                  disabled={isBatchProcessing}
                  onClick={() => setIsBatchDeleteConfirmOpen(false)}
                  className="flex-1 py-3 text-[11px] font-black uppercase tracking-widest text-bento-text-muted hover:bg-slate-50 rounded-xl disabled:opacity-50"
                >
                  Zrušit
                </button>
                <button
                  disabled={isBatchProcessing}
                  onClick={handleBatchDelete}
                  className="flex-1 bg-rose-600 text-white text-[11px] font-black uppercase tracking-widest py-3 rounded-xl shadow-lg shadow-rose-600/10 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isBatchProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  Potvrdit smazání
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Batch Copy Modal */}
      <AnimatePresence>
        {isBatchCopyModalOpen && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md flex items-center justify-center p-4 z-[110]">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-[2.5rem] p-10 max-w-md w-full shadow-2xl border border-bento-card-border"
            >
              <div className="flex justify-between items-center mb-8">
                <div>
                  <h2 className="text-2xl font-bold tracking-tight">Kopírovat položky</h2>
                  <p className="text-[10px] font-black uppercase tracking-widest text-bento-accent">Vyberte cílovou kasu</p>
                </div>
                <button onClick={() => setIsBatchCopyModalOpen(false)} className="p-2 text-slate-400 hover:bg-slate-50 rounded-xl">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-3">Cílová kasa</label>
                  <div className="space-y-2 max-h-[160px] overflow-y-auto pr-2 custom-scrollbar">
                    {groups.map(g => (
                      <button
                        key={g.id}
                        onClick={() => {
                          setTargetGroupId(g.id);
                          setTargetPeriodId(''); // Reset period when group changes
                        }}
                        className={cn(
                          "w-full flex items-center justify-between p-4 rounded-2xl border-2 transition-all",
                          targetGroupId === g.id ? "border-bento-accent bg-bento-accent/5" : "border-slate-50 bg-slate-50 hover:border-slate-200"
                        )}
                      >
                        <span className="font-bold text-sm">{g.name}{g.id === group.id ? ' (Aktuální)' : ''}</span>
                        {targetGroupId === g.id && <Check className="w-4 h-4 text-bento-accent" />}
                      </button>
                    ))}
                  </div>
                </div>

                <AnimatePresence>
                  {targetGroupId && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-3">Cílové období</label>
                      <div className="space-y-2 max-h-[160px] overflow-y-auto pr-2 custom-scrollbar">
                        {targetPeriods
                          .filter(p => !(targetGroupId === group.id && p.id === period.id))
                          .map(p => (
                            <button
                              key={p.id}
                              onClick={() => setTargetPeriodId(p.id)}
                              className={cn(
                                "w-full flex items-center justify-between p-4 rounded-2xl border-2 transition-all",
                                targetPeriodId === p.id ? "border-bento-accent bg-bento-accent/5" : "border-slate-50 bg-slate-50 hover:border-slate-200"
                              )}
                            >
                              <span className="font-bold text-sm">{p.name}</span>
                              {targetPeriodId === p.id && <Check className="w-4 h-4 text-bento-accent" />}
                            </button>
                          ))}
                        {targetPeriods.length === 0 && (
                          <p className="text-sm text-bento-text-muted text-center py-4 italic">Žádná období nenalezena.</p>
                        )}
                        {targetGroupId === group.id && targetPeriods.length === 1 && targetPeriods[0].id === period.id && (
                          <p className="text-sm text-bento-text-muted text-center py-4 italic">Kromě aktuálního nemá tato kasa jiná období.</p>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <button
                  disabled={!targetGroupId || !targetPeriodId || isBatchProcessing}
                  onClick={handleBatchCopy}
                  className="w-full btn-bento-primary py-4 text-xs font-bold shadow-xl shadow-bento-accent/10 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isBatchProcessing && <X className="w-4 h-4 animate-spin" />}
                  Kopírovat {selectedIds.size} položek
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Share Modal */}
      {isShareModalOpen && auth.currentUser && (
        <ShareModal
          group={group}
          user={auth.currentUser}
          isOpen={isShareModalOpen}
          onClose={() => setIsShareModalOpen(false)}
        />
      )}
    </div>
  );
}
