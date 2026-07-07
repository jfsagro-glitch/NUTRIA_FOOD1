/**
 * telegram-bot.ts
 *
 * Telegram-бот для клиента NÜTRIA — альтернативный интерфейс дневника питания
 * для тех, кто не хочет ставить приложение (ТЗ §4 "Telegram-бот для клиента").
 *
 * Реализует:
 *  4.1 Онбординг в боте (User Flow) — имя, возраст, рост, вес, пол, аллергии,
 *      цель, режим отслеживания, целевые показатели, подтверждение.
 *  4.2 Основные команды — добавить приём пищи (текст/голос), посмотреть
 *      аналитику, изменить цель, настраиваемые напоминания.
 *
 * Архитектура:
 *  - Webhook, а не long polling — бот живёт в том же Express-процессе
 *    (server.ts), что не требует отдельного always-on воркера и совместимо
 *    с бесплатным хостингом (см. INTEGRATION.md, раздел про хостинг).
 *  - Никакой Telegram SDK не используется — все вызовы Telegram Bot API
 *    и OpenAI Whisper делаются через обычный fetch (как и остальной код
 *    server.ts работает с USDA/OpenFoodFacts), чтобы не тащить лишнюю
 *    зависимость.
 *  - Бизнес-логика дневника (распознавание еды, продукты, цели) НЕ
 *    дублируется — бот делает внутренние HTTP-запросы к уже существующим
 *    эндпойнтам того же сервера (/api/diary/*, /api/voice/parse), подставляя
 *    подписанную cookie `token=s:<userId>.<sig>` (см. internalApi ниже) —
 *    сервер принимает только подписанные cookie (req.signedCookies.token),
 *    сырое значение token=<userId> он отклонит как неавторизованное.
 *  - Состояние диалога (шаг онбординга, черновик ответов, напоминания)
 *    хранится в таблице TelegramAccount, а не в памяти процесса — это
 *    переживает перезапуск/засыпание бесплатного хостинга.
 */

import type { Express, Request, Response } from "express";
import type { PrismaClient } from "@prisma/client";
import crypto from "crypto";
import { sign as signCookieValue } from "cookie-signature";
import { logError } from "./logging.ts";
import { validateBody, fastingNotifySchema } from "./validation.ts";
import { resolveCookieSecret } from "./cookie-secret.ts";

// ─── Конфигурация ────────────────────────────────────────────────────────────

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN?.trim();
const TELEGRAM_API = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : null;
const TELEGRAM_FILE_API = BOT_TOKEN ? `https://api.telegram.org/file/bot${BOT_TOKEN}` : null;
// Публичный URL сервера — нужен один раз при старте, чтобы зарегистрировать
// webhook в Telegram. Например: https://nutria.onrender.com
const PUBLIC_URL = process.env.PUBLIC_URL?.trim();
// Таймзона для напоминаний, по умолчанию — Москва (основная аудитория RU)
const BOT_TIMEZONE = process.env.BOT_TIMEZONE || "Europe/Moscow";
const INTERNAL_PORT = Number(process.env.PORT) || 3000;
const INTERNAL_BASE_URL = `http://127.0.0.1:${INTERNAL_PORT}`;

const MEAL_TYPES: Record<string, string> = {
  BREAKFAST: "Завтрак",
  LUNCH: "Обед",
  DINNER: "Ужин",
  SNACK: "Перекус",
};

// ─── Умные напоминания (если приём пищи не внесён) ───────────────────────────
// Типичное время приёма пищи (по таймзоне BOT_TIMEZONE) — отсчёт для задержки
// напоминания. Перекус не отслеживается: он необязателен у большинства клиентов.
const MEAL_REMINDER_WINDOWS: Record<string, string> = {
  BREAKFAST: "08:00",
  LUNCH: "13:00",
  DINNER: "19:00",
};
const MEAL_REMINDER_ORDER = ["BREAKFAST", "LUNCH", "DINNER"];
const MEAL_REMINDER_DELAY_HOURS = 3;
const SMART_REMINDER_MAX_OPTIONS = [1, 2, 3, 4, 5];

// ─── Привязка существующего веб-аккаунта к Telegram-чату ─────────────────────
// Без символов 0/O и 1/I — чтобы код было легко набрать вручную, если диплинк
// (t.me/<bot>?start=<code>) по какой-то причине не сработал.
const LINK_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LINK_CODE_LENGTH = 6;
const LINK_CODE_TTL_MS = 15 * 60 * 1000;

function generateLinkCode(): string {
  let code = "";
  for (let i = 0; i < LINK_CODE_LENGTH; i++) {
    code += LINK_CODE_CHARS[crypto.randomInt(LINK_CODE_CHARS.length)];
  }
  return code;
}

let cachedBotUsername: string | null = null;
async function getBotUsername(): Promise<string | null> {
  if (cachedBotUsername) return cachedBotUsername;
  try {
    const me = await tg("getMe", {});
    cachedBotUsername = me?.username || null;
  } catch (e) {
    logError("[telegram-bot] getMe failed:", e);
  }
  return cachedBotUsername;
}

// ─── Telegram Bot API helpers ────────────────────────────────────────────────

