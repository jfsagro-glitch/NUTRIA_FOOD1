import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Utensils, 
  BarChart3, 
  Plus, 
  ChevronDown, 
  ChevronUp, 
  Flame, 
  Zap, 
  Target,
  Search,
  Camera,
  ScanBarcode,
  X,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Trash2,
  Mic,
  MicOff
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---
interface Product {
  id: string;
  name: string;
  brand: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  fiber: number;
  isUsda?: boolean;
  isAiEstimated?: boolean;
  explanation?: string;
  // Micronutrients stored as JSON in DB, parsed here
  vitamins?: Record<string, number>;
  minerals?: Record<string, number>;
  aminoAcids?: Record<string, number>;
}

interface NutrientTotals {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  fiber: number;
  vitamins: Record<string, number>;
  minerals: Record<string, number>;
  aminoAcids: Record<string, number>;
}

interface MealItem {
  id: string;
  amount: number;
  product: Product;
}

interface Meal {
  id: string;
  type: string;
  items: MealItem[];
}

interface Hint {
  severity: 'low' | 'med' | 'high';
  title: string;
  explanation: string;
  cta?: string;
}

// --- Components ---

const BottomNav = ({ activeTab, onTabChange }: { activeTab: string, onTabChange: (tab: string) => void }) => {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-zinc-900/80 backdrop-blur-xl border-t border-zinc-800 pb-safe pt-2 px-6 flex justify-around items-center z-40">
      <button 
        onClick={() => onTabChange('nutrition')}
        className={cn(
          "flex flex-col items-center gap-1 transition-colors",
          activeTab === 'nutrition' ? "text-emerald-500" : "text-zinc-500"
        )}
      >
        <Utensils size={24} />
        <span className="text-[10px] font-medium uppercase tracking-wider">Питание</span>
      </button>
      
      <div className="w-12" /> {/* Spacer for FAB */}
      
      <button 
        onClick={() => onTabChange('summary')}
        className={cn(
          "flex flex-col items-center gap-1 transition-colors",
          activeTab === 'summary' ? "text-emerald-500" : "text-zinc-500"
        )}
      >
        <BarChart3 size={24} />
        <span className="text-[10px] font-medium uppercase tracking-wider">Сводки</span>
      </button>
    </nav>
  );
};

const FAB = ({ onClick }: { onClick: () => void }) => {
  return (
    <motion.button
      whileTap={{ scale: 0.9 }}
      whileHover={{ scale: 1.05 }}
      onClick={onClick}
      className="fixed bottom-6 left-1/2 -translate-x-1/2 w-14 h-14 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-full flex items-center justify-center shadow-[0_8px_24px_rgba(16,185,129,0.4)] border border-emerald-300/20 z-50"
    >
      <Plus size={32} className="text-white" />
    </motion.button>
  );
};

const CollapsibleCard = ({ 
  title, 
  icon: Icon, 
  children, 
  collapsedContent,
  id 
}: { 
  title: string, 
  icon: any, 
  children: React.ReactNode, 
  collapsedContent: React.ReactNode,
  id: string
}) => {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const saved = localStorage.getItem(`collapse_${id}`);
    return saved === 'true';
  });

  const toggle = () => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    localStorage.setItem(`collapse_${id}`, String(newState));
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden mb-4 shadow-sm">
      <div 
        onClick={toggle}
        className="px-4 py-3 flex items-center justify-between cursor-pointer active:bg-zinc-800/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center text-emerald-500">
            <Icon size={18} />
          </div>
          <h3 className="font-semibold text-zinc-200">{title}</h3>
        </div>
        {isCollapsed ? <ChevronDown size={20} className="text-zinc-500" /> : <ChevronUp size={20} className="text-zinc-500" />}
      </div>
      
      <AnimatePresence initial={false}>
        {!isCollapsed ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
          >
            <div className="px-4 pb-4 border-t border-zinc-800/50 pt-4">
              {children}
            </div>
          </motion.div>
        ) : (
          <div className="px-4 pb-3 pt-1">
            {collapsedContent}
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

const BottomSheet = ({ isOpen, onClose, children, title }: { isOpen: boolean, onClose: () => void, children: React.ReactNode, title?: string }) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60]"
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 bg-zinc-900 border-t border-zinc-800 rounded-t-[32px] p-6 pb-12 z-[70] shadow-[0_-8px_40px_rgba(0,0,0,0.5)] max-h-[90vh] overflow-y-auto"
          >
            <div className="w-12 h-1.5 bg-zinc-800 rounded-full mx-auto mb-6" />
            {title && <h3 className="text-xl font-bold mb-6 text-center">{title}</h3>}
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

const DEFAULT_GOALS = { 
  calories: 2100, protein: 120, fat: 70, carbs: 250, fiber: 30,
  vitamins: { 
    A: 900, C: 90, D: 15, E: 15, K: 120, 
    B1: 1.2, B2: 1.3, B3: 16, B5: 5, B6: 1.3, B7: 30, B9: 400, B12: 2.4 
  },
  minerals: { 
    Calcium: 1000, Iron: 18, Magnesium: 400, Zinc: 11, Potassium: 4700, Sodium: 2300,
    Phosphorus: 700, Copper: 0.9, Selenium: 55
  },
  aminoAcids: { 
    Leucine: 2730, Isoleucine: 1400, Valine: 1820, Lysine: 2100,
    Tryptophan: 280, Threonine: 1050, Methionine: 1050, Phenylalanine: 1750,
    Histidine: 700, Arginine: 5000
  }
};

// --- Screens ---

const NutrientRow = ({ label, value, goal, unit, colorClass = "bg-emerald-500" }: { label: string, value: number, goal: number, unit: string, colorClass?: string }) => (
  <div className="flex justify-between items-center text-xs py-1">
    <span className="text-zinc-400 w-24">{label}</span>
    <div className="flex-1 mx-4 h-1 bg-zinc-800 rounded-full overflow-hidden">
      <div className={cn("h-full transition-all duration-500", colorClass)} style={{ width: `${Math.min(100, (value / goal) * 100)}%` }} />
    </div>
    <span className="text-zinc-200 w-20 text-right">{Math.round(value * 10) / 10}{unit}</span>
  </div>
);

