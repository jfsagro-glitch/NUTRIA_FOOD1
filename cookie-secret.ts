// Секрет для подписи cookie "token" — общий для server.ts (cookie-parser) и
// telegram-bot.ts (внутренние вызовы API от имени пользователя бота). Вынесен в
// отдельный модуль, чтобы избежать циклического импорта (server.ts импортирует
// telegram-bot.ts, а не наоборот) и гарантировать, что оба места подписывают/
// проверяют cookie ОДНИМ и тем же секретом даже в dev-режиме без COOKIE_SECRET
// (там секрет случайный, но должен быть один на процесс — отсюда кеширование).
import crypto from "node:crypto";

let cached: string | null = null;

export function resolveCookieSecret(): string {
  if (cached) return cached;
  const fromEnv = process.env.COOKIE_SECRET;
  if (fromEnv) {
    cached = fromEnv;
    return cached;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("COOKIE_SECRET не задан — обязателен в production (иначе сессионную cookie можно подделать)");
  }
  // eslint-disable-next-line no-console
  console.warn("[server] COOKIE_SECRET не задан — используется случайный секрет на время процесса (все сессии слетят при рестарте). Задайте COOKIE_SECRET в .env.");
  cached = crypto.randomBytes(32).toString("hex");
  return cached;
}
