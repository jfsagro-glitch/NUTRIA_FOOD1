import { describe, expect, it } from "vitest";
import {
  hasNutrientGroup,
  namesMatch,
  normalizeFoodName,
  rangeRelativeError,
  scoreIngredients,
} from "../benchmarks/recognition-metrics.ts";

describe("recognition benchmark metrics", () => {
  it("normalizes Russian food names without hiding semantic mismatches", () => {
    expect(normalizeFoodName("  Куриное филе (гриль) ")).toBe("куриное филе гриль");
    expect(namesMatch("Яйцо куриное", ["яйцо"])).toBe(true);
    expect(namesMatch("Греческий салат", ["салат оливье"])).toBe(false);
  });

  it("scores ingredient recall, precision and weight independently", () => {
    const score = scoreIngredients(
      [
        { aliases: ["куриное филе"], minGrams: 170, maxGrams: 190 },
        { aliases: ["рис"], minGrams: 140, maxGrams: 160 },
      ],
      [
        { name: "Куриное филе", amount: 180 },
        { name: "Рис белый", amount: 220 },
        { name: "Масло", amount: 10 },
      ],
    );

    expect(score.recall).toBe(1);
    expect(score.precision).toBeCloseTo(2 / 3);
    expect(score.weightRangeAccuracy).toBe(0.5);
  });
});

describe("nutrition accuracy metrics", () => {
  it("measures only the error outside an accepted range", () => {
    expect(rangeRelativeError(150, { min: 140, max: 160 })).toBe(0);
    expect(rangeRelativeError(120, { min: 140, max: 160 })).toBeCloseTo(20 / 150);
    expect(rangeRelativeError(1000, { min: 140, max: 160 })).toBe(1);
  });

  it("detects populated nutrient groups from values or provenance", () => {
    expect(hasNutrientGroup({ micronutrients: JSON.stringify({ vitamins: { B1: 0.5 } }) }, "vitamins")).toBe(true);
    expect(hasNutrientGroup({ nutrientSources: { aminoAcids: "usda_fdc" } }, "aminoAcids")).toBe(true);
    expect(hasNutrientGroup({ micronutrients: "{}" }, "minerals")).toBe(false);
  });
});
