import { Transaction, Group, Period } from './types';
import { getCurrencySymbol } from './utils';
import * as XLSX from 'xlsx';

export interface AccountingExportOptions {
  delimiter?: ';' | ',';
  decimalSeparator?: ',' | '.';
  dateFormat?: 'cz' | 'iso';
  includeSubItemsAsRows?: boolean;
  includeSummaryRow?: boolean;
  filterAccount?: 'all' | 'cash' | 'bank';
  filterType?: 'all' | 'income' | 'expense' | 'transfer';
  filterCategory?: string;
  startDate?: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD
}

export interface AccountingTransactionRow {
  docNumber: string;
  docId: string;
  date: string;
  time: string;
  type: string;
  operationType: string;
  account: string;
  category: string;
  income: number | null;
  expense: number | null;
  signedAmount: number;
  currency: string;
  partner: string;
  description: string;
  paymentMethod: string;
  breakdown: string;
  groupName: string;
  periodName: string;
}

export function getTransactionAccountLabel(t: Transaction): 'Hotovostní pokladna' | 'Bankovní účet' {
  if (t.account === 'bank' || t.paymentMethod === 'bank' || t.paymentMethod === 'purchase') {
    return 'Bankovní účet';
  }
  return 'Hotovostní pokladna';
}

export function getTransactionTypeLabel(t: Transaction): 'Příjem' | 'Výdaj' | 'Převod' {
  if (t.category === 'Převod' || t.source === 'transfer' || !!t.transferPairId) {
    return 'Převod';
  }
  return t.type === 'income' ? 'Příjem' : 'Výdaj';
}

export function getTransactionOperationLabel(t: Transaction): string {
  if (t.category === 'Převod' || t.source === 'transfer' || !!t.transferPairId) {
    return t.amount > 0 ? 'Vklad na účet / Převod (+)' : 'Výběr z účtu / Převod (-)';
  }
  if (t.source === 'fine_payment') {
    return 'Úhrada pokuty členem';
  }
  if (t.isSummary) {
    return 'Souhrnný výdaj (více položek)';
  }
  if (t.isDebtExpense) {
    return 'Výdaj na dluh členů';
  }
  if (t.type === 'income') {
    return 'Příjem do pokladny';
  }
  return 'Běžný provozní výdaj';
}

export function getTransactionPaymentMethodLabel(t: Transaction): string {
  if (t.category === 'Převod' || t.source === 'transfer') {
    return 'Vnitrobankovní / pokladní převod';
  }
  if (t.paymentMethod === 'bank' || t.account === 'bank') {
    return 'Bankovní převod';
  }
  if (t.paymentMethod === 'purchase') {
    return 'Proplacený nákup';
  }
  return 'Hotovost';
}

export function filterTransactionsForExport(
  transactions: Transaction[],
  options: AccountingExportOptions = {}
): Transaction[] {
  const {
    filterAccount = 'all',
    filterType = 'all',
    filterCategory = 'all',
    startDate,
    endDate
  } = options;

  return transactions.filter(t => {
    // 1. Account filter
    if (filterAccount !== 'all') {
      const isBank = t.account === 'bank' || t.paymentMethod === 'bank' || t.paymentMethod === 'purchase';
      if (filterAccount === 'bank' && !isBank) return false;
      if (filterAccount === 'cash' && isBank) return false;
    }

    // 2. Type filter
    const isTransfer = t.category === 'Převod' || t.source === 'transfer' || !!t.transferPairId;
    if (filterType === 'transfer' && !isTransfer) return false;
    if (filterType === 'income' && (t.type !== 'income' || isTransfer)) return false;
    if (filterType === 'expense' && (t.type !== 'expense' || isTransfer)) return false;

    // 3. Category filter
    if (filterCategory && filterCategory !== 'all') {
      if ((t.category || '') !== filterCategory) return false;
    }

    // 4. Date filter
    if (startDate || endDate) {
      const itemDateStr = new Date(t.createdAt).toISOString().split('T')[0];
      if (startDate && itemDateStr < startDate) return false;
      if (endDate && itemDateStr > endDate) return false;
    }

    return true;
  });
}