async function tg(method: string, params: Record<string, any>) {
  if (!TELEGRAM_API) throw new Error("TELEGRAM_BOT_TOKEN не задан");
  const res = await fetch(`${TELEGRAM_API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data: any = await res.json();
  if (!data.ok) {
    logError(`[telegram-bot] ${method} failed:`, data.description || data);
  }
  return data.result;
}

function sendMessage(chatId: string | number, text: string, extra: Record<string, any> = {}) {
  return tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...extra });
}

function sendPhoto(chatId: string | number, photoUrl: string, caption?: string) {
  return tg("sendPhoto", { chat_id: chatId, photo: photoUrl, caption });
}

function answerCallback(callbackQueryId: string, text?: string) {
  return tg("answerCallbackQuery", { callback_query_id: callbackQueryId, text });
}

function inlineKeyboard(rows: Array<Array<{ text: string; data: string }>>) {
  return {
    reply_markup: {
      inline_keyboard: rows.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))),
    },
  };
}

const MAIN_MENU_KEYBOARD = {
  reply_markup: {
    keyboard: [
      [{ text: "🍽 Добавить приём пищи" }, { text: "📊 Посмотреть аналитику" }],
      [{ text: "🎯 Изменить цель" }, { text: "⏰ Напоминания" }],
    ],
    resize_keyboard: true,
  },
};

function removeKeyboard() {
  return { reply_markup: { remove_keyboard: true } };
}

// ─── Whisper (голосовой ввод) ────────────────────────────────────────────────

async function downloadTelegramFile(fileId: string): Promise<Buffer> {
  const fileInfo = await tg("getFile", { file_id: fileId });
  if (!fileInfo?.file_path) throw new Error("Не удалось получить file_path от Telegram");
  const res = await fetch(`${TELEGRAM_FILE_API}/${fileInfo.file_path}`);
  if (!res.ok) throw new Error(`Не удалось скачать файл из Telegram: ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function transcribeVoice(buffer: Buffer): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY не задан — голосовой ввод недоступен");

  const form = new FormData();
  form.append("file", new Blob([buffer], { type: "audio/ogg" }), "voice.ogg");
  form.append("model", "whisper-1");
  form.append("language", "ru");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form as any,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Whisper transcription failed: ${res.status} ${errText}`);
  }
  const data: any = await res.json();
  return String(data.text || "").trim();
}

// ─── Внутренние вызовы к уже существующим API дневника ──────────────────────
// Бот не дублирует бизнес-логику — он дёргает те же эндпойнты, что и
// клиентское приложение, подставляя cookie "token". server.ts читает её как
// req.signedCookies.token (не req.cookies.token) — сырое token=<userId> без
// подписи молча отклоняется как Unauthorized, поэтому подписываем тем же
// секретом, что и cookie-parser в server.ts (см. cookie-secret.ts).
// Отсюда и был баг "Записал 0 продуктов, ≈0 ккал" — распознавание речи
// (/api/voice/parse) авторизации не требует и отрабатывало, а /api/recipes
// и /api/diary/add требуют — и получали 401 на каждый вызов.

async function internalApi(path: string, opts: { method?: string; body?: any; userId: string }) {
  const signedToken = "s:" + signCookieValue(opts.userId, resolveCookieSecret());
  const res = await fetch(`${INTERNAL_BASE_URL}${path}`, {
    method: opts.method || "GET",
    headers: {
      "Content-Type": "application/json",
      Cookie: `token=${signedToken}`,
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  try {
    return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null };
  } catch {
    return { ok: res.ok, status: res.status, data: null };
  }
}

// ─── Состояние диалога (TelegramAccount) ─────────────────────────────────────

interface Draft {
  name?: string;
  age?: number;
  heightCm?: number;
  weightKg?: number;
  sex?: "male" | "female";
  allergies?: string[];
  goal?: "lose" | "maintain" | "gain";
  trackingMode?: "basic" | "extended";
  targetsUnit?: "grams" | "percent" | "kcal";
  calories?: number;
  protein?: number;
  fat?: number;
  carbs?: number;
  fiber?: number;
}

function getDraft(account: any): Draft {
  try {
    return JSON.parse(account.draftJson || "{}");
  } catch {
    return {};
  }
}

async function saveAccount(prisma: PrismaClient, chatId: string, patch: { state?: string; draft?: Draft; reminders?: string[] }) {
  const data: any = {};
  if (patch.state !== undefined) data.state = patch.state;
  if (patch.draft !== undefined) data.draftJson = JSON.stringify(patch.draft);
  if (patch.reminders !== undefined) data.remindersJson = JSON.stringify(patch.reminders);
  return (prisma as any).telegramAccount.update({ where: { chatId }, data });
}

async function getOrCreateAccount(prisma: PrismaClient, chatId: string, from: any) {
  const delegate = (prisma as any).telegramAccount;
  let account = await delegate.findUnique({ where: { chatId } });
  if (!account) {
    account = await delegate.create({
      data: {
        chatId,
        username: from?.username || null,
        firstNameTg: from?.first_name || null,
      },
    });
  }
  return account;
}

// ─── Онбординг: машина состояний ─────────────────────────────────────────────

const GOAL_LABELS: Record<string, string> = {
  lose: "Снижение веса",
  maintain: "Сохранение веса",
  gain: "Набор веса",
};

async function startOnboarding(prisma: PrismaClient, chatId: string) {
  await saveAccount(prisma, chatId, { state: "ASK_NAME", draft: {} });
  await sendMessage(
    chatId,
    "Привет! Я бот NÜTRIA 🌱 — помогу вести дневник питания прямо в Telegram.\n\nКак тебя зовут?",
    removeKeyboard()
  );
}

async function handleOnboardingStep(prisma: PrismaClient, account: any, chatId: string, text: string) {
  const draft = getDraft(account);
  const state = account.state;

  switch (state) {
    case "ASK_NAME": {
      const name = text.trim().slice(0, 60);
      if (!name) return sendMessage(chatId, "Имя не должно быть пустым. Как тебя зовут?");
      draft.name = name;
      await saveAccount(prisma, chatId, { state: "ASK_AGE", draft });
      return sendMessage(chatId, `Приятно познакомиться, ${name}! Сколько тебе лет? (числом, до 100)`);
    }

    case "ASK_AGE": {
      const age = parseInt(text.trim(), 10);
      if (!Number.isFinite(age) || age <= 0 || age > 100) {
        return sendMessage(chatId, "Возраст должен быть числом от 1 до 100. Попробуй ещё раз:");
      }
      draft.age = age;
      await saveAccount(prisma, chatId, { state: "ASK_HEIGHT", draft });
      return sendMessage(chatId, "Рост в сантиметрах? (до 300)");
    }

    case "ASK_HEIGHT": {
      const height = parseFloat(text.trim().replace(",", "."));
      if (!Number.isFinite(height) || height <= 0 || height > 300) {
        return sendMessage(chatId, "Рост должен быть числом от 1 до 300 см. Попробуй ещё раз:");
      }
      draft.heightCm = height;
      await saveAccount(prisma, chatId, { state: "ASK_WEIGHT", draft });
      return sendMessage(chatId, "Вес в килограммах? (до 300)");
    }

    case "ASK_WEIGHT": {
      const weight = parseFloat(text.trim().replace(",", "."));
      if (!Number.isFinite(weight) || weight <= 0 || weight > 300) {
        return sendMessage(chatId, "Вес должен быть числом от 1 до 300 кг. Попробуй ещё раз:");
      }
      draft.weightKg = weight;
      await saveAccount(prisma, chatId, { state: "ASK_SEX", draft });
      return sendMessage(
        chatId,
        "Укажи пол:",
        inlineKeyboard([[{ text: "Мужской", data: "sex:male" }, { text: "Женский", data: "sex:female" }]])
      );
    }

    case "ASK_ALLERGIES": {
      if (text.trim().toLowerCase() !== "пропустить") {
        draft.allergies = text
          .split(/[,;]/)
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 20);
      } else {
        draft.allergies = [];
      }
      await saveAccount(prisma, chatId, { state: "ASK_GOAL", draft });
      return sendMessage(
        chatId,
        "Какая у тебя цель?",
        inlineKeyboard([
          [{ text: "📉 Снижение веса", data: "goal:lose" }],
          [{ text: "⚖️ Сохранение веса", data: "goal:maintain" }],
          [{ text: "📈 Набор веса", data: "goal:gain" }],
        ])
      );
    }

    case "ASK_TARGETS_VALUES": {
      return handleTargetsValuesInput(prisma, account, chatId, text, draft, "onboarding");
    }

    default:
      return null;
  }
}

async function handleOnboardingCallback(prisma: PrismaClient, account: any, chatId: string, data: string) {
  const draft = getDraft(account);
  const [key, value] = data.split(":");

  if (account.state === "ASK_SEX" && key === "sex") {
    draft.sex = value as "male" | "female";
    await saveAccount(prisma, chatId, { state: "ASK_ALLERGIES", draft });
    return sendMessage(
      chatId,
      "Есть ли аллергии или непереносимости? Напиши через запятую, либо отправь «Пропустить».",
      inlineKeyboard([[{ text: "Пропустить", data: "allergies:skip" }]])
    );
  }

  if (account.state === "ASK_ALLERGIES" && key === "allergies" && value === "skip") {
    draft.allergies = [];
    await saveAccount(prisma, chatId, { state: "ASK_GOAL", draft });
    return sendMessage(
      chatId,
      "Какая у тебя цель?",
      inlineKeyboard([
        [{ text: "📉 Снижение веса", data: "goal:lose" }],
        [{ text: "⚖️ Сохранение веса", data: "goal:maintain" }],
        [{ text: "📈 Набор веса", data: "goal:gain" }],
      ])
    );
  }

  if (account.state === "ASK_GOAL" && key === "goal") {
    draft.goal = value as "lose" | "maintain" | "gain";
    await saveAccount(prisma, chatId, { state: "ASK_TRACKING_MODE", draft });
    return sendMessage(
      chatId,
      "Что отслеживаем?",
      inlineKeyboard([
        [{ text: "Базово: КБЖУ", data: "tracking:basic" }],
        [{ text: "Расширенно: КБЖУ + нутриенты", data: "tracking:extended" }],
      ])
    );
  }

  if (account.state === "ASK_TRACKING_MODE" && key === "tracking") {
    draft.trackingMode = value as "basic" | "extended";
    await saveAccount(prisma, chatId, { state: "ASK_TARGETS_UNIT", draft });
    return sendMessage(
      chatId,
      "Как удобнее задать целевые показатели?",
      inlineKeyboard([
        [{ text: "Просто в ккал (БЖУ рассчитаю сам)", data: "unit:kcal" }],
        [{ text: "В граммах (ккал, белки, жиры, углеводы)", data: "unit:grams" }],
        [{ text: "В % от калорийности", data: "unit:percent" }],
      ])
    );
  }

  if (account.state === "ASK_TARGETS_UNIT" && key === "unit") {
    draft.targetsUnit = value as "grams" | "percent" | "kcal";
    await saveAccount(prisma, chatId, { state: "ASK_TARGETS_VALUES", draft });
    if (value === "kcal") {
      return sendMessage(chatId, "Сколько калорий в день? (например: 2000)");
    }
    if (value === "grams") {
      return sendMessage(chatId, "Введи 4 числа через пробел: калории белки жиры углеводы\nНапример: 2000 120 70 250");
    }
    return sendMessage(chatId, "Введи калории и % белков/жиров/углеводов через пробел (сумма % = 100)\nНапример: 2000 30 30 40");
  }

  if (account.state === "CONFIRM" && key === "confirm") {
    if (value === "yes") {
      return finalizeOnboarding(prisma, account, chatId);
    }
    await saveAccount(prisma, chatId, { state: "NEW", draft: {} });
    return startOnboarding(prisma, chatId);
  }

  return null;
}

async function handleTargetsValuesInput(
  prisma: PrismaClient,
  account: any,
  chatId: string,
  text: string,
  draft: Draft,
  context: "onboarding" | "edit"
) {
  const nums = text
    .trim()
    .split(/\s+/)
    .map((s) => parseFloat(s.replace(",", ".")));

  if (draft.targetsUnit === "kcal") {
    const calories = nums[0];
    if (!Number.isFinite(calories) || calories < 800 || calories > 6000) {
      return sendMessage(chatId, "Введи число калорий от 800 до 6000. Например: 2000");
    }
    draft.calories = Math.round(calories);
    draft.protein = Math.round((calories * 0.3) / 4);
    draft.fat = Math.round((calories * 0.3) / 9);
    draft.carbs = Math.round((calories * 0.4) / 4);
    draft.fiber = Math.round(calories / 100);
  } else if (draft.targetsUnit === "grams") {
    const [calories, protein, fat, carbs] = nums;
    if (![calories, protein, fat, carbs].every((n) => Number.isFinite(n) && n >= 0)) {
      return sendMessage(chatId, "Нужно 4 числа через пробел: калории белки жиры углеводы. Например: 2000 120 70 250");
    }
    draft.calories = Math.round(calories);
    draft.protein = Math.round(protein);
    draft.fat = Math.round(fat);
    draft.carbs = Math.round(carbs);
    draft.fiber = Math.round(calories / 100);
  } else {
    // percent
    const [calories, pProtein, pFat, pCarbs] = nums;
    if (![calories, pProtein, pFat, pCarbs].every((n) => Number.isFinite(n) && n >= 0)) {
      return sendMessage(chatId, "Нужно 4 числа через пробел: калории %белки %жиры %углеводы. Например: 2000 30 30 40");
    }
    if (Math.abs(pProtein + pFat + pCarbs - 100) > 1) {
      return sendMessage(chatId, "Сумма процентов должна быть равна 100. Попробуй ещё раз:");
    }
    draft.calories = Math.round(calories);
    draft.protein = Math.round((calories * (pProtein / 100)) / 4);
    draft.fat = Math.round((calories * (pFat / 100)) / 9);
    draft.carbs = Math.round((calories * (pCarbs / 100)) / 4);
    draft.fiber = Math.round(calories / 100);
  }

  if (context === "onboarding") {
    await saveAccount(prisma, chatId, { state: "CONFIRM", draft });
    const summary = renderOnboardingSummary(draft);
    return sendMessage(
      chatId,
      `Проверь данные:\n\n${summary}\n\nВсё верно?`,
      inlineKeyboard([
        [{ text: "✅ Подтвердить", data: "confirm:yes" }],
        [{ text: "✏️ Начать заново", data: "confirm:no" }],
      ])
    );
  }

  // context === "edit": сразу применяем новую цель к существующему аккаунту
  const account2 = account;
  const userId = account2.userId;
  const result = await internalApi("/api/diary/goals", {
    method: "POST",
    userId,
    body: { calories: draft.calories, protein: draft.protein, fat: draft.fat, carbs: draft.carbs, fiber: draft.fiber },
  });
  await saveAccount(prisma, chatId, { state: "DONE", draft: {} });
  if (!result.ok) {
    return sendMessage(chatId, "Не получилось сохранить цель, попробуй ещё раз позже.", MAIN_MENU_KEYBOARD);
  }
  return sendMessage(
    chatId,
    `Цель обновлена ✅\n\nКалории: ${draft.calories} ккал\nБелки: ${draft.protein} г\nЖиры: ${draft.fat} г\nУглеводы: ${draft.carbs} г`,
    MAIN_MENU_KEYBOARD
  );
}

function renderOnboardingSummary(draft: Draft): string {
  return [
    `Имя: ${draft.name}`,
    `Возраст: ${draft.age}`,
    `Рост: ${draft.heightCm} см`,
    `Вес: ${draft.weightKg} кг`,
    `Пол: ${draft.sex === "male" ? "Мужской" : "Женский"}`,
    `Аллергии: ${draft.allergies && draft.allergies.length ? draft.allergies.join(", ") : "нет"}`,
    `Цель: ${GOAL_LABELS[draft.goal || "maintain"]}`,
    `Отслеживание: ${draft.trackingMode === "extended" ? "КБЖУ + нутриенты" : "КБЖУ"}`,
    `Калории: ${draft.calories} ккал`,
    `Белки: ${draft.protein} г / Жиры: ${draft.fat} г / Углеводы: ${draft.carbs} г`,
  ].join("\n");
}

async function finalizeOnboarding(prisma: PrismaClient, account: any, chatId: string) {
  const draft = getDraft(account);
  const passwordHash = crypto.randomBytes(32).toString("hex"); // вход только через бота, пароль не используется

  const currentYear = new Date().getFullYear();
  const user = await (prisma as any).user.create({
    data: {
      email: `tg${chatId}@telegram.nutria.local`,
      passwordHash,
      role: "CLIENT",
      clientProfile: {
        create: {
          firstName: draft.name,
          sex: draft.sex,
          heightCm: draft.heightCm,
          weightKg: draft.weightKg,
          goal: draft.goal,
          birthYear: draft.age ? currentYear - draft.age : null,
          allergiesJson: JSON.stringify(draft.allergies || []),
        },
      },
      nutrientGoals: {
        create: {
          calories: draft.calories || 2000,
          protein: draft.protein || 120,
          fat: draft.fat || 70,
          carbs: draft.carbs || 250,
          fiber: draft.fiber || 25,
        },
      },
    },
  });

  await saveAccount(prisma, chatId, { state: "DONE", draft: {} });
  await (prisma as any).telegramAccount.update({ where: { chatId }, data: { userId: user.id } });

  return sendMessage(
    chatId,
    "Готово! Аккаунт создан 🎉\n\nТеперь можно добавлять приёмы пищи прямо здесь — текстом или голосом.\n\nИспользуй меню ниже:",
    MAIN_MENU_KEYBOARD
  );
}

// ─── Команды после онбординга ────────────────────────────────────────────────

async function handleMenuCommand(prisma: PrismaClient, account: any, chatId: string, text: string) {
  if (text === "🍽 Добавить приём пищи" || text === "/add") {
    await saveAccount(prisma, chatId, { state: "AWAIT_MEAL_TEXT" });
    return sendMessage(chatId, "Опиши, что съел — текстом или голосовым сообщением 🎙");
  }

  if (text === "📊 Посмотреть аналитику" || text === "/stats") {
    return sendMessage(
      chatId,
      "За какой период?",
      inlineKeyboard([
        [{ text: "7 дней", data: "stats:7" }, { text: "14 дней", data: "stats:14" }, { text: "30 дней", data: "stats:30" }],
      ])
    );
  }

  if (text === "🎯 Изменить цель" || text === "/goal") {
    await saveAccount(prisma, chatId, { state: "AWAIT_GOAL_EDIT" });
    return sendMessage(chatId, "Введи 4 числа через пробел: калории белки жиры углеводы\nНапример: 2000 120 70 250");
  }

  if (text === "⏰ Напоминания" || text === "/reminders") {
    const reminders: string[] = JSON.parse(account.remindersJson || "[]");
    const list = reminders.length ? reminders.join(", ") : "нет";
    const smartStatus = account.smartRemindersEnabled
      ? `включены, до ${account.smartReminderMaxPerDay} в день`
      : "выключены";
    return sendMessage(
      chatId,
      `🔔 <b>Умные напоминания</b> (если не внесли приём пищи через ${MEAL_REMINDER_DELAY_HOURS} ч после обычного времени): ${smartStatus}\n\n⏰ <b>Напоминания по расписанию</b>: ${list}`,
      inlineKeyboard([
        [{ text: account.smartRemindersEnabled ? "🔕 Выключить умные" : "🔔 Включить умные", data: "smartrem:toggle" }],
        [{ text: "🔢 Кол-во умных в день", data: "smartrem:count" }],
        [{ text: "➕ Добавить время", data: "rem:add" }],
        [{ text: "🗑 Очистить все по расписанию", data: "rem:clear" }],
      ])
    );
  }

  return sendMessage(chatId, "Не понял команду. Выбери действие в меню ниже:", MAIN_MENU_KEYBOARD);
}

async function handleAwaitMealText(prisma: PrismaClient, account: any, chatId: string, message: any) {
  let transcript = "";

  if (message.voice) {
    await sendMessage(chatId, "Слушаю голосовое… 🎧");
    try {
      const buffer = await downloadTelegramFile(message.voice.file_id);
      transcript = await transcribeVoice(buffer);
    } catch (e: any) {
      logError("[telegram-bot] Voice transcription error:", e);
      return sendMessage(chatId, "Не получилось распознать голосовое сообщение. Попробуй текстом.");
    }
    if (!transcript) {
      return sendMessage(chatId, "Не разобрал голосовое сообщение. Попробуй ещё раз или текстом.");
    }
    await sendMessage(chatId, `Расслышал: «${transcript}»`);
  } else if (typeof message.text === "string") {
    transcript = message.text.trim();
  } else {
    return sendMessage(chatId, "Опиши приём пищи текстом или отправь голосовое сообщение 🎙");
  }

  const userId = account.userId;
  // /api/voice/parse — тот же движок распознавания, что и в веб-приложении
  // (декомпозиция блюда на ингредиенты + поиск продукта в базе для каждого,
  // с оценкой типичной порции на одного человека, если граммовка не названа).
  // Отвечает голым массивом [{name, amount, product}], а не {items: [...]}.
  const result = await internalApi("/api/voice/parse", { method: "POST", userId, body: { transcript } });

  if (!result.ok || !Array.isArray(result.data)) {
    return sendMessage(chatId, "Не удалось распознать продукты в этом сообщении. Попробуй описать иначе, например: «гречка 150 грамм и куриная грудка 120 грамм».", MAIN_MENU_KEYBOARD);
  }

  const items = result.data
    .filter((it: any) => it.product)
    .map((it: any) => ({ name: it.name, amount: Number(it.amount) || 100, product: it.product }));

  if (items.length === 0) {
    return sendMessage(chatId, "Распознал текст, но не нашёл подходящие продукты в базе. Попробуй описать иначе.", MAIN_MENU_KEYBOARD);
  }

  const mealType = getCurrentMealType(BOT_TIMEZONE);
  const itemsList = items.map((i: any) => `• ${i.name} — ${i.amount} г`).join("\n");

  // Несколько ингредиентов одного блюда (как в "Создать блюдо" в приложении) —
  // собираем их в один Recipe + продукт-снимок, чтобы в дневник попала одна
  // запись с названием блюда, а не отдельная строка на каждый ингредиент.
  // Состав можно поправить позже в приложении кнопкой "Состав".
  if (items.length > 1) {
    const dishName = transcript.trim().replace(/^./, (c) => c.toUpperCase());
    const totalWeight = items.reduce((sum: number, it: any) => sum + it.amount, 0);
    const recipeRes = await internalApi("/api/recipes", {
      method: "POST",
      userId,
      body: {
        name: dishName,
        cookedWeightGrams: totalWeight,
        ingredients: items.map((it: any) => ({
          productId: it.product.id,
          name: it.name,
          weightGrams: it.amount,
          calories: it.product.calories,
          protein: it.product.protein,
          fat: it.product.fat,
          carbs: it.product.carbs,
        })),
      },
    });

    if (recipeRes.ok && recipeRes.data?.product?.id) {
      const dishProduct = recipeRes.data.product;
      const addRes = await internalApi("/api/diary/add", {
        method: "POST",
        userId,
        body: { productId: dishProduct.id, amount: totalWeight, type: mealType, usdaData: dishProduct },
      });
      if (addRes.ok) {
        await saveAccount(prisma, chatId, { state: "DONE" });
        const totalCalories = (Number(dishProduct.calories) || 0) * (totalWeight / 100);
        return sendMessage(
          chatId,
          `Записал «${dishName}» в ${MEAL_TYPES[mealType] || mealType} (≈${Math.round(totalCalories)} ккал) ✅\n${itemsList}\n\nСостав и вес можно поправить в приложении — кнопка «Состав» у записи.`,
          MAIN_MENU_KEYBOARD
        );
      }
    }
    // Не удалось собрать блюдо одной позицией — не теряем распознанное,
    // добавляем ингредиенты по отдельности, как раньше.
  }

  let totalCalories = 0;
  let added = 0;
  for (const item of items) {
    const product = item.product;
    const res = await internalApi("/api/diary/add", {
      method: "POST",
      userId,
      body: { productId: product.id, amount: item.amount, type: mealType, usdaData: product },
    });
    if (res.ok) {
      added += 1;
      totalCalories += ((Number(product.calories) || 0) * item.amount) / 100;
    }
  }

  await saveAccount(prisma, chatId, { state: "DONE" });

  // Не рапортуем "✅ Записал", если по факту ничего не записалось — иначе пользователь
  // уверен, что приём пищи в дневнике, хотя запросы к /api/diary/add провалились
  // (например 401 из-за сбоя авторизации) и записей 0.
  if (added === 0) {
    return sendMessage(
      chatId,
      `Распознал продукты, но не смог записать ни один в дневник — сервер вернул ошибку. Попробуй ещё раз через минуту, если не поможет — напиши в поддержку.\nРаспознано:\n${itemsList}`,
      MAIN_MENU_KEYBOARD
    );
  }

  return sendMessage(
    chatId,
    `Записал в ${MEAL_TYPES[mealType] || mealType} (${added} продукт${added === 1 ? "" : "ов"}, ≈${Math.round(totalCalories)} ккал) ✅\n${itemsList}\n\nЕсли что-то не так — поправь в приложении, в дневнике за сегодня.`,
    MAIN_MENU_KEYBOARD
  );
}

async function handleStatsCallback(chatId: string, account: any, days: number) {
  const userId = account.userId;
  const result = await internalApi(`/api/diary/history?days=${days}`, { userId });
  if (!result.ok || !Array.isArray(result.data?.history)) {
    return sendMessage(chatId, "Не получилось загрузить аналитику, попробуй позже.", MAIN_MENU_KEYBOARD);
  }

  const history: any[] = result.data.history;
  const totals = history.reduce(
    (acc, d) => {
      acc.calories += d.totals.calories;
      acc.protein += d.totals.protein;
      acc.fat += d.totals.fat;
      acc.carbs += d.totals.carbs;
      return acc;
    },
    { calories: 0, protein: 0, fat: 0, carbs: 0 }
  );
  const n = history.length || 1;
  const avg = {
    calories: Math.round(totals.calories / n),
    protein: Math.round(totals.protein / n),
    fat: Math.round(totals.fat / n),
    carbs: Math.round(totals.carbs / n),
  };

  const chartConfig = {
    type: "line",
    data: {
      labels: history.map((d: any) => d.date.slice(5)),
      datasets: [{ label: "Калории", data: history.map((d: any) => Math.round(d.totals.calories)), borderColor: "#10b981", fill: false }],
    },
    options: { plugins: { legend: { display: false } } },
  };
  const chartUrl = `https://quickchart.io/chart?w=600&h=300&c=${encodeURIComponent(JSON.stringify(chartConfig))}`;

  const caption = `Статистика за ${days} дней\n\nСреднее в день:\nКалории: ${avg.calories} ккал\nБелки: ${avg.protein} г\nЖиры: ${avg.fat} г\nУглеводы: ${avg.carbs} г`;
  try {
    await sendPhoto(chatId, chartUrl, caption);
  } catch {
    await sendMessage(chatId, caption);
  }
  return sendMessage(chatId, "Что дальше?", MAIN_MENU_KEYBOARD);
}

async function handleReminderCallback(prisma: PrismaClient, account: any, chatId: string, action: string) {
  if (action === "clear") {
    await saveAccount(prisma, chatId, { reminders: [] });
    return sendMessage(chatId, "Напоминания очищены.", MAIN_MENU_KEYBOARD);
  }
  if (action === "add") {
    await saveAccount(prisma, chatId, { state: "AWAIT_REMINDER_TIME" });
    return sendMessage(chatId, "В какое время напоминать? Формат ЧЧ:MM, например 09:00");
  }
  return null;
}

async function handleAwaitReminderTime(prisma: PrismaClient, account: any, chatId: string, text: string) {
  const match = text.trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) {
    return sendMessage(chatId, "Неверный формат. Введи время как ЧЧ:MM, например 19:30");
  }
  const reminders: string[] = JSON.parse(account.remindersJson || "[]");
  const time = `${match[1]}:${match[2]}`;
  if (!reminders.includes(time)) reminders.push(time);
  await saveAccount(prisma, chatId, { state: "DONE", reminders: reminders.slice(0, 5) });
  return sendMessage(chatId, `Готово! Буду напоминать в ${time} ✅`, MAIN_MENU_KEYBOARD);
}

