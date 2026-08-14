import React, { useState, useEffect } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { Group, Period, Member, Fine, Transaction, Payment, Goal, Envelope, MemberGroup } from '../types';
import { formatCurrency, getCurrencySymbol, formatDate, cn, groupFinesIntoCategories } from '../utils';
import { X, FileSpreadsheet, Download, Loader2, Calendar, Target, Folder, Award, Users, ReceiptText, Wallet, Check, Copy, Flame, PieChart, Sparkles, AlertTriangle, UserCheck, UserX, Search, CheckSquare, Square, Filter, QrCode, Building2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import html2pdf from 'html2pdf.js';

export type MemberFilterType = 'all' | 'active' | 'inactive' | 'debt' | 'overpaid' | 'settled' | 'groups' | 'custom';

interface ExportFinanceModalProps {
  group: Group;
  period: Period;
  isOpen: boolean;
  onClose: () => void;
}

export default function ExportFinanceModal({ group, period, isOpen, onClose }: ExportFinanceModalProps) {
  const [members, setMembers] = useState<Member[]>([]);
  const [memberGroups, setMemberGroups] = useState<MemberGroup[]>([]);
  const [fines, setFines] = useState<Fine[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [envelopes, setEnvelopes] = useState<Envelope[]>([]);
  const [loading, setLoading] = useState(true);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  // Filter options (Date range within current period)
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  
  // Member & Group Filters
  const [memberFilterType, setMemberFilterType] = useState<MemberFilterType>('all');
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [selectedCustomMemberIds, setSelectedCustomMemberIds] = useState<string[]>([]);
  const [memberSearchTerm, setMemberSearchTerm] = useState<string>('');

  // Data selection
  const [includeFines, setIncludeFines] = useState(true);
  const [includeTransactions, setIncludeTransactions] = useState(true);
  const [includePayments, setIncludePayments] = useState(true);
  const [includeMemberBalances, setIncludeMemberBalances] = useState(true);
  const [includeGoalsAndEnvelopes, setIncludeGoalsAndEnvelopes] = useState(true);
  const [includeStatistics, setIncludeStatistics] = useState(true);

  useEffect(() => {
    if (!isOpen) return;

    setLoading(true);

    // Load ALL Members strictly for this period & group (including inactive ones, excluding deleted)
    const membersPath = `groups/${group.id}/periods/${period.id}/members`;
    const unsubMembers = onSnapshot(collection(db, membersPath), (snap) => {
      const allMembers = (snap.docs.map(d => ({ id: d.id, ...d.data() })) as Member[])
        .filter(m => !(m as any).isDeleted && !(m as any).deleted);
      setMembers(allMembers);
    });

    // Load Member Groups for this period & group
    const groupsPath = `groups/${group.id}/periods/${period.id}/memberGroups`;
    const unsubGroups = onSnapshot(collection(db, groupsPath), (snap) => {
      const groupsList = snap.docs.map(d => ({ id: d.id, ...d.data() })) as MemberGroup[];
      setMemberGroups(groupsList);
    });

    // Load Fines strictly for this period (excluding deleted)
    const finesPath = `groups/${group.id}/periods/${period.id}/fines`;
    const unsubFines = onSnapshot(collection(db, finesPath), (snap) => {
      const activeFines = (snap.docs.map(d => ({ id: d.id, ...d.data() })) as Fine[])
        .filter(f => (!f.periodId || f.periodId === period.id) && !(f as any).isDeleted && !(f as any).deleted);
      setFines(activeFines);
    });

    // Load Transactions strictly for this period (excluding deleted)
    const txPath = `groups/${group.id}/periods/${period.id}/transactions`;
    const unsubTx = onSnapshot(collection(db, txPath), (snap) => {
      const activeTx = (snap.docs.map(d => ({ id: d.id, ...d.data() })) as Transaction[])
        .filter(t => (!t.periodId || t.periodId === period.id) && !(t as any).isDeleted && !(t as any).deleted);
      setTransactions(activeTx);
    });

    // Load Payments strictly for this period (excluding deleted)
    const payPath = `groups/${group.id}/periods/${period.id}/payments`;
    const unsubPay = onSnapshot(collection(db, payPath), (snap) => {
      const activePay = (snap.docs.map(d => ({ id: d.id, ...d.data() })) as Payment[])
        .filter(p => (!p.periodId || p.periodId === period.id) && !(p as any).isDeleted && !(p as any).deleted);
      setPayments(activePay);
    });

    // Load Goals strictly for this period (excluding deleted)
    const goalsPath = `groups/${group.id}/periods/${period.id}/goals`;
    const unsubGoals = onSnapshot(collection(db, goalsPath), (snap) => {
      const activeGoals = (snap.docs.map(d => ({ id: d.id, ...d.data() })) as Goal[])
        .filter(g => (!g.periodId || g.periodId === period.id) && !(g as any).isDeleted && !(g as any).deleted);
      setGoals(activeGoals);
    });

    // Load Envelopes strictly for this period (excluding deleted)
    const envPath = `groups/${group.id}/periods/${period.id}/envelopes`;
    const unsubEnv = onSnapshot(collection(db, envPath), (snap) => {
      const activeEnv = (snap.docs.map(d => ({ id: d.id, ...d.data() })) as Envelope[])
        .filter(e => (!e.periodId || e.periodId === period.id) && !(e as any).isDeleted && !(e as any).deleted);
      setEnvelopes(activeEnv);
      setLoading(false);
    });

    return () => {
      unsubMembers();
      unsubGroups();
      unsubFines();
      unsubTx();
      unsubPay();
      unsubGoals();
      unsubEnv();
    };
  }, [isOpen, group.id, period.id]);

  if (!isOpen) return null;

  const filterByDate = (createdAt: number) => {
    if (!startDate && !endDate) return true;
    const itemDateStr = new Date(createdAt).toISOString().split('T')[0];
    if (startDate && itemDateStr < startDate) return false;
    if (endDate && itemDateStr > endDate) return false;
    return true;
  };

  // Map of all members
  const memberMap = new Map<string, Member>();
  members.forEach(m => memberMap.set(m.id, m));

  // Compute overall balances for ALL members
  const allMemberBalancesMap = new Map<string, {
    totalFines: number;
    totalPaid: number;
    unpaidDebt: number;
    overpayment: number;
    isSettled: boolean;
    status: string;
  }>();

  members.forEach(m => {
    const mFines = fines.filter(f => f.memberId === m.id && filterByDate(f.createdAt));
    const mPayments = payments.filter(p => p.memberId === m.id && filterByDate(p.createdAt));

    const totalFines = mFines.reduce((acc, f) => acc + (f.amount || 0), 0);
    const totalPaid = mPayments.reduce((acc, p) => acc + (p.amount || 0), 0);
    const unpaidDebt = Math.max(0, totalFines - totalPaid);
    const overpayment = Math.max(0, totalPaid - totalFines);
    const isSettled = unpaidDebt === 0 && overpayment === 0;

    let status = 'Vyrovnáno';
    if (unpaidDebt > 0) {
      status = `Dluh: ${formatCurrency(unpaidDebt, group.currency)}`;
    } else if (overpayment > 0) {
      status = `Přeplatek: +${formatCurrency(overpayment, group.currency)}`;
    }

    allMemberBalancesMap.set(m.id, {
      totalFines,
      totalPaid,
      unpaidDebt,
      overpayment,
      isSettled,
      status
    });
  });

  // Filter members according to memberFilterType
  const filteredMembers = members.filter(m => {
    const bal = allMemberBalancesMap.get(m.id);
    const isActive = m.active !== false;

    switch (memberFilterType) {
      case 'active':
        return isActive;
      case 'inactive':
        return !isActive;
      case 'debt':
        return (bal?.unpaidDebt || 0) > 0;
      case 'overpaid':
        return (bal?.overpayment || 0) > 0;
      case 'settled':
        return bal?.isSettled === true;
      case 'groups': {
        if (selectedGroupIds.length === 0) return true;
        const memberIdsInGroups = new Set(
          memberGroups
            .filter(mg => selectedGroupIds.includes(mg.id))
            .flatMap(mg => mg.memberIds || [])
        );
        return memberIdsInGroups.has(m.id);
      }
      case 'custom': {
        if (selectedCustomMemberIds.length === 0) return true;
        return selectedCustomMemberIds.includes(m.id);
      }
      case 'all':
      default:
        return true;
    }
  });

  const activeCountInFiltered = filteredMembers.filter(m => m.active !== false).length;
  const inactiveCountInFiltered = filteredMembers.filter(m => m.active === false).length;

  const selectedMemberIds = new Set(filteredMembers.map(m => m.id));

  // Compute memberBalances for chosen members
  const memberBalances = filteredMembers.map(m => {
    const b = allMemberBalancesMap.get(m.id) || {
      totalFines: 0,
      totalPaid: 0,
      unpaidDebt: 0,
      overpayment: 0,
      isSettled: true,
      status: 'Vyrovnáno'
    };
    return {
      id: m.id,
      name: m.name,
      active: m.active !== false,
      totalFines: b.totalFines,
      totalPaid: b.totalPaid,
      unpaidDebt: b.unpaidDebt,
      overpayment: b.overpayment,
      status: b.status
    };
  }).sort((a, b) => b.unpaidDebt - a.unpaidDebt || b.overpayment - a.overpayment);

  const filteredFines = fines
    .filter(f => selectedMemberIds.has(f.memberId) && filterByDate(f.createdAt))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const filteredTransactions = transactions
    .filter(t => filterByDate(t.createdAt))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const filteredPayments = payments
    .filter(p => selectedMemberIds.has(p.memberId) && filterByDate(p.createdAt))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const sortedGoals = [...goals].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const sortedEnvelopes = [...envelopes].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  // Financial summary metrics (Overall cashbox metrics for the selected period & date range)
  const allDateFines = fines.filter(f => filterByDate(f.createdAt));
  const totalFinesAmount = allDateFines.reduce((sum, f) => sum + (f.amount || 0), 0);
  const totalFinesPaid = allDateFines.reduce((sum, f) => sum + (f.paidAmount || (f.paid ? f.amount : 0)), 0);
  const totalUnpaidFines = Array.from(allMemberBalancesMap.values()).reduce((sum, m) => sum + m.unpaidDebt, 0);
  const totalOverpayments = Array.from(allMemberBalancesMap.values()).reduce((sum, m) => sum + m.overpayment, 0);

  const isTransferTx = (t: Transaction) => t.category === 'Převod' || t.source === 'transfer' || !!t.transferPairId;

  const totalIncome = filteredTransactions
    .filter(t => t.type === 'income' && !isTransferTx(t))
    .reduce((sum, t) => sum + (t.amount || 0), 0);

  const totalExpense = filteredTransactions
    .filter(t => t.type === 'expense' && !isTransferTx(t))
    .reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);

  const cashboxBalance = totalIncome - totalExpense;

  // PERIOD UNFILTERED STATISTICS (Ignoring date range as explicitly required)
  const unfilteredMemberMap = new Map<string, string>();
  members.forEach(m => unfilteredMemberMap.set(m.id, m.name));

  // 1. Sponzoři (Top přispěvatelé za celé období)
  const sponsorsList = members.map(m => {
    const totalPaymentsMade = payments.filter(p => p.memberId === m.id).reduce((s, p) => s + (p.amount || 0), 0);
    return { name: m.name, total: totalPaymentsMade };
  }).filter(s => s.total > 0).sort((a, b) => b.total - a.total).slice(0, 5);

  // 2. Největší dlužníci za celé období (pro celou pokladnu)
  const topDebtorsList = Array.from(allMemberBalancesMap.entries())
    .map(([id, bal]) => ({
      id,
      name: memberMap.get(id)?.name || 'Neznámý',
      unpaidDebt: bal.unpaidDebt,
      overpayment: bal.overpayment
    }))
    .filter(m => m.unpaidDebt > 0)
    .sort((a, b) => b.unpaidDebt - a.unpaidDebt)
    .slice(0, 5);

  // 3. Nejčastější prohřešky za celé období (Sloučeno dle typu prohřešku)
  const groupedCatsForExport = groupFinesIntoCategories(fines);
  const topViolationsList = groupedCatsForExport
    .map(cat => ({
      reason: cat.categoryName,
      count: cat.totalCount,
      totalAmount: cat.totalAmount
    }))
    .slice(0, 5);

  // Date range label
  const dateRangeLabel = (startDate || endDate)
    ? `Od ${startDate ? formatDate(Date.parse(startDate)) : 'počátku'} do ${endDate ? formatDate(Date.parse(endDate)) : 'současnosti'}`
    : 'Celé období (bez časového omezení)';

  // 1. EXPORT TO EXCEL
  const handleExportExcel = () => {
    const workbook = XLSX.utils.book_new();
    const currSymbol = getCurrencySymbol(group.currency);

    // Sheet 1: Souhrn
    const summaryData = [
      { 'Ukazatel': 'Tým / Skupina', 'Hodnota': group.name },
      { 'Ukazatel': 'Vybrané období', 'Hodnota': period.name },
      { 'Ukazatel': 'Časové rozmezí', 'Hodnota': dateRangeLabel },
      { 'Ukazatel': 'Datum exportu', 'Hodnota': new Date().toLocaleDateString('cs-CZ') },
      { 'Ukazatel': '', 'Hodnota': '' },
      { 'Ukazatel': `Celková suma pokut (${currSymbol})`, 'Hodnota': totalFinesAmount },
      { 'Ukazatel': `Uhrazené pokuty (${currSymbol})`, 'Hodnota': totalFinesPaid },
      { 'Ukazatel': `Celkové neuzavřené dluhy (${currSymbol})`, 'Hodnota': totalUnpaidFines },
      { 'Ukazatel': `Celkové přeplatky členů (${currSymbol})`, 'Hodnota': totalOverpayments },
      { 'Ukazatel': `Příjmy pokladny (${currSymbol})`, 'Hodnota': totalIncome },
      { 'Ukazatel': `Výdaje pokladny (${currSymbol})`, 'Hodnota': totalExpense },
      { 'Ukazatel': `Zůstatek v pokladně (${currSymbol})`, 'Hodnota': cashboxBalance },
    ];
    const wsSummary = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(workbook, wsSummary, 'Souhrn financí');

    // Sheet 2: Cíle a obálky
    if (includeGoalsAndEnvelopes && (sortedGoals.length > 0 || sortedEnvelopes.length > 0)) {
      const goalsData = sortedGoals.map(g => ({
        'Druh': 'Finanční cíl',
        'Název': g.name,
        [`Cílová částka (${currSymbol})`]: g.targetAmount,
        'Priorita': g.priority,
        'Stav': g.completed ? 'Splněno' : 'Probíhá'
      }));
      const envData = sortedEnvelopes.map(e => ({
        'Druh': 'Obálka pokladny',
        'Název': e.name,
        [`Aktuální zůstatek (${currSymbol})`]: e.amount,
        [`Cílová částka (${currSymbol})`]: e.targetAmount || '-',
        'Poznámka': e.note || '-'
      }));
      const wsGoals = XLSX.utils.json_to_sheet([...goalsData, ...envData]);
      XLSX.utils.book_append_sheet(workbook, wsGoals, 'Cíle a obálky');
    }

    // Sheet 3: Bilance členů (with overpayments and active status)
    if (includeMemberBalances && memberBalances.length > 0) {
      const balData = memberBalances.map(m => ({
        'Člen': m.name,
        'Aktivita člena': m.active ? 'Aktivní' : 'Neaktivní',
        [`Celkem pokut (${currSymbol})`]: m.totalFines,
        [`Celkem zaplaceno (${currSymbol})`]: m.totalPaid,
        [`Aktuální dluh (${currSymbol})`]: m.unpaidDebt,
        [`Přeplatek (${currSymbol})`]: m.overpayment,
        'Celkový stav': m.status
      }));
      const wsBal = XLSX.utils.json_to_sheet(balData);
      XLSX.utils.book_append_sheet(workbook, wsBal, 'Bilance členů');
    }

    // Sheet 4: Pokuty
    if (includeFines && filteredFines.length > 0) {
      const finesData = filteredFines.map(f => {
        const remaining = f.amount - (f.paidAmount || (f.paid ? f.amount : 0));
        const m = memberMap.get(f.memberId);
        return {
          'Datum': formatDate(f.createdAt),
          'Člen': m?.name || 'Neznámý',
          'Aktivita člena': m?.active !== false ? 'Aktivní' : 'Neaktivní',
          'Prohřešek / Důvod': f.reason,
          [`Částka (${currSymbol})`]: f.amount,
          [`Zaplaceno (${currSymbol})`]: f.paidAmount || (f.paid ? f.amount : 0),
          [`Zbývá (${currSymbol})`]: remaining,
          'Stav': f.paid ? 'Zaplaceno' : (f.paidAmount && f.paidAmount > 0) ? 'Částečně' : 'Nezaplaceno',
          'Typ': f.recurringFineId ? 'Automatická pokuta' : 'Ruční zápis'
        };
      });
      const wsFines = XLSX.utils.json_to_sheet(finesData);
      XLSX.utils.book_append_sheet(workbook, wsFines, 'Historie pokut');
    }

    // Sheet 5: Výdaje a Příjmy
    if (includeTransactions && filteredTransactions.length > 0) {
      const txData = filteredTransactions.map(t => ({
        'Datum': formatDate(t.createdAt),
        'Typ': t.type === 'income' ? 'Příjem' : 'Výdaj',
        'Kategorie': t.category || 'Nespecifikováno',
        [`Částka (${currSymbol})`]: Math.abs(t.amount),
        'Od / Komu': t.fromWho || '-',
        'Poznámka': t.note || '-'
      }));
      const wsTx = XLSX.utils.json_to_sheet(txData);
      XLSX.utils.book_append_sheet(workbook, wsTx, 'Pokladna a výdaje');
    }

    // Sheet 6: Platby
    if (includePayments && filteredPayments.length > 0) {
      const payData = filteredPayments.map(p => {
        const m = memberMap.get(p.memberId);
        return {
          'Datum': formatDate(p.createdAt),
          'Člen': m?.name || 'Neznámý',
          'Aktivita člena': m?.active !== false ? 'Aktivní' : 'Neaktivní',
          [`Částka (${currSymbol})`]: p.amount,
          'Způsob úhrady': p.paymentMethod === 'cash' ? 'Hotovost' : p.paymentMethod === 'bank' ? 'Bankovní převod' : 'Proplacený nákup',
          'Poznámka': p.note || '-'
        };
      });
      const wsPay = XLSX.utils.json_to_sheet(payData);
      XLSX.utils.book_append_sheet(workbook, wsPay, 'Připsané platby');
    }

    // Sheet 7: Statistiky celého období
    if (includeStatistics) {
      const statsExport = [
        ...sponsorsList.map(s => ({ 'Kategorie': 'Top sponzor (platby)', 'Položka': s.name, 'Hodnota': s.total })),
        ...topDebtorsList.map(d => ({ 'Kategorie': 'Top dlužník', 'Položka': d.name, 'Hodnota': d.unpaidDebt })),
        ...topViolationsList.map(v => ({ 'Kategorie': 'Nejčastější prohřešek', 'Položka': `${v.reason} (${v.count}x)`, 'Hodnota': v.totalAmount }))
      ];
      if (statsExport.length > 0) {
        const wsStats = XLSX.utils.json_to_sheet(statsExport);
        XLSX.utils.book_append_sheet(workbook, wsStats, 'Statistiky kasy');
      }
    }

    const filename = `Financni_prehled_${group.name.replace(/\s+/g, '_')}_${period.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(workbook, filename);
  };

  // 2. EXPORT TO CSV
  const handleExportCSV = () => {
    const currSymbol = getCurrencySymbol(group.currency);
    let csvContent = '\uFEFF'; // UTF-8 BOM

    csvContent += `FINANČNÍ PŘEHLED TÝMU: ${group.name}\n`;
    csvContent += `Období: ${period.name}\n`;
    csvContent += `Časové rozmezí: ${dateRangeLabel}\n`;
    csvContent += `Datum generování: ${new Date().toLocaleDateString('cs-CZ')}\n\n`;

    csvContent += `SOUHRN METRIK\n`;
    csvContent += `Suma pokut;Uhrazeno;Nezaplacené dluhy;Přeplatky;Příjmy pokladny;Výdaje pokladny;Zůstatek pokladny\n`;
    csvContent += `"${totalFinesAmount} ${currSymbol}";"${totalFinesPaid} ${currSymbol}";"${totalUnpaidFines} ${currSymbol}";"${totalOverpayments} ${currSymbol}";"${totalIncome} ${currSymbol}";"${totalExpense} ${currSymbol}";"${cashboxBalance} ${currSymbol}"\n\n`;

    if (includeMemberBalances) {
      csvContent += `BILANCE ČLENŮ (VČETNĚ PŘEPLATKŮ)\n`;
      csvContent += `Člen;Celkem pokuty (${currSymbol});Zaplaceno (${currSymbol});Aktuální dluh (${currSymbol});Přeplatek (${currSymbol});Stav\n`;
      memberBalances.forEach(m => {
        csvContent += `"${m.name}";"${m.totalFines}";"${m.totalPaid}";"${m.unpaidDebt}";"${m.overpayment}";"${m.status}"\n`;
      });
      csvContent += `\n`;
    }

    if (includeFines) {
      csvContent += `HISTORIE POKUT\n`;
      csvContent += `Datum;Člen;Důvod pokuty;Částka (${currSymbol});Zaplaceno (${currSymbol});Stav;Typ\n`;
      filteredFines.forEach(f => {
        const status = f.paid ? 'Zaplaceno' : (f.paidAmount && f.paidAmount > 0) ? 'Částečně' : 'Nezaplaceno';
        csvContent += `"${formatDate(f.createdAt)}";"${memberMap.get(f.memberId)?.name || ''}";"${f.reason.replace(/"/g, '""')}";"${f.amount}";"${f.paidAmount || (f.paid ? f.amount : 0)}";"${status}";"${f.recurringFineId ? 'Automatická' : 'Ruční'}"\n`;
      });
      csvContent += `\n`;
    }

    if (includeTransactions) {
      csvContent += `HISTORIE POKLADNY A VÝDAJŮ\n`;
      csvContent += `Datum;Typ;Kategorie;Částka (${currSymbol});Od/Komu;Poznámka\n`;
      filteredTransactions.forEach(t => {
        csvContent += `"${formatDate(t.createdAt)}";"${t.type === 'income' ? 'Příjem' : 'Výdaj'}";"${t.category || ''}";"${Math.abs(t.amount)}";"${(t.fromWho || '').replace(/"/g, '""')}";"${(t.note || '').replace(/"/g, '""')}"\n`;
      });
      csvContent += `\n`;
    }

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Financni_prehled_${group.name.replace(/\s+/g, '_')}_${period.name.replace(/\s+/g, '_')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // 3. EXPORT DIRECT PDF DOWNLOAD VIA HTML2PDF
  const handleDownloadPDF = async () => {
    if (isGeneratingPdf) return;
    setIsGeneratingPdf(true);

    // Give React time to render loading state
    await new Promise((resolve) => setTimeout(resolve, 150));

    try {
      const element = document.getElementById('pdf-report-content');
      if (!element) {
        setIsGeneratingPdf(false);
        return;
      }

      const opt = {
        margin: [10, 10, 10, 10],
        filename: `Financni_vykaz_${group.name.replace(/\s+/g, '_')}_${period.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          logging: false,
          scrollY: 0
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: {
          mode: ['css', 'legacy'],
          before: ['.pdf-page-break-before'],
          avoid: ['h1', 'h2', 'h3', 'h4', '.pdf-header-container', '.pdf-heading', '.pdf-no-break', 'tr', 'thead', '.pdf-card', '.pdf-section-title']
        }
      };

      // @ts-ignore
      await html2pdf().set(opt).from(element).save();
    } catch (err) {
      console.error('PDF export error:', err);
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      {/* Hidden Offscreen PDF Container (pure hex colors, 680px width for standard A4 10mm margins) */}
      <div style={{ position: 'fixed', left: '-9999px', top: '-9999px', width: '680px', backgroundColor: '#ffffff', opacity: 1, zIndex: -1000, pointerEvents: 'none' }}>
        <div id="pdf-report-content" style={{ fontFamily: 'Arial, sans-serif', color: '#0f172a', backgroundColor: '#ffffff', padding: '20px', boxSizing: 'border-box', width: '680px', maxWidth: '680px', margin: '0 auto' }}>
          <style>{`
            #pdf-report-content h1,
            #pdf-report-content h2,
            #pdf-report-content h3,
            #pdf-report-content h4 {
              line-height: 1.3 !important;
              page-break-inside: avoid !important;
              break-inside: avoid !important;
              page-break-after: avoid !important;
              break-after: avoid !important;
              -webkit-column-break-inside: avoid !important;
            }
            #pdf-report-content .pdf-header-container,
            #pdf-report-content .pdf-heading,
            #pdf-report-content .pdf-no-break,
            #pdf-report-content .pdf-section-title {
              page-break-inside: avoid !important;
              break-inside: avoid !important;
              page-break-after: avoid !important;
              break-after: avoid !important;
              page-break-before: auto !important;
              break-before: auto !important;
              -webkit-column-break-inside: avoid !important;
            }
            #pdf-report-content tr,
            #pdf-report-content thead,
            #pdf-report-content .pdf-card {
              page-break-inside: avoid !important;
              break-inside: avoid !important;
              -webkit-column-break-inside: avoid !important;
            }
            #pdf-report-content .pdf-page-break-before {
              page-break-before: always !important;
              break-before: page !important;
            }
          `}</style>
          {/* Page 1: Title & Overview */}
          <div className="pdf-section" style={{ paddingBottom: '24px', boxSizing: 'border-box', width: '100%' }}>
            <div className="pdf-header-container pdf-no-break" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #0f172a', paddingBottom: '12px', marginBottom: '20px', pageBreakInside: 'avoid', breakInside: 'avoid', pageBreakAfter: 'avoid', breakAfter: 'avoid' }}>
              <div style={{ width: '65%' }}>
                <h1 className="pdf-heading" style={{ fontSize: '20px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-0.025em', margin: 0, color: '#0f172a', wordBreak: 'break-word', pageBreakInside: 'avoid', breakInside: 'avoid', pageBreakAfter: 'avoid', breakAfter: 'avoid' }}>{group.name}</h1>
                <p style={{ fontSize: '12px', fontWeight: 700, color: '#334155', margin: '3px 0 0 0' }}>Oficiální finanční výkaz a zpráva o pokutách</p>
                <p style={{ fontSize: '11px', fontWeight: 600, color: '#4338ca', margin: '3px 0 0 0' }}>Období: {period.name}</p>
                <p style={{ fontSize: '10px', color: '#64748b', margin: '2px 0 0 0' }}>Časové rozmezí: {dateRangeLabel}</p>
              </div>
              <div style={{ textAlign: 'right', width: '35%' }}>
                <p style={{ fontSize: '10px', fontWeight: 700, color: '#64748b', margin: 0 }}>Datum vyhotovení:</p>
                <p style={{ fontSize: '12px', fontWeight: 900, color: '#0f172a', margin: '2px 0 0 0' }}>{new Date().toLocaleDateString('cs-CZ')}</p>
              </div>
            </div>

            <div className="pdf-no-break" style={{ marginTop: '12px', pageBreakInside: 'avoid', breakInside: 'avoid' }}>
              <h2 className="pdf-heading" style={{ fontSize: '14px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#1e293b', borderBottom: '1px solid #e2e8f0', paddingBottom: '6px', marginBottom: '12px', pageBreakInside: 'avoid', breakInside: 'avoid', pageBreakAfter: 'avoid', breakAfter: 'avoid' }}>Souhrnný přehled hospodaření</h2>
              <div className="pdf-card" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px', padding: '12px', backgroundColor: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0', boxSizing: 'border-box', width: '100%', pageBreakInside: 'avoid', breakInside: 'avoid' }}>
                <div style={{ padding: '10px', backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0', boxSizing: 'border-box' }}>
                  <p style={{ fontSize: '9px', textTransform: 'uppercase', fontWeight: 700, color: '#64748b', margin: 0 }}>Celková suma pokut</p>
                  <p style={{ fontSize: '15px', fontWeight: 900, color: '#0f172a', margin: '3px 0 0 0' }}>{formatCurrency(totalFinesAmount, group.currency)}</p>
                </div>
                <div style={{ padding: '10px', backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0', boxSizing: 'border-box' }}>
                  <p style={{ fontSize: '9px', textTransform: 'uppercase', fontWeight: 700, color: '#64748b', margin: 0 }}>Uhrazeno na pokutách</p>
                  <p style={{ fontSize: '15px', fontWeight: 900, color: '#047857', margin: '3px 0 0 0' }}>{formatCurrency(totalFinesPaid, group.currency)}</p>
                </div>
                <div style={{ padding: '10px', backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0', boxSizing: 'border-box' }}>
                  <p style={{ fontSize: '9px', textTransform: 'uppercase', fontWeight: 700, color: '#64748b', margin: 0 }}>Celkové neuzavřené dluhy</p>
                  <p style={{ fontSize: '15px', fontWeight: 900, color: '#e11d48', margin: '3px 0 0 0' }}>{formatCurrency(totalUnpaidFines, group.currency)}</p>
                </div>
                <div style={{ padding: '10px', backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0', boxSizing: 'border-box' }}>
                  <p style={{ fontSize: '9px', textTransform: 'uppercase', fontWeight: 700, color: '#64748b', margin: 0 }}>Celkové přeplatky členů</p>
                  <p style={{ fontSize: '15px', fontWeight: 900, color: '#4f46e5', margin: '3px 0 0 0' }}>{formatCurrency(totalOverpayments, group.currency)}</p>
                </div>
                <div style={{ padding: '10px', backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0', boxSizing: 'border-box' }}>
                  <p style={{ fontSize: '9px', textTransform: 'uppercase', fontWeight: 700, color: '#64748b', margin: 0 }}>Příjmy pokladny</p>
                  <p style={{ fontSize: '15px', fontWeight: 900, color: '#047857', margin: '3px 0 0 0' }}>{formatCurrency(totalIncome, group.currency)}</p>
                </div>
                <div style={{ padding: '10px', backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0', boxSizing: 'border-box' }}>
                  <p style={{ fontSize: '9px', textTransform: 'uppercase', fontWeight: 700, color: '#64748b', margin: 0 }}>Výdaje pokladny</p>
                  <p style={{ fontSize: '15px', fontWeight: 900, color: '#e11d48', margin: '3px 0 0 0' }}>{formatCurrency(totalExpense, group.currency)}</p>
                </div>
              </div>

              <div className="pdf-card" style={{ marginTop: '12px', padding: '12px 14px', backgroundColor: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxSizing: 'border-box', width: '100%', pageBreakInside: 'avoid', breakInside: 'avoid' }}>
                <div>
                  <p style={{ fontSize: '10px', fontWeight: 700, color: '#312e81', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>Aktuální čistý zůstatek v pokladně</p>
                  <p style={{ fontSize: '20px', fontWeight: 900, color: '#4338ca', margin: '2px 0 0 0' }}>{formatCurrency(cashboxBalance, group.currency)}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontSize: '9px', fontWeight: 700, color: '#4338ca', textTransform: 'uppercase', margin: 0 }}>Stav kasy týmu</p>
                  <p style={{ fontSize: '11px', fontWeight: 800, color: '#1e1b4b', margin: '2px 0 0 0' }}>Vyhotoveno {new Date().toLocaleDateString('cs-CZ')}</p>
                </div>
              </div>

              {/* Bank Details & QR Payment Box */}
              {(group.bankAccount || group.bankQrCodeUrl) && (
                <div 
                  className="pdf-card" 
                  style={{ 
                    marginTop: '12px', 
                    padding: '14px 16px', 
                    backgroundColor: '#ffffff', 
                    border: '1.5px solid #cbd5e1', 
                    borderRadius: '12px', 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center', 
                    boxSizing: 'border-box', 
                    width: '100%', 
                    pageBreakInside: 'avoid', 
                    breakInside: 'avoid',
                    gap: '16px'
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                      <p style={{ fontSize: '11px', fontWeight: 900, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>
                        Bankovní spojení pro úhrady pokut
                      </p>
                      {group.bankName && (
                        <span style={{ fontSize: '9px', fontWeight: 700, color: '#334155', backgroundColor: '#f1f5f9', border: '1px solid #e2e8f0', padding: '2px 6px', borderRadius: '4px' }}>
                          {group.bankName}
                        </span>
                      )}
                    </div>

                    {group.bankAccount && (
                      <div style={{ marginBottom: '8px' }}>
                        <p style={{ fontSize: '9px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', margin: 0 }}>
                          Číslo bankovního účtu:
                        </p>
                        <p style={{ fontFamily: 'monospace', fontSize: '15px', fontWeight: 900, color: '#0f172a', margin: '2px 0 0 0', letterSpacing: '0.03em' }}>
                          {group.bankAccount}
                        </p>
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '6px' }}>
                      {group.bankVS && (
                        <div>
                          <p style={{ fontSize: '9px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', margin: 0 }}>
                            Variabilní symbol (VS):
                          </p>
                          <p style={{ fontFamily: 'monospace', fontSize: '12px', fontWeight: 800, color: '#0f172a', margin: '1px 0 0 0' }}>
                            {group.bankVS}
                          </p>
                        </div>
                      )}
                      {group.bankNote && (
                        <div style={{ maxWidth: '240px' }}>
                          <p style={{ fontSize: '9px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', margin: 0 }}>
                            Zpráva pro příjemce:
                          </p>
                          <p style={{ fontSize: '10px', color: '#334155', fontStyle: 'italic', margin: '1px 0 0 0', wordBreak: 'break-word' }}>
                            {group.bankNote}
                          </p>
                        </div>
                      )}
                    </div>

                    <p style={{ fontSize: '9px', color: '#64748b', margin: '6px 0 0 0', lineHeight: 1.35 }}>
                      {group.bankQrCodeUrl 
                        ? 'Naskenujte přiložený QR kód ve vaší bankovní aplikaci pro okamžité a přesné předvyplnění platby.'
                        : 'Při bezhotovostní platbě na účet vždy uveďte své jméno do zprávy pro příjemce.'}
                    </p>
                  </div>

                  {group.bankQrCodeUrl && (
                    <div 
                      style={{ 
                        textAlign: 'center', 
                        flexShrink: 0, 
                        padding: '8px', 
                        backgroundColor: '#ffffff', 
                        border: '1.5px solid #0f172a', 
                        borderRadius: '10px',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.06)'
                      }}
                    >
                      <img
                        src={group.bankQrCodeUrl}
                        alt="QR Platba"
                        crossOrigin="anonymous"
                        style={{ 
                          width: '145px', 
                          height: '145px', 
                          objectFit: 'contain', 
                          display: 'block', 
                          margin: '0 auto',
                          backgroundColor: '#ffffff'
                        }}
                      />
                      <p style={{ fontSize: '9px', fontWeight: 900, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '5px 0 0 0' }}>
                        QR Platba kasy
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Page 2: Goals & Envelopes */}
          {includeGoalsAndEnvelopes && (sortedGoals.length > 0 || sortedEnvelopes.length > 0) && (
            <div className="pdf-section pdf-page-break-before" style={{ pageBreakBefore: 'always', breakBefore: 'page', paddingBottom: '32px', boxSizing: 'border-box', width: '100%' }}>
              <div className="pdf-header-container pdf-no-break" style={{ borderBottom: '2px solid #0f172a', paddingBottom: '8px', marginBottom: '24px', pageBreakInside: 'avoid', breakInside: 'avoid', pageBreakAfter: 'avoid', breakAfter: 'avoid' }}>
                <h2 className="pdf-heading" style={{ fontSize: '18px', fontWeight: 900, textTransform: 'uppercase', margin: 0, pageBreakInside: 'avoid', breakInside: 'avoid', pageBreakAfter: 'avoid', breakAfter: 'avoid' }}>Finanční cíle a obálky kasy</h2>
                <p style={{ fontSize: '11px', fontWeight: 500, color: '#475569', margin: '4px 0 0 0' }}>Plány a rozdělení prostředků v období {period.name}</p>
              </div>

              {sortedGoals.length > 0 && (
                <div style={{ marginBottom: '28px' }}>
                  <h3 className="pdf-heading pdf-no-break" style={{ fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', color: '#1e293b', borderBottom: '1px solid #cbd5e1', paddingBottom: '4px', marginBottom: '12px', pageBreakInside: 'avoid', breakInside: 'avoid', pageBreakAfter: 'avoid', breakAfter: 'avoid' }}>
                    Finanční cíle ({sortedGoals.length})
                  </h3>
                  <table style={{ width: '100%', tableLayout: 'fixed', fontSize: '11px', textAlign: 'left', borderCollapse: 'collapse', wordBreak: 'break-word', overflowWrap: 'break-word' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #cbd5e1', fontWeight: 700, color: '#334155', pageBreakInside: 'avoid', breakInside: 'avoid' }}>
                        <th style={{ padding: '8px 4px', width: '25%' }}>Název cíle</th>
                        <th style={{ padding: '8px 4px', width: '15%', textAlign: 'right' }}>Cílová částka</th>
                        <th style={{ padding: '8px 4px', width: '25%', textAlign: 'right' }}>Splněno (aktuálně)</th>
                        <th style={{ padding: '8px 4px', width: '23%', textAlign: 'left' }}>Zdroj krytí</th>
                        <th style={{ padding: '8px 4px', width: '12%', textAlign: 'center' }}>Stav</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedGoals.map(g => {
                        const totalEnvelopesAllocated = envelopes.reduce((acc, env) => acc + (env.amount || 0), 0);
                        const availableCashOutsideEnvelopes = Math.max(0, cashboxBalance - totalEnvelopesAllocated);
                        const isTotalCashbox = g.goalCalcSource === 'total_cashbox';
                        const sourceLabel = isTotalCashbox ? 'Celková hotovost' : 'Dostupná hotovost';
                        const currentSourceAmount = isTotalCashbox ? cashboxBalance : availableCashOutsideEnvelopes;
                        const currentSavedVal = g.completed ? g.targetAmount : Math.max(0, currentSourceAmount);
                        const clampedSaved = Math.min(g.targetAmount, currentSavedVal);
                        const pct = Math.min(100, Math.round((clampedSaved / g.targetAmount) * 100));

                        return (
                          <tr key={g.id} style={{ borderBottom: '1px solid #e2e8f0', pageBreakInside: 'avoid', breakInside: 'avoid' }}>
                            <td style={{ padding: '8px 4px', fontWeight: 700 }}>{g.name}</td>
                            <td style={{ padding: '8px 4px', textAlign: 'right', fontWeight: 700 }}>{formatCurrency(g.targetAmount, group.currency)}</td>
                            <td style={{ padding: '8px 4px', textAlign: 'right', fontWeight: 800, color: g.completed ? '#047857' : '#4f46e5' }}>
                              {formatCurrency(clampedSaved, group.currency)} ({pct} %)
                            </td>
                            <td style={{ padding: '8px 4px', fontSize: '10px', color: '#475569' }}>
                              {sourceLabel}
                            </td>
                            <td style={{ padding: '8px 4px', textAlign: 'center', fontWeight: 700, color: g.completed ? '#047857' : '#4f46e5' }}>
                              {g.completed ? 'Splněno' : 'Probíhá'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {sortedEnvelopes.length > 0 && (
                <div>
                  <h3 className="pdf-heading pdf-no-break" style={{ fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', color: '#1e293b', borderBottom: '1px solid #cbd5e1', paddingBottom: '4px', marginBottom: '12px', pageBreakInside: 'avoid', breakInside: 'avoid', pageBreakAfter: 'avoid', breakAfter: 'avoid' }}>
                    Rozdělení obálek kasy ({sortedEnvelopes.length})
                  </h3>
                  <table style={{ width: '100%', tableLayout: 'fixed', fontSize: '11px', textAlign: 'left', borderCollapse: 'collapse', wordBreak: 'break-word', overflowWrap: 'break-word' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #cbd5e1', fontWeight: 700, color: '#334155', pageBreakInside: 'avoid', breakInside: 'avoid' }}>
                        <th style={{ padding: '8px 4px', width: '30%' }}>Název obálky</th>
                        <th style={{ padding: '8px 4px', width: '20%', textAlign: 'right' }}>Vyhrazená částka</th>
                        <th style={{ padding: '8px 4px', width: '20%', textAlign: 'right' }}>Cílová částka</th>
                        <th style={{ padding: '8px 4px', width: '30%' }}>Poznámka</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedEnvelopes.map(e => (
                        <tr key={e.id} style={{ borderBottom: '1px solid #e2e8f0', pageBreakInside: 'avoid', breakInside: 'avoid' }}>
                          <td style={{ padding: '8px 4px', fontWeight: 700 }}>{e.name}</td>
                          <td style={{ padding: '8px 4px', textAlign: 'right', fontWeight: 900, color: '#047857' }}>{formatCurrency(e.amount, group.currency)}</td>
                          <td style={{ padding: '8px 4px', textAlign: 'right' }}>{e.targetAmount ? formatCurrency(e.targetAmount, group.currency) : '-'}</td>
                          <td style={{ padding: '8px 4px', color: '#475569' }}>{e.note || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Page 3: Member Balances */}
          {includeMemberBalances && (
            <div className="pdf-section pdf-page-break-before" style={{ pageBreakBefore: 'always', breakBefore: 'page', paddingBottom: '32px', boxSizing: 'border-box', width: '100%' }}>
              <div className="pdf-header-container pdf-no-break" style={{ borderBottom: '2px solid #0f172a', paddingBottom: '8px', marginBottom: '24px', pageBreakInside: 'avoid', breakInside: 'avoid', pageBreakAfter: 'avoid', breakAfter: 'avoid' }}>
                <h2 className="pdf-heading" style={{ fontSize: '18px', fontWeight: 900, textTransform: 'uppercase', margin: 0, pageBreakInside: 'avoid', breakInside: 'avoid', pageBreakAfter: 'avoid', breakAfter: 'avoid' }}>Bilance a stav členů ({memberBalances.length})</h2>
                <p style={{ fontSize: '11px', fontWeight: 500, color: '#475569', margin: '4px 0 0 0' }}>Kompletní přehled zaplacených pokut, dluhů a přeplatků</p>
              </div>

              <table style={{ width: '100%', tableLayout: 'fixed', fontSize: '11px', textAlign: 'left', borderCollapse: 'collapse', wordBreak: 'break-word', overflowWrap: 'break-word' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #0f172a', fontWeight: 700, color: '#1e293b', pageBreakInside: 'avoid', breakInside: 'avoid' }}>
                    <th style={{ padding: '8px 4px', width: '22%' }}>Člen týmu</th>
                    <th style={{ padding: '8px 4px', width: '12%', textAlign: 'center' }}>Aktivita</th>
                    <th style={{ padding: '8px 4px', width: '14%', textAlign: 'right' }}>Suma pokut</th>
                    <th style={{ padding: '8px 4px', width: '14%', textAlign: 'right' }}>Celkem uhradil</th>
                    <th style={{ padding: '8px 4px', width: '14%', textAlign: 'right' }}>Aktuální dluh</th>
                    <th style={{ padding: '8px 4px', width: '14%', textAlign: 'right' }}>Přeplatek</th>
                    <th style={{ padding: '8px 4px', width: '10%', textAlign: 'center' }}>Stav</th>
                  </tr>
                </thead>
                <tbody>
                  {memberBalances.map(m => (
                    <tr key={m.id} style={{ borderBottom: '1px solid #e2e8f0', pageBreakInside: 'avoid', breakInside: 'avoid' }}>
                      <td style={{ padding: '8px 4px', fontWeight: 700, color: '#0f172a' }}>{m.name}</td>
                      <td style={{ padding: '8px 4px', textAlign: 'center', fontSize: '10px', fontWeight: 600, color: m.active ? '#047857' : '#94a3b8' }}>
                        {m.active ? 'Aktivní' : 'Neaktivní'}
                      </td>
                      <td style={{ padding: '8px 4px', textAlign: 'right' }}>{formatCurrency(m.totalFines, group.currency)}</td>
                      <td style={{ padding: '8px 4px', textAlign: 'right', fontWeight: 700 }}>{formatCurrency(m.totalPaid, group.currency)}</td>
                      <td style={{ padding: '8px 4px', textAlign: 'right', fontWeight: 900, color: '#e11d48' }}>
                        {m.unpaidDebt > 0 ? formatCurrency(m.unpaidDebt, group.currency) : '-'}
                      </td>
                      <td style={{ padding: '8px 4px', textAlign: 'right', fontWeight: 900, color: '#047857' }}>
                        {m.overpayment > 0 ? `+${formatCurrency(m.overpayment, group.currency)}` : '-'}
                      </td>
                      <td style={{ padding: '8px 4px', textAlign: 'center', fontWeight: 700 }}>
                        {m.unpaidDebt > 0 ? (
                          <span style={{ color: '#e11d48' }}>Dluh</span>
                        ) : m.overpayment > 0 ? (
                          <span style={{ color: '#047857', backgroundColor: '#ecfdf5', padding: '2px 4px', borderRadius: '4px' }}>Přeplatek</span>
                        ) : (
                          <span style={{ color: '#64748b' }}>Vyrovnáno</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Member Balances bank prompt if there are debts */}
              {totalUnpaidFines > 0 && (group.bankAccount || group.bankQrCodeUrl) && (
                <div className="pdf-card pdf-no-break" style={{ marginTop: '14px', padding: '10px 14px', backgroundColor: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10px', color: '#475569', pageBreakInside: 'avoid', breakInside: 'avoid' }}>
                  <span>
                    Pro bezhotovostní úhradu dluhů využijte bankovní účet: <strong style={{ fontFamily: 'monospace', color: '#0f172a' }}>{group.bankAccount || 'kasy'}</strong> {group.bankVS ? `(VS: ${group.bankVS})` : ''}.
                  </span>
                  {group.bankQrCodeUrl && (
                    <span style={{ fontWeight: 700, color: '#4338ca' }}>
                      QR kód k platbě naleznete na úvodní straně výkazu.
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Page 4: Fines History */}
          {includeFines && (
            <div className="pdf-section pdf-page-break-before" style={{ pageBreakBefore: 'always', breakBefore: 'page', paddingBottom: '32px', boxSizing: 'border-box', width: '100%' }}>
              <div className="pdf-header-container pdf-no-break" style={{ borderBottom: '2px solid #0f172a', paddingBottom: '8px', marginBottom: '24px', pageBreakInside: 'avoid', breakInside: 'avoid', pageBreakAfter: 'avoid', breakAfter: 'avoid' }}>
                <h2 className="pdf-heading" style={{ fontSize: '18px', fontWeight: 900, textTransform: 'uppercase', margin: 0, pageBreakInside: 'avoid', breakInside: 'avoid', pageBreakAfter: 'avoid', breakAfter: 'avoid' }}>Historie pokut ({filteredFines.length})</h2>
                <p style={{ fontSize: '11px', fontWeight: 500, color: '#475569', margin: '4px 0 0 0' }}>Detailní přehled předepsaných pokut v období</p>
              </div>

              <table style={{ width: '100%', tableLayout: 'fixed', fontSize: '11px', textAlign: 'left', borderCollapse: 'collapse', wordBreak: 'break-word', overflowWrap: 'break-word' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #0f172a', fontWeight: 700, color: '#1e293b', pageBreakInside: 'avoid', breakInside: 'avoid' }}>
                    <th style={{ padding: '8px 4px', width: '13%' }}>Datum</th>
                    <th style={{ padding: '8px 4px', width: '20%' }}>Člen</th>
                    <th style={{ padding: '8px 4px', width: '31%' }}>Prohřešek / Důvod</th>
                    <th style={{ padding: '8px 4px', width: '13%', textAlign: 'right' }}>Předepsáno</th>
                    <th style={{ padding: '8px 4px', width: '13%', textAlign: 'right' }}>Uhrazeno</th>
                    <th style={{ padding: '8px 4px', width: '10%', textAlign: 'center' }}>Stav</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredFines.map(f => {
                    const paidVal = f.paidAmount || (f.paid ? f.amount : 0);
                    return (
                      <tr key={f.id} style={{ borderBottom: '1px solid #e2e8f0', pageBreakInside: 'avoid', breakInside: 'avoid' }}>
                        <td style={{ padding: '8px 4px' }}>{formatDate(f.createdAt)}</td>
                        <td style={{ padding: '8px 4px', fontWeight: 700 }}>{memberMap.get(f.memberId)?.name || 'Neznámý'}</td>
                        <td style={{ padding: '8px 4px', wordBreak: 'break-word' }}>{f.reason}</td>
                        <td style={{ padding: '8px 4px', textAlign: 'right', fontWeight: 700 }}>{formatCurrency(f.amount, group.currency)}</td>
                        <td style={{ padding: '8px 4px', textAlign: 'right' }}>{formatCurrency(paidVal, group.currency)}</td>
                        <td style={{ padding: '8px 4px', textAlign: 'center', fontWeight: 700 }}>
                          {f.paid ? (
                            <span style={{ color: '#047857' }}>Zaplaceno</span>
                          ) : paidVal > 0 ? (
                            <span style={{ color: '#d97706' }}>Částečně</span>
                          ) : (
                            <span style={{ color: '#e11d48' }}>Nezaplaceno</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Page 5: Transactions History */}
          {includeTransactions && (
            <div className="pdf-section pdf-page-break-before" style={{ pageBreakBefore: 'always', breakBefore: 'page', paddingBottom: '32px', boxSizing: 'border-box', width: '100%' }}>
              <div className="pdf-header-container pdf-no-break" style={{ borderBottom: '2px solid #0f172a', paddingBottom: '8px', marginBottom: '24px', pageBreakInside: 'avoid', breakInside: 'avoid', pageBreakAfter: 'avoid', breakAfter: 'avoid' }}>
                <h2 className="pdf-heading" style={{ fontSize: '18px', fontWeight: 900, textTransform: 'uppercase', margin: 0, pageBreakInside: 'avoid', breakInside: 'avoid', pageBreakAfter: 'avoid', breakAfter: 'avoid' }}>Pokladna a výdaje ({filteredTransactions.length})</h2>
                <p style={{ fontSize: '11px', fontWeight: 500, color: '#475569', margin: '4px 0 0 0' }}>Přehled pohybů na pokladně kasy</p>
              </div>

              <table style={{ width: '100%', tableLayout: 'fixed', fontSize: '11px', textAlign: 'left', borderCollapse: 'collapse', wordBreak: 'break-word', overflowWrap: 'break-word' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #0f172a', fontWeight: 700, color: '#1e293b', pageBreakInside: 'avoid', breakInside: 'avoid' }}>
                    <th style={{ padding: '8px 4px', width: '13%' }}>Datum</th>
                    <th style={{ padding: '8px 4px', width: '12%' }}>Typ</th>
                    <th style={{ padding: '8px 4px', width: '22%' }}>Kategorie</th>
                    <th style={{ padding: '8px 4px', width: '35%' }}>Od/Komu</th>
                    <th style={{ padding: '8px 4px', width: '18%', textAlign: 'right' }}>Částka</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTransactions.map(t => (
                    <tr key={t.id} style={{ borderBottom: '1px solid #e2e8f0', pageBreakInside: 'avoid', breakInside: 'avoid' }}>
                      <td style={{ padding: '8px 4px' }}>{formatDate(t.createdAt)}</td>
                      <td style={{ padding: '8px 4px', fontWeight: 700, color: t.type === 'income' ? '#047857' : '#e11d48' }}>
                        {t.type === 'income' ? 'Příjem' : 'Výdaj'}
                      </td>
                      <td style={{ padding: '8px 4px' }}>{t.category || '-'}</td>
                      <td style={{ padding: '8px 4px', wordBreak: 'break-word' }}>{t.fromWho || '-'}</td>
                      <td style={{ padding: '8px 4px', textAlign: 'right', fontWeight: 700 }}>{formatCurrency(t.amount, group.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Page 6: Direct Payments */}
          {includePayments && (
            <div className="pdf-section pdf-page-break-before" style={{ pageBreakBefore: 'always', breakBefore: 'page', paddingBottom: '32px', boxSizing: 'border-box', width: '100%' }}>
              <div className="pdf-header-container pdf-no-break" style={{ borderBottom: '2px solid #0f172a', paddingBottom: '8px', marginBottom: '24px', pageBreakInside: 'avoid', breakInside: 'avoid', pageBreakAfter: 'avoid', breakAfter: 'avoid' }}>
                <h2 className="pdf-heading" style={{ fontSize: '18px', fontWeight: 900, textTransform: 'uppercase', margin: 0, pageBreakInside: 'avoid', breakInside: 'avoid', pageBreakAfter: 'avoid', breakAfter: 'avoid' }}>Připsané platby členů ({filteredPayments.length})</h2>
                <p style={{ fontSize: '11px', fontWeight: 500, color: '#475569', margin: '4px 0 0 0' }}>Přehled jednotlivých úhrad připsaných členům</p>
              </div>

              <table style={{ width: '100%', tableLayout: 'fixed', fontSize: '11px', textAlign: 'left', borderCollapse: 'collapse', wordBreak: 'break-word', overflowWrap: 'break-word' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #0f172a', fontWeight: 700, color: '#1e293b', pageBreakInside: 'avoid', breakInside: 'avoid' }}>
                    <th style={{ padding: '8px 4px', width: '13%' }}>Datum</th>
                    <th style={{ padding: '8px 4px', width: '22%' }}>Člen</th>
                    <th style={{ padding: '8px 4px', width: '20%' }}>Způsob úhrady</th>
                    <th style={{ padding: '8px 4px', width: '18%', textAlign: 'right' }}>Částka</th>
                    <th style={{ padding: '8px 4px', width: '27%' }}>Poznámka</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPayments.map(p => (
                    <tr key={p.id} style={{ borderBottom: '1px solid #e2e8f0', pageBreakInside: 'avoid', breakInside: 'avoid' }}>
                      <td style={{ padding: '8px 4px' }}>{formatDate(p.createdAt)}</td>
                      <td style={{ padding: '8px 4px', fontWeight: 700 }}>{memberMap.get(p.memberId)?.name || 'Neznámý'}</td>
                      <td style={{ padding: '8px 4px' }}>
                        {p.paymentMethod === 'cash' ? 'Hotovost' : p.paymentMethod === 'bank' ? 'Bankovní převod' : 'Proplacený nákup'}
                      </td>
                      <td style={{ padding: '8px 4px', textAlign: 'right', fontWeight: 900, color: '#047857' }}>{formatCurrency(p.amount, group.currency)}</td>
                      <td style={{ padding: '8px 4px', color: '#475569', wordBreak: 'break-word' }}>{p.note || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Page 7: Period Statistics */}
          {includeStatistics && (
            <div className="pdf-section pdf-page-break-before" style={{ pageBreakBefore: 'always', breakBefore: 'page', paddingBottom: '32px', boxSizing: 'border-box', width: '100%' }}>
              <div className="pdf-header-container pdf-no-break" style={{ borderBottom: '2px solid #0f172a', paddingBottom: '8px', marginBottom: '24px', pageBreakInside: 'avoid', breakInside: 'avoid', pageBreakAfter: 'avoid', breakAfter: 'avoid' }}>
                <h2 className="pdf-heading" style={{ fontSize: '18px', fontWeight: 900, textTransform: 'uppercase', margin: 0, pageBreakInside: 'avoid', breakInside: 'avoid', pageBreakAfter: 'avoid', breakAfter: 'avoid' }}>Statistiky a přehledy kasy</h2>
                <p style={{ fontSize: '11px', fontWeight: 500, color: '#475569', margin: '4px 0 0 0' }}>Celkový souhrn za celé období {period.name}</p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '20px' }}>
                <div className="pdf-card" style={{ padding: '16px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', pageBreakInside: 'avoid', breakInside: 'avoid' }}>
                  <h3 className="pdf-heading pdf-no-break" style={{ fontSize: '12px', fontWeight: 900, textTransform: 'uppercase', color: '#1e293b', margin: '0 0 12px 0', pageBreakInside: 'avoid', breakInside: 'avoid', pageBreakAfter: 'avoid', breakAfter: 'avoid' }}>Top sponzoři kasy (Platby)</h3>
                  {sponsorsList.length > 0 ? (
                    <div>
                      {sponsorsList.map((s, idx) => (
                        <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #e2e8f0', paddingBottom: '4px', marginBottom: '6px', fontSize: '11px' }}>
                          <span style={{ fontWeight: 700 }}>{idx + 1}. {s.name}</span>
                          <span style={{ fontWeight: 900, color: '#047857' }}>{formatCurrency(s.total, group.currency)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p style={{ fontSize: '11px', color: '#94a3b8' }}>Zatím žádné zapsané platby</p>
                  )}
                </div>

                <div className="pdf-card" style={{ padding: '16px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', pageBreakInside: 'avoid', breakInside: 'avoid' }}>
                  <h3 className="pdf-heading pdf-no-break" style={{ fontSize: '12px', fontWeight: 900, textTransform: 'uppercase', color: '#1e293b', margin: '0 0 12px 0', pageBreakInside: 'avoid', breakInside: 'avoid', pageBreakAfter: 'avoid', breakAfter: 'avoid' }}>Největší dlužníci</h3>
                  {topDebtorsList.length > 0 ? (
                    <div>
                      {topDebtorsList.map((d, idx) => (
                        <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #e2e8f0', paddingBottom: '4px', marginBottom: '6px', fontSize: '11px' }}>
                          <span style={{ fontWeight: 700 }}>{idx + 1}. {d.name}</span>
                          <span style={{ fontWeight: 900, color: '#e11d48' }}>{formatCurrency(d.unpaidDebt, group.currency)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p style={{ fontSize: '11px', color: '#94a3b8' }}>Všichni členové mají vyrovnáno!</p>
                  )}
                </div>
              </div>

              <div className="pdf-no-break" style={{ paddingTop: '28px', marginTop: '28px', borderTop: '1px solid #cbd5e1', textAlign: 'center', fontSize: '11px', color: '#94a3b8', pageBreakInside: 'avoid', breakInside: 'avoid' }}>
                <p style={{ margin: 0 }}>Oficiální výkaz týmu {group.name} • Vygenerováno {new Date().toLocaleDateString('cs-CZ')} {new Date().toLocaleTimeString('cs-CZ')}</p>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 my-8">
        {/* Modal Header */}
        <div className="p-6 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-emerald-500/20 text-emerald-400 rounded-2xl border border-emerald-500/30">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight">Export týmových financí</h2>
              <p className="text-xs text-slate-400 font-medium">{group.name} • Přehled pokut, výdajů a bilancí</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-xl transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto custom-scrollbar">
          {loading ? (
            <div className="py-12 text-center text-slate-400 space-y-3">
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-emerald-600" />
              <p className="text-sm font-bold">Načítám finanční data týmu...</p>
            </div>
          ) : (
            <>
              {/* Period & Scope Selection */}
              <div className="space-y-3">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block px-1">Otevřené období a rozsah exportu</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-bold text-slate-600 block mb-1">Exportované období pokladny</label>
                    <div className="w-full px-3.5 py-2.5 bg-slate-100 border border-slate-200/80 rounded-xl font-bold text-slate-800 text-xs flex items-center justify-between">
                      <span className="truncate">{period.name}</span>
                      <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-700 text-[10px] font-black uppercase tracking-wider rounded-md shrink-0 border border-emerald-500/20">Aktivní období</span>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-600 block mb-1">Časové rozmezí (Volitelné)</label>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        placeholder="Od"
                        className="w-full px-2 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 text-xs"
                      />
                      <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        placeholder="Do"
                        className="w-full px-2 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 text-xs"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Member & Group Filtering */}
              <div className="space-y-3 pt-3 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block px-1">Filtr členů a skupin pro export</label>
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200/60">
                    Vybráno: {filteredMembers.length} z {members.length}
                  </span>
                </div>

                {/* Filter presets grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <button
                    type="button"
                    onClick={() => setMemberFilterType('all')}
                    className={cn(
                      "px-3 py-2 rounded-xl text-xs font-bold transition-all border text-left flex flex-col justify-between gap-1",
                      memberFilterType === 'all'
                        ? "bg-slate-900 text-white border-slate-900 shadow-sm"
                        : "bg-slate-50 text-slate-700 border-slate-200/80 hover:bg-slate-100"
                    )}
                  >
                    <span>Všichni členové</span>
                    <span className="text-[10px] opacity-70 font-semibold">{members.length} os. (vč. neaktivních)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setMemberFilterType('active')}
                    className={cn(
                      "px-3 py-2 rounded-xl text-xs font-bold transition-all border text-left flex flex-col justify-between gap-1",
                      memberFilterType === 'active'
                        ? "bg-emerald-600 text-white border-emerald-600 shadow-sm"
                        : "bg-slate-50 text-slate-700 border-slate-200/80 hover:bg-slate-100"
                    )}
                  >
                    <span>Pouze aktivní</span>
                    <span className="text-[10px] opacity-70 font-semibold">{members.filter(m => m.active !== false).length} os.</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setMemberFilterType('inactive')}
                    className={cn(
                      "px-3 py-2 rounded-xl text-xs font-bold transition-all border text-left flex flex-col justify-between gap-1",
                      memberFilterType === 'inactive'
                        ? "bg-rose-600 text-white border-rose-600 shadow-sm"
                        : "bg-slate-50 text-slate-700 border-slate-200/80 hover:bg-slate-100"
                    )}
                  >
                    <span>Pouze neaktivní</span>
                    <span className="text-[10px] opacity-70 font-semibold">{members.filter(m => m.active === false).length} os.</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setMemberFilterType('debt')}
                    className={cn(
                      "px-3 py-2 rounded-xl text-xs font-bold transition-all border text-left flex flex-col justify-between gap-1",
                      memberFilterType === 'debt'
                        ? "bg-amber-600 text-white border-amber-600 shadow-sm"
                        : "bg-slate-50 text-slate-700 border-slate-200/80 hover:bg-slate-100"
                    )}
                  >
                    <span>Členové s dluhem</span>
                    <span className="text-[10px] opacity-70 font-semibold">
                      {Array.from(allMemberBalancesMap.values()).filter(b => b.unpaidDebt > 0).length} os.
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setMemberFilterType('overpaid')}
                    className={cn(
                      "px-3 py-2 rounded-xl text-xs font-bold transition-all border text-left flex flex-col justify-between gap-1",
                      memberFilterType === 'overpaid'
                        ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                        : "bg-slate-50 text-slate-700 border-slate-200/80 hover:bg-slate-100"
                    )}
                  >
                    <span>S přeplatkem</span>
                    <span className="text-[10px] opacity-70 font-semibold">
                      {Array.from(allMemberBalancesMap.values()).filter(b => b.overpayment > 0).length} os.
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setMemberFilterType('settled')}
                    className={cn(
                      "px-3 py-2 rounded-xl text-xs font-bold transition-all border text-left flex flex-col justify-between gap-1",
                      memberFilterType === 'settled'
                        ? "bg-teal-600 text-white border-teal-600 shadow-sm"
                        : "bg-slate-50 text-slate-700 border-slate-200/80 hover:bg-slate-100"
                    )}
                  >
                    <span>Vyrovnaní</span>
                    <span className="text-[10px] opacity-70 font-semibold">
                      {Array.from(allMemberBalancesMap.values()).filter(b => b.isSettled).length} os.
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setMemberFilterType('groups')}
                    className={cn(
                      "px-3 py-2 rounded-xl text-xs font-bold transition-all border text-left flex flex-col justify-between gap-1",
                      memberFilterType === 'groups'
                        ? "bg-purple-600 text-white border-purple-600 shadow-sm"
                        : "bg-slate-50 text-slate-700 border-slate-200/80 hover:bg-slate-100"
                    )}
                  >
                    <span>Skupiny členů</span>
                    <span className="text-[10px] opacity-70 font-semibold">{memberGroups.length} skupin</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setMemberFilterType('custom');
                      if (selectedCustomMemberIds.length === 0) {
                        setSelectedCustomMemberIds(members.map(m => m.id));
                      }
                    }}
                    className={cn(
                      "px-3 py-2 rounded-xl text-xs font-bold transition-all border text-left flex flex-col justify-between gap-1",
                      memberFilterType === 'custom'
                        ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                        : "bg-slate-50 text-slate-700 border-slate-200/80 hover:bg-slate-100"
                    )}
                  >
                    <span>Vlastní výběr</span>
                    <span className="text-[10px] opacity-70 font-semibold">
                      {selectedCustomMemberIds.length > 0 ? `${selectedCustomMemberIds.length} vybráno` : 'Ruční seznam'}
                    </span>
                  </button>
                </div>

                {/* Sub-panel for Groups */}
                {memberFilterType === 'groups' && (
                  <div className="p-3.5 bg-purple-50/60 border border-purple-200/70 rounded-2xl space-y-2.5">
                    <p className="text-xs font-bold text-purple-900">Vyberte skupiny pro export:</p>
                    {memberGroups.length > 0 ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {memberGroups.map(mg => {
                          const isSelected = selectedGroupIds.includes(mg.id);
                          return (
                            <label
                              key={mg.id}
                              className={cn(
                                "flex items-center justify-between p-2.5 rounded-xl border cursor-pointer transition-all text-xs font-bold",
                                isSelected
                                  ? "bg-purple-600 text-white border-purple-600"
                                  : "bg-white text-slate-800 border-purple-200 hover:border-purple-400"
                              )}
                            >
                              <div className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => {
                                    if (isSelected) {
                                      setSelectedGroupIds(selectedGroupIds.filter(id => id !== mg.id));
                                    } else {
                                      setSelectedGroupIds([...selectedGroupIds, mg.id]);
                                    }
                                  }}
                                  className="rounded text-purple-600 focus:ring-purple-500"
                                />
                                <span>{mg.name}</span>
                              </div>
                              <span className={cn("text-[10px] px-1.5 py-0.5 rounded-md", isSelected ? "bg-purple-700 text-purple-100" : "bg-purple-100 text-purple-700")}>
                                {mg.memberIds?.length || 0} členů
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-purple-700 font-medium italic">
                        V tomto období zatím nemáte vytvořené žádné skupiny členů. Zvolte standardní filtr nebo Vlastní výběr.
                      </p>
                    )}
                  </div>
                )}

                {/* Sub-panel for Custom Member Selection */}
                {memberFilterType === 'custom' && (
                  <div className="p-3.5 bg-blue-50/60 border border-blue-200/70 rounded-2xl space-y-3">
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
                      <div className="relative flex-1">
                        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                        <input
                          type="text"
                          value={memberSearchTerm}
                          onChange={(e) => setMemberSearchTerm(e.target.value)}
                          placeholder="Hledat člena jménem..."
                          className="w-full pl-8 pr-3 py-1.5 bg-white border border-blue-200 rounded-xl text-xs text-slate-800 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        />
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => setSelectedCustomMemberIds(members.map(m => m.id))}
                          className="px-2.5 py-1 bg-white hover:bg-blue-100 text-blue-700 text-[11px] font-bold rounded-lg border border-blue-200 transition-all"
                        >
                          Vybrat vše
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedCustomMemberIds([])}
                          className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-600 text-[11px] font-bold rounded-lg border border-slate-200 transition-all"
                        >
                          Zrušit vše
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedCustomMemberIds(members.filter(m => m.active !== false).map(m => m.id))}
                          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold rounded-lg transition-all"
                        >
                          Jen aktivní
                        </button>
                      </div>
                    </div>

                    <div className="max-h-48 overflow-y-auto pr-1 space-y-1.5 custom-scrollbar">
                      {members
                        .filter(m => m.name.toLowerCase().includes(memberSearchTerm.toLowerCase()))
                        .map(m => {
                          const isChecked = selectedCustomMemberIds.includes(m.id);
                          const isActive = m.active !== false;
                          const bal = allMemberBalancesMap.get(m.id);
                          return (
                            <label
                              key={m.id}
                              className={cn(
                                "flex items-center justify-between p-2 rounded-xl border cursor-pointer transition-all text-xs",
                                isChecked
                                  ? "bg-white border-blue-400 shadow-2xs"
                                  : "bg-white/60 border-slate-200 opacity-60 hover:opacity-100"
                              )}
                            >
                              <div className="flex items-center gap-2.5">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => {
                                    if (isChecked) {
                                      setSelectedCustomMemberIds(selectedCustomMemberIds.filter(id => id !== m.id));
                                    } else {
                                      setSelectedCustomMemberIds([...selectedCustomMemberIds, m.id]);
                                    }
                                  }}
                                  className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                                />
                                <span className="font-bold text-slate-800">{m.name}</span>
                                <span className={cn(
                                  "px-1.5 py-0.2 rounded text-[10px] font-bold",
                                  isActive ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"
                                )}>
                                  {isActive ? 'Aktivní' : 'Neaktivní'}
                                </span>
                              </div>
                              {bal && (
                                <span className="text-[10px] font-bold text-slate-500">
                                  {bal.status}
                                </span>
                              )}
                            </label>
                          );
                        })}
                    </div>
                  </div>
                )}

                {/* Filter Summary Banner */}
                <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-2xl flex items-center justify-between text-xs text-slate-600 font-medium">
                  <div className="flex items-center gap-2">
                    <Filter className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>
                      Export bude obsahovat data pro <strong className="text-slate-900">{filteredMembers.length} členů</strong> ({activeCountInFiltered} aktivních, {inactiveCountInFiltered} neaktivních).
                    </span>
                  </div>
                </div>
              </div>

              {/* Data checklist */}
              <div className="space-y-3 pt-2 border-t border-slate-100">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block px-1">Obsah k exportu (Každá sekce na vlastní stránce v PDF)</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <label className="flex items-center gap-3 p-3 rounded-2xl bg-slate-50 border border-slate-200/80 cursor-pointer hover:border-emerald-300 transition-all">
                    <input
                      type="checkbox"
                      checked={includeMemberBalances}
                      onChange={(e) => setIncludeMemberBalances(e.target.checked)}
                      className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500"
                    />
                    <div>
                      <p className="text-xs font-bold text-slate-800">Bilance členů a přeplatky ({members.length})</p>
                      <p className="text-[10px] text-slate-500 font-medium">Přehled dluhů i přeplatků členů</p>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 p-3 rounded-2xl bg-slate-50 border border-slate-200/80 cursor-pointer hover:border-emerald-300 transition-all">
                    <input
                      type="checkbox"
                      checked={includeGoalsAndEnvelopes}
                      onChange={(e) => setIncludeGoalsAndEnvelopes(e.target.checked)}
                      className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500"
                    />
                    <div>
                      <p className="text-xs font-bold text-slate-800">Cíle a obálky kasy ({goals.length + envelopes.length})</p>
                      <p className="text-[10px] text-slate-500 font-medium">Finanční cíle a rozdělení v obálkách</p>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 p-3 rounded-2xl bg-slate-50 border border-slate-200/80 cursor-pointer hover:border-emerald-300 transition-all">
                    <input
                      type="checkbox"
                      checked={includeFines}
                      onChange={(e) => setIncludeFines(e.target.checked)}
                      className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500"
                    />
                    <div>
                      <p className="text-xs font-bold text-slate-800">Historie pokut ({filteredFines.length})</p>
                      <p className="text-[10px] text-slate-500 font-medium">Ruční i automatické pokuty s detaily</p>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 p-3 rounded-2xl bg-slate-50 border border-slate-200/80 cursor-pointer hover:border-emerald-300 transition-all">
                    <input
                      type="checkbox"
                      checked={includeTransactions}
                      onChange={(e) => setIncludeTransactions(e.target.checked)}
                      className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500"
                    />
                    <div>
                      <p className="text-xs font-bold text-slate-800">Pokladna a výdaje ({filteredTransactions.length})</p>
                      <p className="text-[10px] text-slate-500 font-medium">Příjmy, výdaje a kategorie pokladny</p>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 p-3 rounded-2xl bg-slate-50 border border-slate-200/80 cursor-pointer hover:border-emerald-300 transition-all">
                    <input
                      type="checkbox"
                      checked={includePayments}
                      onChange={(e) => setIncludePayments(e.target.checked)}
                      className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500"
                    />
                    <div>
                      <p className="text-xs font-bold text-slate-800">Připsané platby ({filteredPayments.length})</p>
                      <p className="text-[10px] text-slate-500 font-medium">Úhrady členů na účet / v hotovosti</p>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 p-3 rounded-2xl bg-slate-50 border border-slate-200/80 cursor-pointer hover:border-emerald-300 transition-all">
                    <input
                      type="checkbox"
                      checked={includeStatistics}
                      onChange={(e) => setIncludeStatistics(e.target.checked)}
                      className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500"
                    />
                    <div>
                      <p className="text-xs font-bold text-slate-800">Statistiky a přehledy kasy</p>
                      <p className="text-[10px] text-slate-500 font-medium">Sponzoři, dlužníci, prohřešky za celé období</p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Data Summary Quick Metrics */}
              <div className="p-4 bg-emerald-50/60 border border-emerald-100 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase tracking-widest text-emerald-800">Klíčové týmové metiky</p>
                  <span className="text-[11px] font-bold text-emerald-700">{getCurrencySymbol(group.currency)}</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                  <div className="p-2 bg-white/80 rounded-xl border border-emerald-100">
                    <p className="text-[9px] font-bold uppercase text-slate-400">Suma pokut</p>
                    <p className="text-sm font-black text-slate-800">{formatCurrency(totalFinesAmount, group.currency)}</p>
                  </div>
                  <div className="p-2 bg-white/80 rounded-xl border border-emerald-100">
                    <p className="text-[9px] font-bold uppercase text-slate-400">Uhrazeno</p>
                    <p className="text-sm font-black text-emerald-700">{formatCurrency(totalFinesPaid, group.currency)}</p>
                  </div>
                  <div className="p-2 bg-white/80 rounded-xl border border-emerald-100">
                    <p className="text-[9px] font-bold uppercase text-slate-400">Zbývající dluh</p>
                    <p className="text-sm font-black text-rose-600">{formatCurrency(totalUnpaidFines, group.currency)}</p>
                  </div>
                  <div className="p-2 bg-white/80 rounded-xl border border-emerald-100">
                    <p className="text-[9px] font-bold uppercase text-slate-400">Přeplatky</p>
                    <p className="text-sm font-black text-indigo-600">{formatCurrency(totalOverpayments, group.currency)}</p>
                  </div>
                </div>
              </div>

              {/* Bank & QR inclusion note */}
              {(group.bankAccount || group.bankQrCodeUrl) && (
                <div className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-2xl flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold shrink-0">
                      <QrCode className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="font-bold text-slate-800 flex items-center gap-1.5">
                        <span>Bankovní spojení & QR platba</span>
                        {group.bankQrCodeUrl && (
                          <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-800 text-[10px] font-extrabold rounded">Fotka QR kódu aktivní</span>
                        )}
                      </p>
                      <p className="text-[11px] text-slate-500 font-medium">
                        {group.bankAccount ? `Účet: ${group.bankAccount}` : 'Bankovní spojení'}
                        {group.bankQrCodeUrl ? ' • Velký skenovatelný QR kód bude vložen do PDF' : ''}
                      </p>
                    </div>
                  </div>
                  {group.bankQrCodeUrl && (
                    <img 
                      src={group.bankQrCodeUrl} 
                      alt="QR kód" 
                      className="w-10 h-10 object-contain rounded-lg border border-slate-200 bg-white shrink-0 p-0.5" 
                    />
                  )}
                </div>
              )}

              {/* Export Action Buttons */}
              <div className="pt-2 border-t border-slate-100 space-y-3">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block px-1">Vyberte akci / formát exportu</label>

                {/* Primary PDF Preview CTA */}
                <button
                  onClick={() => setIsPreviewOpen(true)}
                  className="w-full p-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-bold text-sm flex items-center justify-between shadow-xl shadow-indigo-600/20 transition-all active:scale-98 group"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-white/10 rounded-xl">
                      <Sparkles className="w-5 h-5 text-indigo-200" />
                    </div>
                    <div className="text-left">
                      <p className="font-extrabold leading-none">Náhled PDF výkazu před stažením</p>
                      <p className="text-[11px] font-medium text-indigo-200 mt-1">Zkontrolujte formát A4, rozložení dat a strany</p>
                    </div>
                  </div>
                  <span className="px-3 py-1 bg-white/15 text-white text-[10px] font-black uppercase tracking-widest rounded-lg group-hover:bg-white group-hover:text-indigo-700 transition-colors">
                    Zobrazit náhled
                  </span>
                </button>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                  <button
                    onClick={handleDownloadPDF}
                    disabled={isGeneratingPdf}
                    className="p-3 bg-rose-600 hover:bg-rose-700 text-white rounded-2xl font-bold text-xs flex items-center justify-center gap-2 shadow-md shadow-rose-600/15 transition-all active:scale-95 disabled:opacity-50"
                  >
                    {isGeneratingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                    <span>Stáhnout PDF přímo</span>
                  </button>

                  <button
                    onClick={handleExportExcel}
                    className="p-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold text-xs flex items-center justify-center gap-2 shadow-md shadow-emerald-600/15 transition-all active:scale-95"
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                    <span>MS Excel (.xlsx)</span>
                  </button>

                  <button
                    onClick={handleExportCSV}
                    className="p-3 bg-slate-800 hover:bg-slate-900 text-white rounded-2xl font-bold text-xs flex items-center justify-center gap-2 shadow-md shadow-slate-900/15 transition-all active:scale-95"
                  >
                    <Download className="w-4 h-4" />
                    <span>CSV (.csv)</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* PDF PREVIEW MODAL OVERLAY */}
      {isPreviewOpen && (
        <div className="fixed inset-0 z-[70] bg-slate-950/90 backdrop-blur-md flex flex-col p-2 sm:p-4 md:p-6 animate-in fade-in duration-200">
          {/* Preview Modal Header */}
          <div className="bg-slate-900 text-white px-5 py-3.5 rounded-2xl flex flex-wrap items-center justify-between gap-4 border border-slate-800 shadow-2xl mb-3 shrink-0">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-indigo-500/20 text-indigo-400 rounded-xl border border-indigo-500/30">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm sm:text-base font-black leading-tight text-white flex items-center gap-2">
                  <span>Náhled PDF výkazu před stažením</span>
                  <span className="px-2 py-0.5 bg-indigo-500/20 text-indigo-300 text-[10px] font-black uppercase tracking-wider rounded border border-indigo-500/30">Formát A4</span>
                </h3>
                <p className="text-[11px] text-slate-400 font-medium hidden sm:block">Zkontrolujte přesné rozložení dat na formát A4 před finálním vygenerováním dokumentu</p>
              </div>
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <button
                onClick={() => {
                  const printContent = document.getElementById('pdf-report-content');
                  if (!printContent) return;
                  const printWin = window.open('', '_blank');
                  if (!printWin) return;
                  printWin.document.write(`
                    <!DOCTYPE html>
                    <html>
                      <head>
                        <title>Finanční výkaz - ${group.name}</title>
                        <style>
                          body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #fff; color: #0f172a; }
                          @page { size: A4 portrait; margin: 10mm; }
                          table { width: 100%; border-collapse: collapse; page-break-inside: avoid; }
                        </style>
                      </head>
                      <body>${printContent.innerHTML}</body>
                    </html>
                  `);
                  printWin.document.close();
                  printWin.focus();
                  setTimeout(() => {
                    printWin.print();
                    printWin.close();
                  }, 250);
                }}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all active:scale-95 border border-slate-700"
              >
                <span>Vytisknout</span>
              </button>

              <button
                onClick={handleDownloadPDF}
                disabled={isGeneratingPdf}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-black flex items-center gap-2 shadow-lg shadow-rose-600/30 transition-all active:scale-95 disabled:opacity-50"
              >
                {isGeneratingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                <span>Stáhnout PDF</span>
              </button>

              <button
                onClick={() => setIsPreviewOpen(false)}
                className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-xl transition-all"
                title="Zavřít náhled"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Scrollable A4 Paper Preview Sheet */}
          <div className="flex-1 overflow-y-auto p-2 sm:p-6 bg-slate-900/80 rounded-2xl flex flex-col items-center custom-scrollbar">
            <div className="w-full max-w-[680px] bg-white text-slate-900 shadow-2xl rounded-sm p-6 sm:p-8 border border-slate-200 my-2 relative">
              <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-200 text-slate-400 text-[10px] font-black uppercase tracking-widest">
                <span>Dokument: {group.name} • {period.name}</span>
                <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded">Náhled A4 v pořádku</span>
              </div>

              {/* Rendered PDF report DOM preview */}
              <div 
                dangerouslySetInnerHTML={{ 
                  __html: document.getElementById('pdf-report-content')?.innerHTML || '' 
                }} 
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
