import { useState, useEffect } from 'react';
import { Sun, Moon } from 'lucide-react';

interface ThemeToggleProps {
  showLabel?: boolean;
  className?: string;
}

export default function ThemeToggle({ showLabel = false, className = '' }: ThemeToggleProps) {
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem('theme');
    if (saved) {
      return saved === 'dark';
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDark]);

  const toggleTheme = () => {
    setIsDark(prev => !prev);
  };

  if (showLabel) {
    return (
      <button
        onClick={toggleTheme}
        className={`flex items-center justify-between w-full px-4 py-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-2xl font-bold text-xs transition-all border border-slate-200/80 dark:border-slate-700/80 active:scale-98 ${className}`}
        title={isDark ? "Přepnout na světlý režim" : "Přepnout na tmavý režim"}
      >
        <div className="flex items-center gap-2.5">
          {isDark ? (
            <Sun className="w-4 h-4 text-amber-400 shrink-0" />
          ) : (
            <Moon className="w-4 h-4 text-indigo-500 shrink-0" />
          )}
          <span>Režim vzhledu</span>
        </div>
        <span className="px-2 py-0.5 rounded-md bg-white/60 dark:bg-slate-900/60 text-[10px] uppercase font-black tracking-wider text-slate-500 dark:text-slate-400">
          {isDark ? 'Tmavý' : 'Světlý'}
        </span>
      </button>
    );
  }

  return (
    <button
      onClick={toggleTheme}
      className={`p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 rounded-xl transition-all active:scale-95 flex items-center justify-center shadow-sm border border-slate-200/60 dark:border-slate-700/60 ${className}`}
      title={isDark ? "Přepnout na světlý režim" : "Přepnout na tmavý režim"}
    >
      {isDark ? (
        <Sun className="w-4 h-4 text-amber-400" />
      ) : (
        <Moon className="w-4 h-4 text-indigo-500" />
      )}
    </button>
  );
}