async function handleSmartReminderCallback(prisma: PrismaClient, account: any, chatId: string, action: string) {
  if (action === "toggle") {
    const next = !account.smartRemindersEnabled;
    await (prisma as any).telegramAccount.update({ where: { chatId }, data: { smartRemindersEnabled: next } });
    return sendMessage(
      chatId,
      next
        ? `Умные напоминания включены ✅ Если не отметите завтрак/обед/ужин в течение ${MEAL_REMINDER_DELAY_HOURS} ч после обычного времени, бот напомнит (не более ${account.smartReminderMaxPerDay} раз в день).`
        : "Умные напоминания выключены.",
      MAIN_MENU_KEYBOARD
    );
  }
  if (action === "count") {
    return sendMessage(
      chatId,
      "Сколько умных напоминаний в день присылать максимум?",
      inlineKeyboard([SMART_REMINDER_MAX_OPTIONS.map((n) => ({ text: String(n), data: `smartrem:setcount:${n}` }))])
    );
  }
  if (action.startsWith("setcount:")) {
    const n = Math.max(1, Math.min(5, Number(action.split(":")[1]) || 3));
    await (prisma as any).telegramAccount.update({ where: { chatId }, data: { smartReminderMaxPerDay: n } });
    return sendMessage(chatId, `Максимум умных напоминаний в день: ${n} ✅`, MAIN_MENU_KEYBOARD);
  }
  return null;
}

