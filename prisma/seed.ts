import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';

const prisma = new PrismaClient();

const MICRONUTRIENT_TEMPLATE = {
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

type Micronutrients = typeof MICRONUTRIENT_TEMPLATE;
type MicronutrientOverrides = {
  vitamins?: Partial<Micronutrients['vitamins']>;
  minerals?: Partial<Micronutrients['minerals']>;
  fattyAcids?: Partial<Micronutrients['fattyAcids']>;
  carbohydrateTypes?: Partial<Micronutrients['carbohydrateTypes']>;
  aminoAcids?: Partial<Micronutrients['aminoAcids']>;
};

function buildMicronutrients(overrides: MicronutrientOverrides) {
  const merged: Micronutrients = {
    vitamins: { ...MICRONUTRIENT_TEMPLATE.vitamins, ...(overrides.vitamins || {}) },
    minerals: { ...MICRONUTRIENT_TEMPLATE.minerals, ...(overrides.minerals || {}) },
    fattyAcids: { ...MICRONUTRIENT_TEMPLATE.fattyAcids, ...(overrides.fattyAcids || {}) },
    carbohydrateTypes: { ...MICRONUTRIENT_TEMPLATE.carbohydrateTypes, ...(overrides.carbohydrateTypes || {}) },
    aminoAcids: { ...MICRONUTRIENT_TEMPLATE.aminoAcids, ...(overrides.aminoAcids || {}) },
  };

  if (!merged.minerals.Salt && merged.minerals.Sodium > 0) {
    merged.minerals.Salt = merged.minerals.Sodium * 2.5;
  }

  return merged;
}

function parseMicronutrientsRaw(raw: string | null | undefined): Micronutrients {
  if (!raw) return buildMicronutrients({});
  try {
    const parsed = JSON.parse(raw);
    return buildMicronutrients(parsed && typeof parsed === 'object' ? parsed : {});
  } catch {
    return buildMicronutrients({});
  }
}

function buildMicronutrientsFromJson(raw: string): Micronutrients {
  return parseMicronutrientsRaw(raw);
}

function mergeMicronutrientsPreferExisting(existing: Micronutrients, seeded: Micronutrients): Micronutrients {
  const merged: any = {};
  for (const groupKey of Object.keys(seeded)) {
    const seededGroup: any = (seeded as any)[groupKey];
    const existingGroup: any = (existing as any)[groupKey] || {};
    merged[groupKey] = { ...seededGroup };
    for (const key of Object.keys(seededGroup)) {
      if (existingGroup[key]) {
        merged[groupKey][key] = existingGroup[key];
      }
    }
  }
  return merged as Micronutrients;
}

async function main() {
  const products = [
    {
      name: 'Куриная грудка',
      brand: 'Мираторг',
      calories: 165,
      protein: 31,
      fat: 3.6,
      carbs: 0,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B12: 0.6, B6: 0.6, B3: 13.7, Choline: 85 },
        minerals: { Phosphorus: 210, Potassium: 256, Sodium: 74, Magnesium: 29, Iron: 1, Zinc: 1, Selenium: 24, Sulfur: 300 },
        fattyAcids: { Omega3: 0.08, Omega6: 0.7, Omega9: 1.0, Cholesterol: 85 },
        carbohydrateTypes: { Fiber: 0 },
        aminoAcids: { Alanine: 1900, Arginine: 1800, AsparticAcid: 3100, GlutamicAcid: 5000, Isoleucine: 1400, Leucine: 2400, Lysine: 2600, Methionine: 800, Valine: 1500, Threonine: 1300, Tryptophan: 350, Phenylalanine: 1200, Histidine: 1100, Proline: 1200, Serine: 1300, Tyrosine: 1000, Glycine: 1500, Cysteine: 300 }
      }))
    },
    {
      name: 'Яблоко',
      brand: 'Сезонное',
      calories: 52,
      protein: 0.3,
      fat: 0.2,
      carbs: 14,
      fiber: 2.4,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 4.6, A: 3, K: 2.2, B9: 3, Biotin: 0.3 },
        minerals: { Potassium: 107, Calcium: 6, Magnesium: 5, Phosphorus: 11, Iron: 0.1, Chromium: 0.5 },
        fattyAcids: { Omega3: 0.01, Omega6: 0.04, Omega9: 0.01 },
        carbohydrateTypes: { Glucose: 2.1, Fructose: 5.9, Sucrose: 2.1, Starch: 0.05, Fiber: 2.4 },
        aminoAcids: { Alanine: 11, Arginine: 6, AsparticAcid: 70, GlutamicAcid: 25, Isoleucine: 8, Leucine: 13, Lysine: 11, Methionine: 1, Valine: 10, Threonine: 7, Tryptophan: 1, Phenylalanine: 8, Histidine: 5, Proline: 6, Serine: 9, Tyrosine: 1, Glycine: 9, Cysteine: 1, Asparagine: 15, Glutamine: 15 }
      }))
    },
    {
      name: 'Гречка отварная',
      brand: 'Увелка',
      calories: 110,
      protein: 4.2,
      fat: 1.1,
      carbs: 21.3,
      fiber: 2.7,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B1: 0.1, B2: 0.04, B6: 0.1, E: 0.1, B3: 1.3, B5: 0.6, Choline: 9 },
        minerals: { Magnesium: 51, Phosphorus: 70, Potassium: 88, Iron: 0.8, Zinc: 0.6, Manganese: 0.6, Copper: 0.1, Selenium: 2.2, Silicon: 4 },
        fattyAcids: { Omega3: 0.03, Omega6: 0.4, Omega9: 0.3 },
        carbohydrateTypes: { Glucose: 0.1, Fructose: 0.1, Sucrose: 0.2, Starch: 17.5, Fiber: 2.7 },
        aminoAcids: { Alanine: 210, Arginine: 340, AsparticAcid: 350, GlutamicAcid: 740, Isoleucine: 180, Leucine: 300, Lysine: 220, Methionine: 90, Valine: 260, Threonine: 180, Tryptophan: 70, Phenylalanine: 220, Histidine: 120, Proline: 170, Serine: 220, Tyrosine: 130, Glycine: 280, Cysteine: 110, Asparagine: 210, Glutamine: 300 }
      }))
    },
    {
      name: 'Яйцо куриное',
      brand: 'С0',
      calories: 155,
      protein: 13,
      fat: 11,
      carbs: 1.1,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { A: 160, D: 2, E: 1, B12: 0.9, B2: 0.5, B5: 1.4, Biotin: 20, Choline: 294, K: 0.3, B3: 0.1 },
        minerals: { Calcium: 50, Phosphorus: 172, Potassium: 126, Sodium: 124, Iron: 1.2, Zinc: 1.1, Selenium: 31.7, Iodine: 20, Sulfur: 180 },
        fattyAcids: { Omega3: 0.11, Omega6: 1.2, Omega9: 4.1, TransFats: 0.04, Cholesterol: 373 },
        carbohydrateTypes: { Glucose: 0.4, Galactose: 0.1, Lactose: 0.2, Fiber: 0 },
        aminoAcids: { Alanine: 735, Arginine: 755, AsparticAcid: 1260, GlutamicAcid: 1680, Isoleucine: 680, Leucine: 1080, Lysine: 900, Methionine: 390, Valine: 760, Threonine: 600, Tryptophan: 170, Phenylalanine: 680, Histidine: 310, Proline: 510, Serine: 970, Tyrosine: 500, Glycine: 420, Cysteine: 290, Asparagine: 750, Glutamine: 900 }
      }))
    },
    {
      name: 'Творог 5%',
      brand: 'Простоквашино',
      calories: 121,
      protein: 16,
      fat: 5,
      carbs: 3,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B12: 0.4, B2: 0.2, A: 20, B5: 0.3, Biotin: 5, Choline: 30, B3: 0.2 },
        minerals: { Calcium: 164, Phosphorus: 220, Potassium: 112, Sodium: 40, Magnesium: 23, Selenium: 14, Zinc: 0.4, Iodine: 9, Sulfur: 200 },
        fattyAcids: { Omega3: 0.05, Omega6: 0.2, Omega9: 1.5, TransFats: 0.15, Cholesterol: 17 },
        carbohydrateTypes: { Lactose: 2.8, Fiber: 0 },
        aminoAcids: { Alanine: 470, Arginine: 500, AsparticAcid: 1300, GlutamicAcid: 3500, Isoleucine: 800, Leucine: 1500, Lysine: 1300, Methionine: 430, Valine: 900, Threonine: 700, Tryptophan: 190, Phenylalanine: 760, Histidine: 410, Proline: 1700, Serine: 920, Tyrosine: 760, Glycine: 300, Cysteine: 220, Asparagine: 900, Glutamine: 1200 }
      }))
    },
    {
      name: 'Банан',
      brand: 'Эквадор',
      calories: 89,
      protein: 1.1,
      fat: 0.3,
      carbs: 23,
      fiber: 2.6,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 8.7, B6: 0.4, A: 3, B9: 20, B3: 0.7, B5: 0.3, Biotin: 1.2, Choline: 9.8, BetaCarotene: 26 },
        minerals: { Potassium: 358, Magnesium: 27, Phosphorus: 22, Calcium: 5, Iron: 0.3, Manganese: 0.27, Copper: 0.08, Chromium: 0.2 },
        fattyAcids: { Omega3: 0.03, Omega6: 0.05, Omega9: 0.03 },
        carbohydrateTypes: { Glucose: 4.9, Fructose: 4.8, Sucrose: 5, Starch: 5.4, Fiber: 2.6 },
        aminoAcids: { Alanine: 39, Arginine: 49, AsparticAcid: 108, GlutamicAcid: 128, Isoleucine: 28, Leucine: 68, Lysine: 50, Methionine: 10, Valine: 47, Threonine: 28, Tryptophan: 9, Phenylalanine: 45, Histidine: 77, Proline: 28, Serine: 40, Tyrosine: 10, Glycine: 38, Cysteine: 12, Asparagine: 35, Glutamine: 40 }
      }))
    },
    {
      name: 'Авокадо',
      brand: 'Хасс',
      calories: 160,
      protein: 2,
      fat: 15,
      carbs: 9,
      fiber: 7,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { K: 21, C: 10, E: 2, B5: 1.4, B6: 0.3, B9: 81, B3: 1.7, Biotin: 3.6, Choline: 14.2, BetaCarotene: 62 },
        minerals: { Potassium: 485, Magnesium: 29, Phosphorus: 52, Calcium: 12, Iron: 0.6, Zinc: 0.6, Copper: 0.2, Manganese: 0.1, Selenium: 0.4, Sodium: 7 },
        fattyAcids: { Omega3: 0.11, Omega6: 1.67, Omega9: 9.8, TransFats: 0, Cholesterol: 0 },
        carbohydrateTypes: { Glucose: 0.37, Fructose: 0.12, Sucrose: 0.06, Starch: 0.1, Fiber: 7 },
        aminoAcids: { Alanine: 109, Arginine: 88, AsparticAcid: 236, GlutamicAcid: 287, Isoleucine: 84, Leucine: 143, Lysine: 132, Methionine: 38, Valine: 107, Threonine: 83, Tryptophan: 25, Phenylalanine: 91, Histidine: 49, Proline: 98, Serine: 114, Tyrosine: 47, Glycine: 104, Cysteine: 27, Asparagine: 120, Glutamine: 130 }
      }))
    },
    // --- Базовые ингредиенты для распознавания блюд (выпечка, крупы, овощи, белки, молочка, приправы) ---
    {
      name: 'Мука пшеничная',
      brand: 'Базовый продукт',
      calories: 364,
      protein: 10.3,
      fat: 1.1,
      carbs: 76.3,
      fiber: 2.7,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B1: 0.17, B2: 0.04, B6: 0.17, E: 1.5, B3: 1.2, Choline: 73 },
        minerals: { Potassium: 122, Phosphorus: 86, Magnesium: 16, Calcium: 18, Iron: 1.2, Manganese: 0.6 },
        carbohydrateTypes: { Starch: 68, Fiber: 2.7 },
        aminoAcids: { Alanine: 350, Arginine: 410, AsparticAcid: 470, GlutamicAcid: 3300, Isoleucine: 380, Leucine: 700, Lysine: 250, Methionine: 160, Valine: 420, Threonine: 280, Tryptophan: 110, Phenylalanine: 480, Histidine: 220, Proline: 1100, Serine: 500, Tyrosine: 280, Glycine: 380, Cysteine: 220 }
      }))
    },
    {
      name: 'Сахар',
      brand: 'Базовый продукт',
      calories: 398,
      protein: 0,
      fat: 0,
      carbs: 99.8,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        minerals: { Calcium: 3, Potassium: 3 },
        carbohydrateTypes: { Sucrose: 99.8 }
      }))
    },
    {
      name: 'Масло сливочное',
      brand: 'Базовый продукт',
      calories: 717,
      protein: 0.5,
      fat: 78,
      carbs: 0.6,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { A: 684, D: 1.5, E: 2.3, K: 7, Choline: 19 },
        minerals: { Calcium: 24, Potassium: 24, Phosphorus: 24, Sodium: 11 },
        fattyAcids: { Omega3: 0.3, Omega6: 2, Omega9: 20, TransFats: 3.5, Cholesterol: 215 },
        carbohydrateTypes: { Lactose: 0.6 }
      }))
    },
    {
      name: 'Молоко',
      brand: 'Базовый продукт',
      calories: 60,
      protein: 3.2,
      fat: 3.6,
      carbs: 4.8,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { A: 28, D: 0.05, B2: 0.18, B12: 0.4, B5: 0.3, Choline: 15 },
        minerals: { Calcium: 120, Phosphorus: 95, Potassium: 150, Sodium: 50, Iodine: 9 },
        fattyAcids: { Omega3: 0.02, Omega6: 0.1, Omega9: 1, TransFats: 0.1, Cholesterol: 14 },
        carbohydrateTypes: { Lactose: 4.8 },
        aminoAcids: { Alanine: 110, Arginine: 110, AsparticAcid: 240, GlutamicAcid: 670, Isoleucine: 190, Leucine: 320, Lysine: 260, Methionine: 80, Valine: 220, Threonine: 150, Tryptophan: 45, Phenylalanine: 160, Histidine: 90, Proline: 320, Serine: 170, Tyrosine: 160, Glycine: 70, Cysteine: 30 }
      }))
    },
    {
      name: 'Разрыхлитель теста',
      brand: 'Базовый продукт',
      calories: 53,
      protein: 0,
      fat: 0,
      carbs: 28,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        minerals: { Sodium: 10600, Phosphorus: 3500 }
      }))
    },
    {
      name: 'Сода пищевая',
      brand: 'Базовый продукт',
      calories: 0,
      protein: 0,
      fat: 0,
      carbs: 0,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        minerals: { Sodium: 27360 }
      }))
    },
    {
      name: 'Дрожжи',
      brand: 'Базовый продукт',
      calories: 105,
      protein: 12.7,
      fat: 2.7,
      carbs: 9.7,
      fiber: 6.8,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B1: 6, B2: 2.1, B6: 0.5, B9: 200, B3: 18, Biotin: 4.4 },
        minerals: { Potassium: 590, Phosphorus: 480, Magnesium: 70, Zinc: 3.5, Iron: 3.2 },
        carbohydrateTypes: { Fiber: 6.8 }
      }))
    },
    {
      name: 'Масло растительное',
      brand: 'Базовый продукт',
      calories: 899,
      protein: 0,
      fat: 99.9,
      carbs: 0,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { E: 17, K: 0.1 },
        fattyAcids: { Omega3: 7, Omega6: 50, Omega9: 24, TransFats: 0, Cholesterol: 0 }
      }))
    },
    {
      name: 'Соль',
      brand: 'Базовый продукт',
      calories: 0,
      protein: 0,
      fat: 0,
      carbs: 0,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        minerals: { Sodium: 38758, Salt: 96900, Chlorine: 59000 }
      }))
    },
    {
      name: 'Ванильный сахар',
      brand: 'Базовый продукт',
      calories: 397,
      protein: 0,
      fat: 0,
      carbs: 99,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        carbohydrateTypes: { Sucrose: 99 }
      }))
    },
    {
      name: 'Корица',
      brand: 'Базовый продукт',
      calories: 247,
      protein: 4,
      fat: 1.2,
      carbs: 81,
      fiber: 53.1,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { K: 31, C: 3.8, B6: 0.16, B3: 1.3 },
        minerals: { Calcium: 1002, Iron: 8.3, Potassium: 431, Magnesium: 60, Manganese: 17 },
        carbohydrateTypes: { Fiber: 53.1 }
      }))
    },
    {
      name: 'Рис отварной',
      brand: 'Базовый продукт',
      calories: 116,
      protein: 2.2,
      fat: 0.5,
      carbs: 25,
      fiber: 0.4,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B1: 0.02, B3: 0.4, B6: 0.04 },
        minerals: { Magnesium: 12, Phosphorus: 43, Potassium: 35, Manganese: 0.5, Iron: 0.2 },
        carbohydrateTypes: { Starch: 23.5, Fiber: 0.4 },
        aminoAcids: { Leucine: 180, Lysine: 90, Valine: 140, Threonine: 90 }
      }))
    },
    {
      name: 'Макароны отварные',
      brand: 'Базовый продукт',
      calories: 131,
      protein: 5,
      fat: 1.1,
      carbs: 25,
      fiber: 1.8,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B1: 0.08, B3: 1.1, B9: 7 },
        minerals: { Phosphorus: 60, Potassium: 45, Magnesium: 18, Iron: 0.5 },
        carbohydrateTypes: { Starch: 23, Fiber: 1.8 },
        aminoAcids: { Leucine: 380, Lysine: 150, Valine: 250, Threonine: 170 }
      }))
    },
    {
      name: 'Овсянка на воде',
      brand: 'Базовый продукт',
      calories: 88,
      protein: 3,
      fat: 1.7,
      carbs: 15,
      fiber: 1.7,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B1: 0.1, B6: 0.06, B9: 13, B3: 0.4 },
        minerals: { Magnesium: 27, Phosphorus: 77, Potassium: 70, Iron: 0.9, Manganese: 0.6, Zinc: 0.6 },
        carbohydrateTypes: { Starch: 12, Fiber: 1.7 },
        aminoAcids: { Leucine: 240, Lysine: 130, Valine: 180, Threonine: 100 }
      }))
    },
    {
      name: 'Картофель отварной',
      brand: 'Базовый продукт',
      calories: 82,
      protein: 2,
      fat: 0.4,
      carbs: 16.7,
      fiber: 1.8,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 7, B6: 0.2, B9: 9, B3: 1 },
        minerals: { Potassium: 328, Phosphorus: 40, Magnesium: 20, Iron: 0.3 },
        carbohydrateTypes: { Starch: 15, Fiber: 1.8 },
        aminoAcids: { Leucine: 100, Lysine: 110, Valine: 100, Threonine: 75 }
      }))
    },
    {
      name: 'Лук репчатый',
      brand: 'Базовый продукт',
      calories: 41,
      protein: 1.1,
      fat: 0.1,
      carbs: 9.3,
      fiber: 1.7,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 7.4, B6: 0.12, B9: 19 },
        minerals: { Potassium: 146, Phosphorus: 29, Calcium: 23, Manganese: 0.13, Sulfur: 60 },
        carbohydrateTypes: { Glucose: 2.3, Fructose: 1.7, Sucrose: 1.2, Fiber: 1.7 }
      }))
    },
    {
      name: 'Чеснок',
      brand: 'Базовый продукт',
      calories: 149,
      protein: 6.4,
      fat: 0.5,
      carbs: 33,
      fiber: 2.1,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 31, B6: 1.2, B1: 0.2 },
        minerals: { Potassium: 401, Phosphorus: 153, Calcium: 181, Manganese: 1.7, Selenium: 14.2, Sulfur: 480 },
        carbohydrateTypes: { Fiber: 2.1, Starch: 1 }
      }))
    },
    {
      name: 'Морковь',
      brand: 'Базовый продукт',
      calories: 41,
      protein: 0.9,
      fat: 0.2,
      carbs: 9.6,
      fiber: 2.8,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { A: 835, K: 13, C: 5.9, B6: 0.14, BetaCarotene: 8285 },
        minerals: { Potassium: 320, Calcium: 33, Phosphorus: 35, Magnesium: 12 },
        carbohydrateTypes: { Glucose: 1.3, Fructose: 1.4, Sucrose: 3.6, Fiber: 2.8 }
      }))
    },
    {
      name: 'Помидор',
      brand: 'Базовый продукт',
      calories: 18,
      protein: 0.9,
      fat: 0.2,
      carbs: 3.9,
      fiber: 1.2,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 14, A: 42, K: 7.9, B9: 15, BetaCarotene: 449 },
        minerals: { Potassium: 237, Phosphorus: 24, Magnesium: 11 },
        carbohydrateTypes: { Glucose: 1.25, Fructose: 1.4, Fiber: 1.2 }
      }))
    },
    {
      name: 'Огурец',
      brand: 'Базовый продукт',
      calories: 15,
      protein: 0.65,
      fat: 0.1,
      carbs: 3.6,
      fiber: 0.5,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { K: 16.4, C: 2.8, B9: 7 },
        minerals: { Potassium: 147, Calcium: 16, Magnesium: 13 },
        carbohydrateTypes: { Glucose: 0.9, Fructose: 0.9, Fiber: 0.5 }
      }))
    },
    {
      name: 'Капуста белокочанная',
      brand: 'Базовый продукт',
      calories: 25,
      protein: 1.3,
      fat: 0.1,
      carbs: 5.8,
      fiber: 2.5,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 36.6, K: 76, B6: 0.12, B9: 43 },
        minerals: { Potassium: 170, Calcium: 40, Sulfur: 60 },
        carbohydrateTypes: { Glucose: 2.1, Fructose: 1.5, Fiber: 2.5 }
      }))
    },
    {
      name: 'Перец болгарский',
      brand: 'Базовый продукт',
      calories: 27,
      protein: 1,
      fat: 0.3,
      carbs: 5.3,
      fiber: 2.1,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 128, A: 157, BetaCarotene: 1624, B6: 0.29 },
        minerals: { Potassium: 211, Phosphorus: 26, Magnesium: 12 },
        carbohydrateTypes: { Glucose: 1.9, Fructose: 1.9, Fiber: 2.1 }
      }))
    },
    {
      name: 'Свекла',
      brand: 'Базовый продукт',
      calories: 43,
      protein: 1.6,
      fat: 0.2,
      carbs: 9.6,
      fiber: 2.8,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 4.9, B9: 109, B6: 0.07 },
        minerals: { Potassium: 325, Manganese: 0.33, Sodium: 78, Iron: 0.8 },
        carbohydrateTypes: { Glucose: 0.2, Fructose: 0.1, Sucrose: 6.2, Fiber: 2.8 }
      }))
    },
    {
      name: 'Говядина',
      brand: 'Базовый продукт',
      calories: 250,
      protein: 26,
      fat: 15,
      carbs: 0,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B12: 2.6, B6: 0.4, B3: 4.8, Choline: 80 },
        minerals: { Phosphorus: 198, Potassium: 318, Iron: 2.6, Zinc: 4.8, Selenium: 19 },
        fattyAcids: { Omega3: 0.1, Omega6: 0.4, Omega9: 6.5, Cholesterol: 90 },
        aminoAcids: { Alanine: 1700, Arginine: 1700, AsparticAcid: 2400, GlutamicAcid: 4000, Isoleucine: 1200, Leucine: 2100, Lysine: 2300, Methionine: 700, Valine: 1300, Threonine: 1100, Tryptophan: 300, Phenylalanine: 1050, Histidine: 950, Proline: 1150, Serine: 1050, Tyrosine: 900, Glycine: 1450, Cysteine: 280 }
      }))
    },
    {
      name: 'Свинина',
      brand: 'Базовый продукт',
      calories: 263,
      protein: 21.6,
      fat: 19.4,
      carbs: 0,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B1: 0.6, B12: 0.6, B6: 0.4, B3: 5.2 },
        minerals: { Phosphorus: 180, Potassium: 285, Iron: 1, Zinc: 2, Selenium: 21 },
        fattyAcids: { Omega3: 0.06, Omega6: 1.8, Omega9: 8.5, Cholesterol: 80 },
        aminoAcids: { Alanine: 1300, Arginine: 1400, AsparticAcid: 2000, GlutamicAcid: 3400, Isoleucine: 1000, Leucine: 1700, Lysine: 1900, Methionine: 550, Valine: 1100, Threonine: 900, Tryptophan: 250, Phenylalanine: 850, Histidine: 850, Proline: 900, Serine: 850, Tyrosine: 750, Glycine: 1100, Cysteine: 230 }
      }))
    },
    {
      name: 'Куриное филе',
      brand: 'Базовый продукт',
      calories: 165,
      protein: 31,
      fat: 3.6,
      carbs: 0,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B12: 0.6, B6: 0.6, B3: 13.7, Choline: 85 },
        minerals: { Phosphorus: 210, Potassium: 256, Sodium: 74, Magnesium: 29, Iron: 1, Zinc: 1, Selenium: 24, Sulfur: 300 },
        fattyAcids: { Omega3: 0.08, Omega6: 0.7, Omega9: 1.0, Cholesterol: 85 },
        aminoAcids: { Alanine: 1900, Arginine: 1800, AsparticAcid: 3100, GlutamicAcid: 5000, Isoleucine: 1400, Leucine: 2400, Lysine: 2600, Methionine: 800, Valine: 1500, Threonine: 1300, Tryptophan: 350, Phenylalanine: 1200, Histidine: 1100, Proline: 1200, Serine: 1300, Tyrosine: 1000, Glycine: 1500, Cysteine: 300 }
      }))
    },
    {
      name: 'Куриное бедро',
      brand: 'Базовый продукт',
      calories: 185,
      protein: 23,
      fat: 10,
      carbs: 0,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B12: 0.4, B6: 0.4, B3: 6 },
        minerals: { Phosphorus: 150, Potassium: 220, Iron: 1.3, Zinc: 1.9, Selenium: 17 },
        fattyAcids: { Omega3: 0.1, Omega6: 1.8, Omega9: 3.5, Cholesterol: 105 },
        aminoAcids: { Leucine: 1700, Lysine: 1900, Valine: 1100, Threonine: 950, Arginine: 1400 }
      }))
    },
    {
      name: 'Фарш говяжий',
      brand: 'Базовый продукт',
      calories: 254,
      protein: 17.2,
      fat: 20,
      carbs: 0,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B12: 2.2, B6: 0.3, B3: 4 },
        minerals: { Phosphorus: 160, Potassium: 270, Iron: 2.2, Zinc: 4 },
        fattyAcids: { Omega3: 0.1, Omega6: 0.5, Omega9: 8, Cholesterol: 80 },
        aminoAcids: { Leucine: 1400, Lysine: 1500, Valine: 900, Threonine: 750, Arginine: 1100 }
      }))
    },
    {
      name: 'Лосось',
      brand: 'Базовый продукт',
      calories: 208,
      protein: 20,
      fat: 13,
      carbs: 0,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { D: 11, B12: 3.2, B3: 8.5, B6: 0.6 },
        minerals: { Phosphorus: 240, Potassium: 363, Selenium: 36, Iodine: 30 },
        fattyAcids: { Omega3: 2.3, Omega6: 0.5, Omega9: 3.8, Cholesterol: 55 },
        aminoAcids: { Leucine: 1600, Lysine: 1800, Valine: 1050, Threonine: 900, Arginine: 1200 }
      }))
    },
    {
      name: 'Треска',
      brand: 'Базовый продукт',
      calories: 82,
      protein: 18,
      fat: 0.7,
      carbs: 0,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { D: 1, B12: 0.9, B3: 2.1 },
        minerals: { Phosphorus: 203, Potassium: 413, Selenium: 33, Iodine: 110 },
        fattyAcids: { Omega3: 0.2, Omega6: 0.02, Cholesterol: 43 },
        aminoAcids: { Leucine: 1450, Lysine: 1650, Valine: 950, Threonine: 800, Arginine: 1050 }
      }))
    },
    {
      name: 'Сметана',
      brand: 'Базовый продукт',
      calories: 206,
      protein: 2.8,
      fat: 20,
      carbs: 3.2,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { A: 150, B2: 0.1, B12: 0.3, Choline: 25 },
        minerals: { Calcium: 90, Phosphorus: 60, Potassium: 124, Sodium: 32 },
        fattyAcids: { Omega3: 0.05, Omega6: 0.5, Omega9: 4.5, TransFats: 0.6, Cholesterol: 60 },
        carbohydrateTypes: { Lactose: 3.2 }
      }))
    },
    {
      name: 'Сыр твердый',
      brand: 'Базовый продукт',
      calories: 360,
      protein: 25,
      fat: 27,
      carbs: 1.3,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { A: 250, B12: 1.5, B2: 0.4, Choline: 18 },
        minerals: { Calcium: 800, Phosphorus: 550, Sodium: 600, Zinc: 3.5, Iodine: 30 },
        fattyAcids: { Omega3: 0.1, Omega6: 0.6, Omega9: 7, TransFats: 1, Cholesterol: 90 },
        carbohydrateTypes: { Lactose: 1.3 },
        aminoAcids: { Leucine: 2400, Lysine: 2000, Valine: 1700, Threonine: 1000, Arginine: 900, GlutamicAcid: 5500 }
      }))
    },
    {
      name: 'Кефир',
      brand: 'Базовый продукт',
      calories: 41,
      protein: 3.4,
      fat: 1,
      carbs: 4,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { A: 13, B2: 0.17, B12: 0.4, Choline: 14 },
        minerals: { Calcium: 120, Phosphorus: 95, Potassium: 146, Sodium: 50 },
        fattyAcids: { Omega3: 0.02, Omega6: 0.1, Cholesterol: 8 },
        carbohydrateTypes: { Lactose: 4 }
      }))
    },
    {
      name: 'Сливки',
      brand: 'Базовый продукт',
      calories: 205,
      protein: 2.8,
      fat: 20,
      carbs: 3.7,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { A: 200, B2: 0.1, Choline: 20 },
        minerals: { Calcium: 86, Phosphorus: 60, Potassium: 109 },
        fattyAcids: { Omega3: 0.05, Omega6: 0.5, Omega9: 4.5, TransFats: 0.7, Cholesterol: 70 },
        carbohydrateTypes: { Lactose: 3.7 }
      }))
    },
    {
      name: 'Йогурт натуральный',
      brand: 'Базовый продукт',
      calories: 60,
      protein: 5,
      fat: 3.2,
      carbs: 3.5,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B2: 0.2, B12: 0.5, A: 27 },
        minerals: { Calcium: 150, Phosphorus: 120, Potassium: 180 },
        fattyAcids: { Omega3: 0.03, Omega6: 0.1, Cholesterol: 12 },
        carbohydrateTypes: { Lactose: 3.5 }
      }))
    },
    {
      name: 'Мёд',
      brand: 'Базовый продукт',
      calories: 304,
      protein: 0.3,
      fat: 0,
      carbs: 82.4,
      fiber: 0.2,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 0.5, B6: 0.02, B3: 0.1 },
        minerals: { Potassium: 52, Calcium: 6, Manganese: 0.08 },
        carbohydrateTypes: { Glucose: 35, Fructose: 41, Sucrose: 1, Fiber: 0.2 }
      }))
    },
    {
      name: 'Майонез',
      brand: 'Базовый продукт',
      calories: 680,
      protein: 1.5,
      fat: 75,
      carbs: 2.6,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { E: 12, K: 50 },
        minerals: { Sodium: 700, Phosphorus: 50 },
        fattyAcids: { Omega3: 5, Omega6: 35, Omega9: 18, TransFats: 0.3, Cholesterol: 60 }
      }))
    },
    {
      name: 'Кетчуп',
      brand: 'Базовый продукт',
      calories: 112,
      protein: 1.7,
      fat: 0.3,
      carbs: 25.8,
      fiber: 0.6,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 6, A: 30, K: 5 },
        minerals: { Potassium: 280, Sodium: 900 },
        carbohydrateTypes: { Glucose: 5, Fructose: 6, Sucrose: 8, Fiber: 0.6 }
      }))
    },
    {
      name: 'Соевый соус',
      brand: 'Базовый продукт',
      calories: 53,
      protein: 6,
      fat: 0,
      carbs: 6,
      fiber: 0.5,
      micronutrients: JSON.stringify(buildMicronutrients({
        minerals: { Sodium: 5500, Potassium: 280, Manganese: 0.5 },
        aminoAcids: { GlutamicAcid: 1000, Alanine: 200 }
      }))
    },
    {
      name: 'Уксус',
      brand: 'Базовый продукт',
      calories: 21,
      protein: 0,
      fat: 0,
      carbs: 0.9,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        minerals: { Potassium: 73, Calcium: 5 }
      }))
    },
    {
      name: 'Панировочные сухари',
      brand: 'Базовый продукт',
      calories: 347,
      protein: 11,
      fat: 4.3,
      carbs: 71,
      fiber: 3.6,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B1: 0.2, B3: 2.8 },
        minerals: { Sodium: 700, Phosphorus: 130, Iron: 2.5 },
        carbohydrateTypes: { Starch: 60, Fiber: 3.6 },
        aminoAcids: { Leucine: 700, Lysine: 250, Valine: 420 }
      }))
    },
    {
      name: 'Хлеб пшеничный',
      brand: 'Базовый продукт',
      calories: 265,
      protein: 8.1,
      fat: 3.2,
      carbs: 48.8,
      fiber: 2.4,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B1: 0.2, B2: 0.1, B3: 2, Choline: 25 },
        minerals: { Sodium: 480, Phosphorus: 100, Calcium: 30, Iron: 1.8 },
        carbohydrateTypes: { Starch: 42, Fiber: 2.4 },
        aminoAcids: { Leucine: 600, Lysine: 220, Valine: 380, GlutamicAcid: 2800 }
      }))
    },
    {
      name: 'Грецкий орех',
      brand: 'Базовый продукт',
      calories: 654,
      protein: 15.2,
      fat: 65.2,
      carbs: 13.7,
      fiber: 6.7,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { E: 0.7, B6: 0.5, B9: 98, B1: 0.34 },
        minerals: { Potassium: 441, Phosphorus: 346, Magnesium: 158, Manganese: 3.4, Copper: 1.6, Zinc: 3.1 },
        fattyAcids: { Omega3: 9.1, Omega6: 38, Omega9: 8.9, Cholesterol: 0 },
        carbohydrateTypes: { Fiber: 6.7 },
        aminoAcids: { Leucine: 1170, Lysine: 430, Valine: 800, Arginine: 2300, GlutamicAcid: 3300 }
      }))
    },
    // --- Расширенный каталог: овощи, фрукты, мясо/рыба, молочка, крупы/бобовые, орехи, масла, специи, соусы, выпечка ---
    {
      name: 'Кабачок',
      brand: 'Базовый продукт',
      calories: 24,
      protein: 1.2,
      fat: 0.3,
      carbs: 4.6,
      fiber: 1,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 17, B6: 0.16, B9: 24 },
        minerals: { Potassium: 261, Magnesium: 18, Phosphorus: 38 },
        carbohydrateTypes: { Glucose: 1.4, Fructose: 1.2, Fiber: 1 }
      }))
    },
    {
      name: 'Баклажан',
      brand: 'Базовый продукт',
      calories: 25,
      protein: 1,
      fat: 0.2,
      carbs: 5.9,
      fiber: 3,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 2.2, B6: 0.08, B9: 22, B1: 0.04 },
        minerals: { Potassium: 229, Manganese: 0.25, Magnesium: 14 },
        carbohydrateTypes: { Glucose: 1.5, Fructose: 1.5, Fiber: 3 }
      }))
    },
    {
      name: 'Тыква',
      brand: 'Базовый продукт',
      calories: 26,
      protein: 1,
      fat: 0.1,
      carbs: 4.9,
      fiber: 0.5,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { A: 426, C: 9, E: 1.1, BetaCarotene: 3100 },
        minerals: { Potassium: 340, Magnesium: 12, Calcium: 21 },
        carbohydrateTypes: { Glucose: 1.3, Fructose: 1.3, Sucrose: 1.3, Fiber: 0.5 }
      }))
    },
    {
      name: 'Брокколи',
      brand: 'Базовый продукт',
      calories: 34,
      protein: 2.8,
      fat: 0.4,
      carbs: 7,
      fiber: 2.6,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 89, K: 102, B9: 63, A: 31, BetaCarotene: 361 },
        minerals: { Potassium: 316, Calcium: 47, Phosphorus: 66, Iron: 0.7 },
        carbohydrateTypes: { Glucose: 0.7, Fructose: 0.6, Fiber: 2.6 }
      }))
    },
    {
      name: 'Цветная капуста',
      brand: 'Базовый продукт',
      calories: 25,
      protein: 1.9,
      fat: 0.3,
      carbs: 5,
      fiber: 2,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 48, B9: 57, K: 16 },
        minerals: { Potassium: 299, Phosphorus: 44, Calcium: 22 },
        carbohydrateTypes: { Fiber: 2 }
      }))
    },
    {
      name: 'Шпинат',
      brand: 'Базовый продукт',
      calories: 23,
      protein: 2.9,
      fat: 0.4,
      carbs: 3.6,
      fiber: 2.2,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { A: 469, K: 483, C: 28, B9: 194, BetaCarotene: 5626 },
        minerals: { Iron: 2.7, Potassium: 558, Calcium: 99, Magnesium: 79, Manganese: 0.9 },
        carbohydrateTypes: { Fiber: 2.2 }
      }))
    },
    {
      name: 'Зелёный горошек',
      brand: 'Базовый продукт',
      calories: 81,
      protein: 5.4,
      fat: 0.4,
      carbs: 14.5,
      fiber: 5.1,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 40, K: 25, B9: 65, B1: 0.27 },
        minerals: { Potassium: 244, Phosphorus: 108, Magnesium: 33, Iron: 1.5 },
        carbohydrateTypes: { Starch: 8.6, Fiber: 5.1 },
        aminoAcids: { Leucine: 410, Lysine: 380, Valine: 290 }
      }))
    },
    {
      name: 'Фасоль стручковая',
      brand: 'Базовый продукт',
      calories: 31,
      protein: 1.8,
      fat: 0.2,
      carbs: 7,
      fiber: 3.4,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 12, K: 43, B9: 33, A: 35 },
        minerals: { Potassium: 211, Calcium: 37, Magnesium: 25 },
        carbohydrateTypes: { Fiber: 3.4 }
      }))
    },
    {
      name: 'Редис',
      brand: 'Базовый продукт',
      calories: 16,
      protein: 0.7,
      fat: 0.1,
      carbs: 3.4,
      fiber: 1.6,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 15, B9: 25, B6: 0.07 },
        minerals: { Potassium: 233, Calcium: 25 },
        carbohydrateTypes: { Fiber: 1.6 }
      }))
    },
    {
      name: 'Кукуруза отварная',
      brand: 'Базовый продукт',
      calories: 96,
      protein: 3.4,
      fat: 1.5,
      carbs: 21,
      fiber: 2.4,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B9: 42, B1: 0.16, B3: 1.5, BetaCarotene: 47 },
        minerals: { Potassium: 270, Phosphorus: 89, Magnesium: 26 },
        carbohydrateTypes: { Starch: 15, Fiber: 2.4 }
      }))
    },
    {
      name: 'Грибы шампиньоны',
      brand: 'Базовый продукт',
      calories: 27,
      protein: 4.3,
      fat: 0.6,
      carbs: 0.6,
      fiber: 1,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B2: 0.4, B3: 3.6, B5: 1.5, D: 0.2 },
        minerals: { Potassium: 318, Phosphorus: 86, Selenium: 9.3, Copper: 0.3 },
        carbohydrateTypes: { Fiber: 1 },
        aminoAcids: { Leucine: 220, Lysine: 200, GlutamicAcid: 480 }
      }))
    },
    {
      name: 'Укроп',
      brand: 'Базовый продукт',
      calories: 43,
      protein: 3.5,
      fat: 1.1,
      carbs: 7,
      fiber: 2.1,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 85, A: 386, K: 39, BetaCarotene: 4600 },
        minerals: { Calcium: 208, Iron: 6.6, Manganese: 1.3, Potassium: 738 },
        carbohydrateTypes: { Fiber: 2.1 }
      }))
    },
    {
      name: 'Петрушка',
      brand: 'Базовый продукт',
      calories: 36,
      protein: 3,
      fat: 0.8,
      carbs: 6.3,
      fiber: 3.3,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 133, A: 421, K: 1640, BetaCarotene: 5054 },
        minerals: { Calcium: 138, Iron: 6.2, Potassium: 554 },
        carbohydrateTypes: { Fiber: 3.3 }
      }))
    },
    {
      name: 'Листья салата',
      brand: 'Базовый продукт',
      calories: 15,
      protein: 1.4,
      fat: 0.2,
      carbs: 2.4,
      fiber: 1.3,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { A: 370, K: 102, C: 9.2, BetaCarotene: 4443 },
        minerals: { Potassium: 194, Calcium: 36 },
        carbohydrateTypes: { Fiber: 1.3 }
      }))
    },
    {
      name: 'Апельсин',
      brand: 'Базовый продукт',
      calories: 47,
      protein: 0.9,
      fat: 0.1,
      carbs: 11.8,
      fiber: 2.4,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 53, B9: 30, B1: 0.09 },
        minerals: { Potassium: 181, Calcium: 40 },
        carbohydrateTypes: { Glucose: 2.4, Fructose: 2.4, Sucrose: 4.3, Fiber: 2.4 }
      }))
    },
    {
      name: 'Мандарин',
      brand: 'Базовый продукт',
      calories: 53,
      protein: 0.8,
      fat: 0.3,
      carbs: 13.3,
      fiber: 1.8,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 26.7, A: 34, B9: 16, BetaCarotene: 155 },
        minerals: { Potassium: 166, Calcium: 37 },
        carbohydrateTypes: { Glucose: 1.6, Fructose: 1.5, Sucrose: 6.5, Fiber: 1.8 }
      }))
    },
    {
      name: 'Груша',
      brand: 'Базовый продукт',
      calories: 57,
      protein: 0.4,
      fat: 0.1,
      carbs: 15.2,
      fiber: 3.1,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 4.3, K: 4.5, B9: 7 },
        minerals: { Potassium: 119, Calcium: 9 },
        carbohydrateTypes: { Glucose: 2.8, Fructose: 6.2, Sucrose: 1.6, Fiber: 3.1 }
      }))
    },
    {
      name: 'Виноград',
      brand: 'Базовый продукт',
      calories: 69,
      protein: 0.7,
      fat: 0.2,
      carbs: 18,
      fiber: 0.9,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 3.2, K: 14.6, B6: 0.09 },
        minerals: { Potassium: 191, Calcium: 10 },
        carbohydrateTypes: { Glucose: 8, Fructose: 8.1, Fiber: 0.9 }
      }))
    },
    {
      name: 'Клубника',
      brand: 'Базовый продукт',
      calories: 32,
      protein: 0.7,
      fat: 0.3,
      carbs: 7.7,
      fiber: 2,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 59, B9: 24, K: 2.2 },
        minerals: { Potassium: 153, Manganese: 0.39 },
        carbohydrateTypes: { Glucose: 2, Fructose: 2.4, Sucrose: 0.6, Fiber: 2 }
      }))
    },
    {
      name: 'Малина',
      brand: 'Базовый продукт',
      calories: 52,
      protein: 1.2,
      fat: 0.7,
      carbs: 11.9,
      fiber: 6.5,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 26, K: 7.8, B9: 21 },
        minerals: { Manganese: 0.67, Potassium: 151 },
        carbohydrateTypes: { Glucose: 1.9, Fructose: 2.4, Fiber: 6.5 }
      }))
    },
    {
      name: 'Черника',
      brand: 'Базовый продукт',
      calories: 57,
      protein: 0.7,
      fat: 0.3,
      carbs: 14.5,
      fiber: 2.4,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 9.7, K: 19.3, E: 0.6 },
        minerals: { Manganese: 0.34, Potassium: 77 },
        carbohydrateTypes: { Glucose: 5, Fructose: 5, Fiber: 2.4 }
      }))
    },
    {
      name: 'Лимон',
      brand: 'Базовый продукт',
      calories: 29,
      protein: 1.1,
      fat: 0.3,
      carbs: 9.3,
      fiber: 2.8,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 53, B6: 0.08, B9: 11 },
        minerals: { Potassium: 138, Calcium: 26 },
        carbohydrateTypes: { Glucose: 1.5, Fructose: 1.4, Sucrose: 0.4, Fiber: 2.8 }
      }))
    },
    {
      name: 'Грейпфрут',
      brand: 'Базовый продукт',
      calories: 42,
      protein: 0.8,
      fat: 0.1,
      carbs: 10.7,
      fiber: 1.6,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 31, A: 60, BetaCarotene: 686 },
        minerals: { Potassium: 166, Calcium: 22 },
        carbohydrateTypes: { Glucose: 1.4, Fructose: 1.5, Sucrose: 3.6, Fiber: 1.6 }
      }))
    },
    {
      name: 'Киви',
      brand: 'Базовый продукт',
      calories: 61,
      protein: 1.1,
      fat: 0.5,
      carbs: 14.7,
      fiber: 3,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 92.7, K: 40, E: 1.5, B9: 25 },
        minerals: { Potassium: 312, Calcium: 34 },
        carbohydrateTypes: { Glucose: 4.3, Fructose: 4.4, Fiber: 3 }
      }))
    },
    {
      name: 'Персик',
      brand: 'Базовый продукт',
      calories: 39,
      protein: 0.9,
      fat: 0.3,
      carbs: 9.5,
      fiber: 1.5,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 6.6, A: 16, BetaCarotene: 162 },
        minerals: { Potassium: 190, Calcium: 6 },
        carbohydrateTypes: { Glucose: 1.5, Fructose: 1.3, Sucrose: 4.8, Fiber: 1.5 }
      }))
    },
    {
      name: 'Абрикос',
      brand: 'Базовый продукт',
      calories: 48,
      protein: 1.4,
      fat: 0.4,
      carbs: 11.1,
      fiber: 2,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 10, A: 96, BetaCarotene: 1094 },
        minerals: { Potassium: 259, Calcium: 13 },
        carbohydrateTypes: { Glucose: 2.4, Fructose: 0.7, Sucrose: 5.9, Fiber: 2 }
      }))
    },
    {
      name: 'Слива',
      brand: 'Базовый продукт',
      calories: 46,
      protein: 0.7,
      fat: 0.3,
      carbs: 11.4,
      fiber: 1.4,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 9.5, K: 6.4, A: 17 },
        minerals: { Potassium: 157, Calcium: 6 },
        carbohydrateTypes: { Glucose: 5.2, Fructose: 3.9, Sucrose: 1.6, Fiber: 1.4 }
      }))
    },
    {
      name: 'Арбуз',
      brand: 'Базовый продукт',
      calories: 30,
      protein: 0.6,
      fat: 0.2,
      carbs: 7.6,
      fiber: 0.4,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 8.1, A: 28, BetaCarotene: 303 },
        minerals: { Potassium: 112 },
        carbohydrateTypes: { Glucose: 1.6, Fructose: 3.4, Sucrose: 1.2, Fiber: 0.4 }
      }))
    },
    {
      name: 'Дыня',
      brand: 'Базовый продукт',
      calories: 34,
      protein: 0.8,
      fat: 0.2,
      carbs: 8.2,
      fiber: 0.9,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 36.7, A: 169, BetaCarotene: 2020 },
        minerals: { Potassium: 267 },
        carbohydrateTypes: { Glucose: 1.5, Fructose: 1.8, Sucrose: 4.5, Fiber: 0.9 }
      }))
    },
    {
      name: 'Гранат',
      brand: 'Базовый продукт',
      calories: 83,
      protein: 1.7,
      fat: 1.2,
      carbs: 18.7,
      fiber: 4,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 10.2, K: 16.4, B9: 38 },
        minerals: { Potassium: 236 },
        carbohydrateTypes: { Glucose: 7.9, Fructose: 7.2, Fiber: 4 }
      }))
    },
    {
      name: 'Изюм',
      brand: 'Базовый продукт',
      calories: 299,
      protein: 3,
      fat: 0.5,
      carbs: 79.2,
      fiber: 3.7,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B6: 0.17, B1: 0.1 },
        minerals: { Potassium: 749, Iron: 1.9, Calcium: 50 },
        carbohydrateTypes: { Glucose: 32, Fructose: 33, Fiber: 3.7 }
      }))
    },
    {
      name: 'Чернослив',
      brand: 'Базовый продукт',
      calories: 240,
      protein: 2.2,
      fat: 0.4,
      carbs: 63.9,
      fiber: 7.1,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { K: 59.5, B6: 0.21, A: 39 },
        minerals: { Potassium: 732, Iron: 0.9 },
        carbohydrateTypes: { Glucose: 16, Fructose: 15, Sucrose: 8, Fiber: 7.1 }
      }))
    },
    {
      name: 'Курага',
      brand: 'Базовый продукт',
      calories: 241,
      protein: 3.4,
      fat: 0.5,
      carbs: 62.6,
      fiber: 7.3,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { A: 180, BetaCarotene: 2163 },
        minerals: { Potassium: 1162, Iron: 2.7, Calcium: 55 },
        carbohydrateTypes: { Glucose: 11, Fructose: 20, Sucrose: 21, Fiber: 7.3 }
      }))
    },
    {
      name: 'Индейка филе',
      brand: 'Базовый продукт',
      calories: 113,
      protein: 23.6,
      fat: 1.4,
      carbs: 0,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B3: 8.1, B6: 0.6, B12: 0.4 },
        minerals: { Phosphorus: 220, Potassium: 270, Selenium: 27, Zinc: 1.4 },
        fattyAcids: { Omega3: 0.05, Omega6: 0.3, Cholesterol: 60 },
        aminoAcids: { Leucine: 1900, Lysine: 2200, Valine: 1200, Threonine: 1050, Arginine: 1500 }
      }))
    },
    {
      name: 'Баранина',
      brand: 'Базовый продукт',
      calories: 294,
      protein: 16.5,
      fat: 24.8,
      carbs: 0,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B12: 2.6, B3: 5.8, B6: 0.15 },
        minerals: { Phosphorus: 170, Potassium: 270, Iron: 1.8, Zinc: 3.7 },
        fattyAcids: { Omega3: 0.1, Omega6: 1.4, Omega9: 9.5, Cholesterol: 97 },
        aminoAcids: { Leucine: 1300, Lysine: 1500, Valine: 900, Arginine: 1100 }
      }))
    },
    {
      name: 'Печень куриная',
      brand: 'Базовый продукт',
      calories: 140,
      protein: 20.4,
      fat: 5.9,
      carbs: 0.7,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { A: 3296, B12: 16.6, B9: 588, B2: 1.7, Choline: 290 },
        minerals: { Iron: 9, Phosphorus: 297, Selenium: 55 },
        fattyAcids: { Cholesterol: 345 },
        aminoAcids: { Leucine: 1700, Lysine: 1500, Arginine: 1200 }
      }))
    },
    {
      name: 'Печень говяжья',
      brand: 'Базовый продукт',
      calories: 127,
      protein: 20,
      fat: 3.7,
      carbs: 0,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { A: 6500, B12: 60, B9: 290, B2: 2.2, Choline: 333 },
        minerals: { Iron: 6.5, Copper: 9.8, Selenium: 39 },
        fattyAcids: { Cholesterol: 270 },
        aminoAcids: { Leucine: 1800, Lysine: 1600, Arginine: 1300 }
      }))
    },
    {
      name: 'Бекон',
      brand: 'Базовый продукт',
      calories: 541,
      protein: 37,
      fat: 42,
      carbs: 1.4,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B1: 0.4, B12: 0.7, B3: 6 },
        minerals: { Phosphorus: 200, Sodium: 1500, Potassium: 280 },
        fattyAcids: { Omega6: 4, Omega9: 18, TransFats: 0.2, Cholesterol: 110 }
      }))
    },
    {
      name: 'Колбаса варёная',
      brand: 'Базовый продукт',
      calories: 257,
      protein: 12,
      fat: 22.8,
      carbs: 1.5,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B1: 0.2, B12: 0.8 },
        minerals: { Sodium: 900, Phosphorus: 150 },
        fattyAcids: { Omega6: 1.8, Omega9: 9, Cholesterol: 60 }
      }))
    },
    {
      name: 'Сосиски',
      brand: 'Базовый продукт',
      calories: 266,
      protein: 11.6,
      fat: 23.9,
      carbs: 1.6,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B1: 0.2, B12: 0.7 },
        minerals: { Sodium: 950, Phosphorus: 140 },
        fattyAcids: { Omega6: 1.9, Omega9: 9.5, Cholesterol: 65 }
      }))
    },
    {
      name: 'Ветчина',
      brand: 'Базовый продукт',
      calories: 145,
      protein: 22,
      fat: 5,
      carbs: 1,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B1: 0.6, B12: 0.6, B3: 5.5 },
        minerals: { Sodium: 1200, Phosphorus: 240, Zinc: 1.9 },
        fattyAcids: { Cholesterol: 50 },
        aminoAcids: { Leucine: 1700, Lysine: 1900 }
      }))
    },
    {
      name: 'Тунец консервированный',
      brand: 'Базовый продукт',
      calories: 132,
      protein: 25.5,
      fat: 1,
      carbs: 0,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { D: 1.7, B12: 2.5, B3: 12 },
        minerals: { Phosphorus: 200, Potassium: 250, Selenium: 80, Iodine: 17 },
        fattyAcids: { Omega3: 0.3, Cholesterol: 30 },
        aminoAcids: { Leucine: 2000, Lysine: 2300 }
      }))
    },
    {
      name: 'Скумбрия',
      brand: 'Базовый продукт',
      calories: 205,
      protein: 18.6,
      fat: 13.9,
      carbs: 0,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { D: 16.1, B12: 8.7, B3: 9.1 },
        minerals: { Phosphorus: 217, Selenium: 44, Iodine: 100 },
        fattyAcids: { Omega3: 2.6, Omega6: 1.2, Cholesterol: 70 },
        aminoAcids: { Leucine: 1500, Lysine: 1700 }
      }))
    },
    {
      name: 'Сельдь',
      brand: 'Базовый продукт',
      calories: 158,
      protein: 18,
      fat: 9,
      carbs: 0,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { D: 27, B12: 13, B3: 4.6 },
        minerals: { Phosphorus: 236, Selenium: 36, Iodine: 40, Sodium: 90 },
        fattyAcids: { Omega3: 1.7, Cholesterol: 60 },
        aminoAcids: { Leucine: 1450, Lysine: 1650 }
      }))
    },
    {
      name: 'Креветки',
      brand: 'Базовый продукт',
      calories: 99,
      protein: 24,
      fat: 0.3,
      carbs: 0.2,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B12: 1.1, B3: 2.6 },
        minerals: { Iodine: 110, Selenium: 38, Phosphorus: 214, Sodium: 110 },
        fattyAcids: { Omega3: 0.5, Cholesterol: 152 },
        aminoAcids: { Leucine: 1850, Lysine: 2100 }
      }))
    },
    {
      name: 'Кальмар',
      brand: 'Базовый продукт',
      calories: 92,
      protein: 18,
      fat: 1.2,
      carbs: 2,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B12: 1.3, B3: 2.2 },
        minerals: { Phosphorus: 213, Selenium: 45, Copper: 1.5 },
        fattyAcids: { Omega3: 0.5, Cholesterol: 233 },
        aminoAcids: { Leucine: 1500, Lysine: 1600 }
      }))
    },
    {
      name: 'Икра красная',
      brand: 'Базовый продукт',
      calories: 252,
      protein: 30.4,
      fat: 13.8,
      carbs: 0,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { A: 450, D: 13, B12: 19, B9: 50 },
        minerals: { Sodium: 1500, Phosphorus: 355, Iron: 1.8, Iodine: 200 },
        fattyAcids: { Omega3: 5.8, Cholesterol: 300 },
        aminoAcids: { Leucine: 2200, Lysine: 2400 }
      }))
    },
    {
      name: 'Сыр плавленый',
      brand: 'Базовый продукт',
      calories: 257,
      protein: 11,
      fat: 19,
      carbs: 8,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { A: 180, B2: 0.3 },
        minerals: { Calcium: 450, Phosphorus: 480, Sodium: 1200 },
        fattyAcids: { Cholesterol: 60 },
        carbohydrateTypes: { Lactose: 8 }
      }))
    },
    {
      name: 'Сыр моцарелла',
      brand: 'Базовый продукт',
      calories: 280,
      protein: 18,
      fat: 22,
      carbs: 2.2,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { A: 180, B12: 1, B2: 0.3 },
        minerals: { Calcium: 505, Phosphorus: 354, Sodium: 627 },
        fattyAcids: { Cholesterol: 79 },
        carbohydrateTypes: { Lactose: 2.2 },
        aminoAcids: { Leucine: 1700, Lysine: 1400 }
      }))
    },
    {
      name: 'Ряженка',
      brand: 'Базовый продукт',
      calories: 67,
      protein: 2.9,
      fat: 4,
      carbs: 4.2,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { A: 25, B2: 0.15, B12: 0.3 },
        minerals: { Calcium: 124, Phosphorus: 91, Potassium: 144 },
        fattyAcids: { Cholesterol: 23 },
        carbohydrateTypes: { Lactose: 4.2 }
      }))
    },
    {
      name: 'Молоко сгущённое',
      brand: 'Базовый продукт',
      calories: 320,
      protein: 7.2,
      fat: 8.5,
      carbs: 56,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B2: 0.4, A: 60 },
        minerals: { Calcium: 250, Phosphorus: 200 },
        carbohydrateTypes: { Sucrose: 44, Lactose: 12 }
      }))
    },
    {
      name: 'Перловка отварная',
      brand: 'Базовый продукт',
      calories: 109,
      protein: 3.1,
      fat: 0.4,
      carbs: 22.2,
      fiber: 3.8,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B1: 0.1, B3: 1.5, B6: 0.1 },
        minerals: { Phosphorus: 81, Magnesium: 22, Manganese: 0.6 },
        carbohydrateTypes: { Starch: 18, Fiber: 3.8 }
      }))
    },
    {
      name: 'Пшено отварное',
      brand: 'Базовый продукт',
      calories: 119,
      protein: 3.5,
      fat: 1,
      carbs: 24.7,
      fiber: 1.3,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B1: 0.1, B6: 0.1, B3: 1.3 },
        minerals: { Phosphorus: 100, Magnesium: 32, Manganese: 0.5 },
        carbohydrateTypes: { Starch: 20, Fiber: 1.3 }
      }))
    },
    {
      name: 'Манная каша на молоке',
      brand: 'Базовый продукт',
      calories: 98,
      protein: 3,
      fat: 3.2,
      carbs: 14.3,
      fiber: 0.2,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B2: 0.1, A: 20 },
        minerals: { Calcium: 80, Phosphorus: 70 },
        carbohydrateTypes: { Starch: 12, Lactose: 1.5, Fiber: 0.2 }
      }))
    },
    {
      name: 'Чечевица отварная',
      brand: 'Базовый продукт',
      calories: 116,
      protein: 9,
      fat: 0.4,
      carbs: 20,
      fiber: 7.9,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B9: 181, B1: 0.17, B6: 0.18 },
        minerals: { Iron: 3.3, Potassium: 369, Magnesium: 36, Phosphorus: 180 },
        carbohydrateTypes: { Starch: 12, Fiber: 7.9 },
        aminoAcids: { Leucine: 700, Lysine: 630, Valine: 480, Arginine: 750 }
      }))
    },
    {
      name: 'Фасоль красная отварная',
      brand: 'Базовый продукт',
      calories: 127,
      protein: 8.7,
      fat: 0.5,
      carbs: 22.8,
      fiber: 7.4,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B9: 130, B1: 0.16, B6: 0.12 },
        minerals: { Iron: 2.9, Potassium: 403, Magnesium: 45, Phosphorus: 142 },
        carbohydrateTypes: { Starch: 14, Fiber: 7.4 },
        aminoAcids: { Leucine: 680, Lysine: 620, Valine: 470, Arginine: 540 }
      }))
    },
    {
      name: 'Нут отварной',
      brand: 'Базовый продукт',
      calories: 164,
      protein: 8.9,
      fat: 2.6,
      carbs: 27.4,
      fiber: 7.6,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B9: 172, B6: 0.14, B1: 0.12 },
        minerals: { Iron: 2.9, Potassium: 291, Magnesium: 48, Manganese: 1 },
        carbohydrateTypes: { Starch: 16, Fiber: 7.6 },
        aminoAcids: { Leucine: 650, Lysine: 600, Arginine: 880 }
      }))
    },
    {
      name: 'Кускус отварной',
      brand: 'Базовый продукт',
      calories: 112,
      protein: 3.8,
      fat: 0.2,
      carbs: 23.2,
      fiber: 1.4,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B1: 0.05, B3: 1.3, B9: 5 },
        minerals: { Phosphorus: 35, Magnesium: 8, Potassium: 58 },
        carbohydrateTypes: { Starch: 21, Fiber: 1.4 }
      }))
    },
    {
      name: 'Булгур отварной',
      brand: 'Базовый продукт',
      calories: 83,
      protein: 3.1,
      fat: 0.2,
      carbs: 18.6,
      fiber: 4.5,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B1: 0.05, B3: 1.6, B6: 0.1 },
        minerals: { Phosphorus: 30, Magnesium: 10, Manganese: 0.6 },
        carbohydrateTypes: { Starch: 14, Fiber: 4.5 }
      }))
    },
    {
      name: 'Крахмал картофельный',
      brand: 'Базовый продукт',
      calories: 343,
      protein: 0.1,
      fat: 0.1,
      carbs: 83,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        minerals: { Potassium: 27, Calcium: 20 },
        carbohydrateTypes: { Starch: 83 }
      }))
    },
    {
      name: 'Миндаль',
      brand: 'Базовый продукт',
      calories: 579,
      protein: 21.2,
      fat: 49.9,
      carbs: 21.6,
      fiber: 12.5,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { E: 25.6, B2: 0.1, B3: 3.4, B9: 44 },
        minerals: { Magnesium: 270, Calcium: 269, Potassium: 733, Iron: 3.7, Manganese: 2.3, Zinc: 3.1 },
        fattyAcids: { Omega6: 12, Omega9: 32, Cholesterol: 0 },
        carbohydrateTypes: { Fiber: 12.5 },
        aminoAcids: { Leucine: 1500, Lysine: 580, Arginine: 2500 }
      }))
    },
    {
      name: 'Кешью',
      brand: 'Базовый продукт',
      calories: 553,
      protein: 18.2,
      fat: 43.9,
      carbs: 30.2,
      fiber: 3.3,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { E: 0.9, B1: 0.4, B6: 0.4, B9: 25 },
        minerals: { Magnesium: 292, Phosphorus: 593, Copper: 2.2, Zinc: 5.8, Iron: 6.7 },
        fattyAcids: { Omega6: 8, Omega9: 24, Cholesterol: 0 },
        carbohydrateTypes: { Fiber: 3.3 },
        aminoAcids: { Leucine: 1400, Lysine: 800, Arginine: 2100 }
      }))
    },
    {
      name: 'Фундук',
      brand: 'Базовый продукт',
      calories: 628,
      protein: 15,
      fat: 60.8,
      carbs: 16.7,
      fiber: 9.7,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { E: 15, B1: 0.6, B6: 0.6, B9: 113 },
        minerals: { Magnesium: 163, Calcium: 114, Manganese: 6.2, Copper: 1.7 },
        fattyAcids: { Omega6: 8, Omega9: 46, Cholesterol: 0 },
        carbohydrateTypes: { Fiber: 9.7 },
        aminoAcids: { Leucine: 1100, Lysine: 460, Arginine: 2200 }
      }))
    },
    {
      name: 'Арахис',
      brand: 'Базовый продукт',
      calories: 567,
      protein: 25.8,
      fat: 49.2,
      carbs: 16.1,
      fiber: 8.5,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { E: 8.3, B3: 12.1, B9: 240, B1: 0.6 },
        minerals: { Magnesium: 168, Phosphorus: 376, Manganese: 1.9, Zinc: 3.3 },
        fattyAcids: { Omega6: 15.5, Omega9: 24, Cholesterol: 0 },
        carbohydrateTypes: { Fiber: 8.5 },
        aminoAcids: { Leucine: 1700, Lysine: 930, Arginine: 3100 }
      }))
    },
    {
      name: 'Семечки подсолнечника',
      brand: 'Базовый продукт',
      calories: 584,
      protein: 20.7,
      fat: 51.5,
      carbs: 20,
      fiber: 8.6,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { E: 35, B1: 1.5, B6: 1.3, B9: 227 },
        minerals: { Magnesium: 325, Phosphorus: 660, Selenium: 53, Zinc: 5 },
        fattyAcids: { Omega6: 23, Omega9: 19, Cholesterol: 0 },
        carbohydrateTypes: { Fiber: 8.6 },
        aminoAcids: { Leucine: 1300, Lysine: 760, Arginine: 1700 }
      }))
    },
    {
      name: 'Семена тыквы',
      brand: 'Базовый продукт',
      calories: 559,
      protein: 30.2,
      fat: 49,
      carbs: 10.7,
      fiber: 6,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { E: 0.6, B1: 0.3, B9: 58 },
        minerals: { Magnesium: 592, Phosphorus: 1233, Zinc: 7.8, Iron: 8.8 },
        fattyAcids: { Omega6: 20, Omega9: 16, Cholesterol: 0 },
        carbohydrateTypes: { Fiber: 6 },
        aminoAcids: { Leucine: 2100, Lysine: 1400, Arginine: 4200 }
      }))
    },
    {
      name: 'Кунжут',
      brand: 'Базовый продукт',
      calories: 573,
      protein: 17.7,
      fat: 49.7,
      carbs: 23.4,
      fiber: 11.8,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { E: 0.25, B1: 0.79, B6: 0.79, B9: 97 },
        minerals: { Calcium: 975, Iron: 14.6, Magnesium: 351, Zinc: 7.8 },
        fattyAcids: { Omega6: 21, Omega9: 18.8, Cholesterol: 0 },
        carbohydrateTypes: { Fiber: 11.8 },
        aminoAcids: { Leucine: 1350, Lysine: 590, Arginine: 2630 }
      }))
    },
    {
      name: 'Фисташки',
      brand: 'Базовый продукт',
      calories: 562,
      protein: 20.6,
      fat: 45.3,
      carbs: 27.2,
      fiber: 10.3,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { E: 2.3, B1: 0.87, B6: 1.7, B9: 51 },
        minerals: { Potassium: 1025, Magnesium: 121, Copper: 1.3 },
        fattyAcids: { Omega6: 13.5, Omega9: 23.3, Cholesterol: 0 },
        carbohydrateTypes: { Fiber: 10.3 },
        aminoAcids: { Leucine: 1600, Lysine: 1100, Arginine: 2100 }
      }))
    },
    {
      name: 'Оливковое масло',
      brand: 'Базовый продукт',
      calories: 884,
      protein: 0,
      fat: 100,
      carbs: 0,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { E: 14, K: 60 },
        fattyAcids: { Omega3: 0.8, Omega6: 9.8, Omega9: 73, Cholesterol: 0 }
      }))
    },
    {
      name: 'Сало',
      brand: 'Базовый продукт',
      calories: 797,
      protein: 1.4,
      fat: 89,
      carbs: 0,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { D: 0.5, E: 1.3 },
        minerals: { Selenium: 1.2 },
        fattyAcids: { Omega6: 9, Omega9: 38, TransFats: 0.5, Cholesterol: 95 }
      }))
    },
    {
      name: 'Перец черный молотый',
      brand: 'Базовый продукт',
      calories: 251,
      protein: 10.4,
      fat: 3.3,
      carbs: 64,
      fiber: 25.3,
      micronutrients: JSON.stringify(buildMicronutrients({
        minerals: { Potassium: 1259, Calcium: 437, Iron: 9.7, Manganese: 5.6 },
        carbohydrateTypes: { Fiber: 25.3 }
      }))
    },
    {
      name: 'Паприка',
      brand: 'Базовый продукт',
      calories: 282,
      protein: 14.1,
      fat: 13,
      carbs: 54,
      fiber: 35,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { A: 2342, E: 30, BetaCarotene: 27431 },
        minerals: { Iron: 21.1, Potassium: 2280 },
        carbohydrateTypes: { Fiber: 35 }
      }))
    },
    {
      name: 'Куркума',
      brand: 'Базовый продукт',
      calories: 312,
      protein: 9.7,
      fat: 3.3,
      carbs: 67,
      fiber: 22.7,
      micronutrients: JSON.stringify(buildMicronutrients({
        minerals: { Iron: 41.4, Potassium: 2080, Manganese: 19.8 },
        carbohydrateTypes: { Fiber: 22.7 }
      }))
    },
    {
      name: 'Имбирь',
      brand: 'Базовый продукт',
      calories: 80,
      protein: 1.8,
      fat: 0.8,
      carbs: 15.8,
      fiber: 2,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 5, B6: 0.16 },
        minerals: { Potassium: 415, Magnesium: 43, Manganese: 0.23 },
        carbohydrateTypes: { Fiber: 2 }
      }))
    },
    {
      name: 'Лавровый лист',
      brand: 'Базовый продукт',
      calories: 313,
      protein: 7.6,
      fat: 8.4,
      carbs: 75,
      fiber: 26.3,
      micronutrients: JSON.stringify(buildMicronutrients({
        minerals: { Calcium: 834, Iron: 43, Potassium: 529 },
        carbohydrateTypes: { Fiber: 26.3 }
      }))
    },
    {
      name: 'Горчица',
      brand: 'Базовый продукт',
      calories: 162,
      protein: 5.8,
      fat: 9,
      carbs: 13,
      fiber: 3,
      micronutrients: JSON.stringify(buildMicronutrients({
        minerals: { Sodium: 1100, Potassium: 130 },
        carbohydrateTypes: { Fiber: 3 }
      }))
    },
    {
      name: 'Томатная паста',
      brand: 'Базовый продукт',
      calories: 82,
      protein: 4.3,
      fat: 0.5,
      carbs: 18.9,
      fiber: 4.3,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 22, A: 95, BetaCarotene: 1146 },
        minerals: { Potassium: 1014, Iron: 2.7 },
        carbohydrateTypes: { Glucose: 5, Fructose: 5.3, Fiber: 4.3 }
      }))
    },
    {
      name: 'Варенье',
      brand: 'Базовый продукт',
      calories: 271,
      protein: 0.3,
      fat: 0.2,
      carbs: 68,
      fiber: 1,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 5 },
        carbohydrateTypes: { Glucose: 25, Fructose: 25, Sucrose: 18, Fiber: 1 }
      }))
    },
    {
      name: 'Шоколад тёмный',
      brand: 'Базовый продукт',
      calories: 546,
      protein: 4.9,
      fat: 31,
      carbs: 61,
      fiber: 7,
      micronutrients: JSON.stringify(buildMicronutrients({
        minerals: { Magnesium: 146, Iron: 6.3, Copper: 0.7, Potassium: 559 },
        fattyAcids: { Omega6: 1, Omega9: 9.5, TransFats: 0.2, Cholesterol: 5 },
        carbohydrateTypes: { Sucrose: 40, Fiber: 7 }
      }))
    },
    {
      name: 'Шоколад молочный',
      brand: 'Базовый продукт',
      calories: 534,
      protein: 7.7,
      fat: 29.7,
      carbs: 59.4,
      fiber: 3.4,
      micronutrients: JSON.stringify(buildMicronutrients({
        minerals: { Calcium: 189, Magnesium: 63, Potassium: 372 },
        fattyAcids: { Omega6: 1, Omega9: 9, TransFats: 0.3, Cholesterol: 20 },
        carbohydrateTypes: { Sucrose: 51, Lactose: 6, Fiber: 3.4 }
      }))
    },
    {
      name: 'Печенье овсяное',
      brand: 'Базовый продукт',
      calories: 437,
      protein: 6.5,
      fat: 18,
      carbs: 64,
      fiber: 3.4,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B1: 0.1, B3: 1.3 },
        minerals: { Calcium: 50, Iron: 2, Phosphorus: 110 },
        fattyAcids: { TransFats: 1, Cholesterol: 15 },
        carbohydrateTypes: { Starch: 40, Sucrose: 20, Fiber: 3.4 }
      }))
    },
    {
      name: 'Мороженое сливочное',
      brand: 'Базовый продукт',
      calories: 207,
      protein: 3.5,
      fat: 11,
      carbs: 23.6,
      fiber: 0.5,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { A: 130, B2: 0.2 },
        minerals: { Calcium: 128, Phosphorus: 110, Potassium: 190 },
        fattyAcids: { Cholesterol: 44 },
        carbohydrateTypes: { Sucrose: 18, Lactose: 5, Fiber: 0.5 }
      }))
    },
    {
      name: 'Сахар коричневый',
      brand: 'Базовый продукт',
      calories: 380,
      protein: 0,
      fat: 0,
      carbs: 98,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        minerals: { Calcium: 85, Potassium: 346, Iron: 1.9 },
        carbohydrateTypes: { Sucrose: 97 }
      }))
    },
    {
      name: 'Хлеб ржаной',
      brand: 'Базовый продукт',
      calories: 220,
      protein: 6.6,
      fat: 1.2,
      carbs: 40.7,
      fiber: 5.8,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B1: 0.18, B2: 0.08, B3: 1.3 },
        minerals: { Sodium: 430, Phosphorus: 158, Magnesium: 47, Iron: 2.8 },
        carbohydrateTypes: { Starch: 33, Fiber: 5.8 }
      }))
    },
    {
      name: 'Батон',
      brand: 'Базовый продукт',
      calories: 262,
      protein: 7.5,
      fat: 2.9,
      carbs: 50.6,
      fiber: 2,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B1: 0.16, B2: 0.09, B3: 1.6 },
        minerals: { Sodium: 420, Phosphorus: 90, Calcium: 25 },
        carbohydrateTypes: { Starch: 45, Fiber: 2 }
      }))
    },
    {
      name: 'Лаваш',
      brand: 'Базовый продукт',
      calories: 277,
      protein: 9,
      fat: 1,
      carbs: 56,
      fiber: 2.5,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B1: 0.2, B3: 2 },
        minerals: { Sodium: 540, Phosphorus: 95 },
        carbohydrateTypes: { Starch: 50, Fiber: 2.5 }
      }))
    },
    {
      name: 'Сок апельсиновый',
      brand: 'Базовый продукт',
      calories: 45,
      protein: 0.7,
      fat: 0.2,
      carbs: 10.4,
      fiber: 0.2,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 40, B9: 18 },
        minerals: { Potassium: 200 },
        carbohydrateTypes: { Glucose: 2.3, Fructose: 2.4, Sucrose: 4.5, Fiber: 0.2 }
      }))
    },
    {
      name: 'Какао на молоке',
      brand: 'Базовый продукт',
      calories: 80,
      protein: 3.2,
      fat: 3.5,
      carbs: 9.5,
      fiber: 0.5,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B2: 0.15, A: 25 },
        minerals: { Magnesium: 22, Calcium: 110, Iron: 0.5 },
        carbohydrateTypes: { Sucrose: 7, Lactose: 2, Fiber: 0.5 }
      }))
    },
    {
      name: 'Тесто для пирога готовое',
      brand: 'Базовый продукт',
      calories: 310,
      protein: 7.5,
      fat: 12,
      carbs: 43,
      fiber: 1.5,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B1: 0.15, E: 1.2 },
        minerals: { Potassium: 100, Phosphorus: 70, Iron: 1 },
        carbohydrateTypes: { Starch: 40, Fiber: 1.5 }
      }))
    },
    {
      name: 'Тесто слоёное готовое',
      brand: 'Базовый продукт',
      calories: 350,
      protein: 6,
      fat: 20,
      carbs: 38,
      fiber: 1.2,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { E: 2 },
        minerals: { Potassium: 90, Phosphorus: 60 },
        fattyAcids: { TransFats: 1.5 },
        carbohydrateTypes: { Starch: 36, Fiber: 1.2 }
      }))
    },
    {
      name: 'Тесто дрожжевое готовое',
      brand: 'Базовый продукт',
      calories: 260,
      protein: 7.8,
      fat: 4.5,
      carbs: 48,
      fiber: 1.8,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B1: 0.2, B2: 0.1 },
        minerals: { Potassium: 110, Phosphorus: 80, Iron: 1.3 },
        carbohydrateTypes: { Starch: 45, Fiber: 1.8 }
      }))
    },
    {
      name: 'Тесто песочное готовое',
      brand: 'Базовый продукт',
      calories: 430,
      protein: 6.5,
      fat: 22,
      carbs: 52,
      fiber: 1,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { E: 2.2, A: 30 },
        minerals: { Potassium: 80, Calcium: 30 },
        carbohydrateTypes: { Starch: 48, Sucrose: 3, Fiber: 1 }
      }))
    },
    {
      name: 'Пельмени',
      brand: 'Базовый продукт',
      calories: 220,
      protein: 11,
      fat: 9,
      carbs: 24,
      fiber: 1,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B1: 0.15, B12: 1 },
        minerals: { Iron: 1.5, Zinc: 1.8, Phosphorus: 110 },
        carbohydrateTypes: { Starch: 22, Fiber: 1 }
      }))
    },
    {
      name: 'Вареники',
      brand: 'Базовый продукт',
      calories: 195,
      protein: 7,
      fat: 4,
      carbs: 34,
      fiber: 1.5,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B1: 0.12 },
        minerals: { Potassium: 150, Phosphorus: 70 },
        carbohydrateTypes: { Starch: 30, Fiber: 1.5 }
      }))
    },
    {
      name: 'Блины готовые',
      brand: 'Базовый продукт',
      calories: 235,
      protein: 6.5,
      fat: 9,
      carbs: 31,
      fiber: 0.8,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B2: 0.15, A: 60 },
        minerals: { Calcium: 70, Phosphorus: 100 },
        carbohydrateTypes: { Starch: 27, Lactose: 2, Fiber: 0.8 }
      }))
    },
    {
      name: 'Минтай',
      brand: 'Базовый продукт',
      calories: 72,
      protein: 15.9,
      fat: 0.9,
      carbs: 0,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B12: 3.6, D: 1.2 },
        minerals: { Phosphorus: 240, Selenium: 32, Iodine: 110 },
        fattyAcids: { Omega3: 0.4 }
      }))
    },
    {
      name: 'Хек',
      brand: 'Базовый продукт',
      calories: 86,
      protein: 16.6,
      fat: 2.2,
      carbs: 0,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B12: 1.6, B3: 2.5 },
        minerals: { Phosphorus: 220, Potassium: 330 },
        fattyAcids: { Omega3: 0.5 }
      }))
    },
    {
      name: 'Морской окунь',
      brand: 'Базовый продукт',
      calories: 103,
      protein: 18.2,
      fat: 3.3,
      carbs: 0,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B12: 2.4, D: 2 },
        minerals: { Phosphorus: 210, Selenium: 36 },
        fattyAcids: { Omega3: 0.6 }
      }))
    },
    {
      name: 'Дорадо',
      brand: 'Базовый продукт',
      calories: 96,
      protein: 18,
      fat: 2,
      carbs: 0,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B12: 2, D: 3 },
        minerals: { Phosphorus: 200, Potassium: 350 },
        fattyAcids: { Omega3: 0.5 }
      }))
    },
    {
      name: 'Утка',
      brand: 'Базовый продукт',
      calories: 308,
      protein: 16,
      fat: 28,
      carbs: 0,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B3: 4.5, B12: 0.4 },
        minerals: { Iron: 2.7, Zinc: 1.9, Phosphorus: 200 },
        fattyAcids: { Omega6: 3.5, Cholesterol: 76 }
      }))
    },
    {
      name: 'Кролик',
      brand: 'Базовый продукт',
      calories: 156,
      protein: 21,
      fat: 7.7,
      carbs: 0,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B12: 4.3, B3: 11.6 },
        minerals: { Iron: 3.3, Phosphorus: 190, Potassium: 335 }
      }))
    },
    {
      name: 'Сыр фета',
      brand: 'Базовый продукт',
      calories: 264,
      protein: 14,
      fat: 21,
      carbs: 4,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B2: 0.24, A: 120 },
        minerals: { Calcium: 490, Sodium: 920, Phosphorus: 340 },
        carbohydrateTypes: { Lactose: 4 }
      }))
    },
    {
      name: 'Сыр пармезан',
      brand: 'Базовый продукт',
      calories: 392,
      protein: 33,
      fat: 28,
      carbs: 3.2,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B2: 0.3, A: 270 },
        minerals: { Calcium: 1180, Phosphorus: 700, Sodium: 1530 },
        carbohydrateTypes: { Lactose: 3.2 }
      }))
    },
    {
      name: 'Сливочный сыр',
      brand: 'Базовый продукт',
      calories: 342,
      protein: 6,
      fat: 34,
      carbs: 4,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { A: 308, B2: 0.15 },
        minerals: { Calcium: 100, Phosphorus: 100 },
        carbohydrateTypes: { Lactose: 4 }
      }))
    },
    {
      name: 'Маскарпоне',
      brand: 'Базовый продукт',
      calories: 412,
      protein: 4.8,
      fat: 42,
      carbs: 4.8,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { A: 350, B2: 0.13 },
        minerals: { Calcium: 90, Phosphorus: 90 },
        carbohydrateTypes: { Lactose: 4.8 }
      }))
    },
    {
      name: 'Творог обезжиренный',
      brand: 'Базовый продукт',
      calories: 71,
      protein: 18,
      fat: 0.6,
      carbs: 1.8,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B2: 0.21, B12: 1 },
        minerals: { Calcium: 120, Phosphorus: 220 },
        carbohydrateTypes: { Lactose: 1.8 }
      }))
    },
    {
      name: 'Сельдерей',
      brand: 'Базовый продукт',
      calories: 16,
      protein: 0.9,
      fat: 0.1,
      carbs: 2.1,
      fiber: 1.6,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 8, K: 29, B9: 36 },
        minerals: { Potassium: 260, Sodium: 80 },
        carbohydrateTypes: { Fiber: 1.6 }
      }))
    },
    {
      name: 'Спаржа',
      brand: 'Базовый продукт',
      calories: 20,
      protein: 2.2,
      fat: 0.1,
      carbs: 3.1,
      fiber: 2.1,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { K: 41, C: 5.6, B9: 52 },
        minerals: { Potassium: 202, Phosphorus: 52 },
        carbohydrateTypes: { Fiber: 2.1 }
      }))
    },
    {
      name: 'Цукини',
      brand: 'Базовый продукт',
      calories: 24,
      protein: 1.2,
      fat: 0.3,
      carbs: 4.6,
      fiber: 1,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 17, B6: 0.16, B9: 24 },
        minerals: { Potassium: 261, Magnesium: 18 },
        carbohydrateTypes: { Glucose: 1.4, Fructose: 1.2, Fiber: 1 }
      }))
    },
    {
      name: 'Перец чили',
      brand: 'Базовый продукт',
      calories: 40,
      protein: 1.9,
      fat: 0.4,
      carbs: 8.8,
      fiber: 1.5,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 144, A: 48, B6: 0.5 },
        minerals: { Potassium: 322, Magnesium: 23 },
        carbohydrateTypes: { Fiber: 1.5 }
      }))
    },
    {
      name: 'Квашеная капуста',
      brand: 'Базовый продукт',
      calories: 19,
      protein: 0.9,
      fat: 0.1,
      carbs: 3,
      fiber: 2.2,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 15, K: 13 },
        minerals: { Sodium: 660, Potassium: 170 },
        carbohydrateTypes: { Fiber: 2.2 }
      }))
    },
    {
      name: 'Маринованный огурец',
      brand: 'Базовый продукт',
      calories: 16,
      protein: 0.7,
      fat: 0.1,
      carbs: 2.5,
      fiber: 1,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 4, K: 8 },
        minerals: { Sodium: 800, Potassium: 130 },
        carbohydrateTypes: { Fiber: 1 }
      }))
    },
    {
      name: 'Ананас',
      brand: 'Базовый продукт',
      calories: 50,
      protein: 0.5,
      fat: 0.1,
      carbs: 13,
      fiber: 1.4,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 48, B6: 0.1, B9: 18 },
        minerals: { Potassium: 109, Manganese: 0.9 },
        carbohydrateTypes: { Sucrose: 6, Glucose: 2, Fructose: 2, Fiber: 1.4 }
      }))
    },
    {
      name: 'Манго',
      brand: 'Базовый продукт',
      calories: 60,
      protein: 0.8,
      fat: 0.4,
      carbs: 15,
      fiber: 1.6,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 36, A: 54, B9: 43 },
        minerals: { Potassium: 168 },
        carbohydrateTypes: { Sucrose: 8, Glucose: 2, Fructose: 4, Fiber: 1.6 }
      }))
    },
    {
      name: 'Хурма',
      brand: 'Базовый продукт',
      calories: 67,
      protein: 0.6,
      fat: 0.3,
      carbs: 15.3,
      fiber: 2.5,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 7.5, A: 81, B6: 0.1 },
        minerals: { Potassium: 161, Manganese: 0.4 },
        carbohydrateTypes: { Glucose: 6, Fructose: 7, Fiber: 2.5 }
      }))
    },
    {
      name: 'Инжир',
      brand: 'Базовый продукт',
      calories: 74,
      protein: 0.8,
      fat: 0.3,
      carbs: 19.2,
      fiber: 2.9,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { K: 4.7, B6: 0.1 },
        minerals: { Potassium: 232, Calcium: 35 },
        carbohydrateTypes: { Glucose: 8, Fructose: 9, Fiber: 2.9 }
      }))
    },
    {
      name: 'Киноа отварная',
      brand: 'Базовый продукт',
      calories: 120,
      protein: 4.4,
      fat: 1.9,
      carbs: 21.3,
      fiber: 2.8,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B9: 42, B6: 0.1 },
        minerals: { Magnesium: 64, Iron: 1.5, Zinc: 1.1, Phosphorus: 152 },
        carbohydrateTypes: { Starch: 18, Fiber: 2.8 }
      }))
    },
    {
      name: 'Овсяные хлопья сырые',
      brand: 'Базовый продукт',
      calories: 366,
      protein: 12.3,
      fat: 6.9,
      carbs: 61.8,
      fiber: 6,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B1: 0.5, B5: 1.3, E: 1.1 },
        minerals: { Magnesium: 138, Phosphorus: 410, Iron: 4.7, Manganese: 4 },
        carbohydrateTypes: { Starch: 55, Fiber: 6 }
      }))
    },
    {
      name: 'Мюсли',
      brand: 'Базовый продукт',
      calories: 360,
      protein: 9,
      fat: 6,
      carbs: 68,
      fiber: 7,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B1: 0.4, E: 1.5 },
        minerals: { Magnesium: 100, Iron: 3 },
        carbohydrateTypes: { Starch: 40, Sucrose: 18, Fiber: 7 }
      }))
    },
    {
      name: 'Гречневая лапша соба',
      brand: 'Базовый продукт',
      calories: 99,
      protein: 5.1,
      fat: 0.1,
      carbs: 21,
      fiber: 1.5,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B1: 0.1, B2: 0.05 },
        minerals: { Magnesium: 38, Phosphorus: 90 },
        carbohydrateTypes: { Starch: 19, Fiber: 1.5 }
      }))
    },
    {
      name: 'Рисовая лапша',
      brand: 'Базовый продукт',
      calories: 109,
      protein: 1.8,
      fat: 0.2,
      carbs: 25,
      fiber: 0.9,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B1: 0.03 },
        minerals: { Phosphorus: 30, Potassium: 30 },
        carbohydrateTypes: { Starch: 24, Fiber: 0.9 }
      }))
    },
    {
      name: 'Тортилья пшеничная',
      brand: 'Базовый продукт',
      calories: 290,
      protein: 8,
      fat: 7,
      carbs: 48,
      fiber: 2.5,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B1: 0.2, B3: 1.8 },
        minerals: { Calcium: 60, Iron: 1.5 },
        carbohydrateTypes: { Starch: 44, Fiber: 2.5 }
      }))
    },
    {
      name: 'Сдобная булочка',
      brand: 'Базовый продукт',
      calories: 300,
      protein: 7.5,
      fat: 6.5,
      carbs: 54,
      fiber: 1.5,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B1: 0.2, B2: 0.1 },
        minerals: { Calcium: 30, Iron: 1.2 },
        carbohydrateTypes: { Starch: 44, Sucrose: 8, Fiber: 1.5 }
      }))
    },
    {
      name: 'Круассан',
      brand: 'Базовый продукт',
      calories: 406,
      protein: 8.2,
      fat: 21,
      carbs: 46,
      fiber: 1.6,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { A: 130, E: 2 },
        minerals: { Calcium: 40, Iron: 1.5 },
        fattyAcids: { TransFats: 1 },
        carbohydrateTypes: { Starch: 38, Sucrose: 6, Fiber: 1.6 }
      }))
    },
    {
      name: 'Соус терияки',
      brand: 'Базовый продукт',
      calories: 89,
      protein: 5.9,
      fat: 0,
      carbs: 16,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        minerals: { Sodium: 3500, Potassium: 180 },
        carbohydrateTypes: { Sucrose: 14, Fiber: 0 }
      }))
    },
    {
      name: 'Соус барбекю',
      brand: 'Базовый продукт',
      calories: 172,
      protein: 1.2,
      fat: 0.6,
      carbs: 39,
      fiber: 0.6,
      micronutrients: JSON.stringify(buildMicronutrients({
        minerals: { Sodium: 1000, Potassium: 240 },
        carbohydrateTypes: { Sucrose: 30, Fiber: 0.6 }
      }))
    },
    {
      name: 'Бальзамический уксус',
      brand: 'Базовый продукт',
      calories: 88,
      protein: 0.5,
      fat: 0,
      carbs: 17,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        minerals: { Potassium: 112, Calcium: 27 },
        carbohydrateTypes: { Sucrose: 15 }
      }))
    },
    {
      name: 'Песто',
      brand: 'Базовый продукт',
      calories: 303,
      protein: 4.5,
      fat: 30,
      carbs: 4.5,
      fiber: 1.2,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { E: 5, A: 140 },
        minerals: { Calcium: 130, Phosphorus: 100 },
        fattyAcids: { Omega9: 18 }
      }))
    },
    {
      name: 'Хумус',
      brand: 'Базовый продукт',
      calories: 166,
      protein: 7.9,
      fat: 9.6,
      carbs: 14.3,
      fiber: 6,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B9: 49, B6: 0.14 },
        minerals: { Iron: 1.9, Magnesium: 39, Phosphorus: 146 },
        carbohydrateTypes: { Starch: 8, Fiber: 6 }
      }))
    },
    {
      name: 'Тахини',
      brand: 'Базовый продукт',
      calories: 595,
      protein: 17,
      fat: 53,
      carbs: 21,
      fiber: 9,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B1: 0.5, E: 2 },
        minerals: { Calcium: 420, Iron: 9, Magnesium: 95 },
        carbohydrateTypes: { Fiber: 9 }
      }))
    },
    {
      name: 'Кокосовое молоко',
      brand: 'Базовый продукт',
      calories: 230,
      protein: 2.3,
      fat: 24,
      carbs: 5.5,
      fiber: 2.2,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 2.8, B9: 16 },
        minerals: { Potassium: 263, Magnesium: 37 },
        fattyAcids: { Omega9: 1.4 },
        carbohydrateTypes: { Fiber: 2.2 }
      }))
    },
    {
      name: 'Кокосовая стружка',
      brand: 'Базовый продукт',
      calories: 660,
      protein: 6.9,
      fat: 64.5,
      carbs: 23,
      fiber: 16,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { E: 0.5 },
        minerals: { Iron: 3.3, Magnesium: 90 },
        carbohydrateTypes: { Fiber: 16 }
      }))
    },
    {
      name: 'Тофу',
      brand: 'Базовый продукт',
      calories: 76,
      protein: 8,
      fat: 4.8,
      carbs: 1.9,
      fiber: 0.3,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B1: 0.16 },
        minerals: { Calcium: 350, Iron: 5.4, Magnesium: 30 },
        carbohydrateTypes: { Fiber: 0.3 }
      }))
    },
    {
      name: 'Горох сухой',
      brand: 'Базовый продукт',
      calories: 298,
      protein: 20.5,
      fat: 1.6,
      carbs: 49.5,
      fiber: 11.2,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B1: 0.81, B9: 274 },
        minerals: { Iron: 4.7, Magnesium: 33, Potassium: 990 },
        carbohydrateTypes: { Starch: 35, Fiber: 11.2 }
      }))
    },
    {
      name: 'Маш отварной',
      brand: 'Базовый продукт',
      calories: 105,
      protein: 7,
      fat: 0.4,
      carbs: 19,
      fiber: 7.6,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { B9: 159, B1: 0.16 },
        minerals: { Iron: 1.4, Magnesium: 48, Potassium: 266 },
        carbohydrateTypes: { Starch: 11, Fiber: 7.6 }
      }))
    },
    {
      name: 'Яйцо перепелиное',
      brand: 'Базовый продукт',
      calories: 158,
      protein: 11.9,
      fat: 13.1,
      carbs: 0.6,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { A: 480, B12: 1.6, B2: 0.65 },
        minerals: { Iron: 3.7, Phosphorus: 218, Selenium: 32 },
        fattyAcids: { Cholesterol: 844 }
      }))
    },
    {
      name: 'Чай чёрный',
      brand: 'Базовый продукт',
      calories: 1,
      protein: 0,
      fat: 0,
      carbs: 0.3,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        minerals: { Manganese: 0.3, Potassium: 9 }
      }))
    },
    {
      name: 'Кофе чёрный',
      brand: 'Базовый продукт',
      calories: 2,
      protein: 0.1,
      fat: 0,
      carbs: 0,
      fiber: 0,
      micronutrients: JSON.stringify(buildMicronutrients({
        minerals: { Potassium: 49, Magnesium: 2 }
      }))
    },
    {
      name: 'Компот',
      brand: 'Базовый продукт',
      calories: 60,
      protein: 0.2,
      fat: 0,
      carbs: 15,
      fiber: 0.3,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 8 },
        minerals: { Potassium: 90 },
        carbohydrateTypes: { Sucrose: 12, Fiber: 0.3 }
      }))
    },
    {
      name: 'Морс',
      brand: 'Базовый продукт',
      calories: 48,
      protein: 0.1,
      fat: 0,
      carbs: 12,
      fiber: 0.1,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { C: 10 },
        minerals: { Potassium: 60 },
        carbohydrateTypes: { Fructose: 6, Glucose: 5, Fiber: 0.1 }
      }))
    },
    {
      name: 'Халва',
      brand: 'Базовый продукт',
      calories: 510,
      protein: 11.6,
      fat: 29.7,
      carbs: 54,
      fiber: 4,
      micronutrients: JSON.stringify(buildMicronutrients({
        vitamins: { E: 7, B1: 0.8 },
        minerals: { Calcium: 200, Iron: 6, Magnesium: 150 },
        carbohydrateTypes: { Sucrose: 48, Fiber: 4 }
      }))
    },
    {
      name: 'Зефир',
      brand: 'Базовый продукт',
      calories: 304,
      protein: 0.8,
      fat: 0.1,
      carbs: 78.3,
      fiber: 0.5,
      micronutrients: JSON.stringify(buildMicronutrients({
        minerals: { Calcium: 5, Iron: 0.2 },
        carbohydrateTypes: { Sucrose: 70, Fiber: 0.5 }
      }))
    },
    {
      name: 'Мармелад',
      brand: 'Базовый продукт',
      calories: 296,
      protein: 0.4,
      fat: 0.1,
      carbs: 73,
      fiber: 0.5,
      micronutrients: JSON.stringify(buildMicronutrients({
        minerals: { Calcium: 10, Iron: 0.4 },
        carbohydrateTypes: { Sucrose: 65, Fiber: 0.5 }
      }))
    },
  ];

  for (const product of products) {
    try {
      // Хешируем полную строку (а не обрезаем raw base64 первой пары имени-бренда) —
      // иначе продукты с общим префиксом (напр. "Куриное филе"/"Куриное бедро") получали
      // одинаковый barcode, ловили unique constraint violation и валили весь сидинг,
      // который гоняется при каждом старте сервера (см. scripts/start-server.mjs) —
      // т.е. одна коллизия клала весь деплой.
      const barcode = `seed-${createHash('sha256').update(`${product.name}-${product.brand}`).digest('base64url').slice(0, 20)}`;
      const existing = await prisma.product.findUnique({
        where: { name_brand: { name: product.name, brand: product.brand } },
        select: { micronutrients: true },
      });

      // Сидинг гоняется на каждом старте сервера (см. scripts/start-server.mjs), поэтому
      // микроэлементы нельзя слепо перезатирать — это стирало бы уже накопленные/уточнённые
      // значения каждым деплоем. Берём ненулевое значение по каждому нутриенту, отдавая
      // приоритет уже сохранённому в БД, и только подмешиваем то, чего там не было.
      const mergedMicronutrients = JSON.stringify(
        mergeMicronutrientsPreferExisting(parseMicronutrientsRaw(existing?.micronutrients), buildMicronutrientsFromJson(product.micronutrients))
      );

      await prisma.product.upsert({
        where: {
          name_brand: {
            name: product.name,
            brand: product.brand,
          },
        },
        update: {
          calories: product.calories,
          protein: product.protein,
          fat: product.fat,
          carbs: product.carbs,
          fiber: product.fiber,
          micronutrients: mergedMicronutrients,
        },
        create: {
          ...product,
          barcode,
        },
      });
    } catch (e) {
      // Одна проблемная запись не должна валить весь старт сервера (сидинг — не часть
      // пользовательского пути, но именно из-за того, что он гоняется на каждом деплое,
      // необработанная ошибка здесь раньше приводила к падению всего процесса).
      console.error(`[seed] Failed to upsert product "${product.name}" (${product.brand}):`, e);
    }
  }

  console.log('Seed completed!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
