import React, { useState, useEffect } from 'react';
import { Leaf, Loader2, CheckCircle2, AlertCircle, ChevronRight } from 'lucide-react';

interface Props {
  token: string;
  onComplete: (user: { id: string; email: string; role: string }, token: string) => void;
}

type Step = 'loading' | 'invalid' | 'phrase' | 'password' | 'profile' | 'done';

const ROLE_LABEL: Record<string, string> = { CLIENT: 'клиента', NUTRITIONIST: 'нутрициолога', ADMIN: 'администратора' };

const ACTIVITY_LABELS: Record<string, string> = {
  low: 'Низкая (сидячая работа)',
  moderate: 'Умеренная (лёгкая активность)',
  high: 'Высокая (спорт 3–5 дней/нед)',
  very_high: 'Очень высокая (ежедневный спорт)',
};

const GOAL_LABELS: Record<string, string> = {
  lose: 'Снижение веса',
  maintain: 'Сохранение веса',
  gain: 'Набор массы',
  recomposition: 'Рекомпозиция',
};

export function ClientOnboard({ token, onComplete }: Props) {
  const [step, setStep] = useState<Step>('loading');
  const [inviteInfo, setInviteInfo] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [secretPhrase, setSecretPhrase] = useState('');
  const [password, setPassword] = useState('');
  const [profile, setProfile] = useState({
    firstName: '',
    lastName: '',
    birthYear: '',
    sex: '',
    heightCm: '',
    weightKg: '',
    goal: '',
    activity: '',
    dietRestrictions: '',
    allergies: [] as string[],
    complaints: '',
  });

  // Загружаем информацию о приглашении
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/onboard/${token}`);
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || 'Ссылка недействительна');
          setStep('invalid');
          return;
        }
        setInviteInfo(data);
        // Приглашения с email (созданы админом — любая роль) регистрируются по паролю,
        // без секретной фразы — она для них никому не сообщается.
        setStep(data.email ? 'password' : 'phrase');
      } catch {
        setError('Не удалось загрузить приглашение');
        setStep('invalid');
      }
    })();
  }, [token]);

  async function handlePhrase(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Если уже зарегистрирован — просто логинимся
      if (inviteInfo?.alreadyUsed) {
        const res = await fetch(`/api/onboard/${token}/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ secretPhrase }),
          credentials: 'include',
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Неверная фраза');
        onComplete(data.user, data.token);
        return;
      }
      // Иначе — идём на заполнение анкеты
      // Проверяем фразу сначала на сервере (пробный запрос без profile)
      setStep('profile');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Приглашения с email (админ выбрал роль CLIENT/NUTRITIONIST/ADMIN): регистрация
  // паролем вместо секретной фразы. Для CLIENT после этого шага ещё идёт анкета
  // здоровья ('profile'); для NUTRITIONIST/ADMIN регистрация завершается сразу здесь.
  async function handlePassword(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (inviteInfo?.alreadyUsed) {
        const res = await fetch(`/api/onboard/${token}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
          credentials: 'include',
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Неверный пароль');
        onComplete(data.user, data.token);
        return;
      }

      if (inviteInfo?.role === 'CLIENT') {
        setStep('profile');
        return;
      }

      const res = await fetch(`/api/onboard/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, firstName: profile.firstName, lastName: profile.lastName }),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка регистрации');
      setStep('done');
      setTimeout(() => onComplete(data.user, data.token), 1500);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleProfile(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch(`/api/onboard/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secretPhrase: inviteInfo?.email ? undefined : secretPhrase,
          password: inviteInfo?.email ? password : undefined,
          profile: {
            ...profile,
            birthYear: profile.birthYear ? Number(profile.birthYear) : undefined,
            heightCm: profile.heightCm ? Number(profile.heightCm) : undefined,
            weightKg: profile.weightKg ? Number(profile.weightKg) : undefined,
          },
        }),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка регистрации');
      setStep('done');
      setTimeout(() => onComplete(data.user, data.token), 1500);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const setP = (field: string, val: string) => setProfile(p => ({ ...p, [field]: val }));

  const toggleAllergy = (val: string) =>
    setProfile(p => ({
      ...p,
      allergies: p.allergies.includes(val) ? p.allergies.filter(a => a !== val) : [...p.allergies, val],
    }));

  if (step === 'loading') {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-emerald-500" />
      </div>
    );
  }

  if (step === 'invalid') {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <AlertCircle size={48} className="text-red-400 mx-auto mb-4" />
          <h2 className="text-white text-xl font-semibold mb-2">Ссылка недействительна</h2>
          <p className="text-zinc-400 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (step === 'done') {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <CheckCircle2 size={56} className="text-emerald-500 mx-auto mb-4" />
          <h2 className="text-white text-xl font-semibold mb-2">Готово!</h2>
          <p className="text-zinc-400 text-sm">
            {inviteInfo?.role === 'CLIENT' ? 'Переходим к вашему дневнику питания…' : 'Переходим в CRM…'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Логотип */}
        <div className="flex items-center gap-2 justify-center mb-6">
          <div className="w-9 h-9 rounded-xl bg-emerald-500 flex items-center justify-center">
            <Leaf size={18} className="text-white" />
          </div>
          <span className="text-xl font-bold text-white tracking-tight">Nütria</span>
        </div>

        <div className="bg-zinc-900 rounded-2xl p-6 border border-zinc-800">
          {/* Шаг 1: секретная фраза */}
          {step === 'phrase' && (
            <>
              <div className="mb-5">
                <p className="text-zinc-400 text-sm mb-1">Приглашение от</p>
                <p className="text-white font-medium">{inviteInfo?.nutritionistName}</p>
                {inviteInfo?.clientName && (
                  <p className="text-emerald-400 text-sm mt-1">Для: {inviteInfo.clientName}</p>
                )}
              </div>

              <h2 className="text-white text-lg font-semibold mb-1">
                {inviteInfo?.alreadyUsed ? 'Добро пожаловать обратно' : 'Добро пожаловать в Nütria'}
              </h2>
              <p className="text-zinc-400 text-sm mb-5">
                {inviteInfo?.alreadyUsed
                  ? 'Введите секретную фразу для входа'
                  : 'Введите секретную фразу, которую дал вам нутрициолог'}
              </p>

              <form onSubmit={handlePhrase} className="space-y-4">
                <div>
                  <input
                    type="text"
                    value={secretPhrase}
                    onChange={e => setSecretPhrase(e.target.value)}
                    placeholder="Секретная фраза"
                    required
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                {error && <p className="text-red-400 text-sm">{error}</p>}

                <button
                  type="submit"
                  disabled={loading || !secretPhrase.trim()}
                  className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-medium py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <ChevronRight size={16} />}
                  {inviteInfo?.alreadyUsed ? 'Войти' : 'Продолжить'}
                </button>
              </form>
            </>
          )}

          {/* Шаг 1 (альтернатива): регистрация паролем — для приглашений с email
              (любая роль: клиент/нутрициолог/администратор) */}
          {step === 'password' && (
            <>
              <div className="mb-5">
                <p className="text-zinc-400 text-sm mb-1">Приглашение от</p>
                <p className="text-white font-medium">{inviteInfo?.nutritionistName}</p>
                <p className="text-emerald-400 text-sm mt-1">
                  Роль: {ROLE_LABEL[inviteInfo?.role] || inviteInfo?.role}
                </p>
              </div>

              <h2 className="text-white text-lg font-semibold mb-1">
                {inviteInfo?.alreadyUsed ? 'Добро пожаловать обратно' : 'Добро пожаловать в Nütria'}
              </h2>
              <p className="text-zinc-400 text-sm mb-5">
                {inviteInfo?.alreadyUsed
                  ? 'Введите пароль для входа'
                  : `Придумайте пароль, чтобы завершить регистрацию (${inviteInfo?.email})`}
              </p>

              <form onSubmit={handlePassword} className="space-y-4">
                {!inviteInfo?.alreadyUsed && (
                  <div className="grid grid-cols-2 gap-3">
                    <input type="text" value={profile.firstName} onChange={e => setP('firstName', e.target.value)}
                      placeholder="Имя" required
                      className="bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500" />
                    <input type="text" value={profile.lastName} onChange={e => setP('lastName', e.target.value)}
                      placeholder="Фамилия"
                      className="bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500" />
                  </div>
                )}
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Пароль"
                  minLength={6}
                  required
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
                />

                {error && <p className="text-red-400 text-sm">{error}</p>}

                <button
                  type="submit"
                  disabled={loading || password.length < 6 || (!inviteInfo?.alreadyUsed && !profile.firstName.trim())}
                  className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-medium py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <ChevronRight size={16} />}
                  {inviteInfo?.alreadyUsed ? 'Войти' : inviteInfo?.role === 'CLIENT' ? 'Продолжить' : 'Завершить регистрацию'}
                </button>
              </form>
            </>
          )}

          {/* Шаг 2: анкета */}
          {step === 'profile' && (
            <>
              <h2 className="text-white text-lg font-semibold mb-1">Расскажите о себе</h2>
              <p className="text-zinc-400 text-sm mb-5">
                Данные нужны для расчёта калорий и нутриентов. Можно пропустить — нутрициолог заполнит позже.
              </p>

              <form onSubmit={handleProfile} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-zinc-400 mb-1 block">Имя</label>
                    <input type="text" value={profile.firstName} onChange={e => setP('firstName', e.target.value)}
                      placeholder="Анна"
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500" />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-400 mb-1 block">Фамилия</label>
                    <input type="text" value={profile.lastName} onChange={e => setP('lastName', e.target.value)}
                      placeholder="Иванова"
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500" />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-zinc-400 mb-1 block">Год рождения</label>
                    <input type="number" value={profile.birthYear} onChange={e => setP('birthYear', e.target.value)}
                      placeholder="1990" min="1920" max="2010"
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500" />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-400 mb-1 block">Рост, см</label>
                    <input type="number" value={profile.heightCm} onChange={e => setP('heightCm', e.target.value)}
                      placeholder="165" min="100" max="250"
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500" />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-400 mb-1 block">Вес, кг</label>
                    <input type="number" value={profile.weightKg} onChange={e => setP('weightKg', e.target.value)}
                      placeholder="60" min="30" max="300"
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500" />
                  </div>
                </div>

                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Пол</label>
                  <div className="flex gap-2">
                    {[{ val: 'female', label: 'Женский' }, { val: 'male', label: 'Мужской' }].map(o => (
                      <button key={o.val} type="button" onClick={() => setP('sex', o.val)}
                        className={`flex-1 py-2 rounded-lg text-sm border transition-colors ${
                          profile.sex === o.val
                            ? 'bg-emerald-500 border-emerald-500 text-white'
                            : 'border-zinc-700 text-zinc-400 hover:border-zinc-600'
                        }`}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Цель</label>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(GOAL_LABELS).map(([val, label]) => (
                      <button key={val} type="button" onClick={() => setP('goal', val)}
                        className={`py-2 rounded-lg text-sm border transition-colors ${
                          profile.goal === val
                            ? 'bg-emerald-500 border-emerald-500 text-white'
                            : 'border-zinc-700 text-zinc-400 hover:border-zinc-600'
                        }`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Активность</label>
                  <div className="space-y-2">
                    {Object.entries(ACTIVITY_LABELS).map(([val, label]) => (
                      <button key={val} type="button" onClick={() => setP('activity', val)}
                        className={`w-full py-2 px-3 text-left rounded-lg text-sm border transition-colors ${
                          profile.activity === val
                            ? 'bg-emerald-500 border-emerald-500 text-white'
                            : 'border-zinc-700 text-zinc-400 hover:border-zinc-600'
                        }`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs text-zinc-400 mb-2 block">Аллергии / непереносимости</label>
                  <div className="flex flex-wrap gap-2">
                    {['Глютен', 'Лактоза', 'Орехи', 'Морепродукты', 'Яйца', 'Соя'].map(a => (
                      <button key={a} type="button" onClick={() => toggleAllergy(a)}
                        className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                          profile.allergies.includes(a)
                            ? 'bg-emerald-500 border-emerald-500 text-white'
                            : 'border-zinc-700 text-zinc-400 hover:border-zinc-600'
                        }`}>
                        {a}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Жалобы / пожелания (кратко)</label>
                  <textarea value={profile.complaints} onChange={e => setP('complaints', e.target.value)}
                    rows={2} placeholder="Например: постоянная усталость, вздутие после молока…"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500 resize-none" />
                </div>

                {error && <p className="text-red-400 text-sm">{error}</p>}

                <div className="flex gap-3">
                  <button type="button" onClick={handleProfile as any}
                    className="flex-1 border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-600 py-3 rounded-xl text-sm transition-colors">
                    Пропустить
                  </button>
                  <button type="submit" disabled={loading}
                    className="flex-1 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-medium py-3 rounded-xl transition-colors flex items-center justify-center gap-2">
                    {loading ? <Loader2 size={16} className="animate-spin" /> : null}
                    Готово
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