async function handleLinkCode(prisma: PrismaClient, chatId: string, from: any, codeRaw: string) {
  const code = codeRaw.trim().toUpperCase();
  const row = await (prisma as any).telegramLinkCode.findUnique({ where: { code } });
  if (row) {
    await (prisma as any).telegramLinkCode.delete({ where: { code } }).catch(() => {});
  }
  if (!row || row.expiresAt < new Date()) {
    return sendMessage(
      chatId,
      "Код недействителен или истёк. Сформируйте новый в приложении (Профиль → Настройки → Telegram-уведомления) и отправьте его сюда ещё раз."
    );
  }

  // На один веб-аккаунт — один активный чат: отвязываем прежний, если был.
  await (prisma as any).telegramAccount.updateMany({
    where: { userId: row.userId, chatId: { not: chatId } },
    data: { userId: null },
  });
  await (prisma as any).telegramAccount.upsert({
    where: { chatId },
    update: { userId: row.userId, state: "DONE", username: from?.username || null, firstNameTg: from?.first_name || null },
    create: { chatId, userId: row.userId, state: "DONE", username: from?.username || null, firstNameTg: from?.first_name || null },
  });

  return sendMessage(
    chatId,
    "Аккаунт привязан ✅ Теперь сюда будут приходить напоминания о приёмах пищи из приложения NÜTRIA.",
    MAIN_MENU_KEYBOARD
  );
}

