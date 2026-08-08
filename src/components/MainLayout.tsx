import { useState } from 'react';
import { User } from 'firebase/auth';
import { Group, Period } from '../types';
import Dashboard from './Dashboard';
import DebtList from './DebtList';
import RecordFine from './RecordFine';
import CashboxManagement from './CashboxManagement';
import ManualTransactionForm from './ManualTransactionForm';
import QuickPayment from './QuickPayment';
import Settings from './Settings';
import ThemeToggle from './ThemeToggle';
import ShareModal from './ShareModal';
import { 
  LayoutDashboard, 
  Users, 
  PlusCircle, 
  Wallet, 
  Settings as SettingsIcon, 
  ChevronLeft,
  Menu,
  X,
  CreditCard,
  TrendingDown,
  TrendingUp,
  ReceiptText,
  Crown,
  Edit3,
  Eye,
  Share2,
  Lock
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, getUserRole } from '../utils';

interface MainLayoutProps {
  user: User;
  group: Group;
  period: Period;
  onBackToPeriods: () => void;
  onBackToGroups: () => void;
}

type Section = 'dashboard' | 'debts' | 'record' | 'cashbox' | 'settings';

export default function MainLayout({ user, group, period, onBackToPeriods, onBackToGroups }: MainLayoutProps) {
  const [activeSection, setActiveSection] = useState<Section>('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [quickAction, setQuickAction] = useState<string | null>(null);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);

  const userRole = getUserRole(group, user.email, user.uid);
  const isReadOnly = userRole === 'viewer';

  const navigation = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'debts', label: 'Dlužný list', icon: Users },
    { id: 'record', label: 'Zapisování', icon: PlusCircle },
    { id: 'cashbox', label: 'Pokladna', icon: Wallet },
    { id: 'settings', label: 'Nastavení', icon: SettingsIcon },
  ];

  const renderSection = () => {
    switch (activeSection) {
      case 'dashboard':
        return (
          <Dashboard 
            group={group} 
            period={period} 
            onNavigate={(s) => setActiveSection(s as Section)} 
            onOpenQuickAction={(action) => {
              if (isReadOnly) {
                alert('Jste v režimu Pouze pro čtení. Nemáte oprávnění provádět změny.');
                return;
              }
              setQuickAction(action);
            }}
          />
        );
      case 'debts':
        return <DebtList group={group} period={period} />;
      case 'record':
        return <RecordFine group={group} period={period} />;
      case 'cashbox':
        return <CashboxManagement group={group} period={period} />;
      case 'settings':
        return <Settings group={group} period={period} />;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-bento-bg flex flex-col font-sans">
      {/* Top Header */}
      <header className="sticky top-0 z-40 bg-white/70 backdrop-blur-xl border-b border-bento-card-border px-6 py-4">
        <div className="max-w-[1400px] mx-auto flex justify-between items-center">
          <div className="flex items-center gap-4">
            <button
              onClick={onBackToPeriods}
              className="p-2 text-bento-text-muted hover:text-bento-text-main hover:bg-slate-100 rounded-xl transition-all group"
              title="Zpět na výběr období"
            >
              <ChevronLeft className="w-5 h-5 group-hover:-translate-x-0.5 transition-transform" />
            </button>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase font-bold tracking-widest text-bento-accent leading-none">
                  {group.name}
                </span>

                {/* Role badge */}
                <button
                  onClick={() => setIsShareModalOpen(true)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider transition-all hover:scale-105 active:scale-95"
                  title="Klikněte pro správu sdílení"
                >
                  {userRole === 'owner' && (
                    <span className="bg-amber-100 text-amber-800 flex items-center gap-1 px-1.5 py-0.5 rounded">
                      <Crown className="w-2.5 h-2.5" /> Vlastník
                    </span>
                  )}
                  {userRole === 'editor' && (
                    <span className="bg-blue-100 text-blue-800 flex items-center gap-1 px-1.5 py-0.5 rounded">
                      <Edit3 className="w-2.5 h-2.5" /> Editor
                    </span>
                  )}
                  {userRole === 'viewer' && (
                    <span className="bg-amber-100/80 text-amber-900 border border-amber-300/80 flex items-center gap-1 px-1.5 py-0.5 rounded">
                      <Eye className="w-2.5 h-2.5" /> Čtenář (Pouze pro čtení)
                    </span>
                  )}
                </button>
              </div>
              <span className="text-base font-bold text-bento-text-main leading-none mt-1">
                {period.name}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden md:flex bg-slate-100/50 p-1 rounded-xl">
              {navigation.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveSection(item.id as Section)}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all",
                    activeSection === item.id 
                      ? "bg-white text-bento-text-main shadow-sm" 
                      : "text-bento-text-muted hover:text-bento-text-main hover:bg-white/50"
                  )}
                >
                  <item.icon className={cn("w-4 h-4", activeSection === item.id ? "text-bento-accent" : "text-bento-text-muted")} />
                  {item.label}
                </button>
              ))}
            </div>

            <button
              onClick={() => setIsShareModalOpen(true)}
              className="p-2.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-xl font-bold text-xs flex items-center gap-2 transition-all shadow-sm"
              title="Sdílet kasu"
            >
              <Share2 className="w-4 h-4" />
              <span className="hidden sm:inline">Sdílet</span>
            </button>
            
            <ThemeToggle />
            
            <button 
              className="md:hidden p-2.5 bg-bento-sidebar text-white rounded-xl active:scale-95 transition-all"
              onClick={() => setIsMobileMenuOpen(true)}
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="hidden lg:flex items-center gap-3 pl-4 border-l border-bento-card-border">
              <div className="text-right hidden xl:block">
                <p className="text-xs font-bold text-bento-text-main">{user.displayName}</p>
                <p className="text-[10px] text-bento-text-muted font-medium">{user.email}</p>
              </div>
              <img 
                src={user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}`} 
                alt="User" 
                className="w-9 h-9 rounded-full border border-bento-card-border"
              />
            </div>
          </div>
        </div>
      </header>

      {/* Read-only banner if user is viewer */}
      {isReadOnly && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-6 py-2.5 text-xs font-bold flex items-center justify-center gap-2 text-center shadow-inner">
          <Eye className="w-4 h-4 text-amber-600 shrink-0" />
          <span>
            <strong>Režim Pouze pro čtení:</strong> Tato kasa vám byla nasdílena k nahlížení. Všechny informace si můžete detailně rozkliknout a projít, ale nemáte oprávnění vytvářet ani měnit záznamy.
          </span>
        </div>
      )}

      {/* Share Modal */}
      {isShareModalOpen && (
        <ShareModal
          group={group}
          user={user}
          isOpen={isShareModalOpen}
          onClose={() => setIsShareModalOpen(false)}
          onLeave={onBackToGroups}
        />
      )}

      {/* Main Content Area */}
      <main className="flex-1 p-6 lg:p-8 max-w-[1400px] mx-auto w-full">
        <motion.div
          key={activeSection}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
        >
          {renderSection()}
        </motion.div>
      </main>

      {/* Mobile Menu Overlay */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMobileMenuOpen(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              className="absolute right-0 top-0 bottom-0 w-80 bg-white shadow-2xl p-8"
            >
              <div className="flex justify-between items-center mb-10">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center text-white">
                    <LayoutDashboard className="w-6 h-6" />
                  </div>
                  <span className="font-bold text-xl">Menu</span>
                </div>
                <button onClick={() => setIsMobileMenuOpen(false)} className="p-2 text-slate-400">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <nav className="space-y-3">
                {navigation.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      setActiveSection(item.id as Section);
                      setIsMobileMenuOpen(false);
                    }}
                    className={cn(
                      "w-full flex items-center gap-4 p-4 rounded-2xl font-bold transition-all",
                      activeSection === item.id 
                        ? "bg-blue-600 text-white shadow-xl shadow-blue-500/20" 
                        : "text-slate-500 hover:bg-slate-50"
                    )}
                  >
                    <item.icon className="w-6 h-6" />
                    {item.label}
                  </button>
                ))}
              </nav>

              <div className="absolute bottom-8 left-8 right-8 pt-6 border-t border-slate-100 dark:border-slate-800 space-y-3">
                <div className="flex items-center gap-3 mb-2">
                  <img 
                    src={user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}`} 
                    alt="User" 
                    className="w-10 h-10 rounded-2xl border border-slate-200 dark:border-slate-700"
                  />
                  <div className="overflow-hidden">
                    <p className="font-bold text-slate-900 dark:text-white text-sm truncate">{user.displayName}</p>
                    <p className="text-xs text-slate-400 truncate">{user.email}</p>
                  </div>
                </div>

                <ThemeToggle showLabel={true} />

                <button 
                  onClick={onBackToGroups}
                  className="w-full py-3 text-rose-600 dark:text-rose-400 font-bold hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-2xl transition-all text-xs"
                >
                  Přepnout Kasu
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Quick Action Overlay (Reusable for Dashboard shortcuts) */}
      <AnimatePresence>
        {quickAction && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setQuickAction(null)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className={cn(
                "relative w-full bg-white rounded-[3rem] shadow-2xl p-6 md:p-8 max-h-[90vh] overflow-y-auto custom-scrollbar",
                quickAction === 'fine' ? "max-w-4xl" : "max-w-md"
              )}
            >
              <div className="flex justify-between items-center mb-6 md:mb-8">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-10 h-10 md:w-12 md:h-12 rounded-2xl flex items-center justify-center",
                    quickAction === 'fine' ? "bg-blue-50 text-blue-600" : 
                    quickAction === 'income' ? "bg-emerald-50 text-emerald-600" :
                    quickAction === 'expense' ? "bg-rose-50 text-rose-600" :
                    "bg-slate-50 text-slate-600"
                  )}>
                    {quickAction === 'fine' && <PlusCircle className="w-6 h-6" />}
                    {quickAction === 'payment' && <CreditCard className="w-6 h-6" />}
                    {quickAction === 'income' && <TrendingUp className="w-6 h-6" />}
                    {quickAction === 'expense' && <TrendingDown className="w-6 h-6" />}
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold leading-none">
                      {quickAction === 'fine' && 'Zapsat pokutu'}
                      {quickAction === 'payment' && 'Zapsat platbu'}
                      {quickAction === 'income' && 'Zapsat příjem'}
                      {quickAction === 'expense' && 'Zapsat výdaj'}
                    </h2>
                    <p className="text-[10px] font-black uppercase tracking-widest text-bento-text-muted mt-1.5">Rychlá akce • {group.name}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setQuickAction(null)} 
                  className="p-3 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-2xl transition-all"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {quickAction === 'fine' && <RecordFine group={group} period={period} onSuccess={() => setQuickAction(null)} />}
              
              {quickAction === 'payment' && (
                <QuickPayment 
                  group={group} 
                  period={period} 
                  onSuccess={() => setQuickAction(null)} 
                  onCancel={() => setQuickAction(null)} 
                />
              )}

              {(quickAction === 'income' || quickAction === 'expense') && (
                <ManualTransactionForm 
                  group={group} 
                  period={period} 
                  type={quickAction} 
                  onSuccess={() => setQuickAction(null)} 
                  onCancel={() => setQuickAction(null)} 
                />
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
