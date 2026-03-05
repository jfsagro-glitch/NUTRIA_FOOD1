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
