import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { Html5Qrcode as Html5QrcodeType } from 'html5-qrcode';
import { 
  Utensils, 
  BarChart3, 
  Plus, 
  ChevronDown, 
  ChevronUp,
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
  MicOff,
  Pencil,
  SlidersHorizontal,
  Sun,
  Moon,
  Droplet,
  Calendar,
  ChevronRight,
  ArrowRight,
  UserRound,
  Sparkles,
  ListChecks,
  MessageCircle,
  Send
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
  // Если продукт — снимок блюда из ингредиентов (распознано голосом/фото или "Создать блюдо")
  recipeId?: string;
  // Micronutrients stored as JSON in DB, parsed here
  vitamins?: Record<string, number>;
  minerals?: Record<string, number>;
  aminoAcids?: Record<string, number>;
  fattyAcids?: Record<string, number>;
  carbohydrateTypes?: Record<string, number>;
}

// "Недавние": продукт/блюдо + метаданные последнего использования
interface RecentFoodItem extends Product {
  lastWeightGrams?: number | null;
  useCount?: number;
}

// "Мои блюда": метаданные рецепта + связанный продукт-снимок для добавления в дневник
interface MyRecipe {
  id: string;
  name: string;
  totalIngredientWeightGrams: number;
  cookedWeightGrams: number;
  product: Product;
  ingredients?: { productId: string; weightGrams: number }[];
}

// Черновик строки ингредиента при создании блюда в "Мои"
interface DishIngredientDraft {
  productId: string;
  name: string;
  weightGrams: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
}

// Черновик строки в едином экране «Проверьте результат» — продукт ещё не сохранён в дневник
interface ReviewDraftItem {
  tempId: string;
  product: Product;
  amount: number;
  usdaData?: Product;
  // Если этот пункт — блюдо, собранное из ингредиентов (голос/фото "Котлета по-киевски" и т.п.),
  // храним состав, чтобы можно было открыть его на правку без повторного запроса к серверу
  dishIngredients?: DishIngredientDraft[];
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

interface UserProfileSettings {
  sex: 'male' | 'female';
  weightKg: number;
  heightCm: number;
  age: number;
  activity: 'low' | 'moderate' | 'high' | 'very_high';
  goal: 'lose' | 'maintain' | 'gain' | 'recomposition';
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

interface DiaryHistoryPoint {
  date: string;
  mealsCount: number;
  waterIntake: number;
  totals: {
    calories: number;
    protein: number;
    fat: number;
    carbs: number;
    fiber: number;
  };
}

interface DiaryData {
  meals: Meal[];
  goals: Partial<NutrientGoalSet> | null;
  waterIntake: number;
  date?: string;
}

interface Hint {
  severity: 'low' | 'med' | 'high';
  title: string;
  explanation: string;
  cta?: string;
}

interface RecognizedPhotoItem {
  name: string;
  amount: number;
  aliases?: string[];
  visibleText?: string[];
  product?: Product | null;
  matchedBy?: string | null;
  matchScore?: number;
  recognitionConfidence?: number | null;
  correctedByUser?: boolean;
}

interface PhotoDishEstimate {
  name: string;
  amount: number;
  totalCalories: number;
  totalProtein: number;
  totalFat: number;
  totalCarbs: number;
  totalFiber: number;
  explanation?: string;
  confidence?: number | null;
  product: Product;
}

type PhotoCaptureMode = 'ingredients' | 'whole_dish';

type ThemeMode = 'light' | 'dark';

type FastingMode = 'OFF' | '16:8' | '18:6' | 'CUSTOM';

const FASTING_PRESETS: Record<FastingMode, { label: string; fastingHours: number; eatingHours: number }> = {
  OFF: { label: 'ВЫКЛ', fastingHours: 0, eatingHours: 24 },
  '16:8': { label: '16:8', fastingHours: 16, eatingHours: 8 },
  '18:6': { label: '18:6', fastingHours: 18, eatingHours: 6 },
  CUSTOM: { label: 'Свой', fastingHours: 14, eatingHours: 10 },
};

const FASTING_STATE_STORAGE_KEY = 'nutria_fasting_timer_v1';
const THEME_MODE_STORAGE_KEY = 'nutria_theme_mode_v1';

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

const toDateKey = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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

const BottomNav = ({ activeTab, onTabChange, unreadMessages = 0 }: { activeTab: string, onTabChange: (tab: string) => void, unreadMessages?: number }) => {
  const tabs = [
    { id: 'nutrition', label: 'Дневник', icon: Utensils },
    { id: 'stats', label: 'Статистика', icon: BarChart3 },
    { id: 'profile', label: 'Профиль', icon: UserRound },
  ];
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 pb-safe pt-2 px-2 flex justify-around items-center z-40"
      style={{ background: PROTO.coolBlock, borderTop: `1px solid ${PROTO.borderLt}` }}
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className="relative flex flex-col items-center gap-1 transition-colors px-6 py-1"
            style={{ color: isActive ? PROTO.primary : PROTO.textLt }}
          >
            <Icon size={22} strokeWidth={isActive ? 2.2 : 1.8} />
            {tab.id === 'profile' && unreadMessages > 0 && (
              <span
                className="absolute top-0 right-3 w-2 h-2 rounded-full"
                style={{ background: PROTO.terra }}
              />
            )}
            <span className="text-[10px] uppercase tracking-wider" style={{ fontWeight: isActive ? 700 : 400 }}>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
};

const FAB = ({ onClick }: { onClick: () => void }) => {
  return (
    <motion.button
      animate={{
        scale: [1, 1.04, 1, 1.03, 1],
        boxShadow: [
          '0 8px 24px rgba(0,115,112,0.35)',
          '0 10px 28px rgba(0,115,112,0.5)',
          '0 8px 24px rgba(0,115,112,0.35)',
          '0 10px 28px rgba(0,115,112,0.48)',
          '0 8px 24px rgba(0,115,112,0.35)'
        ]
      }}
      transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
      whileTap={{ scale: 0.9 }}
      whileHover={{ scale: 1.05 }}
      onClick={onClick}
      className="fixed bottom-[72px] left-1/2 -translate-x-1/2 w-14 h-14 bg-gradient-to-br from-emerald-400 to-emerald-500 rounded-full flex items-center justify-center border border-emerald-300/20 z-50"
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

const PROFILE_SETTINGS_STORAGE_KEY = 'nutria_profile_settings_v1';
const GOAL_OVERRIDE_STORAGE_KEY = 'nutria_goal_override_v1';

const DEFAULT_PROFILE_SETTINGS: UserProfileSettings = {
  sex: 'male',
  weightKg: 70,
  heightCm: 175,
  age: 30,
  activity: 'moderate',
  goal: 'maintain',
};

type GoalEditorGroup = 'macros' | 'vitamins' | 'minerals' | 'fatty' | 'carbs' | 'amino';

const ACTIVITY_FACTORS: Record<UserProfileSettings['activity'], number> = {
  low: 1.35,
  moderate: 1.55,
  high: 1.75,
  very_high: 1.95,
};

function calculateAutoGoalsFromProfile(profile: UserProfileSettings): NutrientGoalSet {
  const safeWeight = Math.max(35, profile.weightKg || 70);
  const safeHeight = Math.max(130, profile.heightCm || 170);
  const safeAge = Math.max(14, profile.age || 30);
  const isMale = profile.sex === 'male';

  const bmr = isMale
    ? 10 * safeWeight + 6.25 * safeHeight - 5 * safeAge + 5
    : 10 * safeWeight + 6.25 * safeHeight - 5 * safeAge - 161;

  const tdee = bmr * ACTIVITY_FACTORS[profile.activity];
  const goalMultiplier =
    profile.goal === 'lose' ? 0.85 :
    profile.goal === 'gain' ? 1.1 :
    profile.goal === 'recomposition' ? 0.95 : 1;
  const calories = Math.max(1200, Math.round(tdee * goalMultiplier));

  const proteinPerKg =
    profile.goal === 'lose' ? 1.9 :
    profile.goal === 'gain' ? 1.8 :
    profile.goal === 'recomposition' ? 2.0 : 1.4;

  const protein = Math.round(safeWeight * proteinPerKg);
  const fat = Math.round((calories * 0.3) / 9);
  const carbs = Math.max(50, Math.round((calories - protein * 4 - fat * 9) / 4));
  const fiber = Math.max(22, Math.round((calories / 1000) * 14));

  const scale = calories / DEFAULT_GOALS.calories;

  const scaleMap = (map: Record<string, number>, customScale = scale) =>
    Object.fromEntries(
      Object.entries(map).map(([key, value]) => [key, Math.round(value * customScale * 100) / 100])
    ) as Record<string, number>;

  return {
    calories,
    protein,
    fat,
    carbs,
    fiber,
    vitamins: scaleMap(DEFAULT_GOALS.vitamins),
    minerals: scaleMap(DEFAULT_GOALS.minerals),
    aminoAcids: scaleMap(DEFAULT_GOALS.aminoAcids, safeWeight / 70),
    fattyAcids: scaleMap(DEFAULT_GOALS.fattyAcids),
    carbohydrateTypes: scaleMap(DEFAULT_GOALS.carbohydrateTypes),
  };
}

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

const DIARY_DATE_STRIP_DAY_LABELS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

// Точные токены прототипа NUTRIA MVP (см. /tmp/blob_78821664-..., /tmp/blob_5951edb1-...) —
// нужны как литералы инлайн-стилей, чтобы не зависеть от глобального .theme-light оверрайда
// zinc-классов, который покрывает только часть оттенков.
const PROTO = {
  bg: 'oklch(0.975 0.007 200)',
  coolZone: 'oklch(0.955 0.012 195)',
  topZone: 'oklch(0.885 0.030 193)',
  coolBlock: 'oklch(0.987 0.006 200)',
  softDivider: 'oklch(0.93 0.01 195)',
  borderLt: 'oklch(0.93 0.015 192)',
  text: 'oklch(0.20 0.025 230)',
  textMid: 'oklch(0.48 0.04 215)',
  textLt: 'oklch(0.62 0.035 210)',
  primary: 'oklch(0.50 0.09 192)',
  primaryLt: 'oklch(0.85 0.055 192)',
  primaryMid: 'oklch(0.65 0.075 192)',
  primaryDk: 'oklch(0.35 0.09 192)',
  terra: 'oklch(0.62 0.1 38)',
  goalAchieved: 'oklch(0.50 0.12 158)',
  btnNutrients: 'linear-gradient(180deg, oklch(0.905 0.028 193), oklch(0.872 0.032 193))',
  btnAddMore: 'oklch(0.928 0.022 193)',
  tactileSoft: '0 1px 2px oklch(0.4 0.04 200 / 0.12), 0 2px 6px oklch(0.4 0.04 200 / 0.10)',
  tactileRaise: '0 1px 1px oklch(1 0 0 / 0.5) inset, 0 1px 2px oklch(0.4 0.04 195 / 0.10)',
  proteinColor: 'oklch(0.58 0.10 192)',
  fatColor: 'oklch(0.70 0.12 65)',
  carbColor: 'oklch(0.62 0.13 25)',
  waterBlue: '#3b82f6',
  waterBlueLt: '#93c5fd',
};

// 7-дневная полоса дней над дневником, как DateStrip в прототипе — окно из последних 7 дней,
// заканчивающееся сегодня, с переключением выбранной даты дневника.
const DiaryDateStrip = ({ selectedDate, onSelect }: { selectedDate: string; onSelect: (dateKey: string) => void }) => {
  const days = useMemo(() => {
    const today = new Date();
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today);
      d.setDate(today.getDate() - (6 - i));
      return { key: toDateKey(d), label: DIARY_DATE_STRIP_DAY_LABELS[d.getDay()], num: d.getDate() };
    });
  }, []);

