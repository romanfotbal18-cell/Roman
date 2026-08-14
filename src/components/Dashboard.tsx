import { useState, useEffect, useMemo } from 'react';
import { collection, query, onSnapshot, getDocs, limit, orderBy, doc, updateDoc, addDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { handleFirestoreError, formatCurrency, getCurrencySymbol, formatDate, cn, getUserRole, reconcileOverpaymentsForMember, isFeatureEnabled, checkAndExecuteRecurringFines, getRecurringFineOccurrencesInRange, groupFinesIntoCategories, isFineAutomatic } from '../utils';
import ExportFinanceModal from './ExportFinanceModal';
import { 
  TrendingUp, 
  TrendingDown, 
  Wallet, 
  Users, 
  ArrowRight, 
  PlusCircle, 
  CreditCard, 
  ReceiptText, 
  X,
  Eye,
  ChevronDown,
  ChevronUp,
  BarChart3,
  Activity,
  Eraser,
  FileSpreadsheet,
  RefreshCcw,
  RotateCcw,
  Calendar as CalendarIcon,
  Cake,
  Info,
  ChevronRight,
  ExternalLink,
  Bell,
  Target,
  Trophy,
  GripVertical,
  Trash2,
  Medal,
  TrendingUp as TrendingUpIcon,
  TrendingDown as TrendingDownIcon,
  Flame,
  ShieldCheck,
  CalendarDays,
  PieChart as PieChartIcon,
  Folder,
  FolderPlus,
  FolderOpen,
  ChevronLeft,
  Lock
} from 'lucide-react';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  AreaChart, 
  Area,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  Legend
} from 'recharts';
import { Group, Period, Transaction, Fine, OperationType, Member, Payment, Event, Goal, Envelope, RecurringFine, FineTemplate, GroupedFineCategory } from '../types';

interface DashboardProps {
  group: Group;
  period: Period;
  onNavigate: (section: string) => void;
  onOpenQuickAction: (action: string) => void;
}

type DetailType = 'balance' | 'income' | 'expense' | 'debt' | null;
type StatView = 'sponsors' | 'debtors' | 'violations' | 'monthly' | 'streaks';

