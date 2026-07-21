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
  unwrapAiItemsArray,
  buildDishEstimateProduct,
  restoreExactCatalogMatch,
  micronutrientSchemaHint,
  dedupeSearchCandidatesByName,
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

describe("разворачивание массива из AI-ответа (json_object-фоллбэк)", () => {
  it("голый массив возвращается как есть", () => {
    expect(unwrapAiItemsArray([2, 0, 1])).toEqual([2, 0, 1]);
  });
  it("объект-обёртка реранка {indices|order|ranking} разворачивается", () => {
    // OpenAI/DeepSeek с response_format:json_object не отдают top-level массив —
    // реранк обязан присылать {"indices":[...]}, иначе порядок кандидатов терялся.
    expect(unwrapAiItemsArray({ indices: [2, 0, 1] })).toEqual([2, 0, 1]);
    expect(unwrapAiItemsArray({ order: [1, 0] })).toEqual([1, 0]);
    expect(unwrapAiItemsArray({ ranking: [0, 2, 1] })).toEqual([0, 2, 1]);
    expect(unwrapAiItemsArray({ items: ["a", "b"] })).toEqual(["a", "b"]);
  });
  it("мусор без массива → пустой список (безопасный фоллбэк)", () => {
    expect(unwrapAiItemsArray(null)).toEqual([]);
    expect(unwrapAiItemsArray({ foo: 1 })).toEqual([]);
    expect(unwrapAiItemsArray("строка")).toEqual([]);
  });
});

describe("оценка блюда по фото: невозможная плотность порции", () => {
  it("«вся порция» числом с невозможной плотностью → needsReview + коррекция по Атуотеру", () => {
    // Класс бага «1295 ккал / 150 г»: AI отдаёт калорийность всей порции, деление
    // на факторе даёт физически невозможную плотность (> 9 ккал/г).
    const p = buildDishEstimateProduct({
      name: "блины",
      amount: 150,
      totalCalories: 1500,
      totalProtein: 15,
      totalFat: 10,
      totalCarbs: 20,
    });
    expect(p).not.toBeNull();
    expect(p!.needsReview).toBe(true);
    // protein 10, carbs 13.33, fat 6.67 на 100 г → Атуотер ≈ 153 ккал
    expect(p!.calories).toBe(Math.round(10 * 4 + (20 / 1.5) * 4 + (10 / 1.5) * 9));
  });
  it("нормальная порция остаётся без пометки", () => {
    const p = buildDishEstimateProduct({
      name: "гречка отварная",
      amount: 200,
      totalCalories: 220,
      totalProtein: 8,
      totalFat: 2,
      totalCarbs: 44,
    });
    expect(p).not.toBeNull();
    expect(p!.needsReview).toBe(false);
  });
  it("пустой/бессмысленный ввод → null", () => {
    expect(buildDishEstimateProduct(null)).toBeNull();
    expect(buildDishEstimateProduct({ name: "x", amount: 100 })).toBeNull();
  });
});

describe("восстановление точного каталожного совпадения (после AI-реранка)", () => {
  const scored = [
    { id: "a", name: "Овсяные хлопья сырые", source: "local", matchScore: 0.9 },
    { id: "b", name: "Овсяное молоко", source: "local", matchScore: 0.7 },
  ];
  it("порядок слов в запросе не важен: «хлопья овсяные» находит «Овсяные хлопья»", () => {
    // AI-реранк оставил только молоко — точное каталожное совпадение обязано вернуться наверх
    const ranked = [{ id: "b", name: "Овсяное молоко", source: "local", matchScore: 0.7 }];
    const restored = restoreExactCatalogMatch("хлопья овсяные", scored, ranked);
    expect(restored[0].id).toBe("a");
  });
  it("подстрока в исходном порядке тоже восстанавливается", () => {
    const ranked = [{ id: "b", name: "Овсяное молоко", source: "local", matchScore: 0.7 }];
    const restored = restoreExactCatalogMatch("овсяные хлопья", scored, ranked);
    expect(restored[0].id).toBe("a");
  });
  it("не притягивает нерелевантное (нет всех токенов) и слабые (< 0.6) совпадения", () => {
    const weak = [{ id: "c", name: "Пищевой краситель красный", source: "local", matchScore: 0.4 }];
    const ranked = [{ id: "z", name: "Что-то", source: "local", matchScore: 0.5 }];
    expect(restoreExactCatalogMatch("красная фасоль", weak, ranked)).toBe(ranked);
  });
});

describe("кросс-источниковая дедупликация выдачи", () => {
  it("схлопывает локальный и USDA-дубль одного имени, оставляя высший по релевантности", () => {
    const sorted = [
      { id: "loc", name: "Молоко", source: "local", rankScore: 1.2 },
      { id: "usda", name: "молоко", source: "usda", rankScore: 0.8 },
    ];
    const out = dedupeSearchCandidatesByName(sorted);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("loc");
  });
  it("разные варианты (проценты) не схлопываются", () => {
    const sorted = [
      { id: "a", name: "Молоко 2.5%", source: "local", rankScore: 1 },
      { id: "b", name: "Молоко 3.2%", source: "local", rankScore: 0.9 },
    ];
    expect(dedupeSearchCandidatesByName(sorted)).toHaveLength(2);
  });
});

describe("единая схема микроэлементов для AI-промптов", () => {
  it("схема покрывает все 19 минералов и 15 витаминов из шаблона", () => {
    const hint = micronutrientSchemaHint();
    for (const mineral of Object.keys(MICRONUTRIENT_TEMPLATE.minerals)) {
      expect(hint).toContain(`"${mineral}"`);
    }
    for (const vitamin of Object.keys(MICRONUTRIENT_TEMPLATE.vitamins)) {
      expect(hint).toContain(`"${vitamin}"`);
    }
    // раньше промпт оценки терял эти минералы — фиксируем, что они теперь в схеме
    expect(hint).toContain('"Silicon"');
    expect(hint).toContain('"Cobalt"');
    expect(hint).toContain('"Molybdenum"');
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