  return (
    <div className="flex gap-1" style={{ padding: '2px 0 10px' }}>
      {days.map((d) => {
        const isActive = d.key === selectedDate;
        return (
          <button
            key={d.key}
            onClick={() => onSelect(d.key)}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 active:scale-95 transition-transform"
            style={{
              height: 56,
              borderRadius: 14,
              background: isActive ? `linear-gradient(180deg, ${PROTO.primaryMid}, ${PROTO.primary})` : 'transparent',
              boxShadow: isActive ? PROTO.tactileSoft : 'none',
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                color: isActive ? 'rgba(255,255,255,0.8)' : PROTO.textLt,
              }}
            >
              {d.label}
            </span>
            <span
              className="font-display"
              style={{
                fontSize: 21,
                fontWeight: isActive ? 600 : 400,
                lineHeight: 1,
                color: isActive ? '#fff' : PROTO.text,
              }}
            >
              {d.num}
            </span>
          </button>
        );
      })}
    </div>
  );
};

const NutritionScreen = ({ data, selectedDate, onChangeDate, onAddClick, hints, onHintClick, onDeleteItem, onEditItem, onUpdateWater }: { data: any, selectedDate: string, onChangeDate: (dateKey: string) => void, onAddClick: (type: string) => void, hints: Hint[], onHintClick: (cta: string) => void, onDeleteItem: (id: string) => void, onEditItem: (item: any) => void, onUpdateWater: (amount: number) => void }) => {
  const { meals = [], waterIntake = 0 } = data;
  const goals = mergeGoals(data.goals);
  const waterGoal = 2500; // 2.5L in ml
  const headerDateText = useMemo(() => {
    const rawDate = String(data?.date || '').trim();
    const parsed = rawDate ? new Date(`${rawDate}T12:00:00`) : new Date();
    const safeDate = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
    const isToday = toDateKey(safeDate) === toDateKey(new Date());
    const dayMonth = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(safeDate);
    if (isToday) return `Сегодня, ${dayMonth}`;
    const weekday = new Intl.DateTimeFormat('ru-RU', { weekday: 'long' }).format(safeDate);
    return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${dayMonth}`;
  }, [data?.date]);

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
  const mealIconSrc: any = { BREAKFAST: '/meal-icons/breakfast.png', LUNCH: '/meal-icons/lunch.png', DINNER: '/meal-icons/dinner.jpg', SNACK: '/meal-icons/snack.jpg' };

  const [allNutrientsOpen, setAllNutrientsOpen] = useState(false);
  const [mealExpanded, setMealExpanded] = useState<Record<string, boolean>>({
    BREAKFAST: false, LUNCH: false, DINNER: false, SNACK: false,
  });
  const toggleMeal = (type: string) => setMealExpanded((m) => ({ ...m, [type]: !m[type] }));
  const dateInputRef = useRef<HTMLInputElement>(null);

  const eaten = Math.round(totals.calories);
  const calorieGoal = Math.max(1, Math.round(goals.calories));
  const remaining = Math.max(0, calorieGoal - eaten);
  const over = Math.max(0, eaten - calorieGoal);
  const ringPct = Math.min(1, eaten / calorieGoal);
  const r = 64, circ = 2 * Math.PI * r;
  const arcLen = circ * 0.75;
  const fillLen = arcLen * ringPct;
  let ringLabel = 'Можно ещё';
  let ringValue = `${remaining} ккал`;
  const goalJustAchieved = remaining === 0 && eaten > 0 && over === 0;
  if (over > 0) { ringLabel = 'Выше цели на'; ringValue = `${over} ккал`; }
  else if (goalJustAchieved) { ringLabel = 'Дневная цель'; ringValue = 'достигнута'; }

  const totalGlasses = Math.ceil(waterGoal / 250);
  const filledGlasses = Math.round(waterIntake / 250);

  return (
    <div className="pb-24">
      {/* Верхняя зона — дата + переключатель дня, как в прототипе (TOP_ZONE) */}
      <div style={{ background: PROTO.topZone }} className="px-4 pt-4">
        <div className="flex items-center justify-between pb-1">
          <div className="flex items-center gap-1">
            <span style={{ fontSize: 15, fontWeight: 600, color: PROTO.text }}>{headerDateText}</span>
            <ChevronDown size={16} style={{ color: PROTO.textMid }} />
          </div>
          <button
            onClick={() => {
              const el = dateInputRef.current as any;
              if (el?.showPicker) el.showPicker();
              else el?.click();
            }}
            className="w-9 h-9 rounded-full flex items-center justify-center active:scale-95 transition-transform flex-shrink-0"
            style={{ background: PROTO.coolBlock, color: PROTO.primaryDk, boxShadow: PROTO.tactileSoft }}
          >
            <Calendar size={16} />
          </button>
          <input
            ref={dateInputRef}
            type="date"
            value={selectedDate}
            onChange={(e) => e.target.value && onChangeDate(e.target.value)}
            className="sr-only"
          />
        </div>
        <DiaryDateStrip selectedDate={selectedDate} onSelect={onChangeDate} />
      </div>

      <div className="px-4 pt-4">
        {/* Калории — единое кольцо + БЖУ, как в прототипе */}
        <div style={{ background: PROTO.coolBlock, borderRadius: 20, padding: '18px 14px 12px' }} className="mb-4">
          <div className="relative flex items-center justify-center mb-1">
            <svg width="170" height="170" viewBox="0 0 170 170">
              <circle cx="85" cy="85" r={r} fill="none" stroke={PROTO.borderLt} strokeWidth="11"
                strokeDasharray={`${arcLen} ${circ - arcLen}`} strokeLinecap="round"
                transform="rotate(135 85 85)" />
              <circle cx="85" cy="85" r={r} fill="none" stroke={over > 0 ? PROTO.terra : PROTO.primary} strokeWidth="11"
                strokeDasharray={`${fillLen} ${circ - fillLen}`} strokeLinecap="round"
                transform="rotate(135 85 85)" className="transition-all duration-500" />
            </svg>
            <div className="absolute flex flex-col items-center text-center">
              <span style={{ fontSize: 11, color: PROTO.textLt }}>{ringLabel}</span>
              <span className="font-display" style={{ fontSize: 30, fontWeight: 600, lineHeight: 1.2, color: over > 0 ? PROTO.terra : goalJustAchieved ? PROTO.goalAchieved : PROTO.text }}>{ringValue}</span>
              <span style={{ fontSize: 11, color: PROTO.textLt, marginTop: 2 }}>Цель: {calorieGoal} ккал</span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 pt-2">
            {[
              ['Белки', totals.protein, goals.protein, PROTO.proteinColor],
              ['Жиры', totals.fat, goals.fat, PROTO.fatColor],
              ['Углеводы', totals.carbs, goals.carbs, PROTO.carbColor],
            ].map(([label, value, goal, color]: any) => (
              <div key={label}>
                <div className="flex justify-between items-baseline mb-1">
                  <span style={{ fontSize: 11, color: PROTO.textLt }}>{label}</span>
                  <span style={{ fontSize: 11, color: PROTO.textMid }}>{Math.round(value)}/{Math.round(goal)} г</span>
                </div>
                <div style={{ height: 5, borderRadius: 9999, background: PROTO.softDivider, overflow: 'hidden' }}>
                  <div className="h-full transition-all duration-500" style={{ borderRadius: 9999, width: `${Math.min(100, (value / goal) * 100)}%`, background: color }} />
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={() => setAllNutrientsOpen((v) => !v)}
            className="w-full mt-4 text-xs font-bold flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
            style={{ height: 32, borderRadius: 9999, background: PROTO.btnNutrients, color: PROTO.primaryDk }}
          >
            Все нутриенты
            <ArrowRight size={14} />
          </button>
        </div>

        {allNutrientsOpen && (
        <>
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
        </>
      )}

      {/* Дневник — приёмы пищи, как MealBlock в прототипе */}
      <div className="space-y-3 mb-4">
        {mealTypes.map((type) => {
          const meal = meals.find((m: any) => m.type === type);
          const items = meal?.items || [];
          const isEmpty = items.length === 0;
          const expanded = !!mealExpanded[type];
          const mealTotal = items.reduce((s: number, item: any) => s + (item.product.calories * item.amount) / 100, 0);
          const totalP = items.reduce((s: number, item: any) => s + (item.product.protein * item.amount) / 100, 0);
          const totalF = items.reduce((s: number, item: any) => s + (item.product.fat * item.amount) / 100, 0);
          const totalC = items.reduce((s: number, item: any) => s + (item.product.carbs * item.amount) / 100, 0);

          return (
            <div key={type} style={{ background: PROTO.coolZone, borderRadius: 18 }} className="overflow-hidden">
              <div
                onClick={() => toggleMeal(type)}
                className="flex items-center gap-3 p-4 cursor-pointer active:opacity-80 transition-opacity"
              >
                <div
                  className="flex items-center justify-center flex-shrink-0 overflow-hidden"
                  style={{ width: 58, height: 58, borderRadius: 14, background: PROTO.coolBlock }}
                >
                  <img src={mealIconSrc[type]} alt={mealLabels[type]} className="w-full h-full object-cover" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span style={{ fontSize: 16, fontWeight: 700, color: PROTO.text }}>{mealLabels[type]}</span>
                    {!isEmpty && <span style={{ fontSize: 13, fontWeight: 700, color: PROTO.primary }} className="flex-shrink-0">{Math.round(mealTotal)} ккал</span>}
                  </div>
                  {isEmpty ? (
                    <p style={{ fontSize: 12, color: PROTO.textMid, marginTop: 2 }}>Нажмите, чтобы добавить</p>
                  ) : (
                    <p style={{ fontSize: 12, color: PROTO.textMid, marginTop: 2 }} className="truncate">{items.map((i: any) => i.product.name).join(' · ')}</p>
                  )}
                </div>
                <ChevronRight
                  size={18}
                  className="flex-shrink-0 transition-transform"
                  style={{ color: PROTO.textLt, transform: expanded ? 'rotate(90deg)' : 'none' }}
                />
              </div>

              {expanded && (
                <div style={{ borderTop: `1px solid ${PROTO.softDivider}` }}>
                  {isEmpty ? (
                    <div className="p-4 text-center">
                      <p style={{ fontSize: 12, color: PROTO.textMid, marginBottom: 12 }}>В этом приёме пищи пока нет записей</p>
                      <button
                        onClick={() => onAddClick(type)}
                        className="w-full text-sm font-semibold active:scale-[0.98] transition-transform"
                        style={{ height: 52, borderRadius: 16, background: PROTO.primary, color: '#fff', boxShadow: PROTO.tactileRaise }}
                      >
                        + Добавить продукт
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="py-1">
                        {items.map((item: any, idx: number) => (
                          <div
                            key={item.id}
                            className="flex items-center gap-2 px-4 py-2.5 group"
                            style={idx > 0 ? { borderTop: `1px solid ${PROTO.softDivider}` } : undefined}
                          >
                            <div className="flex-1 min-w-0">
                              <p style={{ fontSize: 14, color: PROTO.text }}>{item.product.name}</p>
                              <p style={{ fontSize: 11, color: PROTO.textLt, marginTop: 2 }}>{item.amount} г · Б{Math.round((item.product.protein * item.amount) / 100)} · Ж{Math.round((item.product.fat * item.amount) / 100)} · У{Math.round((item.product.carbs * item.amount) / 100)}</p>
                            </div>
                            <span style={{ fontSize: 12, color: PROTO.textMid }} className="flex-shrink-0">{Math.round((item.product.calories * item.amount) / 100)} ккал</span>
                            <button onClick={() => onEditItem(item)} className="p-1.5 hover:text-emerald-500 transition-colors flex-shrink-0" style={{ color: PROTO.textLt }}>
                              <Pencil size={14} />
                            </button>
                            <button onClick={() => onDeleteItem(item.id)} className="p-1.5 hover:text-red-500 transition-colors flex-shrink-0" style={{ color: PROTO.textLt }}>
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-between px-4 py-2.5" style={{ borderTop: `1px solid ${PROTO.softDivider}` }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: PROTO.textMid }}>Итого</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: PROTO.text }}>{Math.round(mealTotal)} ккал · Б{Math.round(totalP)} / Ж{Math.round(totalF)} / У{Math.round(totalC)}</span>
                      </div>
                      <div className="flex justify-center px-4 py-3">
                        <button
                          onClick={() => onAddClick(type)}
                          className="px-4 text-xs font-bold active:scale-95 transition-transform"
                          style={{ height: 36, borderRadius: 9999, background: PROTO.btnAddMore, color: PROTO.primaryDk, boxShadow: PROTO.tactileRaise }}
                        >
                          + Добавить ещё
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Вода */}
      <div style={{ background: PROTO.coolZone, borderRadius: 18, padding: '12px 14px' }} className="mb-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: PROTO.text }}>Вода</h3>
            <p style={{ fontSize: 12, color: PROTO.textMid, marginTop: 2 }}>
              {waterIntake} / {waterGoal} мл
              {waterIntake < waterGoal && <span> · осталось {waterGoal - waterIntake} мл</span>}
              {waterIntake >= waterGoal && <span style={{ color: PROTO.primary }}> · цель достигнута</span>}
            </p>
          </div>
          <div
            className="flex items-center justify-center flex-shrink-0 overflow-hidden"
            style={{ width: 48, height: 48, borderRadius: 14, background: PROTO.coolBlock }}
          >
            <img src="/meal-icons/water.jpg" alt="Вода" className="w-full h-full object-cover" />
          </div>
        </div>
        <p style={{ fontSize: 10, color: PROTO.textLt, marginBottom: 8 }}>Нажимайте на капли, чтобы отметить выпитое</p>
        <div className="flex gap-2 flex-wrap">
          {Array.from({ length: totalGlasses }).map((_, i) => {
            const filled = i < filledGlasses;
            const handleClick = () => {
              const target = i + 1;
              const nextFilled = filledGlasses === target ? target - 1 : target;
              onUpdateWater(nextFilled * 250 - waterIntake);
            };
            return (
              <button
                key={i}
                onClick={handleClick}
                className="active:scale-90 transition-transform"
              >
                <svg width="22" height="30" viewBox="0 0 26 38" fill="none">
                  <path d="M5 6C5 6 3 14 3 22c0 6.627 4.477 12 10 12s10-5.373 10-12c0-8-2-16-2-16H5z"
                    stroke={filled ? PROTO.waterBlue : PROTO.borderLt} strokeWidth="1.6"
                    fill={filled ? PROTO.waterBlueLt : 'transparent'} fillOpacity={filled ? 0.5 : 1} />
                  <path d="M8 3h10" stroke={filled ? PROTO.waterBlue : PROTO.borderLt} strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            );
          })}
        </div>
      </div>

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
          ) : meals.some((m: any) => m.items.length > 0) ? (
            <div className="flex flex-col items-center py-4 text-zinc-500">
              <Loader2 className="animate-spin mb-2" size={20} />
              <p className="text-xs">Анализируем ваш рацион...</p>
            </div>
          ) : (
            <div className="flex flex-col items-center py-6 text-center text-zinc-500">
              <Target size={20} className="mb-2 opacity-60" />
              <p className="text-xs">Добавьте продукты в дневник — здесь появятся персональные рекомендации</p>
            </div>
          )}
        </div>
      </CollapsibleCard>
      </div>
    </div>
  );
};

function MessagesCard({ onMessagesRead }: { onMessagesRead?: () => void }) {
  const [isCollapsed, setIsCollapsed] = useState(() => localStorage.getItem('collapse_summary_messages') === 'true');
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      const res = await fetch('/api/messages');
      if (!res.ok) return;
      const data = await res.json();
      setMessages(data.messages || []);
      onMessagesRead?.();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isCollapsed) load();
  }, [isCollapsed]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  async function send() {
    const text = content.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text }),
      });
      if (res.ok) {
        setContent('');
        await load();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-4 bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
      <button
        onClick={() => {
          const next = !isCollapsed;
          setIsCollapsed(next);
          localStorage.setItem('collapse_summary_messages', String(next));
        }}
        className="w-full px-4 py-3 flex items-center justify-between active:bg-zinc-800/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-bold">Сообщения нутрициологу</h3>
          <MessageCircle size={16} className="text-zinc-500" />
        </div>
        {isCollapsed ? <ChevronDown size={20} className="text-zinc-500" /> : <ChevronUp size={20} className="text-zinc-500" />}
      </button>

      <AnimatePresence initial={false}>
        {!isCollapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
          >
            <div className="px-4 pb-4 border-t border-zinc-800/60 pt-4">
              {loading ? (
                <div className="flex items-center justify-center py-6 text-zinc-500">
                  <Loader2 className="animate-spin" size={18} />
                </div>
              ) : messages.length === 0 ? (
                <p className="text-sm text-zinc-500 text-center py-4">Пока нет сообщений</p>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {messages.map((m) => (
                    <div key={m.id} className={`flex ${m.sender === 'CLIENT' ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                          m.sender === 'CLIENT'
                            ? 'bg-emerald-500 text-white'
                            : 'bg-zinc-800 text-zinc-100'
                        }`}
                      >
                        {m.sender !== 'CLIENT' && m.nutritionistName && (
                          <p className="text-[10px] uppercase tracking-widest opacity-60 mb-0.5">{m.nutritionistName}</p>
                        )}
                        <p className="whitespace-pre-wrap break-words">{m.content}</p>
                      </div>
                    </div>
                  ))}
                  <div ref={bottomRef} />
                </div>
              )}

              <div className="mt-3 flex items-end gap-2">
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  placeholder="Написать сообщение..."
                  rows={1}
                  className="flex-1 resize-none bg-zinc-800/50 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
                />
                <button
                  onClick={send}
                  disabled={sending || !content.trim()}
                  className="p-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white transition-colors"
                >
                  {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const SummaryScreen = ({
  view,
  goals,
  profile,
  weeklyHistory,
  themeMode,
  fastingMode,
  customFastingHours,
  isFastingActive,
  fastingEndAt,
  nowTs,
  onSetMode,
  onSetCustomHours,
  onStart,
  onStop,
  onSaveProfileGoals,
  onToggleTheme,
  onMessagesRead,
}: {
  view: 'stats' | 'profile';
  goals: NutrientGoalSet;
  profile: UserProfileSettings;
  weeklyHistory: DiaryHistoryPoint[];
  themeMode: ThemeMode;
  fastingMode: FastingMode;
  customFastingHours: number;
  isFastingActive: boolean;
  fastingEndAt: number | null;
  nowTs: number;
  onSetMode: (mode: FastingMode) => void;
  onSetCustomHours: (hours: number) => void;
  onStart: () => void;
  onStop: () => void;
  onSaveProfileGoals: (profile: UserProfileSettings, goals: NutrientGoalSet) => Promise<void>;
  onToggleTheme: () => void;
  onMessagesRead?: () => void;
}) => {
  const fastingHours = fastingMode === 'CUSTOM' ? customFastingHours : FASTING_PRESETS[fastingMode].fastingHours;
  const eatingHours = Math.max(0, 24 - fastingHours);
  const remainingMs = isFastingActive && fastingEndAt ? Math.max(0, fastingEndAt - nowTs) : 0;
  const [selectedProgram, setSelectedProgram] = useState<NutritionProgram | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsProfile, setSettingsProfile] = useState<UserProfileSettings>(profile);
  const [settingsGoals, setSettingsGoals] = useState<NutrientGoalSet>(goals);
  const [goalEditorGroup, setGoalEditorGroup] = useState<GoalEditorGroup>('macros');
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [selectedHistoryDate, setSelectedHistoryDate] = useState('');
  const [isFastingCollapsed, setIsFastingCollapsed] = useState(() => localStorage.getItem('collapse_summary_fasting') === 'true');
  const [isRecommendationsCollapsed, setIsRecommendationsCollapsed] = useState(() => localStorage.getItem('collapse_summary_recommendations') === 'true');
  const [isProgramsCollapsed, setIsProgramsCollapsed] = useState(() => {
    const raw = localStorage.getItem('collapse_summary_programs');
    return raw === null ? true : raw === 'true';
  });
  const [isSettingsCollapsed, setIsSettingsCollapsed] = useState(() => localStorage.getItem('collapse_summary_settings') === 'true');

  const dayLabel = (dateKey: string) => {
    const date = new Date(`${dateKey}T12:00:00`);
    return new Intl.DateTimeFormat('ru-RU', { weekday: 'short' }).format(date).replace('.', '');
  };

  const dayNumber = (dateKey: string) => {
    const date = new Date(`${dateKey}T12:00:00`);
    return date.getDate();
  };

  const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));

  const computeDayMetrics = (point: DiaryHistoryPoint) => {
    const caloriesRatio = clamp(point.totals.calories / Math.max(1, goals.calories));
    const proteinRatio = clamp(point.totals.protein / Math.max(1, goals.protein));
    const fatRatio = clamp(point.totals.fat / Math.max(1, goals.fat));
    const carbsRatio = clamp(point.totals.carbs / Math.max(1, goals.carbs));
    const fiberRatio = clamp(point.totals.fiber / Math.max(1, goals.fiber || 30));
    const waterRatio = clamp(point.waterIntake / 2000);

    const macroBalance = (proteinRatio + fatRatio + carbsRatio) / 3;
    const calorieAccuracy = clamp(1 - Math.abs(1 - caloriesRatio));
    const recovery = (fiberRatio + waterRatio) / 2;
    const score = Math.round(((macroBalance * 0.45) + (calorieAccuracy * 0.35) + (recovery * 0.2)) * 100);

    return {
      caloriesRatio,
      macroBalance,
      recovery,
      waterRatio,
      fiberRatio,
      score,
    };
  };

  const historyWithMetrics = useMemo(
    () => weeklyHistory.map((point) => ({ point, metrics: computeDayMetrics(point) })),
    [weeklyHistory, goals]
  );

  const selectedHistory = useMemo(() => {
    if (historyWithMetrics.length === 0) return null;
    return historyWithMetrics.find((item) => item.point.date === selectedHistoryDate) || historyWithMetrics[historyWithMetrics.length - 1];
  }, [historyWithMetrics, selectedHistoryDate]);

  const selectedProgramTargets = useMemo(() => {
    if (!selectedProgram) return null;
    return deriveProgramGoals(
      selectedProgram,
      Math.max(1200, Math.round(goals.calories || 2100)),
      Math.max(35, Math.round(profile.weightKg || 70)),
      goals.fiber || 30
    );
  }, [selectedProgram, goals, profile.weightKg]);

  const weeklyRecommendations = useMemo(() => {
    const points = historyWithMetrics.slice(-7).map(({ point, metrics }) => ({ point, metrics }));
    const daysCount = points.length;

    const sum = points.reduce(
      (acc, item) => {
        acc.calories += item.point.totals.calories;
        acc.protein += item.point.totals.protein;
        acc.fat += item.point.totals.fat;
        acc.carbs += item.point.totals.carbs;
        acc.fiber += item.point.totals.fiber;
        acc.water += item.point.waterIntake;
        acc.score += item.metrics.score;
        if (item.point.mealsCount > 0) acc.activeDays += 1;
        if (item.point.totals.protein < goals.protein * 0.8) acc.proteinLowDays += 1;
        if (item.point.totals.carbs > goals.carbs * 1.1) acc.highCarbDays += 1;
        if (item.point.totals.fiber < (goals.fiber || 30) * 0.75) acc.lowFiberDays += 1;
        if (item.point.waterIntake < 1800) acc.lowWaterDays += 1;
        return acc;
      },
      {
        calories: 0,
        protein: 0,
        fat: 0,
        carbs: 0,
        fiber: 0,
        water: 0,
        score: 0,
        activeDays: 0,
        proteinLowDays: 0,
        highCarbDays: 0,
        lowFiberDays: 0,
        lowWaterDays: 0,
      }
    );

    const safeDiv = (value: number) => (daysCount > 0 ? value / daysCount : 0);
    const avgCalories = safeDiv(sum.calories);
    const avgProtein = safeDiv(sum.protein);
    const avgCarbs = safeDiv(sum.carbs);
    const avgFiber = safeDiv(sum.fiber);
    const avgWater = safeDiv(sum.water);
    const avgScore = safeDiv(sum.score);

    const macrosText =
      daysCount === 0
        ? 'Недостаточно данных за неделю. Добавляйте приемы пищи ежедневно для точных выводов.'
        : sum.proteinLowDays >= 3
          ? `За 7 дней белок ниже цели в ${sum.proteinLowDays} дн. Среднее: ${Math.round(avgProtein)} г при цели ${Math.round(goals.protein)} г. Добавьте 1-2 белковых приема в день.`
          : Math.abs(avgCalories - goals.calories) / Math.max(1, goals.calories) > 0.15
            ? `Средние калории: ${Math.round(avgCalories)} ккал при цели ${Math.round(goals.calories)}. Стабилизируйте порции и распределение приемов пищи.`
            : `Баланс макроэлементов за неделю близок к цели: в среднем ${Math.round(avgProtein)}Б / ${Math.round(safeDiv(sum.fat))}Ж / ${Math.round(avgCarbs)}У.`;

    const vitaminsText =
      daysCount === 0
        ? 'Нет недельных данных для оценки пищевой плотности.'
        : sum.lowFiberDays >= 3
          ? `Клетчатка ниже нормы в ${sum.lowFiberDays} дн. Это повышает риск дефицитов по C, A, фолатам и магнию. Добавьте овощи, бобовые, ягоды и зелень.`
          : `Пищевая плотность рациона на неделе стабильна. Поддерживайте разнообразие: овощи разных цветов, цельные продукты, источники магния и железа.`;

    const glycemicText =
      daysCount === 0
        ? 'Пока нет данных для оценки углеводной нагрузки.'
        : sum.highCarbDays >= 3 && sum.lowFiberDays >= 3
          ? `Отмечены высокие углеводы в ${sum.highCarbDays} дн и низкая клетчатка в ${sum.lowFiberDays} дн. Снизьте долю быстрых сахаров и добавьте цельные источники углеводов.`
          : `Углеводный профиль недели ${avgCarbs <= goals.carbs * 1.05 ? 'контролируемый' : 'повышенный'}. Ориентир: больше цельных круп и овощей, меньше сладких перекусов.`;

    const aiText =
      daysCount === 0
        ? 'Сформируйте минимум 3-4 дня заполненного дневника, и AI даст персональные рекомендации по трендам.'
        : `Анализ 7 дней: средний рейтинг ${Math.round(avgScore)}%, вода ${Math.round(avgWater)} мл/день, активных дней ${sum.activeDays}/${daysCount}. Следующий фокус: ${sum.lowWaterDays >= 3 ? 'гидратация' : sum.lowFiberDays >= 3 ? 'клетчатка и микронутриенты' : 'удержание текущего режима'}.`;

    return {
      periodLabel:
        daysCount > 0
          ? `${new Date(`${points[0].point.date}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} - ${new Date(`${points[daysCount - 1].point.date}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}`
          : 'нет данных',
      cards: [
        { title: 'Макроэлементы', text: macrosText },
        { title: 'Витамины и минералы', text: vitaminsText },
        { title: 'Гликемическая нагрузка', text: glycemicText },
        { title: 'Анализ AI', text: aiText },
      ],
    };
  }, [historyWithMetrics, goals]);

  useEffect(() => {
    setSettingsProfile(profile);
  }, [profile]);

  useEffect(() => {
    setSettingsGoals(goals);
  }, [goals]);

  useEffect(() => {
    if (historyWithMetrics.length > 0 && !selectedHistoryDate) {
      setSelectedHistoryDate(historyWithMetrics[historyWithMetrics.length - 1].point.date);
    }
  }, [historyWithMetrics, selectedHistoryDate]);

  const openProgram = (program: NutritionProgram) => {
    setSelectedProgram(program);
  };

  const activityLabelMap: Record<UserProfileSettings['activity'], string> = {
    low: 'низкая',
    moderate: 'умеренная',
    high: 'высокая',
    very_high: 'очень высокая',
  };

  const goalLabelMap: Record<UserProfileSettings['goal'], string> = {
    lose: 'снижение веса',
    maintain: 'поддержание',
    gain: 'набор массы',
    recomposition: 'рекомпозиция',
  };

  const openSettings = () => {
    setSettingsProfile(profile);
    setSettingsGoals(goals);
    setGoalEditorGroup('macros');
    setIsSettingsOpen(true);
  };

  const recalculateGoalsByProfile = () => {
    const auto = calculateAutoGoalsFromProfile(settingsProfile);
    setSettingsGoals(auto);
  };

  const updateMacroField = (key: 'calories' | 'protein' | 'fat' | 'carbs' | 'fiber', value: number) => {
    setSettingsGoals((prev) => ({ ...prev, [key]: Number.isFinite(value) ? value : 0 }));
  };

  const updateNestedField = (
    group: 'vitamins' | 'minerals' | 'fattyAcids' | 'carbohydrateTypes' | 'aminoAcids',
    key: string,
    value: number
  ) => {
    setSettingsGoals((prev) => ({
      ...prev,
      [group]: {
        ...prev[group],
        [key]: Number.isFinite(value) ? value : 0,
      }
    }));
  };

  const saveSettings = async () => {
    setIsSavingSettings(true);
    try {
      await onSaveProfileGoals(settingsProfile, settingsGoals);
      setIsSettingsOpen(false);
      alert('Профиль и нормы успешно обновлены.');
    } catch (e) {
      console.error(e);
      alert('Не удалось сохранить настройки.');
    } finally {
      setIsSavingSettings(false);
    }
  };

  return (
    <div className="p-4">
      <header className="mb-6 pt-4">
        <h1 className="font-display text-4xl font-bold tracking-tight">{view === 'stats' ? 'Статистика' : 'Профиль'}</h1>
        <p className="text-zinc-500 text-sm">{view === 'stats' ? 'Динамика, рейтинг и рекомендации' : 'Цели, программы и настройки'}</p>
      </header>

      {view === 'stats' && (
      <>
      <div className="mb-4 bg-zinc-900 border border-zinc-800 rounded-2xl p-3">
        <div className="flex items-center justify-between mb-3 px-1">
          <p className="text-sm font-semibold text-zinc-200">Пульс питания за 7 дней</p>
          <p className="text-[10px] uppercase tracking-widest text-zinc-500">Хронология</p>
        </div>

        <div className="flex items-center justify-between gap-1">
          {historyWithMetrics.map(({ point, metrics }) => {
            const isActive = selectedHistory?.point.date === point.date;
            const ringColor = metrics.score >= 80 ? '#22c55e' : metrics.score >= 60 ? '#f59e0b' : '#f43f5e';
            const progress = Math.round((metrics.score / 100) * 360);
            return (
              <button
                key={point.date}
                onClick={() => setSelectedHistoryDate(point.date)}
                className={cn(
                  'flex-1 min-w-0 rounded-xl p-1.5 transition-colors border',
                  isActive ? 'bg-zinc-800 border-zinc-600' : 'bg-zinc-900/70 border-zinc-800'
                )}
              >
                <div className="mx-auto w-9 h-9 rounded-full p-[3px]" style={{ background: `conic-gradient(${ringColor} ${progress}deg, #27272a ${progress}deg 360deg)` }}>
                  <div className="w-full h-full rounded-full bg-zinc-950 flex items-center justify-center">
                    <span className="text-[10px] font-bold text-zinc-100">{dayNumber(point.date)}</span>
                  </div>
                </div>
                <p className="text-[10px] mt-1 text-zinc-300 uppercase">{dayLabel(point.date)}</p>
              </button>
            );
          })}
        </div>

        {selectedHistory && (
          <div className="mt-3 bg-zinc-950/70 border border-zinc-800 rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-zinc-400">{new Date(`${selectedHistory.point.date}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</p>
              <p className="text-sm font-semibold text-zinc-100">Рейтинг: {selectedHistory.metrics.score}%</p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-[11px]">
              <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-2">
                <p className="text-zinc-500 uppercase">Ккал</p>
                <p className="text-zinc-100 font-semibold">{Math.round(selectedHistory.point.totals.calories)}</p>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-2">
                <p className="text-zinc-500 uppercase">БЖУ</p>
                <p className="text-zinc-100 font-semibold">{Math.round(selectedHistory.metrics.macroBalance * 100)}%</p>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-2">
                <p className="text-zinc-500 uppercase">Вода</p>
                <p className="text-zinc-100 font-semibold">{Math.round(selectedHistory.point.waterIntake)} мл</p>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
        <button
          onClick={() => {
            const next = !isRecommendationsCollapsed;
            setIsRecommendationsCollapsed(next);
            localStorage.setItem('collapse_summary_recommendations', String(next));
          }}
          className="w-full px-4 py-3 flex items-center justify-between active:bg-zinc-800/50 transition-colors"
        >
          <h3 className="text-lg font-bold">Рекомендации</h3>
          {isRecommendationsCollapsed ? <ChevronDown size={20} className="text-zinc-500" /> : <ChevronUp size={20} className="text-zinc-500" />}
        </button>

        <AnimatePresence initial={false}>
          {!isRecommendationsCollapsed && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: 'easeInOut' }}
            >
              <div className="space-y-3 px-4 pb-4 border-t border-zinc-800/60 pt-4">
                <div className="px-1 pb-1">
                  <p className="text-[10px] uppercase tracking-widest text-zinc-500">Период анализа: {weeklyRecommendations.periodLabel}</p>
                </div>
                {weeklyRecommendations.cards.map((card) => (
                  <div key={card.title} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
                    <p className="text-xs uppercase tracking-widest text-zinc-500 mb-2">{card.title}</p>
                    <p className="text-sm text-zinc-300">{card.text}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      </>
      )}

      {view === 'profile' && (
      <>
      <MessagesCard onMessagesRead={onMessagesRead} />

      <div className="mt-4 bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
        <button
          onClick={() => {
            const next = !isProgramsCollapsed;
            setIsProgramsCollapsed(next);
            localStorage.setItem('collapse_summary_programs', String(next));
          }}
          className="w-full px-4 py-3 flex items-center justify-between active:bg-zinc-800/50 transition-colors"
        >
          <h3 className="text-lg font-bold">Программы питания</h3>
          {isProgramsCollapsed ? <ChevronDown size={20} className="text-zinc-500" /> : <ChevronUp size={20} className="text-zinc-500" />}
        </button>

        <AnimatePresence initial={false}>
          {!isProgramsCollapsed && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: 'easeInOut' }}
            >
              <div className="space-y-2 px-4 pb-4 border-t border-zinc-800/60 pt-4">
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
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="mt-4 bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
        <button
          onClick={() => {
            const next = !isSettingsCollapsed;
            setIsSettingsCollapsed(next);
            localStorage.setItem('collapse_summary_settings', String(next));
          }}
          className="w-full px-4 py-3 flex items-center justify-between active:bg-zinc-800/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-bold">Настройки</h3>
            <SlidersHorizontal size={16} className="text-zinc-500" />
          </div>
          {isSettingsCollapsed ? <ChevronDown size={20} className="text-zinc-500" /> : <ChevronUp size={20} className="text-zinc-500" />}
        </button>

        <AnimatePresence initial={false}>
          {!isSettingsCollapsed && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: 'easeInOut' }}
            >
              <div className="p-4 border-t border-zinc-800/60">
                <div className="bg-zinc-800/50 border border-zinc-700 rounded-xl p-4">
                  <p className="text-base font-semibold text-zinc-100 mb-3">Профиль и цели</p>
                  <div className="mb-3 p-3 bg-zinc-900/60 border border-zinc-700 rounded-lg flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-widest text-zinc-500 mb-1">Тема интерфейса</p>
                      <p className="text-sm text-zinc-300">{themeMode === 'light' ? 'Светлая' : 'Темная'}</p>
                    </div>
                    <button
                      onClick={onToggleTheme}
                      className="px-3 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-100 text-sm flex items-center gap-2"
                    >
                      {themeMode === 'light' ? <Moon size={14} /> : <Sun size={14} />}
                      {themeMode === 'light' ? 'Темная' : 'Светлая'}
                    </button>
                  </div>

                  <div className="space-y-1 text-sm text-zinc-300">
                    <p>Пол: {profile.sex === 'male' ? 'мужской' : 'женский'}</p>
                    <p>Вес: {Math.round(profile.weightKg)} кг</p>
                    <p>Рост: {Math.round(profile.heightCm)} см</p>
                    <p>Возраст: {Math.round(profile.age)}</p>
                    <p>Активность: {activityLabelMap[profile.activity]}</p>
                    <p>Цель: {goalLabelMap[profile.goal]}</p>
                  </div>

                  <div className="mt-4 p-3 bg-zinc-900/60 border border-zinc-700 rounded-lg">
                    <p className="text-sm font-semibold text-zinc-200 mb-1">Текущие нормы</p>
                    <p className="text-sm text-zinc-300">Калории: {Math.round(goals.calories).toLocaleString('ru-RU')} ккал</p>
                    <p className="text-sm text-zinc-300">Белки: {Math.round(goals.protein)} г</p>
                    <p className="text-sm text-zinc-300">Жиры: {Math.round(goals.fat)} г</p>
                    <p className="text-sm text-zinc-300">Углеводы: {Math.round(goals.carbs)} г</p>
                  </div>

                  <button
                    onClick={openSettings}
                    className="mt-4 px-4 py-2 rounded-xl bg-zinc-700 hover:bg-zinc-600 text-zinc-100 text-sm font-medium transition-colors"
                  >
                    Изменить (MVP)
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="mt-4 bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
        <button
          onClick={() => {
            const next = !isFastingCollapsed;
            setIsFastingCollapsed(next);
            localStorage.setItem('collapse_summary_fasting', String(next));
          }}
          className="w-full px-4 py-3 flex items-center justify-between active:bg-zinc-800/50 transition-colors"
        >
          <h3 className="text-lg font-bold">Голодание</h3>
          {isFastingCollapsed ? <ChevronDown size={20} className="text-zinc-500" /> : <ChevronUp size={20} className="text-zinc-500" />}
        </button>

        <AnimatePresence initial={false}>
          {!isFastingCollapsed && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: 'easeInOut' }}
            >
              <div className="px-4 pb-4 border-t border-zinc-800/60 pt-4">
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
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      </>
      )}

      <BottomSheet isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} title="Профиль и цели">
        <div className="space-y-4">
          <div className="bg-zinc-800/50 border border-zinc-700 rounded-xl p-4">
            <p className="text-sm font-semibold text-zinc-200 mb-3">Профиль</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-zinc-400">
                Пол
                <select
                  value={settingsProfile.sex}
                  onChange={(e) => setSettingsProfile((prev) => ({ ...prev, sex: e.target.value as UserProfileSettings['sex'] }))}
                  className="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded-lg py-2 px-3 text-zinc-100"
                >
                  <option value="male">Мужской</option>
                  <option value="female">Женский</option>
                </select>
              </label>

              <label className="text-xs text-zinc-400">
                Вес (кг)
                <input
                  type="number"
                  min={35}
                  max={250}
                  value={settingsProfile.weightKg}
                  onChange={(e) => setSettingsProfile((prev) => ({ ...prev, weightKg: Number(e.target.value) }))}
                  className="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded-lg py-2 px-3 text-zinc-100"
                />
              </label>

              <label className="text-xs text-zinc-400">
                Рост (см)
                <input
                  type="number"
                  min={130}
                  max={230}
                  value={settingsProfile.heightCm}
                  onChange={(e) => setSettingsProfile((prev) => ({ ...prev, heightCm: Number(e.target.value) }))}
                  className="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded-lg py-2 px-3 text-zinc-100"
                />
              </label>

              <label className="text-xs text-zinc-400">
                Возраст
                <input
                  type="number"
                  min={14}
                  max={100}
                  value={settingsProfile.age}
                  onChange={(e) => setSettingsProfile((prev) => ({ ...prev, age: Number(e.target.value) }))}
                  className="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded-lg py-2 px-3 text-zinc-100"
                />
              </label>

              <label className="text-xs text-zinc-400">
                Активность
                <select
                  value={settingsProfile.activity}
                  onChange={(e) => setSettingsProfile((prev) => ({ ...prev, activity: e.target.value as UserProfileSettings['activity'] }))}
                  className="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded-lg py-2 px-3 text-zinc-100"
                >
                  <option value="low">Низкая</option>
                  <option value="moderate">Умеренная</option>
                  <option value="high">Высокая</option>
                  <option value="very_high">Очень высокая</option>
                </select>
              </label>

              <label className="text-xs text-zinc-400">
                Цель
                <select
                  value={settingsProfile.goal}
                  onChange={(e) => setSettingsProfile((prev) => ({ ...prev, goal: e.target.value as UserProfileSettings['goal'] }))}
                  className="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded-lg py-2 px-3 text-zinc-100"
                >
                  <option value="lose">Снижение веса</option>
                  <option value="maintain">Поддержание</option>
                  <option value="gain">Набор массы</option>
                  <option value="recomposition">Рекомпозиция</option>
                </select>
              </label>
            </div>
            <button
              onClick={recalculateGoalsByProfile}
              className="mt-3 px-4 py-2 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-sm"
            >
              Пересчитать нормы автоматически
            </button>
          </div>

          <div className="bg-zinc-800/50 border border-zinc-700 rounded-xl p-4">
            <p className="text-sm font-semibold text-zinc-200 mb-3">Корректировка норм</p>

            <div className="grid grid-cols-3 gap-2 mb-3">
              {([
                { id: 'macros', label: 'Макро' },
                { id: 'vitamins', label: 'Витамины' },
                { id: 'minerals', label: 'Минералы' },
                { id: 'fatty', label: 'Жиры' },
                { id: 'carbs', label: 'Углеводы' },
                { id: 'amino', label: 'Аминокисл.' },
              ] as const satisfies Array<{ id: GoalEditorGroup; label: string }>).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setGoalEditorGroup(tab.id)}
                  className={cn(
                    'py-2 rounded-lg text-xs',
                    goalEditorGroup === tab.id ? 'bg-zinc-600 text-zinc-100' : 'bg-zinc-900 text-zinc-400'
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {goalEditorGroup === 'macros' && (
              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: 'calories', label: 'Калории', unit: 'ккал' },
                  { key: 'protein', label: 'Белки', unit: 'г' },
                  { key: 'fat', label: 'Жиры', unit: 'г' },
                  { key: 'carbs', label: 'Углеводы', unit: 'г' },
                  { key: 'fiber', label: 'Клетчатка', unit: 'г' },
                ].map((field) => (
                  <label key={field.key} className="text-xs text-zinc-400">
                    {field.label} ({field.unit})
                    <input
                      type="number"
                      value={settingsGoals[field.key as 'calories' | 'protein' | 'fat' | 'carbs' | 'fiber']}
                      onChange={(e) => updateMacroField(field.key as 'calories' | 'protein' | 'fat' | 'carbs' | 'fiber', Number(e.target.value))}
                      className="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded-lg py-2 px-3 text-zinc-100"
                    />
                  </label>
                ))}
              </div>
            )}

            {goalEditorGroup === 'vitamins' && (
              <div className="space-y-2 max-h-[38vh] overflow-y-auto pr-1">
                {VITAMIN_CONFIG.map((item) => (
                  <label key={item.key} className="text-xs text-zinc-400 block">
                    {item.label} ({item.unit})
                    <input
                      type="number"
                      value={settingsGoals.vitamins[item.key] || 0}
                      onChange={(e) => updateNestedField('vitamins', item.key, Number(e.target.value))}
                      className="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded-lg py-2 px-3 text-zinc-100"
                    />
                  </label>
                ))}
              </div>
            )}

            {goalEditorGroup === 'minerals' && (
              <div className="space-y-2 max-h-[38vh] overflow-y-auto pr-1">
                {MINERAL_CONFIG.map((item) => (
                  <label key={item.key} className="text-xs text-zinc-400 block">
                    {item.label} ({item.unit})
                    <input
                      type="number"
                      value={settingsGoals.minerals[item.key] || 0}
                      onChange={(e) => updateNestedField('minerals', item.key, Number(e.target.value))}
                      className="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded-lg py-2 px-3 text-zinc-100"
                    />
                  </label>
                ))}
              </div>
            )}

            {goalEditorGroup === 'fatty' && (
              <div className="space-y-2 max-h-[38vh] overflow-y-auto pr-1">
                {FATTY_ACID_CONFIG.map((item) => (
                  <label key={item.key} className="text-xs text-zinc-400 block">
                    {item.label} ({item.unit})
                    <input
                      type="number"
                      value={settingsGoals.fattyAcids[item.key] || 0}
                      onChange={(e) => updateNestedField('fattyAcids', item.key, Number(e.target.value))}
                      className="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded-lg py-2 px-3 text-zinc-100"
                    />
                  </label>
                ))}
              </div>
            )}

            {goalEditorGroup === 'carbs' && (
              <div className="space-y-2 max-h-[38vh] overflow-y-auto pr-1">
                {CARB_TYPE_CONFIG.map((item) => (
                  <label key={item.key} className="text-xs text-zinc-400 block">
                    {item.label} ({item.unit})
                    <input
                      type="number"
                      value={settingsGoals.carbohydrateTypes[item.key] || 0}
                      onChange={(e) => updateNestedField('carbohydrateTypes', item.key, Number(e.target.value))}
                      className="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded-lg py-2 px-3 text-zinc-100"
                    />
                  </label>
                ))}
              </div>
            )}

            {goalEditorGroup === 'amino' && (
              <div className="space-y-2 max-h-[38vh] overflow-y-auto pr-1">
                {AMINO_CONFIG.map((item) => (
                  <label key={item.key} className="text-xs text-zinc-400 block">
                    {item.label} (mg)
                    <input
                      type="number"
                      value={settingsGoals.aminoAcids[item.key] || 0}
                      onChange={(e) => updateNestedField('aminoAcids', item.key, Number(e.target.value))}
                      className="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded-lg py-2 px-3 text-zinc-100"
                    />
                  </label>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={saveSettings}
            disabled={isSavingSettings}
            className={cn(
              'w-full py-3 rounded-xl font-semibold',
              isSavingSettings ? 'bg-zinc-700 text-zinc-400 cursor-not-allowed' : 'bg-emerald-500 text-white'
            )}
          >
            {isSavingSettings ? 'Сохраняем...' : 'Сохранить профиль и цели'}
          </button>
        </div>
      </BottomSheet>

      <BottomSheet isOpen={!!selectedProgram} onClose={() => setSelectedProgram(null)} title={selectedProgram ? `${selectedProgram.icon} ${selectedProgram.name}` : 'Программа'}>
        {selectedProgram && (
          <div className="space-y-4">
            <div className="bg-zinc-800/50 border border-zinc-700 rounded-xl p-4">
              <p className="text-sm text-zinc-200 font-semibold mb-2">Описание</p>
              <p className="text-sm text-zinc-400 leading-relaxed">{selectedProgram.description}</p>
              <p className="text-xs text-zinc-500 mt-3">Подходит: {selectedProgram.suitableFor}</p>
            </div>

            <div className="grid grid-cols-1 gap-3">
              {selectedProgramTargets && (
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3">
                  <p className="text-[10px] uppercase tracking-widest text-emerald-300 mb-1">Связка с вашим профилем</p>
                  <p className="text-sm text-zinc-100">Вес: {Math.round(profile.weightKg)} кг</p>
                  <p className="text-sm text-zinc-100">Персональные нормы: {selectedProgramTargets.calories} ккал • {selectedProgramTargets.protein}Б / {selectedProgramTargets.fat}Ж / {selectedProgramTargets.carbs}У</p>
                </div>
              )}
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

            <button
              onClick={() => setSelectedProgram(null)}
              className="w-full py-3 rounded-xl font-semibold bg-zinc-700 text-zinc-100"
            >
              Закрыть
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

  // "Недавние" / "Мои" — вкладки в экране добавления еды
  const [foodTab, setFoodTab] = useState<'all' | 'recent' | 'mine'>('all');
  const [recentFoods, setRecentFoods] = useState<RecentFoodItem[]>([]);
  const [isLoadingRecent, setIsLoadingRecent] = useState(false);
  const [mineProducts, setMineProducts] = useState<Product[]>([]);
  const [mineRecipes, setMineRecipes] = useState<MyRecipe[]>([]);
  const [isLoadingMine, setIsLoadingMine] = useState(false);
  const [isAddCustomProductOpen, setIsAddCustomProductOpen] = useState(false);
  const [customProductForm, setCustomProductForm] = useState({ name: '', brand: '', barcode: '', calories: '', protein: '', fat: '', carbs: '' });
  const [isSavingCustomProduct, setIsSavingCustomProduct] = useState(false);
  const [isCreateDishOpen, setIsCreateDishOpen] = useState(false);
  const [dishName, setDishName] = useState('');
  const [dishCookedWeight, setDishCookedWeight] = useState('');
  const [dishIngredients, setDishIngredients] = useState<DishIngredientDraft[]>([]);
  const [dishIngredientQuery, setDishIngredientQuery] = useState('');
  const [dishIngredientResults, setDishIngredientResults] = useState<Product[]>([]);
  const [isAutoFillingDish, setIsAutoFillingDish] = useState(false);
  const [isSavingDish, setIsSavingDish] = useState(false);
  // Правка состава блюда прямо в черновике «Проверьте результат» — переиспользует
  // состояние dishName/dishIngredients/dishCookedWeight выше (создание и правка не идут одновременно)
  const [editDishReviewTempId, setEditDishReviewTempId] = useState<string | null>(null);
  const [editingMealItem, setEditingMealItem] = useState<{ id: string; amount: number; name: string } | null>(null);
  const [editAmountValue, setEditAmountValue] = useState('');
  const [selectedDiaryDate, setSelectedDiaryDate] = useState<string>(toDateKey(new Date()));
  const [diaryData, setDiaryData] = useState<DiaryData>({ meals: [], goals: null, waterIntake: 0, date: selectedDiaryDate });
  const [weeklyHistory, setWeeklyHistory] = useState<DiaryHistoryPoint[]>([]);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    try {
      const saved = localStorage.getItem(THEME_MODE_STORAGE_KEY);
      return saved === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });
  const [profileSettings, setProfileSettings] = useState<UserProfileSettings>(DEFAULT_PROFILE_SETTINGS);
  const [goalOverrides, setGoalOverrides] = useState<Partial<NutrientGoalSet> | null>(null);
  const [hints, setHints] = useState<Hint[]>([]);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [recognizedItems, setRecognizedItems] = useState<RecognizedPhotoItem[]>([]);
  const [photoDishEstimate, setPhotoDishEstimate] = useState<PhotoDishEstimate | null>(null);
  const [photoRecognitionError, setPhotoRecognitionError] = useState('');
  const [photoCaptureMode, setPhotoCaptureMode] = useState<PhotoCaptureMode>('ingredients');
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
  const [amountEntryContext, setAmountEntryContext] = useState<{ source: 'search' | 'photo' | 'barcode' } | null>(null);
  const [photoCorrectionTarget, setPhotoCorrectionTarget] = useState<{ index: number; item: RecognizedPhotoItem } | null>(null);

  // «Проверьте результат» — единый черновик-список перед сохранением в дневник
  // (фото/голос/поиск кладут сюда; штрихкод-найден — исключение, сохраняется сразу)
  const [reviewItems, setReviewItems] = useState<ReviewDraftItem[]>([]);
  const [isReviewSheetOpen, setIsReviewSheetOpen] = useState(false);
  const [reviewEditIndex, setReviewEditIndex] = useState<number | null>(null);
  const [reviewEditAmount, setReviewEditAmount] = useState('');
  const [isSavingReview, setIsSavingReview] = useState(false);
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

  const autoGoals = useMemo(() => calculateAutoGoalsFromProfile(profileSettings), [profileSettings]);
  const effectiveGoals = useMemo(
    () => mergeGoals(goalOverrides || diaryData.goals || autoGoals),
    [goalOverrides, diaryData.goals, autoGoals]
  );

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
    if (!isLoggedIn) return;
    const interval = setInterval(fetchUnreadMessages, 60000);
    return () => clearInterval(interval);
  }, [isLoggedIn]);

  useEffect(() => {
    const root = document.documentElement;
    if (themeMode === 'light') {
      root.classList.add('theme-light');
    } else {
      root.classList.remove('theme-light');
    }

    try {
      localStorage.setItem(THEME_MODE_STORAGE_KEY, themeMode);
    } catch {
      // ignore storage failure
    }
  }, [themeMode]);

  useEffect(() => {
    try {
      const rawProfile = localStorage.getItem(PROFILE_SETTINGS_STORAGE_KEY);
      if (rawProfile) {
        const parsed = JSON.parse(rawProfile);
        setProfileSettings({ ...DEFAULT_PROFILE_SETTINGS, ...parsed });
      }

      const rawGoals = localStorage.getItem(GOAL_OVERRIDE_STORAGE_KEY);
      if (rawGoals) {
        const parsed = JSON.parse(rawGoals);
        setGoalOverrides(parsed);
      }
    } catch (e) {
      console.warn('Failed to restore profile/goals settings:', e);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(PROFILE_SETTINGS_STORAGE_KEY, JSON.stringify(profileSettings));
    } catch (e) {
      console.warn('Failed to persist profile settings:', e);
    }
  }, [profileSettings]);

  useEffect(() => {
    try {
      if (goalOverrides) {
        localStorage.setItem(GOAL_OVERRIDE_STORAGE_KEY, JSON.stringify(goalOverrides));
      } else {
        localStorage.removeItem(GOAL_OVERRIDE_STORAGE_KEY);
      }
    } catch (e) {
      console.warn('Failed to persist goal overrides:', e);
    }
  }, [goalOverrides]);

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

  const fetchUnreadMessages = async () => {
    try {
      const res = await fetch('/api/messages/unread-count');
      if (!res.ok) return;
      const data = await res.json();
      setUnreadMessages(data.count || 0);
    } catch (e) {
      console.error(e);
    }
  };

  const checkAuth = async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          setIsLoggedIn(true);
          fetchDiary();
          fetchUnreadMessages();
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
      fetchUnreadMessages();
    } catch (e) {
      console.error(e);
      alert('Сервер недоступен. Попробуйте позже.');
    }
  };

  const fetchHistory = async (targetDate = selectedDiaryDate) => {
    try {
      const res = await fetch(`/api/diary/history?days=7&endDate=${encodeURIComponent(targetDate)}`);
      if (!res.ok) return;
      const payload = await res.json().catch(() => null);
      const history = Array.isArray(payload?.history) ? payload.history : [];
      setWeeklyHistory(history);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchDiary = async (targetDate = selectedDiaryDate) => {
    try {
      const res = await fetch(`/api/diary?date=${encodeURIComponent(targetDate)}`);
      if (res.ok) {
        const data = await res.json();
        setDiaryData(data);
        fetchHistory(targetDate);
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

  const changeDiaryDate = (dateKey: string) => {
    if (dateKey === selectedDiaryDate) return;
    setSelectedDiaryDate(dateKey);
    fetchDiary(dateKey);
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
        body: JSON.stringify({ amount, date: selectedDiaryDate })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.warn('Water update error:', err);
        return;
      }
      fetchDiary(selectedDiaryDate);
    } catch (e) {
      console.error(e);
    }
  };

  const saveProfileAndGoals = async (nextProfile: UserProfileSettings, nextGoals: NutrientGoalSet) => {
    setProfileSettings(nextProfile);
    setGoalOverrides(nextGoals);

    const res = await fetch('/api/diary/goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        calories: nextGoals.calories,
        protein: nextGoals.protein,
        fat: nextGoals.fat,
        carbs: nextGoals.carbs,
        fiber: nextGoals.fiber,
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error || 'Не удалось обновить цели');
    }

    await fetchDiary(selectedDiaryDate);
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

      const goals = effectiveGoals;

      const prompt = `
        Текущее питание пользователя за сегодня:
        Калории: ${totals.calories}/${goals.calories}
        Белки: ${totals.protein}/${goals.protein}
        Жиры: ${totals.fat}/${goals.fat}
        Углеводы: ${totals.carbs}/${goals.carbs}
        Клетчатка: ${totals.fiber}/${goals.fiber}
        Витамины: ${JSON.stringify(totals.vitamins)}
        Минералы: ${JSON.stringify(totals.minerals)}
        Жирные кислоты: ${JSON.stringify(totals.fattyAcids)}
        Типы углеводов: ${JSON.stringify(totals.carbohydrateTypes)}
        Аминокислоты: ${JSON.stringify(totals.aminoAcids)}

        Сгенерируй 2-3 короткие практичные подсказки на русском языке.
        Сделай акцент на дефицитах витаминов и минералов, если они есть.
        Формат каждого элемента: severity (одно из low|med|high), title, explanation, cta (необязательный поисковый запрос).
        Верни только JSON-массив объектов.
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

  const addFood = async (productId: string, amount: number, usdaData?: Product, skipRefresh = false) => {
    try {
      const res = await fetch('/api/diary/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          amount,
          type: selectedMealType,
          date: selectedDiaryDate,
          usdaData
        })
      });
      if (res.ok && !skipRefresh) {
        fetchDiary(selectedDiaryDate);
        fetchHints();
      }
      return res.ok;
    } catch (e) {
      console.error(e);
      return false;
    }
  };

  // --- «Проверьте результат»: единый черновик перед сохранением (см. прототип) ---

  const addToReviewDraft = (product: Product, amount: number, usdaData?: Product, dishIngredients?: DishIngredientDraft[]) => {
    setReviewItems((prev) => [
      ...prev,
      { tempId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, product, amount, usdaData, dishIngredients }
    ]);
    setIsReviewSheetOpen(true);
  };

  const removeReviewItem = (tempId: string) => {
    setReviewItems((prev) => prev.filter((it) => it.tempId !== tempId));
    setReviewEditIndex(null);
  };

  const updateReviewItemAmount = (tempId: string, amount: number) => {
    if (!Number.isFinite(amount) || amount <= 0) return;
    setReviewItems((prev) => prev.map((it) => (it.tempId === tempId ? { ...it, amount } : it)));
    setReviewEditIndex(null);
  };

  const reviewTotals = reviewItems.reduce(
    (acc, it) => {
      const factor = it.amount / 100;
      return {
        calories: acc.calories + it.product.calories * factor,
        protein: acc.protein + it.product.protein * factor,
        fat: acc.fat + it.product.fat * factor,
        carbs: acc.carbs + it.product.carbs * factor,
      };
    },
    { calories: 0, protein: 0, fat: 0, carbs: 0 }
  );

  const saveReviewDraft = async () => {
    if (reviewItems.length === 0) return;
    setIsSavingReview(true);
    try {
      for (const item of reviewItems) {
        await addFood(item.product.id, item.amount, item.usdaData, true);
      }
      fetchDiary(selectedDiaryDate);
      fetchHints();
      setReviewItems([]);
      setIsReviewSheetOpen(false);
    } finally {
      setIsSavingReview(false);
    }
  };

  const discardReviewDraft = () => {
    setReviewItems([]);
    setReviewEditIndex(null);
    setIsReviewSheetOpen(false);
  };

  const fetchRecentFoods = async () => {
    setIsLoadingRecent(true);
    try {
      const res = await fetch('/api/products/recent');
      if (res.ok) setRecentFoods(await res.json());
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingRecent(false);
    }
  };

  const fetchMine = async () => {
    setIsLoadingMine(true);
    try {
      const res = await fetch('/api/products/mine');
      if (res.ok) {
        const data = await res.json();
        setMineProducts(data.products || []);
        setMineRecipes(data.recipes || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingMine(false);
    }
  };

  const handleFoodTabChange = (tab: 'all' | 'recent' | 'mine') => {
    setFoodTab(tab);
    if (tab === 'recent' && recentFoods.length === 0) fetchRecentFoods();
    if (tab === 'mine') fetchMine();
  };

  const submitCustomProduct = async () => {
    if (!customProductForm.name.trim()) return;
    setIsSavingCustomProduct(true);
    try {
      const res = await fetch('/api/products/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: customProductForm.name.trim(),
          brand: customProductForm.brand.trim() || undefined,
          barcode: customProductForm.barcode.trim() || undefined,
          calories: Number(customProductForm.calories) || 0,
          protein: Number(customProductForm.protein) || 0,
          fat: Number(customProductForm.fat) || 0,
          carbs: Number(customProductForm.carbs) || 0,
        })
      });
      if (res.ok) {
        setIsAddCustomProductOpen(false);
        setCustomProductForm({ name: '', brand: '', barcode: '', calories: '', protein: '', fat: '', carbs: '' });
        fetchMine();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsSavingCustomProduct(false);
    }
  };

  const searchDishIngredients = async (query: string) => {
    setDishIngredientQuery(query);
    if (query.trim().length < 2) {
      setDishIngredientResults([]);
      return;
    }
    try {
      const res = await fetch(`/api/products/search?q=${encodeURIComponent(query.trim())}`);
      if (res.ok) setDishIngredientResults(await res.json());
    } catch (e) {
      console.error(e);
    }
  };

  const addDishIngredient = (product: Product) => {
    setDishIngredients((prev) => [
      ...prev,
      {
        productId: product.id,
        name: product.name,
        weightGrams: '100',
        calories: product.calories,
        protein: product.protein,
        fat: product.fat,
        carbs: product.carbs,
      }
    ]);
    setDishIngredientQuery('');
    setDishIngredientResults([]);
  };

  const removeDishIngredient = (index: number) => {
    setDishIngredients((prev) => prev.filter((_, i) => i !== index));
  };

  // AI разбирает название блюда на состав + граммовку на одну порцию (тот же
  // движок декомпозиции и матчинга, что и в голосовом дневнике, чтобы не
  // дублировать промпт/логику матчинга).
  const aiFillDish = async () => {
    if (!dishName.trim()) return;
    setIsAutoFillingDish(true);
    try {
      const res = await fetch('/api/voice/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: dishName.trim() }),
      });
      if (res.ok) {
        const items: { name: string; amount: number; product: Product | null }[] = await res.json();
        const matched = items
          .filter((it) => it.product)
          .map((it) => ({
            productId: it.product!.id,
            name: it.product!.name,
            weightGrams: String(Math.max(1, Math.round(it.amount))),
            calories: it.product!.calories,
            protein: it.product!.protein,
            fat: it.product!.fat,
            carbs: it.product!.carbs,
          }));
        if (matched.length > 0) setDishIngredients(matched);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsAutoFillingDish(false);
    }
  };

  const dishTotals = dishIngredients.reduce(
    (acc, ing) => {
      const factor = (Number(ing.weightGrams) || 0) / 100;
      return {
        weight: acc.weight + (Number(ing.weightGrams) || 0),
        calories: acc.calories + ing.calories * factor,
        protein: acc.protein + ing.protein * factor,
        fat: acc.fat + ing.fat * factor,
        carbs: acc.carbs + ing.carbs * factor,
      };
    },
    { weight: 0, calories: 0, protein: 0, fat: 0, carbs: 0 }
  );

  // Открыть правку состава блюда прямо в черновике «Проверьте результат»
  const openEditDishIngredients = (item: ReviewDraftItem) => {
    // Закрываем «Проверьте результат» на время правки — обе шторки используют
    // одинаковый fixed-оверлей, и при одновременном показе они залезают друг на друга
    setIsReviewSheetOpen(false);
    setEditDishReviewTempId(item.tempId);
    setDishName(item.product.name);
    setDishCookedWeight(String(Math.round(item.amount)));
    setDishIngredients(item.dishIngredients ? item.dishIngredients.map((ing) => ({ ...ing })) : []);
    setDishIngredientQuery('');
    setDishIngredientResults([]);
  };

  const closeEditDishIngredients = () => {
    setEditDishReviewTempId(null);
    setDishName('');
    setDishCookedWeight('');
    setDishIngredients([]);
    setDishIngredientQuery('');
    setDishIngredientResults([]);
    setIsReviewSheetOpen(true);
  };

  const submitDish = async () => {
    if (!dishName.trim() || dishIngredients.length === 0) return;
    setIsSavingDish(true);
    const payload = {
      name: dishName.trim(),
      cookedWeightGrams: Number(dishCookedWeight) || dishTotals.weight,
      ingredients: dishIngredients.map((ing) => ({
        productId: ing.productId,
        name: ing.name,
        weightGrams: Number(ing.weightGrams) || 0,
        calories: ing.calories,
        protein: ing.protein,
        fat: ing.fat,
        carbs: ing.carbs,
      }))
    };
    try {
      if (editDishReviewTempId) {
        const recipeId = reviewItems.find((it) => it.tempId === editDishReviewTempId)?.product.recipeId;
        if (!recipeId) { closeEditDishIngredients(); return; }
        const res = await fetch(`/api/recipes/${recipeId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          const recipe = await res.json();
          const updatedProduct: Product = { ...recipe.product, recipeId: recipe.product?.recipeId || recipe.id };
          const newWeight = payload.cookedWeightGrams;
          const savedIngredients = dishIngredients.map((ing) => ({ ...ing }));
          setReviewItems((prev) => prev.map((it) => it.tempId === editDishReviewTempId
            ? { ...it, product: updatedProduct, amount: newWeight, dishIngredients: savedIngredients }
            : it));
          closeEditDishIngredients();
        }
        return;
      }
      const res = await fetch('/api/recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        setIsCreateDishOpen(false);
        setDishName('');
        setDishCookedWeight('');
        setDishIngredients([]);
        fetchMine();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsSavingDish(false);
    }
  };

  const updateMealItemAmount = async () => {
    if (!editingMealItem) return;
    const amount = Number(editAmountValue);
    if (!Number.isFinite(amount) || amount <= 0) return;
    try {
      const res = await fetch(`/api/diary/item/${editingMealItem.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount })
      });
      if (res.ok) {
        setEditingMealItem(null);
        fetchDiary(selectedDiaryDate);
        fetchHints();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const openPhotoPicker = (mode: PhotoCaptureMode) => {
    setPhotoCaptureMode(mode);
    setPhotoRecognitionError('');
    setRecognizedItems([]);
    setPhotoDishEstimate(null);
    setPhotoCorrectionTarget(null);
    setIsActionSheetOpen(false);
    fileInputRef.current?.click();
  };

  const savePhotoCorrection = async (item: RecognizedPhotoItem, product: Product) => {
    const res = await fetch('/api/photo/corrections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceName: item.name,
        aliases: item.aliases || [],
        visibleText: item.visibleText || [],
        correctedProductId: product.id,
        correctedProduct: product,
      })
    });

    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(payload?.message || payload?.error || 'Не удалось сохранить исправление');
    }

    return (payload?.product || product) as Product;
  };