export function formatAccountingRows(
  transactions: Transaction[],
  group: Group,
  period: Period,
  options: AccountingExportOptions = {}
): AccountingTransactionRow[] {
  const {
    dateFormat = 'cz',
    includeSubItemsAsRows = false
  } = options;

  const currencyStr = group.currency ? group.currency.toUpperCase() : 'CZK';
  const rows: AccountingTransactionRow[] = [];

  // Sort ascending by date for chronological accounting journal
  const sorted = [...transactions].sort((a, b) => a.createdAt - b.createdAt);

  sorted.forEach((t, index) => {
    const dateObj = new Date(t.createdAt);
    const dateStr = dateFormat === 'iso'
      ? dateObj.toISOString().split('T')[0]
      : `${String(dateObj.getDate()).padStart(2, '0')}.${String(dateObj.getMonth() + 1).padStart(2, '0')}.${dateObj.getFullYear()}`;

    const timeStr = `${String(dateObj.getHours()).padStart(2, '0')}:${String(dateObj.getMinutes()).padStart(2, '0')}`;
    const docNumber = `DOK-${String(index + 1).padStart(4, '0')}`;

    const typeLabel = getTransactionTypeLabel(t);
    const operationLabel = getTransactionOperationLabel(t);
    const accountLabel = getTransactionAccountLabel(t);
    const paymentMethodLabel = getTransactionPaymentMethodLabel(t);

    const isIncome = t.type === 'income' && typeLabel !== 'Převod';
    const isExpense = t.type === 'expense' && typeLabel !== 'Převod';
    const isTransfer = typeLabel === 'Převod';

    let incomeVal: number | null = null;
    let expenseVal: number | null = null;

    if (isIncome) {
      incomeVal = Math.abs(t.amount);
    } else if (isExpense) {
      expenseVal = Math.abs(t.amount);
    } else if (isTransfer) {
      if (t.amount > 0) {
        incomeVal = Math.abs(t.amount);
      } else {
        expenseVal = Math.abs(t.amount);
      }
    }

    // Prepare breakdown note
    let breakdownStr = '';
    if (t.isSummary && t.subItems && t.subItems.length > 0) {
      breakdownStr = t.subItems
        .map((si, i) => `#${i + 1} ${si.note || 'Položka'}: ${si.amount} ${getCurrencySymbol(currencyStr)}${si.fromWho ? ` (${si.fromWho})` : ''}`)
        .join('; ');
    } else if (t.isDebtExpense && t.debtDetails && t.debtDetails.length > 0) {
      breakdownStr = t.debtDetails
        .map(d => `${d.memberName}: ${d.amount} ${getCurrencySymbol(currencyStr)}`)
        .join('; ');
      if (t.cashboxPortion && t.cashboxPortion > 0) {
        breakdownStr += `; Z pokladny: ${t.cashboxPortion} ${getCurrencySymbol(currencyStr)}`;
      }
    }

    // Main parent transaction row
    rows.push({
      docNumber,
      docId: t.id,
      date: dateStr,
      time: timeStr,
      type: typeLabel,
      operationType: operationLabel,
      account: accountLabel,
      category: t.category || (isTransfer ? 'Převod' : 'Provozní'),
      income: incomeVal,
      expense: expenseVal,
      signedAmount: t.amount,
      currency: currencyStr,
      partner: t.fromWho || '',
      description: t.note || '',
      paymentMethod: paymentMethodLabel,
      breakdown: breakdownStr,
      groupName: group.name,
      periodName: period.name
    });

    // If user wants sub-items itemized as separate accounting lines
    if (includeSubItemsAsRows && t.isSummary && t.subItems && t.subItems.length > 0) {
      t.subItems.forEach((item, itemIdx) => {
        rows.push({
          docNumber: `${docNumber}-${itemIdx + 1}`,
          docId: `${t.id}_sub_${itemIdx + 1}`,
          date: dateStr,
          time: timeStr,
          type: typeLabel,
          operationType: `Položka souhrnného výdaje (${docNumber})`,
          account: accountLabel,
          category: t.category || 'Rozpad položky',
          income: null,
          expense: Math.abs(item.amount),
          signedAmount: -Math.abs(item.amount),
          currency: currencyStr,
          partner: item.fromWho || t.fromWho || '',
          description: `↳ ${item.note || 'Dílčí položka'}`,
          paymentMethod: paymentMethodLabel,
          breakdown: `Součást souhrnného dokladu ${docNumber}`,
          groupName: group.name,
          periodName: period.name
        });
      });
    }
  });

  return rows;
}

