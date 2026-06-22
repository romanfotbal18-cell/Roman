import { useState, useEffect } from 'react';
import { Sun, Moon } from 'lucide-react';

export default function ThemeToggle() {
  const [isDark, setIsDark] = useState(() => {
    // Check local storage and default to prefers-color-scheme
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

  return (
    <button
      onClick={() => setIsDark(!isDark)}
      className="p-3 bg-slate-100 hover:bg-slate-200 text-slate-600 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 rounded-[1.25rem] transition-all active:scale-95 flex items-center justify-center shadow-sm border border-slate-200/50 dark:border-slate-700/50"
      title={isDark ? "Přepnout na světlý režim" : "Přepnout na tmavý režim"}
    >
      {isDark ? (
        <Sun className="w-5 h-5 text-amber-500 animate-spin-slow" />
      ) : (
        <Moon className="w-5 h-5 text-indigo-500 animate-pulse-slow" />
      )}
    </button>
  );
}