// ─── Диспетчер апдейтов ──────────────────────────────────────────────────────

async function handleUpdate(prisma: PrismaClient, update: any) {
  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = String(cq.message.chat.id);
    const account = await getOrCreateAccount(prisma, chatId, cq.from);
    await answerCallback(cq.id);

    const data: string = cq.data || "";
    if (data.startsWith("stats:")) {
      return handleStatsCallback(chatId, account, Number(data.split(":")[1]) || 7);
    }
    if (data.startsWith("smartrem:")) {
      return handleSmartReminderCallback(prisma, account, chatId, data.slice("smartrem:".length));
    }
    if (data.startsWith("rem:")) {
      return handleReminderCallback(prisma, account, chatId, data.split(":")[1]);
    }
    // Шаги онбординга (sex / allergies / goal / tracking / unit / confirm)
    return handleOnboardingCallback(prisma, account, chatId, data);
  }

  const message = update.message;
  if (!message) return null;
  const chatId = String(message.chat.id);
  const account = await getOrCreateAccount(prisma, chatId, message.from);
  const text = typeof message.text === "string" ? message.text.trim() : "";

  // Диплинк из приложения: t.me/<bot>?start=<code> приходит как текст "/start <code>".
  // Проверяем раньше состояния NEW, иначе свежий чат всегда уходил бы в онбординг.
  const startParamMatch = text.match(/^\/start(?:\s+(\S+))?$/);
  if (startParamMatch) {
    if (startParamMatch[1]) return handleLinkCode(prisma, chatId, message.from, startParamMatch[1]);
    return startOnboarding(prisma, chatId);
  }
  const linkMatch = text.match(/^\/link\s+(\S+)/i);
  if (linkMatch) {
    return handleLinkCode(prisma, chatId, message.from, linkMatch[1]);
  }

  if (account.state === "NEW") {
    return startOnboarding(prisma, chatId);
  }

  // Состояния онбординга, ожидающие текстовый ввод
  if (
    ["ASK_NAME", "ASK_AGE", "ASK_HEIGHT", "ASK_WEIGHT", "ASK_ALLERGIES", "ASK_TARGETS_VALUES"].includes(
      account.state
    )
  ) {
    return handleOnboardingStep(prisma, account, chatId, text);
  }

  if (account.state === "AWAIT_MEAL_TEXT") {
    return handleAwaitMealText(prisma, account, chatId, message);
  }

  if (account.state === "AWAIT_GOAL_EDIT") {
    const draft: Draft = { targetsUnit: "grams" };
    return handleTargetsValuesInput(prisma, account, chatId, text, draft, "edit");
  }

  if (account.state === "AWAIT_REMINDER_TIME") {
    return handleAwaitReminderTime(prisma, account, chatId, text);
  }

  // По умолчанию (state DONE) — обрабатываем как команду меню
  return handleMenuCommand(prisma, account, chatId, text);
}

