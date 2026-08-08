import React, { useState, useEffect } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { Group, Period, Member, Fine, Transaction, Payment, Goal, Envelope } from '../types';
import { formatCurrency, getCurrencySymbol, formatDate, cn } from '../utils';
import { X, FileSpreadsheet, Download, Loader2, Calendar, Target, Folder, Award, Users, ReceiptText, Wallet, Check, Copy, Flame, PieChart, Sparkles, AlertTriangle } from 'lucide-react';
import * as XLSX from 'xlsx';
import html2pdf from 'html2pdf.js';

interface ExportFinanceModalProps {
  group: Group;
  period: Period;
  isOpen: boolean;
  onClose: () => void;
}

export default function ExportFinanceModal({ group, period, isOpen, onClose }: ExportFinanceModalProps) {
  const [members, setMembers] = useState<Member[]>([]);
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

    // Load Members strictly for this period & group (only active, non-deleted)
    const membersPath = `groups/${group.id}/periods/${period.id}/members`;
    const unsubMembers = onSnapshot(collection(db, membersPath), (snap) => {
      const activeMembers = (snap.docs.map(d => ({ id: d.id, ...d.data() })) as Member[])
        .filter(m => m.active !== false && !(m as any).isDeleted && !(m as any).deleted);
      setMembers(activeMembers);
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
      unsubFines();
      unsubTx();
      unsubPay();
      unsubGoals();
      unsubEnv();
    };
  }, [isOpen, group.id, period.id]);

  if (!isOpen) return null;

  // Filtered dataset according to optional date filters and active members
  const memberMap = new Map<string, string>();
  members.forEach(m => memberMap.set(m.id, m.name));
  const activeMemberIds = new Set(members.map(m => m.id));

  const filterByDate = (createdAt: number) => {
    if (!startDate && !endDate) return true;
    const itemDateStr = new Date(createdAt).toISOString().split('T')[0];
    if (startDate && itemDateStr < startDate) return false;
    if (endDate && itemDateStr > endDate) return false;
    return true;
  };

  const filteredFines = fines
    .filter(f => activeMemberIds.has(f.memberId) && filterByDate(f.createdAt))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const filteredTransactions = transactions
    .filter(t => filterByDate(t.createdAt))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const filteredPayments = payments
    .filter(p => activeMemberIds.has(p.memberId) && filterByDate(p.createdAt))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const sortedGoals = [...goals].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const sortedEnvelopes = [...envelopes].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  // Compute Member Balances with Explicit Overpayments based strictly on total fines vs total payments (matching DebtList)
  const memberBalances = members.map(m => {
    const mFines = filteredFines.filter(f => f.memberId === m.id);
    const mPayments = filteredPayments.filter(p => p.memberId === m.id);

    const totalFines = mFines.reduce((acc, f) => acc + (f.amount || 0), 0);
    const totalPayments = mPayments.reduce((acc, p) => acc + (p.amount || 0), 0);

    const unpaidDebt = Math.max(0, totalFines - totalPayments);
    const overpayment = Math.max(0, totalPayments - totalFines);

    let status = 'Vyrovnáno';
    if (unpaidDebt > 0) {
      status = `Dluh: ${formatCurrency(unpaidDebt, group.currency)}`;
    } else if (overpayment > 0) {
      status = `Přeplatek: +${formatCurrency(overpayment, group.currency)}`;
    }

    return {
      id: m.id,
      name: m.name,
      totalFines,
      totalPaid: totalPayments,
      unpaidDebt,
      overpayment,
      status
    };
  }).sort((a, b) => b.unpaidDebt - a.unpaidDebt || b.overpayment - a.overpayment);

  // Financial summary metrics
  const totalFinesAmount = filteredFines.reduce((sum, f) => sum + f.amount, 0);
  const totalFinesPaid = filteredFines.reduce((sum, f) => sum + (f.paidAmount || (f.paid ? f.amount : 0)), 0);
  const totalUnpaidFines = memberBalances.reduce((sum, m) => sum + m.unpaidDebt, 0);
  const totalOverpayments = memberBalances.reduce((sum, m) => sum + m.overpayment, 0);

  const totalIncome = filteredTransactions
    .filter(t => t.type === 'income')
    .reduce((sum, t) => sum + t.amount, 0);

  const totalExpense = filteredTransactions
    .filter(t => t.type === 'expense')
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);

  const cashboxBalance = totalIncome - totalExpense;

  // PERIOD UNFILTERED STATISTICS (Ignoring date range as explicitly required)
  const unfilteredMemberMap = new Map<string, string>();
  members.forEach(m => unfilteredMemberMap.set(m.id, m.name));

  // 1. Sponzoři (Top přispěvatelé za celé období)
  const sponsorsList = members.map(m => {
    const totalPaymentsMade = payments.filter(p => p.memberId === m.id).reduce((s, p) => s + (p.amount || 0), 0);
    return { name: m.name, total: totalPaymentsMade };
  }).filter(s => s.total > 0).sort((a, b) => b.total - a.total).slice(0, 5);

  // 2. Největší dlužníci za celé období
  const topDebtorsList = memberBalances
    .filter(m => m.unpaidDebt > 0)
    .sort((a, b) => b.unpaidDebt - a.unpaidDebt)
    .slice(0, 5);

  // 3. Nejčastější prohřešky za celé období
  const reasonCounts = new Map<string, { count: number; totalAmount: number }>();
  fines.forEach(f => {
    const key = f.reason.trim() || 'Nespecifikovaný důvod';
    const curr = reasonCounts.get(key) || { count: 0, totalAmount: 0 };
    reasonCounts.set(key, { count: curr.count + 1, totalAmount: curr.totalAmount + f.amount });
  });
  const topViolationsList = Array.from(reasonCounts.entries())
    .map(([reason, stat]) => ({ reason, count: stat.count, totalAmount: stat.totalAmount }))
    .sort((a, b) => b.count - a.count)
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
    if (includeGoalsAndEnvelopes && (goals.length > 0 || envelopes.length > 0)) {
      const goalsData = goals.map(g => ({
        'Druh': 'Finanční cíl',
        'Název': g.name,
        [`Cílová částka (${currSymbol})`]: g.targetAmount,
        'Priorita': g.priority,
        'Stav': g.completed ? 'Splněno' : 'Probíhá'
      }));
      const envData = envelopes.map(e => ({
        'Druh': 'Obálka pokladny',
        'Název': e.name,
        [`Aktuální zůstatek (${currSymbol})`]: e.amount,
        [`Cílová částka (${currSymbol})`]: e.targetAmount || '-',
        'Poznámka': e.note || '-'
      }));
      const wsGoals = XLSX.utils.json_to_sheet([...goalsData, ...envData]);
      XLSX.utils.book_append_sheet(workbook, wsGoals, 'Cíle a obálky');
    }

    // Sheet 3: Bilance členů (with overpayments)
    if (includeMemberBalances && memberBalances.length > 0) {
      const balData = memberBalances.map(m => ({
        'Člen': m.name,
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
        return {
          'Datum': formatDate(f.createdAt),
          'Člen': memberMap.get(f.memberId) || 'Neznámý',
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
      const payData = filteredPayments.map(p => ({
        'Datum': formatDate(p.createdAt),
        'Člen': memberMap.get(p.memberId) || 'Neznámý',
        [`Částka (${currSymbol})`]: p.amount,
        'Způsob úhrady': p.paymentMethod === 'cash' ? 'Hotovost' : p.paymentMethod === 'bank' ? 'Bankovní převod' : 'Proplacený nákup',
        'Poznámka': p.note || '-'
      }));
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
        csvContent += `"${formatDate(f.createdAt)}";"${memberMap.get(f.memberId) || ''}";"${f.reason.replace(/"/g, '""')}";"${f.amount}";"${f.paidAmount || (f.paid ? f.amount : 0)}";"${status}";"${f.recurringFineId ? 'Automatická' : 'Ruční'}"\n`;
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
          logging: false
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] }
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
          {/* Page 1: Title & Overview */}
          <div style={{ pageBreakAfter: 'always', breakAfter: 'page', paddingBottom: '24px', boxSizing: 'border-box', width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #0f172a', paddingBottom: '12px', marginBottom: '20px' }}>
              <div style={{ width: '65%' }}>
                <h1 style={{ fontSize: '20px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-0.025em', margin: 0, color: '#0f172a', wordBreak: 'break-word' }}>{group.name}</h1>
                <p style={{ fontSize: '12px', fontWeight: 700, color: '#334155', margin: '3px 0 0 0' }}>Oficiální finanční výkaz a zpráva o pokutách</p>
                <p style={{ fontSize: '11px', fontWeight: 600, color: '#4338ca', margin: '3px 0 0 0' }}>Období: {period.name}</p>
                <p style={{ fontSize: '10px', color: '#64748b', margin: '2px 0 0 0' }}>Časové rozmezí: {dateRangeLabel}</p>
              </div>
              <div style={{ textAlign: 'right', width: '35%' }}>
                <p style={{ fontSize: '10px', fontWeight: 700, color: '#64748b', margin: 0 }}>Datum vyhotovení:</p>
                <p style={{ fontSize: '12px', fontWeight: 900, color: '#0f172a', margin: '2px 0 0 0' }}>{new Date().toLocaleDateString('cs-CZ')}</p>
              </div>
            </div>

            <div style={{ marginTop: '12px' }}>
              <h2 style={{ fontSize: '14px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#1e293b', borderBottom: '1px solid #e2e8f0', paddingBottom: '6px', marginBottom: '12px' }}>Souhrnný přehled hospodaření</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px', padding: '12px', backgroundColor: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0', boxSizing: 'border-box', width: '100%' }}>
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

              <div style={{ marginTop: '14px', padding: '14px', backgroundColor: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxSizing: 'border-box', width: '100%' }}>
                <div>
                  <p style={{ fontSize: '10px', fontWeight: 700, color: '#312e81', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>Aktuální čistý zůstatek v pokladně</p>
                  <p style={{ fontSize: '20px', fontWeight: 900, color: '#4338ca', margin: '3px 0 0 0' }}>{formatCurrency(cashboxBalance, group.currency)}</p>
                </div>
                {group.bankAccount && (
                  <div style={{ textAlign: 'right', fontSize: '10px' }}>
                    <p style={{ fontWeight: 700, color: '#334155', margin: 0 }}>Bankovní spojení kasy:</p>
                    <p style={{ fontFamily: 'monospace', fontWeight: 700, color: '#0f172a', margin: '2px 0 0 0' }}>{group.bankAccount}</p>
                    {group.bankVS && <p style={{ fontSize: '9px', color: '#475569', margin: '2px 0 0 0' }}>VS: {group.bankVS}</p>}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Page 2: Goals & Envelopes */}
          {includeGoalsAndEnvelopes && (goals.length > 0 || envelopes.length > 0) && (
            <div style={{ pageBreakAfter: 'always', breakAfter: 'page', paddingBottom: '32px', boxSizing: 'border-box', width: '100%' }}>
              <div style={{ borderBottom: '2px solid #0f172a', paddingBottom: '8px', marginBottom: '24px' }}>
                <h2 style={{ fontSize: '18px', fontWeight: 900, textTransform: 'uppercase', margin: 0 }}>Finanční cíle a obálky kasy</h2>
                <p style={{ fontSize: '11px', fontWeight: 500, color: '#475569', margin: '4px 0 0 0' }}>Plány a rozdělení prostředků v období {period.name}</p>
              </div>

              {goals.length > 0 && (
                <div style={{ marginBottom: '28px' }}>
                  <h3 style={{ fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', color: '#1e293b', borderBottom: '1px solid #cbd5e1', paddingBottom: '4px', marginBottom: '12px' }}>
                    Finanční cíle ({goals.length})
                  </h3>
                  <table style={{ width: '100%', tableLayout: 'fixed', fontSize: '11px', textAlign: 'left', borderCollapse: 'collapse', wordBreak: 'break-word', overflowWrap: 'break-word' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #cbd5e1', fontWeight: 700, color: '#334155' }}>
                        <th style={{ padding: '8px 4px', width: '25%' }}>Název cíle</th>
                        <th style={{ padding: '8px 4px', width: '15%', textAlign: 'right' }}>Cílová částka</th>
                        <th style={{ padding: '8px 4px', width: '25%', textAlign: 'right' }}>Splněno (aktuálně)</th>
                        <th style={{ padding: '8px 4px', width: '23%', textAlign: 'left' }}>Zdroj krytí</th>
                        <th style={{ padding: '8px 4px', width: '12%', textAlign: 'center' }}>Stav</th>
                      </tr>
                    </thead>
                    <tbody>
                      {goals.map(g => {
                        const totalEnvelopesAllocated = envelopes.reduce((acc, env) => acc + (env.amount || 0), 0);
                        const availableCashOutsideEnvelopes = Math.max(0, cashboxBalance - totalEnvelopesAllocated);
                        const isTotalCashbox = g.goalCalcSource === 'total_cashbox';
                        const sourceLabel = isTotalCashbox ? 'Celková hotovost' : 'Dostupná hotovost';
                        const currentSourceAmount = isTotalCashbox ? cashboxBalance : availableCashOutsideEnvelopes;
                        const currentSavedVal = g.completed ? g.targetAmount : Math.max(0, currentSourceAmount);
                        const clampedSaved = Math.min(g.targetAmount, currentSavedVal);
                        const pct = Math.min(100, Math.round((clampedSaved / g.targetAmount) * 100));

                        return (
                          <tr key={g.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
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

              {envelopes.length > 0 && (
                <div>
                  <h3 style={{ fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', color: '#1e293b', borderBottom: '1px solid #cbd5e1', paddingBottom: '4px', marginBottom: '12px' }}>
                    Rozdělení obálek kasy ({envelopes.length})
                  </h3>
                  <table style={{ width: '100%', tableLayout: 'fixed', fontSize: '11px', textAlign: 'left', borderCollapse: 'collapse', wordBreak: 'break-word', overflowWrap: 'break-word' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #cbd5e1', fontWeight: 700, color: '#334155' }}>
                        <th style={{ padding: '8px 4px', width: '30%' }}>Název obálky</th>
                        <th style={{ padding: '8px 4px', width: '20%', textAlign: 'right' }}>Vyhrazená částka</th>
                        <th style={{ padding: '8px 4px', width: '20%', textAlign: 'right' }}>Cílová částka</th>
                        <th style={{ padding: '8px 4px', width: '30%' }}>Poznámka</th>
                      </tr>
                    </thead>
                    <tbody>
                      {envelopes.map(e => (
                        <tr key={e.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
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
            <div style={{ pageBreakAfter: 'always', breakAfter: 'page', paddingBottom: '32px', boxSizing: 'border-box', width: '100%' }}>
              <div style={{ borderBottom: '2px solid #0f172a', paddingBottom: '8px', marginBottom: '24px' }}>
                <h2 style={{ fontSize: '18px', fontWeight: 900, textTransform: 'uppercase', margin: 0 }}>Bilance a stav členů</h2>
                <p style={{ fontSize: '11px', fontWeight: 500, color: '#475569', margin: '4px 0 0 0' }}>Kompletní přehled zaplacených pokut, dluhů a přeplatků</p>
              </div>

              <table style={{ width: '100%', tableLayout: 'fixed', fontSize: '11px', textAlign: 'left', borderCollapse: 'collapse', wordBreak: 'break-word', overflowWrap: 'break-word' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #0f172a', fontWeight: 700, color: '#1e293b' }}>
                    <th style={{ padding: '8px 4px', width: '24%' }}>Člen týmu</th>
                    <th style={{ padding: '8px 4px', width: '15%', textAlign: 'right' }}>Suma pokut</th>
                    <th style={{ padding: '8px 4px', width: '15%', textAlign: 'right' }}>Celkem uhradil</th>
                    <th style={{ padding: '8px 4px', width: '16%', textAlign: 'right' }}>Aktuální dluh</th>
                    <th style={{ padding: '8px 4px', width: '16%', textAlign: 'right' }}>Přeplatek</th>
                    <th style={{ padding: '8px 4px', width: '14%', textAlign: 'center' }}>Stav</th>
                  </tr>
                </thead>
                <tbody>
                  {memberBalances.map(m => (
                    <tr key={m.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                      <td style={{ padding: '8px 4px', fontWeight: 700, color: '#0f172a' }}>{m.name}</td>
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
            </div>
          )}

          {/* Page 4: Fines History */}
          {includeFines && (
            <div style={{ pageBreakAfter: 'always', breakAfter: 'page', paddingBottom: '32px', boxSizing: 'border-box', width: '100%' }}>
              <div style={{ borderBottom: '2px solid #0f172a', paddingBottom: '8px', marginBottom: '24px' }}>
                <h2 style={{ fontSize: '18px', fontWeight: 900, textTransform: 'uppercase', margin: 0 }}>Historie pokut ({filteredFines.length})</h2>
                <p style={{ fontSize: '11px', fontWeight: 500, color: '#475569', margin: '4px 0 0 0' }}>Detailní přehled předepsaných pokut v období</p>
              </div>

              <table style={{ width: '100%', tableLayout: 'fixed', fontSize: '11px', textAlign: 'left', borderCollapse: 'collapse', wordBreak: 'break-word', overflowWrap: 'break-word' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #0f172a', fontWeight: 700, color: '#1e293b' }}>
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
                      <tr key={f.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                        <td style={{ padding: '8px 4px' }}>{formatDate(f.createdAt)}</td>
                        <td style={{ padding: '8px 4px', fontWeight: 700 }}>{memberMap.get(f.memberId) || 'Neznámý'}</td>
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
            <div style={{ pageBreakAfter: 'always', breakAfter: 'page', paddingBottom: '32px', boxSizing: 'border-box', width: '100%' }}>
              <div style={{ borderBottom: '2px solid #0f172a', paddingBottom: '8px', marginBottom: '24px' }}>
                <h2 style={{ fontSize: '18px', fontWeight: 900, textTransform: 'uppercase', margin: 0 }}>Pokladna a výdaje ({filteredTransactions.length})</h2>
                <p style={{ fontSize: '11px', fontWeight: 500, color: '#475569', margin: '4px 0 0 0' }}>Přehled pohybů na pokladně kasy</p>
              </div>

              <table style={{ width: '100%', tableLayout: 'fixed', fontSize: '11px', textAlign: 'left', borderCollapse: 'collapse', wordBreak: 'break-word', overflowWrap: 'break-word' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #0f172a', fontWeight: 700, color: '#1e293b' }}>
                    <th style={{ padding: '8px 4px', width: '13%' }}>Datum</th>
                    <th style={{ padding: '8px 4px', width: '12%' }}>Typ</th>
                    <th style={{ padding: '8px 4px', width: '22%' }}>Kategorie</th>
                    <th style={{ padding: '8px 4px', width: '35%' }}>Od/Komu</th>
                    <th style={{ padding: '8px 4px', width: '18%', textAlign: 'right' }}>Částka</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTransactions.map(t => (
                    <tr key={t.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
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
            <div style={{ pageBreakAfter: 'always', breakAfter: 'page', paddingBottom: '32px', boxSizing: 'border-box', width: '100%' }}>
              <div style={{ borderBottom: '2px solid #0f172a', paddingBottom: '8px', marginBottom: '24px' }}>
                <h2 style={{ fontSize: '18px', fontWeight: 900, textTransform: 'uppercase', margin: 0 }}>Připsané platby členů ({filteredPayments.length})</h2>
                <p style={{ fontSize: '11px', fontWeight: 500, color: '#475569', margin: '4px 0 0 0' }}>Přehled jednotlivých úhrad připsaných členům</p>
              </div>

              <table style={{ width: '100%', tableLayout: 'fixed', fontSize: '11px', textAlign: 'left', borderCollapse: 'collapse', wordBreak: 'break-word', overflowWrap: 'break-word' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #0f172a', fontWeight: 700, color: '#1e293b' }}>
                    <th style={{ padding: '8px 4px', width: '13%' }}>Datum</th>
                    <th style={{ padding: '8px 4px', width: '22%' }}>Člen</th>
                    <th style={{ padding: '8px 4px', width: '20%' }}>Způsob úhrady</th>
                    <th style={{ padding: '8px 4px', width: '18%', textAlign: 'right' }}>Částka</th>
                    <th style={{ padding: '8px 4px', width: '27%' }}>Poznámka</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPayments.map(p => (
                    <tr key={p.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                      <td style={{ padding: '8px 4px' }}>{formatDate(p.createdAt)}</td>
                      <td style={{ padding: '8px 4px', fontWeight: 700 }}>{memberMap.get(p.memberId) || 'Neznámý'}</td>
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
            <div style={{ paddingBottom: '32px', boxSizing: 'border-box', width: '100%' }}>
              <div style={{ borderBottom: '2px solid #0f172a', paddingBottom: '8px', marginBottom: '24px' }}>
                <h2 style={{ fontSize: '18px', fontWeight: 900, textTransform: 'uppercase', margin: 0 }}>Statistiky a přehledy kasy</h2>
                <p style={{ fontSize: '11px', fontWeight: 500, color: '#475569', margin: '4px 0 0 0' }}>Celkový souhrn za celé období {period.name}</p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '20px' }}>
                <div style={{ padding: '16px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
                  <h3 style={{ fontSize: '12px', fontWeight: 900, textTransform: 'uppercase', color: '#1e293b', margin: '0 0 12px 0' }}>Top sponzoři kasy (Platby)</h3>
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

                <div style={{ padding: '16px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
                  <h3 style={{ fontSize: '12px', fontWeight: 900, textTransform: 'uppercase', color: '#1e293b', margin: '0 0 12px 0' }}>Největší dlužníci</h3>
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

              <div style={{ paddingTop: '28px', marginTop: '28px', borderTop: '1px solid #cbd5e1', textAlign: 'center', fontSize: '11px', color: '#94a3b8' }}>
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
