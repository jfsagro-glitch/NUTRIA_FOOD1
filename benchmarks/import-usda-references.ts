import "dotenv/config";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const currentDir = dirname(fileURLToPath(import.meta.url));
const datasetPath = join(currentDir, "recognition-cases.json");
const apiKey = process.env.USDA_FDC_API_KEY?.trim();
const target = Math.max(1, Math.min(200, Number(process.env.USDA_REFERENCE_LIMIT) || 50));

type CsvFood = { fdcId: number; dataType: "Foundation" | "SR Legacy"; description: string; publicationDate: string; caloriesPer100: number };

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const tokens = (value: string) => normalize(value).split(" ").filter((token) => token.length > 2).map((token) =>
  token.endsWith("s") && !token.endsWith("ss") ? token.slice(0, -1) : token
);
const latinAlias = (aliases: unknown[]) => aliases.map(String).find((alias) => /[a-z]/i.test(alias));

export function candidateScore(description: string, alias: string): number {
  const expected = tokens(alias);
  const actual = new Set(tokens(description));
  if (!expected.length) return 0;
  return expected.filter((token) => actual.has(token)).length / expected.length;
}

function candidateRank(description: string, alias: string): number {
  const normalizedDescription = normalize(description);
  const normalizedAlias = normalize(alias);
  const processedTerms = ["juice", "oil", "butter", "pickle", "rings", "sausage", "spread", "milk", "flour", "babyfood", "soup", "nuggets", "dressing", "sticks", "sweet", "corn", "peanut"];
  const unexpectedProcessing = processedTerms.filter((term) => normalizedDescription.includes(term) && !normalizedAlias.includes(term)).length;
  return candidateScore(description, alias)
    + (normalizedDescription.startsWith(normalizedAlias) ? 0.5 : 0)
    + (normalizedDescription.includes(normalizedAlias) ? 0.2 : 0)
    + (normalizedDescription.includes(" raw") ? 0.1 : 0)
    - unexpectedProcessing;
}

function apiCalories(food: any): number {
  return Number((food.calories ?? food.foodNutrients?.find((nutrient: any) =>
    ["208", "957", "958"].includes(String(nutrient.nutrientNumber)) ||
    String(nutrient.nutrientName || "").toLowerCase() === "energy"
  )?.value) || 0);
}

async function searchUsda(query: string) {
  if (!apiKey) return undefined;
  const url = new URL("https://api.nal.usda.gov/fdc/v1/foods/search");
  url.searchParams.set("api_key", apiKey!);
  url.searchParams.set("query", query);
  url.searchParams.set("dataType", "Foundation,SR Legacy");
  url.searchParams.set("pageSize", "10");
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`USDA HTTP ${response.status} for ${query}`);
  const payload = await response.json() as { foods?: any[] };
  return (payload.foods || [])
    .filter((food) => ["Foundation", "SR Legacy"].includes(String(food.dataType)))
    .map((food) => ({ food, score: candidateScore(String(food.description || ""), query), rank: candidateRank(String(food.description || ""), query) }))
    .filter(({ food, score }) => score >= 0.999 && apiCalories(food) > 0)
    .sort((left, right) =>
      right.rank - left.rank ||
      Number(right.food.dataType === "Foundation") - Number(left.food.dataType === "Foundation")
    )[0]?.food;
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted && char === '"' && line[index + 1] === '"') { value += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { values.push(value); value = ""; }
    else value += char;
  }
  values.push(value);
  return values;
}

async function findFile(root: string, fileName: string): Promise<string> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isFile() && entry.name === fileName) return path;
    if (entry.isDirectory()) {
      const nested = await findFile(path, fileName).catch(() => "");
      if (nested) return nested;
    }
  }
  throw new Error(`${fileName} missing in ${root}`);
}

