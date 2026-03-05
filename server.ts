import express from "express";
import { createServer as createViteServer } from "vite";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";
import multer from "multer";
import { GoogleGenAI, Type } from "@google/genai";
import Levenshtein from "fast-levenshtein";
import OpenAI from "openai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const prisma = new PrismaClient();
const upload = multer({ storage: multer.memoryStorage() });

// AI Clients
const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;
const deepseek = process.env.DEEPSEEK_API_KEY ? new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com"
}) : null;
const openai = process.env.OPENAI_API_KEY ? new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
}) : null;
const OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL || "gpt-4o-mini";

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
const inMemoryDiary = new Map<string, InMemoryDiaryState>();
const barcodeLookupCache = new Map<string, { expiresAt: number; product: any }>();
const productSearchCache = new Map<string, { expiresAt: number; results: any[] }>();

const BARCODE_PREFERRED_COUNTRY = (process.env.BARCODE_PREFERRED_COUNTRY || "ru").toLowerCase();
const BARCODE_PREFERRED_LANG = (process.env.BARCODE_PREFERRED_LANG || "ru").toLowerCase();
const BARCODE_LOOKUP_TIMEOUT_MS = Number(process.env.BARCODE_LOOKUP_TIMEOUT_MS || 3500);
const BARCODE_CACHE_TTL_MS = Number(process.env.BARCODE_CACHE_TTL_MS || 1000 * 60 * 60 * 6);
const PRODUCT_SEARCH_CACHE_TTL_MS = Number(process.env.PRODUCT_SEARCH_CACHE_TTL_MS || 1000 * 60 * 10);
const RU_LOCALIZATION_CACHE_TTL_MS = Number(process.env.RU_LOCALIZATION_CACHE_TTL_MS || 1000 * 60 * 60 * 24 * 14);
const ruLocalizationCache = new Map<string, { expiresAt: number; value: string }>();
const CYRILLIC_RE = /[А-Яа-яЁё]/;

function getOrCreateInMemoryDiary(userId: string) {
  if (!inMemoryDiary.has(userId)) {
    inMemoryDiary.set(userId, { meals: [], goals: { ...DEMO_GOALS }, waterByDate: {} });
  }
  return inMemoryDiary.get(userId)!;
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

function getCachedProductSearch(query: string) {
  const key = String(query || "").trim().toLowerCase();
  if (!key) return null;
  const cached = productSearchCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    productSearchCache.delete(key);
    return null;
  }
  return cached.results;
}

function cacheProductSearch(query: string, results: any[]) {
  const key = String(query || "").trim().toLowerCase();
  if (!key) return;
  productSearchCache.set(key, {
    expiresAt: Date.now() + PRODUCT_SEARCH_CACHE_TTL_MS,
    results,
  });
}

function numberOrZero(value: any) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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
    const text = await generateAI(`Переведи на русский язык ${type === "name" ? "название продукта/блюда" : "название бренда"}: "${raw}".
Сохрани смысл и пищевой контекст.
Верни только JSON вида: {"text":"..."}`);
    const parsed = JSON.parse(text || "{}");
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

  const localizedName = await localizeTextToRussian(product.name, "name");
  const localizedBrand = product.brand ? await localizeTextToRussian(product.brand, "brand") : product.brand;

  return {
    ...product,
    name: localizedName || product.name,
    brand: localizedBrand || product.brand,
  } as T;
}

