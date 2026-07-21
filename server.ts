import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import cookieParser from "cookie-parser";
import crypto from "node:crypto";
import dns from "node:dns";
import net from "node:net";
import path from "path";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";
import multer from "multer";
import { GoogleGenAI, Type } from "@google/genai";
import Levenshtein from "fast-levenshtein";
import OpenAI from "openai";
import { ProxyAgent } from "undici";
import bcrypt from "bcryptjs";
import { ZipArchive } from "archiver";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import {
  validateBody,
  aiGenerateSchema,
  sendMessageSchema,
  customProductSchema,
  recipeSchema,
  recipeImportUrlSchema,
  photoRecognizeSchema,
  photoCorrectionSchema,
  recognitionCorrectionSchema,
  diaryGoalsSchema,
  diaryWaterSchema,
  activitySchema,
  weightSchema,
  diaryAddSchema,
  diaryItemAmountSchema,
  quickAddSchema,
  voiceParseSchema,
  changePasswordSchema,
  clientCrashSchema,
} from "./validation.ts";
import { registerCrmRoutes, getBlockerContactInfo } from "./crm-routes.ts";
import { registerTelegramBot } from "./telegram-bot.ts";
import { logError, reportClientCrash } from "./logging.ts";
import { resolveCookieSecret } from "./cookie-secret.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const prisma = new PrismaClient();
const upload = multer({ storage: multer.memoryStorage() });

// AI Clients
const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL?.trim();
const OPENAI_PROXY_URL = process.env.OPENAI_PROXY_URL?.trim()
  || process.env.HTTPS_PROXY?.trim()
  || process.env.HTTP_PROXY?.trim();
const openaiProxyAgent = OPENAI_PROXY_URL ? new ProxyAgent(OPENAI_PROXY_URL) : null;
const openaiFetch = (url: RequestInfo | URL, init?: RequestInit) => {
  if (!openaiProxyAgent) return fetch(url, init);
  return fetch(url, { ...(init || {}), dispatcher: openaiProxyAgent as any } as any);
};
const deepseek = process.env.DEEPSEEK_API_KEY ? new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com"
}) : null;
const openai = process.env.OPENAI_API_KEY ? new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: OPENAI_BASE_URL || undefined,
  organization: process.env.OPENAI_ORG || undefined,
  project: process.env.OPENAI_PROJECT || undefined,
  fetch: openaiFetch,
}) : null;
const OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL || "gpt-4o-mini";
const recognitionCorrectionDelegate = (prisma as any).recognitionCorrection;

function isDatabaseConfigured() {
  return typeof process.env.DATABASE_URL === "string" && process.env.DATABASE_URL.trim().length > 0;
}

const DEMO_USER_ID = "demo-user";
const DEMO_USER = { id: DEMO_USER_ID, email: "user@nutria.app", role: "USER" };
const DEMO_GOALS = { calories: 2100, protein: 120, fat: 70, carbs: 250, fiber: 30 };
type InMemoryDiaryState = {
  meals: any[];
  goals: typeof DEMO_GOALS;
  waterByDate: Record<string, number>;
};
type InMemoryRecognitionCorrection = {
  sourceName: string;
  normalizedSource: string;
  aliases: string[];
  visibleText: string[];
  correctedProduct: any;
  usageCount: number;
  lastUsedAt: number;
};
type PhotoRecognitionMode = "ingredients" | "whole_dish";
const inMemoryDiary = new Map<string, InMemoryDiaryState>();
const inMemoryRecognitionCorrections = new Map<string, InMemoryRecognitionCorrection[]>();
const barcodeLookupCache = new Map<string, { expiresAt: number; product: any }>();
const productSearchCache = new Map<string, { expiresAt: number; results: any[] }>();
// "Недавние" / "Мои" (продукты и блюда) — память для режима без БД
const inMemoryRecent = new Map<string, any[]>();
const inMemoryCustomProducts = new Map<string, any[]>();
const inMemoryRecipes = new Map<string, any[]>();
const inMemoryActivities = new Map<string, any[]>();
const inMemoryWeightLogs = new Map<string, Map<string, number>>();

const BARCODE_PREFERRED_COUNTRY = (process.env.BARCODE_PREFERRED_COUNTRY || "ru").toLowerCase();
const BARCODE_PREFERRED_LANG = (process.env.BARCODE_PREFERRED_LANG || "ru").toLowerCase();
const BARCODE_LOOKUP_TIMEOUT_MS = Number(process.env.BARCODE_LOOKUP_TIMEOUT_MS || 3500);
const BARCODE_CACHE_TTL_MS = Number(process.env.BARCODE_CACHE_TTL_MS || 1000 * 60 * 60 * 6);
const PRODUCT_SEARCH_CACHE_TTL_MS = Number(process.env.PRODUCT_SEARCH_CACHE_TTL_MS || 1000 * 60 * 10);
const PRODUCT_SEARCH_CACHE_MAX_ENTRIES = Number(process.env.PRODUCT_SEARCH_CACHE_MAX_ENTRIES || 500);
const RU_LOCALIZATION_CACHE_TTL_MS = Number(process.env.RU_LOCALIZATION_CACHE_TTL_MS || 1000 * 60 * 60 * 24 * 14);
const ruLocalizationCache = new Map<string, { expiresAt: number; value: string }>();
const CYRILLIC_RE = /[А-Яа-яЁё]/;
// Защита от повторных параллельных AI-запросов на докомплектацию микроэлементов одного и того же продукта
let micronutrientQueueWorkerRunning = false;
export const NUTRIA_API_CONTRACT_VERSION = 1;

function normalizedNutritionSource(source: any) {
  const value = String(source || "").trim().toLowerCase();
  if (value.startsWith("usda")) return "usda_fdc";
  if (value === "openfoodfacts") return "open_food_facts";
  if (value === "ai" || value === "ai_estimate") return "ai_estimate";
  if (value === "user" || value === "quickadd") return "user_entered";
  if (value === "recipe") return "recipe_calculation";
  return "nutria_catalog";
}

function hasUsefulContractGroup(group: any) {
  return Boolean(group && typeof group === "object" && Object.values(group).some((value) => numberOrZero(value) > 0));
}

export function withNutritionContract(product: any) {
  if (!product || typeof product !== "object") return product;
  const source = normalizedNutritionSource(product.source);
  const rawMicronutrients = parseMicronutrients(product.micronutrients || product);
  const micronutrients = buildCompleteMicronutrients(rawMicronutrients, product.fiber);
  const storedSources = rawMicronutrients?.nutrientSources || {};
  const nutrientSources: Record<string, string> = { macros: source };
  for (const group of ["vitamins", "minerals", "aminoAcids", "fattyAcids", "carbohydrateTypes"]) {
    if (hasUsefulContractGroup(micronutrients[group])) {
      nutrientSources[group] = String(storedSources[group] || source);
    }
  }
  return {
    ...product,
    contractVersion: NUTRIA_API_CONTRACT_VERSION,
    nutrientSources,
  };
}

export function restoreExactCatalogMatch(query: string, scoredCandidates: any[], rankedCandidates: any[]) {
  const normalizedQuery = normalizeComparableText(query);
  const exactCatalogMatch = scoredCandidates.find((candidate) => {
    const normalizedCandidate = normalizeComparableText(candidate.name);
    return candidate.source === "local"
      && normalizedQuery.length >= 3
      && normalizedCandidate.includes(normalizedQuery)
      && numberOrZero(candidate.matchScore) >= 0.6;
  });
  if (!exactCatalogMatch) return rankedCandidates;
  return [
    exactCatalogMatch,
    ...rankedCandidates.filter((candidate) => candidate.id !== exactCatalogMatch.id),
  ];
}

export function parseProductSearchPagination(offsetValue: unknown, limitValue: unknown) {
  return {
    offset: Math.max(0, Math.min(40, Number(offsetValue) || 0)),
    limit: Math.max(1, Math.min(10, Number(limitValue) || 10)),
  };
}

function getOrCreateInMemoryDiary(userId: string) {
  if (!inMemoryDiary.has(userId)) {
    inMemoryDiary.set(userId, { meals: [], goals: { ...DEMO_GOALS }, waterByDate: {} });
  }
  return inMemoryDiary.get(userId)!;
}

function getOrCreateInMemoryRecognitionCorrections(userId: string) {
  if (!inMemoryRecognitionCorrections.has(userId)) {
    inMemoryRecognitionCorrections.set(userId, []);
  }
  return inMemoryRecognitionCorrections.get(userId)!;
}

function getOrCreateInMemoryRecent(userId: string) {
  if (!inMemoryRecent.has(userId)) inMemoryRecent.set(userId, []);
  return inMemoryRecent.get(userId)!;
}

function getOrCreateInMemoryCustomProducts(userId: string) {
  if (!inMemoryCustomProducts.has(userId)) inMemoryCustomProducts.set(userId, []);
  return inMemoryCustomProducts.get(userId)!;
}

function getOrCreateInMemoryRecipes(userId: string) {
  if (!inMemoryRecipes.has(userId)) inMemoryRecipes.set(userId, []);
  return inMemoryRecipes.get(userId)!;
}

function getOrCreateInMemoryActivities(userId: string) {
  if (!inMemoryActivities.has(userId)) inMemoryActivities.set(userId, []);
  return inMemoryActivities.get(userId)!;
}

function getOrCreateInMemoryWeightLogs(userId: string) {
  if (!inMemoryWeightLogs.has(userId)) inMemoryWeightLogs.set(userId, new Map());
  return inMemoryWeightLogs.get(userId)!;
}

// Запомнить продукт как "недавний" (используется после успешного /api/diary/add)
function touchInMemoryRecent(userId: string, product: any, weightGrams: number) {
  const list = getOrCreateInMemoryRecent(userId);
  const existing = list.find((r: any) => r.productId === product.id);
  if (existing) {
    existing.useCount += 1;
    existing.lastUsedAt = Date.now();
    existing.lastWeightGrams = weightGrams;
    existing.product = product;
  } else {
    list.unshift({
      id: `recent-${product.id}`,
      productId: product.id,
      product,
      useCount: 1,
      lastUsedAt: Date.now(),
      lastWeightGrams: weightGrams
    });
  }
}

async function touchRecentFood(userId: string, productId: string, weightGrams: number) {
  await prisma.recentFood.upsert({
    where: { userId_productId: { userId, productId } },
    update: { lastWeightGrams: weightGrams, lastUsedAt: new Date(), useCount: { increment: 1 } },
    create: { userId, productId, lastWeightGrams: weightGrams }
  });
}

function toDateKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function dateFromQuery(value: any) {
  const raw = String(value || "").trim();
  if (!raw) return new Date();
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function dayRangeFromDate(base: Date) {
  const start = new Date(base);
  start.setHours(0, 0, 0, 0);
  const end = new Date(base);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function getMealDateKey(meal: any) {
  const explicit = String(meal?.dateKey || "").trim();
  if (explicit) return explicit;
  const id = String(meal?.id || "");
  const match = id.match(/(\d{4}-\d{2}-\d{2})$/);
  return match ? match[1] : "";
}

function extractBarcodeCandidates(input: string) {
  const raw = String(input || "").trim();
  if (!raw) return [] as string[];

  const candidates = new Set<string>();
  candidates.add(raw);

  try {
    const url = new URL(raw);
    const queryKeys = ["barcode", "code", "ean", "ean13", "upc", "gtin", "id"];
    for (const key of queryKeys) {
      const value = url.searchParams.get(key);
      if (value) candidates.add(value.trim());
    }
    for (const part of url.pathname.split("/").map((p) => p.trim()).filter(Boolean)) {
      if (part.length >= 6) candidates.add(part);
    }
  } catch {
    // not a URL
  }

  const digitGroups = raw.match(/\d{8,14}/g) || [];
  digitGroups.forEach((group) => candidates.add(group));

  const digitsOnly = raw.replace(/\D/g, "");
  if (digitsOnly.length >= 8) candidates.add(digitsOnly);

  return Array.from(candidates).map((v) => v.trim()).filter(Boolean);
}

function parseAiJsonPayload(text: string) {
  const cleaned = String(text || "").trim();
  if (!cleaned) return [] as any[];

  const withoutFences = cleaned
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(withoutFences);
  } catch {
    const objectStart = withoutFences.indexOf("{");
    const objectEnd = withoutFences.lastIndexOf("}");
    const arrayStart = withoutFences.indexOf("[");
    const arrayEnd = withoutFences.lastIndexOf("]");

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
}

// Ищет JSON-LD блок schema.org/Recipe на странице рецепта (большинство крупных
// кулинарных сайтов размечают рецепты именно так — AllRecipes, BBC GoodFood и т.д.).
// Поддерживает как одиночный объект/массив, так и обёртку @graph.
function extractRecipeJsonLd(html: string): any | null {
  const scriptRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const candidates: any[] = [];
  let match: RegExpExecArray | null;
  while ((match = scriptRegex.exec(html))) {
    const raw = match[1].trim();
    if (!raw) continue;
    try {
      candidates.push(JSON.parse(raw));
    } catch {
      // пропускаем некорректный JSON-LD блок
    }
  }

  const flatten = (node: any): any[] => {
    if (!node) return [];
    if (Array.isArray(node)) return node.flatMap(flatten);
    if (Array.isArray(node["@graph"])) return node["@graph"].flatMap(flatten);
    return [node];
  };

  const isRecipeType = (node: any) => {
    const type = node?.["@type"];
    if (!type) return false;
    return Array.isArray(type) ? type.includes("Recipe") : type === "Recipe";
  };

  for (const candidate of candidates) {
    const recipe = flatten(candidate).find(isRecipeType);
    if (recipe) return recipe;
  }
  return null;
}

export function unwrapAiItemsArray(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];

  for (const key of ["items", "ingredients", "products", "components", "results", "indices", "order", "ranking"]) {
    if (Array.isArray(payload[key])) return payload[key];
  }

  const arrayValues = Object.values(payload).filter((value) => Array.isArray(value));
  return arrayValues.length === 1 ? (arrayValues[0] as any[]) : [];
}

function clampNumber(value: any, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeComparableText(value: any) {
  return String(value || "")
    .toLowerCase()
    .replace(/[.,;:!?'"`~()\[\]{}<>/\\|_+-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textTokenSet(value: any) {
  return new Set(
    normalizeComparableText(value)
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length > 1)
  );
}

export function computeTextSimilarity(left: any, right: any) {
  const a = normalizeComparableText(left);
  const b = normalizeComparableText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const maxLen = Math.max(a.length, b.length);
  const charSimilarity = maxLen > 0 ? 1 - (Levenshtein.get(a, b) / maxLen) : 0;

  const leftTokens = textTokenSet(a);
  const rightTokens = textTokenSet(b);
  // Совпадение токенов с учётом основы слова: "креветка" и "креветки" — это один
  // токен по смыслу (единственное/множественное число), но как строки они разные,
  // и без стемминга их пересечение было бы нулевым (см. stemRussianToken). Считаем
  // токен совпавшим при точном совпадении ИЛИ при совпадении основ.
  const rightStems = new Set(Array.from(rightTokens).map((token) => stemRussianToken(token) || token));
  const overlap = Array.from(leftTokens).filter(
    (token) => rightTokens.has(token) || rightStems.has(stemRussianToken(token) || token)
  ).length;
  const tokenSimilarity = overlap / Math.max(leftTokens.size, rightTokens.size, 1);
  const containsBoost = a.includes(b) || b.includes(a) ? 0.15 : 0;

  return Math.max(0, Math.min(1, charSimilarity * 0.55 + tokenSimilarity * 0.45 + containsBoost));
}

const FOOD_CATEGORY_CONFLICTS: Record<string, string[]> = {
  "рис": ["мука", "лапша", "хлеб", "крекер"],
  "rice": ["flour", "noodle", "bread", "cracker"],
  "овсян": ["свинин", "бекон"],
  "oat": ["pork", "bacon"],
  "молок": ["просо"],
  "milk": ["millet"],
};

export function isLexicallyCompatibleFood(query: any, candidateName: any) {
  const queryTokens = Array.from(textTokenSet(query));
  const candidateTokens = Array.from(textTokenSet(candidateName));
  if (!queryTokens.length || !candidateTokens.length) return false;
  const queryStems = queryTokens.map((token) => stemRussianToken(token) || token);
  const candidateStems = candidateTokens.map((token) => stemRussianToken(token) || token);
  const hasOverlap = queryStems.some((queryStem) => candidateStems.some((candidateStem) =>
    queryStem === candidateStem || queryStem.startsWith(candidateStem) || candidateStem.startsWith(queryStem)
  ));
  const hasConflict = Object.entries(FOOD_CATEGORY_CONFLICTS).some(([queryPart, conflicts]) =>
    queryStems.some((token) => token.startsWith(queryPart) || queryPart.startsWith(token))
      // Двунаправленно: основа кандидата может быть короче конфликтного слова
      // ("мук" от "мука" после стемминга), поэтому сверяем startsWith в обе стороны.
      && candidateStems.some((token) => conflicts.some((conflict) => token.startsWith(conflict) || conflict.startsWith(token)))
  );
  return !hasConflict && (hasOverlap || computeTextSimilarity(query, candidateName) >= 0.6);
}

// Лёгкий морфологический стемминг для русских слов. SQL contains — это точное
// вхождение подстроки, поэтому запрос "креветка" не находит базовый продукт
// "Креветки": у слов разные окончания (-а / -и), и одно не является подстрокой
// другого. Отрезаем частое словоизменительное окончание, получая основу
// ("креветк"), которая как contains-терм ловит все формы (креветка, креветки,
// креветок...). Это не полноценный стеммер (нет словаря, возможна лёгкая
// пере/недорезка) — задача только связать единственное/множественное число и
// падежи в предфильтре; итоговую релевантность всё равно определяет скоринг ниже.
// Окончания перечислены от длинных к коротким, чтобы отрезалось самое длинное
// подходящее; основа никогда не короче 4 символов, иначе матч станет слишком общим.
const RUSSIAN_STEM_ENDINGS = [
  "иями",
  "ями", "ами", "ого", "его", "ому", "ему", "ыми", "ими",
  "ов", "ев", "ей", "ах", "ях", "ам", "ям", "ом", "ем",
  "ий", "ый", "ой", "ая", "яя", "ое", "ее", "ые", "ие",
  "а", "я", "ы", "и", "у", "ю", "е", "о", "ь", "й",
];

export function stemRussianToken(token: string): string | null {
  const value = String(token || "").toLowerCase().trim();
  // Порог 4 (а не 5): короткие формы множественного числа тоже должны находить
  // единственное — "яйца"→"яйц"↔"яйцо"→"яйц", "рыбы"→"рыб"↔"рыба"→"рыб". Основа не
  // короче 3 символов (иначе матч слишком общий).
  if (value.length < 4 || !/[а-яё]/.test(value)) return null;

  // Беглая гласная: у слов на -ец/-ок/-ек и т.п. гласная (е/о) выпадает в других
  // формах ("огурец"→"огурцы", "кусок"→"куски"). Отдаём основу без беглой гласной,
  // чтобы форма с гласной и без неё сходились: "огурец"→"огурц"↔"огурцы"→"огурц".
  const fleeting = value.match(/^(.{2,})[ео]([цкн])$/);
  if (fleeting && fleeting[1].length + 1 >= 3) {
    return fleeting[1] + fleeting[2];
  }

  for (const ending of RUSSIAN_STEM_ENDINGS) {
    if (value.length - ending.length >= 3 && value.endsWith(ending)) {
      return value.slice(0, value.length - ending.length);
    }
  }
  return null;
}

// Базовый/каноничный продукт из нашего каталога — без бренда конкретной фирмы
// (seed помечает такие brand: "Базовый продукт"). У них обычно полные нутриенты, и
// команда просит показывать их выше фирменных вариантов того же продукта.
export function isBaseProductCandidate(candidate: any): boolean {
  if (!candidate) return false;
  const source = String(candidate.source || "");
  if (source && source !== "local" && source !== "catalog") return false; // не USDA/AI
  const brandText = String(candidate.brand || "").trim().toLowerCase();
  return brandText === "" || brandText === "базовый продукт";
}

// Единая проверка правдоподобия КБЖУ на 100 г. До этого физической проверки не было ни
// на одном AI-пути, из-за чего проходили невозможные значения (реальный баг: "4 блинчика
// с творогом" → 1295 ккал / 150 г = 8.6 ккал/г, что выше чистого жира 9 ккал/г). Проверяем:
//  - сумма Б+Ж+У ≤ ~100 г на 100 г продукта (физический предел, +допуск на погрешность);
//  - калорийность ≤ ~9 ккал/г (плотность не выше чистого жира);
//  - согласованность с Атуотером (ккал ≈ 4·Б + 4·У + 9·Ж), расхождение > 30% подозрительно.
// Если по макросам всё нормально, а расходится только заявленная калорийность — предлагаем
// исправленное значение по Атуотеру (correctedCalories), это надёжнее «на глаз».
export function validateNutritionPer100g(n: {
  calories?: number; protein?: number; fat?: number; carbs?: number;
}): { plausible: boolean; needsReview: boolean; reasons: string[]; correctedCalories?: number } {
  const calories = numberOrZero(n.calories);
  const protein = numberOrZero(n.protein);
  const fat = numberOrZero(n.fat);
  const carbs = numberOrZero(n.carbs);
  const macroSum = protein + fat + carbs;
  const atwater = protein * 4 + carbs * 4 + fat * 9;
  const reasons: string[] = [];
  if (macroSum > 105) reasons.push("macro-sum>105g/100g");
  if (macroSum <= 0 && calories <= 0) reasons.push("all-zero");
  if (calories > 902) reasons.push("kcal>9/g (выше чистого жира)");
  const kcalMismatch = atwater > 0 && calories > 0 && Math.abs(calories - atwater) / atwater > 0.3;
  if (kcalMismatch) reasons.push("kcal-vs-atwater>30%");
  // Если макросы правдоподобны, а калорийность им противоречит — доверяем Атуотеру.
  const correctedCalories = kcalMismatch && macroSum > 0 && macroSum <= 105 ? Math.round(atwater) : undefined;
  return { plausible: reasons.length === 0, needsReview: reasons.length > 0, reasons, correctedCalories };
}

function uniqueStrings(values: any[], minLength: number = 1) {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const normalized = String(value || "").trim();
    const key = normalized.toLowerCase();
    if (!normalized || normalized.length < minLength || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function parseJsonStringArray(value: any) {
  if (!value) return [] as string[];
  if (Array.isArray(value)) return uniqueStrings(value, 1);
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? uniqueStrings(parsed, 1) : [];
  } catch {
    return [] as string[];
  }
}

// SSRF-защита для /api/recipes/import-url: без неё сервер можно заставить обратиться
// к внутренней сети (127.0.0.1, 169.254.169.254 — метаданные облака, 10/8, 172.16/12,
// 192.168/16 и т.п.) просто передав такой URL. Резолвим hostname и проверяем все
// полученные адреса. Не защищает от DNS-rebinding (адрес может смениться между этой
// проверкой и самим fetch) — для recipe-импорта (не платёжный/админский путь) это
// приемлемый компромисс, а не полноценная защита уровня прод-периметра.
function isPrivateOrReservedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;
    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local, включая метаданные облака
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a === 0) return true; // "this network"
    if (a >= 224) return true; // multicast/reserved
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === "::1") return true; // loopback
    if (lower.startsWith("fe80:") || lower.startsWith("::ffff:127.")) return true; // link-local / mapped loopback
    if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true; // unique local (fc00::/7)
    return false;
  }
  return true; // не распознали формат — считаем небезопасным
}

async function assertPublicHostname(hostname: string): Promise<void> {
  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) throw new Error("Ссылка указывает на внутренний адрес");
    return;
  }
  if (hostname === "localhost") throw new Error("Ссылка указывает на внутренний адрес");
  const addresses = await dns.promises.lookup(hostname, { all: true });
  if (addresses.length === 0) throw new Error("Не удалось разрешить адрес");
  for (const { address } of addresses) {
    if (isPrivateOrReservedIp(address)) throw new Error("Ссылка указывает на внутренний адрес");
  }
}

function isGeneratedProductId(productId: string) {
  const raw = String(productId || "");
  return raw.startsWith("usda-") || raw.startsWith("ai-est-") || raw.startsWith("ai-dish-");
}

async function ensureProductExistsLocally(productId: string, productData?: any) {
  const normalizedProductId = String(productId || "").trim();
  if (!normalizedProductId && !productData) return null;

  if (!isDatabaseConfigured()) {
    return productData || null;
  }

  if (!isGeneratedProductId(normalizedProductId)) {
    const existing = await prisma.product.findUnique({ where: { id: normalizedProductId } }).catch(() => null);
    return existing || productData || null;
  }

  if (!productData) return null;

  const localizedData = await localizeProductForRussianAudience(productData);
  const completeMicro = buildCompleteMicronutrients(localizedData, localizedData.fiber);

  let product = await prisma.product.findFirst({
    where: { name: localizedData.name, brand: localizedData.brand }
  });

  if (!product) {
    try {
      product = await prisma.product.create({
        data: {
          name: localizedData.name,
          brand: localizedData.brand,
          calories: numberOrZero(localizedData.calories),
          protein: numberOrZero(localizedData.protein),
          fat: numberOrZero(localizedData.fat),
          carbs: numberOrZero(localizedData.carbs),
          fiber: numberOrZero(localizedData.fiber),
          micronutrients: JSON.stringify(completeMicro)
        }
      });
    } catch (e: any) {
      // Гонка: два параллельных запроса одновременно решили один и тот же AI/USDA-продукт
      // (например, двойной тап "добавить") — оба прошли findFirst до появления строки, и
      // второй create падает на @@unique([name, brand]). Вместо падения всего запроса
      // (и зависшего /api/diary/add без try/catch выше по цепочке) — просто берём уже
      // созданную конкурентом строку.
      if (e?.code === "P2002") {
        product = await prisma.product.findFirst({ where: { name: localizedData.name, brand: localizedData.brand } });
        if (!product) throw e;
      } else {
        throw e;
      }
    }
  }
  if (product && (!product.micronutrients || product.micronutrients === '{}' || shouldRefreshMicronutrients(product.micronutrients, localizedData))) {
    product = await prisma.product.update({
      where: { id: product.id },
      data: {
        micronutrients: JSON.stringify(completeMicro)
      }
    });
  }

  return product;
}