export function generateAccountingTransactionsCSV(
  transactions: Transaction[],
  group: Group,
  period: Period,
  options: AccountingExportOptions = {}
): string {
  const {
    delimiter = ';',
    decimalSeparator = ',',
    includeSummaryRow = true
  } = options;

  const filtered = filterTransactionsForExport(transactions, options);
  const rows = formatAccountingRows(filtered, group, period, options);

  const escapeCSV = (value: string | number | null | undefined): string => {
    if (value === null || value === undefined) return '""';
    const str = String(value);
    return `"${str.replace(/"/g, '""')}"`;
  };

  const formatNumber = (val: number | null): string => {
    if (val === null || isNaN(val)) return '""';
    const fixed = val.toFixed(2);
    if (decimalSeparator === ',') {
      return `"${fixed.replace('.', ',')}"`;
    }
    return `"${fixed}"`;
  };

  const headers = [
    'Číslo dokladu',
    'ID transakce',
    'Datum',
    'Čas',
    'Typ dokladu',
    'Druh účetního případu',
    'Pokladna / Účet',
    'Kategorie',
    'Příjem',
    'Výdaj',
    'Částka se znaménkem',
    'Měna',
    'Partner / Od koho / Komu',
    'Popis / Účel dokladu',
    'Způsob úhrady',
    'Rozpis položek / Dlužníci',
    'Pokladna',
    'Účetní období'
  ];

  let csvContent = '\uFEFF'; // UTF-8 Byte Order Mark for Excel
  csvContent += headers.map(h => escapeCSV(h)).join(delimiter) + '\r\n';

  let totalIncome = 0;
  let totalExpense = 0;
  let totalSigned = 0;

  rows.forEach(r => {
    if (r.income !== null) totalIncome += r.income;
    if (r.expense !== null) totalExpense += r.expense;
    totalSigned += r.signedAmount;

    const rowData = [
      escapeCSV(r.docNumber),
      escapeCSV(r.docId),
      escapeCSV(r.date),
      escapeCSV(r.time),
      escapeCSV(r.type),
      escapeCSV(r.operationType),
      escapeCSV(r.account),
      escapeCSV(r.category),
      formatNumber(r.income),
      formatNumber(r.expense),
      formatNumber(r.signedAmount),
      escapeCSV(r.currency),
      escapeCSV(r.partner),
      escapeCSV(r.description),
      escapeCSV(r.paymentMethod),
      escapeCSV(r.breakdown),
      escapeCSV(r.groupName),
      escapeCSV(r.periodName)
    ];

    csvContent += rowData.join(delimiter) + '\r\n';
  });

  if (includeSummaryRow && rows.length > 0) {
    const summaryRow = [
      escapeCSV('CELKEM SOUČET'),
      escapeCSV(`${rows.length} dokladů`),
      escapeCSV(''),
      escapeCSV(''),
      escapeCSV(''),
      escapeCSV(''),
      escapeCSV(''),
      escapeCSV(''),
      formatNumber(totalIncome),
      formatNumber(totalExpense),
      formatNumber(totalSigned),
      escapeCSV(group.currency ? group.currency.toUpperCase() : 'CZK'),
      escapeCSV(''),
      escapeCSV(`Čisté saldo období: ${totalSigned >= 0 ? '+' : ''}${totalSigned.toFixed(2)} ${group.currency || 'CZK'}`),
      escapeCSV(''),
      escapeCSV(''),
      escapeCSV(group.name),
      escapeCSV(period.name)
    ];
    csvContent += summaryRow.join(delimiter) + '\r\n';
  }

  return csvContent;
}