function normalizeUnitName(unit: any) {
  return String(unit || "").trim().toLowerCase();
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

function shouldRefreshMicronutrients(existingRaw: any, incoming: any) {
  const existing = parseMicronutrients(existingRaw);
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
    const incomingGroup = incoming?.[group] || {};
    return keys.some((key) => numberOrZero(incomingGroup[key]) > 0);
  });

  if (!hasIncomingSignal) return false;

  // Trigger refresh when existing product misses any configured nutrient key
  // that is present with a positive value in incoming USDA/AI payload.
  for (const [group, keys] of Object.entries(nutrientKeysByGroup)) {
    const existingGroup = existing?.[group] || {};
    const incomingGroup = incoming?.[group] || {};

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

function extractUsdaExtendedNutrients(food: any) {
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

function normalizeOpenFoodFactsProduct(rawProduct: any, barcode: string) {
  const nutr = rawProduct?.nutriments || {};
  return {
    id: `off-${barcode}`,
    name:
      rawProduct?.product_name_ru ||
      rawProduct?.product_name ||
      rawProduct?.generic_name_ru ||
      rawProduct?.generic_name ||
      `Product ${barcode}`,
    brand: rawProduct?.brands || "OpenFoodFacts",
    calories: numberOrZero(nutr["energy-kcal_100g"] ?? nutr["energy-kcal"]),
    protein: numberOrZero(nutr["proteins_100g"]),
    fat: numberOrZero(nutr["fat_100g"]),
    carbs: numberOrZero(nutr["carbohydrates_100g"]),
    fiber: numberOrZero(nutr["fiber_100g"]),
    barcode,
    isUsda: true,
    source: "openfoodfacts"
  };
}

async function fetchOpenFoodFactsProduct(barcode: string) {
  const apiUrls = [
    `https://ru.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?lc=${BARCODE_PREFERRED_LANG}&cc=${BARCODE_PREFERRED_COUNTRY}`,
    `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?lc=${BARCODE_PREFERRED_LANG}&cc=${BARCODE_PREFERRED_COUNTRY}`
  ];

  for (const url of apiUrls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BARCODE_LOOKUP_TIMEOUT_MS);

    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) continue;

      const payload: any = await response.json().catch(() => null);
      if (!payload || payload.status !== 1 || !payload.product) continue;

      return normalizeOpenFoodFactsProduct(payload.product, barcode);
    } catch {
      // try next endpoint
    } finally {
      clearTimeout(timer);
    }
  }

  return null;
}

async function upsertProductFromBarcodeLookup(product: any) {
  if (!isDatabaseConfigured()) return null;
  if (!product?.barcode || !product?.name) return null;

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
        micronutrients: "{}"
      }
    });
  } catch (e) {
    console.warn("Failed to upsert barcode product:", e);
    return null;
  }
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
      console.error("OpenAI Error:", e);
    }
  }

  throw new Error("All AI models failed or keys are missing.");
}

