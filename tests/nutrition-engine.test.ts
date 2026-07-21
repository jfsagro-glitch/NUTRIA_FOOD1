// Офлайн-регрессионная сеть для детерминированных частей движка разбора нутриентов.
// Не требует БД / сети / AI-ключей — гоняется в обычном `npm test` и в CI на каждый PR.
// Цель: зафиксировать поведение, к качеству которого команда не хочет возвращаться —
// стемминг (единственное/множественное), приоритет базового продукта, порог
// правдоподобия КБЖУ (класс «1295 ккал / 150 г»), полнота таблицы микроэлементов,
// маппинг USDA (в т.ч. B12), Атуотер/needsReview для данных из открытой базы.
import { describe, expect, it } from "vitest";
import {
  stemRussianToken,
  isBaseProductCandidate,
  validateNutritionPer100g,
  isLexicallyCompatibleFood,
  computeTextSimilarity,
  MICRONUTRIENT_TEMPLATE,
  buildCompleteMicronutrients,
  hasMissingKeyMicronutrients,
  extractUsdaExtendedNutrients,
  normalizeOpenFoodFactsProduct,
} from "../server.ts";

describe("русский стемминг (единственное ↔ множественное)", () => {
  it("сводит формы одного слова к общей основе", () => {
    expect(stemRussianToken("креветка")).toBe(stemRussianToken("креветки"));
    expect(stemRussianToken("креветка")).toBe("креветк");
    // короткие формы множественного числа (порог был 5 — «яйца»/«рыбы» не стеммились)
    expect(stemRussianToken("яйца")).toBe(stemRussianToken("яйцо"));
    expect(stemRussianToken("рыбы")).toBe(stemRussianToken("рыба"));
    // беглая гласная: огуре́ц → огурцы
    expect(stemRussianToken("огурец")).toBe(stemRussianToken("огурцы"));
  });

  it("не стеммит слишком короткие и нерусские токены", () => {
    expect(stemRussianToken("рис")).toBeNull(); // 3 символа
    expect(stemRussianToken("beef")).toBeNull(); // латиница
    expect(stemRussianToken("")).toBeNull();
  });
});

describe("определение базового/каноничного продукта", () => {
  it("базовый = без бренда фирмы, из каталога", () => {
    expect(isBaseProductCandidate({ brand: "Базовый продукт", source: "local" })).toBe(true);
    expect(isBaseProductCandidate({ brand: "", source: "catalog" })).toBe(true);
  });
  it("фирменный / внешний источник — не базовый", () => {
    expect(isBaseProductCandidate({ brand: "Мираторг", source: "local" })).toBe(false);
    expect(isBaseProductCandidate({ brand: "", source: "usda" })).toBe(false);
    expect(isBaseProductCandidate({ brand: "AI Nutria Engine", source: "ai" })).toBe(false);
  });
});

describe("проверка правдоподобия КБЖУ на 100 г", () => {
  it("нормальный продукт — правдоподобен", () => {
    const r = validateNutritionPer100g({ calories: 60, protein: 3.2, fat: 3.2, carbs: 4.7 });
    expect(r.plausible).toBe(true);
    expect(r.needsReview).toBe(false);
  });

  it("невозможная плотность калорий (> 9 ккал/г) помечается", () => {
    // класс бага «4 блинчика с творогом → 1295 ккал / 150 г» = 863 ккал/100 г при малых макросах
    const r = validateNutritionPer100g({ calories: 950, protein: 10, fat: 10, carbs: 10 });
    expect(r.needsReview).toBe(true);
    expect(r.reasons.join(" ")).toContain("kcal>9");
  });

  it("сумма Б+Ж+У > 100 г на 100 г помечается (класс «Хрустим»)", () => {
    const r = validateNutritionPer100g({ calories: 450, protein: 0, fat: 16, carbs: 94.7 });
    expect(r.needsReview).toBe(true);
    expect(r.reasons.join(" ")).toContain("macro-sum");
  });

  it("расхождение ккал с Атуотером даёт исправленное значение", () => {
    const r = validateNutritionPer100g({ calories: 200, protein: 11, fat: 14, carbs: 66 });
    expect(r.needsReview).toBe(true);
    expect(r.correctedCalories).toBe(11 * 4 + 66 * 4 + 14 * 9); // 434
  });

  it("полностью нулевой продукт помечается", () => {
    const r = validateNutritionPer100g({ calories: 0, protein: 0, fat: 0, carbs: 0 });
    expect(r.needsReview).toBe(true);
  });
});

