/**
 * Импорт USDA FoodData Central: Foundation Foods + SR Legacy.
 *
 * Скачивает оба официальных CSV-архива напрямую с fdc.nal.usda.gov, распаковывает,
 * парсит food.csv / nutrient.csv / food_nutrient.csv и заливает в Product через
 * тот же маппинг nutrientNumber -> внутренняя таксономия (vitamins/minerals/
 * fattyAcids/carbohydrateTypes/aminoAcids), что используется в server.ts
 * (extractUsdaExtendedNutrients / pickUsdaNutrient / MICRONUTRIENT_TEMPLATE),
 * чтобы семантика совпадала с живыми USDA-лукапами через API.
 *
 * Запуск (в Render Web Shell, где доступен DATABASE_URL и есть интернет):
 *   npx tsx prisma/import-usda.ts
 *
 * Требует системную команду `unzip` (есть в стандартном Linux-образе Render).
 */

import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const prisma = new PrismaClient();

const DATASETS = [
  {
    label: 'usda_foundation',
    dataType: 'foundation_food',
    url: 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_csv_2026-04-30.zip',
  },
  {
    label: 'usda_sr_legacy',
    dataType: 'sr_legacy_food',
    url: 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip',
  },
];

// nutrient_nbr (USDA tag number) -> [ключи, targetUnit] — то же самое, что pickUsdaNutrient в server.ts
type NutrientDef = Record<string, { nbrs: string[]; unit: 'g' | 'mg' | 'mcg' | 'kcal' }>;

const BASE: NutrientDef = {
  calories: { nbrs: ['208', '957', '958'], unit: 'kcal' },
  protein: { nbrs: ['203'], unit: 'g' },
  fat: { nbrs: ['204'], unit: 'g' },
  carbs: { nbrs: ['205'], unit: 'g' },
  fiber: { nbrs: ['291'], unit: 'g' },
};

const VITAMINS: NutrientDef = {
  BetaCarotene: { nbrs: ['321', '334'], unit: 'mcg' },
  B1: { nbrs: ['404'], unit: 'mg' },
  B2: { nbrs: ['405'], unit: 'mg' },
  B5: { nbrs: ['410'], unit: 'mg' },
  B6: { nbrs: ['415'], unit: 'mg' },
  B9: { nbrs: ['417'], unit: 'mcg' },
  B12: { nbrs: ['418'], unit: 'mcg' },
  C: { nbrs: ['401'], unit: 'mg' },
  A: { nbrs: ['320'], unit: 'mcg' },
  D: { nbrs: ['324', '328'], unit: 'mcg' },
  E: { nbrs: ['323'], unit: 'mg' },
  K: { nbrs: ['430'], unit: 'mcg' },
  B3: { nbrs: ['406'], unit: 'mg' },
  Biotin: { nbrs: ['416'], unit: 'mcg' },
  Choline: { nbrs: ['421', '326'], unit: 'mg' },
};

const MINERALS: NutrientDef = {
  Potassium: { nbrs: ['306'], unit: 'mg' },
  Calcium: { nbrs: ['301'], unit: 'mg' },
  Magnesium: { nbrs: ['304'], unit: 'mg' },
  Sodium: { nbrs: ['307'], unit: 'mg' },
  Phosphorus: { nbrs: ['305'], unit: 'mg' },
  Chlorine: { nbrs: ['308'], unit: 'mg' },
  Iron: { nbrs: ['303'], unit: 'mg' },
  Iodine: { nbrs: ['314'], unit: 'mcg' },
  Manganese: { nbrs: ['315'], unit: 'mg' },
  Copper: { nbrs: ['312'], unit: 'mg' },
  Molybdenum: { nbrs: ['316'], unit: 'mcg' },
  Selenium: { nbrs: ['317'], unit: 'mcg' },
  Chromium: { nbrs: ['313'], unit: 'mcg' },
  Zinc: { nbrs: ['309'], unit: 'mg' },
};

const FATTY_ACIDS: NutrientDef = {
  Omega3: { nbrs: ['629'], unit: 'g' },
  Omega6: { nbrs: ['672'], unit: 'g' },
  Omega9: { nbrs: ['645'], unit: 'g' },
  TransFats: { nbrs: ['605'], unit: 'g' },
  Cholesterol: { nbrs: ['601'], unit: 'mg' },
};

const CARB_TYPES: NutrientDef = {
  Glucose: { nbrs: ['2114'], unit: 'g' },
  Fructose: { nbrs: ['2122', '2124'], unit: 'g' },
  Galactose: { nbrs: ['2117'], unit: 'g' },
  Sucrose: { nbrs: ['2100'], unit: 'g' },
  Lactose: { nbrs: ['2134'], unit: 'g' },
  Maltose: { nbrs: ['2145'], unit: 'g' },
  Starch: { nbrs: ['2098'], unit: 'g' },
  Fiber: { nbrs: ['291'], unit: 'g' },
};

