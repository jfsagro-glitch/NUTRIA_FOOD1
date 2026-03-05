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

function numberOrZero(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function parseMicronutrients(raw: string | null | undefined): any {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeLegacyKeys(input: any) {
  const normalized = {
    ...input,
    vitamins: { ...(input?.vitamins || {}) },
    minerals: { ...(input?.minerals || {}) },
    fattyAcids: { ...(input?.fattyAcids || {}) },
    carbohydrateTypes: { ...(input?.carbohydrateTypes || {}) },
    aminoAcids: { ...(input?.aminoAcids || {}) },
  };

  if (normalized.vitamins.B7 != null && normalized.vitamins.Biotin == null) {
    normalized.vitamins.Biotin = normalized.vitamins.B7;
  }

  if (normalized.aminoAcids.Cystine != null && normalized.aminoAcids.Cysteine == null) {
    normalized.aminoAcids.Cysteine = normalized.aminoAcids.Cystine;
  }

  if (normalized.carbohydrateTypes.Fibre != null && normalized.carbohydrateTypes.Fiber == null) {
    normalized.carbohydrateTypes.Fiber = normalized.carbohydrateTypes.Fibre;
  }

  return normalized;
}

function buildCompleteMicronutrients(raw: any, productFiber?: number | null): Micronutrients {
  const legacy = normalizeLegacyKeys(raw || {});

  const merged: Micronutrients = {
    vitamins: { ...MICRONUTRIENT_TEMPLATE.vitamins, ...(legacy.vitamins || {}) },
    minerals: { ...MICRONUTRIENT_TEMPLATE.minerals, ...(legacy.minerals || {}) },
    fattyAcids: { ...MICRONUTRIENT_TEMPLATE.fattyAcids, ...(legacy.fattyAcids || {}) },
    carbohydrateTypes: { ...MICRONUTRIENT_TEMPLATE.carbohydrateTypes, ...(legacy.carbohydrateTypes || {}) },
    aminoAcids: { ...MICRONUTRIENT_TEMPLATE.aminoAcids, ...(legacy.aminoAcids || {}) },
  };

  for (const [groupKey, group] of Object.entries(merged) as Array<[keyof Micronutrients, Record<string, any>]>) {
    for (const [key, value] of Object.entries(group)) {
      merged[groupKey][key] = numberOrZero(value);
    }
  }

  if (!merged.minerals.Salt && merged.minerals.Sodium > 0) {
    merged.minerals.Salt = merged.minerals.Sodium * 2.5;
  }

  if (!merged.carbohydrateTypes.Fiber && numberOrZero(productFiber) > 0) {
    merged.carbohydrateTypes.Fiber = numberOrZero(productFiber);
  }

  return merged;
}

async function main() {
  const products = await prisma.product.findMany({
    select: { id: true, name: true, fiber: true, micronutrients: true },
  });

  let updated = 0;

  for (const product of products) {
    const parsed = parseMicronutrients(product.micronutrients);
    const completed = buildCompleteMicronutrients(parsed, product.fiber);
    const nextValue = JSON.stringify(completed);

    if ((product.micronutrients || '') === nextValue) {
      continue;
    }

    await prisma.product.update({
      where: { id: product.id },
      data: { micronutrients: nextValue },
    });

    updated += 1;
  }

  console.log(`Backfill completed. Updated ${updated} of ${products.length} products.`);
}

main()
  .catch((e) => {
    console.error('Backfill failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