const NutritionScreen = ({ data, onAddClick, hints, onHintClick, onDeleteItem, onUpdateWater }: { data: any, onAddClick: (type: string) => void, hints: Hint[], onHintClick: (cta: string) => void, onDeleteItem: (id: string) => void, onUpdateWater: (amount: number) => void }) => {
  const { meals = [], waterIntake = 0 } = data;
  const goals = data.goals ? { ...DEFAULT_GOALS, ...data.goals } : DEFAULT_GOALS;
  const waterGoal = 2500; // 2.5L in ml

  const totals = meals.reduce((acc: NutrientTotals, meal: any) => {
    meal.items.forEach((item: any) => {
      if (!item.product) return;
      const factor = item.amount / 100;
      acc.calories += item.product.calories * factor;
      acc.protein += item.product.protein * factor;
      acc.fat += item.product.fat * factor;
      acc.carbs += item.product.carbs * factor;
      acc.fiber += (item.product.fiber || 0) * factor;
      
      // Parse micronutrients if they exist
      if (item.product.vitamins) {
        Object.entries(item.product.vitamins).forEach(([k, v]) => {
          acc.vitamins[k] = (acc.vitamins[k] || 0) + (v as number) * factor;
        });
      }
      if (item.product.minerals) {
        Object.entries(item.product.minerals).forEach(([k, v]) => {
          acc.minerals[k] = (acc.minerals[k] || 0) + (v as number) * factor;
        });
      }
      if (item.product.aminoAcids) {
        Object.entries(item.product.aminoAcids).forEach(([k, v]) => {
          acc.aminoAcids[k] = (acc.aminoAcids[k] || 0) + (v as number) * factor;
        });
      }
    });
    return acc;
  }, { 
    calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0,
    vitamins: {}, minerals: {}, aminoAcids: {}
  });

  const mealTypes = ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'];
  const mealLabels: any = { BREAKFAST: 'Завтрак', LUNCH: 'Обед', DINNER: 'Ужин', SNACK: 'Перекус' };

  return (
    <div className="p-4 pb-24">
      <header className="mb-6 pt-4 flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Питание</h1>
          <p className="text-zinc-500 text-sm">Вторник, 4 Марта</p>
        </div>
        <div className="w-10 h-10 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center overflow-hidden">
          <img src="https://picsum.photos/seed/user/100/100" alt="Avatar" referrerPolicy="no-referrer" />
        </div>
      </header>

      {/* Энергетический баланс */}
      <CollapsibleCard 
        id="energy"
        title="Энергия" 
        icon={Flame}
        collapsedContent={
          <div className="flex justify-between items-center text-sm">
            <span className="text-zinc-400">{Math.round(totals.calories)} / {goals.calories} kcal</span>
            <div className="w-32 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, (totals.calories / goals.calories) * 100)}%` }} />
            </div>
          </div>
        }
      >
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="flex flex-col items-center">
            <div className="relative w-20 h-20 flex items-center justify-center">
              <svg className="w-full h-full -rotate-90">
                <circle cx="40" cy="40" r="36" fill="none" stroke="currentColor" strokeWidth="6" className="text-zinc-800" />
                <circle cx="40" cy="40" r="36" fill="none" stroke="currentColor" strokeWidth="6" strokeDasharray="226" strokeDashoffset={226 * (1 - Math.min(1, totals.calories / goals.calories))} className="text-emerald-500 transition-all duration-500" />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-lg font-bold">{Math.round(totals.calories)}</span>
                <span className="text-[8px] uppercase text-zinc-500">Kcal</span>
              </div>
            </div>
            <span className="text-[10px] mt-2 text-zinc-400 uppercase tracking-wider">Принято</span>
          </div>
          
          <div className="flex flex-col items-center">
            <div className="relative w-20 h-20 flex items-center justify-center">
              <svg className="w-full h-full -rotate-90">
                <circle cx="40" cy="40" r="36" fill="none" stroke="currentColor" strokeWidth="6" className="text-zinc-800" />
                <circle cx="40" cy="40" r="36" fill="none" stroke="currentColor" strokeWidth="6" strokeDasharray="226" strokeDashoffset={226 * (1 - 0.2)} className="text-orange-500" />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-lg font-bold">420</span>
                <span className="text-[8px] uppercase text-zinc-500">Kcal</span>
              </div>
            </div>
            <span className="text-[10px] mt-2 text-zinc-400 uppercase tracking-wider">Сожжено</span>
          </div>

          <div className="flex flex-col items-center">
            <div className="relative w-20 h-20 flex items-center justify-center">
              <svg className="w-full h-full -rotate-90">
                <circle cx="40" cy="40" r="36" fill="none" stroke="currentColor" strokeWidth="6" className="text-zinc-800" />
                <circle cx="40" cy="40" r="36" fill="none" stroke="currentColor" strokeWidth="6" strokeDasharray="226" strokeDashoffset={226 * (1 - Math.max(0, 1 - totals.calories / goals.calories))} className="text-blue-500 transition-all duration-500" />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-lg font-bold">{Math.max(0, Math.round(goals.calories - totals.calories))}</span>
                <span className="text-[8px] uppercase text-zinc-500">Kcal</span>
              </div>
            </div>
            <span className="text-[10px] mt-2 text-zinc-400 uppercase tracking-wider">Остаток</span>
          </div>
        </div>
        
        <div className="space-y-3">
          <NutrientRow label="Белки" value={totals.protein} goal={goals.protein} unit="g" />
          <NutrientRow label="Жиры" value={totals.fat} goal={goals.fat} unit="g" colorClass="bg-orange-500" />
          <NutrientRow label="Углеводы" value={totals.carbs} goal={goals.carbs} unit="g" colorClass="bg-blue-500" />
          <NutrientRow label="Клетчатка" value={totals.fiber} goal={goals.fiber || 30} unit="g" colorClass="bg-emerald-600" />
        </div>
      </CollapsibleCard>

      {/* Витамины */}
      <CollapsibleCard 
        id="vitamins"
        title="Витамины" 
        icon={Zap}
        collapsedContent={
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {['A', 'C', 'D', 'B12'].map(v => (
              <div key={v} className="px-2 py-1 bg-zinc-800 rounded text-[10px] text-zinc-400 whitespace-nowrap">
                {v}: {Math.round((totals.vitamins[v] || 0) / (goals.vitamins[v] || 1) * 100)}%
              </div>
            ))}
          </div>
        }
      >
        <div className="space-y-1">
          <NutrientRow label="Витамин A" value={totals.vitamins['A'] || 0} goal={goals.vitamins['A']} unit="mcg" />
          <NutrientRow label="Витамин C" value={totals.vitamins['C'] || 0} goal={goals.vitamins['C']} unit="mg" />
          <NutrientRow label="Витамин D" value={totals.vitamins['D'] || 0} goal={goals.vitamins['D']} unit="mcg" />
          <NutrientRow label="Витамин E" value={totals.vitamins['E'] || 0} goal={goals.vitamins['E']} unit="mg" />
          <NutrientRow label="Витамин K" value={totals.vitamins['K'] || 0} goal={goals.vitamins['K']} unit="mcg" />
          <NutrientRow label="Витамин B1 (Тиамин)" value={totals.vitamins['B1'] || 0} goal={goals.vitamins['B1']} unit="mg" />
          <NutrientRow label="Витамин B2 (Рибофлавин)" value={totals.vitamins['B2'] || 0} goal={goals.vitamins['B2']} unit="mg" />
          <NutrientRow label="Витамин B3 (Ниацин)" value={totals.vitamins['B3'] || 0} goal={goals.vitamins['B3']} unit="mg" />
          <NutrientRow label="Витамин B6" value={totals.vitamins['B6'] || 0} goal={goals.vitamins['B6']} unit="mg" />
          <NutrientRow label="Витамин B9 (Фолат)" value={totals.vitamins['B9'] || 0} goal={goals.vitamins['B9']} unit="mcg" />
          <NutrientRow label="Витамин B12" value={totals.vitamins['B12'] || 0} goal={goals.vitamins['B12']} unit="mcg" />
        </div>
      </CollapsibleCard>

      {/* Минералы и Электролиты */}
      <CollapsibleCard 
        id="minerals"
        title="Минералы и Электролиты" 
        icon={Zap}
        collapsedContent={
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {['Potassium', 'Sodium', 'Calcium', 'Iron'].map(m => (
              <div key={m} className="px-2 py-1 bg-zinc-800 rounded text-[10px] text-zinc-400 whitespace-nowrap">
                {m}: {Math.round((totals.minerals[m] || 0) / (goals.minerals[m] || 1) * 100)}%
              </div>
            ))}
          </div>
        }
      >
        <div className="space-y-1">
          <h4 className="text-[10px] uppercase text-zinc-500 font-bold mb-2 tracking-widest">Электролиты</h4>
          <NutrientRow label="Калий" value={totals.minerals['Potassium'] || 0} goal={goals.minerals['Potassium']} unit="mg" colorClass="bg-blue-400" />
          <NutrientRow label="Натрий" value={totals.minerals['Sodium'] || 0} goal={goals.minerals['Sodium']} unit="mg" colorClass="bg-zinc-400" />
          <NutrientRow label="Магний" value={totals.minerals['Magnesium'] || 0} goal={goals.minerals['Magnesium']} unit="mg" colorClass="bg-purple-400" />
          
          <h4 className="text-[10px] uppercase text-zinc-500 font-bold mt-4 mb-2 tracking-widest">Минералы</h4>
          <NutrientRow label="Кальций" value={totals.minerals['Calcium'] || 0} goal={goals.minerals['Calcium']} unit="mg" />
          <NutrientRow label="Железо" value={totals.minerals['Iron'] || 0} goal={goals.minerals['Iron']} unit="mg" colorClass="bg-red-400" />
          <NutrientRow label="Магний" value={totals.minerals['Magnesium'] || 0} goal={goals.minerals['Magnesium']} unit="mg" />
          <NutrientRow label="Цинк" value={totals.minerals['Zinc'] || 0} goal={goals.minerals['Zinc']} unit="mg" />
          <NutrientRow label="Фосфор" value={totals.minerals['Phosphorus'] || 0} goal={goals.minerals['Phosphorus']} unit="mg" />
          <NutrientRow label="Селен" value={totals.minerals['Selenium'] || 0} goal={goals.minerals['Selenium']} unit="mcg" />
        </div>
      </CollapsibleCard>

      {/* Аминокислоты */}
      <CollapsibleCard 
        id="amino"
        title="Аминокислотный профиль" 
        icon={Zap}
        collapsedContent={
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, (totals.aminoAcids['Leucine'] || 0) / (goals.aminoAcids['Leucine'] || 1) * 100)}%` }} />
            </div>
            <span className="text-[10px] text-zinc-400">Полнота белка</span>
          </div>
        }
      >
        <div className="space-y-1">
          <div className="p-3 bg-emerald-500/5 border border-emerald-500/10 rounded-xl mb-4">
            <p className="text-[10px] text-emerald-500 font-bold uppercase mb-1">Nutria Insight</p>
            <p className="text-xs text-zinc-400">Ваш профиль незаменимых аминокислот. Лейцин является ключевым триггером синтеза мышечного белка.</p>
          </div>
          <NutrientRow label="Лейцин" value={totals.aminoAcids['Leucine'] || 0} goal={goals.aminoAcids['Leucine']} unit="mg" />
          <NutrientRow label="Изолейцин" value={totals.aminoAcids['Isoleucine'] || 0} goal={goals.aminoAcids['Isoleucine']} unit="mg" />
          <NutrientRow label="Валин" value={totals.aminoAcids['Valine'] || 0} goal={goals.aminoAcids['Valine']} unit="mg" />
          <NutrientRow label="Лизин" value={totals.aminoAcids['Lysine'] || 0} goal={goals.aminoAcids['Lysine']} unit="mg" />
          <NutrientRow label="Треонин" value={totals.aminoAcids['Threonine'] || 0} goal={goals.aminoAcids['Threonine']} unit="mg" />
          <NutrientRow label="Триптофан" value={totals.aminoAcids['Tryptophan'] || 0} goal={goals.aminoAcids['Tryptophan']} unit="mg" />
          <NutrientRow label="Метионин" value={totals.aminoAcids['Methionine'] || 0} goal={goals.aminoAcids['Methionine']} unit="mg" />
          <NutrientRow label="Фенилаланин" value={totals.aminoAcids['Phenylalanine'] || 0} goal={goals.aminoAcids['Phenylalanine']} unit="mg" />
          <NutrientRow label="Гистидин" value={totals.aminoAcids['Histidine'] || 0} goal={goals.aminoAcids['Histidine']} unit="mg" />
          <NutrientRow label="Аргинин" value={totals.aminoAcids['Arginine'] || 0} goal={goals.aminoAcids['Arginine']} unit="mg" />
        </div>
      </CollapsibleCard>

      {/* Гидратация */}
      <CollapsibleCard 
        id="hydration"
        title="Гидратация" 
        icon={Zap}
        collapsedContent={
          <div className="flex justify-between items-center text-sm">
            <span className="text-zinc-400">{(waterIntake / 1000).toFixed(1)} / {(waterGoal / 1000).toFixed(1)} L</span>
            <div className="flex gap-1">
              {[1,2,3,4,5].map(i => (
                <div key={i} className={cn("w-2 h-4 rounded-sm", i <= (waterIntake / waterGoal * 5) ? "bg-blue-500" : "bg-zinc-800")} />
              ))}
            </div>
          </div>
        }
      >
        <div className="flex flex-col items-center py-4">
          <div className="text-4xl font-bold text-blue-500 mb-2">{(waterIntake / 1000).toFixed(1)} <span className="text-lg text-zinc-500">Л</span></div>
          <p className="text-xs text-zinc-500 mb-6">Цель: {(waterGoal / 1000).toFixed(1)} Л ({Math.round(waterIntake / waterGoal * 100)}% выполнено)</p>
          <div className="flex gap-4">
            <button 
              onClick={() => onUpdateWater(-250)}
              className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center text-red-500 border border-zinc-700 active:scale-90 transition-transform"
            >
              -250
            </button>
            <button 
              onClick={() => onUpdateWater(250)}
              className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center text-blue-500 border border-zinc-700 active:scale-90 transition-transform"
            >
              +250
            </button>
            <button 
              onClick={() => onUpdateWater(500)}
              className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center text-blue-500 border border-zinc-700 active:scale-90 transition-transform"
            >
              +500
            </button>
          </div>
        </div>
      </CollapsibleCard>

      {/* Качество питания / AI Hints */}
      <CollapsibleCard 
        id="quality"
        title="Качество питания" 
        icon={Target}
        collapsedContent={
          <div className="flex gap-2">
            <div className="px-2 py-1 bg-emerald-500/10 text-emerald-500 text-[10px] rounded-md border border-emerald-500/20">AI Insights</div>
            <div className="px-2 py-1 bg-zinc-800 text-zinc-400 text-[10px] rounded-md">{hints.length} подсказки</div>
          </div>
        }
      >
        <div className="space-y-3">
          {hints.length > 0 ? (
            hints.map((hint, i) => (
              <motion.div 
                key={i}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                onClick={() => hint.cta && onHintClick(hint.cta)}
                className={cn(
                  "p-4 rounded-xl border cursor-pointer active:scale-[0.98] transition-all",
                  hint.severity === 'high' ? "bg-red-500/5 border-red-500/20" : 
                  hint.severity === 'med' ? "bg-orange-500/5 border-orange-500/20" : 
                  "bg-emerald-500/5 border-emerald-500/20"
                )}
              >
                <div className="flex items-center gap-3 mb-2">
                  <Zap size={16} className={cn(
                    hint.severity === 'high' ? "text-red-500" : 
                    hint.severity === 'med' ? "text-orange-500" : 
                    "text-emerald-500"
                  )} />
                  <h4 className={cn(
                    "text-sm font-semibold",
                    hint.severity === 'high' ? "text-red-500" : 
                    hint.severity === 'med' ? "text-orange-500" : 
                    "text-emerald-500"
                  )}>{hint.title}</h4>
                </div>
                <p className="text-xs text-zinc-400 leading-relaxed mb-2">
                  {hint.explanation}
                </p>
                {hint.cta && (
                  <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 flex items-center gap-1">
                    Нажмите, чтобы найти: {hint.cta} <Plus size={10} />
                  </div>
                )}
              </motion.div>
            ))
          ) : (
            <div className="flex flex-col items-center py-4 text-zinc-500">
              <Loader2 className="animate-spin mb-2" size={20} />
              <p className="text-xs">Анализируем ваш рацион...</p>
            </div>
          )}
        </div>
      </CollapsibleCard>

      {/* Дневник */}
      <div className="mb-4">
        <h3 className="text-lg font-bold mb-4 px-1">Дневник</h3>
        <div className="space-y-3">
          {mealTypes.map((type) => {
            const meal = meals.find((m: any) => m.type === type);
            return (
              <div key={type} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400">
                      <Utensils size={16} />
                    </div>
                    <h4 className="font-semibold text-zinc-200">{mealLabels[type]}</h4>
                  </div>
                  <button 
                    onClick={() => onAddClick(type)}
                    className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 active:scale-90 transition-transform"
                  >
                    <Plus size={18} />
                  </button>
                </div>
                
                {meal && meal.items.length > 0 ? (
                  <div className="space-y-2 mt-3">
                    {meal.items.map((item: any) => (
                      <div key={item.id} className="flex justify-between items-center text-sm border-t border-zinc-800/50 pt-2 group">
                        <div className="flex-1">
                          <p className="text-zinc-200 font-medium">{item.product.name}</p>
                          <p className="text-[10px] text-zinc-500">{item.amount}г • {Math.round((item.product.calories * item.amount) / 100)} kcal</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-zinc-500 text-[10px] uppercase text-right">
                            {Math.round((item.product.protein * item.amount) / 100)}Б / {Math.round((item.product.fat * item.amount) / 100)}Ж / {Math.round((item.product.carbs * item.amount) / 100)}У
                          </div>
                          <button 
                            onClick={() => onDeleteItem(item.id)}
                            className="p-1 text-zinc-600 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[10px] text-zinc-600 uppercase tracking-wider mt-1">Ничего не добавлено</p>
                )}
              </div>
            );
          })}
        </div>

        <button 
          onClick={() => onAddClick('SNACK')}
          className="w-full mt-6 py-4 bg-zinc-900 border border-zinc-800 rounded-2xl flex items-center justify-center gap-2 text-zinc-400 font-medium active:bg-zinc-800 transition-colors"
        >
          <Plus size={20} />
          <span>Добавить что-то еще</span>
        </button>
      </div>
    </div>
  );
};

const SummaryScreen = () => {
  return (
    <div className="p-4">
      <header className="mb-6 pt-4">
        <h1 className="text-3xl font-bold tracking-tight">Сводки</h1>
        <p className="text-zinc-500 text-sm">Аналитика за 7 дней</p>
      </header>
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 flex flex-col items-center justify-center text-center">
        <BarChart3 size={48} className="text-zinc-700 mb-4" />
        <p className="text-zinc-400">Здесь будет ваша аналитика и тренды</p>
      </div>
    </div>
  );
};

// --- Main App ---

export default function App() {
  const [activeTab, setActiveTab] = useState('nutrition');
  const [isActionSheetOpen, setIsActionSheetOpen] = useState(false);
  const [isSearchSheetOpen, setIsSearchSheetOpen] = useState(false);
  const [isPhotoSheetOpen, setIsPhotoSheetOpen] = useState(false);
  const [isBarcodeSheetOpen, setIsBarcodeSheetOpen] = useState(false);
  const [isVoiceSheetOpen, setIsVoiceSheetOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [isParsingVoice, setIsParsingVoice] = useState(false);
  const [parsedVoiceItems, setParsedVoiceItems] = useState<any[]>([]);
  const getCurrentMealType = () => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 11) return 'BREAKFAST';
    if (hour >= 11 && hour < 16) return 'LUNCH';
    if (hour >= 16 && hour < 22) return 'DINNER';
    return 'SNACK';
  };

  const [selectedMealType, setSelectedMealType] = useState(getCurrentMealType());
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [diaryData, setDiaryData] = useState<any>({ meals: [], goals: null });
  const [hints, setHints] = useState<Hint[]>([]);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [recognizedItems, setRecognizedItems] = useState<any[]>([]);
  const [barcodeQuery, setBarcodeQuery] = useState('');

  const [selectedProductForAmount, setSelectedProductForAmount] = useState<Product | null>(null);
  const [foodAmount, setFoodAmount] = useState('100');
  const recognitionRef = useRef<any>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const generateAI = async (prompt: string, responseMimeType: string = "application/json", image?: { data: string, mimeType: string }): Promise<string> => {
    // Use backend proxy only (Gemini -> DeepSeek -> OpenAI fallback is handled server-side)
    try {
      const res = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, responseMimeType, image })
      });
      if (res.ok) {
        const data = await res.json();
        return data.text;
      }
      const errorBody = await res.json().catch(() => ({}));
      throw new Error(errorBody?.error || `AI proxy error: HTTP ${res.status}`);
    } catch (e) {
      console.error("Backend AI Proxy Error:", e);
    }

    throw new Error("All AI models failed.");
  };

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (isLoggedIn && diaryData.meals.length > 0) {
      fetchHints();
    }
  }, [diaryData, isLoggedIn]);

  const checkAuth = async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          setIsLoggedIn(true);
          fetchDiary();
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const login = async () => {
    try {
      const res = await fetch('/api/auth/login', { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err?.error || 'Не удалось выполнить вход. Проверьте настройки сервера.');
        return;
      }
      setIsLoggedIn(true);
      fetchDiary();
    } catch (e) {
      console.error(e);
      alert('Сервер недоступен. Попробуйте позже.');
    }
  };

  const fetchDiary = async () => {
    try {
      const res = await fetch('/api/diary');
      if (res.ok) {
        const data = await res.json();
        setDiaryData(data);
        // Automatically fetch hints after diary is updated
        if (data.meals && data.meals.length > 0) {
          fetchHints(data);
        }
      } else {
        const err = await res.json().catch(() => ({}));
        console.warn('Diary fetch error:', err);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const deleteMealItem = async (itemId: string) => {
    try {
      await fetch(`/api/diary/item/${itemId}`, { method: 'DELETE' });
      fetchDiary();
    } catch (e) {
      console.error(e);
    }
  };

  const updateWater = async (amount: number) => {
    try {
      const res = await fetch('/api/diary/water', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.warn('Water update error:', err);
        return;
      }
      fetchDiary();
    } catch (e) {
      console.error(e);
    }
  };

  const fetchHints = async (dataOverride?: any) => {
    const data = dataOverride || diaryData;
    if (!data.meals || data.meals.length === 0) return;
    try {
      const totals = data.meals.reduce((acc: NutrientTotals, meal: any) => {
        meal.items.forEach((item: any) => {
          if (!item.product) return;
          const factor = item.amount / 100;
          acc.calories += item.product.calories * factor;
          acc.protein += item.product.protein * factor;
          acc.fat += item.product.fat * factor;
          acc.carbs += item.product.carbs * factor;
          acc.fiber += (item.product.fiber || 0) * factor;
          
          if (item.product.vitamins) {
            Object.entries(item.product.vitamins).forEach(([k, v]) => {
              acc.vitamins[k] = (acc.vitamins[k] || 0) + (v as number) * factor;
            });
          }
          if (item.product.minerals) {
            Object.entries(item.product.minerals).forEach(([k, v]) => {
              acc.minerals[k] = (acc.minerals[k] || 0) + (v as number) * factor;
            });
          }
          if (item.product.aminoAcids) {
            Object.entries(item.product.aminoAcids).forEach(([k, v]) => {
              acc.aminoAcids[k] = (acc.aminoAcids[k] || 0) + (v as number) * factor;
            });
          }
        });
        return acc;
      }, { 
        calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0,
        vitamins: {}, minerals: {}, aminoAcids: {}
      });

      const goals = data.goals ? { ...DEFAULT_GOALS, ...data.goals } : DEFAULT_GOALS;

      const prompt = `
        User current nutrition today:
        Calories: ${totals.calories}/${goals.calories}
        Protein: ${totals.protein}/${goals.protein}
        Fat: ${totals.fat}/${goals.fat}
        Carbs: ${totals.carbs}/${goals.carbs}
        Fiber: ${totals.fiber}/${goals.fiber}
        Vitamins: ${JSON.stringify(totals.vitamins)}
        Minerals: ${JSON.stringify(totals.minerals)}
        Amino Acids: ${JSON.stringify(totals.aminoAcids)}

        Generate 2-3 short, actionable nutrition hints in Russian. 
        Focus on deficiencies in vitamins or minerals if any.
        Each hint should have: severity (low, med, high), title, explanation, and cta (optional search query).
        Return JSON array of objects.
      `;

      const responseText = await generateAI(prompt);
      setHints(JSON.parse(responseText || "[]"));
    } catch (e) {
      console.error("AI Error:", e);
      setHints([
        { severity: "low", title: "Пейте больше воды", explanation: "Вода помогает пищеварению и обмену веществ." },
        { severity: "med", title: "Добавьте клетчатки", explanation: "Клетчатка важна для здоровья кишечника. Попробуйте овощи или фрукты.", cta: "Овощи" }
      ]);
    }
  };

  const handleSearch = async (val: string) => {
    setSearchQuery(val);
    if (val.length < 2) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const res = await fetch(`/api/products/search?q=${encodeURIComponent(val)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.warn('Search error:', err);
        setSearchResults([]);
        return;
      }
      const data = await res.json();
      setSearchResults(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const addFood = async (productId: string, amount: number, usdaData?: Product) => {
    try {
      const res = await fetch('/api/diary/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          amount,
          type: selectedMealType,
          usdaData
        })
      });
      if (res.ok) {
        fetchDiary();
        fetchHints();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsRecognizing(true);
    setIsPhotoSheetOpen(true);
    setIsActionSheetOpen(false);

    try {
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
      });
      reader.readAsDataURL(file);
      const base64Image = await base64Promise;

      const prompt = `Analyze this food photo.
Return ONLY valid JSON.

Goal: recognize both single foods and prepared dishes.
Rules:
1) If it is a packaged/single food (e.g. yogurt, apple), return one item.
2) If it is a mixed dish (e.g. pasta with chicken, salad, soup), split into 2-5 main edible components.
3) Ignore plate/table/background and non-food objects.
4) amount must be estimated in grams (or ml for liquids), as a number.
5) For each item include possible alternative names for better DB search.

Output JSON array:
[
  {
    "name": "main canonical name",
    "amount": 120,
    "aliases": ["alt name ru", "alt name en"],
    "confidence": 0.0
  }
]`;
      const responseText = await generateAI(prompt, "application/json", { data: base64Image, mimeType: file.type });

      const recognizedRaw = JSON.parse(responseText || "[]");
      const recognizedList = Array.isArray(recognizedRaw)
        ? recognizedRaw
        : (Array.isArray(recognizedRaw?.items) ? recognizedRaw.items : []);

      const normalizedItems = recognizedList
        .map((item: any) => {
          const name = String(item?.name || item?.food || item?.product || '').trim();
          const amountValue = Number(item?.amount ?? item?.grams ?? item?.weight ?? 100);
          const amount = Number.isFinite(amountValue) && amountValue > 0 ? amountValue : 100;
          const aliases = Array.isArray(item?.aliases)
            ? item.aliases.map((value: any) => String(value).trim()).filter((value: string) => value.length > 0)
            : [];
          const confidenceValue = Number(item?.confidence);
          const confidence = Number.isFinite(confidenceValue) ? Math.max(0, Math.min(1, confidenceValue)) : undefined;
          return { name, amount, aliases, confidence };
        })
        .filter((item: any) => item.name.length > 0);

      const deduplicatedMap = new Map<string, any>();
      for (const item of normalizedItems) {
        const key = item.name.toLowerCase();
        const existing = deduplicatedMap.get(key);
        if (!existing) {
          deduplicatedMap.set(key, { ...item });
          continue;
        }

        existing.amount += item.amount;
        existing.aliases = Array.from(new Set([...(existing.aliases || []), ...(item.aliases || [])]));
        if (typeof existing.confidence === 'number' && typeof item.confidence === 'number') {
          existing.confidence = Math.max(existing.confidence, item.confidence);
        }
      }

      const recognized = Array.from(deduplicatedMap.values());
      
      // Match with database products (try canonical name + aliases)
      const matchedItems = await Promise.all(recognized.map(async (item: any) => {
        const candidateQueries = Array.from(new Set([item.name, ...(item.aliases || [])])).filter(Boolean);

        for (const query of candidateQueries) {
          const res = await fetch(`/api/products/search?q=${encodeURIComponent(query)}`);
          if (!res.ok) continue;

          const products = await res.json().catch(() => []);
          const productList = Array.isArray(products) ? products : [];
          if (productList.length > 0) {
            return { ...item, matchedBy: query, product: productList[0] };
          }
        }

        return { ...item, product: null };
      }));

      setRecognizedItems(matchedItems);
    } catch (e) {
      console.error("Recognition Error:", e);
    } finally {
      setIsRecognizing(false);
    }
  };

  const handleBarcodeScan = async () => {
    if (!barcodeQuery) return;
    try {
      const res = await fetch(`/api/products/barcode/${barcodeQuery}`);
      if (res.ok) {
        const product = await res.json();
        const amount = prompt(`Найдено: ${product.name}. Введите количество (г):`, '100');
        if (amount) {
          await addFood(product.id, Number(amount));
          setIsBarcodeSheetOpen(false);
          setBarcodeQuery('');
        }
      } else {
        alert('Продукт не найден в базе');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const startListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Ваш браузер не поддерживает распознавание речи.');
      return;
    }

    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch(e) {}
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'ru-RU';
    recognition.interimResults = true;
    recognition.continuous = true;
    recognitionRef.current = recognition;

    setVoiceTranscript('');
    setParsedVoiceItems([]);
    setIsListening(true);
    
    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event: any) => {
      let fullTranscript = '';
      for (let i = 0; i < event.results.length; i++) {
        fullTranscript += event.results[i][0].transcript;
      }
      setVoiceTranscript(fullTranscript);
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error', event.error);
      if (event.error === 'not-allowed') {
        alert('Доступ к микрофону запрещен. Пожалуйста, разрешите доступ в настройках браузера.');
      } else if (event.error !== 'no-speech') {
        // alert(`Ошибка распознавания: ${event.error}`);
      }
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    try {
      recognition.start();
    } catch (e) {
      console.error('Start error:', e);
      setIsListening(false);
    }
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }
  };

  const handleVoiceParse = async () => {
    if (!voiceTranscript) {
      alert('Сначала скажите что-нибудь!');
      return;
    }
    setIsParsingVoice(true);
    try {
      const res = await fetch('/api/voice/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: voiceTranscript })
      });
      if (res.ok) {
        const itemsRaw = await res.json();
        const items = Array.isArray(itemsRaw) ? itemsRaw : [];
        if (items.length === 0) {
          alert('Не удалось распознать продукты. Попробуйте сказать иначе.');
        }
        setParsedVoiceItems(items);
      } else {
        const err = await res.json();
        alert(`Ошибка сервера: ${err.error || 'Неизвестная ошибка'}`);
      }
    } catch (e) {
      console.error(e);
      alert('Ошибка при разборе фразы. Проверьте интернет-соединение.');
    } finally {
      setIsParsingVoice(false);
    }
  };

  const openAddFood = (type: string) => {
    setSelectedMealType(type);
    setIsSearchSheetOpen(true);
  };

  const handleHintClick = (cta: string) => {
    setSelectedMealType('SNACK');
    setIsSearchSheetOpen(true);
    handleSearch(cta);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-bg-dark flex items-center justify-center">
        <Loader2 className="animate-spin text-emerald-500" size={48} />
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-bg-dark flex flex-col items-center justify-center p-6 text-center">
        <div className="w-24 h-24 bg-emerald-500/10 rounded-3xl flex items-center justify-center mb-8 border border-emerald-500/20">
          <img src="/logo.png" alt="NUTRIA logo" className="w-16 h-16 object-contain" />
        </div>
        <h1 className="text-4xl font-black tracking-tighter mb-2 italic">NUTRIA</h1>
        <p className="text-zinc-500 mb-12 max-w-[240px]">Ваш персональный гид в мире осознанного питания</p>
        <button 
          onClick={login}
          className="w-full py-4 bg-emerald-500 text-white font-bold rounded-2xl shadow-[0_8px_24px_rgba(16,185,129,0.3)] active:scale-95 transition-transform"
        >
          Начать путешествие
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-dark safe-area-bottom">
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -10 }}
          transition={{ duration: 0.2 }}
        >
          {activeTab === 'nutrition' ? (
            <NutritionScreen 
              data={diaryData} 
              onAddClick={openAddFood} 
              hints={hints}
              onHintClick={handleHintClick}
              onDeleteItem={deleteMealItem}
              onUpdateWater={updateWater}
            />
          ) : (
            <SummaryScreen />
          )}
        </motion.div>
      </AnimatePresence>

      <FAB onClick={() => {
        setSelectedMealType(getCurrentMealType());
        setIsActionSheetOpen(true);
      }} />
      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />

      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handlePhotoUpload} 
        className="hidden" 
        accept="image/*"
      />

      {/* Быстрые действия */}
      <BottomSheet isOpen={isActionSheetOpen} onClose={() => setIsActionSheetOpen(false)} title="Быстрые действия">
        <div className="space-y-6">
          {/* Выбор приема пищи */}
          <div className="flex bg-zinc-900/50 p-1 rounded-xl border border-white/5">
            {[
              { id: 'BREAKFAST', label: 'Завтрак' },
              { id: 'LUNCH', label: 'Обед' },
              { id: 'DINNER', label: 'Ужин' },
              { id: 'SNACK', label: 'Перекус' },
            ].map((m) => (
              <button
                key={m.id}
                onClick={() => setSelectedMealType(m.id)}
                className={cn(
                  "flex-1 py-2 text-xs font-medium rounded-lg transition-all",
                  selectedMealType === m.id 
                    ? "bg-emerald-500 text-white shadow-lg" 
                    : "text-zinc-500 hover:text-zinc-300"
                )}
              >
                {m.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-4 gap-2">
            <button 
              onClick={() => { setIsActionSheetOpen(false); setIsSearchSheetOpen(true); }}
              className="flex flex-col items-center gap-2"
            >
              <div className="w-14 h-14 rounded-2xl bg-zinc-800 flex items-center justify-center text-emerald-500 shadow-inner hover:bg-zinc-700 transition-colors">
                <Search size={24} />
              </div>
              <span className="text-[10px] font-medium text-zinc-400">Поиск</span>
            </button>
            <button 
              onClick={() => { setIsActionSheetOpen(false); fileInputRef.current?.click(); }}
              className="flex flex-col items-center gap-2"
            >
              <div className="w-14 h-14 rounded-2xl bg-zinc-800 flex items-center justify-center text-emerald-500 shadow-inner hover:bg-zinc-700 transition-colors">
                <Camera size={24} />
              </div>
              <span className="text-[10px] font-medium text-zinc-400">Фото</span>
            </button>
            <button 
              onClick={() => { setIsActionSheetOpen(false); setIsBarcodeSheetOpen(true); }}
              className="flex flex-col items-center gap-2"
            >
              <div className="w-14 h-14 rounded-2xl bg-zinc-800 flex items-center justify-center text-emerald-500 shadow-inner hover:bg-zinc-700 transition-colors">
                <ScanBarcode size={24} />
              </div>
              <span className="text-[10px] font-medium text-zinc-400">Сканер</span>
            </button>
            <button 
              onClick={() => { 
                setIsActionSheetOpen(false); 
                setIsVoiceSheetOpen(true); 
                setVoiceTranscript(''); 
                setParsedVoiceItems([]);
                // Auto-start listening after a short delay to allow sheet animation
                setTimeout(() => startListening(), 400);
              }}
              className="flex flex-col items-center gap-2"
            >
              <div className="w-14 h-14 rounded-2xl bg-zinc-800 flex items-center justify-center text-emerald-500 shadow-inner hover:bg-zinc-700 transition-colors">
                <Mic size={24} />
              </div>
              <span className="text-[10px] font-medium text-zinc-400">Голос</span>
            </button>
          </div>
        </div>
      </BottomSheet>

      {/* Поиск еды */}
      <BottomSheet isOpen={isSearchSheetOpen} onClose={() => setIsSearchSheetOpen(false)} title={`Добавить в ${selectedMealType === 'BREAKFAST' ? 'Завтрак' : selectedMealType === 'LUNCH' ? 'Обед' : selectedMealType === 'DINNER' ? 'Ужин' : 'Перекус'}`}>
        <div className="relative mb-6">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={20} />
          <input 
            type="text" 
            placeholder="Поиск продукта или бренда..."
            className="w-full bg-zinc-800 border border-zinc-700 rounded-2xl py-4 pl-12 pr-4 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            autoFocus
          />
          {isSearching && <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-emerald-500" size={20} />}
        </div>

        <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-2">
          {searchResults.length > 0 ? (
            searchResults.map((product) => (
              <button 
                key={product.id}
                onClick={() => {
                  setSelectedProductForAmount(product);
                }}
                className="w-full bg-zinc-800/50 border border-zinc-800 rounded-xl p-4 flex justify-between items-center active:bg-zinc-800 transition-colors"
              >
                <div className="text-left">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-zinc-200">{product.name}</p>
                    {product.isUsda && (
                      <span className="px-1.5 py-0.5 bg-blue-500/10 text-blue-400 text-[8px] font-bold rounded uppercase tracking-tighter border border-blue-500/20">
                        USDA
                      </span>
                    )}
                    {product.isAiEstimated && (
                      <span className="px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 text-[8px] font-bold rounded uppercase tracking-tighter border border-emerald-500/20">
                        AI
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider">{product.brand} • {product.calories} kcal / 100g</p>
                  {product.explanation && (
                    <p className="text-[9px] text-zinc-600 italic mt-1 leading-tight max-w-[200px]">{product.explanation}</p>
                  )}
                </div>
                <Plus size={20} className="text-emerald-500" />
              </button>
            ))
          ) : searchQuery.length >= 2 && !isSearching ? (
            <div className="py-12 text-center">
              <AlertCircle size={48} className="mx-auto text-zinc-700 mb-4" />
              <p className="text-zinc-500">Продукт не найден. Попробуйте другой запрос.</p>
            </div>
          ) : null}
        </div>
      </BottomSheet>

      {/* Ввод количества */}
      <BottomSheet 
        isOpen={!!selectedProductForAmount} 
        onClose={() => setSelectedProductForAmount(null)} 
        title="Сколько вы съели?"
      >
        {selectedProductForAmount && (
          <div className="space-y-6">
            <div className="text-center">
              <p className="text-lg font-bold text-emerald-500">{selectedProductForAmount.name}</p>
              <p className="text-xs text-zinc-500 uppercase tracking-widest">{selectedProductForAmount.brand}</p>
              {selectedProductForAmount.explanation && (
                <p className="text-[10px] text-zinc-400 italic mt-2 px-4">{selectedProductForAmount.explanation}</p>
              )}
            </div>

            <div className="flex items-center justify-center gap-4">
              <input 
                type="number" 
                value={foodAmount}
                onChange={(e) => setFoodAmount(e.target.value)}
                className="w-32 bg-zinc-800 border border-zinc-700 rounded-2xl py-4 text-center text-2xl font-bold text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                autoFocus
              />
              <span className="text-xl font-bold text-zinc-500">грамм</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button 
                onClick={() => setSelectedProductForAmount(null)}
                className="py-4 bg-zinc-800 text-zinc-300 font-bold rounded-2xl active:scale-95 transition-transform"
              >
                Отмена
              </button>
              <button 
                onClick={() => {
                  if (selectedProductForAmount && foodAmount) {
                    addFood(selectedProductForAmount.id, Number(foodAmount), (selectedProductForAmount.isUsda || selectedProductForAmount.isAiEstimated) ? selectedProductForAmount : undefined);
                    setSelectedProductForAmount(null);
                    setIsSearchSheetOpen(false);
                    setSearchQuery('');
                    setSearchResults([]);
                  }
                }}
                className="py-4 bg-emerald-500 text-white font-bold rounded-2xl shadow-lg shadow-emerald-500/20 active:scale-95 transition-transform"
              >
                Добавить
              </button>
            </div>
          </div>
        )}
      </BottomSheet>

      {/* Распознавание фото */}
      <BottomSheet isOpen={isPhotoSheetOpen} onClose={() => setIsPhotoSheetOpen(false)} title="Распознавание еды">
        {isRecognizing ? (
          <div className="flex flex-col items-center py-12">
            <Loader2 className="animate-spin text-emerald-500 mb-4" size={48} />
            <p className="text-zinc-400">AI анализирует ваше фото...</p>
          </div>
        ) : (
          <div className="space-y-4">
            {recognizedItems.map((item, i) => (
              <div key={i} className="bg-zinc-800/50 border border-zinc-800 rounded-xl p-4 flex justify-between items-center">
                <div>
                  <p className="font-semibold text-zinc-200">{item.name}</p>
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Примерно {item.amount}г</p>
                </div>
                {item.product ? (
                  <button 
                    onClick={() => { addFood(item.product.id, item.amount, (item.product.isUsda || item.product.isAiEstimated) ? item.product : undefined); setIsPhotoSheetOpen(false); }}
                    className="px-4 py-2 bg-emerald-500 text-white text-xs font-bold rounded-lg"
                  >
                    Добавить
                  </button>
                ) : (
                  <span className="text-[10px] text-zinc-600 italic">Не в базе</span>
                )}
              </div>
            ))}
            <button 
              onClick={() => setIsPhotoSheetOpen(false)}
              className="w-full py-4 bg-zinc-800 text-zinc-300 font-bold rounded-xl mt-4"
            >
              Закрыть
            </button>
          </div>
        )}
      </BottomSheet>

      {/* Сканер штрих-кода */}
      <BottomSheet isOpen={isBarcodeSheetOpen} onClose={() => setIsBarcodeSheetOpen(false)} title="Сканер штрих-кода">
        <div className="flex flex-col items-center py-6">
          <div className="w-full max-w-[280px] aspect-square border-2 border-emerald-500/30 rounded-3xl relative mb-8 overflow-hidden bg-zinc-800/50 flex items-center justify-center">
            <ScanBarcode size={64} className="text-emerald-500/20" />
            <div className="absolute inset-x-0 top-1/2 h-0.5 bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)] animate-pulse" />
          </div>
          <input 
            type="text" 
            placeholder="Введите штрих-код вручную..."
            className="w-full bg-zinc-800 border border-zinc-700 rounded-2xl py-4 px-6 text-zinc-100 mb-4 text-center font-mono tracking-widest"
            value={barcodeQuery}
            onChange={(e) => setBarcodeQuery(e.target.value)}
          />
          <button 
            onClick={handleBarcodeScan}
            className="w-full py-4 bg-emerald-500 text-white font-bold rounded-2xl"
          >
            Найти продукт
          </button>
        </div>
      </BottomSheet>

      {/* Голосовой ввод */}
      <BottomSheet isOpen={isVoiceSheetOpen} onClose={() => { stopListening(); setIsVoiceSheetOpen(false); }} title="Голосовой дневник">
        <div className="flex flex-col items-center py-6">
          <motion.button
            animate={isListening ? { scale: [1, 1.1, 1], opacity: [1, 0.8, 1] } : {}}
            transition={{ repeat: Infinity, duration: 1.5 }}
            onClick={isListening ? stopListening : startListening}
            disabled={isParsingVoice}
            className={cn(
              "w-24 h-24 rounded-full flex items-center justify-center mb-6 transition-colors shadow-lg",
              isListening ? "bg-red-500 shadow-red-500/40" : "bg-emerald-500 shadow-emerald-500/40"
            )}
          >
            {isListening ? <MicOff size={40} className="text-white" /> : <Mic size={40} className="text-white" />}
          </motion.button>

          <div className="w-full bg-zinc-800/50 border border-zinc-700 rounded-2xl p-6 mb-6 min-h-[120px] flex flex-col items-center justify-center text-center">
            {isListening && !voiceTranscript && (
              <div className="mb-2 flex items-center gap-2 text-emerald-500 animate-pulse">
                <div className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-xs font-bold uppercase tracking-widest">Говорите...</span>
              </div>
            )}
            {voiceTranscript ? (
              <p className="text-zinc-100 text-lg font-medium leading-relaxed italic">"{voiceTranscript}"</p>
            ) : (
              <p className="text-zinc-500 italic">
                {!isListening ? "Нажмите на микрофон и скажите, что вы съели. Например: \"На завтрак съел два яйца, тост с авокадо и выпил кофе с молоком\"" : ""}
              </p>
            )}
          </div>

          {!isListening && voiceTranscript && !isParsingVoice && parsedVoiceItems.length === 0 && (
            <button 
              onClick={handleVoiceParse}
              className="w-full py-4 bg-emerald-500 text-white font-bold rounded-2xl mb-6 shadow-lg shadow-emerald-500/20 active:scale-95 transition-transform"
            >
              Разобрать фразу
            </button>
          )}

          {isListening && voiceTranscript && (
            <button 
              onClick={stopListening}
              className="w-full py-4 bg-zinc-800 text-zinc-300 font-bold rounded-2xl mb-6 active:scale-95 transition-transform"
            >
              Закончить запись
            </button>
          )}

          {isParsingVoice && (
            <div className="flex flex-col items-center py-4">
              <Loader2 className="animate-spin text-emerald-500 mb-2" size={32} />
              <p className="text-zinc-400 text-sm">AI разбирает ваш рацион...</p>
            </div>
          )}

          {parsedVoiceItems.length > 0 && (
            <div className="w-full space-y-3 mt-4">
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Распознанные продукты</p>
              {parsedVoiceItems.map((item, i) => (
                <div key={i} className="bg-zinc-800/80 border border-zinc-700 rounded-xl p-4 flex justify-between items-center">
                  <div className="flex-1 mr-4">
                    <p className="font-semibold text-zinc-200">{item.name}</p>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider">{item.amount}г • {item.product?.brand || 'AI Оценка'}</p>
                  </div>
                  {item.product ? (
                    <button 
                      onClick={async () => {
                        await addFood(item.product.id, item.amount, (item.product.isUsda || item.product.isAiEstimated) ? item.product : undefined);
                        setParsedVoiceItems(prev => prev.filter((_, idx) => idx !== i));
                        if (parsedVoiceItems.length === 1) setIsVoiceSheetOpen(false);
                      }}
                      className="px-4 py-2 bg-emerald-500 text-white text-xs font-bold rounded-lg shadow-lg shadow-emerald-500/20 active:scale-95 transition-transform"
                    >
                      Добавить
                    </button>
                  ) : (
                    <button 
                      onClick={async () => {
                        alert('Продукт не найден. Попробуйте поиск вручную.');
                      }}
                      className="p-2 bg-zinc-700 text-zinc-500 rounded-lg"
                    >
                      <Search size={20} />
                    </button>
                  )}
                </div>
              ))}
              <button 
                onClick={() => setIsVoiceSheetOpen(false)}
                className="w-full py-4 bg-zinc-800 text-zinc-300 font-bold rounded-xl mt-4"
              >
                Готово
              </button>
            </div>
          )}
        </div>
      </BottomSheet>
    </div>
  );
}
