import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractSeedProducts } from "./seed-products.ts";

const currentDir = dirname(fileURLToPath(import.meta.url));
const datasetPath = join(currentDir, "recognition-cases.json");
const seedPath = join(currentDir, "..", "prisma", "seed.ts");

const normalize = (value: string) => value.toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/gi, " ").trim();
const idPart = (value: string) => normalize(value).replace(/ /g, "-");

const dataset = JSON.parse(await readFile(datasetPath, "utf8"));
const seedProducts = extractSeedProducts(await readFile(seedPath, "utf8"));
const existingQueries = new Set((dataset.productSearch || []).map((item: any) => normalize(item.query)));
const productTarget = Number(dataset.targetCases.productSearch);

for (const product of seedProducts) {
  if (dataset.productSearch.length >= productTarget) break;
  if (existingQueries.has(normalize(product.name))) continue;
  const tolerance = Math.max(2, product.calories * 0.08);
  dataset.productSearch.push({
    id: `seed-${idPart(product.name)}`,
    reference: "seed_curated",
    query: product.name,
    aliases: [product.name],
    allowedSources: ["local", "catalog"],
    caloriesPer100: {
      min: Math.max(0, Number((product.calories - tolerance).toFixed(2))),
      max: Number((product.calories + tolerance).toFixed(2)),
    },
    requiredNutrientGroups: ["vitamins", "minerals"],
  });
  existingQueries.add(normalize(product.name));
}

// Search quality also includes common alternate names. Keep the original
// reference and expected nutrients so these cases test normalization rather
// than inventing additional products or nutrition values.
const referencedCases = [...dataset.productSearch];
for (const productCase of referencedCases) {
  if (dataset.productSearch.length >= productTarget) break;
  const russianAlias = (productCase.aliases || []).map(String).find((alias: string) =>
    /[а-яё]/i.test(alias) && normalize(alias) !== normalize(productCase.query) && !existingQueries.has(normalize(alias))
  );
  if (!russianAlias) continue;
  dataset.productSearch.push({
    ...productCase,
    id: `alias-${productCase.id}-${idPart(russianAlias)}`,
    query: russianAlias,
  });
  existingQueries.add(normalize(russianAlias));
}

if (dataset.productSearch.length < productTarget) {
  throw new Error(`Only ${dataset.productSearch.length}/${productTarget} unique product cases are available`);
}

const voiceTarget = Number(dataset.targetCases.voice);
const voiceCandidates = seedProducts.filter((product) =>
  product.calories >= 15 && product.calories <= 700 && product.name.length <= 28
);
let cursor = 0;
while (dataset.voice.length < voiceTarget) {
  const first = voiceCandidates[cursor % voiceCandidates.length];
  const second = voiceCandidates[(cursor * 7 + 19) % voiceCandidates.length];
  cursor += 1;
  if (first.name === second.name) continue;
  const id = `seed-pair-${idPart(first.name)}-${idPart(second.name)}`;
  if (dataset.voice.some((item: any) => item.id === id)) continue;
  const firstGrams = 100 + (cursor % 5) * 20;
  const secondGrams = 60 + (cursor % 4) * 20;
  const calories = first.calories * firstGrams / 100 + second.calories * secondGrams / 100;
  dataset.voice.push({
    id,
    reference: "generated_seed_composition",
    transcript: `На прием пищи: ${first.name} ${firstGrams} грамм и ${second.name} ${secondGrams} грамм`,
    ingredients: [
      { aliases: [first.name], minGrams: firstGrams - 5, maxGrams: firstGrams + 5 },
      { aliases: [second.name], minGrams: secondGrams - 5, maxGrams: secondGrams + 5 },
    ],
    totalCalories: {
      min: Number((calories * 0.95).toFixed(2)),
      max: Number((calories * 1.05).toFixed(2)),
    },
  });
}

await writeFile(datasetPath, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ products: dataset.productSearch.length, voice: dataset.voice.length }, null, 2));
