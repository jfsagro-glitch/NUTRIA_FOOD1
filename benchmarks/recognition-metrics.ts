export type ExpectedIngredient = {
  aliases: string[];
  minGrams: number;
  maxGrams: number;
};

export type ActualIngredient = {
  name: string;
  amount: number;
};

export type IngredientScore = {
  matched: number;
  expected: number;
  actual: number;
  inWeightRange: number;
  recall: number;
  precision: number;
  weightRangeAccuracy: number;
};

export function normalizeFoodName(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9%]+/gi, " ")
    .trim();
}

export function namesMatch(actual: string, aliases: string[]): boolean {
  const normalizedActual = normalizeFoodName(actual);
  return aliases.some((alias) => {
    const normalizedAlias = normalizeFoodName(alias);
    return normalizedActual === normalizedAlias
      || normalizedActual.includes(normalizedAlias)
      || normalizedAlias.includes(normalizedActual);
  });
}

export function scoreIngredients(expected: ExpectedIngredient[], actual: ActualIngredient[]): IngredientScore {
  const used = new Set<number>();
  let matched = 0;
  let inWeightRange = 0;

  for (const target of expected) {
    const index = actual.findIndex((item, itemIndex) => !used.has(itemIndex) && namesMatch(item.name, target.aliases));
    if (index < 0) continue;
    used.add(index);
    matched += 1;
    const amount = Number(actual[index].amount || 0);
    if (amount >= target.minGrams && amount <= target.maxGrams) inWeightRange += 1;
  }

  return {
    matched,
    expected: expected.length,
    actual: actual.length,
    inWeightRange,
    recall: expected.length ? matched / expected.length : 1,
    precision: actual.length ? matched / actual.length : expected.length ? 0 : 1,
    weightRangeAccuracy: matched ? inWeightRange / matched : 0,
  };
}