async function startServer() {
  // ... rest of setup ...
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json());
  app.use(cookieParser());

  // --- API Routes ---

  // AI Proxy: Unified generation with fallback
  app.post("/api/ai/generate", async (req, res) => {
    const { prompt, responseMimeType, image } = req.body;
    if (!prompt) return res.status(400).json({ error: "No prompt provided" });

    try {
      const text = await generateAI(prompt, responseMimeType, image);
      res.json({ text });
    } catch (e: any) {
      console.error("AI Proxy Error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // Health check
  app.get("/api/health", async (req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: "ok", database: "connected", version: "1.0.0" });
    } catch (e: any) {
      console.error("Health check database error:", e);
      res.status(500).json({ status: "error", database: "disconnected", error: e.message });
    }
  });

  // Barcode / QR lookup
  app.get("/api/products/barcode/:code", async (req, res) => {
    try {
      const { code } = req.params;
      const candidates = extractBarcodeCandidates(code);
      if (candidates.length === 0) return res.status(400).json({ error: "Invalid barcode" });

      const cached = getCachedBarcodeProduct(candidates);
      if (cached) {
        return res.json(cached);
      }

      if (isDatabaseConfigured()) {
        const product = await prisma.product.findFirst({
          where: {
            barcode: { in: candidates }
          }
        });

        if (product) {
          cacheBarcodeProduct(candidates, product);
          return res.json(product);
        }
      }

      for (const candidate of candidates) {
        const offProduct = await fetchOpenFoodFactsProduct(candidate);
        if (!offProduct) continue;

        const persisted = await upsertProductFromBarcodeLookup(offProduct);
        const responseProduct = persisted || offProduct;
        cacheBarcodeProduct(candidates, responseProduct);
        return res.json(responseProduct);
      }

      return res.status(404).json({ error: "Not found" });
    } catch (e: any) {
      console.error("Barcode lookup error:", e);
      return res.status(500).json({ error: "Barcode lookup failed", message: e?.message || "Unknown error" });
    }
  });

  // Auth Placeholder (Mock)
  app.post("/api/auth/login", async (req, res) => {
    if (!isDatabaseConfigured()) {
      res.cookie("token", DEMO_USER_ID, { httpOnly: true, secure: true, sameSite: "none" });
      return res.json({ success: true, user: { email: DEMO_USER.email, role: DEMO_USER.role }, mode: "memory" });
    }

    try {
      let user = await prisma.user.findFirst({ where: { email: "user@nutria.app" } });
      if (!user) {
        user = await prisma.user.create({
          data: {
            email: "user@nutria.app",
            passwordHash: "mock-hash",
            role: "USER",
            nutrientGoals: {
              create: {
                calories: 2100,
                protein: 120,
                fat: 70,
                carbs: 250,
                fiber: 30
              }
            }
          }
        });
      }
      res.cookie("token", user.id, { httpOnly: true, secure: true, sameSite: "none" });
      res.json({ success: true, user: { email: user.email, role: user.role } });
    } catch (e: any) {
      console.error("Auth Login Error:", e);
      res.status(500).json({ error: "Internal Server Error", message: e.message });
    }
  });

  app.get("/api/auth/me", async (req, res) => {
    try {
      const userId = req.cookies.token;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      if (!isDatabaseConfigured()) {
        if (userId !== DEMO_USER_ID) return res.status(401).json({ error: "Unauthorized" });
        return res.json({ user: DEMO_USER, mode: "memory" });
      }

      const user = await prisma.user.findUnique({ where: { id: userId } });
      res.json({ user });
    } catch (e: any) {
      console.error("Auth Me Error:", e);
      res.status(500).json({ error: "Internal Server Error", message: e.message });
    }
  });

  // Food Match Engine: Search products
  app.get("/api/products/search", async (req, res) => {
    try {
      const { q } = req.query;
      if (!q) return res.json([]);

      const query = String(q).trim();
      const cachedSearch = getCachedProductSearch(query);
      if (cachedSearch) {
        return res.json(cachedSearch);
      }

      const dbReady = isDatabaseConfigured();
    
    // Stage A: Normalization & Translation (using Gemini)
    // We normalize the query to handle synonyms, units, and translate to English for USDA
    let normalizedQuery = query;
    let englishQuery = query;
    let searchTerms: string[] = [query];
    let categories: string[] = [];

    try {
      const normResponseText = await generateAI(`Проанализируй поисковый запрос по еде: "${query}".
    Пользователь русскоязычный. Верни JSON со структурой:
    - normalized: каноничное название на русском (например, "яблоко")
    - english: краткий англоязычный термин для поиска в USDA
    - search_terms: массив из 3-5 ключевых слов для поиска (включи русские и английские варианты)
    - tags: массив категорий (например ["fruit", "snack", "raw"])
    - isDrink: boolean
    Верни только JSON.`);
      const normData = JSON.parse(normResponseText || '{}');
      normalizedQuery = normData.normalized || query;
      englishQuery = normData.english || query;
      searchTerms = Array.from(new Set([
        query, 
        normalizedQuery, 
        englishQuery, 
        ...(normData.search_terms || [])
      ])).filter(t => t && t.length > 1);
      categories = normData.tags || [];
    } catch (e) {
      console.error("Normalization error:", e);
    }

    // Stage B: Fast Candidate Selection
    // 1. Search local DB (using token-based approach for better matching)
      const tokens = query.split(/\s+/).filter(t => t.length > 1);
      const localProducts = dbReady
        ? await prisma.product.findMany({
            where: {
              OR: [
                { name: { contains: normalizedQuery } },
                { name: { contains: query } },
                { name: { contains: englishQuery } },
                ...searchTerms.map(t => ({ name: { contains: t } })),
                ...tokens.map(t => ({ name: { contains: t } })),
                { brand: { contains: query } }
              ]
            },
            take: 30
          })
        : [];
    
    const parsedLocal = localProducts.map(p => {
      let micro: any = {};
      try {
        micro = JSON.parse(p.micronutrients || '{}');
      } catch (e) {}
      return { ...p, ...micro, source: 'local' };
    });

    // 2. Search USDA API
    let usdaProducts: any[] = [];
    const usdaKey = process.env.USDA_FDC_API_KEY;
    if (usdaKey && englishQuery.length > 1) {
      try {
        // Search with English query
        const response = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${usdaKey}&query=${encodeURIComponent(englishQuery)}&pageSize=15`);
        if (response.ok) {
          const data: any = await response.json();
          usdaProducts = (data.foods || []).map((f: any) => {
            const getNutrient = (id: number) =>
              f.foodNutrients?.find((n: any) => n.nutrientId === id || n.nutrientNumber === String(id))?.value || 0;
            const extended = extractUsdaExtendedNutrients(f);

            return {
              id: `usda-${f.fdcId}`,
              name: f.description,
              brand: f.brandOwner || 'USDA',
              calories: getNutrient(1008) || getNutrient(208),
              protein: getNutrient(1003) || getNutrient(203),
              fat: getNutrient(1004) || getNutrient(204),
              carbs: getNutrient(1005) || getNutrient(205),
              fiber: getNutrient(1079) || getNutrient(291),
              vitamins: extended.vitamins,
              minerals: extended.minerals,
              aminoAcids: extended.aminoAcids,
              fattyAcids: extended.fattyAcids,
              carbohydrateTypes: extended.carbohydrateTypes,
              isUsda: true,
              fdcId: f.fdcId,
              source: 'usda'
            };
          });
        }
      } catch (e) {
        console.error("USDA Search Error:", e);
      }
    }

    // Stage C: String Similarity & Ranking
    const allCandidates = [...parsedLocal, ...usdaProducts];
    const scoredCandidates = allCandidates.map(c => {
      const nameLower = c.name.toLowerCase();
      const queryLower = query.toLowerCase();
      const normLower = normalizedQuery.toLowerCase();
      const engLower = englishQuery.toLowerCase();
      
      // 1. Levenshtein Distance (Character level)
      const distQuery = Levenshtein.get(queryLower, nameLower);
      const distNorm = Levenshtein.get(normLower, nameLower);
      const distEng = Levenshtein.get(engLower, nameLower);
      const minDist = Math.min(distQuery, distNorm, distEng);
      const maxLen = Math.max(queryLower.length, nameLower.length, normLower.length, engLower.length);
      const charSimilarity = 1 - (minDist / maxLen);
      
      // 2. Token Overlap (Word level)
      const queryTokens = new Set([...queryLower.split(/\s+/), ...normLower.split(/\s+/), ...engLower.split(/\s+/)]);
      const nameTokens = nameLower.split(/\s+/);
      const overlap = nameTokens.filter(t => queryTokens.has(t)).length;
      const tokenSimilarity = overlap / Math.max(queryTokens.size, nameTokens.length);

      // 3. Substring Match Boost
      const containsBoost = (nameLower.includes(queryLower) || nameLower.includes(normLower) || nameLower.includes(engLower)) ? 0.2 : 0;
      
      // 4. Source Boost
      const sourceBoost = c.source === 'local' ? 0.1 : 0;
      
      const finalScore = (charSimilarity * 0.3) + (tokenSimilarity * 0.5) + containsBoost + sourceBoost;
      
      return { ...c, matchScore: finalScore };
    });

    // Sort by match score
    scoredCandidates.sort((a, b) => b.matchScore - a.matchScore);

    // Stage D: LLM Re-rank (Final Layer) & AI Estimation
    let finalResults = scoredCandidates.slice(0, 15);
    
    // If we have very few results or low confidence, we ask AI to estimate the product
    if (finalResults.length === 0 || (finalResults.length > 0 && finalResults[0].matchScore < 0.6)) {
      try {
        const estimateResponseText = await generateAI(`Пользователь ищет продукт: "${query}".
          Точного совпадения в базе нет.
          Оцени пищевую ценность для 100 г и верни только JSON:
          {
            "name": "Название на русском",
            "calories": number,
            "protein": number,
            "fat": number,
            "carbs": number,
            "fiber": number,
            "vitamins": { "C": number, ... },
            "minerals": { "Iron": number, ... },
            "fattyAcids": { "Omega3": number, "Omega6": number, "Omega9": number, "TransFats": number, "Cholesterol": number },
            "carbohydrateTypes": { "Glucose": number, "Fructose": number, "Galactose": number, "Sucrose": number, "Lactose": number, "Maltose": number, "Starch": number, "Fiber": number },
            "aminoAcids": { "Alanine": number, "Arginine": number, "Asparagine": number, "AsparticAcid": number, "Valine": number, "Histidine": number, "Glycine": number, "Glutamine": number, "GlutamicAcid": number, "Isoleucine": number, "Leucine": number, "Lysine": number, "Methionine": number, "Proline": number, "Serine": number, "Tyrosine": number, "Threonine": number, "Tryptophan": number, "Phenylalanine": number, "Cysteine": number },
            "explanation": "Коротко почему такие значения"
          }
          Важно:
          - aminoAcids: миллиграммы (mg) на 100 г
          - fattyAcids: граммы (g) на 100 г, кроме Cholesterol (mg)
          - carbohydrateTypes: граммы (g) на 100 г`);
        const estData = JSON.parse(estimateResponseText || '{}');
        if (estData.name) {
          finalResults.unshift({
            id: `ai-est-${Date.now()}`,
            name: `✨ ${estData.name} (AI Оценка)`,
            brand: 'AI Nutria Engine',
            calories: estData.calories || 0,
            protein: estData.protein || 0,
            fat: estData.fat || 0,
            carbs: estData.carbs || 0,
            fiber: estData.fiber || 0,
            vitamins: estData.vitamins || {},
            minerals: estData.minerals || {},
            aminoAcids: estData.aminoAcids || {},
            fattyAcids: estData.fattyAcids || {},
            carbohydrateTypes: estData.carbohydrateTypes || {},
            isAiEstimated: true,
            explanation: estData.explanation,
            matchScore: 0.95,
            source: 'ai'
          });
        }
      } catch (e) {
        console.error("AI Estimation error:", e);
      }
    }

    // Sort again if AI estimation was added
    finalResults.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));

    if (finalResults.length > 1 && finalResults[0].matchScore < 0.95) {
      try {
        const reRankResponseText = await generateAI(`Пользователь ищет: "${query}" (нормализовано: "${normalizedQuery}").
          Найдены кандидаты:
          ${finalResults.map((c, i) => `${i}: ${c.name} (${c.brand}) - Score: ${c.matchScore}`).join('\n')}
          
          Выбери лучшие совпадения.
          Верни только JSON с массивом индексов по убыванию релевантности.
          Полностью нерелевантные позиции исключи.
          Если есть AI-оценка и она выглядит корректно, можно поставить ее выше.`);
        const reRankData = JSON.parse(reRankResponseText || '{}');
        let indices = [];
        if (Array.isArray(reRankData)) indices = reRankData;
        else if (reRankData.indices && Array.isArray(reRankData.indices)) indices = reRankData.indices;
        
        if (indices.length > 0) {
          finalResults = indices.map((idx: number) => finalResults[idx]).filter(Boolean);
        }
      } catch (e) {
        console.error("Re-ranking error:", e);
      }
    }

      const responseResults = await Promise.all(finalResults.slice(0, 10).map((item) => localizeProductForRussianAudience(item)));
      cacheProductSearch(query, responseResults);
      res.json(responseResults);
    } catch (e: any) {
      console.error("Products Search Error:", e);
      res.status(500).json({ error: "Products search failed", message: e.message });
    }
  });

  // Diary: Get daily meals and aggregates
  app.get("/api/diary", async (req, res) => {
    const userId = req.cookies.token;
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
          let micro: any = {};
          try {
            micro = JSON.parse(i.product.micronutrients || '{}');
          } catch (e) {}
          return {
            ...i,
            product: { ...i.product, ...micro }
          };
        })
      }));

      res.json({ meals: parsedMeals, goals, waterIntake, date: targetDateKey });
    } catch (e: any) {
      console.error("Diary Get Error:", e);
      res.status(500).json({ error: "Internal Server Error", message: e.message });
    }
  });

  // Diary: History for analytics (last N days)
  app.get("/api/diary/history", async (req, res) => {
    const userId = req.cookies.token;
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
      console.error("Diary History Error:", e);
      return res.status(500).json({ error: "Internal Server Error", message: e.message });
    }
  });

  // Diary: Update nutrient goals
  app.post("/api/diary/goals", async (req, res) => {
    const userId = req.cookies.token;
    const { calories, protein, fat, carbs, fiber } = req.body || {};
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const nextGoals = {
      calories: numberOrZero(calories),
      protein: numberOrZero(protein),
      fat: numberOrZero(fat),
      carbs: numberOrZero(carbs),
      fiber: numberOrZero(fiber),
    };

    if (!nextGoals.calories || !nextGoals.protein || !nextGoals.fat || !nextGoals.carbs) {
      return res.status(400).json({ error: "Invalid goals payload" });
    }

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
      console.error("Diary Goals Update Error:", e);
      return res.status(500).json({ error: "Internal Server Error", message: e.message });
    }
  });

  // Diary: Update water intake
  app.post("/api/diary/water", async (req, res) => {
    const userId = req.cookies.token;
    const { amount, date } = req.body; // amount can be positive or negative
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const targetDate = dateFromQuery(date);
    const targetDateKey = toDateKey(targetDate);
    const delta = Number(amount || 0);

    if (!isDatabaseConfigured()) {
      const memoryDiary = getOrCreateInMemoryDiary(userId);
      const current = numberOrZero(memoryDiary.waterByDate[targetDateKey]);
      memoryDiary.waterByDate[targetDateKey] = Math.max(0, current + delta);
      return res.json({ success: true, mode: "memory", waterIntake: memoryDiary.waterByDate[targetDateKey], date: targetDateKey });
    }

    try {
      const { start: startOfDay, end: endOfDay } = dayRangeFromDate(targetDate);

      let meal = await prisma.meal.findFirst({
        where: { userId, type: 'WATER', date: { gte: startOfDay, lte: endOfDay } }
      });

      if (!meal) {
        meal = await prisma.meal.create({
          data: { userId, type: 'WATER', date: startOfDay }
        });
      }

      let waterProduct = await prisma.product.findFirst({ where: { name: 'Water', brand: 'System' } });
      if (!waterProduct) {
        waterProduct = await prisma.product.create({
          data: { name: 'Water', brand: 'System', calories: 0, protein: 0, fat: 0, carbs: 0 }
        });
      }

      await prisma.mealItem.create({
        data: {
          mealId: meal.id,
          productId: waterProduct.id,
          amount: delta
        }
      });

      res.json({ success: true, date: targetDateKey });
    } catch (e: any) {
      console.error("Diary Water Error:", e);
      res.status(500).json({ error: "Internal Server Error", message: e.message });
    }
  });

  // Diary: Delete meal item
  app.delete("/api/diary/item/:id", async (req, res) => {
    const userId = req.cookies.token;
    const { id } = req.params;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    if (!isDatabaseConfigured()) {
      const memoryDiary = getOrCreateInMemoryDiary(userId);
      memoryDiary.meals = memoryDiary.meals
        .map((meal: any) => ({ ...meal, items: meal.items.filter((item: any) => item.id !== id) }))
        .filter((meal: any) => meal.items.length > 0);
      return res.json({ success: true, mode: "memory" });
    }

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
  });

  // Diary: Add meal item
  app.post("/api/diary/add", async (req, res) => {
    const userId = req.cookies.token;
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
      return res.json({ ...mealItem, mode: "memory", date: targetDateKey });
    }

    // If it's a USDA product, we need to ensure it exists in our local DB first
    if ((String(productId).startsWith('usda-') || String(productId).startsWith('ai-est-')) && usdaData) {
      usdaData = await localizeProductForRussianAudience(usdaData);
      let product = await prisma.product.findFirst({
        where: { name: usdaData.name, brand: usdaData.brand }
      });

      if (!product) {
        product = await prisma.product.create({
          data: {
            name: usdaData.name,
            brand: usdaData.brand,
            calories: usdaData.calories,
            protein: usdaData.protein,
            fat: usdaData.fat,
            carbs: usdaData.carbs,
            fiber: usdaData.fiber,
            micronutrients: JSON.stringify({
              vitamins: usdaData.vitamins || {},
              minerals: usdaData.minerals || {},
              aminoAcids: usdaData.aminoAcids || {},
              fattyAcids: usdaData.fattyAcids || {},
              carbohydrateTypes: usdaData.carbohydrateTypes || {}
            })
          }
        });
      } else if (!product.micronutrients || product.micronutrients === '{}' || shouldRefreshMicronutrients(product.micronutrients, usdaData)) {
        // Refresh existing product when micronutrient payload is incomplete.
        product = await prisma.product.update({
          where: { id: product.id },
          data: {
            micronutrients: JSON.stringify({
              vitamins: usdaData.vitamins || {},
              minerals: usdaData.minerals || {},
              aminoAcids: usdaData.aminoAcids || {},
              fattyAcids: usdaData.fattyAcids || {},
              carbohydrateTypes: usdaData.carbohydrateTypes || {}
            })
          }
        });
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

    res.json(mealItem);
  });

  // Voice: Parse transcript into food items
  app.post("/api/voice/parse", async (req, res) => {
    const { transcript } = req.body;
    if (!transcript) return res.status(400).json({ error: "No transcript provided" });

    try {
      const responseText = await generateAI(`Пользователь сказал: "${transcript}".
        Извлеки продукты/блюда и оценочное количество (в граммах или мл).
        Если количество не указано, оцени типичную порцию.
        Верни только JSON-массив объектов: [{ "name": "название на русском", "amount": number }].`);

      const itemsRaw = JSON.parse(responseText || "[]");
      const items = Array.isArray(itemsRaw) ? itemsRaw : [];
      
      // Match each item with database products
      const dbReady = isDatabaseConfigured();

      const matchedItems = await Promise.all(items.map(async (item: any) => {
        // Use the existing search logic (internal call or refactor search logic)
        // For simplicity, we'll fetch from our own search endpoint or reuse the logic
        // Let's just do a quick search here
        const normalizedQuery = item.name;
        const localProducts = dbReady
          ? await prisma.product.findMany({
              where: {
                OR: [
                  { name: { contains: normalizedQuery } },
                  { name: { contains: item.name } }
                ]
              },
              take: 1
            })
          : [];

        if (localProducts.length > 0) {
          const localizedLocalProduct = await localizeProductForRussianAudience({ ...localProducts[0], source: 'local' });
          return { ...item, product: localizedLocalProduct };
        }

        // Try USDA
        const usdaKey = process.env.USDA_FDC_API_KEY;
        if (usdaKey) {
          try {
            let usdaQuery = item.name;
            try {
              const usdaQueryText = await generateAI(`Преобразуй русское/смешанное название продукта в короткий английский запрос для USDA: "${item.name}".
Верни только JSON вида: {"english":"..."}`);
              const usdaQueryData = JSON.parse(usdaQueryText || '{}');
              usdaQuery = String(usdaQueryData?.english || item.name).trim() || item.name;
            } catch {
              usdaQuery = item.name;
            }

            const usdaRes = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${usdaKey}&query=${encodeURIComponent(usdaQuery)}&pageSize=1`);
            if (usdaRes.ok) {
              const usdaData: any = await usdaRes.json();
              if (usdaData.foods && usdaData.foods.length > 0) {
                const f = usdaData.foods[0];
                const getNutrient = (id: number) => f.foodNutrients?.find((n: any) => n.nutrientId === id || n.nutrientNumber === String(id))?.value || 0;
                const extended = extractUsdaExtendedNutrients(f);
                const localizedUsdaProduct = await localizeProductForRussianAudience({
                  id: `usda-${f.fdcId}`,
                  name: f.description,
                  brand: f.brandOwner || 'USDA',
                  calories: getNutrient(1008) || getNutrient(208),
                  protein: getNutrient(1003) || getNutrient(203),
                  fat: getNutrient(1004) || getNutrient(204),
                  carbs: getNutrient(1005) || getNutrient(205),
                  fiber: getNutrient(1079) || getNutrient(291),
                  vitamins: extended.vitamins,
                  minerals: extended.minerals,
                  aminoAcids: extended.aminoAcids,
                  fattyAcids: extended.fattyAcids,
                  carbohydrateTypes: extended.carbohydrateTypes,
                  source: 'usda',
                  isUsda: true
                });
                return { ...item, product: localizedUsdaProduct };
              }
            }
          } catch (e) {}
        }

        // If still no product, use AI to estimate
        try {
          const estText = await generateAI(`Оцени пищевую ценность для 100 г продукта "${item.name}".
            Верни только JSON:
            {
              "calories": number,
              "protein": number,
              "fat": number,
              "carbs": number,
              "fiber": number,
              "vitamins": { "BetaCarotene": number, "B1": number, "B2": number, "B5": number, "B6": number, "B9": number, "B12": number, "C": number, "A": number, "D": number, "E": number, "K": number, "B3": number, "Biotin": number, "Choline": number },
              "minerals": { "Potassium": number, "Calcium": number, "Silicon": number, "Magnesium": number, "Sodium": number, "Sulfur": number, "Phosphorus": number, "Chlorine": number, "Vanadium": number, "Iron": number, "Iodine": number, "Cobalt": number, "Manganese": number, "Copper": number, "Molybdenum": number, "Selenium": number, "Chromium": number, "Zinc": number, "Salt": number },
              "fattyAcids": { "Omega3": number, "Omega6": number, "Omega9": number, "TransFats": number, "Cholesterol": number },
              "carbohydrateTypes": { "Glucose": number, "Fructose": number, "Galactose": number, "Sucrose": number, "Lactose": number, "Maltose": number, "Starch": number, "Fiber": number },
              "aminoAcids": { "Alanine": number, "Arginine": number, "Asparagine": number, "AsparticAcid": number, "Valine": number, "Histidine": number, "Glycine": number, "Glutamine": number, "GlutamicAcid": number, "Isoleucine": number, "Leucine": number, "Lysine": number, "Methionine": number, "Proline": number, "Serine": number, "Tyrosine": number, "Threonine": number, "Tryptophan": number, "Phenylalanine": number, "Cysteine": number },
              "explanation": "краткое пояснение"
            }
            Важно:
            - aminoAcids: mg на 100 г
            - fattyAcids: g на 100 г, кроме Cholesterol (mg)
            - carbohydrateTypes: g на 100 г`);
          const est = JSON.parse(estText || '{}');
          const localizedAiProduct = await localizeProductForRussianAudience({
            id: `ai-est-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            name: `✨ ${item.name} (AI Оценка)`,
            brand: 'AI Nutria Engine',
            calories: est.calories || 0,
            protein: est.protein || 0,
            fat: est.fat || 0,
            carbs: est.carbs || 0,
            fiber: est.fiber || 0,
            vitamins: est.vitamins || {},
            minerals: est.minerals || {},
            aminoAcids: est.aminoAcids || {},
            fattyAcids: est.fattyAcids || {},
            carbohydrateTypes: est.carbohydrateTypes || {},
            isAiEstimated: true,
            explanation: est.explanation,
            source: 'ai'
          });
          return { ...item, product: localizedAiProduct };
        } catch (e) {
          console.error("AI estimation in voice parse failed:", e);
        }

        return { ...item, product: null };
      }));

      res.json(matchedItems);
    } catch (e) {
      console.error("Voice parsing error:", e);
      res.status(500).json({ error: "Failed to parse voice input" });
    }
  });

  // --- Admin Routes ---
  app.get("/api/admin/users", async (req, res) => {
    const userId = req.cookies.token;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user?.role !== "ADMIN") return res.status(403).json({ error: "Forbidden" });
    const users = await prisma.user.findMany({ include: { _count: { select: { meals: true } } } });
    res.json(users);
  });

  app.get("/api/admin/stats", async (req, res) => {
    const userId = req.cookies.token;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user?.role !== "ADMIN") return res.status(403).json({ error: "Forbidden" });
    
    const userCount = await prisma.user.count();
    const productCount = await prisma.product.count();
    const mealCount = await prisma.meal.count();
    
    res.json({ userCount, productCount, mealCount });
  });

  // --- Vite / Static ---
  if (process.env.NODE_ENV !== "production") {
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Nutria Server running on http://localhost:${PORT}`);
  });

  // Global error handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("Global Error Handler:", err);
    res.status(500).json({
      error: "Internal Server Error",
      message: err.message,
      stack: process.env.NODE_ENV === "production" ? undefined : err.stack
    });
  });
}

startServer().catch(console.error);
