import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(await readFile(join(currentDir, "recognition-cases.json"), "utf8"));
const errors: string[] = [];

function validateUniqueIds(cases: any[], section: string) {
  const ids = new Set<string>();
  for (const [index, testCase] of cases.entries()) {
    const id = String(testCase?.id || "").trim();
    if (!id) errors.push(`${section}[${index}]: missing id`);
    if (ids.has(id)) errors.push(`${section}: duplicate id "${id}"`);
    ids.add(id);
  }
}

function validRange(range: any) {
  return Number.isFinite(Number(range?.min))
    && Number.isFinite(Number(range?.max))
    && Number(range.min) >= 0
    && Number(range.max) >= Number(range.min);
}

validateUniqueIds(dataset.productSearch || [], "productSearch");
validateUniqueIds(dataset.voice || [], "voice");

for (const product of dataset.productSearch || []) {
  if (!String(product.query || "").trim()) errors.push(`${product.id}: missing product query`);
  if (product.referenceQuery && !/^[a-z0-9 ,%-]+$/i.test(String(product.referenceQuery))) errors.push(`${product.id}: invalid referenceQuery`);
  if (!Array.isArray(product.aliases) || product.aliases.length === 0) errors.push(`${product.id}: missing aliases`);
  if (!Array.isArray(product.allowedSources) || product.allowedSources.length === 0) errors.push(`${product.id}: missing allowedSources`);
  if (!validRange(product.caloriesPer100)) errors.push(`${product.id}: invalid caloriesPer100 range`);
  if (!Array.isArray(product.requiredNutrientGroups) || product.requiredNutrientGroups.length === 0) {
    errors.push(`${product.id}: missing requiredNutrientGroups`);
  }
  if (!String(product.reference || "").trim()) errors.push(`${product.id}: missing reference provenance`);
  if (product.reference === "usda_verified") {
    const details = product.referenceDetails;
    if (details?.provider !== "USDA FoodData Central") errors.push(`${product.id}: invalid USDA provider`);
    if (!Number.isInteger(details?.fdcId) || details.fdcId <= 0) errors.push(`${product.id}: invalid USDA fdcId`);
    if (!["Foundation", "SR Legacy"].includes(details?.dataType)) errors.push(`${product.id}: invalid USDA dataType`);
    if (!String(details?.description || "").trim()) errors.push(`${product.id}: missing USDA description`);
    if (!Number.isFinite(details?.caloriesPer100) || details.caloriesPer100 <= 0) errors.push(`${product.id}: missing USDA calories per 100g`);
    if (!String(details?.url || "").includes(String(details?.fdcId))) errors.push(`${product.id}: invalid USDA URL`);
  }
}

for (const voice of dataset.voice || []) {
  if (!String(voice.transcript || "").trim()) errors.push(`${voice.id}: missing transcript`);
  if (!Array.isArray(voice.ingredients) || voice.ingredients.length === 0) errors.push(`${voice.id}: missing ingredients`);
  if (!validRange(voice.totalCalories)) errors.push(`${voice.id}: invalid totalCalories range`);
  if (!String(voice.reference || "").trim()) errors.push(`${voice.id}: missing reference provenance`);
  for (const [index, ingredient] of (voice.ingredients || []).entries()) {
    if (!Array.isArray(ingredient.aliases) || ingredient.aliases.length === 0) {
      errors.push(`${voice.id}.ingredients[${index}]: missing aliases`);
    }
    if (!validRange({ min: ingredient.minGrams, max: ingredient.maxGrams })) {
      errors.push(`${voice.id}.ingredients[${index}]: invalid weight range`);
    }
  }
}

const references = [...(dataset.productSearch || []), ...(dataset.voice || [])].reduce((counts, testCase) => {
  const reference = String(testCase.reference || "missing");
  counts[reference] = (counts[reference] || 0) + 1;
  return counts;
}, {} as Record<string, number>);
const independentReferences = (dataset.productSearch || []).filter((testCase: any) =>
  ["usda_verified", "manufacturer_verified"].includes(String(testCase.reference || ""))
).length;

const summary = {
  version: dataset.version,
  productSearch: { actual: dataset.productSearch?.length || 0, target: dataset.targetCases?.productSearch || 0 },
  voice: { actual: dataset.voice?.length || 0, target: dataset.targetCases?.voice || 0 },
  references,
  independentReferences: {
    actual: independentReferences,
    target: Number(dataset.independentReferenceTarget || 0),
    complete: independentReferences >= Number(dataset.independentReferenceTarget || 0),
  },
  valid: errors.length === 0,
  errors,
};

console.log(JSON.stringify(summary, null, 2));
if (errors.length) process.exitCode = 1;
