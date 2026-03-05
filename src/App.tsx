import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { Html5Qrcode as Html5QrcodeType } from 'html5-qrcode';
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
  fattyAcids?: Record<string, number>;
  carbohydrateTypes?: Record<string, number>;
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
  fattyAcids: Record<string, number>;
  carbohydrateTypes: Record<string, number>;
}

interface NutrientGoalSet {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  fiber: number;
  vitamins: Record<string, number>;
  minerals: Record<string, number>;
  aminoAcids: Record<string, number>;
  fattyAcids: Record<string, number>;
  carbohydrateTypes: Record<string, number>;
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

type FastingMode = 'OFF' | '16:8' | '18:6' | 'CUSTOM';

const FASTING_PRESETS: Record<FastingMode, { label: string; fastingHours: number; eatingHours: number }> = {
  OFF: { label: 'ВЫКЛ', fastingHours: 0, eatingHours: 24 },
  '16:8': { label: '16:8', fastingHours: 16, eatingHours: 8 },
  '18:6': { label: '18:6', fastingHours: 18, eatingHours: 6 },
  CUSTOM: { label: 'Свой', fastingHours: 14, eatingHours: 10 },
};

const FASTING_STATE_STORAGE_KEY = 'nutria_fasting_timer_v1';

const formatDurationShort = (ms: number) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours}ч ${minutes}м`;
};

const formatHms = (ms: number) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.readAsDataURL(file);
  });

const optimizeImageForRecognition = async (file: File): Promise<{ data: string; mimeType: string }> => {
  const inputDataUrl = await readFileAsDataUrl(file);

  const imageElement = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Не удалось обработать изображение'));
    image.src = inputDataUrl;
  });

  const maxSide = 1280;
  const sourceWidth = imageElement.width || 1;
  const sourceHeight = imageElement.height || 1;
  const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
  const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
  const targetHeight = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext('2d');
  if (!context) {
    return { data: inputDataUrl.split(',')[1] || '', mimeType: file.type || 'image/jpeg' };
  }

  context.drawImage(imageElement, 0, 0, targetWidth, targetHeight);
  const optimizedMimeType = 'image/jpeg';
  const optimizedDataUrl = canvas.toDataURL(optimizedMimeType, 0.86);

  return {
    data: optimizedDataUrl.split(',')[1] || '',
    mimeType: optimizedMimeType,
  };
};

const parseAiJsonPayload = (text: string) => {
  const cleaned = String(text || '').trim();
  if (!cleaned) return [] as any[];

  const withoutFences = cleaned
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  try {
    return JSON.parse(withoutFences);
  } catch {
    const objectStart = withoutFences.indexOf('{');
    const objectEnd = withoutFences.lastIndexOf('}');
    const arrayStart = withoutFences.indexOf('[');
    const arrayEnd = withoutFences.lastIndexOf(']');

    if (arrayStart !== -1 && arrayEnd > arrayStart) {
      try {
        return JSON.parse(withoutFences.slice(arrayStart, arrayEnd + 1));
      } catch {
        // continue
      }
    }

    if (objectStart !== -1 && objectEnd > objectStart) {
      try {
        return JSON.parse(withoutFences.slice(objectStart, objectEnd + 1));
      } catch {
        // continue
      }
    }

    return [] as any[];
  }
};

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

const DEFAULT_GOALS: NutrientGoalSet = {
  calories: 2100, protein: 120, fat: 70, carbs: 250, fiber: 30,
  vitamins: {
    BetaCarotene: 3000,
    B1: 1.2,
    B2: 1.3,
    B5: 5,
    B6: 1.7,
    B9: 400,
    B12: 2.4,
    C: 90,
    A: 900,
    D: 15,
    E: 15,
    K: 120,
    B3: 16,
    Biotin: 30,
    Choline: 550,
  },
  minerals: {
    Potassium: 4700,
    Calcium: 1000,
    Silicon: 30,
    Magnesium: 400,
    Sodium: 1500,
    Sulfur: 500,
    Phosphorus: 700,
    Chlorine: 2300,
    Vanadium: 20,
    Iron: 18,
    Iodine: 150,
    Cobalt: 5,
    Manganese: 2.3,
    Copper: 0.9,
    Molybdenum: 45,
    Selenium: 55,
    Chromium: 35,
    Zinc: 11,
    Salt: 5000,
  },
  aminoAcids: {
    Alanine: 3000,
    Arginine: 5000,
    Asparagine: 3000,
    AsparticAcid: 6000,
    Valine: 1820,
    Histidine: 700,
    Glycine: 2000,
    Glutamine: 4000,
    GlutamicAcid: 10000,
    Isoleucine: 1400,
    Leucine: 2730,
    Lysine: 2100,
    Methionine: 1050,
    Proline: 3000,
    Serine: 2500,
    Tyrosine: 1500,
    Threonine: 1050,
    Tryptophan: 280,
    Phenylalanine: 1750,
    Cysteine: 1050,
  },
  fattyAcids: {
    Omega3: 1.6,
    Omega6: 17,
    Omega9: 20,
    TransFats: 2,
    Cholesterol: 300,
  },
  carbohydrateTypes: {
    Glucose: 25,
    Fructose: 25,
    Galactose: 10,
    Sucrose: 50,
    Lactose: 20,
    Maltose: 10,
    Starch: 130,
    Fiber: 30,
  },
};

const VITAMIN_CONFIG = [
  { key: 'BetaCarotene', label: 'Бета-каротин', unit: 'mcg' },
  { key: 'B1', label: 'Витамин B1', unit: 'mg' },
  { key: 'B2', label: 'Витамин B2', unit: 'mg' },
  { key: 'B5', label: 'Витамин B5', unit: 'mg' },
  { key: 'B6', label: 'Витамин B6', unit: 'mg' },
  { key: 'B9', label: 'Витамин B9', unit: 'mcg' },
  { key: 'B12', label: 'Витамин B12', unit: 'mcg' },
  { key: 'C', label: 'Витамин C', unit: 'mg' },
  { key: 'A', label: 'Витамин A', unit: 'mcg' },
  { key: 'D', label: 'Витамин D', unit: 'mcg' },
  { key: 'E', label: 'Витамин E', unit: 'mg' },
  { key: 'K', label: 'Витамин K', unit: 'mcg' },
  { key: 'B3', label: 'Витамин B3', unit: 'mg' },
  { key: 'Biotin', label: 'Биотин', unit: 'mcg' },
  { key: 'Choline', label: 'Холин', unit: 'mg' },
];

const MINERAL_CONFIG = [
  { key: 'Potassium', label: 'Калий', unit: 'mg' },
  { key: 'Calcium', label: 'Кальций', unit: 'mg' },
  { key: 'Silicon', label: 'Кремний', unit: 'mg' },
  { key: 'Magnesium', label: 'Магний', unit: 'mg' },
  { key: 'Sodium', label: 'Натрий', unit: 'mg' },
  { key: 'Sulfur', label: 'Сера', unit: 'mg' },
  { key: 'Phosphorus', label: 'Фосфор', unit: 'mg' },
  { key: 'Chlorine', label: 'Хлор', unit: 'mg' },
  { key: 'Vanadium', label: 'Ванадий', unit: 'mcg' },
  { key: 'Iron', label: 'Железо', unit: 'mg' },
  { key: 'Iodine', label: 'Йод', unit: 'mcg' },
  { key: 'Cobalt', label: 'Кобальт', unit: 'mcg' },
  { key: 'Manganese', label: 'Марганец', unit: 'mg' },
  { key: 'Copper', label: 'Медь', unit: 'mg' },
  { key: 'Molybdenum', label: 'Молибден', unit: 'mcg' },
  { key: 'Selenium', label: 'Селен', unit: 'mcg' },
  { key: 'Chromium', label: 'Хром', unit: 'mcg' },
  { key: 'Zinc', label: 'Цинк', unit: 'mg' },
  { key: 'Salt', label: 'Соль', unit: 'mg' },
];

const AMINO_CONFIG = [
  { key: 'Alanine', label: 'Аланин' },
  { key: 'Arginine', label: 'Аргинин' },
  { key: 'Asparagine', label: 'Аспарагин' },
  { key: 'AsparticAcid', label: 'Аспарагиновая кислота' },
  { key: 'Valine', label: 'Валин' },
  { key: 'Histidine', label: 'Гистидин' },
  { key: 'Glycine', label: 'Глицин' },
  { key: 'Glutamine', label: 'Глутамин' },
  { key: 'GlutamicAcid', label: 'Глутаминовая кислота' },
  { key: 'Isoleucine', label: 'Изолейцин' },
  { key: 'Leucine', label: 'Лейцин' },
  { key: 'Lysine', label: 'Лизин' },
  { key: 'Methionine', label: 'Метионин' },
  { key: 'Proline', label: 'Пролин' },
  { key: 'Serine', label: 'Серин' },
  { key: 'Tyrosine', label: 'Тирозин' },
  { key: 'Threonine', label: 'Треонин' },
  { key: 'Tryptophan', label: 'Триптофан' },
  { key: 'Phenylalanine', label: 'Фенилаланин' },
  { key: 'Cysteine', label: 'Цистеин' },
];

const FATTY_ACID_CONFIG = [
  { key: 'Omega3', label: 'Омега-3', unit: 'g' },
  { key: 'Omega6', label: 'Омега-6', unit: 'g' },
  { key: 'Omega9', label: 'Омега-9', unit: 'g' },
  { key: 'TransFats', label: 'Трансжиры', unit: 'g' },
  { key: 'Cholesterol', label: 'Холестерин', unit: 'mg' },
];

const CARB_TYPE_CONFIG = [
  { key: 'Glucose', label: 'Глюкоза', unit: 'g' },
  { key: 'Fructose', label: 'Фруктоза', unit: 'g' },
  { key: 'Galactose', label: 'Галактоза', unit: 'g' },
  { key: 'Sucrose', label: 'Сахароза', unit: 'g' },
  { key: 'Lactose', label: 'Лактоза', unit: 'g' },
  { key: 'Maltose', label: 'Мальтоза', unit: 'g' },
  { key: 'Starch', label: 'Крахмал', unit: 'g' },
  { key: 'Fiber', label: 'Клетчатка', unit: 'g' },
];

const mergeGoals = (rawGoals: Partial<NutrientGoalSet> | null | undefined): NutrientGoalSet => ({
  ...DEFAULT_GOALS,
  ...(rawGoals || {}),
  vitamins: { ...DEFAULT_GOALS.vitamins, ...(rawGoals?.vitamins || {}) },
  minerals: { ...DEFAULT_GOALS.minerals, ...(rawGoals?.minerals || {}) },
  aminoAcids: { ...DEFAULT_GOALS.aminoAcids, ...(rawGoals?.aminoAcids || {}) },
  fattyAcids: { ...DEFAULT_GOALS.fattyAcids, ...(rawGoals?.fattyAcids || {}) },
  carbohydrateTypes: { ...DEFAULT_GOALS.carbohydrateTypes, ...(rawGoals?.carbohydrateTypes || {}) },
});

interface ProgramMealExample {
  meal: string;
  items: string[];
  proteinNote?: string;
}

interface NutritionProgram {
  id: string;
  icon: string;
  name: string;
  tagline: string;
  description: string;
  bjuRatio: string;
  proteinRecommendation: string;
  suitableFor: string;
  sampleDay: ProgramMealExample[];
  macros: { proteinPct: number; fatPct: number; carbsPct: number };
  proteinPerKg?: [number, number];
  fastingWindow?: string;
}

const NUTRITION_PROGRAMS: NutritionProgram[] = [
  {
    id: 'high-protein',
    icon: '🥩',
    name: 'Фитнес / Высокобелковая',
    tagline: 'Рекомпозиция и набор сухой массы',
    description: 'Высокий белок для роста и удержания мышц, умеренные жиры и контролируемые углеводы.',
    bjuRatio: 'Белки 30-35% • Жиры 25-30% • Углеводы 30-40%',
    proteinRecommendation: '1.6-2.0 г/кг',
    suitableFor: 'Фитнес, рекомпозиция тела',
    macros: { proteinPct: 32, fatPct: 28, carbsPct: 40 },
    proteinPerKg: [1.6, 2.0],
    sampleDay: [
      { meal: 'Завтрак', items: ['3 яйца', '100 г творога'], proteinNote: '≈ 30 г белка' },
      { meal: 'Обед', items: ['150 г курицы', '200 г гречки'], proteinNote: '≈ 40 г белка' },
      { meal: 'Перекус', items: ['Протеиновый коктейль'], proteinNote: '≈ 25 г белка' },
      { meal: 'Ужин', items: ['150 г рыбы', 'Овощи'], proteinNote: '≈ 25 г белка' },
    ],
  },
  {
    id: 'mediterranean',
    icon: '🥗',
    name: 'Средиземноморская',
    tagline: 'Здоровье сердца и долголетие',
    description: 'Основа на рыбе, овощах, цельных злаках и оливковом масле.',
    bjuRatio: 'Белки 18% • Жиры 37% • Углеводы 45%',
    proteinRecommendation: '≈ 1.2 г/кг',
    suitableFor: 'Общее здоровье, кардиориски',
    macros: { proteinPct: 18, fatPct: 37, carbsPct: 45 },
    proteinPerKg: [1.1, 1.3],
    sampleDay: [
      { meal: 'Завтрак', items: ['Греческий йогурт', 'Орехи', 'Ягоды'] },
      { meal: 'Обед', items: ['Лосось', 'Булгур', 'Салат'] },
      { meal: 'Перекус', items: ['Сыр', 'Яблоко'] },
      { meal: 'Ужин', items: ['Овощи', 'Тунец'] },
    ],
  },
  {
    id: 'keto',
    icon: '🧈',
    name: 'Кето',
    tagline: 'Терапевтический низкоуглеводный режим',
    description: 'Высокий жир, умеренный белок и минимальные углеводы.',
    bjuRatio: 'Белки 20% • Жиры 70% • Углеводы <10%',
    proteinRecommendation: '≈ 1.2-1.6 г/кг',
    suitableFor: 'Терапевтические протоколы, инсулинорезистентность',
    macros: { proteinPct: 20, fatPct: 70, carbsPct: 10 },
    proteinPerKg: [1.2, 1.6],
    sampleDay: [
      { meal: 'Завтрак', items: ['Яйца', 'Авокадо'] },
      { meal: 'Обед', items: ['Лосось', 'Зелень'] },
      { meal: 'Перекус', items: ['Орехи'] },
      { meal: 'Ужин', items: ['Говядина', 'Оливковое масло'] },
    ],
  },
  {
    id: 'low-carb',
    icon: '🥑',
    name: 'Низкоуглеводная',
    tagline: 'Контроль сахара и аппетита',
    description: 'Умеренно высокий белок, сниженные углеводы и акцент на овощи.',
    bjuRatio: 'Белки 30% • Жиры 45% • Углеводы 25%',
    proteinRecommendation: '≈ 1.5 г/кг',
    suitableFor: 'Контроль сахара, снижение веса',
    macros: { proteinPct: 30, fatPct: 45, carbsPct: 25 },
    proteinPerKg: [1.4, 1.6],
    sampleDay: [
      { meal: 'Завтрак', items: ['Омлет (3 яйца)', 'Авокадо'] },
      { meal: 'Обед', items: ['Говядина', 'Салат'] },
      { meal: 'Перекус', items: ['Греческий йогурт'] },
      { meal: 'Ужин', items: ['Рыба', 'Брокколи'] },
    ],
  },
  {
    id: 'who-balance',
    icon: '⚖',
    name: 'Баланс (WHO)',
    tagline: 'Универсальный стандарт питания',
    description: 'Сбалансированный шаблон для большинства пользователей.',
    bjuRatio: 'Белки 18% • Жиры 27% • Углеводы 55%',
    proteinRecommendation: '≈ 1.0-1.2 г/кг',
    suitableFor: 'Базовая программа на каждый день',
    macros: { proteinPct: 18, fatPct: 27, carbsPct: 55 },
    proteinPerKg: [1.0, 1.2],
    sampleDay: [
      { meal: 'Завтрак', items: ['Овсянка', 'Яйцо'] },
      { meal: 'Обед', items: ['Курица', 'Рис', 'Овощи'] },
      { meal: 'Перекус', items: ['Йогурт'] },
      { meal: 'Ужин', items: ['Рыба', 'Салат'] },
    ],
  },
  {
    id: 'if-168',
    icon: '🕒',
    name: 'Периодическое голодание',
    tagline: '16/8: окно питания 12:00-20:00',
    description: 'Фокус на тайминге приемов пищи с плотной питательной загрузкой в окне питания.',
    bjuRatio: 'Белки 28% • Жиры 32% • Углеводы 40%',
    proteinRecommendation: '≈ 1.4-1.8 г/кг',
    suitableFor: 'Контроль аппетита и режима питания',
    macros: { proteinPct: 28, fatPct: 32, carbsPct: 40 },
    proteinPerKg: [1.4, 1.8],
    fastingWindow: '12:00 - 20:00',
    sampleDay: [
      { meal: '12:00', items: ['Яйца', 'Авокадо', 'Рыба'] },
      { meal: '16:00', items: ['Греческий йогурт', 'Орехи'] },
      { meal: '19:00', items: ['Курица', 'Рис', 'Овощи'] },
    ],
  },
  {
    id: 'recomposition',
    icon: '🧬',
    name: 'Рекомпозиция тела',
    tagline: 'Снижение жира с сохранением мышц',
    description: 'Высокий белок, умеренный дефицит калорий и равномерное распределение белка по приемам.',
    bjuRatio: 'Белки 30% • Жиры 30% • Углеводы 40%',
    proteinRecommendation: '1.8-2.2 г/кг',
    suitableFor: 'Одновременное жиросжигание и поддержка мышц',
    macros: { proteinPct: 30, fatPct: 30, carbsPct: 40 },
    proteinPerKg: [1.8, 2.2],
    sampleDay: [
      { meal: 'Завтрак', items: ['Омлет', 'Творог'], proteinNote: '≈ 30 г белка' },
      { meal: 'Обед', items: ['Индейка', 'Киноа', 'Овощи'], proteinNote: '≈ 40 г белка' },
      { meal: 'Перекус', items: ['Протеиновый коктейль', 'Орехи'], proteinNote: '≈ 25 г белка' },
      { meal: 'Ужин', items: ['Рыба', 'Салат'], proteinNote: '≈ 25 г белка' },
    ],
  },
];

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const deriveProgramGoals = (
  program: NutritionProgram,
  caloriesTarget: number,
  weightKg: number,
  currentFiberGoal: number
) => {
  const safeCalories = Math.max(1200, Number.isFinite(caloriesTarget) ? caloriesTarget : 2100);
  const safeWeight = Math.max(35, Number.isFinite(weightKg) ? weightKg : 70);

  const proteinByPct = (safeCalories * program.macros.proteinPct) / 100 / 4;
  const minProtein = program.proteinPerKg ? program.proteinPerKg[0] * safeWeight : proteinByPct;
  const maxProtein = program.proteinPerKg ? program.proteinPerKg[1] * safeWeight : proteinByPct;
  const protein = clamp(proteinByPct, minProtein, maxProtein);
  const fat = (safeCalories * program.macros.fatPct) / 100 / 9;
  const carbs = (safeCalories * program.macros.carbsPct) / 100 / 4;

  return {
    calories: Math.round(safeCalories),
    protein: Math.round(protein),
    fat: Math.round(fat),
    carbs: Math.round(carbs),
    fiber: Math.max(20, Math.round(currentFiberGoal || 30)),
  };
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
  const goals = mergeGoals(data.goals);
  const waterGoal = 2500; // 2.5L in ml

  const totals = useMemo(() => meals.reduce((acc: NutrientTotals, meal: any) => {
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
      if (item.product.fattyAcids) {
        Object.entries(item.product.fattyAcids).forEach(([k, v]) => {
          acc.fattyAcids[k] = (acc.fattyAcids[k] || 0) + (v as number) * factor;
        });
      }
      if (item.product.carbohydrateTypes) {
        Object.entries(item.product.carbohydrateTypes).forEach(([k, v]) => {
          acc.carbohydrateTypes[k] = (acc.carbohydrateTypes[k] || 0) + (v as number) * factor;
        });
      }
    });
    return acc;
  }, {
    calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0,
    vitamins: {}, minerals: {}, aminoAcids: {}, fattyAcids: {}, carbohydrateTypes: {}
  }), [meals]);

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
          <img src="/logo.png" alt="NUTRIA logo" className="w-full h-full object-cover" />
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
          {VITAMIN_CONFIG.map(({ key, label, unit }) => (
            <React.Fragment key={key}>
              <NutrientRow label={label} value={totals.vitamins[key] || 0} goal={goals.vitamins[key] || 1} unit={unit} />
            </React.Fragment>
          ))}
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
          {MINERAL_CONFIG.map(({ key, label, unit }) => (
            <React.Fragment key={key}>
              <NutrientRow label={label} value={totals.minerals[key] || 0} goal={goals.minerals[key] || 1} unit={unit} />
            </React.Fragment>
          ))}
        </div>
      </CollapsibleCard>

      {/* Жиры (детализация) */}
      <CollapsibleCard
        id="fatty"
        title="Жиры"
        icon={Zap}
        collapsedContent={
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {['Omega3', 'Omega6', 'Omega9'].map((k) => (
              <div key={k} className="px-2 py-1 bg-zinc-800 rounded text-[10px] text-zinc-400 whitespace-nowrap">
                {k}: {Math.round((totals.fattyAcids[k] || 0) / (goals.fattyAcids[k] || 1) * 100)}%
              </div>
            ))}
          </div>
        }
      >
        <div className="space-y-1">
          {FATTY_ACID_CONFIG.map(({ key, label, unit }) => (
            <React.Fragment key={key}>
              <NutrientRow label={label} value={totals.fattyAcids[key] || 0} goal={goals.fattyAcids[key] || 1} unit={unit} />
            </React.Fragment>
          ))}
        </div>
      </CollapsibleCard>

      {/* Углеводы (детализация) */}
      <CollapsibleCard
        id="carbtypes"
        title="Углеводы"
        icon={Zap}
        collapsedContent={
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {['Glucose', 'Fructose', 'Sucrose', 'Starch'].map((k) => (
              <div key={k} className="px-2 py-1 bg-zinc-800 rounded text-[10px] text-zinc-400 whitespace-nowrap">
                {k}: {Math.round((totals.carbohydrateTypes[k] || 0) / (goals.carbohydrateTypes[k] || 1) * 100)}%
              </div>
            ))}
          </div>
        }
      >
        <div className="space-y-1">
          {CARB_TYPE_CONFIG.map(({ key, label, unit }) => (
            <React.Fragment key={key}>
              <NutrientRow label={label} value={totals.carbohydrateTypes[key] || 0} goal={goals.carbohydrateTypes[key] || 1} unit={unit} />
            </React.Fragment>
          ))}
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
          {AMINO_CONFIG.map(({ key, label }) => (
            <React.Fragment key={key}>
              <NutrientRow label={label} value={totals.aminoAcids[key] || 0} goal={goals.aminoAcids[key] || 1} unit="mg" />
            </React.Fragment>
          ))}
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

const SummaryScreen = ({
  goals,
  fastingMode,
  customFastingHours,
  isFastingActive,
  fastingEndAt,
  nowTs,
  onSetMode,
  onSetCustomHours,
  onStart,
  onStop,
  onApplyProgram,
}: {
  goals: NutrientGoalSet;
  fastingMode: FastingMode;
  customFastingHours: number;
  isFastingActive: boolean;
  fastingEndAt: number | null;
  nowTs: number;
  onSetMode: (mode: FastingMode) => void;
  onSetCustomHours: (hours: number) => void;
  onStart: () => void;
  onStop: () => void;
  onApplyProgram: (payload: { calories: number; protein: number; fat: number; carbs: number; fiber: number }) => Promise<void>;
}) => {
  const fastingHours = fastingMode === 'CUSTOM' ? customFastingHours : FASTING_PRESETS[fastingMode].fastingHours;
  const eatingHours = Math.max(0, 24 - fastingHours);
  const remainingMs = isFastingActive && fastingEndAt ? Math.max(0, fastingEndAt - nowTs) : 0;
  const [selectedProgram, setSelectedProgram] = useState<NutritionProgram | null>(null);
  const [programWeightKg, setProgramWeightKg] = useState(70);
  const [programCalories, setProgramCalories] = useState(2100);
  const [isApplyingProgram, setIsApplyingProgram] = useState(false);

  useEffect(() => {
    setProgramCalories(Math.max(1200, Math.round(goals.calories || 2100)));
  }, [goals.calories]);

  const openProgram = (program: NutritionProgram) => {
    setSelectedProgram(program);
  };

  const applyProgram = async () => {
    if (!selectedProgram) return;
    setIsApplyingProgram(true);
    try {
      const payload = deriveProgramGoals(selectedProgram, programCalories, programWeightKg, goals.fiber || 30);
      await onApplyProgram(payload);
      alert(`Программа "${selectedProgram.name}" применена к дневнику.`);
      setSelectedProgram(null);
    } catch (e) {
      console.error(e);
      alert('Не удалось применить программу. Попробуйте снова.');
    } finally {
      setIsApplyingProgram(false);
    }
  };

  return (
    <div className="p-4">
      <header className="mb-6 pt-4">
        <h1 className="text-3xl font-bold tracking-tight">Сводки</h1>
        <p className="text-zinc-500 text-sm">Макроэлементы, анализ и программы</p>
      </header>

      <div className="space-y-3">
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
          <p className="text-xs uppercase tracking-widest text-zinc-500 mb-2">Макроэлементы</p>
          <p className="text-sm text-zinc-300">Цели на день: {Math.round(goals.protein)}Б / {Math.round(goals.fat)}Ж / {Math.round(goals.carbs)}У</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
          <p className="text-xs uppercase tracking-widest text-zinc-500 mb-2">Витамины</p>
          <p className="text-sm text-zinc-300">Контроль ключевых дефицитов: A, D, B12, C, магний и железо.</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
          <p className="text-xs uppercase tracking-widest text-zinc-500 mb-2">Гликемическая нагрузка</p>
          <p className="text-sm text-zinc-300">AI оценивает качество углеводов и стабильность сахара крови.</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
          <p className="text-xs uppercase tracking-widest text-zinc-500 mb-2">Анализ AI</p>
          <p className="text-sm text-zinc-300">Персональные рекомендации по меню, дефицитам и распределению БЖУ.</p>
        </div>
      </div>

      <div className="mt-4 bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold">Программы питания</h3>
          <span className="text-[10px] uppercase tracking-widest text-zinc-500">Сводки</span>
        </div>
        <div className="space-y-2">
          {NUTRITION_PROGRAMS.map((program) => (
            <button
              key={program.id}
              onClick={() => openProgram(program)}
              className="w-full text-left bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 transition-colors"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-100">{program.icon} {program.name}</p>
                  <p className="text-xs text-zinc-400 mt-0.5">{program.tagline}</p>
                </div>
                <span className="text-[10px] uppercase tracking-widest text-emerald-400">Открыть</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
        <h3 className="text-lg font-bold mb-4">Голодание</h3>

        <div className="grid grid-cols-4 gap-2 mb-4 bg-zinc-800/40 p-1 rounded-xl border border-zinc-700/60">
          {(['OFF', '16:8', '18:6', 'CUSTOM'] as FastingMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => onSetMode(mode)}
              className={cn(
                'py-2 text-sm rounded-lg transition-colors',
                fastingMode === mode ? 'bg-zinc-600 text-zinc-100 font-semibold' : 'text-zinc-400 hover:text-zinc-200'
              )}
            >
              {FASTING_PRESETS[mode].label}
            </button>
          ))}
        </div>

        {fastingMode === 'CUSTOM' && (
          <div className="mb-4">
            <label className="text-xs text-zinc-400 block mb-2">Длительность голодания (часы)</label>
            <input
              type="number"
              min={12}
              max={23}
              value={customFastingHours}
              onChange={(e) => onSetCustomHours(Number(e.target.value))}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl py-3 px-4 text-zinc-100"
            />
          </div>
        )}

        <div className="mb-4 text-sm text-zinc-400">
          {fastingMode === 'OFF'
            ? 'Отслеживание голодания выключено'
            : `Режим: ${fastingHours}:${eatingHours} • окно питания ${eatingHours}ч`}
        </div>

        <div className="flex justify-center mb-5">
          <div className="w-40 h-40 rounded-full border-4 border-zinc-700 flex items-center justify-center text-center">
            <div>
              <div className="text-3xl font-bold text-zinc-100">{isFastingActive ? formatHms(remainingMs) : `${fastingHours}ч`}</div>
              <div className="text-xs text-zinc-500 mt-1">{isFastingActive ? 'до конца' : 'длительность'}</div>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onStart}
            disabled={fastingMode === 'OFF'}
            className={cn(
              'flex-1 py-3 rounded-xl font-semibold',
              fastingMode === 'OFF'
                ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                : 'bg-emerald-500 text-white'
            )}
          >
            Начать голодание
          </button>
          <button
            onClick={onStop}
            className="flex-1 py-3 rounded-xl font-semibold bg-zinc-800 text-zinc-300 border border-zinc-700"
          >
            Прервать голодание
          </button>
        </div>
      </div>

      <BottomSheet isOpen={!!selectedProgram} onClose={() => setSelectedProgram(null)} title={selectedProgram ? `${selectedProgram.icon} ${selectedProgram.name}` : 'Программа'}>
        {selectedProgram && (
          <div className="space-y-4">
            <div className="bg-zinc-800/50 border border-zinc-700 rounded-xl p-4">
              <p className="text-sm text-zinc-200 font-semibold mb-2">Описание</p>
              <p className="text-sm text-zinc-400 leading-relaxed">{selectedProgram.description}</p>
              <p className="text-xs text-zinc-500 mt-3">Подходит: {selectedProgram.suitableFor}</p>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div className="bg-zinc-800/50 border border-zinc-700 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">Соотношение БЖУ</p>
                <p className="text-sm text-zinc-200">{selectedProgram.bjuRatio}</p>
              </div>
              <div className="bg-zinc-800/50 border border-zinc-700 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">Рекомендация белка</p>
                <p className="text-sm text-zinc-200">{selectedProgram.proteinRecommendation}</p>
              </div>
              {selectedProgram.fastingWindow && (
                <div className="bg-zinc-800/50 border border-zinc-700 rounded-xl p-3">
                  <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">Окно питания</p>
                  <p className="text-sm text-zinc-200">{selectedProgram.fastingWindow}</p>
                </div>
              )}
            </div>

            <div className="bg-zinc-800/50 border border-zinc-700 rounded-xl p-4">
              <p className="text-sm font-semibold text-zinc-200 mb-3">Пример дня питания</p>
              <div className="space-y-3">
                {selectedProgram.sampleDay.map((entry, idx) => (
                  <div key={`${entry.meal}-${idx}`} className="border border-zinc-700/70 rounded-lg p-3 bg-zinc-900/40">
                    <p className="text-xs uppercase tracking-widest text-zinc-500 mb-1">{entry.meal}</p>
                    <p className="text-sm text-zinc-300">{entry.items.join(' + ')}</p>
                    {entry.proteinNote && <p className="text-xs text-emerald-400 mt-1">{entry.proteinNote}</p>}
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-zinc-800/50 border border-zinc-700 rounded-xl p-4">
              <p className="text-sm font-semibold text-zinc-200 mb-3">Параметры применения</p>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs text-zinc-400">
                  Вес (кг)
                  <input
                    type="number"
                    min={35}
                    max={250}
                    value={programWeightKg}
                    onChange={(e) => setProgramWeightKg(Number(e.target.value))}
                    className="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded-lg py-2 px-3 text-zinc-100"
                  />
                </label>
                <label className="text-xs text-zinc-400">
                  Калории/день
                  <input
                    type="number"
                    min={1200}
                    max={6000}
                    value={programCalories}
                    onChange={(e) => setProgramCalories(Number(e.target.value))}
                    className="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded-lg py-2 px-3 text-zinc-100"
                  />
                </label>
              </div>
            </div>

            <button
              onClick={applyProgram}
              disabled={isApplyingProgram}
              className={cn(
                'w-full py-3 rounded-xl font-semibold',
                isApplyingProgram ? 'bg-zinc-700 text-zinc-400 cursor-not-allowed' : 'bg-emerald-500 text-white'
              )}
            >
              {isApplyingProgram ? 'Применяем...' : 'Применить к дневнику'}
            </button>
          </div>
        )}
      </BottomSheet>
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
  const [photoRecognitionError, setPhotoRecognitionError] = useState('');
  const [barcodeQuery, setBarcodeQuery] = useState('');
  const [barcodeScannerError, setBarcodeScannerError] = useState('');
  const [isBarcodeScanning, setIsBarcodeScanning] = useState(false);
  const [fastingMode, setFastingMode] = useState<FastingMode>('OFF');
  const [customFastingHours, setCustomFastingHours] = useState(14);
  const [isFastingActive, setIsFastingActive] = useState(false);
  const [fastingStartAt, setFastingStartAt] = useState<number | null>(null);
  const [fastingEndAt, setFastingEndAt] = useState<number | null>(null);
  const [nowTs, setNowTs] = useState(Date.now());

  const [selectedProductForAmount, setSelectedProductForAmount] = useState<Product | null>(null);
  const [foodAmount, setFoodAmount] = useState('100');
  const recognitionRef = useRef<any>(null);
  const barcodeScannerRef = useRef<Html5QrcodeType | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const html5QrcodeModuleRef = useRef<typeof import('html5-qrcode') | null>(null);
  const barcodeHandledRef = useRef(false);
  const fastingNotifiedRef = useRef(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const getHtml5QrcodeModule = async () => {
    if (!html5QrcodeModuleRef.current) {
      html5QrcodeModuleRef.current = await import('html5-qrcode');
    }
    return html5QrcodeModuleRef.current;
  };

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

  useEffect(() => {
    try {
      const raw = localStorage.getItem(FASTING_STATE_STORAGE_KEY);
      if (!raw) return;

      const saved = JSON.parse(raw);
      if (saved?.fastingMode) setFastingMode(saved.fastingMode);
      if (Number.isFinite(saved?.customFastingHours)) setCustomFastingHours(saved.customFastingHours);
      if (typeof saved?.isFastingActive === 'boolean') setIsFastingActive(saved.isFastingActive);
      if (Number.isFinite(saved?.fastingStartAt)) setFastingStartAt(saved.fastingStartAt);
      if (Number.isFinite(saved?.fastingEndAt)) setFastingEndAt(saved.fastingEndAt);
    } catch (e) {
      console.warn('Failed to restore fasting timer state:', e);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(FASTING_STATE_STORAGE_KEY, JSON.stringify({
        fastingMode,
        customFastingHours,
        isFastingActive,
        fastingStartAt,
        fastingEndAt,
      }));
    } catch (e) {
      console.warn('Failed to persist fasting timer state:', e);
    }
  }, [fastingMode, customFastingHours, isFastingActive, fastingStartAt, fastingEndAt]);

  useEffect(() => {
    if (!isFastingActive) return;
    setNowTs(Date.now());
    const timer = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isFastingActive]);

  const sendFastingDoneNotification = async () => {
    const title = 'NUTRIA: Голодание завершено';
    const body = 'Время голодания истекло. Можно открыть окно питания.';

    try {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration();
        if (registration) {
          await registration.showNotification(title, {
            body,
            icon: '/icons/icon-192.png',
            badge: '/icons/icon-192.png',
            tag: 'fasting-finished',
          });
          return;
        }
      }
    } catch (e) {
      console.warn('Service worker notification failed:', e);
    }

    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body, icon: '/icons/icon-192.png', tag: 'fasting-finished' });
      }
    } catch (e) {
      console.warn('Window notification failed:', e);
    }
  };

  const completeFasting = async () => {
    if (fastingNotifiedRef.current) return;
    fastingNotifiedRef.current = true;
    setIsFastingActive(false);

    if (navigator.vibrate) {
      navigator.vibrate([250, 150, 250, 150, 450]);
    }

    await sendFastingDoneNotification();
  };

  useEffect(() => {
    if (!isFastingActive || !fastingEndAt) return;

    const remaining = fastingEndAt - Date.now();
    if (remaining <= 0) {
      completeFasting();
      return;
    }

    const doneTimer = setTimeout(() => {
      completeFasting();
    }, remaining);

    return () => clearTimeout(doneTimer);
  }, [isFastingActive, fastingEndAt]);

  const handleSetFastingMode = (mode: FastingMode) => {
    setFastingMode(mode);
    fastingNotifiedRef.current = false;
    if (mode === 'OFF') {
      setIsFastingActive(false);
      setFastingStartAt(null);
      setFastingEndAt(null);
    }
  };

  const handleSetCustomFastingHours = (hours: number) => {
    const normalized = Math.max(12, Math.min(23, Number.isFinite(hours) ? hours : 14));
    setCustomFastingHours(normalized);
  };

  const handleStartFasting = () => {
    if (fastingMode === 'OFF') {
      alert('Выберите режим голодания.');
      return;
    }

    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => null);
    }

    const fastingHours = fastingMode === 'CUSTOM' ? customFastingHours : FASTING_PRESETS[fastingMode].fastingHours;
    const startAt = Date.now();
    const endAt = startAt + fastingHours * 60 * 60 * 1000;

    fastingNotifiedRef.current = false;
    setFastingStartAt(startAt);
    setFastingEndAt(endAt);
    setIsFastingActive(true);
    setNowTs(startAt);
  };

  const handleStopFasting = () => {
    fastingNotifiedRef.current = false;
    setIsFastingActive(false);
    setFastingStartAt(null);
    setFastingEndAt(null);
  };

  const extractBarcodeCandidates = (input: string): string[] => {
    const raw = String(input || '').trim();
    if (!raw) return [];

    const candidates = new Set<string>();
    candidates.add(raw);

    try {
      const url = new URL(raw);
      const queryKeys = ['barcode', 'code', 'ean', 'ean13', 'upc', 'gtin', 'id'];
      for (const key of queryKeys) {
        const value = url.searchParams.get(key);
        if (value) candidates.add(value.trim());
      }
      const pathParts = url.pathname.split('/').map(p => p.trim()).filter(Boolean);
      for (const part of pathParts) {
        if (part.length >= 6) candidates.add(part);
      }
    } catch {
      // not a url
    }

    const digitGroups = raw.match(/\d{8,14}/g) || [];
    digitGroups.forEach(group => candidates.add(group));

    const digitsOnly = raw.replace(/\D/g, '');
    if (digitsOnly.length >= 8) candidates.add(digitsOnly);

    return Array.from(candidates).map(v => v.trim()).filter(v => v.length > 0);
  };

  const stopBarcodeScanner = async () => {
    const scanner = barcodeScannerRef.current;
    if (!scanner) return;

    try {
      await scanner.stop();
    } catch (e) {
      console.warn('Stop scanner warning:', e);
    }

    try {
      await scanner.clear();
    } catch (e) {
      console.warn('Clear scanner warning:', e);
    }

    barcodeScannerRef.current = null;
    setIsBarcodeScanning(false);
  };

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

  const updateGoals = async (payload: { calories: number; protein: number; fat: number; carbs: number; fiber: number }) => {
    const res = await fetch('/api/diary/goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error || 'Не удалось обновить цели');
    }

    await fetchDiary();
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
          if (item.product.fattyAcids) {
            Object.entries(item.product.fattyAcids).forEach(([k, v]) => {
              acc.fattyAcids[k] = (acc.fattyAcids[k] || 0) + (v as number) * factor;
            });
          }
          if (item.product.carbohydrateTypes) {
            Object.entries(item.product.carbohydrateTypes).forEach(([k, v]) => {
              acc.carbohydrateTypes[k] = (acc.carbohydrateTypes[k] || 0) + (v as number) * factor;
            });
          }
        });
        return acc;
      }, { 
        calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0,
        vitamins: {}, minerals: {}, aminoAcids: {}, fattyAcids: {}, carbohydrateTypes: {}
      });

      const goals = mergeGoals(data.goals);

      const prompt = `
        User current nutrition today:
        Calories: ${totals.calories}/${goals.calories}
        Protein: ${totals.protein}/${goals.protein}
        Fat: ${totals.fat}/${goals.fat}
        Carbs: ${totals.carbs}/${goals.carbs}
        Fiber: ${totals.fiber}/${goals.fiber}
        Vitamins: ${JSON.stringify(totals.vitamins)}
        Minerals: ${JSON.stringify(totals.minerals)}
        Fatty Acids: ${JSON.stringify(totals.fattyAcids)}
        Carbohydrate Types: ${JSON.stringify(totals.carbohydrateTypes)}
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

  const handleSearch = (val: string) => {
    setSearchQuery(val);
  };

  useEffect(() => {
    const val = searchQuery.trim();

    if (searchAbortRef.current) {
      searchAbortRef.current.abort();
      searchAbortRef.current = null;
    }

    if (val.length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    const controller = new AbortController();
    searchAbortRef.current = controller;

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(`/api/products/search?q=${encodeURIComponent(val)}`, { signal: controller.signal });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          console.warn('Search error:', err);
          setSearchResults([]);
          return;
        }
        const data = await res.json();
        setSearchResults(Array.isArray(data) ? data : []);
      } catch (e: any) {
        if (e?.name !== 'AbortError') {
          console.error(e);
          setSearchResults([]);
        }
      } finally {
        setIsSearching(false);
      }
    }, 280);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery]);

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

    setPhotoRecognitionError('');
    setRecognizedItems([]);
    setIsRecognizing(true);
    setIsPhotoSheetOpen(true);
    setIsActionSheetOpen(false);

    try {
      const optimizedImage = await optimizeImageForRecognition(file);

      const barcodeProbePrompt = `Read this photo and extract only barcode-like number strings from visible package labels.
Return ONLY JSON object:
{
  "barcodeCandidates": ["4601234567890"]
}
Rules:
- Include only strings with 8-14 digits.
- No spaces, no dashes.
- If no barcode is visible return empty array.`;
      const barcodeProbeText = await generateAI(barcodeProbePrompt, "application/json", optimizedImage);
      const barcodeProbeRaw = parseAiJsonPayload(barcodeProbeText || '{}');
      const photoBarcodeCandidates = Array.from(new Set<string>(
        (Array.isArray(barcodeProbeRaw?.barcodeCandidates) ? barcodeProbeRaw.barcodeCandidates : [])
          .flatMap((value: any) => extractBarcodeCandidates(String(value || '')))
      )).filter((value: string) => value.length > 0);

      for (const barcodeCandidate of photoBarcodeCandidates) {
        const barcodeRes = await fetch(`/api/products/barcode/${encodeURIComponent(barcodeCandidate)}`);
        if (!barcodeRes.ok) continue;
        const barcodeProduct = await barcodeRes.json().catch(() => null);
        if (!barcodeProduct) continue;

        setRecognizedItems([
          {
            name: barcodeProduct.name,
            amount: 100,
            aliases: [],
            barcodeCandidates: [barcodeCandidate],
            confidence: 0.95,
            matchedBy: `barcode:${barcodeCandidate}`,
            product: barcodeProduct,
          }
        ]);
        return;
      }

      const prompt = `Analyze this food photo and return ONLY valid JSON.

Priority:
1) If a barcode/QR with product code is visible, extract numeric code candidates.
2) Recognize foods or dish components and estimate amount in grams.
3) Prefer Russian names and include aliases (RU + EN) for search.

Return JSON object in this exact shape:
{
  "items": [
    {
      "name": "основное название",
      "amount": 120,
      "aliases": ["алиас ru", "alias en"],
      "barcodeCandidates": ["4601234567890"],
      "confidence": 0.0,
      "isPackaged": false
    }
  ]
}

Rules:
- For mixed dishes split to 2-5 main edible components.
- Ignore plate/table/background.
- amount must be positive number.
- confidence from 0.0 to 1.0.`;
      const responseText = await generateAI(prompt, "application/json", optimizedImage);

      const recognizedRaw = parseAiJsonPayload(responseText || "[]");
      const recognizedList = Array.isArray(recognizedRaw)
        ? recognizedRaw
        : (Array.isArray(recognizedRaw?.items) ? recognizedRaw.items : []);

      let recognizedItemsSource = recognizedList;
      if (recognizedItemsSource.length === 0) {
        const singleFoodFallbackPrompt = `Identify the main edible item in this photo.
Return ONLY JSON object:
{
  "name": "банан",
  "amount": 120,
  "aliases": ["banana"],
  "confidence": 0.0
}
Rules:
- Return exactly one food item.
- Ignore background and non-food objects.
- amount is estimated grams (positive number).
- If uncertain, still provide best guess.`;
        const singleFoodText = await generateAI(singleFoodFallbackPrompt, "application/json", optimizedImage);
        const singleFoodRaw = parseAiJsonPayload(singleFoodText || '{}');
        if (singleFoodRaw && typeof singleFoodRaw === 'object' && !Array.isArray(singleFoodRaw)) {
          recognizedItemsSource = [singleFoodRaw];
        }
      }

      const normalizedItems = recognizedItemsSource
        .map((item: any) => {
          const name = String(item?.name || item?.food || item?.product || '').trim();
          const amountValue = Number(item?.amount ?? item?.grams ?? item?.weight ?? 100);
          const amount = Number.isFinite(amountValue) && amountValue > 0 ? amountValue : 100;
          const aliases = Array.isArray(item?.aliases)
            ? item.aliases.map((value: any) => String(value).trim()).filter((value: string) => value.length > 0)
            : [];
          const barcodeCandidates = Array.isArray(item?.barcodeCandidates)
            ? item.barcodeCandidates.map((value: any) => String(value).trim()).filter((value: string) => value.length > 0)
            : (String(item?.barcode || '').trim() ? [String(item.barcode).trim()] : []);
          const confidenceValue = Number(item?.confidence);
          const confidence = Number.isFinite(confidenceValue) ? Math.max(0, Math.min(1, confidenceValue)) : undefined;
          return { name, amount, aliases, barcodeCandidates, confidence };
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
        existing.barcodeCandidates = Array.from(new Set([...(existing.barcodeCandidates || []), ...(item.barcodeCandidates || [])]));
        if (typeof existing.confidence === 'number' && typeof item.confidence === 'number') {
          existing.confidence = Math.max(existing.confidence, item.confidence);
        }
      }

      const recognized = Array.from(deduplicatedMap.values());
      
      // Match with database products (try canonical name + aliases)
      const matchedItems = await Promise.all(recognized.map(async (item: any) => {
        const barcodeCandidates = Array.from(new Set<string>(
          (item.barcodeCandidates || []).flatMap((value: string) => extractBarcodeCandidates(value))
        )).filter((value: string) => value.length > 0);

        for (const barcodeCandidate of barcodeCandidates) {
          const barcodeRes = await fetch(`/api/products/barcode/${encodeURIComponent(barcodeCandidate)}`);
          if (!barcodeRes.ok) continue;

          const barcodeProduct = await barcodeRes.json().catch(() => null);
          if (barcodeProduct) {
            return { ...item, matchedBy: `barcode:${barcodeCandidate}`, product: barcodeProduct };
          }
        }

        const candidateQueries = Array.from(new Set([item.name, ...(item.aliases || [])])).filter(Boolean);
        const expandedQueries = Array.from(new Set(
          candidateQueries.flatMap((query: string) => {
            const q = String(query).trim();
            if (!q) return [];
            const words = q.split(/\s+/).filter((w) => w.length > 2);
            const stemmed = q
              .replace(/\([^)]*\)/g, ' ')
              .replace(/[.,;:!?'"`~]/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();
            return [q, stemmed, ...words];
          })
        )).filter(Boolean);

        for (const query of expandedQueries) {
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
      if (matchedItems.length === 0) {
        setPhotoRecognitionError('На фото не удалось уверенно распознать продукты. Попробуйте сделать фото ближе и при хорошем освещении.');
      }
    } catch (e) {
      console.error("Recognition Error:", e);
      setPhotoRecognitionError('Ошибка распознавания фото. Попробуйте другое фото.');
    } finally {
      setIsRecognizing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const findProductByBarcode = async (inputCode: string): Promise<boolean> => {
    const candidates = extractBarcodeCandidates(inputCode);
    if (candidates.length === 0) return false;

    for (const code of candidates) {
      try {
        const res = await fetch(`/api/products/barcode/${encodeURIComponent(code)}`);
        if (!res.ok) continue;

        const product = await res.json();
        const amount = prompt(`Найдено: ${product.name}. Введите количество (г):`, '100');
        if (amount) {
          await addFood(
            product.id,
            Number(amount),
            (product.isUsda || product.isAiEstimated) ? product : undefined
          );
        }

        setIsBarcodeSheetOpen(false);
        setBarcodeQuery('');
        setBarcodeScannerError('');
        return true;
      } catch (e) {
        console.error('Barcode lookup error:', e);
      }
    }

    return false;
  };

  const handleBarcodeScan = async () => {
    if (!barcodeQuery.trim()) return;
    try {
      const found = await findProductByBarcode(barcodeQuery);
      if (!found) {
        alert('Продукт не найден в базе');
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (!isBarcodeSheetOpen) {
      barcodeHandledRef.current = false;
      stopBarcodeScanner();
      return;
    }

    let cancelled = false;

    const startScanner = async () => {
      setBarcodeScannerError('');

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setBarcodeScannerError('Камера не поддерживается в этом браузере.');
        return;
      }

      try {
        const readerEl = document.getElementById('barcode-reader');
        if (!readerEl) {
          setBarcodeScannerError('Не удалось инициализировать область сканера.');
          return;
        }

        readerEl.innerHTML = '';

        const { Html5Qrcode } = await getHtml5QrcodeModule();
        const scanner = new Html5Qrcode('barcode-reader');
        barcodeScannerRef.current = scanner;
        barcodeHandledRef.current = false;

        const cameras = await Html5Qrcode.getCameras().catch(() => [] as Array<{ id: string; label: string }>);
        const backCamera = cameras.find((cam) => /back|rear|environment|зад/i.test(cam.label || ''));
        const preferredCamera = backCamera ? { deviceId: { exact: backCamera.id } } : { facingMode: 'environment' };

        const scanConfig = {
          fps: 12,
          qrbox: { width: 240, height: 240 },
          aspectRatio: 1,
          disableFlip: false,
        };

        const onDecodeSuccess = async (decodedText: string) => {
          if (barcodeHandledRef.current || cancelled) return;
          barcodeHandledRef.current = true;

          setBarcodeQuery(decodedText);
          const found = await findProductByBarcode(decodedText);
          if (!found) {
            setBarcodeScannerError('Код считан, но продукт не найден. Попробуйте вручную.');
            barcodeHandledRef.current = false;
          }
        };

        const onDecodeError = () => {
          // ignore per-frame decode errors
        };

        try {
          await scanner.start(preferredCamera as any, scanConfig, onDecodeSuccess, onDecodeError);
        } catch {
          await scanner.start({ facingMode: 'environment' }, scanConfig, onDecodeSuccess, onDecodeError);
        }

        if (!cancelled) {
          setIsBarcodeScanning(true);
        }
      } catch (e) {
        console.error('Scanner start error:', e);
        if (!cancelled) {
          setBarcodeScannerError('Не удалось показать камеру. Проверьте разрешение, HTTPS и перезапустите сканер.');
        }
      }
    };

    startScanner();

    return () => {
      cancelled = true;
      stopBarcodeScanner();
    };
  }, [isBarcodeSheetOpen]);

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
            <SummaryScreen
              goals={mergeGoals(diaryData.goals)}
              fastingMode={fastingMode}
              customFastingHours={customFastingHours}
              isFastingActive={isFastingActive}
              fastingEndAt={fastingEndAt}
              nowTs={nowTs}
              onSetMode={handleSetFastingMode}
              onSetCustomHours={handleSetCustomFastingHours}
              onStart={handleStartFasting}
              onStop={handleStopFasting}
              onApplyProgram={updateGoals}
            />
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
            {photoRecognitionError && (
              <p className="text-sm text-orange-400 text-center">{photoRecognitionError}</p>
            )}
            {recognizedItems.length === 0 && !photoRecognitionError && (
              <p className="text-sm text-zinc-500 text-center">Загрузите четкое фото еды, и я попробую распознать состав блюда.</p>
            )}
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
            <div id="barcode-reader" className="absolute inset-0 z-10" />
            {!isBarcodeScanning && (
              <ScanBarcode size={64} className="text-emerald-500/20 z-20" />
            )}
            <div className="absolute inset-x-0 top-1/2 h-0.5 bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)] animate-pulse z-20" />
          </div>
          {barcodeScannerError && (
            <p className="text-xs text-orange-400 mb-3 text-center">{barcodeScannerError}</p>
          )}
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
