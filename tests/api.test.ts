import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import {
  createApp,
  isLexicallyCompatibleFood,
  micronutrientRetryDelayMs,
  NUTRIA_API_CONTRACT_VERSION,
  parseProductSearchPagination,
  restoreExactCatalogMatch,
  withNutritionContract,
} from "../server.ts";

describe("product search pagination", () => {
  it("bounds offset and page size", () => {
    expect(parseProductSearchPagination(-5, 100)).toEqual({ offset: 0, limit: 10 });
    expect(parseProductSearchPagination(500, 0)).toEqual({ offset: 40, limit: 10 });
    expect(parseProductSearchPagination(10, 5)).toEqual({ offset: 10, limit: 5 });
  });

  it("returns a stable empty page contract", async () => {
    const res = await request(app).get("/api/products/search/v2?offset=10&limit=5");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], offset: 10, limit: 5, hasMore: false });
  });
});

// Тесты используют in-memory режим сервера (DATABASE_URL не задан в тестовой среде),
// поэтому проверяют только маршруты, у которых есть fallback без реальной БД.

let app: Express;

beforeAll(async () => {
  app = await createApp();
});

describe("privacy-safe client crash reports", () => {
  const safeReport = {
    exceptionType: "java.lang.IllegalStateException",
    stackHash: "a".repeat(64),
    appVersion: "1.0",
    androidSdk: 36,
    stage: "runtime",
  };

  it("accepts a fingerprint-only report", async () => {
    const res = await request(app).post("/api/client-errors").send(safeReport);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: true });
  });

  it("rejects messages and arbitrary user data", async () => {
    const res = await request(app)
      .post("/api/client-errors")
      .send({ ...safeReport, message: "user meal and health data" });
    expect(res.status).toBe(400);
  });
});

// Логин-кука выставляется с secure:true/sameSite:"none", из-за чего
// автоматический cookie-jar supertest/superagent не пересылает её обратно
// по обычному http — поэтому передаём заголовок Cookie вручную.
async function loginCookie(): Promise<string> {
  const res = await request(app).post("/api/auth/login");
  const setCookie = res.headers["set-cookie"];
  if (!setCookie) throw new Error("Login did not set a cookie");
  return setCookie[0].split(";")[0];
}

describe("auth", () => {
  it("API advertises the Nutria contract version", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.headers["x-nutria-contract-version"]).toBe(String(NUTRIA_API_CONTRACT_VERSION));
  });
  it("GET /api/auth/me без куки возвращает 401", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("POST /api/auth/login создаёт сессию (memory-режим)", async () => {
    const res = await request(app).post("/api/auth/login");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.mode).toBe("memory");
    expect(res.headers["set-cookie"]).toBeDefined();
  });

  it("GET /api/auth/me с кукой возвращает пользователя", async () => {
    const cookie = await loginCookie();
    const res = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.user?.email).toBe("user@nutria.app");
  });
});

describe("nutrition contract", () => {
  it("adds honest source metadata only for populated nutrient groups", () => {
    const product = withNutritionContract({
      id: "usda-123",
      name: "Chicken breast",
      source: "usda",
      protein: 31,
      micronutrients: JSON.stringify({
        vitamins: { B3: 13.7 },
        minerals: { Potassium: 256 },
        aminoAcids: {},
      }),
    });

    expect(product.contractVersion).toBe(1);
    expect(product.nutrientSources).toEqual({
      macros: "usda_fdc",
      vitamins: "usda_fdc",
      minerals: "usda_fdc",
    });
  });

  it("preserves per-group USDA and AI provenance", () => {
    const product = withNutritionContract({
      id: "mixed-source",
      name: "Mixed source product",
      source: "catalog",
      micronutrients: JSON.stringify({
        vitamins: { B1: 0.8 },
        minerals: { Iron: 2.1 },
        nutrientSources: { vitamins: "usda_fdc", minerals: "ai_estimate" },
      }),
    });

    expect(product.nutrientSources.vitamins).toBe("usda_fdc");
    expect(product.nutrientSources.minerals).toBe("ai_estimate");
  });
});

describe("micronutrient enrichment queue", () => {
  it("uses bounded exponential retry delays", () => {
    expect(micronutrientRetryDelayMs(1)).toBe(60_000);
    expect(micronutrientRetryDelayMs(3)).toBe(240_000);
    expect(micronutrientRetryDelayMs(20)).toBe(3_600_000);
  });
});