describe("лексическая совместимость и конфликты категорий", () => {
  it("формы одного продукта совместимы", () => {
    expect(isLexicallyCompatibleFood("креветка", "Креветки")).toBe(true);
    expect(isLexicallyCompatibleFood("рис", "Рис отварной")).toBe(true);
  });
  it("конфликт категорий отсекается (рис ↔ мука) даже после стемминга", () => {
    expect(isLexicallyCompatibleFood("рис", "рисовая мука")).toBe(false);
  });
});

describe("текстовое сходство", () => {
  it("точное совпадение = 1", () => {
    expect(computeTextSimilarity("молоко", "молоко")).toBe(1);
  });
  it("формы числа близки за счёт стем-совпадения токенов", () => {
    expect(computeTextSimilarity("креветка", "креветки")).toBeGreaterThan(0.7);
  });
});

describe("полнота таблицы микроэлементов", () => {
  it("шаблон содержит полный набор групп", () => {
    expect(Object.keys(MICRONUTRIENT_TEMPLATE.vitamins).length).toBe(15);
    expect(Object.keys(MICRONUTRIENT_TEMPLATE.minerals).length).toBe(19);
  });
  it("buildCompleteMicronutrients дополняет все ключи нулями", () => {
    const m = buildCompleteMicronutrients({});
    expect(m.vitamins.B12).toBe(0);
    expect(m.minerals.Iron).toBe(0);
    expect(Object.keys(m.aminoAcids).length).toBeGreaterThan(0);
  });
  it("производные: Salt из Sodium, Fiber из клетчатки продукта", () => {
    expect(buildCompleteMicronutrients({ minerals: { Sodium: 100 } }).minerals.Salt).toBe(250);
    expect(buildCompleteMicronutrients({}, 5).carbohydrateTypes.Fiber).toBe(5);
  });
});

describe("детектор пробелов по ключевым нутриентам (баг B12 у молочки)", () => {
  it("витамины заполнены, но B12=0 → нужна докомплектация", () => {
    const dairy = buildCompleteMicronutrients({ vitamins: { A: 20, C: 1, B2: 0.3 }, minerals: { Calcium: 120 } });
    expect(hasMissingKeyMicronutrients(dairy)).toBe(true);
  });
  it("полностью пустой профиль не считается «пробелом по ключевым»", () => {
    expect(hasMissingKeyMicronutrients(buildCompleteMicronutrients({}))).toBe(false);
  });
});

describe("маппинг USDA → микроэлементы", () => {
  it("B12 (id 1178) корректно извлекается", () => {
    const food = { foodNutrients: [{ nutrientId: 1178, value: 0.9, unitName: "UG" }] };
    expect(extractUsdaExtendedNutrients(food).vitamins.B12).toBeGreaterThan(0);
  });
  it("нутриенты без id в USDA не заполняются (документируем пробел)", () => {
    const food = { foodNutrients: [{ nutrientId: 1178, value: 0.9, unitName: "UG" }] };
    // Silicon/Cobalt/Vanadium/Sulfur USDA не публикует — структурно не мапятся
    // (нет id), поэтому из USDA приходят пустыми (undefined), а шаблон позже ставит 0.
    expect(extractUsdaExtendedNutrients(food).minerals.Silicon || 0).toBe(0);
    expect(extractUsdaExtendedNutrients(food).minerals.Cobalt || 0).toBe(0);
    // после дополнения шаблоном — гарантированно 0 (ключ существует):
    const complete = buildCompleteMicronutrients(extractUsdaExtendedNutrients(food));
    expect(complete.minerals.Silicon).toBe(0);
    expect(complete.vitamins.B12).toBeGreaterThan(0);
  });
});

describe("OpenFoodFacts: Атуотер, kJ→kcal, needsReview", () => {
  it("калорийность из кДж, если ккал не заданы", () => {
    const p = normalizeOpenFoodFactsProduct(
      { nutriments: { proteins_100g: 5, fat_100g: 2, carbohydrates_100g: 20, "energy-kj_100g": 500 } },
      "111",
    );
    expect(p.calories).toBe(Math.round(500 / 4.184)); // 120
    expect(p.needsReview).toBe(false);
  });
  it("невозможные макросы (У 94.7 при Ж 16) → needsReview", () => {
    const p = normalizeOpenFoodFactsProduct(
      { nutriments: { proteins_100g: 0, fat_100g: 16, carbohydrates_100g: 94.7, "energy-kcal_100g": 450 } },
      "222",
    );
    expect(p.needsReview).toBe(true);
  });
});