export function buildDishEstimateProduct(dishEstimate: any) {
  if (!dishEstimate || typeof dishEstimate !== "object") return null;

  const amount = clampNumber(dishEstimate.amount ?? dishEstimate.totalWeight ?? dishEstimate.portionGrams, 1, 5000, 350);
  const factor = amount / 100;
  const calories = numberOrZero(dishEstimate.totalCalories ?? dishEstimate.calories);
  const protein = numberOrZero(dishEstimate.totalProtein ?? dishEstimate.protein);
  const fat = numberOrZero(dishEstimate.totalFat ?? dishEstimate.fat);
  const carbs = numberOrZero(dishEstimate.totalCarbs ?? dishEstimate.carbs);
  const fiber = numberOrZero(dishEstimate.totalFiber ?? dishEstimate.fiber);

  if (!amount || (!calories && !protein && !fat && !carbs)) return null;

  // Приводим к 100 г и проверяем правдоподобие уже на этой базе (плотность ≤ 9 ккал/г,
  // сумма Б+Ж+У ≤ 100 г, Атуотер). Это тот самый путь, где AI отдаёт «всю порцию»
  // числом и деление могло дать физически невозможную плотность (класс «1295/150 г»).
  const per100 = {
    calories: factor > 0 ? calories / factor : 0,
    protein: factor > 0 ? protein / factor : 0,
    fat: factor > 0 ? fat / factor : 0,
    carbs: factor > 0 ? carbs / factor : 0,
    fiber: factor > 0 ? fiber / factor : 0,
  };
  const check = validateNutritionPer100g(per100);

  return {
    name: String(dishEstimate.name || "Блюдо по фото").trim() || "Блюдо по фото",
    brand: "AI Dish Estimate",
    calories: check.correctedCalories ?? per100.calories,
    protein: per100.protein,
    fat: per100.fat,
    carbs: per100.carbs,
    fiber: per100.fiber,
    vitamins: dishEstimate.vitamins || {},
    minerals: dishEstimate.minerals || {},
    aminoAcids: dishEstimate.aminoAcids || {},
    fattyAcids: dishEstimate.fattyAcids || {},
    carbohydrateTypes: dishEstimate.carbohydrateTypes || {},
    isAiEstimated: true,
    needsReview: check.needsReview,
    explanation: String(dishEstimate.explanation || "").trim(),
  };
}

async function getRecognitionCorrections(userId: string) {
  const memory = getOrCreateInMemoryRecognitionCorrections(userId);
  let dbCorrections: any[] = [];

  if (isDatabaseConfigured()) {
    try {
      dbCorrections = await recognitionCorrectionDelegate.findMany({
        where: { userId },
        include: { correctedProduct: true },
        orderBy: [{ usageCount: "desc" }, { updatedAt: "desc" }],
        take: 100,
      });
    } catch (e) {
      console.warn("Recognition correction table unavailable, using memory fallback:", e);
    }
  }

  const mappedDbCorrections = dbCorrections.map((entry) => ({
    sourceName: entry.sourceName,
    normalizedSource: entry.normalizedSource,
    aliases: parseJsonStringArray(entry.aliasesJson),
    visibleText: parseJsonStringArray(entry.visibleTextJson),
    correctedProduct: entry.correctedProduct,
    usageCount: numberOrZero(entry.usageCount),
    lastUsedAt: new Date(entry.lastUsedAt).getTime(),
  }));

  return [...mappedDbCorrections, ...memory];
}

async function saveRecognitionCorrection(params: {
  userId: string;
  sourceName: string;
  aliases?: string[];
  visibleText?: string[];
  correctedProductId: string;
  correctedProduct?: any;
}) {
  const userId = String(params.userId || "").trim();
  const sourceName = String(params.sourceName || "").trim();
  if (!userId || !sourceName) throw new Error("Correction payload is incomplete");

  const aliases = uniqueStrings(params.aliases || [], 1);
  const visibleText = uniqueStrings(params.visibleText || [], 1);
  const normalizedSource = normalizeComparableText(sourceName);
  const resolvedProduct = await ensureProductExistsLocally(params.correctedProductId, params.correctedProduct);

  if (!resolvedProduct) {
    throw new Error("Corrected product could not be resolved");
  }

  const memoryCorrections = getOrCreateInMemoryRecognitionCorrections(userId);
  const memoryIndex = memoryCorrections.findIndex((entry) =>
    entry.normalizedSource === normalizedSource && entry.correctedProduct?.id === resolvedProduct.id
  );

  if (memoryIndex >= 0) {
    memoryCorrections[memoryIndex] = {
      ...memoryCorrections[memoryIndex],
      aliases: uniqueStrings([...(memoryCorrections[memoryIndex].aliases || []), ...aliases], 1),
      visibleText: uniqueStrings([...(memoryCorrections[memoryIndex].visibleText || []), ...visibleText], 1),
      correctedProduct: resolvedProduct,
      usageCount: numberOrZero(memoryCorrections[memoryIndex].usageCount) + 1,
      lastUsedAt: Date.now(),
    };
  } else {
    memoryCorrections.unshift({
      sourceName,
      normalizedSource,
      aliases,
      visibleText,
      correctedProduct: resolvedProduct,
      usageCount: 1,
      lastUsedAt: Date.now(),
    });
  }

  if (isDatabaseConfigured()) {
    try {
      await recognitionCorrectionDelegate.upsert({
        where: {
          userId_normalizedSource_correctedProductId: {
            userId,
            normalizedSource,
            correctedProductId: resolvedProduct.id,
          },
        },
        update: {
          sourceName,
          aliasesJson: JSON.stringify(uniqueStrings([...(memoryCorrections[memoryIndex]?.aliases || []), ...aliases], 1)),
          visibleTextJson: JSON.stringify(uniqueStrings([...(memoryCorrections[memoryIndex]?.visibleText || []), ...visibleText], 1)),
          usageCount: { increment: 1 },
          lastUsedAt: new Date(),
        },
        create: {
          userId,
          sourceName,
          normalizedSource,
          aliasesJson: JSON.stringify(aliases),
          visibleTextJson: JSON.stringify(visibleText),
          correctedProductId: resolvedProduct.id,
        },
      });
    } catch (e) {
      console.warn("Failed to persist recognition correction in database:", e);
    }
  }

  return resolvedProduct;
}

async function findRecognitionCorrectionMatch(userId: string | null | undefined, item: PhotoRecognitionItem) {
  const normalizedName = normalizeComparableText(item.name);
  if (!userId || !normalizedName) return null;

  const corrections = await getRecognitionCorrections(userId);
  let bestCorrection: any = null;

  for (const correction of corrections) {
    const candidateTexts = uniqueStrings([
      correction.sourceName,
      ...(correction.aliases || []),
      ...(correction.visibleText || []),
    ], 1);
    const itemTexts = uniqueStrings([
      item.name,
      ...(item.aliases || []),
      ...(item.searchHints || []),
      ...(item.visibleText || []),
    ], 1);

    let bestSimilarity = 0;
    for (const itemText of itemTexts) {
      for (const candidateText of candidateTexts) {
        bestSimilarity = Math.max(bestSimilarity, computeTextSimilarity(itemText, candidateText));
      }
    }

    const exactBoost = correction.normalizedSource === normalizedName ? 0.2 : 0;
    const score = Math.max(0, Math.min(1, bestSimilarity + exactBoost + Math.min(0.12, numberOrZero(correction.usageCount) * 0.02)));

    if (!bestCorrection || score > numberOrZero(bestCorrection.score)) {
      bestCorrection = { ...correction, score };
    }
  }

  if (bestCorrection && numberOrZero(bestCorrection.score) >= 0.78 && bestCorrection.correctedProduct) {
    return bestCorrection;
  }

  return null;
}

type ProductSearchOptions = {
  limit?: number;
  cache?: boolean;
  localize?: boolean;
  allowAiEstimate?: boolean;
  // Skips the AI query-normalization, USDA lookup and AI re-ranking round trips.
  // Use when the input is already a clean canonical name (e.g. produced by another
  // AI step) and low latency matters more than maximal recall.
  fast?: boolean;
};

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

type PhotoRecognitionItem = {
  name: string;
  amount: number;
  aliases: string[];
  searchHints: string[];
  visibleText: string[];
  barcodeCandidates: string[];
  confidence?: number;
  isPackaged?: boolean;
};

function normalizePhotoRecognitionItem(item: any): PhotoRecognitionItem | null {
  const name = String(item?.name || item?.food || item?.product || item?.dish || "").trim();
  if (!name) return null;

  const amount = clampNumber(item?.amount ?? item?.grams ?? item?.weight ?? 100, 1, 5000, 100);
  const aliases = uniqueStrings(Array.isArray(item?.aliases) ? item.aliases : [], 2);
  const searchHints = uniqueStrings(Array.isArray(item?.searchHints) ? item.searchHints : [], 2);
  const visibleText = uniqueStrings(Array.isArray(item?.visibleText) ? item.visibleText : [], 2);
  const rawBarcodes = Array.isArray(item?.barcodeCandidates)
    ? item.barcodeCandidates
    : (String(item?.barcode || "").trim() ? [String(item.barcode).trim()] : []);
  const barcodeCandidates = uniqueStrings(rawBarcodes.flatMap((value: string) => extractBarcodeCandidates(value)), 8);
  const confidence = Number.isFinite(Number(item?.confidence))
    ? clampNumber(item.confidence, 0, 1, 0.5)
    : undefined;

  return {
    name,
    amount,
    aliases,
    searchHints,
    visibleText,
    barcodeCandidates,
    confidence,
    isPackaged: Boolean(item?.isPackaged),
  };
}

function dedupePhotoRecognitionItems(items: PhotoRecognitionItem[]) {
  const deduplicatedMap = new Map<string, PhotoRecognitionItem>();

  for (const item of items) {
    const key = normalizeComparableText(item.name);
    const existing = deduplicatedMap.get(key);

    if (!existing) {
      deduplicatedMap.set(key, { ...item });
      continue;
    }

    existing.amount += item.amount;
    existing.aliases = uniqueStrings([...(existing.aliases || []), ...(item.aliases || [])], 2);
    existing.searchHints = uniqueStrings([...(existing.searchHints || []), ...(item.searchHints || [])], 2);
    existing.visibleText = uniqueStrings([...(existing.visibleText || []), ...(item.visibleText || [])], 2);
    existing.barcodeCandidates = uniqueStrings([...(existing.barcodeCandidates || []), ...(item.barcodeCandidates || [])], 8);
    existing.confidence = Math.max(numberOrZero(existing.confidence), numberOrZero(item.confidence)) || undefined;
    existing.isPackaged = Boolean(existing.isPackaged || item.isPackaged);
  }

  return Array.from(deduplicatedMap.values());
}

