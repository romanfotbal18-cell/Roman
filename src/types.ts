export type UserRole = 'owner' | 'editor' | 'viewer';

export interface GroupMemberRole {
  email: string;
  uid?: string;
  role: 'editor' | 'viewer';
  addedAt?: number;
}

export interface GroupEnabledFeatures {
  dashboardGoals?: boolean;
  dashboardEnvelopes?: boolean;
  dashboardCashboxChart?: boolean;
  dashboardDebts?: boolean;
  dashboardEvents?: boolean;
  dashboardStats?: boolean;
  cashboxEnvelopes?: boolean;
}

export interface Group {
  id: string;
  name: string;
  ownerId: string;
  currency?: string;
  bankAccount?: string;
  bankName?: string;
  bankNote?: string;
  bankVS?: string;
  bankQrCodeUrl?: string;
  ownerEmail?: string;
  memberUids?: string[];
  allowedEmails?: string[];
  sharedUsers?: GroupMemberRole[];
  viewerEmails?: string[];
  viewerUids?: string[];
  createdAt?: any;
  enabledFeatures?: GroupEnabledFeatures;
}

export interface Member {
  id: string;
  name: string;
  active: boolean;
  groupId: string;
  birthDate?: string;
  position?: string;
}

export interface MemberGroup {
  id: string;
  name: string;
  memberIds: string[];
  groupId: string;
  order: number;
}

export interface FineTemplate {
  id: string;
  name: string;
  amount: number;
  type: 'fixed' | 'dynamic';
  unit?: string;
  groupId: string;
  order: number;
}

export interface Period {
  id: string;
  name: string;
  active?: boolean;
  groupId: string;
  createdAt: number;
  goalCalcSource?: 'free_cash' | 'total_cash';
  resetDebtTrendAt?: number;
  statsResetAt?: number;
  violationsResetAt?: number;
  streaksResetAt?: number;
  sponsorsResetAt?: number;
  monthlyResetAt?: number;
  debtorsResetAt?: number;
}

export interface Fine {
  id: string;
  memberId: string;
  reason: string;
  amount: number;
  paidAmount: number; // Added to support partial payments
  paid: boolean;
  periodId: string;
  createdAt: number;
  templateId?: string;
  quantity?: number;
  unitPrice?: number;
  unit?: string;
  recurringFineId?: string;
}

export interface RecurringFine {
  id: string;
  reason: string;
  amount: number;
  memberIds: string[];
  interval: 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom_days';
  intervalDays?: number;
  dayOfPeriod?: number; // Day of month (1-31) or Day of week (1=Mon..7=Sun)
  startDate: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  durationType: 'indefinite' | 'until_date' | 'max_occurrences';
  occurrencesLimit?: number;
  occurrencesCount?: number;
  lastGeneratedAt?: string; // YYYY-MM-DD
  nextDueDate: string; // YYYY-MM-DD
  active: boolean;
  groupId: string;
  periodId: string;
  createdAt: number;
  templateId?: string;
  quantity?: number;
  unitPrice?: number;
  unit?: string;
  note?: string;
}

export interface Payment {
  id: string;
  memberId: string;
  amount: number;
  paymentMethod: 'cash' | 'bank' | 'purchase';
  note?: string;
  periodId: string;
  createdAt: number;
  transactionId?: string; // Link to cashbox
}

export interface TransactionSubItem {
  amount: number;
  fromWho: string;
  note: string;
}

export interface Transaction {
  id: string;
  amount: number; // positive for income, negative for expense
  type: 'income' | 'expense';
  source: 'fine_payment' | 'external_income' | 'expense';
  note: string;
  category?: string;
  periodId: string;
  createdAt: number;
  fromWho?: string;
  paymentId?: string; // Link to payment records
  subItems?: TransactionSubItem[];
  isSummary?: boolean;
  isDebtExpense?: boolean;
  cashboxPortion?: number;
  debtDetails?: { memberId: string; amount: number; memberName: string }[];
}

export interface Event {
  id: string;
  name: string;
  date: string;
  description?: string;
  isImportant: boolean;
  groupId: string;
  periodId: string;
  createdAt: number;
}

export interface Goal {
  id: string;
  name: string;
  targetAmount: number;
  priority: number;
  createdAt: number;
  completed: boolean;
  periodId: string;
}

export interface Envelope {
  id: string;
  name: string;
  amount: number;
  targetAmount?: number;
  color?: string;
  note?: string;
  periodId: string;
  createdAt: number;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}
