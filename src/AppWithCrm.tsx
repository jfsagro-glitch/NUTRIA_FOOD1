/**
 * AppWithCrm.tsx
 *
 * Обёртка вокруг ClientApp.tsx (бывший App.tsx), добавляющая:
 * - Auth gate (логин нутрициолога)
 * - Role-based routing: NUTRITIONIST → CrmApp, CLIENT → ClientApp (дневник питания)
 */

import React, { useState, useEffect } from 'react';
import { LoginPage } from './LoginPage.tsx';
import { CrmApp } from './CrmApp.tsx';
import ClientApp from './ClientApp.tsx';
import { Loader2, Leaf } from 'lucide-react';

interface AuthUser {
  id: string;
  email: string;
  role: string;
  profile?: any;
}

export default function AppWithCrm() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Проверяем текущую сессию при старте
  useEffect(() => {
    fetch('/api/crm/auth/me', { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (data?.user) setUser(data.user);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function handleAuth(authUser: AuthUser) {
    setUser(authUser);
  }

  function handleLogout() {
    setUser(null);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center">
            <Leaf size={20} className="text-white" />
          </div>
          <Loader2 size={20} className="animate-spin text-zinc-500" />
        </div>
      </div>
    );
  }

  // Нутрициолог → CRM
  if (user?.role === 'NUTRITIONIST') {
    return <CrmApp user={user} onLogout={handleLogout} />;
  }

  // Клиент → дневник питания (существующий App)
  if (user?.role === 'CLIENT') {
    return <ClientApp />;
  }

  // Не авторизован → логин
  return <LoginPage onAuth={handleAuth} />;
}