  const handleProductSelection = async (product: Product) => {
    if (!photoCorrectionTarget) {
      setSelectedProductForAmount(product);
      setFoodAmount('100');
      setAmountEntryContext({ source: 'search' });
      return;
    }

    try {
      const correctedProduct = await savePhotoCorrection(photoCorrectionTarget.item, product);
      setRecognizedItems((prev) => prev.map((entry, index) => (
        index === photoCorrectionTarget.index
          ? {
              ...entry,
              name: correctedProduct.name,
              product: correctedProduct,
              correctedByUser: true,
              matchedBy: 'correction',
              matchScore: 1,
            }
          : entry
      )));
      setIsSearchSheetOpen(false);
      setIsPhotoSheetOpen(true);
      setSelectedProductForAmount(correctedProduct);
      setFoodAmount(String(Math.max(1, Math.round(photoCorrectionTarget.item.amount || 100))));
      setAmountEntryContext({ source: 'photo' });
    } catch (e) {
      console.error('Photo correction save error:', e);
      alert('Не удалось сохранить исправление распознавания. Попробуйте ещё раз.');
    } finally {
      setPhotoCorrectionTarget(null);
    }
  };

  const startPhotoCorrection = (item: RecognizedPhotoItem, index: number) => {
    setPhotoCorrectionTarget({ index, item });
    setSearchQuery(item.name);
    setSearchResults([]);
    setIsSearchSheetOpen(true);
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setPhotoRecognitionError('');
    setRecognizedItems([]);
    setPhotoDishEstimate(null);
    setPhotoCorrectionTarget(null);
    setIsRecognizing(true);
    setIsPhotoSheetOpen(true);
    setIsActionSheetOpen(false);

    try {
      const optimizedImage = await optimizeImageForRecognition(file);
      const response = await fetch('/api/photo/recognize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: optimizedImage, mode: photoCaptureMode })
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.message || payload?.error || 'Ошибка распознавания фото');
      }

      const matchedItems = Array.isArray(payload?.items) ? payload.items : [];
      const dishEstimate = payload?.dishEstimate && typeof payload.dishEstimate === 'object'
        ? payload.dishEstimate as PhotoDishEstimate
        : null;
      setRecognizedItems(matchedItems);
      setPhotoDishEstimate(dishEstimate);

      if (matchedItems.length === 0 && !dishEstimate) {
        setPhotoRecognitionError(payload?.message || 'На фото не удалось уверенно распознать продукты. Попробуйте сделать фото ближе и при хорошем освещении.');
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
        // Штрихкод найден — единственное исключение из единого экрана «Проверьте результат»:
        // сразу показываем ввод веса и сохраняем без черновика.
        setSelectedProductForAmount(product);
        setFoodAmount('100');
        setAmountEntryContext({ source: 'barcode' });
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

  // Разбор голосовой фразы добавляет сразу ВСЕ распознанные продукты
  // в единый черновик "Проверьте результат" с граммовкой от AI — без
  // отдельного клика "Добавить" и подтверждения веса на каждый ингредиент,
  // что раньше позволяло часть распознанных продуктов потеряться при закрытии
  // листа кнопкой "Готово". Грамма после этого можно поправить в черновике.
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
        const items: { name: string; amount: number; product: Product | null }[] = Array.isArray(itemsRaw) ? itemsRaw : [];
        if (items.length === 0) {
          alert('Не удалось распознать продукты. Попробуйте сказать иначе.');
          return;
        }

        const matched = items.filter((it) => it.product);
        const unmatched = items.filter((it) => !it.product);

        if (matched.length > 1) {
          // AI разложил фразу на несколько ингредиентов одного блюда — собираем их
          // в одну позицию "/api/recipes" (как в "Создать блюдо"), чтобы в дневник
          // попало одно название блюда, а не отдельная строка на каждый ингредиент.
          const dishName = voiceTranscript.trim().replace(/^./, (c) => c.toUpperCase());
          const weighedIngredients = matched.map((it) => ({
            product: it.product as Product,
            weightGrams: Math.max(1, Math.round(it.amount || 100)),
          }));
          const totalWeight = weighedIngredients.reduce((sum, ing) => sum + ing.weightGrams, 0);
          let dishSaved = false;
          try {
            const recipeRes = await fetch('/api/recipes', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: dishName,
                cookedWeightGrams: totalWeight,
                ingredients: weighedIngredients.map((ing) => ({
                  productId: ing.product.id,
                  name: ing.product.name,
                  weightGrams: ing.weightGrams,
                  calories: ing.product.calories,
                  protein: ing.product.protein,
                  fat: ing.product.fat,
                  carbs: ing.product.carbs,
                }))
              })
            });
            if (recipeRes.ok) {
              const recipe = await recipeRes.json();
              const product: Product = { ...recipe.product, recipeId: recipe.product?.recipeId || recipe.id };
              const dishIngredientsDraft: DishIngredientDraft[] = weighedIngredients.map((ing) => ({
                productId: ing.product.id,
                name: ing.product.name,
                weightGrams: String(ing.weightGrams),
                calories: ing.product.calories,
                protein: ing.product.protein,
                fat: ing.product.fat,
                carbs: ing.product.carbs,
              }));
              addToReviewDraft(product, totalWeight, undefined, dishIngredientsDraft);
              dishSaved = true;
            }
          } catch (e) {
            console.error(e);
          }
          if (!dishSaved) {
            // Не удалось собрать блюдо одной позицией — не теряем распознанное,
            // добавляем ингредиенты по отдельности, как раньше.
            weighedIngredients.forEach((ing) => {
              const usda = (ing.product.isUsda || ing.product.isAiEstimated) ? ing.product : undefined;
              addToReviewDraft(ing.product, ing.weightGrams, usda);
            });
          }
        } else {
          matched.forEach((it) => {
            const product = it.product as Product;
            const usda = (product.isUsda || product.isAiEstimated) ? product : undefined;
            addToReviewDraft(product, Math.max(1, Math.round(it.amount || 100)), usda);
          });
        }

        setIsVoiceSheetOpen(false);
        setVoiceTranscript('');

        if (matched.length === 0) {
          alert('Не нашли в базе ни один продукт. Попробуйте сказать иначе или добавьте вручную через поиск.');
        } else if (unmatched.length > 0) {
          alert(`Не нашли в базе: ${unmatched.map((it) => it.name).join(', ')}. Добавьте их вручную через «Добавить ещё продукт».`);
        }
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
          className="w-full py-4 bg-emerald-500 text-white font-bold rounded-2xl shadow-[0_8px_24px_rgba(0,115,112,0.3)] active:scale-95 transition-transform"
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
              data={{ ...diaryData, goals: effectiveGoals }}
              selectedDate={selectedDiaryDate}
              onChangeDate={changeDiaryDate}
              onAddClick={openAddFood}
              hints={hints}
              onHintClick={handleHintClick}
              onDeleteItem={deleteMealItem}
              onEditItem={(item: any) => {
                setEditingMealItem({ id: item.id, amount: item.amount, name: item.product?.name || 'Изменить вес' });
                setEditAmountValue(String(Math.round(item.amount)));
              }}
              onUpdateWater={updateWater}
            />
          ) : (
            <SummaryScreen
              view={activeTab === 'stats' ? 'stats' : 'profile'}
              goals={effectiveGoals}
              profile={profileSettings}
              weeklyHistory={weeklyHistory}
              themeMode={themeMode}
              fastingMode={fastingMode}
              customFastingHours={customFastingHours}
              isFastingActive={isFastingActive}
              fastingEndAt={fastingEndAt}
              nowTs={nowTs}
              onSetMode={handleSetFastingMode}
              onSetCustomHours={handleSetCustomFastingHours}
              onStart={handleStartFasting}
              onStop={handleStopFasting}
              onSaveProfileGoals={saveProfileAndGoals}
              onToggleTheme={() => setThemeMode((prev) => (prev === 'light' ? 'dark' : 'light'))}
              onMessagesRead={fetchUnreadMessages}
            />
          )}
        </motion.div>
      </AnimatePresence>

      {activeTab === 'nutrition' && (
        <FAB onClick={() => {
          setSelectedMealType(getCurrentMealType());
          setIsActionSheetOpen(true);
        }} />
      )}
      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} unreadMessages={unreadMessages} />

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

          <div className="grid grid-cols-3 gap-3">
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
              onClick={() => openPhotoPicker('ingredients')}
              className="flex flex-col items-center gap-2"
            >
              <div className="w-14 h-14 rounded-2xl bg-zinc-800 flex items-center justify-center text-emerald-500 shadow-inner hover:bg-zinc-700 transition-colors">
                <Camera size={24} />
              </div>
              <span className="text-[10px] font-medium text-zinc-400">Фото состав</span>
            </button>
            <button 
              onClick={() => openPhotoPicker('whole_dish')}
              className="flex flex-col items-center gap-2"
            >
              <div className="w-14 h-14 rounded-2xl bg-zinc-800 flex items-center justify-center text-emerald-500 shadow-inner hover:bg-zinc-700 transition-colors">
                <Utensils size={24} />
              </div>
              <span className="text-[10px] font-medium text-zinc-400">Фото блюда</span>
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
      <BottomSheet isOpen={isSearchSheetOpen} onClose={() => { setIsSearchSheetOpen(false); setPhotoCorrectionTarget(null); setFoodTab('all'); if (reviewItems.length > 0) setIsReviewSheetOpen(true); }} title={photoCorrectionTarget ? 'Исправить распознавание' : `Добавить в ${selectedMealType === 'BREAKFAST' ? 'Завтрак' : selectedMealType === 'LUNCH' ? 'Обед' : selectedMealType === 'DINNER' ? 'Ужин' : 'Перекус'}`}>
        {!photoCorrectionTarget && (
          <div className="flex gap-2 mb-4">
            {([
              ['all', 'Все'],
              ['recent', 'Недавние'],
              ['mine', 'Мои'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => handleFoodTabChange(key)}
                className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                  foodTab === key ? 'bg-emerald-500 text-white' : 'bg-zinc-800 text-zinc-400'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {(foodTab === 'all' || photoCorrectionTarget) && (
          <>
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
                    onClick={() => { void handleProductSelection(product); }}
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
          </>
        )}

        {foodTab === 'recent' && !photoCorrectionTarget && (
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2">
            {isLoadingRecent ? (
              <div className="py-12 text-center"><Loader2 className="mx-auto animate-spin text-emerald-500" size={32} /></div>
            ) : recentFoods.length === 0 ? (
              <p className="text-center text-zinc-500 py-12 text-sm">Здесь появятся продукты, которые вы добавляли недавно</p>
            ) : (
              recentFoods.map((product) => (
                <button
                  key={product.id}
                  onClick={() => {
                    setSelectedProductForAmount(product);
                    setFoodAmount(String(Math.max(1, Math.round(product.lastWeightGrams || 100))));
                    setAmountEntryContext({ source: 'search' });
                  }}
                  className="w-full bg-zinc-800/50 border border-zinc-800 rounded-xl p-4 flex justify-between items-center active:bg-zinc-800 transition-colors"
                >
                  <div className="text-left">
                    <p className="font-semibold text-zinc-200">{product.name}</p>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider">{product.brand} • {product.calories} kcal / 100g</p>
                  </div>
                  <Plus size={20} className="text-emerald-500" />
                </button>
              ))
            )}
          </div>
        )}

        {foodTab === 'mine' && !photoCorrectionTarget && (
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2">
            <div className="flex gap-2 mb-2">
              <button
                onClick={() => setIsCreateDishOpen(true)}
                className="flex-1 py-3 rounded-xl bg-zinc-800 text-zinc-200 text-sm font-semibold active:bg-zinc-700 transition-colors"
              >
                + Создать блюдо
              </button>
              <button
                onClick={() => setIsAddCustomProductOpen(true)}
                className="flex-1 py-3 rounded-xl bg-zinc-800 text-zinc-200 text-sm font-semibold active:bg-zinc-700 transition-colors"
              >
                + Свой продукт
              </button>
            </div>

            {isLoadingMine ? (
              <div className="py-12 text-center"><Loader2 className="mx-auto animate-spin text-emerald-500" size={32} /></div>
            ) : mineProducts.length === 0 && mineRecipes.length === 0 ? (
              <p className="text-center text-zinc-500 py-8 text-sm">Сохраняйте свои блюда и продукты, чтобы добавлять их быстрее</p>
            ) : (
              <>
                {mineRecipes.map((recipe) => (
                  <button
                    key={recipe.id}
                    onClick={() => {
                      setSelectedProductForAmount(recipe.product);
                      setFoodAmount(String(Math.max(1, Math.round(recipe.cookedWeightGrams || 100))));
                      setAmountEntryContext({ source: 'search' });
                    }}
                    className="w-full bg-zinc-800/50 border border-zinc-800 rounded-xl p-4 flex justify-between items-center active:bg-zinc-800 transition-colors"
                  >
                    <div className="text-left">
                      <p className="font-semibold text-zinc-200">{recipe.name}</p>
                      <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Блюдо • {Math.round(recipe.product.calories)} kcal / 100g</p>
                    </div>
                    <Plus size={20} className="text-emerald-500" />
                  </button>
                ))}
                {mineProducts.map((product) => (
                  <button
                    key={product.id}
                    onClick={() => { void handleProductSelection(product); }}
                    className="w-full bg-zinc-800/50 border border-zinc-800 rounded-xl p-4 flex justify-between items-center active:bg-zinc-800 transition-colors"
                  >
                    <div className="text-left">
                      <p className="font-semibold text-zinc-200">{product.name}</p>
                      <p className="text-[10px] text-zinc-500 uppercase tracking-wider">{product.brand || 'Свой продукт'} • {product.calories} kcal / 100g</p>
                    </div>
                    <Plus size={20} className="text-emerald-500" />
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </BottomSheet>

      {/* "Мои" → Добавить свой продукт */}
      <BottomSheet isOpen={isAddCustomProductOpen} onClose={() => setIsAddCustomProductOpen(false)} title="Добавить свой продукт">
        <div className="space-y-3">
          <input
            type="text" placeholder="Название"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-xl py-3 px-4 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            value={customProductForm.name}
            onChange={(e) => setCustomProductForm((p) => ({ ...p, name: e.target.value }))}
          />
          <input
            type="text" placeholder="Бренд (необязательно)"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-xl py-3 px-4 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            value={customProductForm.brand}
            onChange={(e) => setCustomProductForm((p) => ({ ...p, brand: e.target.value }))}
          />
          <input
            type="text" placeholder="Штрихкод (необязательно)"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-xl py-3 px-4 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            value={customProductForm.barcode}
            onChange={(e) => setCustomProductForm((p) => ({ ...p, barcode: e.target.value }))}
          />
          <p className="text-[11px] text-zinc-500 uppercase tracking-wider pt-1">КБЖУ на 100 г</p>
          <div className="grid grid-cols-2 gap-3">
            <input type="number" placeholder="Калории" className="bg-zinc-800 border border-zinc-700 rounded-xl py-3 px-4 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
              value={customProductForm.calories} onChange={(e) => setCustomProductForm((p) => ({ ...p, calories: e.target.value }))} />
            <input type="number" placeholder="Белки, г" className="bg-zinc-800 border border-zinc-700 rounded-xl py-3 px-4 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
              value={customProductForm.protein} onChange={(e) => setCustomProductForm((p) => ({ ...p, protein: e.target.value }))} />
            <input type="number" placeholder="Жиры, г" className="bg-zinc-800 border border-zinc-700 rounded-xl py-3 px-4 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
              value={customProductForm.fat} onChange={(e) => setCustomProductForm((p) => ({ ...p, fat: e.target.value }))} />
            <input type="number" placeholder="Углеводы, г" className="bg-zinc-800 border border-zinc-700 rounded-xl py-3 px-4 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
              value={customProductForm.carbs} onChange={(e) => setCustomProductForm((p) => ({ ...p, carbs: e.target.value }))} />
          </div>
          <button
            onClick={() => { void submitCustomProduct(); }}
            disabled={!customProductForm.name.trim() || isSavingCustomProduct}
            className="w-full py-4 bg-emerald-500 text-white font-bold rounded-2xl shadow-lg shadow-emerald-500/20 active:scale-95 transition-transform disabled:opacity-40"
          >
            {isSavingCustomProduct ? 'Сохранение...' : 'Сохранить в Мои'}
          </button>
        </div>
      </BottomSheet>

      {/* "Мои" → Создать блюдо из ингредиентов */}
      <BottomSheet isOpen={isCreateDishOpen} onClose={() => setIsCreateDishOpen(false)} title="Создать блюдо">
        <div className="space-y-3">
          <input
            type="text" placeholder="Название блюда"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-xl py-3 px-4 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            value={dishName}
            onChange={(e) => setDishName(e.target.value)}
          />

          <button
            onClick={() => { void aiFillDish(); }}
            disabled={!dishName.trim() || isAutoFillingDish}
            className="w-full py-2.5 bg-zinc-800 border border-emerald-500/40 text-emerald-400 text-sm font-medium rounded-xl active:scale-95 transition-transform disabled:opacity-40 flex items-center justify-center gap-2"
          >
            <Sparkles size={16} />
            {isAutoFillingDish ? 'Подбираем состав...' : 'Заполнить автоматически (AI)'}
          </button>

          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
            <input
              type="text" placeholder="Добавить ингредиент из базы..."
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl py-3 pl-11 pr-4 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
              value={dishIngredientQuery}
              onChange={(e) => { void searchDishIngredients(e.target.value); }}
            />
          </div>
          {dishIngredientResults.length > 0 && (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {dishIngredientResults.map((product) => (
                <button
                  key={product.id}
                  onClick={() => addDishIngredient(product)}
                  className="w-full text-left bg-zinc-800/50 rounded-lg p-2.5 text-sm text-zinc-200 active:bg-zinc-800"
                >
                  {product.name} <span className="text-zinc-500 text-xs">{product.brand}</span>
                </button>
              ))}
            </div>
          )}

          {dishIngredients.length > 0 && (
            <div className="space-y-2 pt-2">
              {dishIngredients.map((ing, idx) => (
                <div key={`${ing.productId}-${idx}`} className="flex items-center gap-2 bg-zinc-800/50 rounded-xl p-3">
                  <span className="flex-1 text-sm text-zinc-200 truncate">{ing.name}</span>
                  <input
                    type="number"
                    className="w-20 bg-zinc-900 border border-zinc-700 rounded-lg py-1.5 px-2 text-zinc-100 text-sm text-right"
                    value={ing.weightGrams}
                    onChange={(e) => setDishIngredients((prev) => prev.map((it, i) => i === idx ? { ...it, weightGrams: e.target.value } : it))}
                  />
                  <span className="text-xs text-zinc-500">г</span>
                  <button onClick={() => removeDishIngredient(idx)} className="text-red-400 active:scale-90 transition-transform">
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div>
            <label className="text-[11px] text-zinc-500 uppercase tracking-wider">Вес готового блюда, г</label>
            <input
              type="number" placeholder={dishTotals.weight ? String(Math.round(dishTotals.weight)) : 'Вес готового блюда'}
              className="w-full mt-1 bg-zinc-800 border border-zinc-700 rounded-xl py-3 px-4 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
              value={dishCookedWeight}
              onChange={(e) => setDishCookedWeight(e.target.value)}
            />
          </div>

          {dishIngredients.length > 0 && (
            <div className="bg-zinc-800/50 rounded-xl p-3 grid grid-cols-4 gap-2 text-center">
              <div><p className="text-sm font-bold text-zinc-100">{Math.round(dishTotals.calories)}</p><p className="text-[9px] text-zinc-500 uppercase">ккал</p></div>
              <div><p className="text-sm font-bold text-zinc-100">{Math.round(dishTotals.protein)}</p><p className="text-[9px] text-zinc-500 uppercase">белки</p></div>
              <div><p className="text-sm font-bold text-zinc-100">{Math.round(dishTotals.fat)}</p><p className="text-[9px] text-zinc-500 uppercase">жиры</p></div>
              <div><p className="text-sm font-bold text-zinc-100">{Math.round(dishTotals.carbs)}</p><p className="text-[9px] text-zinc-500 uppercase">углеводы</p></div>
            </div>
          )}

          <button
            onClick={() => { void submitDish(); }}
            disabled={!dishName.trim() || dishIngredients.length === 0 || isSavingDish}
            className="w-full py-4 bg-emerald-500 text-white font-bold rounded-2xl shadow-lg shadow-emerald-500/20 active:scale-95 transition-transform disabled:opacity-40"
          >
            {isSavingDish ? 'Сохранение...' : 'Сохранить в Мои'}
          </button>
        </div>
      </BottomSheet>

      {/* «Проверьте результат» → правка состава блюда, собранного из ингредиентов (голос/фото) */}
      <BottomSheet isOpen={editDishReviewTempId !== null} onClose={closeEditDishIngredients} title="Состав блюда">
        <div className="space-y-3">
          <input
            type="text" placeholder="Название блюда"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-xl py-3 px-4 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            value={dishName}
            onChange={(e) => setDishName(e.target.value)}
          />

          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
            <input
              type="text" placeholder="Добавить ингредиент из базы..."
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl py-3 pl-11 pr-4 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
              value={dishIngredientQuery}
              onChange={(e) => { void searchDishIngredients(e.target.value); }}
            />
          </div>
          {dishIngredientResults.length > 0 && (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {dishIngredientResults.map((product) => (
                <button
                  key={product.id}
                  onClick={() => addDishIngredient(product)}
                  className="w-full text-left bg-zinc-800/50 rounded-lg p-2.5 text-sm text-zinc-200 active:bg-zinc-800"
                >
                  {product.name} <span className="text-zinc-500 text-xs">{product.brand}</span>
                </button>
              ))}
            </div>
          )}

          {dishIngredients.length > 0 && (
            <div className="space-y-2 pt-2">
              {dishIngredients.map((ing, idx) => (
                <div key={`${ing.productId}-${idx}`} className="flex items-center gap-2 bg-zinc-800/50 rounded-xl p-3">
                  <span className="flex-1 text-sm text-zinc-200 truncate">{ing.name}</span>
                  <input
                    type="number"
                    className="w-20 bg-zinc-900 border border-zinc-700 rounded-lg py-1.5 px-2 text-zinc-100 text-sm text-right"
                    value={ing.weightGrams}
                    onChange={(e) => setDishIngredients((prev) => prev.map((it, i) => i === idx ? { ...it, weightGrams: e.target.value } : it))}
                  />
                  <span className="text-xs text-zinc-500">г</span>
                  <button onClick={() => removeDishIngredient(idx)} className="text-red-400 active:scale-90 transition-transform">
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div>
            <label className="text-[11px] text-zinc-500 uppercase tracking-wider">Вес готового блюда, г</label>
            <input
              type="number" placeholder={dishTotals.weight ? String(Math.round(dishTotals.weight)) : 'Вес готового блюда'}
              className="w-full mt-1 bg-zinc-800 border border-zinc-700 rounded-xl py-3 px-4 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
              value={dishCookedWeight}
              onChange={(e) => setDishCookedWeight(e.target.value)}
            />
          </div>

          {dishIngredients.length > 0 && (
            <div className="bg-zinc-800/50 rounded-xl p-3 grid grid-cols-4 gap-2 text-center">
              <div><p className="text-sm font-bold text-zinc-100">{Math.round(dishTotals.calories)}</p><p className="text-[9px] text-zinc-500 uppercase">ккал</p></div>
              <div><p className="text-sm font-bold text-zinc-100">{Math.round(dishTotals.protein)}</p><p className="text-[9px] text-zinc-500 uppercase">белки</p></div>
              <div><p className="text-sm font-bold text-zinc-100">{Math.round(dishTotals.fat)}</p><p className="text-[9px] text-zinc-500 uppercase">жиры</p></div>
              <div><p className="text-sm font-bold text-zinc-100">{Math.round(dishTotals.carbs)}</p><p className="text-[9px] text-zinc-500 uppercase">углеводы</p></div>
            </div>
          )}

          <button
            onClick={() => { void submitDish(); }}
            disabled={!dishName.trim() || dishIngredients.length === 0 || isSavingDish}
            className="w-full py-4 bg-emerald-500 text-white font-bold rounded-2xl shadow-lg shadow-emerald-500/20 active:scale-95 transition-transform disabled:opacity-40"
          >
            {isSavingDish ? 'Сохранение...' : 'Сохранить изменения'}
          </button>
        </div>
      </BottomSheet>

      {/* Редактирование веса записи дневника */}
      <BottomSheet isOpen={!!editingMealItem} onClose={() => setEditingMealItem(null)} title={editingMealItem?.name || 'Изменить вес'}>
        {editingMealItem && (
          <div className="space-y-4">
            <div>
              <label className="text-[11px] text-zinc-500 uppercase tracking-wider">Вес, г</label>
              <input
                type="number" autoFocus
                className="w-full mt-1 bg-zinc-800 border border-zinc-700 rounded-xl py-3 px-4 text-zinc-100 text-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                value={editAmountValue}
                onChange={(e) => setEditAmountValue(e.target.value)}
              />
            </div>
            <button
              onClick={() => { void updateMealItemAmount(); }}
              className="w-full py-4 bg-emerald-500 text-white font-bold rounded-2xl shadow-lg shadow-emerald-500/20 active:scale-95 transition-transform"
            >
              Готово
            </button>
          </div>
        )}
      </BottomSheet>

      {/* Ввод количества */}
      <BottomSheet 
        isOpen={!!selectedProductForAmount} 
        onClose={() => {
          setSelectedProductForAmount(null);
          setAmountEntryContext(null);
        }} 
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

            <div className="flex justify-center gap-2">
              {[50, 100, 150, 200, 300].map((preset) => (
                <button
                  key={preset}
                  onClick={() => setFoodAmount(String(preset))}
                  className="px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs"
                >
                  {preset}г
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button 
                onClick={() => {
                  setSelectedProductForAmount(null);
                  setAmountEntryContext(null);
                }}
                className="py-4 bg-zinc-800 text-zinc-300 font-bold rounded-2xl active:scale-95 transition-transform"
              >
                Отмена
              </button>
              <button
                onClick={async () => {
                  if (!selectedProductForAmount) return;

                  const parsedAmount = Number(foodAmount);
                  const safeAmount = Number.isFinite(parsedAmount) ? Math.max(1, parsedAmount) : 100;
                  const usda = (selectedProductForAmount.isUsda || selectedProductForAmount.isAiEstimated) ? selectedProductForAmount : undefined;

                  if (amountEntryContext?.source === 'barcode') {
                    // Штрихкод найден — сохраняем сразу, минуя «Проверьте результат»
                    await addFood(selectedProductForAmount.id, safeAmount, usda);
                    setIsBarcodeSheetOpen(false);
                  } else {
                    addToReviewDraft(selectedProductForAmount, safeAmount, usda);

                    if (amountEntryContext?.source === 'search') {
                      setIsSearchSheetOpen(false);
                      setSearchQuery('');
                      setSearchResults([]);
                    }

                    if (amountEntryContext?.source === 'photo') {
                      setIsPhotoSheetOpen(false);
                    }
                  }

                  setSelectedProductForAmount(null);
                  setAmountEntryContext(null);
                }}
                className="py-4 bg-emerald-500 text-white font-bold rounded-2xl shadow-lg shadow-emerald-500/20 active:scale-95 transition-transform"
              >
                {amountEntryContext?.source === 'barcode' ? 'Сохранить' : 'Добавить'}
              </button>
            </div>
          </div>
        )}
      </BottomSheet>

      {/* Проверьте результат — единый черновик перед сохранением (фото/голос/поиск) */}
      <BottomSheet
        isOpen={isReviewSheetOpen}
        onClose={discardReviewDraft}
        title="Проверьте результат"
      >
        <div className="space-y-5">
          {/* Приём пищи — можно поменять прямо здесь */}
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

          {/* Список продуктов в черновике */}
          {reviewItems.length === 0 ? (
            <p className="text-sm text-zinc-500 text-center py-6">Список пуст</p>
          ) : (
            <div className="space-y-2">
              {reviewItems.map((item, idx) => {
                const factor = item.amount / 100;
                const isEditing = reviewEditIndex === idx;
                return (
                  <div key={item.tempId} className="bg-zinc-800/50 border border-zinc-800 rounded-xl p-4">
                    <div className="flex items-center justify-between gap-3">
                      <button
                        onClick={() => {
                          if (isEditing) {
                            setReviewEditIndex(null);
                          } else {
                            setReviewEditIndex(idx);
                            setReviewEditAmount(String(item.amount));
                          }
                        }}
                        className="flex-1 min-w-0 text-left"
                      >
                        <p className="font-semibold text-zinc-200 truncate">{item.product.name}</p>
                        <p className="text-[11px] text-zinc-500 mt-0.5">
                          {Math.round(item.amount)} г · {Math.round(item.product.calories * factor)} ккал
                        </p>
                        <p className="text-[11px] text-zinc-500">
                          Б {Math.round(item.product.protein * factor)} · Ж {Math.round(item.product.fat * factor)} · У {Math.round(item.product.carbs * factor)}
                        </p>
                      </button>
                      <div className="flex items-center gap-2 shrink-0">
                        {item.product.recipeId && (
                          <button
                            onClick={() => openEditDishIngredients(item)}
                            className="p-2 bg-zinc-900 text-emerald-400 rounded-lg border border-zinc-700"
                            title="Состав блюда"
                          >
                            <ListChecks size={14} />
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setReviewEditIndex(isEditing ? null : idx);
                            setReviewEditAmount(String(item.amount));
                          }}
                          className="p-2 bg-zinc-900 text-zinc-400 rounded-lg border border-zinc-700"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => removeReviewItem(item.tempId)}
                          className="p-2 bg-zinc-900 text-red-400 rounded-lg border border-zinc-700"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    {isEditing && (
                      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-zinc-800">
                        <input
                          type="number"
                          autoFocus
                          value={reviewEditAmount}
                          onChange={(e) => setReviewEditAmount(e.target.value)}
                          className="flex-1 bg-zinc-900 border border-zinc-700 rounded-xl py-2 px-3 text-center text-zinc-100 font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                        />
                        <span className="text-xs text-zinc-500">г</span>
                        <button
                          onClick={() => updateReviewItemAmount(item.tempId, Math.max(1, Number(reviewEditAmount) || item.amount))}
                          className="px-4 py-2 bg-emerald-500 text-white text-xs font-bold rounded-lg"
                        >
                          Готово
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Добавить ещё продукт */}
          <button
            onClick={() => { setIsReviewSheetOpen(false); setIsSearchSheetOpen(true); }}
            className="w-full py-3 rounded-xl border border-dashed border-zinc-700 text-emerald-500 text-sm font-bold flex items-center justify-center gap-2"
          >
            <Plus size={16} />
            Добавить ещё продукт
          </button>

          {/* Итог записи */}
          <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-4">
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-xs font-bold text-zinc-400 uppercase tracking-wide">Итог записи</span>
              <span className="text-xl font-bold text-emerald-500">{Math.round(reviewTotals.calories)} ккал</span>
            </div>
            <p className="text-xs text-zinc-500">
              Б {Math.round(reviewTotals.protein)} г · Ж {Math.round(reviewTotals.fat)} г · У {Math.round(reviewTotals.carbs)} г
            </p>
          </div>

          <button
            onClick={saveReviewDraft}
            disabled={reviewItems.length === 0 || isSavingReview}
            className="w-full py-4 bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white font-bold rounded-2xl shadow-lg shadow-emerald-500/20 active:scale-95 transition-transform flex items-center justify-center gap-2"
          >
            {isSavingReview ? <Loader2 className="animate-spin" size={18} /> : null}
            Сохранить
          </button>
        </div>
      </BottomSheet>

      {/* Распознавание фото */}
      <BottomSheet isOpen={isPhotoSheetOpen} onClose={() => { setIsPhotoSheetOpen(false); setPhotoCorrectionTarget(null); }} title={photoCaptureMode === 'whole_dish' ? 'Фото блюда целиком' : 'Распознавание еды'}>
        {isRecognizing ? (
          <div className="flex flex-col items-center py-12">
            <Loader2 className="animate-spin text-emerald-500 mb-4" size={48} />
            <p className="text-zinc-400">AI анализирует ваше фото...</p>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-zinc-500 text-center uppercase tracking-[0.25em]">
              {photoCaptureMode === 'whole_dish' ? 'Режим оценки всей порции' : 'Режим распознавания ингредиентов'}
            </p>
            {photoRecognitionError && (
              <p className="text-sm text-orange-400 text-center">{photoRecognitionError}</p>
            )}
            {photoDishEstimate && (
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-emerald-400 uppercase tracking-[0.25em]">Блюдо целиком</p>
                    <p className="text-lg font-bold text-zinc-100 mt-1">{photoDishEstimate.name}</p>
                    <p className="text-[11px] text-zinc-400 mt-1">Порция около {Math.round(photoDishEstimate.amount)} г</p>
                  </div>
                  {typeof photoDishEstimate.confidence === 'number' && (
                    <span className="px-2 py-1 rounded-full bg-zinc-900/60 text-[10px] text-zinc-300 border border-white/5">
                      {Math.round(photoDishEstimate.confidence * 100)}%
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div className="rounded-xl bg-zinc-900/50 p-2">
                    <p className="text-[10px] text-zinc-500 uppercase">ккал</p>
                    <p className="text-sm font-bold text-zinc-100">{Math.round(photoDishEstimate.totalCalories)}</p>
                  </div>
                  <div className="rounded-xl bg-zinc-900/50 p-2">
                    <p className="text-[10px] text-zinc-500 uppercase">Б</p>
                    <p className="text-sm font-bold text-zinc-100">{Math.round(photoDishEstimate.totalProtein)}</p>
                  </div>
                  <div className="rounded-xl bg-zinc-900/50 p-2">
                    <p className="text-[10px] text-zinc-500 uppercase">Ж</p>
                    <p className="text-sm font-bold text-zinc-100">{Math.round(photoDishEstimate.totalFat)}</p>
                  </div>
                  <div className="rounded-xl bg-zinc-900/50 p-2">
                    <p className="text-[10px] text-zinc-500 uppercase">У</p>
                    <p className="text-sm font-bold text-zinc-100">{Math.round(photoDishEstimate.totalCarbs)}</p>
                  </div>
                </div>
                {photoDishEstimate.explanation && (
                  <p className="text-xs text-zinc-400 leading-relaxed">{photoDishEstimate.explanation}</p>
                )}
                <button
                  onClick={() => {
                    setSelectedProductForAmount(photoDishEstimate.product);
                    setFoodAmount(String(Math.max(1, Math.round(photoDishEstimate.amount || 100))));
                    setAmountEntryContext({ source: 'photo' });
                  }}
                  className="w-full py-3 bg-emerald-500 text-white text-sm font-bold rounded-xl"
                >
                  Добавить всё блюдо
                </button>
              </div>
            )}
            {recognizedItems.length === 0 && !photoDishEstimate && !photoRecognitionError && (
              <p className="text-sm text-zinc-500 text-center">Загрузите четкое фото еды, и я попробую распознать состав блюда.</p>
            )}
            {recognizedItems.map((item, i) => (
              <div key={i} className="bg-zinc-800/50 border border-zinc-800 rounded-xl p-4 flex justify-between items-center gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-zinc-200">{item.product?.name || item.name}</p>
                    {item.correctedByUser && (
                      <span className="px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 text-[8px] font-bold rounded uppercase tracking-tighter border border-emerald-500/20">
                        ИСПРАВЛЕНО
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Примерно {Math.round(item.amount)}г</p>
                  {item.product && item.product.name !== item.name && (
                    <p className="text-[10px] text-zinc-600 mt-1">AI увидел: {item.name}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => startPhotoCorrection(item, i)}
                    className="px-3 py-2 bg-zinc-900 text-zinc-300 text-[11px] font-bold rounded-lg border border-zinc-700"
                  >
                    Исправить
                  </button>
                  {item.product ? (
                    <button 
                      onClick={() => {
                        setSelectedProductForAmount(item.product || null);
                        setFoodAmount(String(Math.max(1, Math.round(item.amount || 100))));
                        setAmountEntryContext({ source: 'photo' });
                      }}
                      className="px-4 py-2 bg-emerald-500 text-white text-xs font-bold rounded-lg"
                    >
                      Добавить
                    </button>
                  ) : (
                    <span className="text-[10px] text-zinc-600 italic">Не в базе</span>
                  )}
                </div>
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
            <div className="absolute inset-x-0 top-1/2 h-0.5 bg-emerald-500 shadow-[0_0_10px_rgba(0,115,112,0.8)] animate-pulse z-20" />
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

          {voiceTranscript && !isParsingVoice && (
            <button
              onClick={() => {
                if (isListening) stopListening();
                handleVoiceParse();
              }}
              className="w-full py-4 bg-emerald-500 text-white font-bold rounded-2xl mb-6 shadow-lg shadow-emerald-500/20 active:scale-95 transition-transform"
            >
              Готово
            </button>
          )}

          {isParsingVoice && (
            <div className="flex flex-col items-center py-4">
              <Loader2 className="animate-spin text-emerald-500 mb-2" size={32} />
              <p className="text-zinc-400 text-sm">AI разбирает ваш рацион...</p>
            </div>
          )}
        </div>
      </BottomSheet>
    </div>
  );
}