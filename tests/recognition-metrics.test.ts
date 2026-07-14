import { describe, expect, it } from "vitest";
import { namesMatch, normalizeFoodName, scoreIngredients } from "../benchmarks/recognition-metrics.ts";

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