export default function Dashboard({ group, period, onNavigate, onOpenQuickAction }: DashboardProps) {
  const userRole = getUserRole(group, auth.currentUser?.email, auth.currentUser?.uid);
  const isReadOnly = userRole === 'viewer';
  const [stats, setStats] = useState({
    totalIncome: 0,
    totalExpense: 0,
    balance: 0,
    totalDebt: 0
  });
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [fines, setFines] = useState<Fine[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [recurringFines, setRecurringFines] = useState<RecurringFine[]>([]);
  const [fineTemplates, setFineTemplates] = useState<FineTemplate[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [envelopes, setEnvelopes] = useState<Envelope[]>([]);
  const [selectedViolationCategory, setSelectedViolationCategory] = useState<GroupedFineCategory | null>(null);
  const [dashboardCardView, setDashboardCardView] = useState<'goals' | 'envelopes'>(() => {
    return (localStorage.getItem(`dashboard_card_view_${group.id}`) as 'goals' | 'envelopes') || 'goals';
  });

  const handleSetDashboardCardView = (view: 'goals' | 'envelopes') => {
    setDashboardCardView(view);
    localStorage.setItem(`dashboard_card_view_${group.id}`, view);
  };

  const [currentPeriod, setCurrentPeriod] = useState<Period>(period);
  const [loading, setLoading] = useState(true);
  const [isResetting, setIsResetting] = useState(false);
  const [activeDetail, setActiveDetail] = useState<DetailType>(null);
  const [selectedEvent, setSelectedEvent] = useState<any>(null);
  const [isCalendarModalOpen, setIsCalendarModalOpen] = useState(false);
  const [isGoalModalOpen, setIsGoalModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [activeStatView, setActiveStatView] = useState<StatView>('sponsors');
  const [resetConfirm, setResetConfirm] = useState<{ name: string, field: string } | null>(null);
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [calendarFilter, setCalendarFilter] = useState<'all' | 'ordinary' | 'important' | 'birthdays' | 'recurring'>('all');

  const [newGoalName, setNewGoalName] = useState('');
  const [newGoalAmount, setNewGoalAmount] = useState('');

  useEffect(() => {
    setCurrentPeriod(period);
    const periodPath = `groups/${group.id}/periods/${period.id}`;
    const unsubPeriod = onSnapshot(doc(db, periodPath), (snapshot) => {
      if (snapshot.exists()) {
        setCurrentPeriod({ id: snapshot.id, ...snapshot.data() } as Period);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, periodPath);
    });

    const transactionsPath = `groups/${group.id}/periods/${period.id}/transactions`;
    const finesPath = `groups/${group.id}/periods/${period.id}/fines`;
    const membersPath = `groups/${group.id}/periods/${period.id}/members`;
    const paymentsPath = `groups/${group.id}/periods/${period.id}/payments`;
    const eventsPath = `groups/${group.id}/periods/${period.id}/events`;

    const unsubMembers = onSnapshot(collection(db, membersPath), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      setMembers(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, membersPath);
    });

    const unsubPayments = onSnapshot(collection(db, paymentsPath), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Payment));
      setPayments(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, paymentsPath);
    });

    const unsubTransactions = onSnapshot(query(collection(db, transactionsPath), orderBy('createdAt', 'desc')), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction));
      const unique = data.filter((v, i, a) => a.findIndex(t => t.id === v.id) === i);
      
      let income = 0;
      let expense = 0;
      
      unique.forEach(t => {
        const isTransfer = t.category === 'Převod' || t.source === 'transfer' || !!t.transferPairId;
        if (!isTransfer) {
          if (t.amount > 0) income += t.amount;
          else expense += t.amount;
        }
      });
      
      setTransactions(unique);
      setStats(prev => ({
        ...prev,
        totalIncome: income,
        totalExpense: Math.abs(expense),
        balance: unique.reduce((sum, t) => sum + t.amount, 0)
      }));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, transactionsPath);
    });

    const unsubFines = onSnapshot(query(collection(db, finesPath), orderBy('createdAt', 'asc')), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Fine));
      const unique = data.filter((v, i, a) => a.findIndex(t => t.id === v.id) === i);
      setFines(unique);
      setLoading(false);
    }, (error) => {
      console.error('[Dashboard] Fines snapshot error:', error);
      handleFirestoreError(error, OperationType.LIST, finesPath);
    });

    const unsubEvents = onSnapshot(collection(db, eventsPath), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Event));
      setEvents(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, eventsPath);
    });

    const goalsPath = `groups/${group.id}/periods/${period.id}/goals`;
    const unsubGoals = onSnapshot(query(collection(db, goalsPath), orderBy('priority', 'asc')), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Goal));
      setGoals(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, goalsPath);
    });

    const envelopesPath = `groups/${group.id}/periods/${period.id}/envelopes`;
    const unsubEnvelopes = onSnapshot(query(collection(db, envelopesPath), orderBy('createdAt', 'asc')), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Envelope));
      setEnvelopes(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, envelopesPath);
    });

    const rfPath = `groups/${group.id}/periods/${period.id}/recurringFines`;
    const unsubRecurring = onSnapshot(collection(db, rfPath), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as RecurringFine));
      setRecurringFines(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, rfPath);
    });

    const templatesPath = `groups/${group.id}/periods/${period.id}/fineTemplates`;
    const unsubTemplates = onSnapshot(collection(db, templatesPath), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FineTemplate));
      setFineTemplates(data);
    }, (error) => {
      console.warn('[Dashboard] fineTemplates snapshot error:', error);
    });

    checkAndExecuteRecurringFines(db, group.id, period.id);

    return () => {
      unsubMembers();
      unsubPayments();
      unsubTransactions();
      unsubFines();
      unsubEvents();
      unsubGoals();
      unsubEnvelopes();
      unsubRecurring();
      unsubTemplates();
      unsubPeriod();
    };
  }, [group.id, period.id]);

  // Recalculate totalDebt when fines or members change
  useEffect(() => {
    const memberIds = new Set(members.map(m => m.id));
    let debt = 0;
    fines.forEach(f => {
      // Only count fines for existing members
      if (!f.paid && memberIds.has(f.memberId)) {
        debt += (f.amount - (f.paidAmount || 0));
      }
    });
    setStats(prev => ({ ...prev, totalDebt: debt }));
  }, [fines, members]);

  useEffect(() => {
    if (!members.length || !fines.length || !payments.length) return;
    
    members.forEach(member => {
      const memberPayments = payments.filter(p => p.memberId === member.id).reduce((s, p) => s + (p.amount || 0), 0);
      const memberFines = fines.filter(f => f.memberId === member.id);
      const memberPaidFines = memberFines.reduce((s, f) => s + (f.paidAmount || 0), 0);
      const hasUnpaidFines = memberFines.some(f => !f.paid);

      if (memberPayments > memberPaidFines && hasUnpaidFines) {
        reconcileOverpaymentsForMember(db, group.id, period.id, member.id);
      }
    });
  }, [members, fines, payments, group.id, period.id]);

  const totalInEnvelopes = useMemo(() => {
    return envelopes.reduce((sum, e) => sum + e.amount, 0);
  }, [envelopes]);

  // Chart Data Calculations
  const balanceTrendData = useMemo(() => {
    let runningBalance = 0;
    return [...transactions]
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(t => {
        runningBalance += t.amount;
        return {
          date: formatDate(t.createdAt),
          balance: runningBalance,
          freeCash: Math.max(0, runningBalance - totalInEnvelopes),
          timestamp: t.createdAt
        };
      });
  }, [transactions, totalInEnvelopes]);

  const incomeBreakdown = useMemo(() => {
    const categories: Record<string, number> = {};
    transactions
      .filter(t => t.amount > 0 && !(t.category === 'Převod' || t.source === 'transfer' || !!t.transferPairId))
      .forEach(t => {
        const key = t.category || 'Jiné';
        categories[key] = (categories[key] || 0) + t.amount;
      });
    
    const colors = ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#64748b'];
    return Object.entries(categories)
      .map(([name, value], i) => ({ 
        name, 
        value, 
        color: colors[i % colors.length] 
      }))
      .sort((a, b) => b.value - a.value);
  }, [transactions]);

  const expenseBreakdown = useMemo(() => {
    const categories: Record<string, number> = {};
    transactions
      .filter(t => t.amount < 0 && !(t.category === 'Převod' || t.source === 'transfer' || !!t.transferPairId))
      .forEach(t => {
        const key = t.category || 'Jiné';
        categories[key] = (categories[key] || 0) + Math.abs(t.amount);
      });
    
    const colors = ['#ef4444', '#f97316', '#ec4899', '#8b5cf6', '#64748b'];
    return Object.entries(categories)
      .map(([name, value], i) => ({ 
        name, 
        value, 
        color: colors[i % colors.length] 
      }))
      .sort((a, b) => b.value - a.value);
  }, [transactions]);

  const debtTrendData = useMemo(() => {
    const events: { timestamp: number; change: number }[] = [];
    const memberIds = new Set(members.map(m => m.id));
    const resetAt = currentPeriod.resetDebtTrendAt || 0;
    
    // Use fines for debt creation, but only for existing members and after reset
    fines.forEach(f => {
      if (memberIds.has(f.memberId) && f.createdAt >= resetAt) {
        events.push({ timestamp: f.createdAt, change: f.amount });
      }
    });
    
    // Use payments for debt reduction, but only for existing members and after reset
    payments.forEach(p => {
      if (memberIds.has(p.memberId) && p.createdAt >= resetAt) {
        // Find if this payment is for a specific fine or just a general payment
        // In our app, payments reduce "total debt" for the member
        events.push({ timestamp: p.createdAt, change: -p.amount });
      }
    });

    events.sort((a, b) => a.timestamp - b.timestamp);

    let currentDebt = 0;
    const history = events.map(e => {
      currentDebt += e.change;
      return {
        date: formatDate(e.timestamp),
        amount: Math.max(0, currentDebt),
        timestamp: e.timestamp
      };
    });

    // If no data, return empty array
    if (history.length === 0) return [];

    // Group by date to show only one point per day (last state of that day)
    const groupedByDate: Record<string, any> = {};
    history.forEach(h => {
      groupedByDate[h.date] = h;
    });

    return Object.values(groupedByDate).sort((a, b) => a.timestamp - b.timestamp);
  }, [fines, payments, members, currentPeriod.resetDebtTrendAt]);

  const resetDebtTrend = async () => {
    if (isReadOnly || isResetting) return;
    if (!confirm('Opravdu chcete vynulovat graf vývoje dluhu? Historické údaje v grafu zmizí, ale veškeré pokuty i transakce zůstanou zachovány.')) return;
    
    setIsResetting(true);
    try {
      const periodRef = doc(db, `groups/${group.id}/periods`, period.id);
      await updateDoc(periodRef, {
        resetDebtTrendAt: Date.now()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `groups/${group.id}/periods/${period.id}`);
    } finally {
      setIsResetting(false);
    }
  };

  const [selectedCategoryTrans, setSelectedCategoryTrans] = useState<{name: string, transactions: Transaction[]} | null>(null);

  // Category Detail Modal
  const showCategoryDetails = (category: string | number, type: 'income' | 'expense') => {
    const filtered = transactions
      .filter(t => {
        const isTransfer = t.category === 'Převod' || t.source === 'transfer' || !!t.transferPairId;
        const tCat = t.category || 'Jiné';
        const tType = t.amount > 0 ? 'income' : 'expense';
        return !isTransfer && tCat === String(category) && tType === type;
      })
      .sort((a, b) => b.createdAt - a.createdAt); // Show newest at top
    setSelectedCategoryTrans({ name: String(category), transactions: filtered });
  };

  const toggleDetail = (type: DetailType) => {
    setActiveDetail(activeDetail === type ? null : type);
  };

  const birthdayEvents = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();

    return members.filter(m => m.birthDate).map(m => {
      const bDate = new Date(m.birthDate!);
      // Calculate this year's date for this birthday
      let date = new Date(currentYear, bDate.getMonth(), bDate.getDate());
      
      // If birthday already happened this year, show it for next year for sorting/upcoming purposes
      if (date < new Date(now.setHours(0,0,0,0))) {
        date = new Date(currentYear + 1, bDate.getMonth(), bDate.getDate());
      }

      const age = date.getFullYear() - bDate.getFullYear();

      return {
        id: `birthday-${m.id}`,
        name: `Narozeniny: ${m.name} (${age}. nar.)`,
        originalName: m.name,
        date: date.toISOString().split('T')[0],
        isBirthday: true,
        member: m,
        age
      };
    });
  }, [members]);

  const nearestRecurringFineEvents = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const active = recurringFines
      .filter(rf => rf.active && rf.nextDueDate && rf.nextDueDate >= today)
      .sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate));

    if (active.length === 0) return [];

    // Nearest upcoming automatic fine
    const nearest = active[0];
    return [{
      id: `recurring-${nearest.id}`,
      name: `⚡ Aut. pokuta: ${nearest.reason} (${nearest.amount} ${getCurrencySymbol(group.currency)})`,
      date: nearest.nextDueDate,
      isRecurringFine: true,
      recurringFine: nearest
    }];
  }, [recurringFines, group.currency]);

  const allUpcomingEvents = useMemo(() => {
    const now = new Date().toISOString().split('T')[0];
    const combined = [
      ...events.map(e => ({ ...e, isBirthday: false, isRecurringFine: false })),
      ...birthdayEvents.map(b => ({ ...b, isRecurringFine: false })),
      ...nearestRecurringFineEvents
    ];

    return combined
      .filter(e => e.date >= now)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [events, birthdayEvents, nearestRecurringFineEvents]);

  const todayEvent = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const combined = [
      ...events.map(e => ({ ...e, isBirthday: false })),
      ...birthdayEvents.map(b => {
        // For today check, we need the actual birthday date in the CURRENT year
        const bDate = new Date(b.member.birthDate!);
        const todayYear = new Date().getFullYear();
        const dateInCurrentYear = new Date(todayYear, bDate.getMonth(), bDate.getDate()).toISOString().split('T')[0];
        return { ...b, date: dateInCurrentYear };
      })
    ];
    return combined.find(e => e.date === today);
  }, [events, birthdayEvents]);

  const upcomingImportant = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return allUpcomingEvents
      .filter(e => (e.isImportant || e.isBirthday) && e.date !== today)
      .slice(0, 2);
  }, [allUpcomingEvents]);

  const freeCash = useMemo(() => {
    return Math.max(0, stats.balance - totalInEnvelopes);
  }, [stats.balance, totalInEnvelopes]);

  const [selectedGoalIndex, setSelectedGoalIndex] = useState(0);

  const goalCalcSource = currentPeriod?.goalCalcSource || 'free_cash';
  const currentGoalBalance = goalCalcSource === 'free_cash' ? freeCash : stats.balance;

  // Cascading allocation across goals in order of priority
  const goalsWithAllocation = useMemo(() => {
    let remaining = Math.max(0, currentGoalBalance);
    return goals.map((g, idx) => {
      const target = g.targetAmount || 0;
      let allocated = 0;
      if (target > 0) {
        allocated = Math.min(remaining, target);
        remaining = Math.max(0, remaining - allocated);
      }
      const progress = target > 0 ? Math.min(100, Math.max(0, (allocated / target) * 100)) : 0;
      return {
        ...g,
        allocatedAmount: allocated,
        progress,
        priorityIndex: idx + 1
      };
    });
  }, [goals, currentGoalBalance]);

  const currentGoalNavIndex = Math.min(selectedGoalIndex, Math.max(0, goalsWithAllocation.length - 1));
  const activeGoal = goalsWithAllocation[currentGoalNavIndex];
  const goalProgress = activeGoal ? activeGoal.progress : 0;

  const handleUpdateGoalCalcSource = async (source: 'free_cash' | 'total_cash') => {
    if (isReadOnly) return;
    try {
      const periodRef = doc(db, `groups/${group.id}/periods/${period.id}`);
      await updateDoc(periodRef, { goalCalcSource: source });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `groups/${group.id}/periods/${period.id}`);
    }
  };

  const handleAddGoal = async () => {
    if (isReadOnly || !newGoalName || !newGoalAmount) return;
    const amount = parseFloat(newGoalAmount);
    if (isNaN(amount) || amount <= 0) return;

    try {
      const goalsPath = `groups/${group.id}/periods/${period.id}/goals`;
      await addDoc(collection(db, goalsPath), {
        name: newGoalName,
        targetAmount: amount,
        priority: goals.length,
        createdAt: Date.now(),
        completed: false,
        periodId: period.id
      });
      setNewGoalName('');
      setNewGoalAmount('');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'goals');
    }
  };

  const handleDeleteGoal = async (id: string) => {
    if (isReadOnly) return;
    try {
      const goalRef = doc(db, `groups/${group.id}/periods/${period.id}/goals`, id);
      await deleteDoc(goalRef);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'goals');
    }
  };

  const handleToggleGoal = async (goal: Goal) => {
    if (isReadOnly) return;
    try {
      const goalRef = doc(db, `groups/${group.id}/periods/${period.id}/goals`, goal.id);
      await updateDoc(goalRef, {
        completed: !goal.completed
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'goals');
    }
  };

  const handleReorderGoals = async (reorderedGoals: Goal[]) => {
    if (isReadOnly) return;
    setGoals(reorderedGoals);
    const batch = writeBatch(db);
    reorderedGoals.forEach((goal, idx) => {
      const goalRef = doc(db, `groups/${group.id}/periods/${period.id}/goals`, goal.id);
      batch.update(goalRef, { priority: idx });
    });
    try {
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'goals-reorder');
    }
  };

  const handleResetStats = () => {
    if (isReadOnly) return;
    let statName = '';
    let field = '';

    switch (activeStatView) {
      case 'sponsors':
        statName = 'Sponzoři (plátci)';
        field = 'sponsorsResetAt';
        break;
      case 'debtors':
        statName = 'Hříšníci (dlužníci)';
        field = 'debtorsResetAt';
        break;
      case 'violations':
        statName = 'Statistika prohřešků';
        field = 'violationsResetAt';
        break;
      case 'monthly':
        statName = 'Měsíční vládci';
        field = 'monthlyResetAt';
        break;
      case 'streaks':
        statName = 'Série bez pokuty';
        field = 'streaksResetAt';
        break;
      default:
        return;
    }

    setResetConfirm({ name: statName, field });
  };

  const confirmReset = async () => {
    if (isReadOnly || !resetConfirm) return;
    
    try {
      const periodRef = doc(db, `groups/${group.id}/periods`, currentPeriod.id);
      await updateDoc(periodRef, {
        [resetConfirm.field]: Date.now()
      });
      setResetConfirm(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `groups/${group.id}/periods/${currentPeriod.id}`);
    }
  };

  // --- Statistics Logic ---
  const statsData = useMemo(() => {
    const globalReset = currentPeriod.statsResetAt || 0;

    // 1. Top 3 Sponsors (Total financial contributions/payments made)
    const paidByMember: Record<string, number> = {};
    const sponsorsReset = Math.max(currentPeriod.sponsorsResetAt || 0, globalReset);
    
    payments
      .filter(p => p.createdAt > sponsorsReset)
      .forEach(p => {
        if (p.amount && p.amount > 0) {
          paidByMember[p.memberId] = (paidByMember[p.memberId] || 0) + p.amount;
        }
      });
    const topSponsors = Object.entries(paidByMember)
      .map(([id, amount]) => ({
        member: members.find(m => m.id === id),
        amount
      }))
      .filter(s => s.member && s.member.active)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 3);

    // 2. Top 3 Debtors (Unpaid fines)
    const debtByMember: Record<string, number> = {};
    const debtorsReset = Math.max(currentPeriod.debtorsResetAt || 0, globalReset);
    
    fines
      .filter(f => f.createdAt > debtorsReset)
      .forEach(f => {
        const unpaid = f.amount - (f.paidAmount || 0);
        if (unpaid > 0) {
          debtByMember[f.memberId] = (debtByMember[f.memberId] || 0) + unpaid;
        }
      });
    const topDebtors = Object.entries(debtByMember)
      .map(([id, amount]) => ({
        member: members.find(m => m.id === id),
        amount
      }))
      .filter(d => d.member && d.member.active)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 3);

    // 3. Most Frequent Violations (Katalog hříchů - Sloučení dle typu prohřešku)
    const violationsReset = Math.max(currentPeriod.violationsResetAt || 0, globalReset);
    const periodFines = fines.filter(f => f.createdAt > violationsReset);

    const groupedCategories = groupFinesIntoCategories(periodFines, fineTemplates);

    const violationChartData = groupedCategories.map(cat => ({
      name: cat.categoryName,
      value: cat.totalCount,
      amount: cat.totalAmount
    })); 

    // 4. Monthly Top Fined
    const monthlyData: Record<string, Record<string, number>> = {};
    const monthlyReset = Math.max(currentPeriod.monthlyResetAt || 0, globalReset);
    
    fines
      .filter(f => f.createdAt > monthlyReset)
      .forEach(f => {
        const date = new Date(f.createdAt);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        if (!monthlyData[monthKey]) monthlyData[monthKey] = {};
        monthlyData[monthKey][f.memberId] = (monthlyData[monthKey][f.memberId] || 0) + f.amount;
      });

    const allMonthlyLeaders = Object.entries(monthlyData)
      .map(([month, memberTotals]) => {
        const sortedEntries = Object.entries(memberTotals).sort((a, b) => b[1] - a[1]);
        const topId = sortedEntries.length > 0 ? sortedEntries[0] : null;
        return {
          month,
          member: topId ? members.find(m => m.id === topId[0]) : null,
          amount: topId ? topId[1] : 0
        };
      })
      .filter(m => m.member);

    const monthlyLeaderboard = [...allMonthlyLeaders]
      .sort((a, b) => b.amount - a.amount);
    
    const lastMonthLeader = [...allMonthlyLeaders]
      .sort((a, b) => b.month.localeCompare(a.month))[0] || null;
    
    let lastMonthRank = 0;
    if (lastMonthLeader) {
      lastMonthRank = monthlyLeaderboard.findIndex(l => l.month === lastMonthLeader.month) + 1;
    }

    // 5. Streaks 
    const now = Date.now();
    const streaks = members
      .filter(m => m.active)
      .map(m => {
        const resetTime = Math.max(currentPeriod.streaksResetAt || 0, globalReset);
        const memberFines = fines
          .filter(f => f.memberId === m.id && f.createdAt > resetTime)
          .sort((a, b) => a.createdAt - b.createdAt);
        
        const periodStart = Math.max(currentPeriod.createdAt, resetTime);
        const fineTimestamps = [periodStart, ...memberFines.map(f => f.createdAt), now];
        
        let bestStreakDays = 0;
        for (let i = 0; i < fineTimestamps.length - 1; i++) {
          const gapMs = fineTimestamps[i+1] - fineTimestamps[i];
          const gapDays = Math.floor(gapMs / (1000 * 60 * 60 * 24));
          if (gapDays > bestStreakDays) {
            bestStreakDays = gapDays;
          }
        }
        
        const lastFineDate = memberFines.length > 0 ? memberFines[memberFines.length - 1].createdAt : periodStart;
        const currentStreakDays = Math.floor((now - lastFineDate) / (1000 * 60 * 60 * 24));
        
        return {
          member: m,
          currentStreakDays,
          bestStreakDays
        };
      })
      .sort((a, b) => b.currentStreakDays - a.currentStreakDays);

    const overallChampion = streaks.length > 0 
      ? [...streaks].sort((a, b) => b.bestStreakDays - a.bestStreakDays)[0]
      : null;

    return { topSponsors, topDebtors, groupedCategories, violationChartData, monthlyLeaderboard, lastMonthLeader, lastMonthRank, streaks, overallChampion };
  }, [fines, payments, members, fineTemplates, currentPeriod]);

  const calculateDaysRemaining = (dateStr: string) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const eventDate = new Date(dateStr);
    eventDate.setHours(0, 0, 0, 0);
    const diffTime = eventDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const showGoals = isFeatureEnabled(group, 'dashboardGoals');
  const showEnvelopes = isFeatureEnabled(group, 'dashboardEnvelopes');
  const showCashboxChart = isFeatureEnabled(group, 'dashboardCashboxChart');
  const showDebts = isFeatureEnabled(group, 'dashboardDebts');
  const showEvents = isFeatureEnabled(group, 'dashboardEvents');
  const showStats = isFeatureEnabled(group, 'dashboardStats');

  const effectiveCardView = useMemo(() => {
    if (showGoals && !showEnvelopes) return 'goals';
    if (!showGoals && showEnvelopes) return 'envelopes';
    return dashboardCardView;
  }, [showGoals, showEnvelopes, dashboardCardView]);

  return (
    <div className="space-y-6 pb-12">
      {/* Goals / Envelopes Switcher Card */}
      {(showGoals || showEnvelopes) && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bento-card bg-white border-bento-card-border overflow-hidden transition-all p-4 md:p-6"
        >
          {/* Top bar with mode switcher */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 mb-4 border-b border-slate-100">
            <div className="flex items-center gap-2">
              {showGoals && showEnvelopes ? (
                <div className="p-1 bg-slate-100/80 rounded-xl flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleSetDashboardCardView('goals')}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all flex items-center gap-1.5",
                      effectiveCardView === 'goals'
                        ? "bg-white text-indigo-600 shadow-2xs"
                        : "text-slate-500 hover:text-slate-900"
                    )}
                  >
                    <Target className="w-3.5 h-3.5" />
                    <span>Cíle</span>
                    {goals.length > 0 && (
                      <span className="px-1.5 py-0.2 rounded-full text-[9px] bg-indigo-50 text-indigo-700 font-bold">
                        {goals.filter(g => !g.completed).length}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSetDashboardCardView('envelopes')}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all flex items-center gap-1.5",
                      effectiveCardView === 'envelopes'
                        ? "bg-white text-purple-600 shadow-2xs"
                        : "text-slate-500 hover:text-slate-900"
                    )}
                  >
                    <Folder className="w-3.5 h-3.5" />
                    <span>Obálky</span>
                    {envelopes.length > 0 && (
                      <span className="px-1.5 py-0.2 rounded-full text-[9px] bg-purple-50 text-purple-700 font-bold">
                        {envelopes.length}
                      </span>
                    )}
                  </button>
                </div>
              ) : showGoals ? (
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg">
                    <Target className="w-4 h-4" />
                  </div>
                  <h3 className="text-xs font-black uppercase tracking-[0.2em] text-bento-text-main">
                    Finanční cíle pokladny
                  </h3>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-purple-50 text-purple-600 rounded-lg">
                    <Folder className="w-4 h-4" />
                  </div>
                  <h3 className="text-xs font-black uppercase tracking-[0.2em] text-bento-text-main">
                    Obálky pokladny (Vyčleněné úspory)
                  </h3>
                </div>
              )}
            </div>

            <div>
              {effectiveCardView === 'goals' ? (
                <button
                  type="button"
                  onClick={() => setIsGoalModalOpen(true)}
                  className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100/80 px-3 py-1.5 rounded-xl transition-all flex items-center gap-1"
                >
                  <Target className="w-3.5 h-3.5" />
                  <span>Správa cílů</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onNavigate('cashbox')}
                  className="text-[10px] font-extrabold uppercase tracking-wider text-purple-600 hover:text-purple-800 bg-purple-50 hover:bg-purple-100 border border-purple-100/80 px-3 py-1.5 rounded-xl transition-all flex items-center gap-1"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>Správa obálek</span>
                </button>
              )}
            </div>
          </div>

          {/* Content based on view */}
          {effectiveCardView === 'goals' ? (
          activeGoal ? (
            <div 
              onClick={() => setIsGoalModalOpen(true)} 
              className="space-y-4 cursor-pointer group"
            >
              <div className="flex justify-between items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Target className="w-4 h-4 text-indigo-600 shrink-0" />
                    <span className="text-[10px] uppercase font-black tracking-[0.15em] text-bento-text-muted">
                      Cíl #{activeGoal.priorityIndex} z {goalsWithAllocation.length}
                    </span>
                    {activeGoal.completed && (
                      <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-800 font-bold text-[9px] rounded-md uppercase">
                        Splněno
                      </span>
                    )}
                  </div>
                  <h3 className="text-lg font-black text-bento-text-main tracking-tight group-hover:text-indigo-600 transition-colors truncate">
                    {activeGoal.name}
                  </h3>
                </div>

                {/* Arrow navigation buttons */}
                {goalsWithAllocation.length > 1 && (
                  <div 
                    className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      disabled={currentGoalNavIndex === 0}
                      onClick={() => setSelectedGoalIndex(prev => Math.max(0, prev - 1))}
                      className="p-1.5 rounded-lg bg-white shadow-2xs hover:bg-slate-50 disabled:opacity-30 disabled:hover:bg-white text-slate-700 transition-all cursor-pointer disabled:cursor-not-allowed"
                      title="Předchozí cíl"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-[10px] font-mono font-black text-slate-600 px-1.5 min-w-[32px] text-center">
                      {currentGoalNavIndex + 1}/{goalsWithAllocation.length}
                    </span>
                    <button
                      type="button"
                      disabled={currentGoalNavIndex === goalsWithAllocation.length - 1}
                      onClick={() => setSelectedGoalIndex(prev => Math.min(goalsWithAllocation.length - 1, prev + 1))}
                      className="p-1.5 rounded-lg bg-white shadow-2xs hover:bg-slate-50 disabled:opacity-30 disabled:hover:bg-white text-slate-700 transition-all cursor-pointer disabled:cursor-not-allowed"
                      title="Další cíl"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              <div className="flex justify-between items-end gap-2">
                <div>
                  <div className="text-2xl font-black text-indigo-600 leading-none mb-1">
                    {activeGoal.progress.toFixed(0)}%
                  </div>
                  <div className="text-[10px] font-bold text-bento-text-muted uppercase tracking-widest flex items-center gap-1">
                    <span>{formatCurrency(activeGoal.allocatedAmount, group.currency)} / {formatCurrency(activeGoal.targetAmount, group.currency)}</span>
                    <span className="text-[9px] text-slate-400 font-normal">
                      ({goalCalcSource === 'free_cash' ? 'z volné hotovosti' : 'z celkové hotovosti'})
                    </span>
                  </div>
                </div>

                {activeGoal.progress >= 100 ? (
                  <div className="flex items-center gap-1.5 text-[10px] font-black uppercase text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-100 animate-bounce">
                    <Trophy className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Cíl splněn!</span>
                  </div>
                ) : activeGoal.priorityIndex > 1 && activeGoal.allocatedAmount === 0 ? (
                  <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-amber-700 bg-amber-50 px-2 py-1 rounded-lg border border-amber-100">
                    <Lock className="w-3.5 h-3.5 text-amber-600" />
                    <span>Čeká na cíl #{activeGoal.priorityIndex - 1}</span>
                  </div>
                ) : null}
              </div>
              
              <div className="relative h-4 bg-slate-100 rounded-full overflow-hidden border border-slate-50 flex items-center">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${activeGoal.progress}%` }}
                  transition={{ duration: 1, ease: "easeOut" }}
                  className={cn(
                    "absolute inset-y-0 left-0 bg-gradient-to-r transition-all duration-500",
                    activeGoal.progress >= 100 ? "from-emerald-400 to-emerald-500" : "from-bento-accent to-indigo-500"
                  )}
                />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                   <div className="w-full h-full opacity-20 bg-[radial-gradient(circle,white_1px,transparent_1px)] bg-[size:10px_10px]" />
                </div>
              </div>
            </div>
          ) : (
            <div 
              onClick={() => setIsGoalModalOpen(true)}
              className="flex items-center justify-between py-3 px-4 bg-slate-50 border border-dashed border-slate-200 rounded-2xl cursor-pointer hover:bg-indigo-50/50 hover:border-indigo-200 transition-all"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-white rounded-xl flex items-center justify-center border border-slate-200 shadow-2xs">
                  <Target className="w-4 h-4 text-indigo-500" />
                </div>
                <div>
                  <h3 className="text-xs font-black text-slate-700">Zatím žádný cíl</h3>
                  <p className="text-[10px] text-slate-400 font-medium">Klikněte pro vytvoření prvního finančního cíle</p>
                </div>
              </div>
              <PlusCircle className="w-5 h-5 text-indigo-500" />
            </div>
          )
        ) : (
          envelopes.length === 0 ? (
            <div 
              onClick={() => onNavigate('cashbox')}
              className="flex items-center justify-between py-3 px-4 bg-purple-50/50 border border-dashed border-purple-200 rounded-2xl cursor-pointer hover:bg-purple-50 transition-all"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-purple-100 text-purple-700 rounded-xl flex items-center justify-center">
                  <FolderPlus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-xs font-black text-purple-900">Zatím žádné obálky</h3>
                  <p className="text-[10px] text-purple-600 font-medium">Vyčleňte úspory pro konkrétní účely v pokladně</p>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-purple-600" />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-slate-700">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase font-black tracking-wider text-purple-600 bg-purple-50 px-2.5 py-1 rounded-lg border border-purple-100">
                    Vyčleněné úspory celkem
                  </span>
                  <span className="font-mono font-black text-purple-900 text-sm">
                    {formatCurrency(totalInEnvelopes, group.currency)}
                  </span>
                </div>
                <span className="text-[10px] font-medium text-slate-500">
                  Volné peníze: <strong className="text-slate-800 font-mono font-black">{formatCurrency(freeCash, group.currency)}</strong>
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 max-h-[160px] overflow-y-auto custom-scrollbar pr-1">
                {envelopes.map((env) => {
                  const envType = env.type || 'virtual';
                  const hasTarget = env.targetAmount && env.targetAmount > 0;
                  const percent = hasTarget ? Math.min(100, Math.round((env.amount / env.targetAmount!) * 100)) : 0;
                  return (
                    <div
                      key={env.id}
                      onClick={() => onNavigate('cashbox')}
                      className="p-3 bg-slate-50 hover:bg-purple-50/50 border border-slate-200 hover:border-purple-200 rounded-xl cursor-pointer transition-all flex flex-col justify-between space-y-1.5"
                    >
                      <div className="flex items-start justify-between gap-1">
                        <div>
                          <span className="text-xs font-extrabold text-slate-800 line-clamp-1">{env.name}</span>
                          <span className="text-[9px] font-bold text-slate-400 block -mt-0.5">
                            {envType === 'cash' ? '💵 Hotovostní' : envType === 'bank' ? '🏦 Na účtu' : '🌐 Klasická'}
                          </span>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-xs font-mono font-black text-purple-700 block">
                            {formatCurrency(env.amount, group.currency)}
                          </span>
                        </div>
                      </div>

                      {hasTarget ? (
                        <div className="space-y-1">
                          <div className="flex justify-between text-[9px] text-slate-500 font-bold">
                            <span>Cíl: {formatCurrency(env.targetAmount!, group.currency)}</span>
                            <span>{percent}%</span>
                          </div>
                          <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                            <div
                              className="bg-purple-600 h-full rounded-full transition-all duration-300"
                              style={{ width: `${percent}%` }}
                            />
                          </div>
                        </div>
                      ) : (
                        <p className="text-[10px] text-slate-400 line-clamp-1 italic">
                          {env.note || 'Volná obálka'}
                        </p>
                      )}

                      {env.targetDate && (
                        <div className="text-[9px] font-semibold text-indigo-600 pt-0.5">
                          📅 Do {new Date(env.targetDate).toLocaleDateString('cs-CZ')}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )
        )}
      </motion.div>
      )}

      {/* Dynamic Grid Layout */}
      {(showCashboxChart || showDebts || showEvents || showStats) && (
      <div className="grid grid-cols-1 md:grid-cols-6 gap-6">
        {/* Balance Card */}
        {showCashboxChart && (
        <motion.div 
          layout
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          onClick={() => toggleDetail('balance')}
          className={cn(
            "md:col-span-2 bento-card text-white border-none shadow-xl transition-all cursor-pointer min-h-[180px] flex flex-col justify-between overflow-hidden relative",
            activeDetail === 'balance' ? "bg-slate-900 border-bento-accent ring-2 ring-bento-accent" : "bg-bento-sidebar"
          )}
        >
          <div className="flex justify-between items-start z-10">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase font-black tracking-[0.2em] text-white/50">Pokladna</span>
              <div className="text-2xl font-black tracking-tighter">
                {formatCurrency(stats.balance, group.currency)}
              </div>
            </div>
            <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center backdrop-blur-md">
              <Wallet className="w-5 h-5 text-bento-accent" />
            </div>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-white/40 font-bold z-10">
            <CreditCard className="w-3 h-3" />
            <span>Detail trendu</span>
          </div>
          <div className="absolute right-0 bottom-0 top-0 w-1/2 bg-gradient-to-l from-white/5 to-transparent pointer-events-none" />
        </motion.div>
        )}

        {/* Debt Card */}
        {showDebts && (
        <motion.div 
          layout
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1 }}
          onClick={() => toggleDetail('debt')}
          className={cn(
            "md:col-span-2 bento-card min-h-[180px] flex flex-col justify-between transition-all cursor-pointer",
            activeDetail === 'debt' ? "bg-rose-100 border-rose-300 ring-2 ring-rose-400/20" : "bg-rose-50 border-rose-100"
          )}
        >
          <div className="flex justify-between items-start">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase font-black tracking-[0.2em] text-rose-400">Dluhy</span>
              <div className="text-2xl font-black tracking-tighter text-rose-600">
                {formatCurrency(stats.totalDebt, group.currency)}
              </div>
            </div>
            <div className="w-10 h-10 bg-rose-100 rounded-xl flex items-center justify-center">
              <Users className="w-5 h-5 text-rose-500" />
            </div>
          </div>
          <div className="flex justify-between items-center">
            <button 
              onClick={(e) => {
                e.stopPropagation();
                onNavigate('debts');
              }}
              className="group flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-rose-600 hover:gap-2 transition-all"
            >
              List <ArrowRight className="w-3 h-3" />
            </button>
            <Activity className="w-3.5 h-3.5 text-rose-300" />
          </div>
        </motion.div>
        )}

        {/* Events Widget */}
        {showEvents && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2 }}
          onClick={() => setIsCalendarModalOpen(true)}
          className="md:col-span-2 bento-card bg-white border-bento-card-border cursor-pointer hover:border-bento-accent/30 transition-all p-6 group flex flex-col min-h-[180px]"
        >
          <div className="flex justify-between items-start mb-4">
            <span className="text-[10px] uppercase font-black tracking-[0.2em] text-bento-text-muted">Události</span>
            <div className="w-8 h-8 bg-bento-accent/10 rounded-lg flex items-center justify-center">
              <CalendarIcon className="w-4 h-4 text-bento-accent" />
            </div>
          </div>

          <div className="flex-1 space-y-3">
            {todayEvent ? (
              <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3">
                <div className="flex items-center gap-2 mb-1">
                  {todayEvent.isBirthday ? <Cake className="w-3.5 h-3.5 text-emerald-600" /> : <Bell className="w-3.5 h-3.5 text-emerald-600" />}
                  <span className="text-[10px] font-black uppercase text-emerald-600">Dnes</span>
                </div>
                <p className="text-[11px] font-black text-emerald-900 line-clamp-1 leading-tight">{todayEvent.name}</p>
              </div>
            ) : upcomingImportant.length > 0 ? (
              <div className="bg-slate-50 border border-slate-100 rounded-xl p-3">
                <div className="flex items-center gap-2 mb-1">
                  {upcomingImportant[0].isBirthday ? <Cake className="w-3.5 h-3.5 text-bento-accent" /> : <Bell className="w-3.5 h-3.5 text-rose-500" />}
                  <span className={cn("text-[10px] font-black uppercase", upcomingImportant[0].isImportant ? "text-rose-500" : "text-bento-accent")}>
                    Za {calculateDaysRemaining(upcomingImportant[0].date)} dní
                  </span>
                </div>
                <p className="text-[11px] font-black text-bento-text-main line-clamp-1 leading-tight">{upcomingImportant[0].name}</p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-2 opacity-30">
                <CalendarIcon className="w-6 h-6 mb-1" />
                <span className="text-[10px] font-bold uppercase">Žádné akce</span>
              </div>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-widest text-bento-accent group-hover:gap-2 flex items-center transition-all">
              Kalendář <ChevronRight className="w-3 h-3 ml-1" />
            </span>
          </div>
        </motion.div>
        )}

        {/* Income Card */}
        {showStats && (
        <motion.div 
          layout
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2 }}
          onClick={() => toggleDetail('income')}
          className={cn(
            "md:col-span-2 bento-card flex flex-col justify-between transition-all cursor-pointer",
            activeDetail === 'income' ? "bg-emerald-50 border-emerald-200 ring-2 ring-emerald-500/20" : ""
          )}
        >
          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-bento-text-muted">Příjmy</span>
          <div className="flex items-center gap-2 mt-4">
            <TrendingUp className="w-4 h-4 text-emerald-500" />
            <span className="text-3xl font-black tracking-tighter text-emerald-600 leading-none">{formatCurrency(stats.totalIncome, group.currency)}</span>
          </div>
        </motion.div>
        )}

        {/* Expense Card */}
        {showStats && (
        <motion.div 
          layout
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3 }}
          onClick={() => toggleDetail('expense')}
          className={cn(
            "md:col-span-2 bento-card flex flex-col justify-between transition-all cursor-pointer",
            activeDetail === 'expense' ? "bg-rose-50 border-rose-200 ring-2 ring-rose-500/20" : ""
          )}
        >
          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-bento-text-muted">Výdaje</span>
          <div className="flex items-center gap-2 mt-4">
            <TrendingDown className="w-4 h-4 text-rose-500" />
            <span className="text-3xl font-black tracking-tighter text-rose-500 leading-none">{formatCurrency(stats.totalExpense, group.currency)}</span>
          </div>
        </motion.div>
        )}

        {/* Navigation / Action Card */}
        {showStats && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.4 }}
          onClick={() => onNavigate('cashbox')}
          className="md:col-span-2 bento-card bg-bento-sidebar text-white border-none cursor-pointer hover:scale-[1.02] active:scale-95 transition-all p-6 group flex flex-col justify-between"
        >
          <span className="text-[10px] uppercase font-black tracking-[0.2em] text-white/50">Historie a pokladna</span>
          <div className="mt-4">
            <div className="font-black flex items-center justify-between uppercase text-xs tracking-widest">
              Detailní správa
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </div>
          </div>
        </motion.div>
        )}

      </div>
      )}

      {/* Chart/Detail Section */}
      <AnimatePresence mode="wait">
        {activeDetail && (
          <motion.div
            initial={{ opacity: 0, height: 0, y: -20 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: -20 }}
            className="overflow-hidden"
          >
            <div className="bento-card border-bento-accent/20 bg-white shadow-xl shadow-slate-200/50 p-0 overflow-hidden">
              <div className="bg-slate-50 border-b border-bento-card-border p-6 flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-bento-accent animate-pulse"></div>
                  <h3 className="text-xs font-black uppercase tracking-[0.2em] text-bento-text-main">
                    {activeDetail === 'balance' && 'Analýza vývoje zůstatku'}
                    {activeDetail === 'debt' && 'Vývoj nezaplacených pokut'}
                    {activeDetail === 'income' && 'Struktura příjmů'}
                    {activeDetail === 'expense' && 'Rozbor výdajů'}
                  </h3>
                </div>
                <button 
                  onClick={() => setActiveDetail(null)}
                  className="p-2 text-bento-text-muted hover:bg-white rounded-xl transition-all"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-8">
                {activeDetail === 'balance' && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                      <div className="lg:col-span-3 h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={balanceTrendData}>
                            <defs>
                              <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15}/>
                                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                              </linearGradient>
                              <linearGradient id="colorFreeCash" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.15}/>
                                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis dataKey="date" stroke="#94a3b8" fontSize={10} tickLine={false} />
                            <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} tickFormatter={(val) => `${val}`} />
                            <Tooltip 
                              contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 25px -5px rgb(0 0 0 / 0.1)' }}
                              formatter={(value: any, name: any) => [
                                formatCurrency(value, group.currency), 
                                name === 'freeCash' ? 'Hotovost (mimo obálky)' : 'Celkový zůstatek'
                              ]}
                            />
                            <Legend 
                              wrapperStyle={{ paddingTop: '10px', fontSize: '11px', fontWeight: 700 }}
                              formatter={(value: string) => value === 'freeCash' ? 'Hotovost (mimo obálky)' : 'Celkový zůstatek'}
                            />
                            <Area type="monotone" dataKey="balance" name="balance" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorBalance)" />
                            <Area type="monotone" dataKey="freeCash" name="freeCash" stroke="#8b5cf6" strokeWidth={2} strokeDasharray="4 4" fillOpacity={1} fill="url(#colorFreeCash)" />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="space-y-3">
                        <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-100">
                          <span className="text-[10px] font-bold uppercase tracking-widest text-bento-text-muted block mb-0.5">Počáteční stav</span>
                          <p className="text-base font-black text-bento-text-main">{formatCurrency(balanceTrendData[0]?.balance || 0, group.currency)}</p>
                        </div>
                        <div className="p-3.5 bg-blue-50/50 border border-blue-100 rounded-2xl">
                          <span className="text-[10px] font-bold uppercase tracking-widest text-blue-500 block mb-0.5">Celkový zůstatek</span>
                          <p className="text-base font-black text-blue-600">{formatCurrency(stats.balance, group.currency)}</p>
                        </div>
                        <div className="p-3.5 bg-purple-50/50 border border-purple-100 rounded-2xl">
                          <span className="text-[10px] font-bold uppercase tracking-widest text-purple-600 block mb-0.5">Volné peníze</span>
                          <p className="text-base font-black text-purple-700">{formatCurrency(freeCash, group.currency)}</p>
                          <span className="text-[9px] text-purple-500 font-medium block mt-0.5">
                            Po odečtení {formatCurrency(totalInEnvelopes, group.currency)} v obálkách
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Envelopes Overview below chart */}
                    <div className="pt-5 border-t border-slate-100">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Folder className="w-4 h-4 text-purple-600" />
                          <span className="text-xs font-black uppercase tracking-wider text-slate-700">
                            Vytvořené obálky ({envelopes.length})
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-xs font-mono font-bold text-purple-700 block">
                            Celkem v obálkách: {formatCurrency(totalInEnvelopes, group.currency)}
                          </span>
                        </div>
                      </div>

                      {envelopes.length > 0 ? (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5">
                          {envelopes.map(env => {
                            return (
                              <div key={env.id} className="p-2.5 bg-purple-50/40 border border-purple-100 rounded-xl flex flex-col justify-between">
                                <span className="text-[11px] font-extrabold text-slate-800 truncate" title={env.name}>{env.name}</span>
                                <div className="mt-1">
                                  <span className="text-xs font-mono font-black text-purple-700 block">
                                    {formatCurrency(env.amount, group.currency)}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="p-3 bg-slate-50 border border-dashed border-slate-200 rounded-xl text-center text-[11px] text-slate-400 font-medium">
                          Zatím nebyly vytvořeny žádné obálky
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {activeDetail === 'income' && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
                    <div className="h-[250px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={incomeBreakdown}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={80}
                            paddingAngle={5}
                            dataKey="value"
                            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                            onClick={(data: any) => showCategoryDetails(data.name, 'income')}
                            className="cursor-pointer"
                          >
                            {incomeBreakdown.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="space-y-4">
                      <h4 className="text-sm font-bold text-bento-text-main">Rozdělení příjmů (dle kategorií)</h4>
                      <div className="space-y-3">
                        {incomeBreakdown.map((item, i) => (
                          <button 
                            key={i} 
                            onClick={() => showCategoryDetails(item.name, 'income')}
                            className="w-full flex justify-between items-center p-3 rounded-xl hover:bg-slate-50 transition-all border border-transparent hover:border-bento-card-border group"
                          >
                            <div className="flex items-center gap-2">
                              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }}></div>
                              <span className="text-sm font-bold text-bento-text-main group-hover:text-bento-accent">{item.name}</span>
                            </div>
                            <span className="text-sm font-black text-bento-text-main">{formatCurrency(item.value, group.currency)}</span>
                          </button>
                        ))}
                        <div className="pt-3 border-t border-bento-card-border flex justify-between items-center px-3">
                          <span className="text-xs font-bold text-bento-text-muted">Celkem</span>
                          <span className="text-base font-black text-emerald-600">{formatCurrency(stats.totalIncome, group.currency)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeDetail === 'expense' && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
                    <div className="h-[250px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={expenseBreakdown}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={80}
                            paddingAngle={5}
                            dataKey="value"
                            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                            onClick={(data: any) => showCategoryDetails(data.name, 'expense')}
                            className="cursor-pointer"
                          >
                            {expenseBreakdown.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="space-y-4">
                      <h4 className="text-sm font-bold text-bento-text-main">Rozdělení výdajů (dle kategorií)</h4>
                      <div className="space-y-3">
                        {expenseBreakdown.map((item, i) => (
                          <button 
                            key={i} 
                            onClick={() => showCategoryDetails(item.name, 'expense')}
                            className="w-full flex justify-between items-center p-3 rounded-xl hover:bg-slate-50 transition-all border border-transparent hover:border-bento-card-border group"
                          >
                            <div className="flex items-center gap-2">
                              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }}></div>
                              <span className="text-sm font-bold text-bento-text-main group-hover:text-bento-accent">{item.name}</span>
                            </div>
                            <span className="text-sm font-black text-bento-text-main">{formatCurrency(item.value, group.currency)}</span>
                          </button>
                        ))}
                        <div className="pt-3 border-t border-bento-card-border flex justify-between items-center px-3">
                          <span className="text-xs font-bold text-bento-text-muted">Celkem</span>
                          <span className="text-base font-black text-rose-600">{formatCurrency(stats.totalExpense, group.currency)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeDetail === 'debt' && (
                  <div className="space-y-6">
                    <div className="h-[300px] relative">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={debtTrendData}>
                          <defs>
                            <linearGradient id="colorDebt" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#ef4444" stopOpacity={0.1}/>
                              <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis dataKey="date" hide />
                          <YAxis hide />
                          <Tooltip 
                            contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                            formatter={(value: any) => [formatCurrency(value, group.currency), 'Celkový dluh']}
                          />
                          <Area type="monotone" dataKey="amount" stroke="#ef4444" strokeWidth={3} fillOpacity={1} fill="url(#colorDebt)" />
                        </AreaChart>
                      </ResponsiveContainer>
                      {!isReadOnly && (
                        <button 
                          onClick={resetDebtTrend}
                          disabled={isResetting}
                          className="absolute top-2 right-2 p-2 bg-slate-50 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all flex items-center gap-2 text-[10px] uppercase font-bold"
                          title="Vynulovat graf"
                        >
                          <RotateCcw className={cn("w-3 h-3", isResetting && "animate-spin")} />
                          Vynulovat
                        </button>
                      )}
                    </div>
                    <p className="text-center text-[10px] uppercase font-bold tracking-[0.2em] text-bento-text-muted">Vývoj celkového nevybraného dluhu v čase</p>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Statistics Section */}
      <div className="pt-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div className="flex items-center justify-between flex-1">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-indigo-500"></div>
              <h3 className="text-xs font-black uppercase tracking-[0.2em] text-bento-text-muted">Statistiky a vhledy</h3>
            </div>
            
            {!isReadOnly && (
              <button
                onClick={handleResetStats}
                className="flex items-center gap-2 px-3 py-1.5 bg-rose-50 text-rose-600 hover:bg-rose-100 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all border border-rose-100"
              >
                <RotateCcw className="w-3 h-3" />
                Anulovat statistiku
              </button>
            )}
          </div>

          <div className="flex bg-slate-100 p-1 rounded-2xl border border-slate-200 overflow-x-auto custom-scrollbar no-scrollbar scrollbar-hide">
            <StatTab 
              active={activeStatView === 'sponsors'} 
              onClick={() => setActiveStatView('sponsors')} 
              icon={Medal} 
              label="Sponzoři" 
            />
            <StatTab 
              active={activeStatView === 'debtors'} 
              onClick={() => setActiveStatView('debtors')} 
              icon={TrendingDownIcon} 
              label="Dlužníci" 
            />
            <StatTab 
              active={activeStatView === 'violations'} 
              onClick={() => setActiveStatView('violations')} 
              icon={PieChartIcon} 
              label="Prohřešky" 
            />
            <StatTab 
              active={activeStatView === 'monthly'} 
              onClick={() => setActiveStatView('monthly')} 
              icon={CalendarDays} 
              label="Měsíční" 
            />
            <StatTab 
              active={activeStatView === 'streaks'} 
              onClick={() => setActiveStatView('streaks')} 
              icon={Flame} 
              label="Série" 
            />
          </div>
        </div>

        <motion.div
           key={activeStatView}
           initial={{ opacity: 0, y: 10 }}
           animate={{ opacity: 1, y: 0 }}
           transition={{ duration: 0.3 }}
           className="bento-card bg-white border-bento-card-border p-6 md:p-8 min-h-[340px]"
        >
          {activeStatView === 'sponsors' && (
            <div className="space-y-8">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-lg font-black text-bento-text-main">Top 3 Štědří plátci</h4>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Členové, kteří celkově přispěli nejvíce finančních prostředků</p>
                </div>
                <Medal className="w-6 h-6 text-amber-500" />
              </div>
              
              <div className="flex flex-col md:flex-row items-end justify-center gap-4 md:gap-8 pt-6">
                {/* Silver - 2nd */}
                {statsData.topSponsors[1] && (
                  <div className="flex flex-col items-center gap-3 order-2 md:order-1">
                    <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center border-2 border-slate-200 relative">
                       <span className="text-xl font-black text-slate-400">2</span>
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-black text-bento-text-main truncate w-24">
                        {statsData.topSponsors[1].member?.name}
                      </p>
                      <p className="text-xs font-bold text-slate-400">{formatCurrency(statsData.topSponsors[1].amount, group.currency)}</p>
                    </div>
                    <div className="w-20 h-24 bg-slate-100 rounded-t-xl" />
                  </div>
                )}
                
                {/* Gold - 1st */}
                {statsData.topSponsors[0] && (
                  <div className="flex flex-col items-center gap-3 order-1 md:order-2">
                    <div className="w-16 h-16 rounded-2xl bg-amber-50 flex items-center justify-center border-2 border-amber-200 relative shadow-lg shadow-amber-500/10">
                       <Trophy className="w-8 h-8 text-amber-500" />
                       <div className="absolute -top-2 -right-2 bg-amber-500 text-white text-[10px] font-black w-6 h-6 rounded-full flex items-center justify-center border-2 border-white">1</div>
                    </div>
                    <div className="text-center">
                      <p className="text-base font-black text-bento-text-main truncate w-32">
                        {statsData.topSponsors[0].member?.name}
                      </p>
                      <p className="text-sm font-black text-amber-600">{formatCurrency(statsData.topSponsors[0].amount, group.currency)}</p>
                    </div>
                    <div className="w-24 h-32 bg-amber-50 rounded-t-2xl border-x border-t border-amber-100" />
                  </div>
                )}

                {/* Bronze - 3rd */}
                {statsData.topSponsors[2] && (
                  <div className="flex flex-col items-center gap-3 order-3">
                    <div className="w-14 h-14 rounded-2xl bg-orange-50 flex items-center justify-center border-2 border-orange-100 relative">
                       <span className="text-xl font-black text-orange-400">3</span>
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-black text-bento-text-main truncate w-24">
                        {statsData.topSponsors[2].member?.name}
                      </p>
                      <p className="text-xs font-bold text-slate-400">{formatCurrency(statsData.topSponsors[2].amount, group.currency)}</p>
                    </div>
                    <div className="w-20 h-16 bg-orange-50/50 rounded-t-xl" />
                  </div>
                )}

                {statsData.topSponsors.length === 0 && (
                   <div className="text-center py-12 w-full text-slate-300">
                     <Medal className="w-10 h-10 mx-auto mb-3 opacity-20" />
                     <p className="font-bold text-xs uppercase tracking-widest leading-relaxed">Zatím nikdo nic nezaplatil.<br/>Pokladna zeje prázdnotou.</p>
                   </div>
                )}
              </div>
            </div>
          )}

          {activeStatView === 'debtors' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-lg font-black text-rose-600">Top 3 Největší dlužníci</h4>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Tyto členové mají v kapse největší díry (neuhrané pokuty)</p>
                </div>
                <TrendingDownIcon className="w-6 h-6 text-rose-500" />
              </div>

              <div className="space-y-3 pt-4">
                {statsData.topDebtors.map((debtor, idx) => (
                  <div key={idx} className="flex items-center gap-4 bg-rose-50/30 p-4 rounded-2xl border border-rose-100/50 group hover:bg-rose-50 transition-all">
                    <div className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm",
                      idx === 0 ? "bg-rose-500 text-white" : "bg-rose-100 text-rose-600"
                    )}>
                      {idx + 1}.
                    </div>
                    <div className="flex-1">
                      <h5 className="font-black text-bento-text-main">{debtor.member?.name}</h5>
                      <div className="w-full h-1.5 bg-rose-100 rounded-full mt-1.5 overflow-hidden">
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: `${(debtor.amount / (statsData.topDebtors[0]?.amount || 1)) * 100}%` }}
                          className="h-full bg-rose-500" 
                        />
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-black text-rose-600">{formatCurrency(debtor.amount, group.currency)}</p>
                      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">Aktuální dluh</p>
                    </div>
                  </div>
                ))}
                
                {statsData.topDebtors.length === 0 && (
                   <div className="text-center py-12 text-slate-300">
                     <Trophy className="w-10 h-10 mx-auto mb-3 opacity-20" />
                     <p className="font-bold text-xs uppercase tracking-widest">Wow! Nikdo nedluží ani korunu.</p>
                   </div>
                )}
              </div>
            </div>
          )}

          {activeStatView === 'violations' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-100">
                <div>
                  <h4 className="text-lg font-black text-indigo-600 uppercase tracking-tight flex items-center gap-2">
                    <span>Katalog hříchů</span>
                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-extrabold normal-case border border-indigo-100">
                      Souhrnný přehled prohřešků
                    </span>
                  </h4>
                  <p className="text-[11px] font-medium text-slate-500 mt-0.5">
                    Pokuty jsou sloučeny dle typu (bez rozdělení na konkrétní časy či poznámky). Kliknutím na řádek zobrazíte detail, celkovou částku a rozdělení na ruční vs. automatické zápisy.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* Donut Chart */}
                <div className="lg:col-span-5 bg-slate-50/70 p-4 rounded-3xl border border-slate-100 flex flex-col items-center justify-center min-h-[280px]">
                  {statsData.violationChartData.length > 0 ? (
                    <div className="w-full h-[250px] relative">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={statsData.violationChartData}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={85}
                            paddingAngle={4}
                            dataKey="value"
                          >
                            {statsData.violationChartData.map((entry, index) => (
                              <Cell
                                key={`cell-${index}`}
                                fill={['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#14b8a6'][index % 7]}
                              />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(value: any, name: any, props: any) => [
                              `${value}x pokuta (${formatCurrency(props.payload.amount || 0, group.currency)})`,
                              name
                            ]}
                            contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 25px -5px rgb(0 0 0 / 0.1)' }}
                            itemStyle={{ fontSize: '12px', fontWeight: 'bold' }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
                        <span className="text-2xl font-black text-slate-900">
                          {statsData.groupedCategories.reduce((s, c) => s + c.totalCount, 0)}x
                        </span>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                          Celkem pokut
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-10 text-slate-300">
                      <ReceiptText className="w-10 h-10 mx-auto mb-2 opacity-30" />
                      <p className="text-xs font-bold text-slate-400">Žádné zapsané pokuty v tomto období.</p>
                    </div>
                  )}
                </div>

                {/* Categories List Cards */}
                <div className="lg:col-span-7 space-y-2.5">
                  {statsData.groupedCategories.map((cat, idx) => {
                    const color = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#14b8a6'][idx % 7];
                    return (
                      <div
                        key={cat.categoryName}
                        onClick={() => setSelectedViolationCategory(cat)}
                        className="p-4 bg-white hover:bg-slate-50/80 border border-slate-100 hover:border-indigo-200 rounded-2xl shadow-2xs hover:shadow-md transition-all cursor-pointer flex items-center justify-between group"
                      >
                        <div className="flex items-center gap-3.5 min-w-0 pr-2">
                          <div
                            className="w-3.5 h-3.5 rounded-full shrink-0 shadow-xs"
                            style={{ backgroundColor: color }}
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <h5 className="text-sm font-extrabold text-slate-900 group-hover:text-indigo-600 transition-colors truncate">
                                {cat.categoryName}
                              </h5>
                              {cat.isCustomCategory && (
                                <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 shrink-0">
                                  Souhrn vlastních
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-500 font-medium mt-0.5 flex items-center gap-2">
                              <span>
                                Zapsáno: <strong className="text-slate-800 font-bold">{cat.totalCount}x</strong>
                              </span>
                              <span>•</span>
                              <span>
                                Ruční: <strong className="text-slate-700">{cat.manualCount}x</strong> | Aut: <strong className="text-slate-700">{cat.autoCount}x</strong>
                              </span>
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          <div className="text-right">
                            <span className="text-sm font-black text-slate-900 block">
                              {formatCurrency(cat.totalAmount, group.currency)}
                            </span>
                            <span className="text-[10px] font-bold text-indigo-600 group-hover:underline flex items-center justify-end gap-0.5">
                              <span>Otevřít detail</span>
                              <ChevronRight className="w-3 h-3" />
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {statsData.groupedCategories.length === 0 && (
                    <div className="p-8 text-center text-slate-400 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                      <p className="text-xs font-bold text-slate-500">Zatím nebyly zapsány žádné pokuty v tomto období.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeStatView === 'monthly' && (
            <div className="space-y-6">
               <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-lg font-black text-indigo-700">Měsíční Králové</h4>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Pořadí nejtvrdších měsíčních vládců</p>
                </div>
                <CalendarDays className="w-6 h-6 text-indigo-500" />
              </div>

              {statsData.lastMonthLeader && (
                <div className="bg-indigo-600 rounded-3xl p-5 text-white flex items-center justify-between shadow-lg shadow-indigo-100">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center border border-white/30">
                      <CalendarDays className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <span className="text-[9px] font-black text-indigo-200 uppercase tracking-widest block mb-0.5">Naposledy vyhodnoceno</span>
                      <h5 className="text-base font-black truncate">{new Date(statsData.lastMonthLeader.month).toLocaleDateString('cs-CZ', { month: 'long', year: 'numeric' })}</h5>
                      <p className="text-[10px] font-bold text-indigo-100/70">{statsData.lastMonthLeader.member?.name} • {formatCurrency(statsData.lastMonthLeader.amount, group.currency)}</p>
                    </div>
                  </div>
                  <div className="text-center px-4 border-l border-white/20">
                    <p className="text-2xl font-black">{statsData.lastMonthRank}.</p>
                    <p className="text-[9px] font-bold text-indigo-200 uppercase tracking-widest">Místo</p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {statsData.monthlyLeaderboard.map((lead, idx) => (
                  <div key={idx} className="bg-white border border-slate-100 p-4 rounded-[2rem] flex items-center justify-between group hover:border-indigo-200 transition-all hover:shadow-md">
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm ${idx === 0 ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-400'}`}>
                        {idx + 1}.
                      </div>
                      <div>
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                          {new Date(lead.month).toLocaleDateString('cs-CZ', { month: 'long', year: 'numeric' })}
                        </span>
                        <h5 className="text-sm font-black text-bento-text-main mt-0.5">{lead.member?.name}</h5>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-black text-indigo-600">{formatCurrency(lead.amount, group.currency)}</div>
                    </div>
                  </div>
                ))}
                
                {statsData.monthlyLeaderboard.length === 0 && (
                   <div className="md:col-span-2 text-center py-12 text-slate-300 border-2 border-dashed border-slate-100 rounded-[2rem]">
                     <CalendarDays className="w-8 h-8 mx-auto mb-2 opacity-20" />
                     <p className="font-bold text-[10px] uppercase tracking-widest">Zatím chybí data pro měsíční přehled.</p>
                   </div>
                )}
              </div>
            </div>
          )}

          {activeStatView === 'streaks' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-lg font-black text-emerald-600">Nedotknutelní</h4>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Hráči s nejdelšími řadami bez pokuty v tomto období</p>
                </div>
                <Flame className="w-6 h-6 text-orange-500" />
              </div>

              {statsData.overallChampion && (
                <div className="relative overflow-hidden bg-gradient-to-br from-emerald-600 to-teal-700 p-6 rounded-3xl text-white shadow-xl shadow-emerald-200/50">
                  <div className="absolute top-0 right-0 -mr-8 -mt-8 w-40 h-40 bg-white/10 rounded-full blur-3xl"></div>
                  <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="flex items-center gap-5">
                      <div className="w-16 h-16 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center border border-white/30 shadow-inner">
                        <Trophy className="w-8 h-8 text-yellow-300" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="px-2 py-0.5 bg-yellow-400 text-emerald-900 rounded-full font-black text-[8px] uppercase tracking-wider">Král discipliny</span>
                        </div>
                        <h5 className="text-xl font-black">{statsData.overallChampion.member.name}</h5>
                        <p className="text-emerald-100/80 text-[10px] font-bold uppercase tracking-widest mt-0.5">Historicky nejdelší série i nyní</p>
                      </div>
                    </div>
                    
                    <div className="flex gap-4 md:gap-8 items-center border-t md:border-t-0 md:border-l border-white/20 pt-4 md:pt-0 md:pl-8">
                      <div className="text-center">
                        <p className="text-2xl font-black text-white">{statsData.overallChampion.bestStreakDays}</p>
                        <p className="text-[9px] font-bold text-emerald-200/60 uppercase tracking-widest">Osobní rekord</p>
                      </div>
                      <div className="w-[1px] h-8 bg-white/20"></div>
                      <div className="text-center">
                        <p className="text-2xl font-black text-yellow-300">{statsData.overallChampion.currentStreakDays}</p>
                        <p className="text-[9px] font-bold text-yellow-200/60 uppercase tracking-widest">Aktivní série</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {statsData.streaks
                  .filter(s => s.member.id !== statsData.overallChampion?.member.id)
                  .map((streak, idx) => (
                  <div key={idx} className="flex flex-col gap-3 bg-white p-5 rounded-2xl border border-slate-100 hover:shadow-lg hover:shadow-slate-100/50 transition-all group">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center border border-slate-100 group-hover:bg-emerald-50 transition-colors">
                          <ShieldCheck className="w-5 h-5 text-emerald-500" />
                        </div>
                        <div>
                          <h5 className="text-sm font-black text-bento-text-main truncate max-w-[120px]">{streak.member.name}</h5>
                          <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest">Pořadí #{idx + 2}</span>
                        </div>
                      </div>
                      {streak.currentStreakDays >= streak.bestStreakDays && streak.currentStreakDays > 0 && (
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" title="Vytváří nový rekord"></div>
                      )}
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2 mt-2">
                       <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100/50">
                         <p className="text-xs font-black text-slate-600">{streak.currentStreakDays}</p>
                         <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Aktuální</p>
                       </div>
                       <div className="bg-emerald-50/30 p-2.5 rounded-xl border border-emerald-100/30">
                         <p className="text-xs font-black text-emerald-600">{streak.bestStreakDays}</p>
                         <p className="text-[8px] font-bold text-emerald-400 uppercase tracking-widest">Nejlepší</p>
                       </div>
                    </div>
                  </div>
                ))}
                
                {statsData.streaks.length === 0 && (
                   <p className="md:col-span-3 text-center text-slate-300 italic py-8">Žádní aktivní členové k vyhodnocení.</p>
                )}
              </div>
            </div>
          )}
        </motion.div>

        <p className="mt-4 text-[9px] font-bold text-slate-300 uppercase tracking-[0.2em] text-center">
           Data jsou aktuální pro probíhající období "{currentPeriod.name}"
        </p>
      </div>

      {/* Statistics Reset Confirmation Modal */}
      <AnimatePresence>
        {resetConfirm && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4 z-[120]">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-[2rem] p-6 max-w-sm w-full shadow-2xl border border-rose-100"
            >
              <div className="w-12 h-12 bg-rose-50 rounded-2xl flex items-center justify-center mb-4">
                <RotateCcw className="w-6 h-6 text-rose-500" />
              </div>
              <h3 className="text-xl font-black text-slate-900 mb-2">Anulovat statistiku?</h3>
              <p className="text-sm text-slate-500 leading-relaxed mb-6">
                Opravdu chcete vyčistit vhled <span className="font-bold text-slate-900">"{resetConfirm.name}"</span>? 
                Historické záznamy zůstanou zachovány, ale statistika se začne počítat od nuly ode dneška.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setResetConfirm(null)}
                  className="flex-1 px-4 py-3 bg-slate-100 text-slate-600 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition-all"
                >
                  Zrušit
                </button>
                <button
                  onClick={confirmReset}
                  className="flex-1 px-4 py-3 bg-rose-500 text-white rounded-xl font-black text-xs uppercase tracking-widest transition-all shadow-lg shadow-rose-200"
                >
                  Anulovat
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Quick Actions */}
      <div className="pt-4">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1.5 h-1.5 rounded-full bg-bento-accent"></div>
          <h3 className="text-xs font-black uppercase tracking-[0.2em] text-bento-text-muted">Rychlé akce a přehledy</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {!isReadOnly && (
            <>
              <QuickAction
                label="Zapsat pokutu"
                icon={ReceiptText}
                onClick={() => onOpenQuickAction('fine')}
                color="hover:border-bento-accent/30 hover:bg-slate-50"
                iconColor="bg-slate-100 text-bento-text-main"
              />
              <QuickAction
                label="Zapsat platbu"
                icon={CreditCard}
                onClick={() => onOpenQuickAction('payment')}
                color="hover:border-emerald-200 hover:bg-emerald-50/30"
                iconColor="bg-slate-100 text-bento-text-main"
              />
              <QuickAction
                label="Zapsat výdaj"
                icon={TrendingDown}
                onClick={() => onOpenQuickAction('expense')}
                color="hover:border-rose-200 hover:bg-rose-50/30"
                iconColor="bg-slate-100 text-bento-text-main"
              />
              <QuickAction
                label="Zapsat příjem"
                icon={TrendingUp}
                onClick={() => onOpenQuickAction('income')}
                color="hover:border-emerald-200 hover:bg-emerald-50/30"
                iconColor="bg-slate-100 text-bento-text-main"
              />
            </>
          )}
          <QuickAction
            label="Export financí"
            icon={FileSpreadsheet}
            onClick={() => setIsExportModalOpen(true)}
            color="hover:border-emerald-300 hover:bg-emerald-50/40"
            iconColor="bg-emerald-50 text-emerald-600"
          />
        </div>
      </div>
      {/* Category Detail Modal */}
      <AnimatePresence>
        {selectedCategoryTrans && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4 z-[100]">
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="bg-white rounded-[2.5rem] p-6 md:p-8 max-w-md w-full shadow-2xl border border-bento-card-border"
            >
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h2 className="text-2xl font-black text-bento-text-main tracking-tight">{selectedCategoryTrans.name}</h2>
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-bento-accent mt-1">Detailní výpis transakcí</p>
                </div>
                <button 
                  onClick={() => setSelectedCategoryTrans(null)}
                  className="p-2.5 bg-slate-50 text-bento-text-muted hover:bg-slate-100 rounded-2xl transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-2.5 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                {selectedCategoryTrans.transactions.length > 0 ? (
                  selectedCategoryTrans.transactions.map((t, idx) => (
                    <div key={idx} className="flex justify-between items-center p-4 bg-slate-50 border border-slate-100 rounded-2xl hover:bg-white hover:border-bento-accent/20 transition-all group">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] font-black text-bento-accent">{(t.fromWho || 'Neznámý').toUpperCase()}</span>
                          <span className="text-[10px] font-bold text-slate-300">•</span>
                          <span className="text-[9px] font-bold text-slate-400">{formatDate(t.createdAt)}</span>
                        </div>
                        <span className="text-xs font-bold text-bento-text-main leading-tight">{t.note}</span>
                      </div>
                      <span className={cn(
                        "text-sm font-black tracking-tighter shrink-0 ml-4",
                        t.amount > 0 ? "text-emerald-600" : "text-rose-600"
                      )}>
                        {t.amount > 0 ? '+' : ''}{formatCurrency(t.amount, group.currency)}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-16 text-slate-300">
                    <ReceiptText className="w-10 h-10 mx-auto mb-3 opacity-20" />
                    <p className="font-bold text-xs uppercase tracking-widest">Žádné transakce</p>
                  </div>
                )}
              </div>

              <div className="mt-6 pt-6 border-t border-bento-card-border flex justify-between items-center">
                <span className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted">Celkem</span>
                <span className={cn(
                  "text-xl font-black tracking-tighter",
                  selectedCategoryTrans.transactions.reduce((s, t) => s + t.amount, 0) > 0 ? "text-emerald-600" : "text-rose-600"
                )}>
                  {formatCurrency(selectedCategoryTrans.transactions.reduce((s, t) => s + t.amount, 0), group.currency)}
                </span>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Calendar Modal */}
      <AnimatePresence>
        {isCalendarModalOpen && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4 z-[110]">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-[2.5rem] w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl border border-bento-card-border"
            >
              <div className="p-6 md:p-8 flex items-center justify-between border-b border-bento-card-border bg-slate-50">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-bento-accent/10 rounded-2xl flex items-center justify-center">
                    <CalendarIcon className="w-6 h-6 text-bento-accent" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-black text-bento-text-main tracking-tight">Kalendář událostí</h2>
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-bento-accent mt-1">Přehled plánovaných akcí</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => onNavigate('settings')}
                    className="flex items-center gap-2 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-bento-text-muted hover:text-bento-accent bg-white rounded-xl border border-bento-card-border transition-all"
                  >
                    Správa v nastavení <ExternalLink className="w-3 h-3" />
                  </button>
                  <button 
                    onClick={() => setIsCalendarModalOpen(false)}
                    className="p-2.5 bg-white text-bento-text-muted hover:bg-slate-100 rounded-2xl border border-bento-card-border transition-all"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {/* Calendar View */}
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-black uppercase tracking-widest text-bento-text-main">
                        {calendarDate.toLocaleDateString('cs-CZ', { month: 'long', year: 'numeric' })}
                      </h3>
                      <div className="flex gap-1">
                        <button 
                          onClick={() => setCalendarDate(new Date(calendarDate.setMonth(calendarDate.getMonth() - 1)))}
                          className="p-1.5 hover:bg-slate-100 rounded-lg text-bento-text-muted transition-all"
                        >
                          <ChevronUp className="-rotate-90 w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => setCalendarDate(new Date())}
                          className="px-2 text-[10px] font-black uppercase tracking-widest text-bento-accent hover:bg-bento-accent/5 rounded-lg transition-all"
                        >
                          Dnes
                        </button>
                        <button 
                          onClick={() => setCalendarDate(new Date(calendarDate.setMonth(calendarDate.getMonth() + 1)))}
                          className="p-1.5 hover:bg-slate-100 rounded-lg text-bento-text-muted transition-all"
                        >
                          <ChevronUp className="rotate-90 w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-7 gap-1">
                      {['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'].map(day => (
                        <div key={day} className="text-center py-2 text-[10px] font-black text-bento-text-muted uppercase tracking-widest">
                          {day}
                        </div>
                      ))}
                      {(() => {
                        const days = [];
                        const firstDayOfMonth = new Date(calendarDate.getFullYear(), calendarDate.getMonth(), 1);
                        const lastDayOfMonth = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 0);
                        
                        // Adjust for Monday start
                        let startDay = firstDayOfMonth.getDay() - 1;
                        if (startDay === -1) startDay = 6;

                        // Empty days before
                        for (let i = 0; i < startDay; i++) {
                          days.push(<div key={`empty-${i}`} className="h-12" />);
                        }

                        // Get start and end of viewed calendar month
                        const calYear = calendarDate.getFullYear();
                        const calMonth = calendarDate.getMonth();
                        const monthStartStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-01`;
                        const lastDayNum = new Date(calYear, calMonth + 1, 0).getDate();
                        const monthEndStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(lastDayNum).padStart(2, '0')}`;

                        const currencySymbol = getCurrencySymbol(group.currency);
                        const recurringEventsForMonth = recurringFines.flatMap(rf => 
                          getRecurringFineOccurrencesInRange(rf, monthStartStr, monthEndStr, currencySymbol)
                        );

                        // Get all calendar items for the viewed year/month
                        const calendarItems = [
                          ...events,
                          ...birthdayEvents.map(b => {
                            const bDate = new Date(b.member.birthDate!);
                            const year = calendarDate.getFullYear();
                            const dateInCurrentYear = new Date(year, bDate.getMonth(), bDate.getDate()).toISOString().split('T')[0];
                            return { ...b, date: dateInCurrentYear };
                          }),
                          ...recurringEventsForMonth
                        ];

                        // Real days
                        for (let d = 1; d <= lastDayOfMonth.getDate(); d++) {
                          const dateStr = `${calendarDate.getFullYear()}-${String(calendarDate.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                          const dayEvents = calendarItems.filter(e => e.date === dateStr);
                          const isToday = new Date().toISOString().split('T')[0] === dateStr;
                          const hasImportant = dayEvents.some(e => (e as any).isImportant);
                          const hasBirthday = dayEvents.some(e => (e as any).isBirthday);
                          const hasRecurring = dayEvents.some(e => (e as any).isRecurringFine);
                          const hasEvent = dayEvents.length > 0;

                          days.push(
                            <div 
                              key={d} 
                              onClick={() => dayEvents.length > 0 && setSelectedEvent(dayEvents[0])}
                              className={cn(
                                "h-12 rounded-xl flex flex-col items-center justify-center relative cursor-pointer group transition-all",
                                isToday ? "bg-bento-accent shadow-lg shadow-bento-accent/20" : "hover:bg-slate-50 border border-transparent hover:border-slate-100"
                              )}
                            >
                              <span className={cn("text-[11px] font-bold", isToday ? "text-white" : "text-bento-text-main")}>{d}</span>
                              <div className="flex gap-0.5 mt-1">
                                {hasImportant && <div className={cn("w-1 h-1 rounded-full", isToday ? "bg-white" : "bg-rose-500")} />}
                                {hasBirthday && <div className={cn("w-1 h-1 rounded-full", isToday ? "bg-white" : "bg-indigo-400")} />}
                                {hasRecurring && <div className={cn("w-1 h-1 rounded-full", isToday ? "bg-white" : "bg-purple-500")} />}
                                {hasEvent && !hasImportant && !hasBirthday && !hasRecurring && <div className={cn("w-1 h-1 rounded-full", isToday ? "bg-white" : "bg-bento-accent")} />}
                              </div>

                              {dayEvents.length > 1 && (
                                <div className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-slate-900 border border-white rounded-full flex items-center justify-center text-[8px] font-black text-white">
                                  {dayEvents.length}
                                </div>
                              )}
                            </div>
                          );
                        }
                        return days;
                      })()}
                    </div>

                    <div className="flex flex-wrap gap-4 pt-4 border-t border-bento-card-border">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-rose-500" />
                        <span className="text-[10px] font-bold text-bento-text-muted uppercase">Důležité</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-indigo-400" />
                        <span className="text-[10px] font-bold text-bento-text-muted uppercase">Narozeniny</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-purple-500" />
                        <span className="text-[10px] font-bold text-bento-text-muted uppercase">Aut. pokuta</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-bento-accent" />
                        <span className="text-[10px] font-bold text-bento-text-muted uppercase">Událost</span>
                      </div>
                    </div>
                  </div>

                  {/* Event Detail List for the month */}
                  <div className="lg:border-l lg:border-bento-card-border lg:pl-8 space-y-4">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-xs font-black uppercase tracking-widest text-bento-text-main">Události v měsíci</h3>
                      <select
                        value={calendarFilter}
                        onChange={(e) => setCalendarFilter(e.target.value as any)}
                        className="text-[11px] font-bold bg-slate-100 border border-slate-200 rounded-lg px-2 py-1 text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                      >
                        <option value="all">Všechny události</option>
                        <option value="ordinary">Pouze obyčejné události</option>
                        <option value="important">Důležité události</option>
                        <option value="birthdays">Narozeniny</option>
                        <option value="recurring">Automatické pokuty</option>
                      </select>
                    </div>

                    <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                      {(() => {
                        const calYear = calendarDate.getFullYear();
                        const calMonth = calendarDate.getMonth();
                        const monthStartStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-01`;
                        const lastDayNum = new Date(calYear, calMonth + 1, 0).getDate();
                        const monthEndStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(lastDayNum).padStart(2, '0')}`;

                        const currencySymbol = getCurrencySymbol(group.currency);
                        const recurringEventsForMonth = recurringFines.flatMap(rf => 
                          getRecurringFineOccurrencesInRange(rf, monthStartStr, monthEndStr, currencySymbol)
                        );

                        const monthStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}`;
                        let monthItems = [
                          ...events,
                          ...birthdayEvents.map(b => {
                            const bDate = new Date(b.member.birthDate!);
                            const year = calendarDate.getFullYear();
                            const dateInCurrentYear = new Date(year, bDate.getMonth(), bDate.getDate()).toISOString().split('T')[0];
                            return { ...b, date: dateInCurrentYear };
                          }),
                          ...recurringEventsForMonth
                        ].filter(e => e.date.startsWith(monthStr));

                        if (calendarFilter === 'ordinary') {
                          monthItems = monthItems.filter(e => !(e as any).isImportant && !(e as any).isBirthday && !(e as any).isRecurringFine);
                        } else if (calendarFilter === 'important') {
                          monthItems = monthItems.filter(e => (e as any).isImportant);
                        } else if (calendarFilter === 'birthdays') {
                          monthItems = monthItems.filter(e => (e as any).isBirthday);
                        } else if (calendarFilter === 'recurring') {
                          monthItems = monthItems.filter(e => (e as any).isRecurringFine);
                        }

                        monthItems.sort((a, b) => a.date.localeCompare(b.date));

                        if (monthItems.length === 0) {
                          return (
                            <div className="text-center py-12 opacity-20">
                              <CalendarIcon className="w-10 h-10 mx-auto mb-2" />
                              <p className="text-[10px] font-black uppercase tracking-widest">Žádné události</p>
                            </div>
                          );
                        }

                        return monthItems.map(item => (
                          <div 
                            key={item.id} 
                            onClick={() => setSelectedEvent(item)}
                            className={cn(
                              "p-4 rounded-[1.5rem] border transition-all cursor-pointer group",
                              (item as any).isImportant ? "bg-rose-50/50 border-rose-100 hover:border-rose-300" : 
                              ((item as any).isBirthday ? "bg-indigo-50/50 border-indigo-100 hover:border-indigo-300" : 
                              ((item as any).isRecurringFine ? "bg-purple-50/50 border-purple-100 hover:border-purple-300" : "bg-slate-50 border-transparent hover:border-bento-card-border"))
                            )}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-black text-slate-400">
                                  {new Date(item.date).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' })}
                                </span>
                                {(item as any).isImportant && (
                                  <span className="text-[8px] font-black uppercase tracking-widest text-rose-500 bg-rose-100 px-1.5 py-0.5 rounded">Důležité</span>
                                )}
                                {(item as any).isBirthday && (
                                  <span className="text-[8px] font-black uppercase tracking-widest text-indigo-500 bg-indigo-100 px-1.5 py-0.5 rounded">Narozeniny</span>
                                )}
                                {(item as any).isRecurringFine && (
                                  <span className="text-[8px] font-black uppercase tracking-widest text-purple-600 bg-purple-100 px-1.5 py-0.5 rounded">Aut. pokuta</span>
                                )}
                              </div>
                              <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:translate-x-1 transition-transform" />
                            </div>
                            <p className="text-xs font-black text-bento-text-main line-clamp-1">{item.name}</p>
                          </div>
                        ));
                      })()}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Goal Management Modal */}
      <AnimatePresence>
        {isGoalModalOpen && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4 z-[130]">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-[2.5rem] w-full max-w-lg shadow-2xl overflow-hidden flex flex-col border border-bento-card-border"
            >
              <div className="p-6 md:p-8 flex items-center justify-between border-b border-bento-card-border bg-slate-50">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-indigo-100 rounded-2xl flex items-center justify-center">
                    <Target className="w-6 h-6 text-indigo-600" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-black text-bento-text-main tracking-tight">Správa cílů</h2>
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-500 mt-1">Nastavte na co šetříte</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsGoalModalOpen(false)}
                  className="p-2.5 bg-white text-bento-text-muted hover:bg-slate-100 rounded-2xl border border-bento-card-border transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-8 flex-1 overflow-y-auto custom-scrollbar max-h-[60vh]">
                <div className="space-y-6">
                  {/* Calculation Source Selector */}
                  <div className="bg-slate-50 rounded-[2rem] p-5 border border-slate-100 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-black uppercase tracking-widest text-bento-text-muted">
                        Počítat plnění cílů z
                      </h3>
                      <span className="text-[10px] font-extrabold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md">
                        {goalCalcSource === 'free_cash' ? 'Dostupná hotovost' : 'Celková hotovost'}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <button
                        type="button"
                        disabled={isReadOnly}
                        onClick={() => handleUpdateGoalCalcSource('free_cash')}
                        className={cn(
                          "p-3.5 rounded-2xl border text-left transition-all relative flex flex-col justify-between",
                          (currentPeriod?.goalCalcSource || 'free_cash') === 'free_cash'
                            ? "bg-indigo-600 border-indigo-600 text-white font-bold shadow-md shadow-indigo-600/10"
                            : "bg-white border-slate-200 text-slate-700 hover:bg-slate-100"
                        )}
                      >
                        <div>
                          <div className="text-xs font-black flex items-center justify-between">
                            <span>Dostupné hotovosti</span>
                            {(currentPeriod?.goalCalcSource || 'free_cash') === 'free_cash' && (
                              <span className="w-2 h-2 rounded-full bg-white" />
                            )}
                          </div>
                          <p className={cn(
                            "text-[10px] mt-1 font-medium",
                            (currentPeriod?.goalCalcSource || 'free_cash') === 'free_cash' ? "text-indigo-100" : "text-slate-400"
                          )}>
                            Mimo obálky ({formatCurrency(freeCash, group.currency)})
                          </p>
                        </div>
                      </button>

                      <button
                        type="button"
                        disabled={isReadOnly}
                        onClick={() => handleUpdateGoalCalcSource('total_cash')}
                        className={cn(
                          "p-3.5 rounded-2xl border text-left transition-all relative flex flex-col justify-between",
                          currentPeriod?.goalCalcSource === 'total_cash'
                            ? "bg-indigo-600 border-indigo-600 text-white font-bold shadow-md shadow-indigo-600/10"
                            : "bg-white border-slate-200 text-slate-700 hover:bg-slate-100"
                        )}
                      >
                        <div>
                          <div className="text-xs font-black flex items-center justify-between">
                            <span>Celkové hotovosti</span>
                            {currentPeriod?.goalCalcSource === 'total_cash' && (
                              <span className="w-2 h-2 rounded-full bg-white" />
                            )}
                          </div>
                          <p className={cn(
                            "text-[10px] mt-1 font-medium",
                            currentPeriod?.goalCalcSource === 'total_cash' ? "text-indigo-100" : "text-slate-400"
                          )}>
                            Včetně obálek ({formatCurrency(stats.balance, group.currency)})
                          </p>
                        </div>
                      </button>
                    </div>
                  </div>

                  {/* Add New Goal */}
                  {!isReadOnly && (
                    <div className="bg-slate-50 rounded-[2rem] p-6 border border-slate-100 space-y-4">
                      <h3 className="text-xs font-black uppercase tracking-widest text-bento-text-muted mb-2">Nový cíl</h3>
                      <div className="space-y-3">
                        <div>
                          <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-1.5 ml-1">Název cíle</label>
                          <input
                            type="text"
                            placeholder="Napr. Nové dresy, Grill párty..."
                            className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all"
                            value={newGoalName}
                            onChange={(e) => setNewGoalName(e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-1.5 ml-1">Cílová částka ({getCurrencySymbol(group.currency)})</label>
                          <input
                            type="number"
                            placeholder="0"
                            className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all"
                            value={newGoalAmount}
                            onChange={(e) => setNewGoalAmount(e.target.value)}
                          />
                        </div>
                        <button
                          onClick={handleAddGoal}
                          disabled={!newGoalName || !newGoalAmount}
                          className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest transition-all shadow-lg shadow-indigo-500/20 flex items-center justify-center gap-2"
                        >
                          <PlusCircle className="w-4 h-4" />
                          Přidat cíl
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Goal List */}
                  <div className="space-y-4">
                    <h3 className="text-xs font-black uppercase tracking-widest text-bento-text-muted ml-1">Vaše cíle {!isReadOnly && '(přetažením seřaďte prioritizaci)'}</h3>
                    {goalsWithAllocation.length > 0 ? (
                      <Reorder.Group axis="y" values={goals} onReorder={handleReorderGoals} className="space-y-2.5">
                        {goalsWithAllocation.map((goal) => {
                          const originalGoal = goals.find(g => g.id === goal.id) || goal;
                          return (
                            <Reorder.Item 
                              key={goal.id} 
                              value={originalGoal}
                              className={cn(
                                "bg-white border p-4 rounded-2xl flex flex-col gap-2.5 transition-all shadow-2xs",
                                goal.completed ? "border-emerald-100 bg-emerald-50/10" : "border-slate-100"
                              )}
                            >
                              <div className="flex items-center gap-3">
                                {!isReadOnly && (
                                  <div className="cursor-grab active:cursor-grabbing p-1">
                                    <GripVertical className="w-4 h-4 text-slate-300" />
                                  </div>
                                )}
                                <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-md shrink-0">
                                  #{goal.priorityIndex}
                                </span>
                                <button
                                  disabled={isReadOnly}
                                  onClick={() => handleToggleGoal(originalGoal)}
                                  className={cn(
                                    "w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all shrink-0",
                                    goal.completed ? "bg-emerald-500 border-emerald-500 text-white" : "border-slate-200",
                                    isReadOnly && "cursor-default opacity-80"
                                  )}
                                >
                                  {goal.completed && <Trophy className="w-3 h-3" />}
                                </button>
                                <div className="flex-1 min-w-0">
                                  <h4 className={cn("text-sm font-black truncate leading-tight", goal.completed ? "text-emerald-700 line-through opacity-50" : "text-bento-text-main")}>
                                    {goal.name}
                                  </h4>
                                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center justify-between mt-0.5">
                                    <span>{formatCurrency(goal.allocatedAmount, group.currency)} / {formatCurrency(goal.targetAmount, group.currency)}</span>
                                    <span className="font-mono font-black text-indigo-600 ml-2">{goal.progress.toFixed(0)}%</span>
                                  </p>
                                </div>
                                {!isReadOnly && (
                                  <button
                                    onClick={() => handleDeleteGoal(goal.id)}
                                    className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all shrink-0"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                )}
                              </div>

                              <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                                <div 
                                  className={cn(
                                    "h-full rounded-full transition-all duration-300",
                                    goal.progress >= 100 ? "bg-emerald-500" : "bg-indigo-600"
                                  )}
                                  style={{ width: `${goal.progress}%` }}
                                />
                              </div>
                            </Reorder.Item>
                          );
                        })}
                      </Reorder.Group>
                    ) : (
                      <div className="text-center py-12 bg-slate-50 rounded-[2rem] border border-dashed border-slate-200">
                        <Target className="w-8 h-8 mx-auto mb-2 text-slate-200" />
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-300">Žádné cíle nejsou nastaveny</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              
              <div className="p-6 bg-slate-50 border-t border-bento-card-border text-center">
                 <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest leading-relaxed">
                   Cíle se plní v přísném pořadí podle priority. Další cíl se plní až z přebytku po 100% naplnění předchozího.
                 </p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Selected Event Detail Modal */}
      <AnimatePresence>
        {selectedEvent && (
          <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-4 z-[120]">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-[2.5rem] w-full max-w-md shadow-2xl overflow-hidden"
            >
              <div className={cn(
                "p-8 text-white relative overflow-hidden",
                selectedEvent.isBirthday ? "bg-indigo-500" : (selectedEvent.isImportant ? "bg-rose-500" : "bg-bento-sidebar")
              )}>
                <div className="flex justify-between items-start z-10 relative">
                  <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-md">
                    {selectedEvent.isBirthday ? <Cake className="w-6 h-6" /> : <CalendarIcon className="w-6 h-6" />}
                  </div>
                  <button 
                    onClick={() => setSelectedEvent(null)}
                    className="p-2 hover:bg-white/10 rounded-xl transition-all"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                
                <div className="mt-6 z-10 relative">
                  <h3 className="text-2xl font-black tracking-tight">{selectedEvent.isBirthday ? `Oslava: ${selectedEvent.originalName}` : selectedEvent.name}</h3>
                  <div className="flex items-center gap-2 mt-2 text-white/70">
                    <CalendarIcon className="w-4 h-4" />
                    <span className="text-xs font-bold">
                      {new Date(selectedEvent.date).toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                    </span>
                  </div>
                </div>

                <div className="absolute right-[-10%] bottom-[-20%] w-48 h-48 bg-white/10 rounded-full blur-3xl" />
              </div>

              <div className="p-8">
                <div className="space-y-6">
                  {selectedEvent.description ? (
                    <div>
                      <label className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted block mb-2">Popis události</label>
                      <div className="p-4 bg-slate-50 rounded-2xl border border-bento-card-border/50 text-sm font-medium text-bento-text-main leading-relaxed">
                        {selectedEvent.description}
                      </div>
                    </div>
                  ) : (
                    <div className="py-6 text-center text-slate-300 italic text-sm">
                      Žádný dodatečný popis k této události.
                    </div>
                  )}

                  {selectedEvent.isBirthday && (
                    <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-2xl flex items-center gap-4">
                      <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center shrink-0">
                        <Cake className="w-5 h-5 text-indigo-600" />
                      </div>
                      <div>
                        <p className="text-xs font-black text-indigo-900">Kulaté jubileum</p>
                        <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest">Slaví {selectedEvent.age}. narozeniny</p>
                      </div>
                    </div>
                  )}

                  <div className="pt-2">
                    <button 
                      onClick={() => {
                        setSelectedEvent(null);
                        setIsCalendarModalOpen(false);
                        onNavigate('settings');
                      }}
                      className="w-full py-4 bg-slate-900 hover:bg-black text-white rounded-2xl font-black uppercase text-xs tracking-[0.2em] transition-all flex items-center justify-center gap-2 group"
                    >
                      Upravit v nastavení
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Category Detail Modal (Katalog hříchů detail) */}
      <AnimatePresence>
        {selectedViolationCategory && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-3xl shadow-2xl border border-slate-100 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden text-slate-800"
            >
              {/* Header */}
              <div className="bg-slate-900 text-white p-6 flex items-center justify-between shrink-0">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                      Detail prohřešku • Katalog hříchů
                    </span>
                    {selectedViolationCategory.isCustomCategory && (
                      <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        Vlastní zadání
                      </span>
                    )}
                  </div>
                  <h3 className="text-xl font-black tracking-tight text-white">
                    {selectedViolationCategory.categoryName}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedViolationCategory(null)}
                  className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Content Body */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                {/* Top Metrics Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="bg-indigo-50/70 border border-indigo-100 p-4 rounded-2xl">
                    <span className="text-[10px] font-black text-indigo-600 uppercase tracking-wider block mb-1">
                      Celková hodnota (Pomohlo vybrat)
                    </span>
                    <span className="text-2xl font-black text-indigo-950 block">
                      {formatCurrency(selectedViolationCategory.totalAmount, group.currency)}
                    </span>
                    <span className="text-[11px] font-bold text-indigo-700/80 mt-1 block">
                      Zaplaceno: {formatCurrency(selectedViolationCategory.totalPaidAmount, group.currency)}
                    </span>
                  </div>

                  <div className="bg-slate-50 border border-slate-200/80 p-4 rounded-2xl">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                      Celkový počet zápisů
                    </span>
                    <span className="text-2xl font-black text-slate-900 block">
                      {selectedViolationCategory.totalCount}x
                    </span>
                    <span className="text-[11px] font-semibold text-slate-500 mt-1 block">
                      Všech zapsaných pokut v téhle kategorii
                    </span>
                  </div>
                </div>

                {/* Manual vs Automatic Split */}
                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-2xs space-y-3">
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-700">
                    Rozdělení na ruční a automatické zápisy
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Manual */}
                    <div className="p-3.5 rounded-xl bg-emerald-50/60 border border-emerald-100 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-700 text-sm font-bold">
                          🖐️
                        </div>
                        <div>
                          <span className="text-xs font-extrabold text-slate-900 block">
                            Ruční zápisy
                          </span>
                          <span className="text-[10px] text-emerald-800 font-bold">
                            Počet: {selectedViolationCategory.manualCount}x
                          </span>
                        </div>
                      </div>
                      <span className="text-sm font-black text-emerald-900">
                        {formatCurrency(selectedViolationCategory.manualAmount, group.currency)}
                      </span>
                    </div>

                    {/* Automatic */}
                    <div className="p-3.5 rounded-xl bg-purple-50/60 border border-purple-100 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center text-purple-700 text-sm font-bold">
                          🤖
                        </div>
                        <div>
                          <span className="text-xs font-extrabold text-slate-900 block">
                            Automatické zápisy
                          </span>
                          <span className="text-[10px] text-purple-800 font-bold">
                            Počet: {selectedViolationCategory.autoCount}x
                          </span>
                        </div>
                      </div>
                      <span className="text-sm font-black text-purple-900">
                        {formatCurrency(selectedViolationCategory.autoAmount, group.currency)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Breakdown for Vlastní zadání */}
                {selectedViolationCategory.isCustomCategory && selectedViolationCategory.customReasonBreakdown && (
                  <div className="bg-amber-50/50 border border-amber-200/80 rounded-2xl p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-black uppercase tracking-wider text-amber-900">
                        Rozpis konkrétních vlastních prohřešků
                      </h4>
                      <span className="text-[10px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-md">
                        {selectedViolationCategory.customReasonBreakdown.length} typů
                      </span>
                    </div>
                    <div className="space-y-2">
                      {selectedViolationCategory.customReasonBreakdown.map((item, i) => (
                        <div key={i} className="p-3 bg-white rounded-xl border border-amber-100 flex items-center justify-between">
                          <div>
                            <span className="text-xs font-extrabold text-slate-900 block">
                              {item.reason}
                            </span>
                            <span className="text-[10px] text-slate-500 font-medium">
                              Zapsáno: <strong className="text-slate-800 font-bold">{item.count}x</strong> (Ruční: {item.manualCount}x, Aut: {item.autoCount}x)
                            </span>
                          </div>
                          <span className="text-xs font-black text-amber-900">
                            {formatCurrency(item.amount, group.currency)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Individual Fines List */}
                <div className="space-y-3">
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-700">
                    Seznam konkrétních pokut v této kategorii ({selectedViolationCategory.fines.length})
                  </h4>
                  <div className="space-y-2 max-h-[260px] overflow-y-auto custom-scrollbar pr-1">
                    {selectedViolationCategory.fines.map((f) => {
                      const member = members.find(m => m.id === f.memberId);
                      const isAuto = isFineAutomatic(f);
                      const dateStr = new Date(f.createdAt).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' });

                      return (
                        <div key={f.id} className="p-3 bg-slate-50 hover:bg-slate-100/80 rounded-xl border border-slate-200/80 flex items-center justify-between transition-colors">
                          <div className="min-w-0 pr-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-black text-slate-900 truncate">
                                {member?.name || 'Člen'}
                              </span>
                              <span className={cn(
                                "text-[9px] font-black uppercase px-2 py-0.5 rounded-md shrink-0 flex items-center gap-1",
                                isAuto ? "bg-purple-100 text-purple-800" : "bg-emerald-100 text-emerald-800"
                              )}>
                                {isAuto ? '🤖 Automatická' : '🖐️ Ruční'}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-600 font-medium mt-0.5">
                              {f.reason} • <span className="text-slate-400 font-mono text-[10px]">{dateStr}</span>
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="text-xs font-black text-slate-900 block">
                              {f.type === 'in_kind' || f.isInKind
                                ? `Věcná: ${f.itemOrTask || f.unit || 'položka'} (${f.quantity || 1}x)`
                                : formatCurrency(f.amount, group.currency)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end shrink-0">
                <button
                  type="button"
                  onClick={() => setSelectedViolationCategory(null)}
                  className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-extrabold text-xs transition-colors cursor-pointer"
                >
                  Zavřít detail
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ExportFinanceModal
        group={group}
        period={period}
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
      />
    </div>
  );
}

function QuickAction({ label, icon: Icon, onClick, color, iconColor }: any) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center gap-3 p-6 bg-white border border-bento-card-border rounded-2xl transition-all active:scale-95 group",
        color
      )}
    >
      <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center transition-all group-hover:scale-110", iconColor)}>
        <Icon className="w-5 h-5" />
      </div>
      <span className="font-bold text-xs text-bento-text-main tracking-tight">{label}</span>
    </button>
  );
}

function StatTab({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: any; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all whitespace-nowrap",
        active ? "bg-white text-indigo-600 shadow-sm border border-slate-200" : "text-bento-text-muted hover:text-bento-text-main"
      )}
    >
      <Icon className={cn("w-3.5 h-3.5", active ? "text-indigo-600" : "text-slate-400")} />
      {label}
    </button>
  );
}

