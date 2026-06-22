import { PrismaClient } from '@prisma/client';

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
  ];

  for (const product of products) {
    const barcode = `seed-${Buffer.from(`${product.name}-${product.brand}`).toString('base64url').slice(0, 20)}`;
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
        micronutrients: product.micronutrients,
      },
      create: {
        ...product,
        barcode,
      },
    });
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
