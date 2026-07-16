import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { extractSeedProducts } from "../benchmarks/seed-products.ts";

describe("recognition benchmark expansion", () => {
  it("extracts only structured literal products from the Prisma seed", () => {
    const products = extractSeedProducts(readFileSync("prisma/seed.ts", "utf8"));
    expect(products.length).toBeGreaterThanOrEqual(190);
    expect(products.find((product) => product.name === "Куриная грудка")).toMatchObject({
      calories: 165,
      protein: 31,
      fat: 3.6,
      carbs: 0,
    });
    expect(products.every((product) => product.calories > 0)).toBe(true);
  });
});