async function loadCsvDataset(label: string, dataType: "Foundation" | "SR Legacy", url: string): Promise<CsvFood[]> {
  const root = join(tmpdir(), `nutria-${label}`);
  const archive = join(root, `${label}.zip`);
  await mkdir(root, { recursive: true });
  if (!existsSync(archive)) execFileSync("curl", ["-L", "--fail", "-o", archive, url], { stdio: "inherit" });
  if (!existsSync(join(root, ".extracted"))) {
    execFileSync(process.platform === "win32" ? "tar.exe" : "unzip", process.platform === "win32"
      ? ["-xf", archive, "-C", root]
      : ["-o", "-q", archive, "-d", root]);
    await writeFile(join(root, ".extracted"), "ok");
  }
  const nutrientRows = (await readFile(await findFile(root, "nutrient.csv"), "utf8")).split(/\r?\n/);
  const energyNutrientIds = new Set(nutrientRows.slice(1).map(parseCsvLine)
    .filter((row) => ["208", "957", "958"].includes(String(row[3]).trim()))
    .map((row) => row[0]));
  const foods = new Map<string, CsvFood>();
  const foodRows = (await readFile(await findFile(root, "food.csv"), "utf8")).split(/\r?\n/);
  for (const row of foodRows.slice(1).map(parseCsvLine)) {
    const [fdcId, rawType, description, , publicationDate] = row;
    const expectedType = dataType === "Foundation" ? "foundation_food" : "sr_legacy_food";
    if (rawType === expectedType) foods.set(fdcId, { fdcId: Number(fdcId), dataType, description, publicationDate, caloriesPer100: 0 });
  }
  const foodNutrientRows = (await readFile(await findFile(root, "food_nutrient.csv"), "utf8")).split(/\r?\n/);
  for (const row of foodNutrientRows.slice(1).map(parseCsvLine)) {
    const [, fdcId, nutrientId, amount] = row;
    const food = foods.get(fdcId);
    if (food && energyNutrientIds.has(nutrientId) && food.caloriesPer100 <= 0) food.caloriesPer100 = Number(amount) || 0;
  }
  return [...foods.values()].filter((food) => food.caloriesPer100 > 0);
}

let csvFoods: CsvFood[] | undefined;
async function searchCsv(query: string): Promise<CsvFood | undefined> {
  csvFoods ||= [
    ...await loadCsvDataset("foundation-2026-04-30", "Foundation", "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_csv_2026-04-30.zip"),
    ...await loadCsvDataset("sr-legacy-2018-04", "SR Legacy", "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip"),
  ];
  return csvFoods.map((food) => ({ food, score: candidateScore(food.description, query), rank: candidateRank(food.description, query) }))
    .filter(({ food, score }) => score >= 0.999 && food.caloriesPer100 > 0)
    .sort((left, right) => right.rank - left.rank || Number(right.food.dataType === "Foundation") - Number(left.food.dataType === "Foundation"))[0]?.food;
}

const dataset = JSON.parse(await readFile(datasetPath, "utf8"));
if (process.env.USDA_REFERENCE_REFRESH === "1") {
  for (const item of dataset.productSearch || []) {
    if (item.reference === "usda_verified") {
      item.reference = "seed_curated";
      delete item.referenceDetails;
    }
  }
}
let imported = (dataset.productSearch || []).filter((item: any) => item.reference === "usda_verified").length;
const failures: Array<{ id: string; reason: string }> = [];

for (const item of dataset.productSearch || []) {
  if (imported >= target) break;
  if (item.reference === "usda_verified") continue;
  const query = String(item.referenceQuery || latinAlias(item.aliases || []) || "").trim();
  if (!query) {
    failures.push({ id: item.id, reason: "no English alias" });
    continue;
  }
  try {
    const food = await searchUsda(query).catch(() => undefined) || await searchCsv(query);
    if (!food?.fdcId) {
      failures.push({ id: item.id, reason: "no lexical Foundation/SR Legacy match" });
      continue;
    }
    item.reference = "usda_verified";
    item.referenceDetails = {
      provider: "USDA FoodData Central",
      fdcId: Number(food.fdcId),
      dataType: String(food.dataType),
      description: String(food.description),
      publicationDate: String(food.publicationDate || "unknown"),
      caloriesPer100: Number(food.caloriesPer100 ?? apiCalories(food)),
      url: `https://fdc.nal.usda.gov/food-details/${food.fdcId}/nutrients`,
    };
    imported += 1;
  } catch (error) {
    failures.push({ id: item.id, reason: error instanceof Error ? error.message : String(error) });
  }
}

await writeFile(datasetPath, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ imported, target, failures }, null, 2));
if (imported < target) process.exitCode = 2;
