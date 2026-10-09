import { useState, useMemo } from 'react';
import { Transaction, Group, Period } from '../types';
import { 
  AccountingExportOptions, 
  filterTransactionsForExport, 
  formatAccountingRows, 
  downloadAccountingCSV, 
  downloadAccountingExcel, 
  generateAccountingTransactionsCSV 
} from '../accountingExport';
import { formatCurrency, getCurrencySymbol, cn } from '../utils';
import { 
  X, 
  FileSpreadsheet, 
  Download, 
  Calendar, 
  Check, 
  Copy, 
  Filter, 
  Building2, 
  Coins, 
  TrendingUp, 
  TrendingDown, 
  ArrowLeftRight, 
  Table, 
  Settings2,
  FileText
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface AccountingExportModalProps {
  group: Group;
  period: Period;
  transactions: Transaction[];
  isOpen: boolean;
  onClose: () => void;
  initialFilterAccount?: 'all' | 'cash' | 'bank';
  initialFilterType?: 'all' | 'income' | 'expense' | 'transfer';
  initialFilterCategory?: string;
}

export default function AccountingExportModal({
  group,
  period,
  transactions,
  isOpen,
  onClose,
  initialFilterAccount = 'all',
  initialFilterType = 'all',
  initialFilterCategory = 'all'
}: AccountingExportModalProps) {
  // Filter states
  const [filterAccount, setFilterAccount] = useState<'all' | 'cash' | 'bank'>(initialFilterAccount);
  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense' | 'transfer'>(initialFilterType);
  const [filterCategory, setFilterCategory] = useState<string>(initialFilterCategory);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // CSV formatting options
  const [delimiter, setDelimiter] = useState<';' | ','>(';');
  const [decimalSeparator, setDecimalSeparator] = useState<',' | '.'>(',');
  const [includeSubItemsAsRows, setIncludeSubItemsAsRows] = useState<boolean>(false);
  const [includeSummaryRow, setIncludeSummaryRow] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);
  const [showOptions, setShowOptions] = useState<boolean>(false);

  // Available categories
  const categories = useMemo(() => {
    const set = new Set<string>();
    transactions.forEach(t => {
      if (t.category) set.add(t.category);
    });
    return Array.from(set).sort();
  }, [transactions]);

  // Current export options
  const exportOptions: AccountingExportOptions = useMemo(() => ({
    delimiter,
    decimalSeparator,
    includeSubItemsAsRows,
    includeSummaryRow,
    filterAccount,
    filterType,
    filterCategory,
    startDate: startDate || undefined,
    endDate: endDate || undefined
  }), [
    delimiter, 
    decimalSeparator, 
    includeSubItemsAsRows, 
    includeSummaryRow, 
    filterAccount, 
    filterType, 
    filterCategory, 
    startDate, 
    endDate
  ]);

  // Filtered transactions
  const filteredTransactions = useMemo(() => {
    return filterTransactionsForExport(transactions, exportOptions);
  }, [transactions, exportOptions]);

  // Formatted rows for preview
  const previewRows = useMemo(() => {
    return formatAccountingRows(filteredTransactions, group, period, exportOptions);
  }, [filteredTransactions, group, period, exportOptions]);

  // Summary metrics
  const metrics = useMemo(() => {
    let income = 0;
    let expense = 0;
    let transfers = 0;

    filteredTransactions.forEach(t => {
      const isTransfer = t.category === 'Převod' || t.source === 'transfer' || !!t.transferPairId;
      if (isTransfer) {
        transfers += Math.abs(t.amount);
      } else if (t.type === 'income') {
        income += t.amount;
      } else {
        expense += Math.abs(t.amount);
      }
    });

    return {
      count: filteredTransactions.length,
      income,
      expense,
      balance: income - expense,
      transfers
    };
  }, [filteredTransactions]);

  if (!isOpen) return null;

  const handleDownloadCSV = () => {
    downloadAccountingCSV(transactions, group, period, exportOptions);
  };

  const handleDownloadExcel = () => {
    downloadAccountingExcel(transactions, group, period, exportOptions);
  };

  const handleCopyCSV = async () => {
    const csvString = generateAccountingTransactionsCSV(transactions, group, period, exportOptions);
    try {
      await navigator.clipboard.writeText(csvString);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      console.error('Clipboard copy failed:', err);
    }
  };

  const setPresetRange = (preset: 'all' | 'this_month' | 'last_30_days') => {
    const today = new Date();
    if (preset === 'all') {
      setStartDate('');
      setEndDate('');
    } else if (preset === 'this_month') {
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
      setStartDate(firstDay.toISOString().split('T')[0]);
      setEndDate(today.toISOString().split('T')[0]);
    } else if (preset === 'last_30_days') {
      const past = new Date();
      past.setDate(past.getDate() - 30);
      setStartDate(past.toISOString().split('T')[0]);
      setEndDate(today.toISOString().split('T')[0]);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <motion.div
        initial={{ scale: 0.96, opacity: 0, y: 12 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0, y: 12 }}
        className="bg-white rounded-3xl max-w-4xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]"
      >
        {/* Header */}
        <div className="p-5 sm:p-6 bg-slate-900 text-white flex items-start justify-between gap-4 shrink-0 border-b border-slate-800">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 bg-emerald-500/20 text-emerald-400 rounded-2xl flex items-center justify-center font-bold border border-emerald-500/30 shrink-0">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">
                  Účetní export transakcí a výdajů
                </h2>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  CSV / Excel
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-1">
                Pokladna: <strong className="text-white">{group.name}</strong> • Období: <strong className="text-white">{period.name}</strong>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors shrink-0"
            title="Zavřít"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-6 flex-1 custom-scrollbar">
          {/* Summary Metrics Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-slate-50 border border-slate-200/80 p-3.5 rounded-2xl">
              <div className="flex items-center justify-between text-slate-500 mb-1">
                <span className="text-[10px] font-black uppercase tracking-widest">Počet dokladů</span>
                <Table className="w-3.5 h-3.5" />
              </div>
              <p className="text-2xl font-black text-slate-900 tracking-tight">
                {metrics.count}
              </p>
              <p className="text-[10px] font-bold text-slate-400 mt-0.5">k zaúčtování</p>
            </div>

            <div className="bg-emerald-50/70 border border-emerald-200/80 p-3.5 rounded-2xl">
              <div className="flex items-center justify-between text-emerald-700 mb-1">
                <span className="text-[10px] font-black uppercase tracking-widest">Příjmy celkem</span>
                <TrendingUp className="w-3.5 h-3.5" />
              </div>
              <p className="text-2xl font-black text-emerald-700 tracking-tight">
                {formatCurrency(metrics.income, group.currency)}
              </p>
              <p className="text-[10px] font-bold text-emerald-600/80 mt-0.5">hotovost + banka</p>
            </div>

            <div className="bg-rose-50/70 border border-rose-200/80 p-3.5 rounded-2xl">
              <div className="flex items-center justify-between text-rose-700 mb-1">
                <span className="text-[10px] font-black uppercase tracking-widest">Výdaje celkem</span>
                <TrendingDown className="w-3.5 h-3.5" />
              </div>
              <p className="text-2xl font-black text-rose-700 tracking-tight">
                {formatCurrency(metrics.expense, group.currency)}
              </p>
              <p className="text-[10px] font-bold text-rose-600/80 mt-0.5">náklady a nákupy</p>
            </div>

            <div className="bg-blue-50/70 border border-blue-200/80 p-3.5 rounded-2xl">
              <div className="flex items-center justify-between text-blue-700 mb-1">
                <span className="text-[10px] font-black uppercase tracking-widest">Čisté saldo</span>
                <ArrowLeftRight className="w-3.5 h-3.5" />
              </div>
              <p className={cn(
                "text-2xl font-black tracking-tight",
                metrics.balance >= 0 ? "text-blue-900" : "text-rose-600"
              )}>
                {metrics.balance >= 0 ? '+' : ''}{formatCurrency(metrics.balance, group.currency)}
              </p>
              <p className="text-[10px] font-bold text-blue-600/80 mt-0.5">výsledek hospodaření</p>
            </div>
          </div>

          {/* Filter Section */}
          <div className="bg-slate-50/80 border border-slate-200 rounded-2xl p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/60 pb-3">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-emerald-600" />
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">
                  Filtry exportu transakcí
                </h3>
              </div>

              {/* Quick Presets */}
              <div className="flex items-center gap-1.5 text-[10px] font-bold">
                <button
                  type="button"
                  onClick={() => setPresetRange('all')}
                  className={cn(
                    "px-2.5 py-1 rounded-lg transition-all",
                    !startDate && !endDate ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"
                  )}
                >
                  Celé období
                </button>
                <button
                  type="button"
                  onClick={() => setPresetRange('this_month')}
                  className="px-2.5 py-1 rounded-lg bg-white text-slate-600 hover:bg-slate-100 border border-slate-200 transition-all"
                >
                  Tento měsíc
                </button>
                <button
                  type="button"
                  onClick={() => setPresetRange('last_30_days')}
                  className="px-2.5 py-1 rounded-lg bg-white text-slate-600 hover:bg-slate-100 border border-slate-200 transition-all"
                >
                  Posledních 30 dní
                </button>
              </div>
            </div>

            {/* Filter grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Date from */}
              <div>
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1">
                  Od data
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
              </div>

              {/* Date to */}
              <div>
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1">
                  Do data
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
              </div>

              {/* Account filter */}
              <div>
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1">
                  Účet / Pokladna
                </label>
                <select
                  value={filterAccount}
                  onChange={(e) => setFilterAccount(e.target.value as any)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                >
                  <option value="all">Všechny účty</option>
                  <option value="cash">Pouze hotovostní pokladna</option>
                  <option value="bank">Pouze bankovní účet</option>
                </select>
              </div>

              {/* Type filter */}
              <div>
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1">
                  Typ operace
                </label>
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value as any)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                >
                  <option value="all">Všechny operace</option>
                  <option value="expense">Pouze výdaje</option>
                  <option value="income">Pouze příjmy</option>
                  <option value="transfer">Pouze převody</option>
                </select>
              </div>
            </div>

            {/* Category filter line */}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <div className="flex-1 min-w-[200px]">
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1">
                  Kategorie výdajů a příjmů
                </label>
                <select
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                >
                  <option value="all">Všechny kategorie</option>
                  {categories.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-end pt-5">
                <button
                  type="button"
                  onClick={() => setShowOptions(!showOptions)}
                  className="px-3.5 py-2 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 flex items-center gap-1.5 transition-colors"
                >
                  <Settings2 className="w-3.5 h-3.5 text-slate-500" />
                  <span>{showOptions ? 'Skrýt formátování CSV' : 'Podrobné nastavení CSV (středník, kódování)'}</span>
                </button>
              </div>
            </div>

            {/* Advanced CSV formatting options */}
            <AnimatePresence>
              {showOptions && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden pt-2 border-t border-slate-200/60"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-white p-3.5 rounded-xl border border-slate-200 text-xs">
                    <div>
                      <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1">
                        Oddělovač sloupců
                      </label>
                      <select
                        value={delimiter}
                        onChange={(e) => setDelimiter(e.target.value as any)}
                        className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-slate-800 text-xs"
                      >
                        <option value=";">Středník ( ; ) – CZ Excel & Pohoda</option>
                        <option value=",">Čárka ( , ) – Mezinárodní standard</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1">
                        Desetinný oddělovač
                      </label>
                      <select
                        value={decimalSeparator}
                        onChange={(e) => setDecimalSeparator(e.target.value as any)}
                        className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-slate-800 text-xs"
                      >
                        <option value=",">Čárka ( 1250,50 ) – CZ Excel</option>
                        <option value=".">Tečka ( 1250.50 ) – Standard</option>
                      </select>
                    </div>

                    <div className="flex flex-col justify-center">
                      <label className="flex items-center gap-2 cursor-pointer pt-3">
                        <input
                          type="checkbox"
                          checked={includeSubItemsAsRows}
                          onChange={(e) => setIncludeSubItemsAsRows(e.target.checked)}
                          className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500"
                        />
                        <span className="font-bold text-slate-800 text-xs">
                          Rozepsat souhrnné nákupy na řádky
                        </span>
                      </label>
                      <span className="text-[9px] text-slate-400 pl-6">
                        Každá položka nákupu bude mít samostatný řádek
                      </span>
                    </div>

                    <div className="flex flex-col justify-center">
                      <label className="flex items-center gap-2 cursor-pointer pt-3">
                        <input
                          type="checkbox"
                          checked={includeSummaryRow}
                          onChange={(e) => setIncludeSummaryRow(e.target.checked)}
                          className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500"
                        />
                        <span className="font-bold text-slate-800 text-xs">
                          Zahrnout řádek CELKEM na konec
                        </span>
                      </label>
                      <span className="text-[9px] text-slate-400 pl-6">
                        Součet příjmů, výdajů a čistého salda
                      </span>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Table Preview Section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-slate-500 px-1">
              <span className="flex items-center gap-1.5">
                <Table className="w-3.5 h-3.5 text-slate-400" />
                <span>Náhled účetního deníku (zobrazeno prvních {Math.min(5, previewRows.length)} z {previewRows.length} řádků):</span>
              </span>
              <span className="text-[10px] text-slate-400 font-medium">
                Kompletní data budou obsažena ve vygenerovaném CSV
              </span>
            </div>

            <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-xs bg-white">
              {previewRows.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-100/80 border-b border-slate-200 text-[10px] font-black uppercase tracking-wider text-slate-600">
                        <th className="p-3">Doklad</th>
                        <th className="p-3">Datum</th>
                        <th className="p-3">Typ</th>
                        <th className="p-3">Účet</th>
                        <th className="p-3">Kategorie</th>
                        <th className="p-3 text-right">Příjem</th>
                        <th className="p-3 text-right">Výdaj</th>
                        <th className="p-3">Partner / Popis</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium">
                      {previewRows.slice(0, 5).map((row, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                          <td className="p-3 font-mono font-bold text-slate-900 text-[11px]">
                            {row.docNumber}
                          </td>
                          <td className="p-3 whitespace-nowrap text-slate-600 text-[11px]">
                            {row.date} {row.time}
                          </td>
                          <td className="p-3">
                            <span className={cn(
                              "px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider inline-block",
                              row.type === 'Příjem' ? "bg-emerald-50 text-emerald-700 border border-emerald-200" :
                              row.type === 'Výdaj' ? "bg-rose-50 text-rose-700 border border-rose-200" :
                              "bg-blue-50 text-blue-700 border border-blue-200"
                            )}>
                              {row.type}
                            </span>
                          </td>
                          <td className="p-3 whitespace-nowrap text-[11px] text-slate-600">
                            {row.account === 'Bankovní účet' ? '🏦 Bankovní účet' : '💵 Hotovost'}
                          </td>
                          <td className="p-3 font-bold text-slate-800 text-[11px]">
                            {row.category}
                          </td>
                          <td className="p-3 text-right font-bold text-emerald-600 whitespace-nowrap">
                            {row.income !== null ? `${row.income.toFixed(2)} ${getCurrencySymbol(group.currency)}` : '-'}
                          </td>
                          <td className="p-3 text-right font-bold text-rose-600 whitespace-nowrap">
                            {row.expense !== null ? `${row.expense.toFixed(2)} ${getCurrencySymbol(group.currency)}` : '-'}
                          </td>
                          <td className="p-3 max-w-[220px] truncate text-[11px] text-slate-700" title={row.description}>
                            <span className="font-bold text-slate-900 mr-1.5">{row.partner}</span>
                            <span className="text-slate-500">{row.description}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-10 text-slate-400">
                  <p className="text-xs font-bold uppercase tracking-wider">Žádné transakce neodpovídají zadaným filtrům</p>
                </div>
              )}
            </div>
          </div>

          {/* Accounting Standards Note */}
          <div className="p-3.5 bg-blue-50/70 border border-blue-200/80 rounded-2xl flex items-start gap-3 text-xs text-blue-900 font-medium">
            <Building2 className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
            <div className="space-y-0.5 leading-relaxed">
              <p className="font-bold">
                Optimalizováno pro české a slovenské účetní programy (Pohoda, Money S3, Helios, Premier, Excel)
              </p>
              <p className="text-[11px] text-blue-800">
                Soubor CSV obsahuje kódování UTF-8 s BOM (zabraňuje rozpadu diakritiky), standardní středníkový oddělovač, číselné částky bez rušivých textových symbolů v samostatných sloupcích Příjem / Výdaj a chronologické číslování dokladů.
              </p>
            </div>
          </div>
        </div>

        {/* Modal Footer / Action Bar */}
        <div className="p-4 sm:p-5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyCSV}
              disabled={filteredTransactions.length === 0}
              className="px-3.5 py-2.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all shadow-2xs disabled:opacity-50"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? 'CSV zkopírováno!' : 'Kopírovat do schránky'}</span>
            </button>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 font-bold text-xs text-slate-500 hover:text-slate-800 transition-colors"
            >
              Zavřít
            </button>

            {/* Excel Download button */}
            <button
              type="button"
              onClick={handleDownloadExcel}
              disabled={filteredTransactions.length === 0}
              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs flex items-center gap-2 shadow-md shadow-emerald-600/15 transition-all active:scale-95 disabled:opacity-50"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Stáhnout Excel (.xlsx)</span>
            </button>

            {/* Primary CSV Download button */}
            <button
              type="button"
              onClick={handleDownloadCSV}
              disabled={filteredTransactions.length === 0}
              className="px-5 py-2.5 bg-slate-900 hover:bg-black text-white rounded-xl font-bold text-xs flex items-center gap-2 shadow-lg shadow-slate-900/15 transition-all active:scale-95 disabled:opacity-50"
            >
              <Download className="w-4 h-4 text-emerald-400" />
              <span>Stáhnout CSV pro účetnictví</span>
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
