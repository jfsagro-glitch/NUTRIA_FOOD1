import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  hasNutrientGroup,
  namesMatch,
  rangeRelativeError,
  scoreIngredients,
  type ActualIngredient,
  type ExpectedIngredient,
  type ExpectedRange,
} from "./recognition-metrics.ts";

type ProductCase = {
  id: string;
  query: string;
  aliases: string[];
  allowedSources: string[];
  caloriesPer100: ExpectedRange;
  requiredNutrientGroups: string[];
};
type VoiceCase = {
  id: string;
  transcript: string;
  ingredients: ExpectedIngredient[];
  totalCalories: ExpectedRange;
};
type BenchmarkConfig = {
  version: number;
  productSearch: ProductCase[];
  voice: VoiceCase[];
  thresholds: Record<string, number>;
  targetCases: { productSearch: number; voice: number };
};

const currentDir = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(await readFile(join(currentDir, "recognition-cases.json"), "utf8")) as BenchmarkConfig;
const apiBaseUrl = (process.env.NUTRIA_API_BASE_URL || "http://localhost:3000").replace(/\/$/, "");

async function fetchJson(path: string, init?: RequestInit) {
  const response = await fetch(`${apiBaseUrl}${path}`, { ...init, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

let productPassed = 0;
let productCaloriesInRange = 0;
let requiredNutrientGroups = 0;
let populatedNutrientGroups = 0;
const productDetails = [] as Array<Record<string, unknown>>;
for (const testCase of config.productSearch) {
  const products = await fetchJson(`/api/products/search?q=${encodeURIComponent(testCase.query)}`) as any[];
  const top3 = products.slice(0, 3);
  const match = top3.find((product) => namesMatch(product.name, testCase.aliases));
  const source = String(match?.source || "");
  const sourceAllowed = Boolean(match) && (testCase.allowedSources.includes(source) || source.startsWith("usda"));
  const macrosPresent = Boolean(match) && [match.calories, match.protein, match.fat, match.carbs].some((value) => Number(value) > 0);
  const passed = Boolean(match) && sourceAllowed && macrosPresent;
  if (passed) productPassed += 1;
  const calorieError = rangeRelativeError(Number(match?.calories), testCase.caloriesPer100);
  if (match && calorieError === 0) productCaloriesInRange += 1;
  const groupCoverage = testCase.requiredNutrientGroups.map((group) => ({
    group,
    populated: Boolean(match) && hasNutrientGroup(match, group),
  }));
  requiredNutrientGroups += groupCoverage.length;
  populatedNutrientGroups += groupCoverage.filter((entry) => entry.populated).length;
  productDetails.push({
    id: testCase.id,
    passed,
    matchedName: match?.name || null,
    source: source || null,
    caloriesPer100: Number(match?.calories || 0),
    calorieError,
    nutrientGroups: groupCoverage,
  });
}

let voiceMatched = 0;
let voiceExpected = 0;
let voiceActual = 0;
let voiceWeightsInRange = 0;
let voiceCaloriesInRange = 0;
let voiceCalorieErrorTotal = 0;
const voiceDetails = [] as Array<Record<string, unknown>>;
for (const testCase of config.voice) {
  const response = await fetchJson("/api/voice/parse", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ transcript: testCase.transcript }),
  }) as any[];
  const actual: ActualIngredient[] = response.map((item) => ({
    name: String(item.product?.name || item.name || ""),
    amount: Number(item.amount || 0),
  }));
  const totalCalories = response.reduce((sum, item) => {
    return sum + Number(item?.product?.calories || 0) * Number(item?.amount || 0) / 100;
  }, 0);
  const calorieError = rangeRelativeError(totalCalories, testCase.totalCalories);
  if (calorieError === 0) voiceCaloriesInRange += 1;
  voiceCalorieErrorTotal += calorieError;
  const score = scoreIngredients(testCase.ingredients, actual);
  voiceMatched += score.matched;
  voiceExpected += score.expected;
  voiceActual += score.actual;
  voiceWeightsInRange += score.inWeightRange;
  voiceDetails.push({ id: testCase.id, ...score, actual, totalCalories, calorieError });
}

const metrics = {
  productTop3Accuracy: config.productSearch.length ? productPassed / config.productSearch.length : 0,
  productCaloriesRangeAccuracy: config.productSearch.length ? productCaloriesInRange / config.productSearch.length : 0,
  productMicronutrientCoverage: requiredNutrientGroups ? populatedNutrientGroups / requiredNutrientGroups : 0,
  voiceIngredientRecall: voiceExpected ? voiceMatched / voiceExpected : 0,
  voiceIngredientPrecision: voiceActual ? voiceMatched / voiceActual : 0,
  voiceWeightRangeAccuracy: voiceMatched ? voiceWeightsInRange / voiceMatched : 0,
  voiceCaloriesRangeAccuracy: config.voice.length ? voiceCaloriesInRange / config.voice.length : 0,
  voiceCalorieMeanRelativeError: config.voice.length ? voiceCalorieErrorTotal / config.voice.length : 0,
  voiceCalorieAccuracy: config.voice.length ? 1 - voiceCalorieErrorTotal / config.voice.length : 0,
};
const failures = Object.entries(config.thresholds)
  .filter(([name, threshold]) => Number((metrics as any)[name] || 0) < threshold)
  .map(([name, threshold]) => `${name}: ${(metrics as any)[name]?.toFixed(3)} < ${threshold}`);

const report = {
  benchmarkVersion: config.version,
  apiBaseUrl,
  generatedAt: new Date().toISOString(),
  metrics,
  thresholds: config.thresholds,
  passed: failures.length === 0,
  failures,
  dataset: {
    productSearch: { actual: config.productSearch.length, target: config.targetCases.productSearch },
    voice: { actual: config.voice.length, target: config.targetCases.voice },
    complete: config.productSearch.length >= config.targetCases.productSearch && config.voice.length >= config.targetCases.voice,
  },
  cases: { productSearch: productDetails, voice: voiceDetails },
};

console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