// ─── Напоминания (фоновый шедулер) ───────────────────────────────────────────

const lastReminderSent = new Map<string, string>(); // chatId -> "YYYY-MM-DD HH:MM" уже отправленного

function formatInTimezone(date: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  return { dateKey: `${get("year")}-${get("month")}-${get("day")}`, hm: `${get("hour")}:${get("minute")}` };
}

// Тот же временной разбор по приёмам пищи, что и в веб-дневнике (см.
// getCurrentMealType в ClientApp.tsx), чтобы голосовая запись из бота
// сразу попадала в ожидаемый приём пищи без лишнего вопроса пользователю.
function getCurrentMealType(tz: string): string {
  const { hm } = nowInTimezone(tz);
  const hour = Number(hm.split(":")[0]);
  if (hour >= 5 && hour < 11) return "BREAKFAST";
  if (hour >= 11 && hour < 16) return "LUNCH";
  if (hour >= 16 && hour < 22) return "DINNER";
  return "SNACK";
}

function nowInTimezone(tz: string) {
  return formatInTimezone(new Date(), tz);
}

function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

interface SmartReminderState {
  date: string;
  sentMeals: string[];
  sentCount: number;
}

function getSmartReminderState(account: any, dateKey: string): SmartReminderState {
  let state: SmartReminderState;
  try {
    state = JSON.parse(account.smartReminderStateJson || "{}");
  } catch {
    state = { date: "", sentMeals: [], sentCount: 0 };
  }
  if (state.date !== dateKey || !Array.isArray(state.sentMeals)) {
    state = { date: dateKey, sentMeals: [], sentCount: 0 };
  }
  return state;
}