function buildPhotoRecognitionQueries(item: PhotoRecognitionItem) {
  const phrases = uniqueStrings([
    item.name,
    ...item.aliases,
    ...item.searchHints,
    ...item.visibleText,
  ], 2);

  const expanded = uniqueStrings(
    phrases.flatMap((phrase) => {
      const cleaned = phrase
        .replace(/\([^)]*\)/g, " ")
        .replace(/[.,;:!?'"`~]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const tokens = cleaned.split(" ").filter((token) => token.length > 2);
      return [phrase, cleaned, ...tokens];
    }),
    2
  );

  return expanded.slice(0, 12);
}

function fallbackUsdaEnglishQuery(query: string): string {
  const normalized = String(query || "").toLowerCase().replace(/[^а-яёa-z0-9]+/g, " ").trim();
  const dictionary: Array<[string, string]> = [
    ["куриная грудка", "chicken breast"], ["куриное филе", "chicken breast"],
    ["яйцо", "egg whole"], ["творог", "cottage cheese"], ["гречка", "buckwheat cooked"],
    ["овсяные хлопья", "rolled oats"], ["овсянка", "oatmeal cooked"], ["молоко", "milk whole"], ["говядина", "beef cooked"],
    ["лосось", "salmon cooked"], ["семга", "salmon cooked"], ["банан", "banana raw"],
    ["яблоко", "apple raw"], ["авокадо", "avocado raw"], ["рис", "rice cooked"],
    ["картофель", "potato cooked"], ["помидор", "tomato raw"], ["огурец", "cucumber raw"],
    ["оладьи", "pancakes"], ["котлета", "ground beef patty"], ["пирог", "cabbage pie"]
  ];
  return dictionary.find(([russian]) => normalized.includes(russian))?.[1] || query;
}

// Единый AI-фоллбэк «оценка КБЖУ по названию». Когда точных данных нет (продукта нет
// в каталоге при поиске, либо штрихкод дал только название без нутриентов) — оцениваем
// пищевую ценность на 100 г через AI. Работает на текущих AI-ключах (доп. затрат нет) и
// закрывает товары, которых нет в открытых базах с нутриентами — это особенно актуально
// для российских товаров. Возвращает распарсенную оценку (name/КБЖУ/микроэлементы/
// explanation) или null. Значения приблизительные — вызывающий код помечает их как оценку.
async function aiEstimateNutrientsByName(name: string): Promise<any | null> {
  const query = String(name || "").trim();
  if (!query) return null;
  try {
    const estimateResponseText = await withTimeout(generateAI(`Пользователь ищет продукт: "${query}".
Точного совпадения в базе нет.
Оцени пищевую ценность для 100 г и верни только JSON:
{
  "name": "Название на русском",
  "calories": number,
  "protein": number,
  "fat": number,
  "carbs": number,
  "fiber": number,
  "vitamins": { "BetaCarotene": number, "B1": number, "B2": number, "B5": number, "B6": number, "B9": number, "B12": number, "C": number, "A": number, "D": number, "E": number, "K": number, "B3": number, "Biotin": number, "Choline": number },
  "minerals": { "Potassium": number, "Calcium": number, "Magnesium": number, "Sodium": number, "Phosphorus": number, "Iron": number, "Iodine": number, "Manganese": number, "Copper": number, "Selenium": number, "Chromium": number, "Zinc": number },
  "fattyAcids": { "Omega3": number, "Omega6": number, "Omega9": number, "TransFats": number, "Cholesterol": number },
  "carbohydrateTypes": { "Glucose": number, "Fructose": number, "Galactose": number, "Sucrose": number, "Lactose": number, "Maltose": number, "Starch": number, "Fiber": number },
  "aminoAcids": { "Alanine": number, "Arginine": number, "Asparagine": number, "AsparticAcid": number, "Valine": number, "Histidine": number, "Glycine": number, "Glutamine": number, "GlutamicAcid": number, "Isoleucine": number, "Leucine": number, "Lysine": number, "Methionine": number, "Proline": number, "Serine": number, "Tyrosine": number, "Threonine": number, "Tryptophan": number, "Phenylalanine": number, "Cysteine": number },
  "explanation": "Коротко почему такие значения"
}`), 8000, "AI estimate");
    const estimateData = parseAiJsonPayload(estimateResponseText || "{}");
    return estimateData?.name ? estimateData : null;
  } catch (e) {
    logError("AI Estimation error:", e);
    return null;
  }
}

// Оценка микроэлементов (витамины/минералы/клетчатка/аминокислоты/жирные кислоты) по
// названию продукта — для ручного ввода/правки, где пользователь указывает только КБЖУ,
// а микроэлементы остаются пустыми (в карточке «% дневной нормы» — сплошные нули).
// Возвращает готовую JSON-строку micronutrients и клетчатку, либо null (AI недоступен —
// тогда сохраняем без микроэлементов, как раньше). Макросы (ккал/Б/Ж/У) не трогаем — их
// ввёл пользователь; дозаполняем только микроэлементы, помечая всё как приблизительное.
async function estimateMicronutrientsByName(name: string): Promise<{ micronutrients: string; fiber: number } | null> {
  const est = await aiEstimateNutrientsByName(name);
  if (!est) return null;
  const fiber = numberOrZero(est.fiber);
  return { micronutrients: JSON.stringify(buildCompleteMicronutrients(est, fiber)), fiber };
}

function hydrateLocalProductForSearch(product: any) {
  const micro = buildCompleteMicronutrients(parseMicronutrients(product.micronutrients), product.fiber);
  if (isMicronutrientDataEffectivelyEmpty(micro) || hasEmptyMicronutrientGroup(micro) || hasMissingKeyMicronutrients(micro)) {
    enrichProductMicronutrientsInBackground(product).catch(() => {});
  }
  return {
    ...product,
    ...micro,
    servings: parseProductServings(product.servingsJson),
    source: "local",
  };
}

async function searchProductsEngine(query: string, options: ProductSearchOptions = {}) {
  const normalizedInput = String(query || "").trim();
  if (!normalizedInput) return [] as any[];

  const limit = Math.max(1, Math.min(20, Number(options.limit) || 10));
  const useCache = options.cache !== false;
  const localize = options.localize !== false;
  const allowAiEstimate = options.allowAiEstimate !== false;
  const fast = options.fast === true;

  // Ключ кэша обязан включать режимы: раньше был только `запрос::limit`, из-за чего
  // «быстрый» вызов (fast, без USDA/AI/реранка — напр. из фото/голоса) кэшировался и
  // подменял собой полноценный вызов с тем же запросом и limit, отдавая ему обеднённый
  // результат. Разводим по флагам fast/allowAiEstimate/localize.
  const cacheKey = `${normalizedInput}::${limit}::f${fast ? 1 : 0}::e${allowAiEstimate ? 1 : 0}::l${localize ? 1 : 0}`;

  if (useCache) {
    const cachedSearch = getCachedProductSearch(cacheKey);
    if (cachedSearch) {
      return cachedSearch.slice(0, limit);
    }
  }

  const dbReady = isDatabaseConfigured();
  if (dbReady) {
    const directMatches = await prisma.product.findMany({
      where: { name: { equals: normalizedInput, mode: "insensitive" } },
      orderBy: [{ brand: "asc" }, { name: "asc" }],
      take: limit,
    });
    if (directMatches.length > 0) {
      const hydrated = directMatches.map((product) => ({
        ...hydrateLocalProductForSearch(product),
        matchScore: 1,
      }));
      const localized = localize
        ? await Promise.all(hydrated.map((product) => localizeProductForRussianAudience(product)))
        : hydrated;
      const responseResults = localized.map((product) => ({ ...product, nutriScore: calcNutriScore(product) }));
      if (useCache) cacheProductSearch(cacheKey, responseResults);
      return responseResults;
    }
  }

  let normalizedQuery = normalizedInput;
  let englishQuery = normalizedInput;
  let searchTerms: string[] = [normalizedInput];

  if (!fast) {
    try {
      const normResponseText = await withTimeout(generateAI(`Проанализируй поисковый запрос по еде: "${normalizedInput}".
Пользователь русскоязычный. Верни JSON со структурой:
- normalized: каноничное название на русском
- english: краткий англоязычный термин для поиска в USDA
- search_terms: массив из 3-5 ключевых слов для поиска (русские и английские варианты)
- tags: массив категорий
- isDrink: boolean
Верни только JSON.`), 7000, "AI normalization");
      const normData = parseAiJsonPayload(normResponseText || "{}");
      normalizedQuery = String(normData?.normalized || normalizedInput).trim() || normalizedInput;
      englishQuery = String(normData?.english || normalizedInput).trim() || normalizedInput;
      searchTerms = uniqueStrings([
        normalizedInput,
        normalizedQuery,
        englishQuery,
        ...(Array.isArray(normData?.search_terms) ? normData.search_terms : []),
      ], 2);
    } catch (e) {
      logError("Normalization error:", e);
    }
  }
  // The USDA API indexes English descriptions. This deterministic fallback keeps
  // USDA search working when the optional AI translator is not configured.
  englishQuery = fallbackUsdaEnglishQuery(englishQuery);

  const queryTokens = uniqueStrings([
    ...normalizedInput.split(/\s+/),
    ...normalizedQuery.split(/\s+/),
    ...englishQuery.split(/\s+/),
  ], 2);

  // Основы русских слов из запроса — чтобы "креветка" находило "Креветки" и наоборот
  // (см. stemRussianToken). Минимальная длина основы 3, чтобы не тянуть слишком общие
  // куски; итоговую релевантность всё равно фильтрует скоринг + MIN_RELEVANT_SCORE ниже.
  const stemTerms = uniqueStrings(
    [...queryTokens, ...searchTerms]
      .flatMap((term) => String(term).split(/\s+/))
      .map((token) => stemRussianToken(token))
      .filter((stem): stem is string => Boolean(stem)),
    3
  );

  const [exactLocalProducts, broadLocalProducts] = dbReady
    ? await Promise.all([
      prisma.product.findMany({
        where: {
          OR: [
            { name: { equals: normalizedInput, mode: "insensitive" } },
            { name: { equals: normalizedQuery, mode: "insensitive" } },
          ],
        },
        take: 10,
      }),
      prisma.product.findMany({
        where: {
          OR: [
            { name: { contains: normalizedQuery, mode: "insensitive" } },
            { name: { contains: normalizedInput, mode: "insensitive" } },
            { name: { contains: englishQuery, mode: "insensitive" } },
            ...searchTerms.map((term) => ({ name: { contains: term, mode: "insensitive" as const } })),
            ...queryTokens.map((term) => ({ name: { contains: term, mode: "insensitive" as const } })),
            ...stemTerms.map((term) => ({ name: { contains: term, mode: "insensitive" as const } })),
            { brand: { contains: normalizedInput, mode: "insensitive" } },
          ],
        },
        take: 50,
      }),
    ])
    : [[], []];
  const localProducts = [...new Map(
    [...exactLocalProducts, ...broadLocalProducts].map((product) => [product.id, product])
  ).values()];

  const parsedLocal = localProducts.map(hydrateLocalProductForSearch);

  let usdaProducts: any[] = [];
  const usdaKey = process.env.USDA_FDC_API_KEY;
  if (!fast && usdaKey && englishQuery.length > 1) {
    try {
      const response = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${usdaKey}&query=${encodeURIComponent(englishQuery)}&pageSize=15`, { signal: AbortSignal.timeout(6000) });
      if (response.ok) {
        const data: any = await response.json();
        usdaProducts = (data.foods || []).map((food: any) => {
          const getNutrient = (id: number) =>
            food.foodNutrients?.find((n: any) => n.nutrientId === id || n.nutrientNumber === String(id))?.value || 0;
          const extended = extractUsdaExtendedNutrients(food);
          const completedMicro = buildCompleteMicronutrients({
            vitamins: extended.vitamins,
            minerals: extended.minerals,
            aminoAcids: extended.aminoAcids,
            fattyAcids: extended.fattyAcids,
            carbohydrateTypes: extended.carbohydrateTypes,
          }, getNutrient(1079) || getNutrient(291));

          return {
            id: `usda-${food.fdcId}`,
            name: food.description,
            brand: food.brandOwner || "USDA",
            calories: getNutrient(1008) || getNutrient(208),
            protein: getNutrient(1003) || getNutrient(203),
            fat: getNutrient(1004) || getNutrient(204),
            carbs: getNutrient(1005) || getNutrient(205),
            fiber: getNutrient(1079) || getNutrient(291),
            vitamins: completedMicro.vitamins,
            minerals: completedMicro.minerals,
            aminoAcids: completedMicro.aminoAcids,
            fattyAcids: completedMicro.fattyAcids,
            carbohydrateTypes: completedMicro.carbohydrateTypes,
            isUsda: true,
            fdcId: food.fdcId,
            source: "usda",
          };
        });
      }
    } catch (e) {
      logError("USDA Search Error:", e);
    }
  }

  const allCandidates = [...parsedLocal, ...usdaProducts];
  const scoredCandidates = allCandidates.filter((candidate) =>
    !fast || isLexicallyCompatibleFood(normalizedInput, candidate.name)
  ).map((candidate) => {
    const similarity = Math.max(
      computeTextSimilarity(normalizedInput, candidate.name),
      computeTextSimilarity(normalizedQuery, candidate.name),
      computeTextSimilarity(englishQuery, candidate.name)
    );
    const sourceBoost = candidate.source === "local" ? 0.1 : 0;
    // Базовый/каноничный продукт (без бренда конкретной фирмы) поднимаем над
    // фирменными вариантами того же продукта: у базового обычно полные нутриенты и
    // он не привязан к конкретной марке — по просьбе команды "чтобы базовый
    // выскакивал первым". Бонус применяется только к уже релевантным кандидатам
    // (прошли предфильтр и порог MIN_RELEVANT_SCORE), поэтому нерелевантный базовый
    // продукт наверх не всплывёт.
    const baseBoost = isBaseProductCandidate(candidate) ? 0.15 : 0;
    const queryTokenCount = textTokenSet(normalizedInput).size;
    const candidateTokenCount = textTokenSet(candidate.name).size;
    const specificityPenalty = Math.min(0.2, Math.max(0, candidateTokenCount - queryTokenCount) * 0.035);
    const exactPhraseBoost = normalizeComparableText(candidate.name) === normalizeComparableText(normalizedInput) ? 0.2 : 0;
    const finalScore = Math.max(0, Math.min(1, similarity + sourceBoost + baseBoost + exactPhraseBoost - specificityPenalty));
    return { ...candidate, matchScore: finalScore };
  });

  scoredCandidates.sort((left, right) => numberOrZero(right.matchScore) - numberOrZero(left.matchScore));

  let finalResults = scoredCandidates.slice(0, 15);

  if (allowAiEstimate && (finalResults.length === 0 || numberOrZero(finalResults[0]?.matchScore) < 0.6)) {
    const estimateData = await aiEstimateNutrientsByName(normalizedInput);
    if (estimateData?.name) {
      // Проверяем правдоподобие: AI иногда отдаёт физически невозможные значения
      // (класс «1295 ккал / 150 г»). Если калорийность противоречит макросам, а сами
      // макросы правдоподобны — берём калорийность по Атуотеру; при грубых нарушениях
      // помечаем needsReview, чтобы приложение предложило сверить.
      const check = validateNutritionPer100g(estimateData);
      finalResults.unshift({
        id: `ai-est-${Date.now()}`,
        name: `✨ ${estimateData.name} (AI Оценка)`,
        brand: "AI Nutria Engine",
        calories: check.correctedCalories ?? numberOrZero(estimateData.calories),
        protein: numberOrZero(estimateData.protein),
        fat: numberOrZero(estimateData.fat),
        carbs: numberOrZero(estimateData.carbs),
        fiber: numberOrZero(estimateData.fiber),
        vitamins: estimateData.vitamins || {},
        minerals: estimateData.minerals || {},
        aminoAcids: estimateData.aminoAcids || {},
        fattyAcids: estimateData.fattyAcids || {},
        carbohydrateTypes: estimateData.carbohydrateTypes || {},
        isAiEstimated: true,
        needsReview: check.needsReview,
        explanation: estimateData.explanation,
        matchScore: 0.95,
        source: "ai",
      });
    }
  }

  finalResults.sort((left, right) => numberOrZero(right.matchScore) - numberOrZero(left.matchScore));

  if (!fast && finalResults.length > 1 && numberOrZero(finalResults[0]?.matchScore) < 0.95) {
    try {
      const reRankResponseText = await withTimeout(generateAI(`Пользователь ищет: "${normalizedInput}" (нормализовано: "${normalizedQuery}").
Найдены кандидаты:
${finalResults.map((candidate, index) => `${index}: ${candidate.name} (${candidate.brand}) - Score: ${candidate.matchScore}`).join("\n")}

Выбери лучшие совпадения.
Верни только JSON-объект вида {"indices": [2, 0, 1]} — массив 0-based индексов кандидатов по убыванию релевантности.
Полностью нерелевантные позиции не включай.
При прочих равных базовый/общий продукт (бренд "Базовый продукт" или без бренда фирмы) ставь выше фирменных вариантов того же продукта.
Если есть AI-оценка и она выглядит корректно, можно поставить ее выше.`), 7000, "AI re-rank");
      const reRankData = parseAiJsonPayload(reRankResponseText || "{}");
      // Провайдеры с response_format=json_object (OpenAI/DeepSeek) не отдают top-level
      // массив и оборачивают его в ключ по своему усмотрению (indices/order/ranking/…).
      // unwrapAiItemsArray их разворачивает — иначе реранк молча превращался в no-op.
      const indices = unwrapAiItemsArray(reRankData)
        .map((v: any) => Number(v))
        .filter((v: any) => Number.isInteger(v));

      if (indices.length > 0) {
        finalResults = indices.map((index: number) => finalResults[index]).filter(Boolean);
      }
    } catch (e) {
      logError("Re-ranking error:", e);
    }
  }

  // AI-реранкер не может удалить точное каталожное совпадение. Например,
  // "овсяные хлопья" должны сохранять "Овсяные хлопья сырые", а не оставлять
  // только семантически близкое овсяное молоко.
  finalResults = restoreExactCatalogMatch(normalizedInput, scoredCandidates, finalResults);

  // Детерминированный предохранитель, не зависящий от доступности AI: реранк должен был
  // сам исключить нерелевантные позиции ("Полностью нерелевантные позиции исключи"), но
  // если AI-оценка и реранк оба недоступны/провалились (таймаут, сбой провайдера — оба шага
  // просто логируют ошибку и молча ничего не меняют), в выдаче остаются кандидаты из грубого
  // SQL contains-предфильтра с очень низкой релевантностью (напр. запрос "фасоль красная"
  // находил только "Пищевой краситель, красный" — совпадение по слову "красный", а не по
  // продукту). Без AI такие совпадения лучше не показывать вовсе, чем выдавать за КБЖУ
  // явно не того продукта.
  const MIN_RELEVANT_SCORE = 0.35;
  finalResults = finalResults.filter((item) => item.source === "ai" || numberOrZero(item.matchScore) >= MIN_RELEVANT_SCORE);

  // Гарантированно поднимаем базовый/общий продукт над фирменными вариантами того же
  // продукта, если он в выдаче и сопоставимо релевантен (в пределах 0.12 от лидера) —
  // по просьбе команды "чтобы базовый выскакивал первым". Делается детерминированно,
  // после AI-реранка (AI про это правило не знает и мог переставить), но не трогает
  // случаи, когда фирменный продукт заметно релевантнее (пользователь искал марку) и
  // не двигает AI-оценку с первого места. Пример: запрос "креветка" — базовый
  // "Креветки" должен быть выше фирменных "КРЕВЕТКА <марка>".
  if (finalResults.length > 1) {
    const leader = finalResults[0];
    const leaderIsPreferred = leader?.source === "ai" || isBaseProductCandidate(leader);
    if (!leaderIsPreferred) {
      const topScore = numberOrZero(leader?.matchScore);
      const baseIdx = finalResults.findIndex(
        (item) => isBaseProductCandidate(item) && topScore - numberOrZero(item.matchScore) <= 0.12
      );
      if (baseIdx > 0) {
        const [base] = finalResults.splice(baseIdx, 1);
        finalResults.unshift(base);
      }
    }
  }

  const localizedResults = localize
    ? await Promise.all(finalResults.slice(0, limit).map((item) => localizeProductForRussianAudience(item)))
    : finalResults.slice(0, limit);

  const responseResults = localizedResults.map((item: any) => ({ ...item, nutriScore: calcNutriScore(item) }));

  if (useCache) {
    cacheProductSearch(cacheKey, responseResults);
  }

  return responseResults;
}

async function findBestPhotoRecognitionMatch(item: PhotoRecognitionItem, userId?: string | null) {
  const correctionMatch = await findRecognitionCorrectionMatch(userId, item);
  if (correctionMatch?.correctedProduct) {
    return {
      ...item,
      matchedBy: "correction",
      matchScore: correctionMatch.score,
      product: correctionMatch.correctedProduct,
      correctedByUser: true,
    };
  }

  const barcodeCandidates = uniqueStrings(item.barcodeCandidates.flatMap((value) => extractBarcodeCandidates(value)), 8);
  if (barcodeCandidates.length > 0) {
    const { product: barcodeProduct } = await resolveBarcodeProduct(barcodeCandidates);
    if (barcodeProduct) {
      return { ...item, matchedBy: `barcode:${barcodeCandidates[0]}`, matchScore: 0.99, product: barcodeProduct };
    }
  }

  const queries = buildPhotoRecognitionQueries(item);

  const scoreCandidates = (query: string, candidates: any[], bestMatch: any) => {
    for (const candidate of candidates) {
      const similarity = Math.max(
        computeTextSimilarity(item.name, candidate.name),
        ...item.aliases.map((alias) => computeTextSimilarity(alias, candidate.name)),
        ...item.searchHints.map((hint) => computeTextSimilarity(hint, candidate.name))
      );
      const packagedBoost = item.isPackaged && candidate.barcode ? 0.08 : 0;
      const queryBoost = computeTextSimilarity(query, candidate.name) * 0.15;
      const aiPenalty = candidate.isAiEstimated ? 0.08 : 0;
      const finalScore = Math.max(
        0,
        Math.min(
          1,
          numberOrZero(candidate.matchScore) * 0.55 + similarity * 0.35 + packagedBoost + queryBoost - aiPenalty
        )
      );

      if (!bestMatch || finalScore > numberOrZero(bestMatch.matchScore)) {
        bestMatch = { ...item, matchedBy: query, matchScore: finalScore, product: candidate };
      }
    }
    return bestMatch;
  };

  const queryResults = await Promise.all(
    queries.map((query) =>
      withTimeout(
        searchProductsEngine(query, { limit: 5, cache: true, localize: true, allowAiEstimate: false, fast: true }),
        6000,
        `Photo match "${query}"`
      ).catch(() => [] as any[])
    )
  );

  let bestMatch: any = null;
  queries.forEach((query, index) => {
    bestMatch = scoreCandidates(query, queryResults[index] || [], bestMatch);
  });

  if ((!bestMatch || numberOrZero(bestMatch.matchScore) < 0.5) && numberOrZero(item.confidence) >= 0.55) {
    try {
      const fallbackCandidates = await withTimeout(
        searchProductsEngine(item.name, { limit: 5, cache: true, localize: true, allowAiEstimate: true }),
        12000,
        `Photo fallback match "${item.name}"`
      );
      bestMatch = scoreCandidates(item.name, fallbackCandidates, bestMatch);
    } catch (e) {
      logError(`Photo fallback match failed for "${item.name}":`, e);
    }
  }

  if (bestMatch && numberOrZero(bestMatch.matchScore) >= 0.5) {
    return bestMatch;
  }

  return { ...item, matchedBy: null, matchScore: numberOrZero(bestMatch?.matchScore), product: null };
}

async function recognizeProductsFromPhoto(image: { data: string; mimeType: string }, options?: { userId?: string | null; mode?: PhotoRecognitionMode }) {
  const mode: PhotoRecognitionMode = options?.mode === "whole_dish" ? "whole_dish" : "ingredients";
  const barcodeProbePrompt = `Проанализируй фото и извлеки только строки, похожие на штрихкоды с упаковки.
Верни только JSON-объект:
{
  "barcodeCandidates": ["4601234567890"]
}
Правила:
- Включай только строки из 8-14 цифр.
- Без пробелов и дефисов.
- Если штрихкод не виден, верни пустой массив.`;

  const barcodeProbeText = await withTimeout(
    generateAI(barcodeProbePrompt, "application/json", image),
    10000,
    "Barcode probe"
  ).catch(() => "");
  const barcodeProbeRaw = parseAiJsonPayload(barcodeProbeText || "{}");
  const photoBarcodeCandidates = uniqueStrings(
    (Array.isArray(barcodeProbeRaw?.barcodeCandidates) ? barcodeProbeRaw.barcodeCandidates : [])
      .flatMap((value: any) => extractBarcodeCandidates(String(value || ""))),
    8
  );

  for (const barcodeCandidate of photoBarcodeCandidates) {
    const directMatch = await findBestPhotoRecognitionMatch({
      name: "Продукт по упаковке",
      amount: 100,
      aliases: [],
      searchHints: [],
      visibleText: [],
      barcodeCandidates: [barcodeCandidate],
      confidence: 0.98,
      isPackaged: true,
    }, options?.userId);
    if (directMatch?.product) {
      return {
        items: [
          {
            ...directMatch,
            name: directMatch.product.name,
            amount: 100,
            recognitionConfidence: 0.98,
          },
        ],
        dishEstimate: mode === "whole_dish"
          ? {
              name: directMatch.product.name,
              amount: 100,
              totalCalories: numberOrZero(directMatch.product.calories),
              totalProtein: numberOrZero(directMatch.product.protein),
              totalFat: numberOrZero(directMatch.product.fat),
              totalCarbs: numberOrZero(directMatch.product.carbs),
              totalFiber: numberOrZero(directMatch.product.fiber),
              explanation: "Оценка построена по распознанному упакованному продукту.",
              confidence: 0.98,
              product: directMatch.product,
            }
          : null,
      };
    }
  }

  const recognitionPrompt = `Проанализируй фото еды или продукта и верни только корректный JSON.

Режим распознавания: ${mode === "whole_dish" ? "whole dish" : "ingredients"}.

Формат ответа:
{
  "sceneType": "packaged_food | plated_dish | ingredients | unclear",
  "dishEstimate": {
    "name": "название блюда целиком",
    "amount": 350,
    "totalCalories": 620,
    "totalProtein": 28,
    "totalFat": 24,
    "totalCarbs": 68,
    "totalFiber": 9,
    "explanation": "кратко почему такая оценка",
    "confidence": 0.0
  },
  "items": [
    {
      "name": "основное русское название",
      "amount": 120,
      "aliases": ["алиас ru", "alias en"],
      "searchHints": ["уточнение для поиска", "бренд или тип"],
      "visibleText": ["текст с упаковки, если читается"],
      "barcodeCandidates": ["4601234567890"],
      "confidence": 0.0,
      "isPackaged": false
    }
  ]
}

Правила:
- Если это упакованный продукт, приоритет у названия с упаковки и читаемого текста.
- Если режим whole dish, обязательно заполни dishEstimate для всей порции на фото.
- Если это готовое блюдо, выделяй 1-5 основных съедобных компонентов.
- Не включай тарелку, стол, фон, приборы.
- amount указывай в граммах съедобной части.
- aliases и searchHints используй для русских и английских вариантов поиска.
- confidence от 0.0 до 1.0.
- Если уверенность низкая, всё равно верни лучшую гипотезу.`;

  const recognitionText = await withTimeout(
    generateAI(recognitionPrompt, "application/json", image),
    20000,
    "Photo recognition"
  );
  const recognitionRaw = parseAiJsonPayload(recognitionText || "{}");
  let recognizedItemsSource = unwrapAiItemsArray(recognitionRaw);
  const dishEstimateRaw = recognitionRaw && typeof recognitionRaw === "object" && !Array.isArray(recognitionRaw)
    ? recognitionRaw.dishEstimate
    : null;

  if (recognizedItemsSource.length === 0) {
    const singleFoodFallbackPrompt = `Определи основной съедобный продукт или блюдо на фото.
Верни только JSON-объект:
{
  "name": "банан",
  "amount": 120,
  "aliases": ["banana"],
  "searchHints": ["fruit raw"],
  "visibleText": [],
  "barcodeCandidates": [],
  "confidence": 0.0,
  "isPackaged": false
}`;
    const singleFoodText = await withTimeout(
      generateAI(singleFoodFallbackPrompt, "application/json", image),
      10000,
      "Single food fallback"
    ).catch(() => "");
    const singleFoodRaw = parseAiJsonPayload(singleFoodText || "{}");
    if (singleFoodRaw && typeof singleFoodRaw === "object" && !Array.isArray(singleFoodRaw)) {
      recognizedItemsSource = [singleFoodRaw];
    }
  }

  const normalizedItems = dedupePhotoRecognitionItems(
    recognizedItemsSource
      .map((item: any) => normalizePhotoRecognitionItem(item))
      .filter(Boolean) as PhotoRecognitionItem[]
  );

  const matchedItems = await Promise.all(
    normalizedItems.map(async (item) => {
      const match = await findBestPhotoRecognitionMatch(item, options?.userId);
      return {
        ...match,
        recognitionConfidence: typeof item.confidence === "number" ? item.confidence : null,
      };
    })
  );

  const dishEstimateProduct = buildDishEstimateProduct(dishEstimateRaw);
  const dishEstimate = dishEstimateProduct
    ? {
        name: dishEstimateProduct.name,
        amount: clampNumber(dishEstimateRaw?.amount ?? dishEstimateRaw?.totalWeight ?? 350, 1, 5000, 350),
        totalCalories: numberOrZero(dishEstimateRaw?.totalCalories ?? dishEstimateRaw?.calories),
        totalProtein: numberOrZero(dishEstimateRaw?.totalProtein ?? dishEstimateRaw?.protein),
        totalFat: numberOrZero(dishEstimateRaw?.totalFat ?? dishEstimateRaw?.fat),
        totalCarbs: numberOrZero(dishEstimateRaw?.totalCarbs ?? dishEstimateRaw?.carbs),
        totalFiber: numberOrZero(dishEstimateRaw?.totalFiber ?? dishEstimateRaw?.fiber),
        explanation: String(dishEstimateRaw?.explanation || "").trim(),
        confidence: Number.isFinite(Number(dishEstimateRaw?.confidence)) ? clampNumber(dishEstimateRaw?.confidence, 0, 1, 0.5) : null,
        product: {
          id: `ai-dish-${Date.now()}`,
          ...dishEstimateProduct,
        },
      }
    : null;

  return {
    items: matchedItems,
    dishEstimate,
  };
}

function getCachedBarcodeProduct(candidates: string[]) {
  const now = Date.now();
  for (const candidate of candidates) {
    const cached = barcodeLookupCache.get(candidate);
    if (!cached) continue;
    if (cached.expiresAt <= now) {
      barcodeLookupCache.delete(candidate);
      continue;
    }
    return cached.product;
  }
  return null;
}

function cacheBarcodeProduct(candidates: string[], product: any) {
  const expiresAt = Date.now() + BARCODE_CACHE_TTL_MS;
  for (const candidate of candidates) {
    barcodeLookupCache.set(candidate, { expiresAt, product });
  }
}

// После правки нутриентов по штрихкоду старая запись из открытой базы могла осесть в
// кэше (TTL 6 ч) под несколькими ключами-кандидатами — чистим все, что указывают на
// этот штрихкод, иначе повторное сканирование ещё какое-то время отдавало бы старьё.
function invalidateBarcodeCache(barcode: string) {
  const target = String(barcode);
  for (const [key, entry] of barcodeLookupCache.entries()) {
    if (key === target || String(entry.product?.barcode) === target) {
      barcodeLookupCache.delete(key);
    }
  }
}

// LRU + TTL: Map сохраняет порядок вставки, поэтому при каждом обращении
// (чтении или записи) ключ удаляется и вставляется заново — он "уезжает" в
// конец, а наименее свежий ключ всегда первый и его проще всего вытеснить.
function getCachedProductSearch(query: string) {
  const key = String(query || "").trim().toLowerCase();
  if (!key) return null;
  const cached = productSearchCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    productSearchCache.delete(key);
    return null;
  }
  productSearchCache.delete(key);
  productSearchCache.set(key, cached);
  return cached.results;
}

function cacheProductSearch(query: string, results: any[]) {
  const key = String(query || "").trim().toLowerCase();
  if (!key) return;
  productSearchCache.delete(key);
  productSearchCache.set(key, {
    expiresAt: Date.now() + PRODUCT_SEARCH_CACHE_TTL_MS,
    results,
  });
  while (productSearchCache.size > PRODUCT_SEARCH_CACHE_MAX_ENTRIES) {
    const oldestKey = productSearchCache.keys().next().value;
    if (oldestKey === undefined) break;
    productSearchCache.delete(oldestKey);
  }
}

function numberOrZero(value: any) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Ингредиенты блюда иногда ссылаются на productId, которого нет в базе — это
// AI-оценка (searchProductsEngine отдаёт эфемерный id вида "ai-est-...", если
// точного совпадения в каталоге не нашлось) или продукт из внешнего источника
// (USDA), который ещё не сохранён локально. RecipeIngredient.productId — обязательный
// внешний ключ на Product, поэтому такой ингредиент нужно материализовать как
// настоящую запись Product (по присланным клиентом КБЖУ), а не молча пропускать —
// иначе блюдо целиком из таких ингредиентов не сохранится вообще
// ("Не найдены продукты для ингредиентов"), не объясняя пользователю причину.
async function resolveIngredientProducts(
  prisma: PrismaClient,
  ingredientsInput: any[],
  userId: string
): Promise<Map<string, { id: string; calories: number; protein: number; fat: number; carbs: number }>> {
  const productIds = ingredientsInput.map((ing: any) => String(ing.productId));
  const existing = await prisma.product.findMany({ where: { id: { in: productIds } } });
  const resolved = new Map<string, any>(existing.map((p: any) => [p.id, p]));

  for (const ing of ingredientsInput) {
    const key = String(ing.productId);
    if (resolved.has(key)) continue;
    const name = String(ing.name || "").trim();
    if (!name) continue;
    // Фиксированный brand (не null): Prisma не даёт использовать null как часть
    // значения составного уникального ключа @@unique([name, brand]) в where —
    // даже когда сама колонка nullable, запрос падает с "Argument `brand` must
    // not be null". Используем findFirst → create, а не upsert (так же, как уже
    // сделано для AI/USDA-продуктов чуть выше в этом файле), и ловим гонку двух
    // параллельных запросов на одинаковый ингредиент через P2002.
    const brand = "AI Ingredient";
    let product = await prisma.product.findFirst({ where: { name, brand } });
    if (!product) {
      const data = {
        name,
        brand,
        source: "ai",
        createdByUserId: userId,
        calories: numberOrZero(ing.calories),
        protein: numberOrZero(ing.protein),
        fat: numberOrZero(ing.fat),
        carbs: numberOrZero(ing.carbs),
      };
      try {
        product = await prisma.product.create({ data });
      } catch (e: any) {
        if (e?.code === "P2002") {
          product = await prisma.product.findFirst({ where: { name, brand } });
          if (!product) throw e;
        } else {
          throw e;
        }
      }
    }
    resolved.set(key, product);
  }

  return resolved;
}

function hasCyrillic(value: any) {
  return CYRILLIC_RE.test(String(value || ""));
}

function getCachedRuLocalization(key: string) {
  const cached = ruLocalizationCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    ruLocalizationCache.delete(key);
    return null;
  }
  return cached.value;
}

function cacheRuLocalization(key: string, value: string) {
  ruLocalizationCache.set(key, { expiresAt: Date.now() + RU_LOCALIZATION_CACHE_TTL_MS, value });
}

async function localizeTextToRussian(value: any, type: "name" | "brand") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (hasCyrillic(raw)) return raw;

  const cacheKey = `${type}:${raw.toLowerCase()}`;
  const cached = getCachedRuLocalization(cacheKey);
  if (cached) return cached;

  try {
    const text = await withTimeout(
      generateAI(`Переведи на русский язык ${type === "name" ? "название продукта/блюда" : "название бренда"}: "${raw}".
Сохрани смысл и пищевой контекст.
Верни только JSON вида: {"text":"..."}`),
      6000,
      "RU localization"
    );
    const parsed = parseAiJsonPayload(text || "{}");
    const localized = String(parsed?.text || "").trim();
    if (localized) {
      cacheRuLocalization(cacheKey, localized);
      return localized;
    }
  } catch {
    // keep original if localization failed
  }

  return raw;
}

async function localizeProductForRussianAudience<T extends Record<string, any>>(product: T): Promise<T> {
  if (!product || typeof product !== "object") return product;

  const [localizedName, localizedBrand] = await Promise.all([
    localizeTextToRussian(product.name, "name"),
    product.brand ? localizeTextToRussian(product.brand, "brand") : Promise.resolve(product.brand),
  ]);

  return {
    ...product,
    name: localizedName || product.name,
    brand: localizedBrand || product.brand,
  } as T;
}

function normalizeUnitName(unit: any) {
  return String(unit || "").trim().toLowerCase();
}

export const MICRONUTRIENT_TEMPLATE = {
  vitamins: {
    BetaCarotene: 0,
    B1: 0,
    B2: 0,
    B5: 0,
    B6: 0,
    B9: 0,
    B12: 0,
    C: 0,
    A: 0,
    D: 0,
    E: 0,
    K: 0,
    B3: 0,
    Biotin: 0,
    Choline: 0,
  },
  minerals: {
    Potassium: 0,
    Calcium: 0,
    Silicon: 0,
    Magnesium: 0,
    Sodium: 0,
    Sulfur: 0,
    Phosphorus: 0,
    Chlorine: 0,
    Vanadium: 0,
    Iron: 0,
    Iodine: 0,
    Cobalt: 0,
    Manganese: 0,
    Copper: 0,
    Molybdenum: 0,
    Selenium: 0,
    Chromium: 0,
    Zinc: 0,
    Salt: 0,
  },
  fattyAcids: {
    Omega3: 0,
    Omega6: 0,
    Omega9: 0,
    TransFats: 0,
    Cholesterol: 0,
  },
  carbohydrateTypes: {
    Glucose: 0,
    Fructose: 0,
    Galactose: 0,
    Sucrose: 0,
    Lactose: 0,
    Maltose: 0,
    Starch: 0,
    Fiber: 0,
  },
  aminoAcids: {
    Alanine: 0,
    Arginine: 0,
    Asparagine: 0,
    AsparticAcid: 0,
    Valine: 0,
    Histidine: 0,
    Glycine: 0,
    Glutamine: 0,
    GlutamicAcid: 0,
    Isoleucine: 0,
    Leucine: 0,
    Lysine: 0,
    Methionine: 0,
    Proline: 0,
    Serine: 0,
    Tyrosine: 0,
    Threonine: 0,
    Tryptophan: 0,
    Phenylalanine: 0,
    Cysteine: 0,
  },
};

function normalizeLegacyMicronutrientKeys(input: any) {
  const normalized = {
    ...input,
    vitamins: { ...(input?.vitamins || {}) },
    minerals: { ...(input?.minerals || {}) },
    fattyAcids: { ...(input?.fattyAcids || {}) },
    carbohydrateTypes: { ...(input?.carbohydrateTypes || {}) },
    aminoAcids: { ...(input?.aminoAcids || {}) },
  };

  if (normalized.vitamins?.B7 != null && normalized.vitamins?.Biotin == null) {
    normalized.vitamins.Biotin = normalized.vitamins.B7;
  }

  if (normalized.aminoAcids?.Cystine != null && normalized.aminoAcids?.Cysteine == null) {
    normalized.aminoAcids.Cysteine = normalized.aminoAcids.Cystine;
  }

  if (normalized.carbohydrateTypes?.Fibre != null && normalized.carbohydrateTypes?.Fiber == null) {
    normalized.carbohydrateTypes.Fiber = normalized.carbohydrateTypes.Fibre;
  }

  return normalized;
}

export function buildCompleteMicronutrients(raw: any, productFiber?: number | null) {
  const legacy = normalizeLegacyMicronutrientKeys(raw || {});
  const merged = {
    vitamins: { ...MICRONUTRIENT_TEMPLATE.vitamins, ...(legacy.vitamins || {}) },
    minerals: { ...MICRONUTRIENT_TEMPLATE.minerals, ...(legacy.minerals || {}) },
    fattyAcids: { ...MICRONUTRIENT_TEMPLATE.fattyAcids, ...(legacy.fattyAcids || {}) },
    carbohydrateTypes: { ...MICRONUTRIENT_TEMPLATE.carbohydrateTypes, ...(legacy.carbohydrateTypes || {}) },
    aminoAcids: { ...MICRONUTRIENT_TEMPLATE.aminoAcids, ...(legacy.aminoAcids || {}) },
  };

  for (const [groupKey, group] of Object.entries(merged) as Array<[keyof typeof merged, Record<string, any>]>) {
    for (const [key, value] of Object.entries(group)) {
      merged[groupKey][key] = numberOrZero(value);
    }
  }

  if (!merged.minerals.Salt && merged.minerals.Sodium > 0) {
    merged.minerals.Salt = merged.minerals.Sodium * 2.5;
  }

  if (!merged.carbohydrateTypes.Fiber && numberOrZero(productFiber) > 0) {
    merged.carbohydrateTypes.Fiber = numberOrZero(productFiber);
  }

  return merged;
}

function hasAnyPositiveValue(map: Record<string, any> | undefined) {
  if (!map || typeof map !== "object") return false;
  return Object.values(map).some((value) => numberOrZero(value) > 0);
}

function parseMicronutrients(rawMicronutrients: any) {
  if (!rawMicronutrients) return {} as Record<string, any>;
  if (typeof rawMicronutrients === "object") return rawMicronutrients as Record<string, any>;
  try {
    return JSON.parse(String(rawMicronutrients));
  } catch {
    return {} as Record<string, any>;
  }
}

// Человеческие порции продукта ("1 шт" = 55г и т.п.) — опциональны, есть не у всех
// продуктов (у большинства per-100g каталожных записей естественной порции нет).
function parseProductServings(rawServingsJson: any): { name: string; grams: number }[] {
  if (!rawServingsJson) return [];
  try {
    const parsed = typeof rawServingsJson === "string" ? JSON.parse(rawServingsJson) : rawServingsJson;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s: any) => s && typeof s.name === "string" && Number.isFinite(Number(s.grams)) && Number(s.grams) > 0)
      .map((s: any) => ({ name: s.name, grams: Number(s.grams) }));
  } catch {
    return [];
  }
}

function shouldRefreshMicronutrients(existingRaw: any, incoming: any) {
  const existing = buildCompleteMicronutrients(parseMicronutrients(existingRaw));
  const incomingNormalized = buildCompleteMicronutrients(incoming);
  const nutrientKeysByGroup: Record<string, string[]> = {
    vitamins: [
      "BetaCarotene", "B1", "B2", "B5", "B6", "B9", "B12", "C", "A", "D", "E", "K", "B3", "Biotin", "Choline",
    ],
    minerals: [
      "Potassium", "Calcium", "Silicon", "Magnesium", "Sodium", "Sulfur", "Phosphorus", "Chlorine", "Vanadium", "Iron", "Iodine", "Cobalt", "Manganese", "Copper", "Molybdenum", "Selenium", "Chromium", "Zinc", "Salt",
    ],
    aminoAcids: [
      "Alanine", "Arginine", "Asparagine", "AsparticAcid", "Valine", "Histidine", "Glycine", "Glutamine", "GlutamicAcid", "Isoleucine", "Leucine", "Lysine", "Methionine", "Proline", "Serine", "Tyrosine", "Threonine", "Tryptophan", "Phenylalanine", "Cysteine",
    ],
    fattyAcids: ["Omega3", "Omega6", "Omega9", "TransFats", "Cholesterol"],
    carbohydrateTypes: ["Glucose", "Fructose", "Galactose", "Sucrose", "Lactose", "Maltose", "Starch", "Fiber"],
  };

  // If incoming payload has no useful micronutrients, skip refresh.
  const hasIncomingSignal = Object.entries(nutrientKeysByGroup).some(([group, keys]) => {
    const incomingGroup = incomingNormalized?.[group] || {};
    return keys.some((key) => numberOrZero(incomingGroup[key]) > 0);
  });

  if (!hasIncomingSignal) return false;

  // Trigger refresh when existing product misses any configured nutrient key
  // that is present with a positive value in incoming USDA/AI payload.
  for (const [group, keys] of Object.entries(nutrientKeysByGroup)) {
    const existingGroup = existing?.[group] || {};
    const incomingGroup = incomingNormalized?.[group] || {};

    for (const key of keys) {
      if (numberOrZero(existingGroup[key]) <= 0 && numberOrZero(incomingGroup[key]) > 0) {
        return true;
      }
    }

    if (!hasAnyPositiveValue(existingGroup) && hasAnyPositiveValue(incomingGroup)) {
      return true;
    }
  }

  return false;
}

function isMicronutrientDataEffectivelyEmpty(completeMicro: ReturnType<typeof buildCompleteMicronutrients>) {
  return Object.values(completeMicro).every((group) =>
    Object.values(group as Record<string, number>).every((value) => numberOrZero(value) <= 0)
  );
}

// Продукт может иметь заполненные витамины/минералы, но полностью пустую группу
// (чаще всего аминокислоты — старые записи и часть AI-оценок их не содержали).
// Такой продукт тоже нуждается в фоновой докомплектации, иначе «Аминокислотный
// профиль» в дневнике навсегда остаётся нулевым.
function hasEmptyMicronutrientGroup(completeMicro: ReturnType<typeof buildCompleteMicronutrients>) {
  return Object.values(completeMicro).some((group) =>
    Object.values(group as Record<string, number>).every((value) => numberOrZero(value) <= 0)
  );
}

// «Ключевые» микроэлементы — те, что есть почти во всех продуктах и которые пользователи
// реально смотрят. Точечные нули по ним выглядят как «пропала часть данных» (например: у
// йогурта заполнены другие витамины, а B12 = 0, хотя в молоке он есть). Группа при этом не
// пуста целиком, поэтому докомплектация по пустым группам такие пробелы не закрывала.
const KEY_MICRONUTRIENTS: Record<string, string[]> = {
  vitamins: ["A", "C", "D", "E", "K", "B1", "B2", "B3", "B5", "B6", "B9", "B12"],
  minerals: ["Calcium", "Iron", "Magnesium", "Potassium", "Zinc", "Iodine", "Phosphorus", "Selenium", "Sodium"],
  fattyAcids: ["Omega3", "Omega6"],
};

export function hasMissingKeyMicronutrients(completeMicro: ReturnType<typeof buildCompleteMicronutrients>) {
  return Object.entries(KEY_MICRONUTRIENTS).some(([group, keys]) => {
    const g = (completeMicro as any)[group] || {};
    // Пробел засчитываем только если в группе уже есть хоть какие-то данные (продукт
    // распознан), иначе это «нет данных вообще» — покрывается другими проверками.
    if (!hasAnyPositiveValue(g)) return false;
    return keys.some((key) => numberOrZero(g[key]) <= 0);
  });
}

function clampNutriScorePoints(value: number, max: number) {
  return Math.max(0, Math.min(max, Math.round(value)));
}

const NUTRI_SCORE_SUGAR_KEYS = ["Glucose", "Fructose", "Galactose", "Sucrose", "Lactose", "Maltose"];

// Упрощённый Nutri-Score (per 100g): нет отдельного поля "насыщенные жиры" в модели данных,
// поэтому в негативный компонент идёт общий жир как приближение.
function calcNutriScore(item: {
  calories?: number;
  protein?: number;
  fat?: number;
  fiber?: number;
  minerals?: Record<string, number>;
  carbohydrateTypes?: Record<string, number>;
}): { score: number; grade: "A" | "B" | "C" | "D" | "E" } {
  const calories = numberOrZero(item.calories);
  const fat = numberOrZero(item.fat);
  const protein = numberOrZero(item.protein);
  const fiber = numberOrZero(item.fiber);
  const sodiumMg = numberOrZero(item.minerals?.Sodium);
  const carbTypes = item.carbohydrateTypes || {};
  const sugarG = NUTRI_SCORE_SUGAR_KEYS.reduce((sum, key) => sum + numberOrZero(carbTypes[key]), 0);

  const caloriesPts = clampNutriScorePoints(calories / 80, 10);
  const fatPts = clampNutriScorePoints(fat, 10);
  const sugarPts = clampNutriScorePoints(sugarG / 4.5, 10);
  const sodiumPts = clampNutriScorePoints(sodiumMg / 90, 10);

  const fiberPts = clampNutriScorePoints(fiber / 0.95, 5);
  const proteinPts = clampNutriScorePoints(protein / 1.6, 5);

  const score = caloriesPts + fatPts + sugarPts + sodiumPts - (fiberPts + proteinPts);

  let grade: "A" | "B" | "C" | "D" | "E";
  if (score <= -1) grade = "A";
  else if (score <= 2) grade = "B";
  else if (score <= 10) grade = "C";
  else if (score <= 18) grade = "D";
  else grade = "E";

  return { score, grade };
}

// Точные микроэлементы из USDA FDC по названию продукта. Название в базе русское, поэтому
// сначала переводим его в короткий английский поисковый запрос (единственное место, где
// участвует AI — сами значения берутся из USDA без оценок). Generic-базы (Foundation,
// SR Legacy) предпочтительнее Branded: значения на 100 г и полный аминокислотный профиль.
async function fetchUsdaMicronutrientsByName(productName: string) {
  const usdaKey = process.env.USDA_FDC_API_KEY;
  if (!usdaKey) return null;

  let englishQuery = String(productName || "").trim();
  if (!englishQuery) return null;
  try {
    const translationText = await withTimeout(
      generateAI(`Переведи название продукта "${productName}" в короткий английский поисковый запрос для базы продуктов USDA (без бренда и лишних слов, максимум 4 слова). Верни только JSON: {"query": "..."}`),
      8000,
      "USDA query translation"
    );
    const translated = parseAiJsonPayload(translationText || "{}");
    if (translated?.query && String(translated.query).trim()) {
      englishQuery = String(translated.query).trim();
    }
  } catch {
    // перевод не удался — пробуем исходное название (для латиницы сработает и так)
  }

  try {
    const response = await fetch(
      `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${usdaKey}&query=${encodeURIComponent(englishQuery)}&dataType=${encodeURIComponent("Foundation,SR Legacy")}&pageSize=5`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!response.ok) throw new Error(`USDA FDC returned HTTP ${response.status}`);
    const payload: any = await response.json();
    const foods = Array.isArray(payload?.foods) ? payload.foods : [];
    // Предпочитаем запись с аминокислотным профилем (id нутриентов 1210–1229) — именно
    // его чаще всего не хватает; иначе берём первый результат.
    const withAmino = foods.find((f: any) =>
      Array.isArray(f?.foodNutrients) &&
      f.foodNutrients.some((n: any) => Number(n?.nutrientId) >= 1210 && Number(n?.nutrientId) <= 1229 && numberOrZero(n?.value) > 0)
    );
    const food = withAmino || foods[0];
    if (!food) return null;
    return extractUsdaExtendedNutrients(food);
  } catch (e) {
    logError("USDA micronutrient lookup error:", e);
    throw e;
  }
}

// Точечная докомплектация: если у продукта нет сохранённых микроэлементов или пуста
// целая группа (например, аминокислоты), асинхронно (не блокируя текущий запрос)
// добираем данные и сохраняем в Product.micronutrients. Приоритет источников:
// сначала точные значения из USDA FDC, и только для групп, оставшихся пустыми, —
// AI-оценка. Уже заполненные группы не перезаписываются.
async function enrichProductMicronutrients(product: { id: string; name: string; fiber?: number | null; micronutrients?: any }) {
  const existingRaw = parseMicronutrients(product.micronutrients);
  const existingMicro = buildCompleteMicronutrients(existingRaw, product.fiber);
  const merged: Record<string, Record<string, number>> = JSON.parse(JSON.stringify(existingMicro));
  const nutrientSources: Record<string, string> = { ...(existingRaw?.nutrientSources || {}) };
  let changed = false;

  const usdaMicro = await fetchUsdaMicronutrientsByName(product.name);
  if (usdaMicro) {
    const usdaComplete = buildCompleteMicronutrients(usdaMicro, product.fiber);
    for (const groupKey of Object.keys(merged)) {
      // Целиком пустую группу заполняем полностью.
      if (!hasAnyPositiveValue(merged[groupKey]) && hasAnyPositiveValue((usdaComplete as any)[groupKey])) {
        merged[groupKey] = (usdaComplete as any)[groupKey];
        nutrientSources[groupKey] = "usda_fdc";
        changed = true;
        continue;
      }
      // Точечная заливка: заполняем КАЖДЫЙ нулевой нутриент, для которого в USDA есть
      // значение — так закрываются пробелы вроде отсутствующего B12 у продукта, где
      // остальные витамины уже заполнены (USDA — точные данные, переписываем все нули).
      const usdaGroup = (usdaComplete as any)[groupKey] || {};
      for (const key of Object.keys(merged[groupKey])) {
        if (numberOrZero(merged[groupKey][key]) <= 0 && numberOrZero(usdaGroup[key]) > 0) {
          merged[groupKey][key] = usdaGroup[key];
          nutrientSources[`${groupKey}.${key}`] = "usda_fdc";
          changed = true;
        }
      }
    }
  }

  // Что не покрыл USDA, добираем AI-оценкой (менее точно, но лучше нулей) — если осталась
  // пустая группа целиком ИЛИ пробел по ключевым нутриентам (напр. B12).
  if (hasEmptyMicronutrientGroup(merged as any) || hasMissingKeyMicronutrients(merged as any)) {
    const estimatedMicro = await estimateMicronutrientsWithAI(product);
    if (estimatedMicro) {
      // Целиком пустые группы заполняем полностью.
      for (const groupKey of Object.keys(merged)) {
        if (!hasAnyPositiveValue(merged[groupKey]) && hasAnyPositiveValue((estimatedMicro as any)[groupKey])) {
          merged[groupKey] = (estimatedMicro as any)[groupKey];
          nutrientSources[groupKey] = "ai_estimate";
          changed = true;
        }
      }
      // Точечные нули по ключевым нутриентам добираем из AI-оценки (не заливаем все нули
      // подряд AI-догадками — только то, что пользователи реально смотрят).
      for (const [groupKey, keys] of Object.entries(KEY_MICRONUTRIENTS)) {
        const estGroup = (estimatedMicro as any)[groupKey] || {};
        for (const key of keys) {
          if (numberOrZero(merged[groupKey]?.[key]) <= 0 && numberOrZero(estGroup[key]) > 0) {
            merged[groupKey][key] = estGroup[key];
            nutrientSources[`${groupKey}.${key}`] = "ai_estimate";
            changed = true;
          }
        }
      }
    }
  }

  if (!changed) return false;

  await prisma.product.update({
    where: { id: product.id },
    data: { micronutrients: JSON.stringify({ ...merged, nutrientSources }) },
  });
  return true;
}

export function micronutrientRetryDelayMs(attempt: number) {
  return Math.min(60 * 60 * 1000, 60 * 1000 * 2 ** Math.max(0, attempt - 1));
}

async function enqueueMicronutrientEnrichment(productId: string, force = false) {
  if (!isDatabaseConfigured() || !productId) return false;
  const jobs = (prisma as any).micronutrientEnrichmentJob;
  const existing = await jobs.findUnique({ where: { productId } });
  if (existing && !force && ["PENDING", "RETRY", "PROCESSING", "COMPLETED"].includes(existing.status)) {
    return false;
  }

  await jobs.upsert({
    where: { productId },
    update: {
      status: "PENDING",
      attempts: 0,
      nextAttemptAt: new Date(),
      lockedAt: null,
      lastError: null,
      completedAt: null,
    },
    create: { productId },
  });
  return true;
}

async function enrichProductMicronutrientsInBackground(product: { id: string }) {
  return enqueueMicronutrientEnrichment(product.id);
}

async function processNextMicronutrientJob() {
  const jobs = (prisma as any).micronutrientEnrichmentJob;
  const now = new Date();
  const candidate = await jobs.findFirst({
    where: { status: { in: ["PENDING", "RETRY"] }, nextAttemptAt: { lte: now } },
    orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
  });
  if (!candidate) return false;

  const claimed = await jobs.updateMany({
    where: { id: candidate.id, status: { in: ["PENDING", "RETRY"] }, nextAttemptAt: { lte: now } },
    data: { status: "PROCESSING", lockedAt: now },
  });
  if (claimed.count !== 1) return true;

  try {
    const product = await prisma.product.findUnique({ where: { id: candidate.productId } });
    if (!product) {
      await jobs.delete({ where: { id: candidate.id } });
      return true;
    }
    await enrichProductMicronutrients(product);
    await jobs.update({
      where: { id: candidate.id },
      data: { status: "COMPLETED", completedAt: new Date(), lockedAt: null, lastError: null },
    });
  } catch (error: any) {
    const attempts = Number(candidate.attempts || 0) + 1;
    const exhausted = attempts >= Number(candidate.maxAttempts || 5);
    await jobs.update({
      where: { id: candidate.id },
      data: {
        status: exhausted ? "FAILED" : "RETRY",
        attempts,
        nextAttemptAt: new Date(Date.now() + micronutrientRetryDelayMs(attempts)),
        lockedAt: null,
        lastError: String(error?.message || error).slice(0, 2000),
      },
    });
    logError("Micronutrient queue job failed:", error);
  }
  return true;
}

async function runMicronutrientQueueBatch(limit = 10) {
  if (!isDatabaseConfigured() || micronutrientQueueWorkerRunning) return 0;
  micronutrientQueueWorkerRunning = true;
  let processed = 0;
  try {
    const staleBefore = new Date(Date.now() - 15 * 60 * 1000);
    await (prisma as any).micronutrientEnrichmentJob.updateMany({
      where: { status: "PROCESSING", lockedAt: { lt: staleBefore } },
      data: { status: "RETRY", lockedAt: null, nextAttemptAt: new Date() },
    });
    while (processed < limit && await processNextMicronutrientJob()) processed += 1;
  } finally {
    micronutrientQueueWorkerRunning = false;
  }
  return processed;
}

async function estimateMicronutrientsWithAI(product: { name: string; fiber?: number | null }) {
  try {
    const estimateResponseText = await withTimeout(generateAI(`Оцени полный микроэлементный состав продукта "${product.name}" на 100 г.
Верни только JSON со структурой:
{
  "vitamins": { "BetaCarotene": number, "B1": number, "B2": number, "B5": number, "B6": number, "B9": number, "B12": number, "C": number, "A": number, "D": number, "E": number, "K": number, "B3": number, "Biotin": number, "Choline": number },
  "minerals": { "Potassium": number, "Calcium": number, "Silicon": number, "Magnesium": number, "Sodium": number, "Sulfur": number, "Phosphorus": number, "Chlorine": number, "Vanadium": number, "Iron": number, "Iodine": number, "Cobalt": number, "Manganese": number, "Copper": number, "Molybdenum": number, "Selenium": number, "Chromium": number, "Zinc": number, "Salt": number },
  "fattyAcids": { "Omega3": number, "Omega6": number, "Omega9": number, "TransFats": number, "Cholesterol": number },
  "carbohydrateTypes": { "Glucose": number, "Fructose": number, "Galactose": number, "Sucrose": number, "Lactose": number, "Maltose": number, "Starch": number, "Fiber": number },
  "aminoAcids": { "Alanine": number, "Arginine": number, "Asparagine": number, "AsparticAcid": number, "Valine": number, "Histidine": number, "Glycine": number, "Glutamine": number, "GlutamicAcid": number, "Isoleucine": number, "Leucine": number, "Lysine": number, "Methionine": number, "Proline": number, "Serine": number, "Tyrosine": number, "Threonine": number, "Tryptophan": number, "Phenylalanine": number, "Cysteine": number }
}
Единицы: витамины и большинство минералов в mg/mcg как принято в таблицах состава продуктов, аминокислоты и жирные кислоты в mg. Если нутриент отсутствует в продукте — укажи 0.`), 12000, "AI micronutrient enrichment");

    const estimateData = parseAiJsonPayload(estimateResponseText || "{}");
    const estimatedMicro = buildCompleteMicronutrients(estimateData, product.fiber);
    return isMicronutrientDataEffectivelyEmpty(estimatedMicro) ? null : estimatedMicro;
  } catch (e) {
    logError("AI micronutrient estimation error:", e);
    throw e;
  }
}

// Пакетная докомплектация всей базы: продукты с хотя бы одной пустой группой
// микроэлементов прогоняются через ту же цепочку USDA → AI. Пауза между продуктами
// щадит лимиты USDA (1000 запросов/час) и AI-провайдеров. Запуск — админ-эндпоинтом
// или env MICRONUTRIENT_BACKFILL_ON_BOOT (см. регистрацию роутов).
let micronutrientBackfillRunning = false;
async function runMicronutrientBackfill(limit = 200) {
  if (!isDatabaseConfigured()) return { processed: 0, scanned: 0, skipped: "no database" };
  if (micronutrientBackfillRunning) return { processed: 0, scanned: 0, skipped: "already running" };
  micronutrientBackfillRunning = true;

  let processed = 0;
  let scanned = 0;
  try {
    let cursor: string | undefined;
    while (processed < limit) {
      const page: any[] = await prisma.product.findMany({
        take: 500,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: "asc" },
      });
      if (page.length === 0) break;
      cursor = page[page.length - 1].id;

      for (const product of page) {
        if (processed >= limit) break;
        scanned += 1;
        const micro = buildCompleteMicronutrients(parseMicronutrients(product.micronutrients), product.fiber);
        if (!hasEmptyMicronutrientGroup(micro)) continue;
        const enqueued = await enrichProductMicronutrientsInBackground(product);
        if (!enqueued) continue;
        processed += 1;
        if (processed % 25 === 0) {
          console.log(`[micronutrient-backfill] processed ${processed}/${limit} (scanned ${scanned})`);
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
  } finally {
    micronutrientBackfillRunning = false;
  }
  console.log(`[micronutrient-backfill] finished: processed ${processed}, scanned ${scanned}`);
  return { processed, scanned };
}

function convertNutrientUnit(value: number, fromUnitRaw: any, targetUnitRaw: "mg" | "mcg" | "g") {
  const fromUnit = normalizeUnitName(fromUnitRaw);
  const targetUnit = normalizeUnitName(targetUnitRaw);
  if (!Number.isFinite(value)) return 0;

  if (!fromUnit || fromUnit === targetUnit) return value;

  if (fromUnit === "g") {
    if (targetUnit === "mg") return value * 1000;
    if (targetUnit === "mcg") return value * 1_000_000;
  }

  if (fromUnit === "mg") {
    if (targetUnit === "g") return value / 1000;
    if (targetUnit === "mcg") return value * 1000;
  }

  if (fromUnit === "mcg" || fromUnit === "ug" || fromUnit === "µg") {
    if (targetUnit === "mg") return value / 1000;
    if (targetUnit === "g") return value / 1_000_000;
  }

  if (fromUnit === "iu") {
    // Keep value as-is for IU when no robust conversion context is available.
    return value;
  }

  return value;
}

function pickUsdaNutrient(
  food: any,
  options: {
    ids?: number[];
    nutrientNumbers?: string[];
    nameIncludes?: string[];
    targetUnit?: "mg" | "mcg" | "g";
  }
) {
  const nutrients = Array.isArray(food?.foodNutrients) ? food.foodNutrients : [];
  const idSet = new Set((options.ids || []).map((v) => Number(v)));
  const numSet = new Set((options.nutrientNumbers || []).map((v) => String(v).trim()));
  const names = (options.nameIncludes || []).map((v) => String(v).toLowerCase());

  const hit = nutrients.find((n: any) => {
    const id = Number(n?.nutrientId);
    const num = String(n?.nutrientNumber || "").trim();
    const name = String(n?.nutrientName || n?.name || "").toLowerCase();

    if (idSet.size > 0 && idSet.has(id)) return true;
    if (numSet.size > 0 && numSet.has(num)) return true;
    if (names.length > 0 && names.some((part) => name.includes(part))) return true;
    return false;
  });

  if (!hit) return 0;

  const raw = numberOrZero(hit?.value);
  if (!raw) return 0;
  if (!options.targetUnit) return raw;
  return convertNutrientUnit(raw, hit?.unitName, options.targetUnit);
}

export function extractUsdaExtendedNutrients(food: any) {
  const vitamins: any = {};
  const minerals: any = {};
  const aminoAcids: any = {};
  const fattyAcids: any = {};
  const carbohydrateTypes: any = {};

  vitamins.BetaCarotene = pickUsdaNutrient(food, {
    ids: [1107],
    nutrientNumbers: ["321", "334"],
    nameIncludes: ["beta-carotene", "beta carotene", "carotene, beta"],
    targetUnit: "mcg"
  });
  vitamins.B1 = pickUsdaNutrient(food, { ids: [1165], nutrientNumbers: ["404"], nameIncludes: ["thiamin", "vitamin b-1"], targetUnit: "mg" });
  vitamins.B2 = pickUsdaNutrient(food, { ids: [1166], nutrientNumbers: ["405"], nameIncludes: ["riboflavin", "vitamin b-2"], targetUnit: "mg" });
  vitamins.B5 = pickUsdaNutrient(food, { ids: [1170], nutrientNumbers: ["410"], nameIncludes: ["pantothenic"], targetUnit: "mg" });
  vitamins.B6 = pickUsdaNutrient(food, { ids: [1175], nutrientNumbers: ["415"], nameIncludes: ["vitamin b-6", "pyridoxine"], targetUnit: "mg" });
  vitamins.B9 = pickUsdaNutrient(food, { ids: [1177], nutrientNumbers: ["417"], nameIncludes: ["folate"], targetUnit: "mcg" });
  vitamins.B12 = pickUsdaNutrient(food, { ids: [1178], nutrientNumbers: ["418"], nameIncludes: ["vitamin b-12", "cobalamin"], targetUnit: "mcg" });
  vitamins.C = pickUsdaNutrient(food, { ids: [1162], nutrientNumbers: ["401"], nameIncludes: ["vitamin c", "ascorbic acid"], targetUnit: "mg" });
  vitamins.A = pickUsdaNutrient(food, { ids: [1104], nutrientNumbers: ["320"], nameIncludes: ["vitamin a"], targetUnit: "mcg" });
  vitamins.D = pickUsdaNutrient(food, { ids: [1114], nutrientNumbers: ["324", "328"], nameIncludes: ["vitamin d"], targetUnit: "mcg" });
  vitamins.E = pickUsdaNutrient(food, { ids: [1109], nutrientNumbers: ["323"], nameIncludes: ["vitamin e", "tocopherol"], targetUnit: "mg" });
  vitamins.K = pickUsdaNutrient(food, { ids: [1185], nutrientNumbers: ["430"], nameIncludes: ["vitamin k"], targetUnit: "mcg" });
  vitamins.B3 = pickUsdaNutrient(food, { ids: [1167], nutrientNumbers: ["406"], nameIncludes: ["niacin", "vitamin b-3"], targetUnit: "mg" });
  vitamins.Biotin = pickUsdaNutrient(food, { ids: [1176], nutrientNumbers: ["416"], nameIncludes: ["biotin", "vitamin b-7", "vitamin h"], targetUnit: "mcg" });
  vitamins.Choline = pickUsdaNutrient(food, { ids: [1180], nutrientNumbers: ["421", "326"], nameIncludes: ["choline"], targetUnit: "mg" });

  minerals.Potassium = pickUsdaNutrient(food, { ids: [1092], nutrientNumbers: ["306"], nameIncludes: ["potassium"], targetUnit: "mg" });
  minerals.Calcium = pickUsdaNutrient(food, { ids: [1087], nutrientNumbers: ["301"], nameIncludes: ["calcium"], targetUnit: "mg" });
  minerals.Silicon = pickUsdaNutrient(food, { nameIncludes: ["silicon", "silica", "silicon, si"], targetUnit: "mg" });
  minerals.Magnesium = pickUsdaNutrient(food, { ids: [1090], nutrientNumbers: ["304"], nameIncludes: ["magnesium"], targetUnit: "mg" });
  minerals.Sodium = pickUsdaNutrient(food, { ids: [1093], nutrientNumbers: ["307"], nameIncludes: ["sodium"], targetUnit: "mg" });
  minerals.Sulfur = pickUsdaNutrient(food, { nameIncludes: ["sulfur", "sulphur", "sulfur, s"], targetUnit: "mg" });
  minerals.Phosphorus = pickUsdaNutrient(food, { ids: [1091], nutrientNumbers: ["305"], nameIncludes: ["phosphorus"], targetUnit: "mg" });
  minerals.Chlorine = pickUsdaNutrient(food, { ids: [1088], nutrientNumbers: ["308"], nameIncludes: ["chloride", "chlorine"], targetUnit: "mg" });
  minerals.Vanadium = pickUsdaNutrient(food, { nameIncludes: ["vanadium", "vanadium, v"], targetUnit: "mcg" });
  minerals.Iron = pickUsdaNutrient(food, { ids: [1089], nutrientNumbers: ["303"], nameIncludes: ["iron"], targetUnit: "mg" });
  minerals.Iodine = pickUsdaNutrient(food, { ids: [1100], nutrientNumbers: ["314"], nameIncludes: ["iodine", "iodide"], targetUnit: "mcg" });
  minerals.Cobalt = pickUsdaNutrient(food, { nameIncludes: ["cobalt", "cobalt, co"], targetUnit: "mcg" });
  minerals.Manganese = pickUsdaNutrient(food, { ids: [1101], nutrientNumbers: ["315"], nameIncludes: ["manganese"], targetUnit: "mg" });
  minerals.Copper = pickUsdaNutrient(food, { ids: [1098], nutrientNumbers: ["312"], nameIncludes: ["copper"], targetUnit: "mg" });
  minerals.Molybdenum = pickUsdaNutrient(food, { ids: [1102], nutrientNumbers: ["316"], nameIncludes: ["molybdenum", "molybdenum, mo"], targetUnit: "mcg" });
  minerals.Selenium = pickUsdaNutrient(food, { ids: [1103], nutrientNumbers: ["317"], nameIncludes: ["selenium"], targetUnit: "mcg" });
  minerals.Chromium = pickUsdaNutrient(food, { ids: [1096], nutrientNumbers: ["313"], nameIncludes: ["chromium", "chromium, cr"], targetUnit: "mcg" });
  minerals.Zinc = pickUsdaNutrient(food, { ids: [1095], nutrientNumbers: ["309"], nameIncludes: ["zinc"], targetUnit: "mg" });

  const sodiumMg = numberOrZero(minerals.Sodium);
  if (sodiumMg > 0) {
    minerals.Salt = sodiumMg * 2.5;
  }

  fattyAcids.Omega3 = pickUsdaNutrient(food, {
    ids: [1272],
    nutrientNumbers: ["629"],
    nameIncludes: ["omega-3", "18:3 n-3", "22:6 n-3", "20:5 n-3"],
    targetUnit: "g"
  });
  fattyAcids.Omega6 = pickUsdaNutrient(food, {
    ids: [1277],
    nutrientNumbers: ["672"],
    nameIncludes: ["omega-6", "18:2 n-6", "20:4 n-6"],
    targetUnit: "g"
  });
  fattyAcids.Omega9 = pickUsdaNutrient(food, {
    nutrientNumbers: ["645"],
    nameIncludes: ["omega-9", "monounsaturated", "18:1"],
    targetUnit: "g"
  });
  fattyAcids.TransFats = pickUsdaNutrient(food, {
    ids: [1257],
    nutrientNumbers: ["605"],
    nameIncludes: ["fatty acids, total trans", "trans"],
    targetUnit: "g"
  });
  fattyAcids.Cholesterol = pickUsdaNutrient(food, {
    ids: [1253],
    nutrientNumbers: ["601"],
    nameIncludes: ["cholesterol"],
    targetUnit: "mg"
  });

  carbohydrateTypes.Glucose = pickUsdaNutrient(food, {
    nutrientNumbers: ["2114"],
    nameIncludes: ["glucose", "dextrose"],
    targetUnit: "g"
  });
  carbohydrateTypes.Fructose = pickUsdaNutrient(food, {
    nutrientNumbers: ["2122", "2124"],
    nameIncludes: ["fructose"],
    targetUnit: "g"
  });
  carbohydrateTypes.Galactose = pickUsdaNutrient(food, {
    nutrientNumbers: ["2117"],
    nameIncludes: ["galactose"],
    targetUnit: "g"
  });
  carbohydrateTypes.Sucrose = pickUsdaNutrient(food, {
    nutrientNumbers: ["2100"],
    nameIncludes: ["sucrose"],
    targetUnit: "g"
  });
  carbohydrateTypes.Lactose = pickUsdaNutrient(food, {
    nutrientNumbers: ["2134"],
    nameIncludes: ["lactose"],
    targetUnit: "g"
  });
  carbohydrateTypes.Maltose = pickUsdaNutrient(food, {
    nutrientNumbers: ["2145"],
    nameIncludes: ["maltose"],
    targetUnit: "g"
  });
  carbohydrateTypes.Starch = pickUsdaNutrient(food, {
    nutrientNumbers: ["2098"],
    nameIncludes: ["starch"],
    targetUnit: "g"
  });
  carbohydrateTypes.Fiber = pickUsdaNutrient(food, {
    ids: [1079],
    nutrientNumbers: ["291"],
    nameIncludes: ["fiber", "dietary fiber"],
    targetUnit: "g"
  });

  aminoAcids.Alanine = pickUsdaNutrient(food, { ids: [1222], nutrientNumbers: ["513"], nameIncludes: ["alanine"], targetUnit: "mg" });
  aminoAcids.Arginine = pickUsdaNutrient(food, { ids: [1220], nutrientNumbers: ["511"], nameIncludes: ["arginine"], targetUnit: "mg" });
  aminoAcids.Asparagine = pickUsdaNutrient(food, { nameIncludes: ["asparagine"], targetUnit: "mg" });
  aminoAcids.AsparticAcid = pickUsdaNutrient(food, { ids: [1223], nutrientNumbers: ["514"], nameIncludes: ["aspartic acid"], targetUnit: "mg" });
  aminoAcids.Valine = pickUsdaNutrient(food, { ids: [1219], nutrientNumbers: ["510"], nameIncludes: ["valine"], targetUnit: "mg" });
  aminoAcids.Histidine = pickUsdaNutrient(food, { ids: [1221], nutrientNumbers: ["512"], nameIncludes: ["histidine"], targetUnit: "mg" });
  aminoAcids.Glycine = pickUsdaNutrient(food, { ids: [1225], nutrientNumbers: ["516"], nameIncludes: ["glycine"], targetUnit: "mg" });
  aminoAcids.Glutamine = pickUsdaNutrient(food, { nameIncludes: ["glutamine"], targetUnit: "mg" });
  aminoAcids.GlutamicAcid = pickUsdaNutrient(food, { ids: [1224], nutrientNumbers: ["515"], nameIncludes: ["glutamic acid"], targetUnit: "mg" });
  aminoAcids.Isoleucine = pickUsdaNutrient(food, { ids: [1212], nutrientNumbers: ["503"], nameIncludes: ["isoleucine"], targetUnit: "mg" });
  aminoAcids.Leucine = pickUsdaNutrient(food, { ids: [1213], nutrientNumbers: ["504"], nameIncludes: ["leucine"], targetUnit: "mg" });
  aminoAcids.Lysine = pickUsdaNutrient(food, { ids: [1214], nutrientNumbers: ["505"], nameIncludes: ["lysine"], targetUnit: "mg" });
  aminoAcids.Methionine = pickUsdaNutrient(food, { ids: [1215], nutrientNumbers: ["506"], nameIncludes: ["methionine"], targetUnit: "mg" });
  aminoAcids.Proline = pickUsdaNutrient(food, { ids: [1226], nutrientNumbers: ["517"], nameIncludes: ["proline"], targetUnit: "mg" });
  aminoAcids.Serine = pickUsdaNutrient(food, { ids: [1227], nutrientNumbers: ["518"], nameIncludes: ["serine"], targetUnit: "mg" });
  aminoAcids.Tyrosine = pickUsdaNutrient(food, { ids: [1218], nutrientNumbers: ["509"], nameIncludes: ["tyrosine"], targetUnit: "mg" });
  aminoAcids.Threonine = pickUsdaNutrient(food, { ids: [1211], nutrientNumbers: ["502"], nameIncludes: ["threonine"], targetUnit: "mg" });
  aminoAcids.Tryptophan = pickUsdaNutrient(food, { ids: [1210], nutrientNumbers: ["501"], nameIncludes: ["tryptophan"], targetUnit: "mg" });
  aminoAcids.Phenylalanine = pickUsdaNutrient(food, { ids: [1217], nutrientNumbers: ["508"], nameIncludes: ["phenylalanine"], targetUnit: "mg" });
  aminoAcids.Cysteine = pickUsdaNutrient(food, { ids: [1216], nutrientNumbers: ["507"], nameIncludes: ["cysteine", "cystine"], targetUnit: "mg" });

  const compactObject = (obj: Record<string, any>) =>
    Object.fromEntries(Object.entries(obj).filter(([, value]) => numberOrZero(value) > 0));

  return {
    vitamins: compactObject(vitamins),
    minerals: compactObject(minerals),
    aminoAcids: compactObject(aminoAcids),
    fattyAcids: compactObject(fattyAcids),
    carbohydrateTypes: compactObject(carbohydrateTypes),
  };
}

export function normalizeOpenFoodFactsProduct(rawProduct: any, barcode: string) {
  const nutr = rawProduct?.nutriments || {};

  const protein = numberOrZero(nutr["proteins_100g"]);
  const fat = numberOrZero(nutr["fat_100g"]);
  const carbs = numberOrZero(nutr["carbohydrates_100g"]);
  const fiber = numberOrZero(nutr["fiber_100g"]);

  // Калорийность: kcal на 100 г → просто kcal → пересчёт из кДж → оценка по Атуотеру.
  // OFF (крауд-данные) часто хранит энергию только в кДж или вовсе без неё, из-за чего
  // калорийность приходила нулевой. 1 ккал = 4.184 кДж; Атуотер: 4/4/9 ккал на г Б/У/Ж.
  const atwater = protein * 4 + carbs * 4 + fat * 9;
  let calories = numberOrZero(nutr["energy-kcal_100g"] ?? nutr["energy-kcal"]);
  const kj = numberOrZero(nutr["energy-kj_100g"] ?? nutr["energy-kj"] ?? nutr["energy_100g"]);
  if (!calories && kj) calories = Math.round(kj / 4.184);
  if (!calories && atwater) calories = Math.round(atwater);

  // Флаг «сверьте с упаковкой»: данные OFF заполняются пользователями и часто расходятся
  // с этикеткой (напр. сухарики "Хрустим" пришли с У 94.7 г — физически невозможно при
  // жирах 16 г). Помечаем явно подозрительные случаи: сумма Б+Ж+У > 105 г на 100 г,
  // либо все макросы нулевые, либо заявленная калорийность сильно расходится с оценкой
  // по макронутриентам. Приложение по этому флагу предложит проверить и поправить.
  const macroSum = protein + fat + carbs;
  const kcalMismatch = atwater > 0 && calories > 0 && Math.abs(calories - atwater) / atwater > 0.3;
  const needsReview = macroSum > 105 || macroSum <= 0 || kcalMismatch;

  return {
    id: `off-${barcode}`,
    name:
      rawProduct?.product_name_ru ||
      rawProduct?.product_name ||
      rawProduct?.generic_name_ru ||
      rawProduct?.generic_name ||
      `Product ${barcode}`,
    brand: rawProduct?.brands || "OpenFoodFacts",
    calories,
    protein,
    fat,
    carbs,
    fiber,
    barcode,
    isUsda: true,
    needsReview,
    source: "openfoodfacts"
  };
}

async function fetchOffRawProduct(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BARCODE_LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const payload: any = await response.json().catch(() => null);
    if (!payload || payload.status !== 1 || !payload.product) return null;
    return payload.product;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Полная ли карточка OFF: есть осмысленное название и все четыре макроса (ккал/Б/Ж/У).
// Если да — второй инстанс OFF можно не запрашивать (экономим латентность); если нет —
// добираем недостающее из другого инстанса (см. mergeOffRawProducts).
function isOffRawComplete(raw: any): boolean {
  const nutr = raw?.nutriments || {};
  const hasName = Boolean(raw?.product_name_ru || raw?.product_name || raw?.generic_name_ru || raw?.generic_name);
  const kcal = numberOrZero(nutr["energy-kcal_100g"] ?? nutr["energy-kcal"]) || numberOrZero(nutr["energy-kj_100g"] ?? nutr["energy_100g"]);
  const hasMacros = numberOrZero(nutr["proteins_100g"]) > 0 && numberOrZero(nutr["fat_100g"]) > 0 && numberOrZero(nutr["carbohydrates_100g"]) > 0;
  return hasName && kcal > 0 && hasMacros;
}

// Склейка нескольких карточек OFF (ru + world) в самую полную: имя/бренд — первое
// непустое (с приоритетом русских полей за счёт порядка), нутриенты — поле за полем,
// причём пустое или нулевое значение можно заменить осмысленным из другого инстанса
// (в OFF отсутствующий нутриент часто приходит как 0). Инстансы OFF нередко содержат
// разные по полноте карточки одного товара, и раньше бралась просто первая ответившая.
function mergeOffRawProducts(raws: any[]): any {
  const merged: any = { nutriments: {} };
  const scalarKeys = ["product_name_ru", "product_name", "generic_name_ru", "generic_name", "brands"];
  for (const raw of raws) {
    if (!raw) continue;
    for (const key of scalarKeys) {
      if (!merged[key] && raw[key]) merged[key] = raw[key];
    }
    const nutr = raw.nutriments || {};
    for (const [k, v] of Object.entries(nutr)) {
      if (v === undefined || v === null || v === "") continue;
      const cur = merged.nutriments[k];
      const curNum = Number(cur);
      const vNum = Number(v);
      const curEmpty = cur === undefined || cur === null || cur === "";
      if (curEmpty || (curNum === 0 && Number.isFinite(vNum) && vNum !== 0)) {
        merged.nutriments[k] = v;
      }
    }
  }
  return merged;
}

async function fetchOpenFoodFactsProduct(barcode: string) {
  const ruUrl = `https://ru.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?lc=${BARCODE_PREFERRED_LANG}&cc=${BARCODE_PREFERRED_COUNTRY}`;
  const worldUrl = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?lc=${BARCODE_PREFERRED_LANG}&cc=${BARCODE_PREFERRED_COUNTRY}`;

  const ruRaw = await fetchOffRawProduct(ruUrl);
  // Второй инстанс запрашиваем, только если русская карточка отсутствует или неполная —
  // тогда объединяем обе в максимально полную запись.
  const worldRaw = (!ruRaw || !isOffRawComplete(ruRaw)) ? await fetchOffRawProduct(worldUrl) : null;

  const raws = [ruRaw, worldRaw].filter(Boolean);
  if (raws.length === 0) return null;

  const source = raws.length === 1 ? raws[0] : mergeOffRawProducts(raws);
  return normalizeOpenFoodFactsProduct(source, barcode);
}

async function upsertProductFromBarcodeLookup(product: any) {
  if (!isDatabaseConfigured()) return null;
  if (!product?.barcode || !product?.name) return null;

  const micronutrients = typeof product.micronutrients === "string"
    ? product.micronutrients
    : product.micronutrients
      ? JSON.stringify(product.micronutrients)
      : "{}";

  try {
    return await prisma.product.upsert({
      where: { barcode: String(product.barcode) },
      update: {
        name: String(product.name),
        brand: product.brand ? String(product.brand) : null,
        calories: numberOrZero(product.calories),
        protein: numberOrZero(product.protein),
        fat: numberOrZero(product.fat),
        carbs: numberOrZero(product.carbs),
        fiber: numberOrZero(product.fiber),
        ...(product.micronutrients ? { micronutrients } : {}),
      },
      create: {
        name: String(product.name),
        brand: product.brand ? String(product.brand) : null,
        barcode: String(product.barcode),
        calories: numberOrZero(product.calories),
        protein: numberOrZero(product.protein),
        fat: numberOrZero(product.fat),
        carbs: numberOrZero(product.carbs),
        fiber: numberOrZero(product.fiber),
        // Сохраняем источник (openfoodfacts/usda_branded/ai_estimate), иначе запись
        // получала бы дефолтный "catalog" и приложение не понимало бы, что данные из
        // открытой базы/AI-оценки и их стоит предложить сверить с упаковкой.
        source: product.source ? String(product.source) : "catalog",
        micronutrients
      }
    });
  } catch (e) {
    console.warn("Failed to upsert barcode product:", e);
    return null;
  }
}

// USDA FoodData Central — Branded Foods, по штрихкоду (gtinUpc), без полного импорта датасета.
// Branded Foods слишком большой для бакового импорта на бесплатном тире (см. import-usda.ts),
// поэтому добиваем его точечно: один штрихкод -> один запрос к /v1/foods/search?dataType=Branded.
function normalizeUsdaBrandedProduct(food: any, barcode: string) {
  const getNutrient = (id: number) =>
    food.foodNutrients?.find((n: any) => n.nutrientId === id || n.nutrientNumber === String(id))?.value || 0;
  const extended = extractUsdaExtendedNutrients(food);
  const fiber = getNutrient(1079) || getNutrient(291);
  const completedMicro = buildCompleteMicronutrients({
    vitamins: extended.vitamins,
    minerals: extended.minerals,
    aminoAcids: extended.aminoAcids,
    fattyAcids: extended.fattyAcids,
    carbohydrateTypes: extended.carbohydrateTypes,
  }, fiber);

  return {
    id: `usda-branded-${food.fdcId}`,
    name: food.description || `Product ${barcode}`,
    brand: food.brandOwner || food.brandName || "USDA Branded",
    calories: getNutrient(1008) || getNutrient(208),
    protein: getNutrient(1003) || getNutrient(203),
    fat: getNutrient(1004) || getNutrient(204),
    carbs: getNutrient(1005) || getNutrient(205),
    fiber,
    micronutrients: JSON.stringify(completedMicro),
    barcode,
    isUsda: true,
    source: "usda_branded",
  };
}

async function fetchUsdaBrandedProduct(barcode: string) {
  const usdaKey = process.env.USDA_FDC_API_KEY;
  if (!usdaKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BARCODE_LOOKUP_TIMEOUT_MS);

  try {
    const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${usdaKey}&query=${encodeURIComponent(barcode)}&dataType=Branded&pageSize=5`;
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;

    const data: any = await response.json().catch(() => null);
    const foods = Array.isArray(data?.foods) ? data.foods : [];
    // Ищем точное совпадение по gtinUpc (с учётом ведущих нулей), иначе берём первый результат.
    const normalizedBarcode = barcode.replace(/^0+/, "");
    const exact = foods.find((f: any) => {
      const gtin = String(f?.gtinUpc || "").replace(/^0+/, "");
      return gtin && gtin === normalizedBarcode;
    });
    const food = exact || foods[0];
    if (!food) return null;

    return normalizeUsdaBrandedProduct(food, barcode);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isBarcodeProductNutritionallyEmpty(product: any): boolean {
  const macros = numberOrZero(product?.protein) + numberOrZero(product?.fat) + numberOrZero(product?.carbs);
  return numberOrZero(product?.calories) <= 0 && macros <= 0;
}

// Штрихкод дал название, но нутриенты пустые — частый случай российских товаров в
// открытых базах (карточка есть, КБЖУ нет). Бесплатный фоллбэк: дооцениваем КБЖУ по
// названию через AI (на текущих ключах, без внешних платных каталогов) и помечаем как
// приблизительную оценку, чтобы приложение предложило сверить с упаковкой. Не оцениваем,
// если нутриенты уже есть или название — заглушка вида "Product 460..." (оценивать нечего).
async function enrichBarcodeProductWithAiEstimate(product: any): Promise<any> {
  if (!product || !isBarcodeProductNutritionallyEmpty(product)) return product;
  const name = String(product.name || "").trim();
  if (!name || /^product\s+\d/i.test(name)) return product;

  const est = await aiEstimateNutrientsByName(name);
  if (!est) return product;

  const fiber = numberOrZero(est.fiber);
  return {
    ...product,
    calories: numberOrZero(est.calories),
    protein: numberOrZero(est.protein),
    fat: numberOrZero(est.fat),
    carbs: numberOrZero(est.carbs),
    fiber,
    micronutrients: JSON.stringify(buildCompleteMicronutrients(est, fiber)),
    source: "ai_estimate",
    isAiEstimated: true,
    needsReview: true,
    explanation: est.explanation || "Приблизительная AI-оценка по названию — сверьте с упаковкой.",
  };
}

// Собираем ответ по штрихкоду: сохранённая запись теряет эфемерные флаги (needsReview,
// isAiEstimated, explanation — это не колонки БД), поэтому переносим их с исходного продукта.
function buildBarcodeResponseProduct(persisted: any, sourceProduct: any) {
  const base = persisted || sourceProduct;
  return {
    ...base,
    needsReview: sourceProduct.needsReview,
    isAiEstimated: sourceProduct.isAiEstimated,
    explanation: sourceProduct.explanation,
  };
}

// Единая цепочка источников для штрихкода: кэш -> локальная база -> OpenFoodFacts ->
// USDA Branded -> AI-оценка КБЖУ по названию (если источник дал только название).
async function resolveBarcodeProduct(candidates: string[]) {
  const cached = getCachedBarcodeProduct(candidates);
  if (cached) return { product: cached, isNew: false };

  if (isDatabaseConfigured()) {
    const dbProduct = await prisma.product.findFirst({ where: { barcode: { in: candidates } } });
    if (dbProduct) {
      cacheBarcodeProduct(candidates, dbProduct);
      return { product: dbProduct, isNew: false };
    }
  }

  for (const candidate of candidates) {
    const offProduct = await fetchOpenFoodFactsProduct(candidate);
    if (offProduct) {
      const enriched = await enrichBarcodeProductWithAiEstimate(offProduct);
      const persisted = await upsertProductFromBarcodeLookup(enriched);
      const responseProduct = buildBarcodeResponseProduct(persisted, enriched);
      cacheBarcodeProduct(candidates, responseProduct);
      return { product: responseProduct, isNew: true };
    }

    const usdaProduct = await fetchUsdaBrandedProduct(candidate);
    if (usdaProduct) {
      const enriched = await enrichBarcodeProductWithAiEstimate(usdaProduct);
      const persisted = await upsertProductFromBarcodeLookup(enriched);
      const responseProduct = buildBarcodeResponseProduct(persisted, enriched);
      cacheBarcodeProduct(candidates, responseProduct);
      return { product: responseProduct, isNew: true };
    }
  }

  return { product: null, isNew: false };
}

// AI Helper: Unified AI Generation with Fallback (Gemini -> DeepSeek -> OpenAI)
async function generateAI(prompt: string, responseMimeType: string = "application/json", image?: { data: string, mimeType: string }) {
  // For image recognition quality: prioritize OpenAI Vision first, then Gemini fallback.
  if (image) {
    if (openai) {
      try {
        const messages: any[] = [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.data}` } }
            ]
          }
        ];

        const response = await openai.chat.completions.create({
          model: OPENAI_VISION_MODEL,
          messages,
          response_format: responseMimeType === "application/json" ? { type: "json_object" } : undefined
        });
        if (response.choices[0].message.content) return response.choices[0].message.content;
      } catch (e) {
        console.warn("OpenAI Vision Error, falling back to Gemini:", e);
      }
    }

    if (ai) {
      try {
        const contents = { parts: [{ text: prompt }, { inlineData: { data: image.data, mimeType: image.mimeType } }] };

        const response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: contents as any,
          config: { responseMimeType: responseMimeType as any }
        });
        if (response.text) return response.text;
      } catch (e) {
        console.warn("Gemini image fallback Error:", e);
      }
    }

    throw new Error("All image-capable AI models failed or keys are missing.");
  }

  // 1. Try Gemini for text tasks
  if (ai) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: { responseMimeType: responseMimeType as any }
      });
      if (response.text) return response.text;
    } catch (e) {
      console.warn("Gemini Error, falling back to DeepSeek:", e);
    }
  } else {
    console.warn("GEMINI_API_KEY is missing, skipping Gemini and trying fallback providers.");
  }

  // 2. Try DeepSeek (text only)
  if (deepseek && !image) {
    try {
      const response = await deepseek.chat.completions.create({
        model: "deepseek-chat",
        messages: [{ role: "user", content: prompt }],
        response_format: responseMimeType === "application/json" ? { type: "json_object" } : undefined
      });
      return response.choices[0].message.content;
    } catch (e) {
      console.warn("DeepSeek Error, falling back to OpenAI:", e);
    }
  }

  // 3. Try OpenAI (text fallback)
  if (openai) {
    try {
      const messages: any[] = [
        {
          role: "user",
          content: prompt
        }
      ];

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        response_format: responseMimeType === "application/json" ? { type: "json_object" } : undefined
      });
      return response.choices[0].message.content;
    } catch (e) {
      logError("OpenAI Error:", e);
    }
  }

  throw new Error("All AI models failed or keys are missing.");
}

export async function createApp(): Promise<express.Express> {
  // ... rest of setup ...
  const app = express();
  app.use("/api", (_req, res, next) => {
    res.setHeader("X-Nutria-Contract-Version", String(NUTRIA_API_CONTRACT_VERSION));
    next();
  });

  // Security-заголовки (helmet). CSP включаем только в production — в dev Vite HMR
  // использует inline-скрипты/websocket, которые пришлось бы отдельно разрешать,
  // а в проде фронтенд — статическая сборка без внешних скриптов (index.html грузит
  // только Google Fonts CSS, все API-запросы same-origin).
  app.use(
    helmet({
      // Google Fonts CSS отдаётся без Cross-Origin-Resource-Policy — с дефолтным
      // require-corp браузер блокирует его загрузку.
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy:
        process.env.NODE_ENV === "production"
          ? {
              directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
                fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
                imgSrc: ["'self'", "data:", "blob:"],
                connectSrc: ["'self'"],
                objectSrc: ["'none'"],
                baseUri: ["'self'"],
                formAction: ["'self'"],
                frameAncestors: ["'self'"],
              },
            }
          : false,
    })
  );

  // Дефолтный лимит body-parser (100kb) ломает /api/photo/recognize — фото в base64
  // (даже уменьшенное клиентом до 1280px, JPEG q=0.86) обычно уже больше 100kb.
  app.use(express.json({ limit: "10mb" }));
  app.use(cookieParser(resolveCookieSecret()));

  // Заблокированный пользователь (status=BLOCKED) не должен продолжать работать даже
  // с уже действующей cookie — проверяем на каждый запрос, а не только при логине.
  // CRM-сессия (jwtToken) проверяется отдельно в crm-routes.ts (requireAuth).
  app.use(async (req, res, next) => {
    const userId = req.signedCookies?.token;
    if (userId && isDatabaseConfigured()) {
      try {
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { status: true, blockedByUserId: true } });
        if (user?.status === "BLOCKED") {
          const blockedBy = await getBlockerContactInfo(prisma, user.blockedByUserId);
          return res.status(403).json({ error: "Аккаунт заблокирован", blockedBy });
        }
      } catch (e) {
        logError("Blocked-status check error:", e);
      }
    }
    next();
  });

  // Rate limiting: общий лимит на все /api/*, и более строгий — на эндпоинты входа/регистрации
  // (защита от брутфорса пароля). Отключаем в тестах, чтобы повторные вызовы не падали по лимиту.
  const skipRateLimitInTest = () => process.env.NODE_ENV === "test";
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipRateLimitInTest,
  });
  app.use("/api", apiLimiter);

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipRateLimitInTest,
    message: { error: "Слишком много попыток. Попробуйте позже." },
  });
  app.use(
    ["/api/auth/login", "/api/crm/auth/login", "/api/crm/auth/register", "/api/onboard/:token/login", "/api/onboard/:token"],
    authLimiter
  );

  // --- API Routes ---

  // AI Proxy: Unified generation with fallback
  app.post("/api/ai/generate", validateBody(aiGenerateSchema), async (req, res) => {
    // Требуем сессию — иначе это бесплатный анонимный прокси на платные AI-провайдеры
    // приложения (см. аудит), защищённый только общим rate-limit'ом на все /api/*.
    if (!req.signedCookies.token) return res.status(401).json({ error: "Unauthorized" });
    const { prompt, responseMimeType, image } = req.body;

    try {
      const text = await withTimeout(generateAI(prompt, responseMimeType, image), 20000, "AI proxy");
      res.json({ text });
    } catch (e: any) {
      logError("AI Proxy Error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // Пакетная докомплектация микроэлементов (USDA → AI) по запросу:
  //   curl -X POST "https://<host>/api/admin/backfill-micronutrients?limit=500" -H "x-admin-token: $ADMIN_TOKEN"
  // Работает только если в env задан ADMIN_TOKEN. Запускается в фоне, прогресс — в логах.
  app.post("/api/admin/backfill-micronutrients", async (req, res) => {
    const adminToken = process.env.ADMIN_TOKEN;
    if (!adminToken) return res.status(404).json({ error: "Not found" });
    if (req.get("x-admin-token") !== adminToken) return res.status(403).json({ error: "Forbidden" });

    if (micronutrientBackfillRunning) {
      return res.status(409).json({ error: "Backfill already running" });
    }

    const limit = Math.max(1, Math.min(5000, Number(req.query.limit) || 200));
    runMicronutrientBackfill(limit).catch((e) => logError("Backfill error:", e));
    res.json({ started: true, limit });
  });

  app.get("/api/admin/micronutrient-queue", async (req, res) => {
    const adminToken = process.env.ADMIN_TOKEN;
    if (!adminToken) return res.status(404).json({ error: "Not found" });
    if (req.get("x-admin-token") !== adminToken) return res.status(403).json({ error: "Forbidden" });
    const grouped = await (prisma as any).micronutrientEnrichmentJob.groupBy({
      by: ["status"],
      _count: { _all: true },
    });
    res.json({ queue: grouped.map((row: any) => ({ status: row.status, count: row._count._all })) });
  });

  // Health check
  app.get("/api/health", async (req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      const productCount = await prisma.product.count();
      res.json({
        status: "ok",
        database: "connected",
        version: "1.0.0",
        deployment: {
          commit: String(process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || "unknown").slice(0, 12),
        },
        catalog: { products: productCount },
      });
    } catch (e: any) {
      logError("Health check database error:", e);
      res.status(500).json({ status: "error", database: "disconnected", error: e.message });
    }
  });

  app.post("/api/client-errors", validateBody(clientCrashSchema), (req, res) => {
    reportClientCrash(req.body);
    res.status(202).json({ accepted: true });
  });

  // Barcode / QR lookup
  app.get("/api/products/barcode/:code", async (req, res) => {
    try {
      const { code } = req.params;
      const candidates = extractBarcodeCandidates(code);
      if (candidates.length === 0) return res.status(400).json({ error: "Invalid barcode" });

      // Свои продукты пользователя с привязанным штрих-кодом (в memory-режиме
      // resolveBarcodeProduct их не видит — он ищет только в Prisma и внешних источниках)
      const userId = req.signedCookies?.token;
      if (!isDatabaseConfigured() && userId) {
        const mine = getOrCreateInMemoryCustomProducts(userId).find(
          (p: any) => p.barcode && candidates.includes(String(p.barcode))
        );
        if (mine) return res.json(mine);
      }
      const { product } = await resolveBarcodeProduct(candidates);
      if (product) {
        // Продукты по штрих-коду (особенно из OpenFoodFacts) почти всегда приходят с
        // пустой таблицей витаминов/минералов. Докомплектация раньше ставилась в очередь
        // только из поиска — у отсканированных продуктов таблица оставалась нулевой.
        // Ставим в ту же фоновую очередь и здесь: при следующем открытии продукт уже
        // будет с заполненными микроэлементами.
        if (isDatabaseConfigured() && (product as any).id && !isGeneratedProductId(String((product as any).id))) {
          const micro = buildCompleteMicronutrients(parseMicronutrients((product as any).micronutrients), (product as any).fiber);
          if (isMicronutrientDataEffectivelyEmpty(micro) || hasEmptyMicronutrientGroup(micro) || hasMissingKeyMicronutrients(micro)) {
            enrichProductMicronutrientsInBackground(product as any).catch(() => {});
          }
        }
        return res.json(product);
      }

      return res.status(404).json({ error: "Not found" });
    } catch (e: any) {
      logError("Barcode lookup error:", e);
      return res.status(500).json({ error: "Barcode lookup failed", message: e?.message || "Unknown error" });
    }
  });

  // Исправление нутриентов продукта, найденного по штрихкоду. Данные из открытой базы
  // (OpenFoodFacts) часто расходятся с этикеткой; здесь пользователь приводит их в
  // соответствие с упаковкой. Правка записывается в общую запись Product по штрихкоду
  // (barcode уникален) и помечается выверенной человеком (source "catalog" + автор),
  // поэтому повторное сканирование этого кода сразу вернёт исправленные значения из
  // базы (resolveBarcodeProduct смотрит в базу раньше, чем в открытые источники) и
  // больше не будет тянуть данные из OpenFoodFacts.
  app.post("/api/products/barcode/:code/correct", validateBody(customProductSchema), async (req, res) => {
    const userId = req.signedCookies?.token;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const candidates = extractBarcodeCandidates(String(req.params.code || ""));
    if (candidates.length === 0) return res.status(400).json({ error: "Invalid barcode" });
    const barcode = candidates[0];

    const { name, brand, calories, protein, fat, carbs } = req.body;

    if (!isDatabaseConfigured()) {
      const list = getOrCreateInMemoryCustomProducts(userId);
      let product = list.find((p: any) => candidates.includes(String(p.barcode)));
      if (product) {
        Object.assign(product, { name, brand: brand || null, calories, protein, fat, carbs });
      } else {
        product = {
          id: `custom-${Date.now()}`,
          name, brand: brand || null, barcode,
          calories, protein, fat, carbs, fiber: null,
          source: "user", createdAt: new Date().toISOString(),
        };
        list.unshift(product);
      }
      invalidateBarcodeCache(barcode);
      return res.json(product);
    }

    try {
      const existing = await prisma.product.findFirst({ where: { barcode: { in: candidates } } });
      // Пользователь правит только КБЖУ — микроэлементы дооцениваем по названию через AI,
      // чтобы выверенная карточка была полной, а не с нулевыми витаминами/минералами.
      const micro = await estimateMicronutrientsByName(String(name));
      const data = {
        name: String(name),
        brand: brand ? String(brand) : null,
        calories: numberOrZero(calories),
        protein: numberOrZero(protein),
        fat: numberOrZero(fat),
        carbs: numberOrZero(carbs),
        source: "catalog",
        createdByUserId: userId,
        ...(micro ? { micronutrients: micro.micronutrients, fiber: micro.fiber } : {}),
      };
      const product = existing
        ? await prisma.product.update({ where: { id: existing.id }, data })
        : await prisma.product.create({ data: { ...data, barcode } });

      invalidateBarcodeCache(barcode);
      for (const c of candidates) invalidateBarcodeCache(c);
      return res.json(product);
    } catch (e: any) {
      logError("Barcode correction error:", e);
      return res.status(500).json({ error: "Не удалось сохранить исправление", message: e?.message || "Unknown error" });
    }
  });

  // Auth Placeholder (Mock)
  app.post("/api/auth/login", async (req, res) => {
    // Локальный dev без базы (memory-режим) — оставляем старый демо-вход без пароля,
    // персистентных аккаунтов там всё равно нет. В продакшене (БД настроена) обязателен
    // реальный email+пароль: раньше эта кнопка без единого запроса пароля пускала ЛЮБОГО
    // в один и тот же общий mock-аккаунт "user@nutria.app" — из-за этого после выхода из
    // настоящего (пригашённого через CRM) аккаунта повторное нажатие той же кнопки тут же
    // возвращало в общий демо-аккаунт, что выглядело как "выход не сработал".
    if (!isDatabaseConfigured()) {
      res.cookie("token", DEMO_USER_ID, { httpOnly: true, signed: true, secure: true, sameSite: "lax", maxAge: 30 * 24 * 3600 * 1000 });
      return res.json({ success: true, user: { email: DEMO_USER.email, role: DEMO_USER.role }, mode: "memory" });
    }

    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Введите email и пароль" });
    }

    try {
      const user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase().trim() } });
      if (!user) return res.status(401).json({ error: "Неверный email или пароль" });

      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) return res.status(401).json({ error: "Неверный email или пароль" });

      if (user.status === "BLOCKED") {
        const blockedBy = await getBlockerContactInfo(prisma, user.blockedByUserId);
        return res.status(403).json({ error: "Аккаунт заблокирован", blockedBy });
      }

      res.cookie("token", user.id, { httpOnly: true, signed: true, secure: true, sameSite: "lax", maxAge: 30 * 24 * 3600 * 1000 });
      res.json({ success: true, user: { email: user.email, role: user.role } });
    } catch (e: any) {
      logError("Auth Login Error:", e);
      res.status(500).json({ error: "Internal Server Error", message: e.message });
    }
  });

  app.get("/api/auth/me", async (req, res) => {
    try {
      const userId = req.signedCookies.token;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      if (!isDatabaseConfigured()) {
        if (userId !== DEMO_USER_ID) return res.status(401).json({ error: "Unauthorized" });
        return res.json({ user: DEMO_USER, mode: "memory" });
      }

      // Анкета (ClientProfile, заполняется при онбординге) и последняя запись веса
      // нужны клиентскому приложению, чтобы профиль/цели стартовали с реальных данных
      // клиента, а не с дефолтных 70 кг (пока пользователь сам их не отредактирует).
      const [user, lastWeight] = await Promise.all([
        prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true, email: true, role: true, createdAt: true, updatedAt: true,
            clientProfile: {
              select: { weightKg: true, heightCm: true, birthYear: true, sex: true, goal: true, activity: true },
            },
          },
        }),
        prisma.weightLog.findFirst({ where: { userId }, orderBy: { date: "desc" }, select: { weightKg: true } }),
      ]);
      res.json({ user: user ? { ...user, latestWeightKg: lastWeight?.weightKg ?? null } : null });
    } catch (e: any) {
      logError("Auth Me Error:", e);
      res.status(500).json({ error: "Internal Server Error", message: e.message });
    }
  });

  app.post("/api/auth/logout", async (req, res) => {
    // ВАЖНО: без maxAge — clearCookie с maxAge не удалит куку (Express предпочтёт maxAge вместо expires)
    res.clearCookie("token", { httpOnly: true, signed: true, secure: true, sameSite: "lax" });
    res.json({ success: true });
  });

  app.post("/api/auth/change-password", validateBody(changePasswordSchema), async (req, res) => {
    const userId = req.signedCookies?.token;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!isDatabaseConfigured()) return res.status(400).json({ error: "Недоступно в демо-режиме" });

    try {
      const { currentPassword, newPassword } = req.body;
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) return res.status(404).json({ error: "Пользователь не найден" });

      const ok = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!ok) return res.status(401).json({ error: "Неверный текущий пароль" });

      const newHash = await bcrypt.hash(newPassword, 10);
      await prisma.user.update({ where: { id: userId }, data: { passwordHash: newHash } });
      res.json({ success: true });
    } catch (e: any) {
      logError("Change Password Error:", e);
      res.status(500).json({ error: "Internal Server Error", message: e.message });
    }
  });

  // Сообщения от нутрициолога: список переписки (клиентская сторона)
  app.get("/api/messages", async (req, res) => {
    try {
      const userId = req.signedCookies.token;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const messages = await (prisma as any).message.findMany({
        where: { clientId: userId },
        orderBy: { createdAt: "asc" },
        include: { nutritionist: { include: { nutritionistProfile: true } } },
      });

      await (prisma as any).message.updateMany({
        where: { clientId: userId, sender: "NUTRITIONIST", readAt: null },
        data: { readAt: new Date() },
      });

      const result = messages.map((m: any) => ({
        id: m.id,
        sender: m.sender,
        content: m.content,
        createdAt: m.createdAt,
        readAt: m.readAt,
        nutritionistName: m.nutritionist?.nutritionistProfile
          ? `${m.nutritionist.nutritionistProfile.firstName} ${m.nutritionist.nutritionistProfile.lastName}`.trim()
          : "Нутрициолог",
      }));

      res.json({ messages: result });
    } catch (e: any) {
      logError("Messages list error:", e);
      res.status(500).json({ error: "Internal Server Error", message: e.message });
    }
  });

  // Сообщения от нутрициолога: счётчик непрочитанных (для бейджа, не помечает прочитанным)
  app.get("/api/messages/unread-count", async (req, res) => {
    try {
      const userId = req.signedCookies.token;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const count = await (prisma as any).message.count({
        where: { clientId: userId, sender: "NUTRITIONIST", readAt: null },
      });
      res.json({ count });
    } catch (e: any) {
      logError("Messages unread-count error:", e);
      res.status(500).json({ error: "Internal Server Error", message: e.message });
    }
  });

  // Сообщения от нутрициолога: отправить ответ (клиентская сторона)
  app.post("/api/messages", validateBody(sendMessageSchema), async (req, res) => {
    try {
      const userId = req.signedCookies.token;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { content, nutritionistId } = req.body;

      let targetNutritionistId = nutritionistId;
      if (!targetNutritionistId) {
        const lastMessage = await (prisma as any).message.findFirst({
          where: { clientId: userId },
          orderBy: { createdAt: "desc" },
        });
        targetNutritionistId = lastMessage?.nutritionistId;
        if (!targetNutritionistId) {
          const invite = await (prisma as any).clientInvite.findFirst({ where: { clientId: userId } });
          targetNutritionistId = invite?.nutritionistId;
        }
        if (!targetNutritionistId) {
          // Нет привязки к конкретному нутрициологу (клиент пришёл не по инвайт-ссылке,
          // например через Telegram-бота или общий веб-вход) — пишем первому
          // зарегистрированному нутрициологу, чтобы сообщение не терялось.
          const anyNutritionist = await prisma.user.findFirst({
            where: { role: "NUTRITIONIST" },
            orderBy: { createdAt: "asc" },
          });
          targetNutritionistId = anyNutritionist?.id;
        }
      }
      if (!targetNutritionistId) return res.status(400).json({ error: "Нутрициолог не найден" });

      const message = await (prisma as any).message.create({
        data: { nutritionistId: targetNutritionistId, clientId: userId, sender: "CLIENT", content: content.trim() },
      });

      res.json({ message });
    } catch (e: any) {
      logError("Messages send error:", e);
      res.status(500).json({ error: "Internal Server Error", message: e.message });
    }
  });

  // Food Match Engine: Search products
  app.get("/api/products/search", async (req, res) => {
    try {
      const { q } = req.query;
      if (!q) return res.json([]);

      const responseResults = await searchProductsEngine(String(q), {
        limit: 10,
        cache: true,
        localize: true,
        allowAiEstimate: true,
      });
      res.json(responseResults.map(withNutritionContract));
    } catch (e: any) {
      logError("Products Search Error:", e);
      res.status(500).json({ error: "Products search failed", message: e.message });
    }
  });

  app.get("/api/products/search/v2", async (req, res) => {
    try {
      const query = String(req.query.q || "").trim();
      const { offset, limit } = parseProductSearchPagination(req.query.offset, req.query.limit);
      if (!query) {
        return res.json({ items: [], offset, limit, hasMore: false });
      }

      const candidates = await searchProductsEngine(query, {
        limit: Math.min(20, offset + limit + 1),
        cache: true,
        localize: true,
        allowAiEstimate: true,
      });
      const items = candidates.slice(offset, offset + limit).map(withNutritionContract);
      res.json({
        items,
        offset,
        limit,
        hasMore: candidates.length > offset + items.length,
      });
    } catch (e: any) {
      logError("Products Search V2 Error:", e);
      res.status(500).json({ error: "Products search failed", message: e.message });
    }
  });

  // "Недавние" — список недавно использованных продуктов/блюд пользователя (без дублей)
  app.get("/api/products/recent", async (req, res) => {
    const userId = req.signedCookies.token;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    if (!isDatabaseConfigured()) {
      const list = getOrCreateInMemoryRecent(userId).slice(0, 30);
      return res.json(list.map((r: any) => ({
        id: r.product.id,
        name: r.product.name,
        brand: r.product.brand,
        calories: r.product.calories,
        protein: r.product.protein,
        fat: r.product.fat,
        carbs: r.product.carbs,
        fiber: r.product.fiber,
        lastWeightGrams: r.lastWeightGrams,
        useCount: r.useCount
      })));
    }

    try {
      const recent = await prisma.recentFood.findMany({
        where: { userId },
        include: { product: true },
        orderBy: { lastUsedAt: "desc" },
        take: 30
      });
      res.json(recent.map((r: any) => ({
        id: r.product.id,
        name: r.product.name,
        brand: r.product.brand,
        calories: r.product.calories,
        protein: r.product.protein,
        fat: r.product.fat,
        carbs: r.product.carbs,
        fiber: r.product.fiber,
        servings: parseProductServings(r.product.servingsJson),
        lastWeightGrams: r.lastWeightGrams,
        useCount: r.useCount
      })));
    } catch (e: any) {
      logError("Recent Foods Error:", e);
      res.status(500).json({ error: "Failed to load recent foods", message: e.message });
    }
  });

  // "Мои" — собственные продукты и блюда пользователя
  app.get("/api/products/mine", async (req, res) => {
    const userId = req.signedCookies.token;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    if (!isDatabaseConfigured()) {
      return res.json({
        products: getOrCreateInMemoryCustomProducts(userId),
        recipes: getOrCreateInMemoryRecipes(userId)
      });
    }

    try {
      const [products, recipes] = await Promise.all([
        prisma.product.findMany({
          where: { createdByUserId: userId, source: "user" },
          orderBy: { createdAt: "desc" }
        }),
        prisma.recipe.findMany({
          where: { userId },
          include: { product: true, ingredients: true },
          orderBy: { createdAt: "desc" }
        })
      ]);
      res.json({ products, recipes });
    } catch (e: any) {
      logError("Mine Error:", e);
      res.status(500).json({ error: "Failed to load 'Мои'", message: e.message });
    }
  });

  // "Мои" → добавить свой продукт (КБЖУ хранится на 100 г)
  app.post("/api/products/custom", validateBody(customProductSchema), async (req, res) => {
    const userId = req.signedCookies.token;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { name, brand, barcode, calories, protein, fat, carbs } = req.body;

    if (!isDatabaseConfigured()) {
      const list = getOrCreateInMemoryCustomProducts(userId);
      const product = {
        id: `custom-${Date.now()}`,
        name, brand, barcode, calories, protein, fat, carbs, fiber: null,
        source: "user", createdAt: new Date().toISOString()
      };
      list.unshift(product);
      return res.json(product);
    }

    try {
      // Пользователь вводит только КБЖУ — микроэлементы дооцениваем по названию через AI,
      // чтобы карточка не была наполовину пустой (иначе «% дневной нормы» — сплошные нули).
      const micro = await estimateMicronutrientsByName(String(name));
      const product = await prisma.product.create({
        data: {
          name, brand, barcode, calories, protein, fat, carbs, source: "user", createdByUserId: userId,
          ...(micro ? { micronutrients: micro.micronutrients, fiber: micro.fiber } : {}),
        }
      });
      res.json(product);
    } catch (e: any) {
      logError("Create Custom Product Error:", e);
      res.status(500).json({ error: "Failed to create product", message: e.message });
    }
  });

  // Редактирование своего продукта как карточки (не записи в дневнике): дневник хранит
  // только productId+amount, поэтому обновлённые КБЖУ автоматически подхватятся во всех записях.
  app.patch("/api/products/custom/:id", validateBody(customProductSchema), async (req, res) => {
    const userId = req.signedCookies?.token;
    const { id } = req.params;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { name, brand, barcode, calories, protein, fat, carbs } = req.body;

    if (!isDatabaseConfigured()) {
      const list = getOrCreateInMemoryCustomProducts(userId);
      const product = list.find((p: any) => p.id === id);
      if (!product) return res.status(404).json({ error: "Not found" });
      Object.assign(product, { name, brand, barcode, calories, protein, fat, carbs });
      return res.json(product);
    }

    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing || existing.createdByUserId !== userId) {
      return res.status(403).json({ error: "Forbidden or not found" });
    }

    try {
      // Название могло измениться — пересобираем микроэлементы по новому названию (AI),
      // сохраняя введённые пользователем КБЖУ.
      const micro = await estimateMicronutrientsByName(String(name));
      const product = await prisma.product.update({
        where: { id },
        data: {
          name, brand, barcode, calories, protein, fat, carbs,
          ...(micro ? { micronutrients: micro.micronutrients, fiber: micro.fiber } : {}),
        }
      });
      res.json(product);
    } catch (e: any) {
      logError("Update Custom Product Error:", e);
      res.status(500).json({ error: "Failed to update product", message: e.message });
    }
  });

  app.delete("/api/products/custom/:id", async (req, res) => {
    const userId = req.signedCookies.token;
    const { id } = req.params;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    if (!isDatabaseConfigured()) {
      const list = getOrCreateInMemoryCustomProducts(userId);
      const idx = list.findIndex((p: any) => p.id === id);
      if (idx === -1) return res.status(404).json({ error: "Not found" });
      list.splice(idx, 1);
      return res.json({ success: true, mode: "memory" });
    }

    const product = await prisma.product.findUnique({ where: { id } });
    if (!product || product.createdByUserId !== userId) {
      return res.status(403).json({ error: "Forbidden or not found" });
    }
    try {
      await prisma.product.delete({ where: { id } });
      res.json({ success: true });
    } catch (e: any) {
      logError("Delete Custom Product Error:", e);
      res.status(409).json({ error: "Продукт уже используется в дневнике, удаление невозможно" });
    }
  });

  // "Мои блюда" — создать блюдо из ингредиентов (вес ингредиентов + вес готового блюда → КБЖУ на 100 г)
  app.post("/api/recipes", validateBody(recipeSchema), async (req, res) => {
    const userId = req.signedCookies.token;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const name = req.body.name;
    const ingredientsInput = req.body.ingredients;
    const cookedWeightGrams = numberOrZero(req.body.cookedWeightGrams);

    if (!isDatabaseConfigured()) {
      let totalWeight = 0, totalCal = 0, totalProtein = 0, totalFat = 0, totalCarbs = 0;
      const ingredients = ingredientsInput.map((ing: any) => {
        const weightGrams = numberOrZero(ing.weightGrams);
        const factor = weightGrams / 100;
        const calories = numberOrZero(ing.calories) * factor;
        const protein = numberOrZero(ing.protein) * factor;
        const fat = numberOrZero(ing.fat) * factor;
        const carbs = numberOrZero(ing.carbs) * factor;
        totalWeight += weightGrams;
        totalCal += calories; totalProtein += protein; totalFat += fat; totalCarbs += carbs;
        return { productId: ing.productId, name: ing.name, weightGrams, calories, protein, fat, carbs };
      });
      const cooked = cookedWeightGrams > 0 ? cookedWeightGrams : totalWeight;
      const cookedFactor = cooked > 0 ? 100 / cooked : 0;
      const recipeId = `recipe-meta-${Date.now()}`;
      const product = {
        id: `recipe-${Date.now()}`,
        name, brand: null, source: "recipe", recipeId,
        calories: totalCal * cookedFactor, protein: totalProtein * cookedFactor,
        fat: totalFat * cookedFactor, carbs: totalCarbs * cookedFactor, fiber: null
      };
      const recipe = {
        id: recipeId, name, ingredients,
        totalIngredientWeightGrams: totalWeight, cookedWeightGrams: cooked, product
      };
      getOrCreateInMemoryRecipes(userId).unshift(recipe);
      return res.json(recipe);
    }

    try {
      const productMap = await resolveIngredientProducts(prisma, ingredientsInput, userId);

      let totalWeight = 0, totalCal = 0, totalProtein = 0, totalFat = 0, totalCarbs = 0;
      const ingredientRows: any[] = [];
      for (const ing of ingredientsInput) {
        const product: any = productMap.get(String(ing.productId));
        if (!product) continue;
        const weightGrams = numberOrZero(ing.weightGrams);
        const factor = weightGrams / 100;
        const calories = product.calories * factor;
        const protein = product.protein * factor;
        const fat = product.fat * factor;
        const carbs = product.carbs * factor;
        totalWeight += weightGrams;
        totalCal += calories; totalProtein += protein; totalFat += fat; totalCarbs += carbs;
        ingredientRows.push({ productId: product.id, weightGrams, calories, protein, fat, carbs });
      }

      if (ingredientRows.length === 0) {
        return res.status(400).json({ error: "Не найдены продукты для ингредиентов" });
      }

      const cooked = cookedWeightGrams > 0 ? cookedWeightGrams : totalWeight;
      const cookedFactor = cooked > 0 ? 100 / cooked : 0;

      const recipe = await prisma.recipe.create({
        data: {
          userId,
          name,
          totalIngredientWeightGrams: totalWeight,
          cookedWeightGrams: cooked,
          ingredients: { create: ingredientRows },
          product: {
            create: {
              name,
              source: "recipe",
              createdByUserId: userId,
              calories: totalCal * cookedFactor,
              protein: totalProtein * cookedFactor,
              fat: totalFat * cookedFactor,
              carbs: totalCarbs * cookedFactor
            }
          }
        },
        include: { ingredients: true, product: true }
      });

      res.json(recipe);
    } catch (e: any) {
      logError("Create Recipe Error:", e);
      res.status(500).json({ error: "Failed to create recipe", message: e.message });
    }
  });

  // Импорт рецепта по ссылке: ищем schema.org/Recipe JSON-LD на странице, разбираем
  // строки ингредиентов через AI (произвольные единицы — стаканы, унции и т.п. — в граммы)
  // и матчим каждый через тот же поисковый движок, что и остальные фичи (без дублирования
  // логики матчинга). Ничего не сохраняет — отдаёт предпросмотр, сохранение идёт через
  // уже существующий POST /api/recipes тем же payload-форматом, что и ручное создание блюда.
  app.post("/api/recipes/import-url", validateBody(recipeImportUrlSchema), async (req, res) => {
    const userId = req.signedCookies.token;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const rawUrl = req.body.url.trim();
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
      if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error("bad protocol");
      await assertPublicHostname(parsedUrl.hostname);
    } catch {
      return res.status(400).json({ error: "Некорректная ссылка" });
    }

    let html = "";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(parsedUrl.toString(), {
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; NutriaBot/1.0; +https://nutria.one)" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      html = await response.text();
    } catch (e: any) {
      logError("Recipe import fetch error:", e);
      return res.status(502).json({ error: "Не удалось загрузить страницу по ссылке" });
    } finally {
      clearTimeout(timer);
    }

    const recipeData = extractRecipeJsonLd(html);
    if (!recipeData) {
      return res.status(422).json({ error: "На странице не найдена разметка рецепта (schema.org/Recipe)" });
    }

    const name = String(recipeData.name || "Импортированный рецепт").trim();
    const rawIngredients: string[] = Array.isArray(recipeData.recipeIngredient)
      ? recipeData.recipeIngredient.map((s: any) => String(s)).filter(Boolean)
      : [];

    if (rawIngredients.length === 0) {
      return res.status(422).json({ error: "В разметке рецепта не найден список ингредиентов" });
    }

    const decompositionPrompt = `Список ингредиентов рецепта "${name}", взятый со страницы сайта (строки на любом языке, в произвольных единицах — стаканы, ложки, унции, штуки и т.п.):
${rawIngredients.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Для каждой строки определи:
- name: название продукта на русском в словарной форме для поиска в базе питания (например "Мука пшеничная", "Сахар", "Яйцо куриное"), без указания количества
- weightGrams: вес в граммах. Если в строке указан вес в граммах/кг — используй его. Если указан объём (стакан, ложка, унция, мл) или штуки — переведи в граммы по типичному весу/плотности этого продукта.

Верни только JSON-объект вида: {"items": [{"name": "...", "weightGrams": число}]}`;

    let items: any[] = [];
    try {
      const responseText = await withTimeout(generateAI(decompositionPrompt), 15000, "Recipe ingredient decomposition");
      items = unwrapAiItemsArray(parseAiJsonPayload(responseText || "{}"));
    } catch (e) {
      logError("Recipe import decomposition error:", e);
      return res.status(500).json({ error: "Не удалось разобрать состав рецепта" });
    }

    // Каждый ингредиент матчим независимо — сбой одного не должен валить весь импорт.
    const matchedIngredients = await Promise.all(items.map(async (item: any) => {
      const rawName = String(item?.name || "").trim();
      const weightGrams = clampNumber(item?.weightGrams, 1, 5000, 100);
      if (!rawName) return { rawName, weightGrams, product: null };
      try {
        const candidates = await withTimeout(
          searchProductsEngine(rawName, { limit: 1, cache: true, localize: true, allowAiEstimate: true, fast: true }),
          15000,
          `Match "${rawName}"`
        );
        return { rawName, weightGrams, product: candidates[0] || null };
      } catch (e) {
        logError(`Recipe import ingredient match failed for "${rawName}":`, e);
        return { rawName, weightGrams, product: null };
      }
    }));

    res.json({ name, sourceUrl: parsedUrl.toString(), ingredients: matchedIngredients });
  });

  // Состав блюда для правки (кнопка "Состав" у уже сохранённой записи в дневнике) —
  // отдаёт ингредиенты с подгруженным продуктом, чтобы показать название/КБЖУ без
  // дополнительных запросов к поиску.
  app.get("/api/recipes/:id", async (req, res) => {
    const userId = req.signedCookies.token;
    const { id } = req.params;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    if (!isDatabaseConfigured()) {
      const recipe = getOrCreateInMemoryRecipes(userId).find((r: any) => r.id === id);
      if (!recipe) return res.status(404).json({ error: "Not found" });
      return res.json(recipe);
    }

    try {
      const recipe = await prisma.recipe.findUnique({
        where: { id },
        include: { ingredients: { include: { product: true } }, product: true },
      });
      if (!recipe || recipe.userId !== userId) {
        return res.status(403).json({ error: "Forbidden or not found" });
      }
      res.json(recipe);
    } catch (e: any) {
      logError("Get Recipe Error:", e);
      res.status(500).json({ error: "Internal Server Error", message: e.message });
    }
  });

  app.delete("/api/recipes/:id", async (req, res) => {
    const userId = req.signedCookies.token;
    const { id } = req.params;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    if (!isDatabaseConfigured()) {
      const list = getOrCreateInMemoryRecipes(userId);
      const idx = list.findIndex((r: any) => r.id === id);
      if (idx === -1) return res.status(404).json({ error: "Not found" });
      list.splice(idx, 1);
      return res.json({ success: true, mode: "memory" });
    }

    const recipe = await prisma.recipe.findUnique({ where: { id } });
    if (!recipe || recipe.userId !== userId) {
      return res.status(403).json({ error: "Forbidden or not found" });
    }
    try {
      await prisma.recipe.delete({ where: { id } }); // cascade удалит связанный Product и RecipeIngredient
      res.json({ success: true });
    } catch (e: any) {
      logError("Delete Recipe Error:", e);
      res.status(409).json({ error: "Блюдо уже используется в дневнике, удаление невозможно" });
    }
  });

  // Правка состава блюда (распознанного голосом/фото или созданного в "Мои") — добавить/убрать
  // ингредиент, поменять граммовку. Пересчитывает агрегированный снимок-продукт по той же
  // логике, что и создание блюда (POST /api/recipes).
  app.patch("/api/recipes/:id", validateBody(recipeSchema), async (req, res) => {
    const userId = req.signedCookies.token;
    const { id } = req.params;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const name = req.body.name;
    const ingredientsInput = req.body.ingredients;
    const cookedWeightGrams = numberOrZero(req.body.cookedWeightGrams);

    if (!isDatabaseConfigured()) {
      const list = getOrCreateInMemoryRecipes(userId);
      const recipe = list.find((r: any) => r.id === id);
      if (!recipe) return res.status(404).json({ error: "Not found" });

      let totalWeight = 0, totalCal = 0, totalProtein = 0, totalFat = 0, totalCarbs = 0;
      const ingredients = ingredientsInput.map((ing: any) => {
        const weightGrams = numberOrZero(ing.weightGrams);
        const factor = weightGrams / 100;
        const calories = numberOrZero(ing.calories) * factor;
        const protein = numberOrZero(ing.protein) * factor;
        const fat = numberOrZero(ing.fat) * factor;
        const carbs = numberOrZero(ing.carbs) * factor;
        totalWeight += weightGrams;
        totalCal += calories; totalProtein += protein; totalFat += fat; totalCarbs += carbs;
        return { productId: ing.productId, name: ing.name, weightGrams, calories, protein, fat, carbs };
      });
      const cooked = cookedWeightGrams > 0 ? cookedWeightGrams : totalWeight;
      const cookedFactor = cooked > 0 ? 100 / cooked : 0;

      recipe.name = name;
      recipe.ingredients = ingredients;
      recipe.totalIngredientWeightGrams = totalWeight;
      recipe.cookedWeightGrams = cooked;
      recipe.product = {
        ...recipe.product,
        name,
        calories: totalCal * cookedFactor, protein: totalProtein * cookedFactor,
        fat: totalFat * cookedFactor, carbs: totalCarbs * cookedFactor
      };
      return res.json(recipe);
    }

    const existing = await prisma.recipe.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) {
      return res.status(403).json({ error: "Forbidden or not found" });
    }

    try {
      const productMap = await resolveIngredientProducts(prisma, ingredientsInput, userId);

      let totalWeight = 0, totalCal = 0, totalProtein = 0, totalFat = 0, totalCarbs = 0;
      const ingredientRows: any[] = [];
      for (const ing of ingredientsInput) {
        const product: any = productMap.get(String(ing.productId));
        if (!product) continue;
        const weightGrams = numberOrZero(ing.weightGrams);
        const factor = weightGrams / 100;
        const calories = product.calories * factor;
        const protein = product.protein * factor;
        const fat = product.fat * factor;
        const carbs = product.carbs * factor;
        totalWeight += weightGrams;
        totalCal += calories; totalProtein += protein; totalFat += fat; totalCarbs += carbs;
        ingredientRows.push({ productId: product.id, weightGrams, calories, protein, fat, carbs });
      }

      if (ingredientRows.length === 0) {
        return res.status(400).json({ error: "Не найдены продукты для ингредиентов" });
      }

      const cooked = cookedWeightGrams > 0 ? cookedWeightGrams : totalWeight;
      const cookedFactor = cooked > 0 ? 100 / cooked : 0;

      await prisma.recipeIngredient.deleteMany({ where: { recipeId: id } });
      const recipe = await prisma.recipe.update({
        where: { id },
        data: {
          name,
          totalIngredientWeightGrams: totalWeight,
          cookedWeightGrams: cooked,
          ingredients: { create: ingredientRows },
          product: {
            update: {
              name,
              calories: totalCal * cookedFactor,
              protein: totalProtein * cookedFactor,
              fat: totalFat * cookedFactor,
              carbs: totalCarbs * cookedFactor
            }
          }
        },
        include: { ingredients: true, product: true }
      });

      res.json(recipe);
    } catch (e: any) {
      logError("Update Recipe Error:", e);
      res.status(500).json({ error: "Failed to update recipe", message: e.message });
    }
  });

  app.post("/api/photo/recognize", validateBody(photoRecognizeSchema), async (req, res) => {
    try {
      const { image, mode = "ingredients" } = req.body;

      const recognized = await recognizeProductsFromPhoto(image, {
        userId: req.cookies?.token || null,
        mode,
      });
      return res.json({
        items: recognized.items.map((item: any) => ({
          ...item,
          product: withNutritionContract(item.product),
        })),
        dishEstimate: recognized.dishEstimate,
        mode,
        message: recognized.items.length === 0 && !recognized.dishEstimate
          ? "На фото не удалось уверенно распознать продукты."
          : undefined,
      });
    } catch (e: any) {
      logError("Photo recognition error:", e);
      return res.status(500).json({
        error: "Photo recognition failed",
        message: e?.message || "Unknown error",
      });
    }
  });

  const saveCorrectionHandler = async (req: express.Request, res: express.Response) => {
    const userId = req.signedCookies.token;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    try {
      const sourceName = req.body.sourceName;
      const correctedProductId = String(req.body.correctedProductId || req.body.correctedProduct?.id || "").trim();

      const product = await saveRecognitionCorrection({
        userId,
        sourceName,
        aliases: req.body.aliases || [],
        visibleText: req.body.visibleText || [],
        correctedProductId,
        correctedProduct: req.body.correctedProduct,
      });

      return res.json({
        success: true,
        channel: req.body.channel || "photo",
        product: withNutritionContract(product),
      });
    } catch (e: any) {
      logError("Recognition correction save error:", e);
      return res.status(500).json({ error: "Failed to save correction", message: e?.message || "Unknown error" });
    }
  };

  app.post("/api/recognition/corrections", validateBody(recognitionCorrectionSchema), saveCorrectionHandler);
  app.post("/api/photo/corrections", validateBody(photoCorrectionSchema), saveCorrectionHandler);

  // Diary: Get daily meals and aggregates
  app.get("/api/diary", async (req, res) => {
    const userId = req.signedCookies.token;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const targetDate = dateFromQuery(req.query.date);
    const targetDateKey = toDateKey(targetDate);

    if (!isDatabaseConfigured()) {
      const memoryDiary = getOrCreateInMemoryDiary(userId);
      const meals = memoryDiary.meals.filter((m: any) => getMealDateKey(m) === targetDateKey);
      return res.json({
        meals,
        goals: memoryDiary.goals,
        waterIntake: Number(memoryDiary.waterByDate[targetDateKey] || 0),
        date: targetDateKey,
        mode: "memory",
      });
    }

    try {
      const { start: startOfDay, end: endOfDay } = dayRangeFromDate(targetDate);

      const meals = await prisma.meal.findMany({
        where: {
          userId,
          date: { gte: startOfDay, lte: endOfDay }
        },
        include: {
          items: {
            include: { product: true }
          }
        }
      });

      const goals = await prisma.nutrientGoal.findUnique({ where: { userId } });

      const waterMeal = meals.find(m => m.type === 'WATER');
      const waterIntake = waterMeal ? waterMeal.items.reduce((sum, item) => sum + item.amount, 0) : 0;

      const parsedMeals = meals.filter(m => m.type !== 'WATER').map(m => ({
        ...m,
        items: m.items.map(i => {
          const micro = buildCompleteMicronutrients(parseMicronutrients(i.product.micronutrients), i.product.fiber);
          if (hasEmptyMicronutrientGroup(micro)) {
            enrichProductMicronutrientsInBackground(i.product).catch(() => {});
          }
          const servings = parseProductServings((i.product as any).servingsJson);
          return {
            ...i,
            product: { ...i.product, ...micro, servings, nutriScore: calcNutriScore({ ...i.product, ...micro }) }
          };
        })
      }));

      res.json({ meals: parsedMeals, goals, waterIntake, date: targetDateKey });
    } catch (e: any) {
      logError("Diary Get Error:", e);
      res.status(500).json({ error: "Internal Server Error", message: e.message });
    }
  });

  // Diary: History for analytics (last N days)
  app.get("/api/diary/history", async (req, res) => {
    const userId = req.signedCookies.token;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const days = Math.max(1, Math.min(31, Number(req.query.days) || 7));
    const endDate = dateFromQuery(req.query.endDate);

    const dayKeys = Array.from({ length: days }, (_, idx) => {
      const d = new Date(endDate);
      d.setDate(d.getDate() - (days - 1 - idx));
      return toDateKey(d);
    });

    const defaultPoint = () => ({
      mealsCount: 0,
      waterIntake: 0,
      totals: { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 }
    });

    if (!isDatabaseConfigured()) {
      const memoryDiary = getOrCreateInMemoryDiary(userId);
      const bucket = new Map<string, ReturnType<typeof defaultPoint>>();
      for (const key of dayKeys) {
        bucket.set(key, defaultPoint());
      }

      for (const meal of memoryDiary.meals) {
        const key = getMealDateKey(meal);
        if (!bucket.has(key)) continue;
        const point = bucket.get(key)!;
        point.mealsCount += 1;

        for (const item of Array.isArray(meal?.items) ? meal.items : []) {
          const amount = numberOrZero(item?.amount);
          const factor = amount / 100;
          const product = item?.product || {};
          point.totals.calories += numberOrZero(product.calories) * factor;
          point.totals.protein += numberOrZero(product.protein) * factor;
          point.totals.fat += numberOrZero(product.fat) * factor;
          point.totals.carbs += numberOrZero(product.carbs) * factor;
          point.totals.fiber += numberOrZero(product.fiber) * factor;
        }
      }

      for (const key of dayKeys) {
        const point = bucket.get(key)!;
        point.waterIntake = numberOrZero(memoryDiary.waterByDate[key]);
      }

      return res.json({
        days,
        endDate: toDateKey(endDate),
        history: dayKeys.map((key) => ({ date: key, ...bucket.get(key)! })),
        mode: "memory"
      });
    }

    try {
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - (days - 1));
      const { start: startOfRange } = dayRangeFromDate(startDate);
      const { end: endOfRange } = dayRangeFromDate(endDate);

      const meals = await prisma.meal.findMany({
        where: {
          userId,
          date: { gte: startOfRange, lte: endOfRange }
        },
        include: {
          items: { include: { product: true } }
        }
      });

      const bucket = new Map<string, ReturnType<typeof defaultPoint>>();
      for (const key of dayKeys) {
        bucket.set(key, defaultPoint());
      }

      for (const meal of meals) {
        const key = toDateKey(new Date(meal.date));
        if (!bucket.has(key)) continue;
        const point = bucket.get(key)!;

        if (meal.type === "WATER") {
          point.waterIntake += meal.items.reduce((sum, item) => sum + numberOrZero(item.amount), 0);
          continue;
        }

        point.mealsCount += 1;
        for (const item of meal.items) {
          const amount = numberOrZero(item.amount);
          const factor = amount / 100;
          const product = item.product || ({} as any);
          point.totals.calories += numberOrZero(product.calories) * factor;
          point.totals.protein += numberOrZero(product.protein) * factor;
          point.totals.fat += numberOrZero(product.fat) * factor;
          point.totals.carbs += numberOrZero(product.carbs) * factor;
          point.totals.fiber += numberOrZero(product.fiber) * factor;
        }
      }

      return res.json({
        days,
        endDate: toDateKey(endDate),
        history: dayKeys.map((key) => ({ date: key, ...bucket.get(key)! }))
      });
    } catch (e: any) {
      logError("Diary History Error:", e);
      return res.status(500).json({ error: "Internal Server Error", message: e.message });
    }
  });

  // Diary: Update nutrient goals
  app.post("/api/diary/goals", validateBody(diaryGoalsSchema), async (req, res) => {
    const userId = req.signedCookies.token;
    const nextGoals = req.body;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    if (!isDatabaseConfigured()) {
      const memoryDiary = getOrCreateInMemoryDiary(userId);
      memoryDiary.goals = {
        calories: nextGoals.calories,
        protein: nextGoals.protein,
        fat: nextGoals.fat,
        carbs: nextGoals.carbs,
        fiber: nextGoals.fiber || DEMO_GOALS.fiber,
      };
      return res.json({ success: true, goals: memoryDiary.goals, mode: "memory" });
    }

    try {
      const goals = await prisma.nutrientGoal.upsert({
        where: { userId },
        update: {
          calories: nextGoals.calories,
          protein: nextGoals.protein,
          fat: nextGoals.fat,
          carbs: nextGoals.carbs,
          fiber: nextGoals.fiber,
        },
        create: {
          userId,
          calories: nextGoals.calories,
          protein: nextGoals.protein,
          fat: nextGoals.fat,
          carbs: nextGoals.carbs,
          fiber: nextGoals.fiber,
        }
      });

      return res.json({ success: true, goals });
    } catch (e: any) {
      logError("Diary Goals Update Error:", e);
      return res.status(500).json({ error: "Internal Server Error", message: e.message });
    }
  });

  // Diary: Update water intake
  app.post("/api/diary/water", validateBody(diaryWaterSchema), async (req, res) => {
    const userId = req.signedCookies.token;
    const { amount, date } = req.body; // amount can be positive or negative
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const targetDate = dateFromQuery(date);
    const targetDateKey = toDateKey(targetDate);
    const delta = amount;

    if (!isDatabaseConfigured()) {
      const memoryDiary = getOrCreateInMemoryDiary(userId);
      const current = numberOrZero(memoryDiary.waterByDate[targetDateKey]);
      memoryDiary.waterByDate[targetDateKey] = Math.max(0, current + delta);
      return res.json({ success: true, mode: "memory", waterIntake: memoryDiary.waterByDate[targetDateKey], date: targetDateKey });
    }

    try {
      const { start: startOfDay, end: endOfDay } = dayRangeFromDate(targetDate);

      let meal = await prisma.meal.findFirst({
        where: { userId, type: 'WATER', date: { gte: startOfDay, lte: endOfDay } },
        include: { items: true }
      });

      if (!meal) {
        meal = await prisma.meal.create({
          data: { userId, type: 'WATER', date: startOfDay },
          include: { items: true }
        });
      }

      let waterProduct = await prisma.product.findFirst({ where: { name: 'Water', brand: 'System' } });
      if (!waterProduct) {
        waterProduct = await prisma.product.create({
          data: { name: 'Water', brand: 'System', calories: 0, protein: 0, fat: 0, carbs: 0 }
        });
      }

      // Клэмпим, чтобы суммарный waterIntake за день не уходил в минус (симметрично
      // in-memory режиму выше) — иначе списание больше выпитого даёт отрицательный итог.
      const currentTotal = meal.items.reduce((sum, item) => sum + item.amount, 0);
      const effectiveDelta = Math.max(-currentTotal, delta);

      await prisma.mealItem.create({
        data: {
          mealId: meal.id,
          productId: waterProduct.id,
          amount: effectiveDelta
        }
      });

      res.json({ success: true, date: targetDateKey, waterIntake: currentTotal + effectiveDelta });
    } catch (e: any) {
      logError("Diary Water Error:", e);
      res.status(500).json({ error: "Internal Server Error", message: e.message });
    }
  });

  // Diary: Delete meal item
  app.delete("/api/diary/item/:id", async (req, res) => {
    const userId = req.signedCookies.token;
    const { id } = req.params;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    if (!isDatabaseConfigured()) {
      const memoryDiary = getOrCreateInMemoryDiary(userId);
      memoryDiary.meals = memoryDiary.meals
        .map((meal: any) => ({ ...meal, items: meal.items.filter((item: any) => item.id !== id) }))
        .filter((meal: any) => meal.items.length > 0);
      return res.json({ success: true, mode: "memory" });
    }

    try {
      // Verify ownership
      const item = await prisma.mealItem.findUnique({
        where: { id },
        include: { meal: true }
      });

      if (!item || item.meal.userId !== userId) {
        return res.status(403).json({ error: "Forbidden or not found" });
      }

      await prisma.mealItem.delete({ where: { id } });
      res.json({ success: true });
    } catch (e: any) {
      logError("Delete Diary Item Error:", e);
      res.status(500).json({ error: "Internal Server Error", message: e.message });
    }
  });

  // Activity: List logged activities for a date
  // caloriesBurned приходит уже посчитанным с клиента (MET × вес × часы из профиля
  // в localStorage) — сервер не знает вес пользователя, только хранит результат.
  app.get("/api/activities/:date", async (req, res) => {
    const userId = req.signedCookies.token;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const targetDate = dateFromQuery(req.params.date);
    const targetDateKey = toDateKey(targetDate);

    if (!isDatabaseConfigured()) {
      const list = getOrCreateInMemoryActivities(userId).filter((a: any) => a.dateKey === targetDateKey);
      const totalBurned = list.reduce((s: number, a: any) => s + a.caloriesBurned, 0);
      return res.json({ activities: list, totalBurned, mode: "memory" });
    }

    try {
      const { start, end } = dayRangeFromDate(targetDate);
      const activities = await prisma.activityLog.findMany({
        where: { userId, date: { gte: start, lte: end } },
        orderBy: { createdAt: "asc" },
      });
      const totalBurned = activities.reduce((s, a) => s + a.caloriesBurned, 0);
      res.json({ activities, totalBurned });
    } catch (e: any) {
      logError("Activities Get Error:", e);
      res.status(500).json({ error: "Internal Server Error", message: e.message });
    }
  });

  // Activity: Log a new activity
  app.post("/api/activities", validateBody(activitySchema), async (req, res) => {
    const userId = req.signedCookies.token;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { date, activityName, durationMinutes, caloriesBurned } = req.body;

    const targetDate = dateFromQuery(date);
    const targetDateKey = toDateKey(targetDate);

    if (!isDatabaseConfigured()) {
      const list = getOrCreateInMemoryActivities(userId);
      const entry = {
        id: `activity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        dateKey: targetDateKey,
        activityName,
        durationMinutes,
        caloriesBurned,
        createdAt: new Date().toISOString(),
      };
      list.push(entry);
      return res.json({ activity: entry, mode: "memory" });
    }

    try {
      const activity = await prisma.activityLog.create({
        data: { userId, date: targetDate, activityName, durationMinutes, caloriesBurned },
      });
      res.json({ activity });
    } catch (e: any) {
      logError("Activities Create Error:", e);
      res.status(500).json({ error: "Internal Server Error", message: e.message });
    }
  });

  // Activity: Delete a logged activity
  app.delete("/api/activities/:id", async (req, res) => {
    const userId = req.signedCookies.token;
    const { id } = req.params;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    if (!isDatabaseConfigured()) {
      const list = getOrCreateInMemoryActivities(userId);
      inMemoryActivities.set(userId, list.filter((a: any) => a.id !== id));
      return res.json({ success: true, mode: "memory" });
    }

    try {
      const activity = await prisma.activityLog.findUnique({ where: { id } });
      if (!activity || activity.userId !== userId) {
        return res.status(403).json({ error: "Forbidden or not found" });
      }

      await prisma.activityLog.delete({ where: { id } });
      res.json({ success: true });
    } catch (e: any) {
      logError("Delete Activity Error:", e);
      res.status(500).json({ error: "Internal Server Error", message: e.message });
    }
  });

  // Weight: Log today's (or a given date's) body weight — одна запись на день,
  // повторная запись в тот же день обновляет значение (upsert по [userId, date]).
  app.post("/api/weight", validateBody(weightSchema), async (req, res) => {
    const userId = req.signedCookies.token;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { date, weightKg } = req.body;

    const targetDate = dateFromQuery(date);
    const targetDateKey = toDateKey(targetDate);

    if (!isDatabaseConfigured()) {
      const log = getOrCreateInMemoryWeightLogs(userId);
      log.set(targetDateKey, weightKg);
      return res.json({ weightLog: { date: targetDateKey, weightKg }, mode: "memory" });
    }

    try {
      const { start } = dayRangeFromDate(targetDate);
      const weightLog = await prisma.weightLog.upsert({
        where: { userId_date: { userId, date: start } },
        update: { weightKg },
        create: { userId, date: start, weightKg },
      });
      res.json({ weightLog });
    } catch (e: any) {
      logError("Weight Log Create Error:", e);
      res.status(500).json({ error: "Internal Server Error", message: e.message });
    }
  });

  // Weight: History for the last N days
  app.get("/api/weight/history", async (req, res) => {
    const userId = req.signedCookies.token;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const days = Math.min(365, Math.max(1, parseInt(String(req.query.days ?? "30"), 10) || 30));
    const since = new Date();
    since.setDate(since.getDate() - days);

    if (!isDatabaseConfigured()) {
      const log = getOrCreateInMemoryWeightLogs(userId);
      const history = Array.from(log.entries())
        .map(([date, weightKg]) => ({ date, weightKg }))
        .filter((entry) => new Date(entry.date) >= since)
        .sort((a, b) => a.date.localeCompare(b.date));
      return res.json({ history, mode: "memory" });
    }

    try {
      const logs = await prisma.weightLog.findMany({
        where: { userId, date: { gte: since } },
        orderBy: { date: "asc" },
      });
      const history = logs.map((l) => ({ date: toDateKey(l.date), weightKg: l.weightKg }));
      res.json({ history });
    } catch (e: any) {
      logError("Weight History Error:", e);
      res.status(500).json({ error: "Internal Server Error", message: e.message });
    }
  });

  // Экспорт личных данных пользователя в zip (GDPR-style)
  app.get("/api/export", async (req, res) => {
    const userId = req.signedCookies.token;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    let diary: any[];
    let customFoods: any[];
    let weightHistory: any[];
    let activityHistory: any[];

    if (!isDatabaseConfigured()) {
      diary = getOrCreateInMemoryDiary(userId).meals;
      customFoods = getOrCreateInMemoryCustomProducts(userId);
      weightHistory = Array.from(getOrCreateInMemoryWeightLogs(userId).entries())
        .map(([date, weightKg]) => ({ date, weightKg }));
      activityHistory = getOrCreateInMemoryActivities(userId);
    } else {
      try {
        const [meals, products, weightLogs, activities] = await Promise.all([
          prisma.meal.findMany({
            where: { userId },
            include: { items: { include: { product: true } } },
            orderBy: { date: "asc" },
          }),
          prisma.product.findMany({ where: { createdByUserId: userId, source: "user" } }),
          prisma.weightLog.findMany({ where: { userId }, orderBy: { date: "asc" } }),
          prisma.activityLog.findMany({ where: { userId }, orderBy: { date: "asc" } }),
        ]);
        diary = meals;
        customFoods = products;
        weightHistory = weightLogs.map((l) => ({ date: toDateKey(l.date), weightKg: l.weightKg }));
        activityHistory = activities;
      } catch (e: any) {
        logError("Export Error:", e);
        return res.status(500).json({ error: "Internal Server Error", message: e.message });
      }
    }

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="nutria-export-${toDateKey(new Date())}.zip"`);

    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.on("error", (err) => {
      logError("Export archive error:", err);
      if (!res.headersSent) res.status(500).json({ error: "Internal Server Error" });
      else res.end();
    });
    archive.pipe(res);
    archive.append(JSON.stringify(diary, null, 2), { name: "diary.json" });
    archive.append(JSON.stringify(customFoods, null, 2), { name: "custom_foods.json" });
    archive.append(JSON.stringify(weightHistory, null, 2), { name: "weight_history.json" });
    archive.append(JSON.stringify(activityHistory, null, 2), { name: "activity_history.json" });
    await archive.finalize();
  });

  // Diary: Add meal item
  app.post("/api/diary/add", validateBody(diaryAddSchema), async (req, res) => {
    const userId = req.signedCookies.token;
    let { productId, amount, type, usdaData, date } = req.body;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const targetDate = dateFromQuery(date);
    const targetDateKey = toDateKey(targetDate);

    if (!isDatabaseConfigured()) {
      const memoryDiary = getOrCreateInMemoryDiary(userId);
      const mealType = type || "SNACK";
      const mealId = `${mealType}-${targetDateKey}`;
      let meal = memoryDiary.meals.find((m: any) => m.id === mealId && getMealDateKey(m) === targetDateKey);

      if (!meal) {
        meal = { id: mealId, type: mealType, dateKey: targetDateKey, items: [] };
        memoryDiary.meals.push(meal);
      }

      const fallbackProduct = usdaData || {
        id: String(productId || `manual-${Date.now()}`),
        name: "Продукт",
        brand: "Manual",
        calories: 0,
        protein: 0,
        fat: 0,
        carbs: 0,
        fiber: 0,
      };

      const mealItem = {
        id: `mi-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        amount: Number(amount) || 0,
        product: fallbackProduct,
      };

      meal.items.push(mealItem);
      touchInMemoryRecent(userId, fallbackProduct, Number(amount) || 0);
      return res.json({ ...mealItem, mode: "memory", date: targetDateKey });
    }

    try {
      if (isGeneratedProductId(String(productId)) && usdaData) {
        const product = await ensureProductExistsLocally(String(productId), usdaData);
        if (!product) {
          return res.status(400).json({ error: "Unable to persist generated product" });
        }
        productId = product.id;
      }

      const { start: startOfDay, end: endOfDay } = dayRangeFromDate(targetDate);

      let meal = await prisma.meal.findFirst({
        where: {
          userId,
          type,
          date: { gte: startOfDay, lte: endOfDay }
        }
      });

      if (!meal) {
        meal = await prisma.meal.create({
          data: { userId, type, date: startOfDay }
        });
      }

      const mealItem = await prisma.mealItem.create({
        data: {
          mealId: meal.id,
          productId,
          amount: Number(amount)
        }
      });

      try {
        await touchRecentFood(userId, productId, Number(amount));
      } catch (e) {
        logError("touchRecentFood error:", e);
      }

      res.json(mealItem);
    } catch (e: any) {
      logError("Diary Add Error:", e);
      res.status(500).json({ error: "Internal Server Error", message: e.message });
    }
  });

  // Diary: Edit meal item weight (calories/macros recalculate on read from product x amount)
  app.patch("/api/diary/item/:id", validateBody(diaryItemAmountSchema), async (req, res) => {
    const userId = req.signedCookies.token;
    const { id } = req.params;
    const { amount } = req.body;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    if (!isDatabaseConfigured()) {
      const memoryDiary = getOrCreateInMemoryDiary(userId);
      let updated = false;
      memoryDiary.meals.forEach((meal: any) => {
        meal.items.forEach((item: any) => {
          if (item.id === id) {
            item.amount = amount;
            updated = true;
          }
        });
      });
      if (!updated) return res.status(404).json({ error: "Not found" });
      return res.json({ success: true, mode: "memory" });
    }

    try {
      const item = await prisma.mealItem.findUnique({ where: { id }, include: { meal: true } });
      if (!item || item.meal.userId !== userId) {
        return res.status(403).json({ error: "Forbidden or not found" });
      }

      const updatedItem = await prisma.mealItem.update({ where: { id }, data: { amount } });
      res.json(updatedItem);
    } catch (e: any) {
      logError("Update Diary Item Error:", e);
      res.status(500).json({ error: "Internal Server Error", message: e.message });
    }
  });

  // Quick Add: быстрая запись без поиска продукта — название + ккал/КБЖУ напрямую.
  // Реализовано без новых полей в схеме: создаём обычный Product (source: "quickadd")
  // с введёнными значениями как "на 100г" и MealItem с amount: 100, чтобы они отражали
  // ровно ту порцию, которую пользователь указал.
  app.post("/api/diary/quick-add", validateBody(quickAddSchema), async (req, res) => {
    const userId = req.signedCookies.token;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { date, mealType, label, calories, protein, fat, carbs } = req.body;
    const safeLabel = label;
    const safeCalories = calories;

    const type = mealType || "SNACK";
    const targetDate = dateFromQuery(date);
    const targetDateKey = toDateKey(targetDate);

    const quickProductData = {
      name: safeLabel,
      brand: "Быстрый ввод",
      calories: safeCalories,
      protein: numberOrZero(protein),
      fat: numberOrZero(fat),
      carbs: numberOrZero(carbs),
      fiber: 0,
      source: "quickadd",
    };

    if (!isDatabaseConfigured()) {
      const memoryDiary = getOrCreateInMemoryDiary(userId);
      const mealId = `${type}-${targetDateKey}`;
      let meal = memoryDiary.meals.find((m: any) => m.id === mealId && getMealDateKey(m) === targetDateKey);
      if (!meal) {
        meal = { id: mealId, type, dateKey: targetDateKey, items: [] };
        memoryDiary.meals.push(meal);
      }
      const mealItem = {
        id: `mi-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        amount: 100,
        product: { id: `quickadd-${Date.now()}`, ...quickProductData },
      };
      meal.items.push(mealItem);
      return res.json({ ...mealItem, mode: "memory", date: targetDateKey });
    }

    try {
      const product = await prisma.product.create({
        data: { ...quickProductData, createdByUserId: userId },
      });

      const { start: startOfDay, end: endOfDay } = dayRangeFromDate(targetDate);
      let meal = await prisma.meal.findFirst({
        where: { userId, type, date: { gte: startOfDay, lte: endOfDay } },
      });
      if (!meal) {
        meal = await prisma.meal.create({ data: { userId, type, date: startOfDay } });
      }

      const mealItem = await prisma.mealItem.create({
        data: { mealId: meal.id, productId: product.id, amount: 100 },
      });

      res.json({ ...mealItem, product });
    } catch (e: any) {
      logError("Quick Add Error:", e);
      res.status(500).json({ error: "Internal Server Error", message: e.message });
    }
  });

  // Voice: Parse transcript into food items
  app.post("/api/voice/parse", validateBody(voiceParseSchema), async (req, res) => {
    const { transcript } = req.body;
    const userId = req.signedCookies.token;

    const buildDecompositionPrompt = (reinforce: boolean) => `Пользователь записал голосовую заметку о приёме пищи: "${transcript}".

Разбери фразу на отдельные продукты/ингредиенты для базы данных питания.
- Если фраза называет готовое/приготовленное блюдо — даже одним словом, без явного перечисления состава (например "котлета", "яичница", "блины", "плов", "пирог") — разбей его на типичные ингредиенты по стандартному рецепту этого блюда, включая масло/жир для жарки или выпечки, если блюдо обычно готовится с ним. Не пропускай этот разбор только из-за того, что во фразе одно слово.
- Если упомянут один сырой/целый продукт без признаков готового блюда (например просто "банан", "помидор", "хлеб", "йогурт"), верни его как есть, без выдуманных дополнительных ингредиентов.
- КРИТИЧНО: каждый грамм еды учитывай ровно ОДИН раз. Никогда не включай одновременно готовый компонент и его же сырьё: если в ответе есть "Блины" — в нём НЕ может быть муки, молока и яиц для этих блинов; если есть "Хлеб" — не добавляй муку. Разбирай блюдо только на один уровень — на его непосредственные составные части (блинчики с творогом = блины + творог, а НЕ блины + мука + молоко + яйцо + творог). На сырьё разбирай только тогда, когда готового компонента как продукта не существует в базах питания.
- Используй для названий компонентов конкретные продукты, которые реально есть в базе питания (например "Куриное филе", а не обобщённое название самого блюда), чтобы поиск находил правильный продукт, а не первое похожее по названию совпадение.
- Распознавай числительные, включая словесные ("два", "четыре", "пара", "пол"), и переводи количество штук в граммы через типичный вес одной штуки (яйцо ≈ 50 г, помидор ≈ 120 г, банан ≈ 120 г, кусок хлеба ≈ 30 г и т.д.), умножая на указанное число.
- Если количество не указано вовсе, оцени типичную порцию для этого ингредиента в составе блюда.
- Фраза — это результат распознавания речи: в ней могут быть опечатки, слова-паразиты или неточная транскрипция. Ищи в ней пищевые слова даже при неидеальной формулировке, не отбрасывай фразу целиком из-за мелких неточностей.
- Названия продуктов указывай в нормальной словарной форме на русском (именительный падеж, без лишних слов), чтобы их легко было найти в базе питания, например "Яйцо куриное", "Говядина", "Лук репчатый".

Примеры:
Фраза: "Яичница с говядиной и луком, четыре яйца"
Ответ: {"items": [
  {"name": "Яйцо куриное", "amount": 200},
  {"name": "Говядина", "amount": 100},
  {"name": "Лук репчатый", "amount": 40},
  {"name": "Растительное масло", "amount": 10}
]}

Фраза: "Яичница из четырёх яиц"
Ответ: {"items": [
  {"name": "Яйцо куриное", "amount": 200},
  {"name": "Растительное масло", "amount": 5}
]}

Фраза: "Куриная котлета"
Ответ: {"items": [
  {"name": "Куриное филе", "amount": 120},
  {"name": "Яйцо куриное", "amount": 20},
  {"name": "Сухари панировочные", "amount": 15},
  {"name": "Растительное масло", "amount": 10}
]}

Фраза: "Четыре блинчика с творогом"
Ответ: {"items": [
  {"name": "Блины", "amount": 240},
  {"name": "Творог 5%", "amount": 120}
]}
(блины — готовый продукт из базы, поэтому мука/молоко/яйца для них НЕ добавляются — иначе одна и та же еда была бы посчитана дважды)

Верни только JSON-объект вида: {"items": [{"name": "название на русском", "amount": число в граммах или мл}]}.
Пустой список items допустим только если во фразе вообще нет ни одного упоминания еды или напитка.${reinforce ? " В этой фразе есть упоминание еды — найди хотя бы один продукт, не возвращай пустой список." : ""}`;

    let items: any[] = [];
    try {
      const responseText = await withTimeout(generateAI(buildDecompositionPrompt(false)), 12000, "Voice decomposition");
      items = unwrapAiItemsArray(parseAiJsonPayload(responseText || "{}"));

      if (items.length === 0) {
        const retryText = await withTimeout(generateAI(buildDecompositionPrompt(true)), 12000, "Voice decomposition retry");
        items = unwrapAiItemsArray(parseAiJsonPayload(retryText || "{}"));
      }
    } catch (e) {
      logError("Voice decomposition error:", e);
      return res.status(500).json({ error: "Failed to parse voice input" });
    }

    // Match each decomposed item independently: a slow/failing lookup for one
    // ingredient must not take down the whole phrase, so failures and timeouts
    // degrade to product: null instead of rejecting the batch.
    const matchedItems = await Promise.all(items.map(async (item: any) => {
      const itemName = String(item?.name || "").trim();
      const amount = clampNumber(item?.amount, 1, 5000, 100);
      if (!itemName) return { name: itemName, amount, product: null };

      try {
        const correction = await findRecognitionCorrectionMatch(userId, {
          name: itemName,
          amount,
          aliases: [],
          searchHints: [],
          visibleText: [],
          barcodeCandidates: [],
        });
        if (correction?.correctedProduct) {
          return {
            name: itemName,
            amount,
            product: correction.correctedProduct,
            matchedBy: "correction",
          };
        }

        let candidates = await withTimeout(
          searchProductsEngine(itemName, {
            limit: 1,
            cache: true,
            localize: true,
            allowAiEstimate: true,
            fast: true,
          }),
          15000,
          `Match "${itemName}"`
        );
        if (candidates.length === 0) {
          candidates = await withTimeout(
            searchProductsEngine(itemName, {
              limit: 1,
              cache: true,
              localize: true,
              allowAiEstimate: true,
              fast: false,
            }),
            20000,
            `Full match "${itemName}"`
          );
        }
        return { name: itemName, amount, product: candidates[0] || null };
      } catch (e) {
        logError(`Voice item match failed for "${itemName}":`, e);
        return { name: itemName, amount, product: null };
      }
    }));

    res.json(matchedItems.map((item: any) => ({
      ...item,
      product: withNutritionContract(item.product),
    })));
  });

  // --- Admin Routes ---
  app.get("/api/admin/users", async (req, res) => {
    try {
      const userId = req.signedCookies.token;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (user?.role !== "ADMIN") return res.status(403).json({ error: "Forbidden" });
      const users = await prisma.user.findMany({ include: { _count: { select: { meals: true } } } });
      res.json(users);
    } catch (e: any) {
      logError("Admin Users Error:", e);
      res.status(500).json({ error: "Internal Server Error", message: e.message });
    }
  });

  app.get("/api/admin/stats", async (req, res) => {
    try {
      const userId = req.signedCookies.token;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (user?.role !== "ADMIN") return res.status(403).json({ error: "Forbidden" });

      const userCount = await prisma.user.count();
      const productCount = await prisma.product.count();
      const mealCount = await prisma.meal.count();

      res.json({ userCount, productCount, mealCount });
    } catch (e: any) {
      logError("Admin Stats Error:", e);
      res.status(500).json({ error: "Internal Server Error", message: e.message });
    }
  });


  // --- CRM маршруты (нутрициолог) ---
  registerCrmRoutes(app, prisma);

  // --- Telegram-бот для клиента ---
  registerTelegramBot(app, prisma);

  // --- Vite / Static ---
  if (process.env.NODE_ENV === "test") {
    // В тестах нужны только API-маршруты, без Vite middleware и без раздачи статики.
  } else if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist"), {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        }
      }
    }));
    app.get("*", (req, res) => {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  // Global error handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logError("Global Error Handler:", err);
    res.status(500).json({
      error: "Internal Server Error",
      message: err.message,
      stack: process.env.NODE_ENV === "production" ? undefined : err.stack
    });
  });

  return app;
}

async function startServer() {
  const app = await createApp();
  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Nutria Server running on http://localhost:${PORT}`);
  });

  // Разовый прогон точной (USDA → AI) докомплектации микроэлементов по всей базе:
  // выставить MICRONUTRIENT_BACKFILL_ON_BOOT=500 (лимит продуктов за прогон) в env,
  // задеплоить, дождаться "[micronutrient-backfill] finished" в логах и убрать переменную.
  const backfillOnBoot = Number(process.env.MICRONUTRIENT_BACKFILL_ON_BOOT) || 0;
  if (backfillOnBoot > 0) {
    setTimeout(() => {
      console.log(`[micronutrient-backfill] starting boot backfill (limit ${backfillOnBoot})`);
      runMicronutrientBackfill(backfillOnBoot).catch((e) => logError("Boot backfill error:", e));
    }, 30_000);
  }

  setTimeout(() => {
    runMicronutrientQueueBatch(10).catch((e) => logError("Micronutrient queue startup error:", e));
  }, 10_000);
  const micronutrientQueueTimer = setInterval(() => {
    runMicronutrientQueueBatch(10).catch((e) => logError("Micronutrient queue worker error:", e));
  }, 60_000);
  micronutrientQueueTimer.unref();
}

if (process.env.NODE_ENV !== "test") {
  startServer().catch(console.error);
}
