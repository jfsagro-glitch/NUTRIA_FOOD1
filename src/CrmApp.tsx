import React, { useState, useEffect, useCallback } from 'react';
import {
  Users, ChevronRight, Plus, X, LogOut, Search, Filter,
  FileText, Clipboard, BarChart3, MessageSquare, Star,
  Calendar, Loader2, Upload, Trash2, Edit3, Check,
  AlertCircle, RefreshCw, Leaf, ChevronLeft, Tag,
  User, Activity, Scale, Ruler, Target, Zap, Flame,
  Download, Copy, ExternalLink, Send, Smartphone
} from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...args: any[]) { return twMerge(clsx(args)); }

// ─── Типы ──────────────────────────────────────────────────────────────────

interface NutritionistUser {
  id: string;
  email: string;
  role: string;
  profile?: { firstName: string; lastName: string; specialization?: string };
}

type ClientStatus = 'PENDING' | 'ACTIVE' | 'ARCHIVED';
type ClientTab = 'questionnaire' | 'diary' | 'weight' | 'analyses' | 'notes' | 'recommendations' | 'messages';
type ClientSource = 'invite' | 'telegram' | 'self';

interface Client {
  inviteId: string | null;
  token: string | null;
  clientId: string | null;
  clientName: string;
  status: ClientStatus;
  tagsJson: string;
  createdAt: string;
  usedAt?: string;
  source: ClientSource;
  nutritionistName?: string | null;
  isOwnInvite?: boolean;
  lastActivityAt?: string | null;
  profile?: { sex: string; weightKg: number; heightCm: number; goal: string } | null;
}

interface ClientDetail {
  invite: any;
  profile: any;
  calculations: {
    bmi: number; bmr: number; tdee: number;
    calories: number; protein: number; fat: number; carbs: number; fiber: number;
  } | null;
}

// ─── Хуки API ──────────────────────────────────────────────────────────────