const AMINO_ACIDS: NutrientDef = {
  Alanine: { nbrs: ['513'], unit: 'mg' },
  Arginine: { nbrs: ['511'], unit: 'mg' },
  AsparticAcid: { nbrs: ['514'], unit: 'mg' },
  Valine: { nbrs: ['510'], unit: 'mg' },
  Histidine: { nbrs: ['512'], unit: 'mg' },
  Glycine: { nbrs: ['516'], unit: 'mg' },
  GlutamicAcid: { nbrs: ['515'], unit: 'mg' },
  Isoleucine: { nbrs: ['503'], unit: 'mg' },
  Leucine: { nbrs: ['504'], unit: 'mg' },
  Lysine: { nbrs: ['505'], unit: 'mg' },
  Methionine: { nbrs: ['506'], unit: 'mg' },
  Proline: { nbrs: ['517'], unit: 'mg' },
  Serine: { nbrs: ['518'], unit: 'mg' },
  Tyrosine: { nbrs: ['509'], unit: 'mg' },
  Threonine: { nbrs: ['502'], unit: 'mg' },
  Tryptophan: { nbrs: ['501'], unit: 'mg' },
  Phenylalanine: { nbrs: ['508'], unit: 'mg' },
  Cysteine: { nbrs: ['507'], unit: 'mg' },
};

function zeroTemplate(def: NutrientDef) {
  const out: Record<string, number> = {};
  for (const k of Object.keys(def)) out[k] = 0;
  return out;
}

function normalizeUnit(u: string | undefined | null) {
  const v = String(u || '').trim().toLowerCase();
  if (v === 'ug' || v === 'mcg' || v === 'µg') return 'mcg';
  if (v === 'kcal') return 'kcal';
  return v; // g, mg
}

function convertUnit(value: number, fromUnit: string | undefined, targetUnit: string) {
  const fu = normalizeUnit(fromUnit);
  const tu = normalizeUnit(targetUnit);
  if (!fu || fu === tu) return value;
  if (fu === 'g') {
    if (tu === 'mg') return value * 1000;
    if (tu === 'mcg') return value * 1_000_000;
  }
  if (fu === 'mg') {
    if (tu === 'g') return value / 1000;
    if (tu === 'mcg') return value * 1000;
  }
  if (fu === 'mcg') {
    if (tu === 'mg') return value / 1000;
    if (tu === 'g') return value / 1_000_000;
  }
  return value;
}

// Простой устойчивый к запятым-в-кавычках разбор CSV-строки (RFC4180-ish)
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function* iterCsvRows(filePath: string): Generator<string[]> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) { // skip header
    const line = lines[i];
    if (!line) continue;
    yield parseCsvLine(line);
  }
}

function downloadAndExtract(url: string, label: string): string {
  const workDir = path.join(os.tmpdir(), `usda-${label}`);
  fs.mkdirSync(workDir, { recursive: true });
  const zipPath = path.join(workDir, `${label}.zip`);

  console.log(`[${label}] скачиваю ${url} ...`);
  execSync(`curl -L --fail -o "${zipPath}" "${url}"`, { stdio: 'inherit' });

  console.log(`[${label}] распаковываю...`);
  execSync(`unzip -o -q "${zipPath}" -d "${workDir}"`, { stdio: 'inherit' });

  // Папка внутри архива названа как сам датасет — находим её
  const entries = fs.readdirSync(workDir, { withFileTypes: true });
  const dir = entries.find((e) => e.isDirectory());
  if (!dir) throw new Error(`Не нашёл распакованную папку для ${label} в ${workDir}`);
  return path.join(workDir, dir.name);
}

function pick(values: Map<string, { amount: number; unit: string }>, def: { nbrs: string[]; unit: string }) {
  for (const nbr of def.nbrs) {
    const hit = values.get(nbr);
    if (hit) {
      if (def.unit === 'kcal') return hit.amount;
      return convertUnit(hit.amount, hit.unit, def.unit);
    }
  }
  return 0;
}

function pickGroup(values: Map<string, { amount: number; unit: string }>, def: NutrientDef) {
  const out: Record<string, number> = {};
  for (const [key, d] of Object.entries(def)) {
    const v = pick(values, d);
    if (v) out[key] = Math.round(v * 10000) / 10000;
  }
  return out;
}

interface ImportRecord {
  name: string;
  brand: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  fiber: number | null;
  micronutrients: string;
}