describe("recognition corrections", () => {
  const correctedProduct = {
    id: "user-correction-oats",
    name: "Овсяные хлопья",
    calories: 366,
    protein: 12.3,
    fat: 6.2,
    carbs: 61.8,
    source: "manufacturer",
  };

  it("stores a voice correction through the unified endpoint", async () => {
    const cookie = await loginCookie();
    const res = await request(app)
      .post("/api/recognition/corrections")
      .set("Cookie", cookie)
      .send({
        channel: "voice",
        sourceName: "овсянка",
        correctedProductId: correctedProduct.id,
        correctedProduct,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.channel).toBe("voice");
    expect(res.body.product.name).toBe(correctedProduct.name);
  });

  it("keeps the legacy photo endpoint compatible", async () => {
    const cookie = await loginCookie();
    const res = await request(app)
      .post("/api/photo/corrections")
      .set("Cookie", cookie)
      .send({
        sourceName: "хлопья на фото",
        correctedProductId: correctedProduct.id,
        correctedProduct,
      });

    expect(res.status).toBe(200);
    expect(res.body.channel).toBe("photo");
  });
});

describe("food match guard", () => {
  it("keeps compatible foods and rejects category-changing false matches", () => {
    expect(isLexicallyCompatibleFood("рис", "Рис белый варёный")).toBe(true);
    expect(isLexicallyCompatibleFood("рис", "Мука рисовая коричневая")).toBe(false);
    expect(isLexicallyCompatibleFood("овсянка", "Соленая свинина, бекон")).toBe(false);
    expect(isLexicallyCompatibleFood("молоко", "Просо, цельное зерно")).toBe(false);
  });

  it("keeps an exact local product when AI ranking omits it", () => {
    const exact = { id: "oats", name: "Овсяные хлопья сырые", source: "local", matchScore: 0.9 };
    const milk = { id: "milk", name: "Овсяное молоко", source: "usda", matchScore: 0.8 };
    expect(restoreExactCatalogMatch("овсяные хлопья", [exact, milk], [milk])).toEqual([exact, milk]);
  });
});

describe("weight tracker", () => {
  it("POST /api/weight без куки возвращает 401", async () => {
    const res = await request(app).post("/api/weight").send({ weightKg: 70 });
    expect(res.status).toBe(401);
  });

  it("POST /api/weight с некорректным весом возвращает 400", async () => {
    const cookie = await loginCookie();
    const res = await request(app).post("/api/weight").set("Cookie", cookie).send({ weightKg: -5 });
    expect(res.status).toBe(400);
  });

  it("POST /api/weight сохраняет запись, GET /api/weight/history её возвращает", async () => {
    const cookie = await loginCookie();

    const today = new Date().toISOString().slice(0, 10);
    const postRes = await request(app).post("/api/weight").set("Cookie", cookie).send({ date: today, weightKg: 72.5 });
    expect(postRes.status).toBe(200);
    expect(postRes.body.weightLog.weightKg).toBe(72.5);

    const historyRes = await request(app).get("/api/weight/history").set("Cookie", cookie);
    expect(historyRes.status).toBe(200);
    expect(historyRes.body.history.some((e: any) => e.date === today && e.weightKg === 72.5)).toBe(true);
  });
});

describe("export", () => {
  it("GET /api/export без куки возвращает 401", async () => {
    const res = await request(app).get("/api/export");
    expect(res.status).toBe(401);
  });

  it("GET /api/export с кукой возвращает zip-архив", async () => {
    const cookie = await loginCookie();
    const res = await request(app).get("/api/export").set("Cookie", cookie).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/zip");
    const body = res.body as Buffer;
    // ZIP-файлы начинаются с сигнатуры "PK"
    expect(body[0]).toBe(0x50);
    expect(body[1]).toBe(0x4b);
  });
});

describe("recipes import", () => {
  it("POST /api/recipes/import-url без куки возвращает 401", async () => {
    const res = await request(app).post("/api/recipes/import-url").send({ url: "https://example.com" });
    expect(res.status).toBe(401);
  });

  it("POST /api/recipes/import-url с некорректной ссылкой возвращает 400", async () => {
    const cookie = await loginCookie();
    const res = await request(app).post("/api/recipes/import-url").set("Cookie", cookie).send({ url: "not-a-url" });
    expect(res.status).toBe(400);
  });
});

describe("zod validation (T3)", () => {
  it("POST /api/diary/goals с отрицательной калорийностью возвращает 400", async () => {
    const cookie = await loginCookie();
    const res = await request(app)
      .post("/api/diary/goals")
      .set("Cookie", cookie)
      .send({ calories: -100, protein: 100, fat: 50, carbs: 200 });
    expect(res.status).toBe(400);
  });

  it("POST /api/voice/parse без transcript возвращает 400", async () => {
    const cookie = await loginCookie();
    const res = await request(app).post("/api/voice/parse").set("Cookie", cookie).send({});
    expect(res.status).toBe(400);
  });

  it("POST /api/weight с некорректным типом веса возвращает 400", async () => {
    const cookie = await loginCookie();
    const res = await request(app).post("/api/weight").set("Cookie", cookie).send({ weightKg: "not-a-number" });
    expect(res.status).toBe(400);
  });
});

describe("rate limiting", () => {
  it("после 20 запросов к /api/auth/login отдаёт 429", async () => {
    // skip-функция лимитера читает NODE_ENV на каждый запрос — на время теста
    // временно выключаем тестовый skip, чтобы проверить реальное ограничение.
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      let lastStatus = 200;
      for (let i = 0; i < 25; i++) {
        const res = await request(app).post("/api/auth/login");
        lastStatus = res.status;
        if (lastStatus === 429) break;
      }
      expect(lastStatus).toBe(429);
    } finally {
      process.env.NODE_ENV = original;
    }
  });
});
