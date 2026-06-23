import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../server.ts";

// Тесты используют in-memory режим сервера (DATABASE_URL не задан в тестовой среде),
// поэтому проверяют только маршруты, у которых есть fallback без реальной БД.

let app: Express;

beforeAll(async () => {
  app = await createApp();
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