function extractDataset(folder: string, dataType: string, label: string): ImportRecord[] {
  // nutrient.csv: id,name,unit_name,nutrient_nbr,rank
  const nbrLookup = new Map<string, { nbr: string; unit: string }>();
  for (const row of iterCsvRows(path.join(folder, 'nutrient.csv'))) {
    const [id, , unitName, nutrientNbr] = row;
    nbrLookup.set(id, { nbr: String(nutrientNbr).trim(), unit: unitName });
  }

  // food.csv: fdc_id,data_type,description,food_category_id,publication_date
  const foods = new Map<string, string>();
  for (const row of iterCsvRows(path.join(folder, 'food.csv'))) {
    const [fdcId, foodDataType, description] = row;
    if (foodDataType === dataType) foods.set(fdcId, description);
  }
  console.log(`[${label}] продуктов в food.csv с data_type=${dataType}: ${foods.size}`);

  // food_nutrient.csv: id,fdc_id,nutrient_id,amount,...
  const byFdc = new Map<string, Map<string, { amount: number; unit: string }>>();
  for (const row of iterCsvRows(path.join(folder, 'food_nutrient.csv'))) {
    const [, fdcId, nutrientId, amountStr] = row;
    if (!foods.has(fdcId)) continue;
    const nbrInfo = nbrLookup.get(nutrientId);
    if (!nbrInfo) continue;
    const amount = parseFloat(amountStr);
    if (!Number.isFinite(amount)) continue;
    let map = byFdc.get(fdcId);
    if (!map) { map = new Map(); byFdc.set(fdcId, map); }
    if (!map.has(nbrInfo.nbr)) map.set(nbrInfo.nbr, { amount, unit: nbrInfo.unit });
  }

  const records: ImportRecord[] = [];
  for (const [fdcId, description] of foods.entries()) {
    const values = byFdc.get(fdcId) || new Map();

    const calories = pick(values, BASE.calories);
    const protein = pick(values, BASE.protein);
    const fat = pick(values, BASE.fat);
    const carbs = pick(values, BASE.carbs);
    const fiber = pick(values, BASE.fiber);

    if (calories <= 0 && protein <= 0 && fat <= 0 && carbs <= 0) continue; // нет полезных данных

    const vitamins = { ...zeroTemplate(VITAMINS), ...pickGroup(values, VITAMINS) };
    const minerals: Record<string, number> = { ...zeroTemplate(MINERALS), Salt: 0, ...pickGroup(values, MINERALS) };
    if (minerals.Sodium > 0) minerals.Salt = Math.round(minerals.Sodium * 2.5 * 10000) / 10000;
    const fattyAcids = { ...zeroTemplate(FATTY_ACIDS), ...pickGroup(values, FATTY_ACIDS) };
    const carbohydrateTypes: Record<string, number> = { ...zeroTemplate(CARB_TYPES), ...pickGroup(values, CARB_TYPES) };
    if (!carbohydrateTypes.Fiber && fiber > 0) carbohydrateTypes.Fiber = Math.round(fiber * 10000) / 10000;
    const aminoAcids = { ...zeroTemplate(AMINO_ACIDS), ...pickGroup(values, AMINO_ACIDS) };

    records.push({
      name: description.trim(),
      brand: 'USDA',
      calories: Math.round(calories * 100) / 100,
      protein: Math.round(protein * 100) / 100,
      fat: Math.round(fat * 100) / 100,
      carbs: Math.round(carbs * 100) / 100,
      fiber: fiber ? Math.round(fiber * 100) / 100 : null,
      micronutrients: JSON.stringify({ vitamins, minerals, fattyAcids, carbohydrateTypes, aminoAcids }),
    });
  }
  return records;
}

async function main() {
  const allByKey = new Map<string, ImportRecord>(); // name|brand -> record, foundation приоритетнее sr_legacy

  for (const ds of DATASETS) {
    const folder = downloadAndExtract(ds.url, ds.label);
    const records = extractDataset(folder, ds.dataType, ds.label);
    console.log(`[${ds.label}] записей с валидными КБЖУ: ${records.length}`);
    for (const rec of records) {
      const key = `${rec.name}|${rec.brand}`;
      if (!allByKey.has(key) || ds.label === 'usda_foundation') {
        allByKey.set(key, rec);
      }
    }
  }

  const finalRecords = Array.from(allByKey.values());
  console.log(`Итого уникальных продуктов к импорту: ${finalRecords.length}`);

  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < finalRecords.length; i += BATCH) {
    const batch = finalRecords.slice(i, i + BATCH);
    const result = await prisma.product.createMany({
      data: batch,
      skipDuplicates: true, // не трогаем уже существующие name+brand (например, добавленные вручную/через live API)
    });
    inserted += result.count;
    console.log(`  ...обработано ${Math.min(i + BATCH, finalRecords.length)}/${finalRecords.length}, вставлено всего: ${inserted}`);
  }

  console.log(`Готово. Вставлено новых продуктов: ${inserted} из ${finalRecords.length} обработанных.`);
}

main()
  .catch((err) => {
    console.error('Импорт USDA завершился с ошибкой:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