function useApi() {
  const get = async (url: string) => {
    const res = await fetch(url, { credentials: 'include' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
    return data;
  };
  const post = async (url: string, body: any) => {
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), credentials: 'include',
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
    return data;
  };
  const patch = async (url: string, body: any) => {
    const res = await fetch(url, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), credentials: 'include',
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
    return data;
  };
  const del = async (url: string) => {
    const res = await fetch(url, { method: 'DELETE', credentials: 'include' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
    return data;
  };
  const postForm = async (url: string, form: FormData) => {
    const res = await fetch(url, { method: 'POST', body: form, credentials: 'include' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка загрузки');
    return data;
  };
  return { get, post, patch, del, postForm };
}

// ─── Вспомогательные компоненты ────────────────────────────────────────────

function Tag_({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-zinc-800 text-zinc-300 border border-zinc-700">
      {label}
      {onRemove && (
        <button onClick={onRemove} className="hover:text-red-400"><X size={10} /></button>
      )}
    </span>
  );
}

function StatCard({ icon, label, value, unit, sub }: { icon: React.ReactNode; label: string; value: string | number; unit?: string; sub?: string }) {
  return (
    <div className="bg-zinc-800/60 rounded-xl p-4 border border-zinc-700/50">
      <div className="flex items-center gap-2 mb-2 text-zinc-400 text-xs">{icon}<span>{label}</span></div>
      <div className="text-white text-2xl font-bold">{value}<span className="text-base text-zinc-400 ml-1">{unit}</span></div>
      {sub && <div className="text-zinc-500 text-xs mt-1">{sub}</div>}
    </div>
  );
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
      <div className="mb-3 opacity-40">{icon}</div>
      <p className="text-sm">{text}</p>
    </div>
  );
}

// ─── Вкладка: Анкета ──────────────────────────────────────────────────────

function QuestionnaireTab({ clientId, detail, onUpdated }: { clientId: string; detail: ClientDetail | null; onUpdated: () => void }) {
  const api = useApi();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>({});
  const [err, setErr] = useState('');

  useEffect(() => {
    if (detail?.profile) {
      const p = detail.profile;
      setForm({
        firstName: p.firstName || '',
        lastName: p.lastName || '',
        birthYear: p.birthYear || '',
        sex: p.sex || '',
        heightCm: p.heightCm || '',
        weightKg: p.weightKg || '',
        goal: p.goal || '',
        activity: p.activity || '',
        dietRestrictions: p.dietRestrictions || '',
        allergies: JSON.parse(p.allergiesJson || '[]'),
        complaints: p.complaints || '',
        sleepQuality: p.sleepQuality || '',
        badHabits: p.badHabits || '',
        chronicDiseases: p.chronicDiseases || '',
        surgeries: p.surgeries || '',
        medications: p.medications || '',
        gutHealth: p.gutHealth || '',
      });
    }
  }, [detail]);

  const s = (f: string, v: any) => setForm((p: any) => ({ ...p, [f]: v }));
  const toggleAllergy = (a: string) =>
    setForm((p: any) => ({ ...p, allergies: p.allergies?.includes(a) ? p.allergies.filter((x: string) => x !== a) : [...(p.allergies || []), a] }));

  async function save() {
    setSaving(true); setErr('');
    try {
      await api.patch(`/api/crm/clients/${clientId}/profile`, { ...form });
      setEditing(false);
      onUpdated();
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  }

  const calc = detail?.calculations;
  const GOALS: Record<string, string> = { lose: 'Снижение', maintain: 'Сохранение', gain: 'Набор', recomposition: 'Рекомпозиция' };
  const ACTS: Record<string, string> = { low: 'Низкая', moderate: 'Умеренная', high: 'Высокая', very_high: 'Очень высокая' };

  return (
    <div className="space-y-6">
      {/* Расчёты */}
      {calc && (
        <div>
          <h3 className="text-white font-medium mb-3 text-sm uppercase tracking-wider">Авторасчёты</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard icon={<Scale size={14}/>} label="ИМТ" value={calc.bmi} sub={calc.bmi < 18.5 ? 'Дефицит' : calc.bmi < 25 ? 'Норма' : calc.bmi < 30 ? 'Избыток' : 'Ожирение'} />
            <StatCard icon={<Zap size={14}/>} label="BMR" value={calc.bmr} unit="ккал" sub="Базовый обмен" />
            <StatCard icon={<Activity size={14}/>} label="TDEE" value={calc.tdee} unit="ккал" sub="С учётом активности" />
            <StatCard icon={<Flame size={14}/>} label="Цель" value={calc.calories} unit="ккал" sub={`Б:${calc.protein}г Ж:${calc.fat}г У:${calc.carbs}г`} />
          </div>
        </div>
      )}

      {/* Профиль */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-white font-medium text-sm uppercase tracking-wider">Анкета</h3>
          {!editing
            ? <button onClick={() => setEditing(true)} className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300"><Edit3 size={12}/> Редактировать</button>
            : <div className="flex items-center gap-2">
                <button onClick={() => setEditing(false)} className="text-xs text-zinc-400 hover:text-white">Отмена</button>
                <button onClick={save} disabled={saving} className="flex items-center gap-1 text-xs bg-emerald-500 hover:bg-emerald-400 text-white px-3 py-1.5 rounded-lg">
                  {saving ? <Loader2 size={12} className="animate-spin"/> : <Check size={12}/>} Сохранить
                </button>
              </div>
          }
        </div>

        {err && <p className="text-red-400 text-sm mb-3">{err}</p>}

        {editing ? (
          <div className="bg-zinc-800/40 rounded-xl p-4 border border-zinc-700/50 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {[['firstName','Имя'],['lastName','Фамилия']].map(([f,l]) => (
                <div key={f}>
                  <label className="text-xs text-zinc-400 mb-1 block">{l}</label>
                  <input value={form[f]||''} onChange={e => s(f, e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"/>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[['birthYear','Год рожд.','number'],['heightCm','Рост, см','number'],['weightKg','Вес, кг','number']].map(([f,l,t]) => (
                <div key={f}>
                  <label className="text-xs text-zinc-400 mb-1 block">{l}</label>
                  <input type={t} value={form[f]||''} onChange={e => s(f, e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"/>
                </div>
              ))}
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Пол</label>
              <div className="flex gap-2">
                {[['female','Женский'],['male','Мужской']].map(([v,l]) => (
                  <button key={v} type="button" onClick={() => s('sex', v)}
                    className={cn("flex-1 py-1.5 rounded-lg text-sm border transition-colors", form.sex===v ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-zinc-700 text-zinc-400')}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Цель</label>
                <select value={form.goal||''} onChange={e => s('goal', e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500">
                  <option value="">—</option>
                  {Object.entries(GOALS).map(([v,l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Активность</label>
                <select value={form.activity||''} onChange={e => s('activity', e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500">
                  <option value="">—</option>
                  {Object.entries(ACTS).map(([v,l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Аллергии</label>
              <div className="flex flex-wrap gap-2">
                {['Глютен','Лактоза','Орехи','Морепродукты','Яйца','Соя'].map(a => (
                  <button key={a} type="button" onClick={() => toggleAllergy(a)}
                    className={cn("px-2 py-1 rounded-full text-xs border", (form.allergies||[]).includes(a) ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-zinc-700 text-zinc-400')}>
                    {a}
                  </button>
                ))}
              </div>
            </div>
            {[['dietRestrictions','Ограничения в питании'],['chronicDiseases','Хронические заболевания'],['medications','Лекарства / БАДы'],['complaints','Жалобы'],['gutHealth','Работа ЖКТ']].map(([f,l]) => (
              <div key={f}>
                <label className="text-xs text-zinc-400 mb-1 block">{l}</label>
                <textarea value={form[f]||''} onChange={e => s(f, e.target.value)} rows={2}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 resize-none"/>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-zinc-800/40 rounded-xl p-4 border border-zinc-700/50">
            {!detail?.profile ? (
              <p className="text-zinc-500 text-sm">Анкета не заполнена. Нажмите «Редактировать» или попросите клиента заполнить при онбординге.</p>
            ) : (
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                {[
                  ['Имя', detail.profile.firstName],
                  ['Фамилия', detail.profile.lastName],
                  ['Год рождения', detail.profile.birthYear],
                  ['Пол', detail.profile.sex === 'male' ? 'Мужской' : detail.profile.sex === 'female' ? 'Женский' : '—'],
                  ['Рост', detail.profile.heightCm ? `${detail.profile.heightCm} см` : '—'],
                  ['Вес', detail.profile.weightKg ? `${detail.profile.weightKg} кг` : '—'],
                  ['Цель', GOALS[detail.profile.goal] || '—'],
                  ['Активность', ACTS[detail.profile.activity] || '—'],
                  ['Ограничения', detail.profile.dietRestrictions || '—'],
                  ['Аллергии', JSON.parse(detail.profile.allergiesJson || '[]').join(', ') || '—'],
                  ['Жалобы', detail.profile.complaints || '—'],
                  ['Лекарства', detail.profile.medications || '—'],
                ].map(([l, v]) => (
                  <div key={l}>
                    <span className="text-zinc-500">{l}: </span>
                    <span className="text-white">{v || '—'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Вкладка: Дневник ─────────────────────────────────────────────────────

function DiaryTab({ clientId }: { clientId: string }) {
  const api = useApi();
  const [meals, setMeals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get(`/api/crm/clients/${clientId}/diary?days=${days}`);
      setMeals(data.meals || []);
    } catch {}
    finally { setLoading(false); }
  }, [clientId, days]);

  useEffect(() => { load(); }, [load]);

  const MEAL_NAMES: Record<string, string> = {
    BREAKFAST: 'Завтрак', LUNCH: 'Обед', DINNER: 'Ужин', SNACK: 'Перекус'
  };

  function calcTotals(items: any[]) {
    return items.reduce((acc, item) => {
      const f = item.product;
      const k = item.amount / 100;
      return {
        cal: acc.cal + f.calories * k,
        prot: acc.prot + f.protein * k,
        fat: acc.fat + f.fat * k,
        carb: acc.carb + f.carbs * k,
      };
    }, { cal: 0, prot: 0, fat: 0, carb: 0 });
  }

  // Группируем по датам
  const byDate: Record<string, any[]> = {};
  meals.forEach(m => {
    const d = new Date(m.date).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' });
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(m);
  });

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        {[3, 7, 14].map(d => (
          <button key={d} onClick={() => setDays(d)}
            className={cn("px-3 py-1.5 rounded-lg text-sm border transition-colors",
              days === d ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-zinc-700 text-zinc-400 hover:border-zinc-600')}>
            {d} дней
          </button>
        ))}
        <button onClick={load} className="ml-auto text-zinc-400 hover:text-white"><RefreshCw size={16}/></button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-zinc-500"/></div>
      ) : Object.keys(byDate).length === 0 ? (
        <EmptyState icon={<Clipboard size={40}/>} text="Дневник пуст — клиент ещё не добавлял приёмы пищи"/>
      ) : (
        <div className="space-y-4">
          {Object.entries(byDate).map(([date, dayMeals]) => {
            const dayTotals = dayMeals.reduce((acc, m) => {
              const t = calcTotals(m.items);
              return { cal: acc.cal + t.cal, prot: acc.prot + t.prot, fat: acc.fat + t.fat, carb: acc.carb + t.carb };
            }, { cal: 0, prot: 0, fat: 0, carb: 0 });

            return (
              <div key={date} className="bg-zinc-800/40 rounded-xl border border-zinc-700/50">
                <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700/50">
                  <span className="text-white font-medium text-sm capitalize">{date}</span>
                  <span className="text-zinc-400 text-xs">{Math.round(dayTotals.cal)} ккал · Б:{Math.round(dayTotals.prot)} Ж:{Math.round(dayTotals.fat)} У:{Math.round(dayTotals.carb)}</span>
                </div>
                <div className="divide-y divide-zinc-700/30">
                  {dayMeals.map((meal: any) => {
                    const t = calcTotals(meal.items);
                    return (
                      <div key={meal.id} className="px-4 py-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-zinc-300 text-sm font-medium">{MEAL_NAMES[meal.type] || meal.type}</span>
                          <span className="text-zinc-500 text-xs">{Math.round(t.cal)} ккал</span>
                        </div>
                        <div className="space-y-1">
                          {meal.items.map((item: any) => (
                            <div key={item.id} className="flex justify-between text-xs text-zinc-400">
                              <span>{item.product.name}</span>
                              <span>{item.amount}г · {Math.round(item.product.calories * item.amount / 100)} ккал</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Вкладка: Анализы ─────────────────────────────────────────────────────

function AnalysesTab({ clientId }: { clientId: string }) {
  const api = useApi();
  const [analyses, setAnalyses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [note, setNote] = useState('');
  const [takenAt, setTakenAt] = useState('');
  const [showForm, setShowForm] = useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const d = await api.get(`/api/crm/clients/${clientId}/analyses`); setAnalyses(d.analyses || []); }
    catch {} finally { setLoading(false); }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      if (note) form.append('note', note);
      if (takenAt) form.append('takenAt', takenAt);
      await api.postForm(`/api/crm/clients/${clientId}/analyses`, form);
      setShowForm(false); setNote(''); setTakenAt('');
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (e: any) { alert(e.message); }
    finally { setUploading(false); }
  }

  async function deleteAnalysis(id: string) {
    if (!confirm('Удалить файл анализов?')) return;
    try { await api.del(`/api/crm/clients/${clientId}/analyses/${id}`); await load(); }
    catch (e: any) { alert(e.message); }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <span className="text-zinc-400 text-sm">{analyses.length} файлов</span>
        <button onClick={() => setShowForm(s => !s)}
          className="flex items-center gap-1.5 text-sm bg-emerald-500 hover:bg-emerald-400 text-white px-3 py-2 rounded-lg">
          <Upload size={14}/> Загрузить
        </button>
      </div>

      {showForm && (
        <div className="bg-zinc-800/60 rounded-xl p-4 border border-zinc-700/50 mb-4 space-y-3">
          <input type="file" ref={fileRef} accept="image/*,.pdf"
            className="w-full text-sm text-zinc-400 file:bg-zinc-700 file:text-white file:border-0 file:rounded-lg file:px-3 file:py-1.5 file:text-sm file:cursor-pointer" />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Дата анализа</label>
              <input type="date" value={takenAt} onChange={e => setTakenAt(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500" />
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Заметка</label>
              <input value={note} onChange={e => setNote(e.target.value)} placeholder="Общий анализ крови"
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowForm(false)} className="flex-1 border border-zinc-700 text-zinc-400 py-2 rounded-lg text-sm hover:text-white">Отмена</button>
            <button onClick={upload} disabled={uploading}
              className="flex-1 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white py-2 rounded-lg text-sm flex items-center justify-center gap-2">
              {uploading ? <Loader2 size={14} className="animate-spin"/> : null} Загрузить
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-zinc-500"/></div>
      ) : analyses.length === 0 ? (
        <EmptyState icon={<FileText size={40}/>} text="Анализы ещё не загружены"/>
      ) : (
        <div className="space-y-2">
          {analyses.map((a: any) => (
            <div key={a.id} className="flex items-center gap-3 bg-zinc-800/40 rounded-xl px-4 py-3 border border-zinc-700/50">
              <FileText size={18} className="text-emerald-400 shrink-0"/>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-medium truncate">{a.fileName}</p>
                <p className="text-zinc-500 text-xs">
                  {a.takenAt ? new Date(a.takenAt).toLocaleDateString('ru-RU') : '—'}
                  {a.note && ` · ${a.note}`}
                </p>
              </div>
              <a href={`/api/crm/clients/${clientId}/analyses/${a.id}/download`} target="_blank" rel="noopener noreferrer"
                className="text-zinc-400 hover:text-emerald-400"><Download size={16}/></a>
              <button onClick={() => deleteAnalysis(a.id)} className="text-zinc-400 hover:text-red-400"><Trash2 size={16}/></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Вкладка: Вес ──────────────────────────────────────────────────────────

function WeightTab({ clientId }: { clientId: string }) {
  const api = useApi();
  const [history, setHistory] = useState<{ date: string; weightKg: number }[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { const d = await api.get(`/api/crm/clients/${clientId}/weight-history?days=90`); setHistory(d.history || []); }
    catch {} finally { setLoading(false); }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-zinc-500"/></div>;
  if (history.length === 0) return <EmptyState icon={<Scale size={36}/>} text="Клиент пока не записывал вес"/>;

  const values = history.map(p => p.weightKg);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(0.5, max - min);
  const width = 600, height = 120;
  const points = history.map((p, i) => {
    const x = (i / Math.max(1, history.length - 1)) * width;
    const y = height - ((p.weightKg - min) / range) * height;
    return `${x},${y}`;
  }).join(' ');

  return (
    <div>
      <div className="bg-zinc-800/40 rounded-xl p-4 border border-zinc-700/50 mb-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-zinc-400 text-xs">Динамика веса за 90 дней</p>
          <p className="text-white text-sm font-medium">{values[values.length - 1]} кг</p>
        </div>
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-28">
          <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" className="text-emerald-400"/>
        </svg>
        <div className="flex justify-between text-[11px] text-zinc-500 mt-1">
          <span>{min} кг</span>
          <span>{max} кг</span>
        </div>
      </div>

      <div className="space-y-2">
        {history.slice().reverse().map(h => (
          <div key={h.date} className="flex items-center justify-between bg-zinc-800/40 rounded-xl px-4 py-3 border border-zinc-700/50">
            <span className="text-zinc-400 text-sm">{new Date(h.date).toLocaleDateString('ru-RU')}</span>
            <span className="text-white text-sm font-medium">{h.weightKg} кг</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Вкладка: Заметки ─────────────────────────────────────────────────────

function NotesTab({ clientId }: { clientId: string }) {
  const api = useApi();
  const [notes, setNotes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const d = await api.get(`/api/crm/clients/${clientId}/notes`); setNotes(d.notes || []); }
    catch {} finally { setLoading(false); }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  async function addNote() {
    if (!content.trim()) return;
    setSaving(true);
    try { await api.post(`/api/crm/clients/${clientId}/notes`, { content }); setContent(''); await load(); }
    catch (e: any) { alert(e.message); }
    finally { setSaving(false); }
  }

  async function deleteNote(id: string) {
    try { await api.del(`/api/crm/clients/${clientId}/notes/${id}`); await load(); }
    catch {}
  }

  return (
    <div>
      <div className="bg-zinc-800/40 rounded-xl p-4 border border-zinc-700/50 mb-4">
        <textarea value={content} onChange={e => setContent(e.target.value)}
          placeholder="Добавьте заметку о клиенте…"
          rows={3}
          className="w-full bg-transparent text-white placeholder-zinc-500 text-sm focus:outline-none resize-none"/>
        <div className="flex justify-end mt-2">
          <button onClick={addNote} disabled={saving || !content.trim()}
            className="flex items-center gap-1.5 text-sm bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white px-4 py-2 rounded-lg">
            {saving ? <Loader2 size={14} className="animate-spin"/> : <Plus size={14}/>} Добавить
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-zinc-500"/></div>
      ) : notes.length === 0 ? (
        <EmptyState icon={<MessageSquare size={36}/>} text="Заметок пока нет"/>
      ) : (
        <div className="space-y-3">
          {notes.map((n: any) => (
            <div key={n.id} className="bg-zinc-800/40 rounded-xl px-4 py-3 border border-zinc-700/50 group relative">
              <p className="text-white text-sm whitespace-pre-wrap">{n.content}</p>
              <p className="text-zinc-500 text-xs mt-2">{new Date(n.createdAt).toLocaleString('ru-RU')}</p>
              <button onClick={() => deleteNote(n.id)}
                className="absolute top-3 right-3 text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                <Trash2 size={14}/>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Вкладка: Рекомендации ────────────────────────────────────────────────

const REC_TEMPLATES = [
  'Увеличьте потребление клетчатки: добавьте овощи к каждому приёму пищи',
  'Следите за соотношением Омега-3 и Омега-6 жирных кислот',
  'Разделите суточный белок на 4–5 приёмов по 25–40 г',
  'Ограничьте сахар до 25 г в день — читайте этикетки',
  'Добавьте источники Витамина D: жирная рыба, яйца, прогулки',
  'Пейте воду равномерно в течение дня: 30 мл на кг веса',
];

function RecommendationsTab({ clientId }: { clientId: string }) {
  const api = useApi();
  const [recs, setRecs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const d = await api.get(`/api/crm/clients/${clientId}/recommendations`); setRecs(d.recommendations || []); }
    catch {} finally { setLoading(false); }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  async function addRec() {
    if (!content.trim()) return;
    setSaving(true);
    try { await api.post(`/api/crm/clients/${clientId}/recommendations`, { content }); setContent(''); await load(); }
    catch (e: any) { alert(e.message); }
    finally { setSaving(false); }
  }

  async function deleteRec(id: string) {
    try { await api.del(`/api/crm/clients/${clientId}/recommendations/${id}`); await load(); }
    catch {}
  }

  return (
    <div>
      <div className="bg-zinc-800/40 rounded-xl p-4 border border-zinc-700/50 mb-4">
        <textarea value={content} onChange={e => setContent(e.target.value)}
          placeholder="Напишите рекомендацию для клиента…"
          rows={3}
          className="w-full bg-transparent text-white placeholder-zinc-500 text-sm focus:outline-none resize-none"/>
        <div className="flex items-center gap-2 mt-2">
          <button onClick={() => setShowTemplates(s => !s)} className="text-xs text-zinc-400 hover:text-emerald-400 flex items-center gap-1">
            <Star size={12}/> Шаблоны
          </button>
          <div className="flex-1"/>
          <button onClick={addRec} disabled={saving || !content.trim()}
            className="flex items-center gap-1.5 text-sm bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white px-4 py-2 rounded-lg">
            {saving ? <Loader2 size={14} className="animate-spin"/> : <Plus size={14}/>} Добавить
          </button>
        </div>
        {showTemplates && (
          <div className="mt-3 space-y-1 border-t border-zinc-700/50 pt-3">
            {REC_TEMPLATES.map(t => (
              <button key={t} onClick={() => { setContent(t); setShowTemplates(false); }}
                className="w-full text-left text-xs text-zinc-400 hover:text-emerald-400 py-1.5 px-2 rounded hover:bg-zinc-700/40 transition-colors">
                {t}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-zinc-500"/></div>
      ) : recs.length === 0 ? (
        <EmptyState icon={<Star size={36}/>} text="Рекомендаций пока нет"/>
      ) : (
        <div className="space-y-3">
          {recs.map((r: any) => (
            <div key={r.id} className="bg-zinc-800/40 rounded-xl px-4 py-3 border border-zinc-700/50 group relative">
              <p className="text-white text-sm whitespace-pre-wrap">{r.content}</p>
              <p className="text-zinc-500 text-xs mt-2">{new Date(r.createdAt).toLocaleString('ru-RU')}</p>
              <button onClick={() => deleteRec(r.id)}
                className="absolute top-3 right-3 text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                <Trash2 size={14}/>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Вкладка: Сообщения ───────────────────────────────────────────────────

function MessagesTab({ clientId }: { clientId: string }) {
  const api = useApi();
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = React.useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const d = await api.get(`/api/crm/clients/${clientId}/messages`); setMessages(d.messages || []); }
    catch {} finally { setLoading(false); }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);

  async function send() {
    if (!content.trim()) return;
    setSending(true);
    try { await api.post(`/api/crm/clients/${clientId}/messages`, { content }); setContent(''); await load(); }
    catch (e: any) { alert(e.message); }
    finally { setSending(false); }
  }

  return (
    <div className="flex flex-col h-full">
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-zinc-500"/></div>
      ) : messages.length === 0 ? (
        <EmptyState icon={<Send size={36}/>} text="Сообщений пока нет — напишите клиенту первым"/>
      ) : (
        <div className="flex-1 space-y-3 overflow-y-auto pr-1">
          {messages.map((m: any) => (
            <div key={m.id} className={cn("flex", m.sender === 'NUTRITIONIST' ? 'justify-end' : 'justify-start')}>
              <div className={cn("max-w-[75%] rounded-2xl px-4 py-2.5",
                m.sender === 'NUTRITIONIST' ? 'bg-emerald-500 text-white' : 'bg-zinc-800/60 border border-zinc-700/50 text-white')}>
                <p className="text-sm whitespace-pre-wrap">{m.content}</p>
                <p className={cn("text-xs mt-1", m.sender === 'NUTRITIONIST' ? 'text-emerald-50/70' : 'text-zinc-500')}>
                  {new Date(m.createdAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          ))}
          <div ref={bottomRef}/>
        </div>
      )}

      <div className="flex items-end gap-2 mt-4 bg-zinc-800/40 rounded-xl p-2 border border-zinc-700/50">
        <textarea value={content} onChange={e => setContent(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Написать клиенту…" rows={1}
          className="flex-1 bg-transparent text-white placeholder-zinc-500 text-sm focus:outline-none resize-none px-2 py-2"/>
        <button onClick={send} disabled={sending || !content.trim()}
          className="flex items-center justify-center bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white w-9 h-9 rounded-lg shrink-0">
          {sending ? <Loader2 size={16} className="animate-spin"/> : <Send size={16}/>}
        </button>
      </div>
    </div>
  );
}

// ─── Карточка клиента ──────────────────────────────────────────────────────

function ClientCard({ clientId, inviteToken, onBack }: { clientId: string | null; inviteToken: string | null; onBack: () => void }) {
  const api = useApi();
  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ClientTab>('questionnaire');
  const [copied, setCopied] = useState(false);

  const inviteUrl = inviteToken ? `${window.location.origin}/onboard/${inviteToken}` : '';

  const loadDetail = useCallback(async () => {
    if (!clientId) { setLoading(false); return; }
    setLoading(true);
    try { const d = await api.get(`/api/crm/clients/${clientId}`); setDetail(d); }
    catch {} finally { setLoading(false); }
  }, [clientId]);

  useEffect(() => { loadDetail(); }, [loadDetail]);

  function copyLink() {
    navigator.clipboard.writeText(inviteUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  const TABS: { id: ClientTab; label: string; icon: React.ReactNode }[] = [
    { id: 'questionnaire', label: 'Анкета', icon: <User size={14}/> },
    { id: 'diary', label: 'Дневник', icon: <Clipboard size={14}/> },
    { id: 'weight', label: 'Вес', icon: <Scale size={14}/> },
    { id: 'analyses', label: 'Анализы', icon: <FileText size={14}/> },
    { id: 'notes', label: 'Заметки', icon: <MessageSquare size={14}/> },
    { id: 'recommendations', label: 'Рекомендации', icon: <Star size={14}/> },
    { id: 'messages', label: 'Сообщения', icon: <Send size={14}/> },
  ];

  const clientName = detail?.invite?.clientName || (detail?.profile
    ? `${detail.profile.firstName || ''} ${detail.profile.lastName || ''}`.trim()
    : 'Клиент');

  return (
    <div className="flex flex-col h-full">
      {/* Заголовок */}
      <div className="border-b border-zinc-800 px-6 py-4 flex items-center gap-4">
        <button onClick={onBack} className="text-zinc-400 hover:text-white"><ChevronLeft size={20}/></button>
        <div className="flex-1">
          <h2 className="text-white font-display text-lg font-semibold">{clientName || 'Без имени'}</h2>
          <p className="text-zinc-500 text-xs">
            {!clientId
              ? 'Ожидает регистрации'
              : detail?.profile?.weightKg
              ? `${detail.profile.weightKg} кг · ${detail.profile.heightCm} см`
              : 'Анкета не заполнена'}
          </p>
        </div>
        {!clientId && (
          <div className="flex items-center gap-2">
            <span className="text-zinc-500 text-xs truncate max-w-[200px]">{inviteUrl}</span>
            <button onClick={copyLink} className={cn("flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border transition-colors",
              copied ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-600')}>
              {copied ? <><Check size={12}/> Скопировано</> : <><Copy size={12}/> Скопировать ссылку</>}
            </button>
          </div>
        )}
      </div>

      {/* Вкладки */}
      <div className="flex border-b border-zinc-800 px-6 overflow-x-auto">
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            disabled={!clientId && tab.id !== 'questionnaire'}
            className={cn("flex items-center gap-1.5 px-4 py-3 text-sm border-b-2 transition-colors whitespace-nowrap shrink-0",
              activeTab === tab.id
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-zinc-500 hover:text-zinc-300 disabled:opacity-30 disabled:cursor-not-allowed')}>
            {tab.icon}{tab.label}
          </button>
        ))}
      </div>

      {/* Контент вкладки */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex justify-center pt-16"><Loader2 size={24} className="animate-spin text-zinc-500"/></div>
        ) : (
          <>
            {activeTab === 'questionnaire' && (
              <QuestionnaireTab clientId={clientId || ''} detail={detail} onUpdated={loadDetail} />
            )}
            {activeTab === 'diary' && clientId && <DiaryTab clientId={clientId}/>}
            {activeTab === 'weight' && clientId && <WeightTab clientId={clientId}/>}
            {activeTab === 'analyses' && clientId && <AnalysesTab clientId={clientId}/>}
            {activeTab === 'notes' && clientId && <NotesTab clientId={clientId}/>}
            {activeTab === 'recommendations' && clientId && <RecommendationsTab clientId={clientId}/>}
            {activeTab === 'messages' && clientId && <MessagesTab clientId={clientId}/>}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Диалог: Добавить клиента ─────────────────────────────────────────────

function AddClientDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (url: string) => void }) {
  const api = useApi();
  const [form, setForm] = useState({ clientName: '', secretPhrase: '', tags: '' });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [created, setCreated] = useState<{ url: string } | null>(null);
  const [copied, setCopied] = useState(false);

  function generatePhrase() {
    const words = ['клевер', 'берёза', 'рябина', 'земляника', 'малина', 'орешник', 'сосна', 'ромашка'];
    const a = words[Math.floor(Math.random() * words.length)];
    const b = words[Math.floor(Math.random() * words.length)];
    const n = Math.floor(Math.random() * 90 + 10);
    setForm(f => ({ ...f, secretPhrase: `${a}-${b}-${n}` }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setLoading(true);
    try {
      const tags = form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
      const data = await api.post('/api/crm/clients', { clientName: form.clientName, secretPhrase: form.secretPhrase, tags });
      setCreated({ url: data.inviteUrl });
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  }

  function copy() {
    navigator.clipboard.writeText(created!.url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800 w-full max-w-md">
        <div className="flex items-center justify-between p-6 border-b border-zinc-800">
          <h3 className="text-white font-semibold">Новый клиент</h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-white"><X size={20}/></button>
        </div>

        {!created ? (
          <form onSubmit={submit} className="p-6 space-y-4">
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Имя клиента (необязательно)</label>
              <input value={form.clientName} onChange={e => setForm(f => ({ ...f, clientName: e.target.value }))}
                placeholder="Анна Иванова"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500" />
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Секретная фраза *</label>
              <div className="flex gap-2">
                <input value={form.secretPhrase} onChange={e => setForm(f => ({ ...f, secretPhrase: e.target.value }))}
                  placeholder="берёза-малина-42" required
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500" />
                <button type="button" onClick={generatePhrase} title="Сгенерировать"
                  className="px-3 border border-zinc-700 rounded-lg text-zinc-400 hover:text-white hover:border-zinc-600 text-xs">
                  Авто
                </button>
              </div>
              <p className="text-zinc-600 text-xs mt-1">Клиент введёт эту фразу для входа. Сообщите ему лично.</p>
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Теги (через запятую)</label>
              <input value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
                placeholder="похудение, ГВ, диабет"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500" />
            </div>
            {err && <p className="text-red-400 text-sm">{err}</p>}
            <button type="submit" disabled={loading || !form.secretPhrase}
              className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-medium py-3 rounded-xl flex items-center justify-center gap-2">
              {loading ? <Loader2 size={16} className="animate-spin"/> : <Plus size={16}/>} Создать
            </button>
          </form>
        ) : (
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-2 text-emerald-400">
              <Check size={20}/><span className="font-medium">Приглашение создано!</span>
            </div>
            <p className="text-zinc-400 text-sm">Отправьте клиенту эту ссылку и секретную фразу отдельно.</p>
            <div className="bg-zinc-800 rounded-xl p-3 border border-zinc-700">
              <p className="text-white text-xs break-all">{created.url}</p>
            </div>
            <button onClick={copy} className={cn("w-full py-2.5 rounded-xl text-sm flex items-center justify-center gap-2 border transition-colors",
              copied ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-zinc-700 text-zinc-300 hover:border-emerald-500 hover:text-emerald-400')}>
              {copied ? <><Check size={14}/> Скопировано!</> : <><Copy size={14}/> Скопировать ссылку</>}
            </button>
            <button onClick={() => { onCreated(created.url); onClose(); }}
              className="w-full bg-zinc-800 hover:bg-zinc-700 text-white py-2.5 rounded-xl text-sm">
              Готово
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Дашборд (список клиентов) ─────────────────────────────────────────────

function Dashboard({ user, onSelectClient }: { user: NutritionistUser; onSelectClient: (c: Client) => void }) {
  const api = useApi();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ClientStatus | 'ALL'>('ALL');
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const d = await api.get('/api/crm/clients'); setClients(d.clients || []); }
    catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = clients.filter(c => {
    const matchSearch = !search || c.clientName.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === 'ALL' || c.status === filter;
    return matchSearch && matchFilter;
  });

  const STATUS_LABEL: Record<ClientStatus, string> = {
    PENDING: 'Ожидает', ACTIVE: 'Активен', ARCHIVED: 'Архив'
  };
  const STATUS_COLOR: Record<ClientStatus, string> = {
    PENDING: 'text-yellow-400 bg-yellow-400/10', ACTIVE: 'text-emerald-400 bg-emerald-400/10', ARCHIVED: 'text-zinc-500 bg-zinc-800'
  };
  const SOURCE_LABEL: Record<ClientSource, string> = {
    invite: 'Приглашение', telegram: 'Telegram', self: 'Самостоятельно'
  };
  const SOURCE_ICON: Record<ClientSource, React.ReactNode> = {
    invite: <ExternalLink size={11}/>, telegram: <Smartphone size={11}/>, self: <User size={11}/>
  };

  return (
    <>
      {showAdd && <AddClientDialog onClose={() => setShowAdd(false)} onCreated={() => load()} />}

      <div className="flex flex-col h-full">
        {/* Заголовок */}
        <div className="border-b border-zinc-800 px-6 py-4 flex items-center gap-4">
          <div>
            <h1 className="text-white font-display text-xl font-semibold">Клиенты</h1>
            <p className="text-zinc-500 text-xs">{clients.filter(c => c.status === 'ACTIVE').length} активных из {clients.length}</p>
          </div>
          <div className="flex-1 relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"/>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск по имени…"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500"/>
          </div>
          <div className="flex gap-1">
            {(['ALL', 'ACTIVE', 'PENDING', 'ARCHIVED'] as const).map(s => (
              <button key={s} onClick={() => setFilter(s)}
                className={cn("px-2.5 py-1.5 rounded-lg text-xs border transition-colors",
                  filter === s ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-zinc-700 text-zinc-400 hover:text-white')}>
                {s === 'ALL' ? 'Все' : STATUS_LABEL[s as ClientStatus]}
              </button>
            ))}
          </div>
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 text-white text-sm px-4 py-2 rounded-lg shrink-0">
            <Plus size={16}/> Добавить
          </button>
          <button onClick={load} className="text-zinc-500 hover:text-white"><RefreshCw size={16}/></button>
        </div>

        {/* Таблица */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center pt-16"><Loader2 size={24} className="animate-spin text-zinc-500"/></div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-500">
              <Users size={48} className="opacity-30"/>
              <p className="text-sm">
                {clients.length === 0 ? 'Клиентов ещё нет. Нажмите «Добавить» чтобы создать первого.' : 'Нет клиентов по заданным фильтрам.'}
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-wider">
                  <th className="text-left px-6 py-3 font-medium">Клиент</th>
                  <th className="text-left px-4 py-3 font-medium">Статус</th>
                  <th className="text-left px-4 py-3 font-medium">Источник</th>
                  <th className="text-left px-4 py-3 font-medium">Теги</th>
                  <th className="text-left px-4 py-3 font-medium">Активность</th>
                  <th className="px-4 py-3"/>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {filtered.map(c => (
                  <tr key={c.clientId || c.inviteId} onClick={() => onSelectClient(c)}
                    className="hover:bg-zinc-800/30 cursor-pointer transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-medium text-white">{c.clientName}</div>
                      {c.profile && (
                        <div className="text-zinc-500 text-xs mt-0.5">
                          {c.profile.weightKg && `${c.profile.weightKg} кг`}
                          {c.profile.heightCm && ` · ${c.profile.heightCm} см`}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <span className={cn("px-2 py-1 rounded-full text-xs font-medium", STATUS_COLOR[c.status])}>
                        {STATUS_LABEL[c.status]}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <span className="inline-flex items-center gap-1 text-zinc-400 text-xs" title={c.nutritionistName ? `Пригласил: ${c.nutritionistName}` : undefined}>
                        {SOURCE_ICON[c.source]}{SOURCE_LABEL[c.source]}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-1">
                        {JSON.parse(c.tagsJson || '[]').slice(0, 3).map((t: string) => (
                          <span key={t} className="px-2 py-0.5 rounded-full text-xs bg-zinc-800 text-zinc-400 border border-zinc-700">{t}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-zinc-500 text-xs">
                      {c.lastActivityAt ? new Date(c.lastActivityAt).toLocaleDateString('ru-RU') : '—'}
                    </td>
                    <td className="px-4 py-4 text-right">
                      <ChevronRight size={16} className="text-zinc-600 ml-auto"/>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Главный CRM компонент ────────────────────────────────────────────────

interface CrmAppProps {
  user: NutritionistUser;
  onLogout: () => void;
}

export function CrmApp({ user, onLogout }: CrmAppProps) {
  const api = useApi();
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);

  async function handleLogout() {
    try { await api.post('/api/crm/auth/logout', {}); } catch {}
    onLogout();
  }

  return (
    <div className="flex h-screen bg-zinc-950 text-white overflow-hidden">
      {/* Боковая панель */}
      <aside className="w-16 flex flex-col items-center py-4 bg-zinc-900 border-r border-zinc-800">
        <div className="w-9 h-9 rounded-xl bg-emerald-500 flex items-center justify-center mb-6">
          <Leaf size={18} className="text-white"/>
        </div>
        <nav className="flex flex-col items-center gap-2 flex-1">
          <button onClick={() => setSelectedClient(null)}
            title="Клиенты"
            className={cn("w-10 h-10 rounded-xl flex items-center justify-center transition-colors",
              !selectedClient ? 'bg-emerald-500/20 text-emerald-400' : 'text-zinc-500 hover:text-white hover:bg-zinc-800')}>
            <Users size={18}/>
          </button>
        </nav>
        <div className="mt-auto space-y-2">
          <div title={`${user.profile?.firstName || ''} ${user.profile?.lastName || ''}`.trim() || user.email}
            className="w-9 h-9 rounded-full bg-zinc-700 flex items-center justify-center text-sm font-medium text-white">
            {(user.profile?.firstName?.[0] || user.email[0]).toUpperCase()}
          </div>
          <button onClick={handleLogout} title="Выйти"
            className="w-10 h-10 rounded-xl flex items-center justify-center text-zinc-500 hover:text-red-400 hover:bg-zinc-800 transition-colors">
            <LogOut size={18}/>
          </button>
        </div>
      </aside>

      {/* Основной контент */}
      <main className="flex-1 overflow-hidden">
        {selectedClient ? (
          <ClientCard
            clientId={selectedClient.clientId}
            inviteToken={selectedClient.token}
            onBack={() => setSelectedClient(null)}
          />
        ) : (
          <Dashboard user={user} onSelectClient={setSelectedClient} />
        )}
      </main>
    </div>
  );
}