async function hasMealLoggedToday(prisma: PrismaClient, userId: string, mealType: string, tz: string, dateKey: string): Promise<boolean> {
  const meals = await (prisma as any).meal.findMany({
    where: { userId, type: mealType },
    include: { items: true },
    orderBy: { date: "desc" },
    take: 10,
  });
  return meals.some((m: any) => m.items.length > 0 && formatInTimezone(new Date(m.date), tz).dateKey === dateKey);
}

function startSmartReminderScheduler(prisma: PrismaClient) {
  setInterval(async () => {
    try {
      const { dateKey, hm } = nowInTimezone(BOT_TIMEZONE);
      const nowMinutes = hmToMinutes(hm);
      const accounts = await (prisma as any).telegramAccount.findMany({
        where: { state: "DONE", userId: { not: null }, smartRemindersEnabled: true },
      });
      for (const account of accounts) {
        try {
          const state = getSmartReminderState(account, dateKey);
          let changed = state.date !== JSON.parse(account.smartReminderStateJson || "{}").date;
          for (const mealType of MEAL_REMINDER_ORDER) {
            if (state.sentCount >= account.smartReminderMaxPerDay) break;
            if (state.sentMeals.includes(mealType)) continue;
            const windowMinutes = hmToMinutes(MEAL_REMINDER_WINDOWS[mealType]);
            if (nowMinutes < windowMinutes + MEAL_REMINDER_DELAY_HOURS * 60) continue;

            const logged = await hasMealLoggedToday(prisma, account.userId, mealType, BOT_TIMEZONE, dateKey);
            state.sentMeals.push(mealType);
            changed = true;
            if (!logged) {
              await sendMessage(
                account.chatId,
                `Вы ещё не отметили ${MEAL_TYPES[mealType].toLowerCase()} сегодня. Не забудьте записать приём пищи в дневник! 🍽`,
                MAIN_MENU_KEYBOARD
              );
              state.sentCount += 1;
            }
          }
          if (changed) {
            await (prisma as any).telegramAccount.update({
              where: { chatId: account.chatId },
              data: { smartReminderStateJson: JSON.stringify(state) },
            });
          }
        } catch (e) {
          logError(`[telegram-bot] Smart reminder error for chat ${account.chatId}:`, e);
        }
      }
    } catch (e) {
      logError("[telegram-bot] Smart reminder scheduler error:", e);
    }
  }, 60_000);
}

