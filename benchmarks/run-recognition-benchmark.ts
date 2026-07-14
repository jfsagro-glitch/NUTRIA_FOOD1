import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { namesMatch, scoreIngredients, type ActualIngredient, type ExpectedIngredient } from "./recognition-metrics.ts";

type ProductCase = { id: string; query: string; aliases: string[]; allowedSources: string[] };
type VoiceCase = { id: string; transcript: string; ingredients: ExpectedIngredient[] };
type BenchmarkConfig = {
  version: number;
  productSearch: ProductCase[];
  voice: VoiceCase[];
  thresholds: Record<string, number>;
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
  productDetails.push({ id: testCase.id, passed, matchedName: match?.name || null, source: source || null });
}

let voiceMatched = 0;
let voiceExpected = 0;
let voiceActual = 0;
let voiceWeightsInRange = 0;
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
  const score = scoreIngredients(testCase.ingredients, actual);
  voiceMatched += score.matched;
  voiceExpected += score.expected;
  voiceActual += score.actual;
  voiceWeightsInRange += score.inWeightRange;
  voiceDetails.push({ id: testCase.id, ...score, actual });
}

const metrics = {
  productTop3Accuracy: config.productSearch.length ? productPassed / config.productSearch.length : 0,
  voiceIngredientRecall: voiceExpected ? voiceMatched / voiceExpected : 0,
  voiceIngredientPrecision: voiceActual ? voiceMatched / voiceActual : 0,
  voiceWeightRangeAccuracy: voiceMatched ? voiceWeightsInRange / voiceMatched : 0,
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
  cases: { productSearch: productDetails, voice: voiceDetails },
};

console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