export function downloadAccountingCSV(
  transactions: Transaction[],
  group: Group,
  period: Period,
  options: AccountingExportOptions = {},
  customFilename?: string
) {
  const csvString = generateAccountingTransactionsCSV(transactions, group, period, options);
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  
  const dateStr = new Date().toISOString().split('T')[0];
  const safeGroupName = group.name.replace(/[^a-zA-Z0-9_\u00C0-\u017F]/g, '_');
  const safePeriodName = period.name.replace(/[^a-zA-Z0-9_\u00C0-\u017F]/g, '_');
  const filename = customFilename || `Ucetnictvi_Historie_transakci_${safeGroupName}_${safePeriodName}_${dateStr}.csv`;

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function downloadAccountingExcel(
  transactions: Transaction[],
  group: Group,
  period: Period,
  options: AccountingExportOptions = {},
  customFilename?: string
) {
  const filtered = filterTransactionsForExport(transactions, options);
  const rows = formatAccountingRows(filtered, group, period, options);

  const excelData = rows.map(r => ({
    'Číslo dokladu': r.docNumber,
    'ID transakce': r.docId,
    'Datum': r.date,
    'Čas': r.time,
    'Typ dokladu': r.type,
    'Druh účetního případu': r.operationType,
    'Pokladna / Účet': r.account,
    'Kategorie': r.category,
    'Příjem': r.income !== null ? r.income : '',
    'Výdaj': r.expense !== null ? r.expense : '',
    'Částka se znaménkem': r.signedAmount,
    'Měna': r.currency,
    'Partner / Od koho / Komu': r.partner,
    'Popis / Účel dokladu': r.description,
    'Způsob úhrady': r.paymentMethod,
    'Rozpis položek / Dlužníci': r.breakdown,
    'Pokladna': r.groupName,
    'Účetní období': r.periodName
  }));

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(excelData);

  // Set column widths for comfortable accounting view
  worksheet['!cols'] = [
    { wch: 14 }, // Číslo dokladu
    { wch: 18 }, // ID transakce
    { wch: 12 }, // Datum
    { wch: 8 },  // Čas
    { wch: 10 }, // Typ dokladu
    { wch: 26 }, // Druh účetního případu
    { wch: 20 }, // Pokladna / Účet
    { wch: 16 }, // Kategorie
    { wch: 14 }, // Příjem
    { wch: 14 }, // Výdaj
    { wch: 16 }, // Částka se znaménkem
    { wch: 8 },  // Měna
    { wch: 22 }, // Partner
    { wch: 32 }, // Popis
    { wch: 20 }, // Způsob úhrady
    { wch: 35 }, // Rozpis položek
    { wch: 18 }, // Pokladna
    { wch: 16 }, // Účetní období
  ];

  XLSX.utils.book_append_sheet(workbook, worksheet, 'Účetní deník');

  const dateStr = new Date().toISOString().split('T')[0];
  const safeGroupName = group.name.replace(/[^a-zA-Z0-9_\u00C0-\u017F]/g, '_');
  const safePeriodName = period.name.replace(/[^a-zA-Z0-9_\u00C0-\u017F]/g, '_');
  const filename = customFilename || `Ucetnictvi_Historie_transakci_${safeGroupName}_${safePeriodName}_${dateStr}.xlsx`;

  XLSX.writeFile(workbook, filename);
}