function startReminderScheduler(prisma: PrismaClient) {
  setInterval(async () => {
    try {
      const { dateKey, hm } = nowInTimezone(BOT_TIMEZONE);
      const accounts = await (prisma as any).telegramAccount.findMany({
        where: { state: "DONE", userId: { not: null } },
      });
      for (const account of accounts) {
        const reminders: string[] = JSON.parse(account.remindersJson || "[]");
        if (!reminders.includes(hm)) continue;
        const sentKey = `${account.chatId}-${dateKey}-${hm}`;
        if (lastReminderSent.get(account.chatId) === sentKey) continue;
        lastReminderSent.set(account.chatId, sentKey);
        await sendMessage(account.chatId, "Не забудь записать сегодняшние приёмы пищи в дневник 🍽", MAIN_MENU_KEYBOARD);
      }
    } catch (e) {
      logError("[telegram-bot] Reminder scheduler error:", e);
    }
  }, 60_000);
}

// ─── Уведомления по событиям из веб-приложения (не из диалога бота) ─────────
// Используется, например, для напоминания о старте/завершении голодания —
// событие происходит в клиентском React-коде, а не в самом боте.

export async function notifyUserByTelegram(prisma: PrismaClient, userId: string, text: string): Promise<boolean> {
  if (!TELEGRAM_API) return false;
  try {
    const account = await (prisma as any).telegramAccount.findUnique({ where: { userId } });
    if (!account) return false;
    await sendMessage(account.chatId, text);
    return true;
  } catch (e) {
    logError("[telegram-bot] notifyUserByTelegram failed:", e);
    return false;
  }
}

// ─── Регистрация в Express ───────────────────────────────────────────────────

export function registerTelegramBot(app: Express, prisma: PrismaClient) {
  if (!TELEGRAM_API) {
    console.warn("[telegram-bot] TELEGRAM_BOT_TOKEN не задан — Telegram-бот отключён");
    return;
  }

  app.post("/api/telegram/webhook", (req: Request, res: Response) => {
    // Отвечаем Telegram немедленно — обработка идёт асинхронно,
    // чтобы Telegram не повторял запрос из-за тайм-аута.
    res.sendStatus(200);
    handleUpdate(prisma, req.body).catch((e) => {
      logError("[telegram-bot] Update handling error:", e);
    });
  });

  // Привязка существующего веб-аккаунта к Telegram-чату (Профиль → Настройки).
  app.post("/api/telegram/link-code", async (req: Request, res: Response) => {
    const userId = req.signedCookies?.token;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    await (prisma as any).telegramLinkCode.deleteMany({ where: { userId } });
    const code = generateLinkCode();
    const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS);
    await (prisma as any).telegramLinkCode.create({ data: { code, userId, expiresAt } });
    const username = await getBotUsername();
    res.json({
      code,
      expiresInMinutes: LINK_CODE_TTL_MS / 60000,
      deepLink: username ? `https://t.me/${username}?start=${code}` : null,
    });
  });

  app.get("/api/telegram/link-status", async (req: Request, res: Response) => {
    const userId = req.signedCookies?.token;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const account = await (prisma as any).telegramAccount.findUnique({ where: { userId } });
    res.json({
      linked: !!account,
      username: account?.username || null,
      firstName: account?.firstNameTg || null,
      smartRemindersEnabled: account?.smartRemindersEnabled ?? false,
      smartReminderMaxPerDay: account?.smartReminderMaxPerDay ?? 3,
    });
  });

  app.post("/api/telegram/unlink", async (req: Request, res: Response) => {
    const userId = req.signedCookies?.token;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    await (prisma as any).telegramAccount.updateMany({ where: { userId }, data: { userId: null } });
    res.json({ ok: true });
  });

  // Настройка умных напоминаний из веб-интерфейса — нужна клиентам, которые
  // привязали Telegram через код (а не завели аккаунт онбордингом в самом
  // боте) и не будут листать меню бота, чтобы их включить.
  app.post("/api/telegram/smart-reminders", async (req: Request, res: Response) => {
    const userId = req.signedCookies?.token;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const account = await (prisma as any).telegramAccount.findUnique({ where: { userId } });
    if (!account) return res.status(404).json({ error: "Telegram не привязан" });

    const data: { smartRemindersEnabled?: boolean; smartReminderMaxPerDay?: number } = {};
    if (typeof req.body.enabled === "boolean") data.smartRemindersEnabled = req.body.enabled;
    if (req.body.maxPerDay !== undefined) {
      const n = Math.max(1, Math.min(5, Number(req.body.maxPerDay) || 3));
      data.smartReminderMaxPerDay = n;
    }

    const updated = await (prisma as any).telegramAccount.update({ where: { userId }, data });
    res.json({
      smartRemindersEnabled: updated.smartRemindersEnabled,
      smartReminderMaxPerDay: updated.smartReminderMaxPerDay,
    });
  });

  // Уведомление о старте/завершении голодания — вызывается клиентским кодом
  // (таймер голодания живёт в localStorage, а не на сервере), отправляет
  // сообщение в Telegram, если у пользователя привязан аккаунт.
  app.post("/api/telegram/notify-fasting", validateBody(fastingNotifySchema), async (req: Request, res: Response) => {
    const userId = req.signedCookies?.token;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { event, fastingHours, eatingHours } = req.body as { event: "start" | "end"; fastingHours?: number; eatingHours?: number };
    const text =
      event === "start"
        ? `🕐 Голодание начато! Режим ${fastingHours ?? "—"}:${eatingHours ?? "—"}. Окно питания откроется через ${fastingHours ?? "—"} ч.`
        : "✅ Голодание завершено. Время истекло — можно открыть окно питания.";

    const sent = await notifyUserByTelegram(prisma, userId, text);
    res.json({ sent });
  });

  if (PUBLIC_URL) {
    tg("setWebhook", { url: `${PUBLIC_URL.replace(/\/$/, "")}/api/telegram/webhook` })
      .then(() => console.log("[telegram-bot] webhook установлен на", PUBLIC_URL))
      .catch((e) => logError("[telegram-bot] Не удалось установить webhook:", e));
  } else {
    console.warn(
      "[telegram-bot] PUBLIC_URL не задан — webhook нужно установить вручную (см. INTEGRATION.md)"
    );
  }

  startReminderScheduler(prisma);
  startSmartReminderScheduler(prisma);
  console.log("[telegram-bot] Telegram-бот зарегистрирован");
}
