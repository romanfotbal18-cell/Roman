/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, signInWithGoogle, logout } from './firebase';
import { Group, Period } from './types';
import Login from './components/Login';
import GroupSelector from './components/GroupSelector';
import PeriodSelector from './components/PeriodSelector';
import MainLayout from './components/MainLayout';
import { Loader2 } from 'lucide-react';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<Period | null>(null);

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!user) {
    return <Login onLogin={signInWithGoogle} />;
  }

  if (!selectedGroup) {
    return <GroupSelector onSelect={setSelectedGroup} onLogout={logout} />;
  }

  if (!selectedPeriod) {
    return (
      <PeriodSelector
        group={selectedGroup}
        onSelect={setSelectedPeriod}
        onBack={() => setSelectedGroup(null)}
      />
    );
  }

  return (
    <MainLayout
      user={user}
      group={selectedGroup}
      period={selectedPeriod}
      onBackToPeriods={() => setSelectedPeriod(null)}
      onBackToGroups={() => {
        setSelectedPeriod(null);
        setSelectedGroup(null);
      }}
    />
  );
}
