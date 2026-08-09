/**
 * validation.ts — zod-схемы и middleware валидации тела запроса для server.ts и crm-routes.ts
 *
 * Заменяет ручные проверки (`if (!field) return res.status(400)...`) декларативными
 * схемами. При ошибке валидации middleware сам отдаёт 400 — обработчик роута
 * получает уже проверенные/приведённые к нужному типу данные в req.body.
 */

import { z } from "zod";
import type { Request, Response, NextFunction } from "express";

export function validateBody<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const issue = result.error.issues[0];
      return res.status(400).json({
        error: issue?.message || "Некорректные данные запроса",
        details: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    req.body = result.data;
    next();
  };
}

// ─── server.ts: клиентский дневник ──────────────────────────────────────────

export const aiGenerateSchema = z.object({
  prompt: z.string().min(1, "No prompt provided"),
  responseMimeType: z.string().optional(),
  image: z.any().optional(),
});

export const clientCrashSchema = z.object({
  exceptionType: z.string().regex(/^[A-Za-z0-9_.$]{1,160}$/),
  stackHash: z.string().regex(/^[a-f0-9]{64}$/),
  appVersion: z.string().trim().min(1).max(40),
  androidSdk: z.number().int().min(26).max(100),
  stage: z.enum(["startup", "runtime", "background"]),
}).strict();

export const sendMessageSchema = z.object({
  content: z.string().trim().min(1, "Текст сообщения обязателен"),
  nutritionistId: z.string().optional(),
});

export const customProductSchema = z.object({
  name: z.string().trim().min(1, "Название обязательно"),
  brand: z.string().trim().optional().nullable(),
  barcode: z.string().trim().optional().nullable(),
  calories: z.coerce.number().min(0, "Значение не может быть отрицательным").optional().default(0),
  protein: z.coerce.number().min(0, "Значение не может быть отрицательным").optional().default(0),
  fat: z.coerce.number().min(0, "Значение не может быть отрицательным").optional().default(0),
  carbs: z.coerce.number().min(0, "Значение не может быть отрицательным").optional().default(0),
});

const recipeIngredientSchema = z
  .object({
    productId: z.union([z.string(), z.number()]).optional(),
    name: z.string().optional(),
    weightGrams: z.coerce.number().optional(),
    calories: z.coerce.number().optional(),
    protein: z.coerce.number().optional(),
    fat: z.coerce.number().optional(),
    carbs: z.coerce.number().optional(),
  })
  .passthrough();

export const recipeSchema = z.object({
  name: z.string().trim().min(1, "Название блюда обязательно"),
  ingredients: z.array(recipeIngredientSchema).min(1, "Добавьте хотя бы один ингредиент"),
  cookedWeightGrams: z.coerce.number().optional(),
});

export const recipeImportUrlSchema = z.object({
  url: z.string().min(1, "Некорректная ссылка"),
});

export const photoRecognizeSchema = z.object({
  image: z.object({
    data: z.string().min(1, "Image payload is required"),
    mimeType: z.string().min(1, "Image payload is required"),
  }),
  mode: z.enum(["ingredients", "whole_dish"]).optional(),
});

export const recognitionCorrectionSchema = z
  .object({
    channel: z.enum(["photo", "voice", "diary"]).optional().default("photo"),
    sourceName: z.string().trim().min(1, "Correction payload is incomplete"),
    correctedProductId: z.string().trim().optional(),
    correctedProduct: z.object({ id: z.string().optional() }).passthrough().optional(),
    aliases: z.array(z.string()).optional(),
    visibleText: z.array(z.string()).optional(),
  })
  .refine((data) => Boolean(data.correctedProductId?.trim() || data.correctedProduct?.id), {
    message: "Correction payload is incomplete",
    path: ["correctedProductId"],
  });

// Backwards-compatible export for existing web clients.
export const photoCorrectionSchema = recognitionCorrectionSchema;

export const diaryGoalsSchema = z.object({
  calories: z.coerce.number().positive("Invalid goals payload"),
  protein: z.coerce.number().positive("Invalid goals payload"),
  fat: z.coerce.number().positive("Invalid goals payload"),
  carbs: z.coerce.number().positive("Invalid goals payload"),
  fiber: z.coerce.number().optional().default(0),
});

export const diaryWaterSchema = z.object({
  amount: z.coerce.number().optional().default(0),
  date: z.string().optional(),
});

export const activitySchema = z.object({
  date: z.string().optional(),
  activityName: z.string().trim().min(1, "Invalid activity payload"),
  durationMinutes: z.coerce.number().finite("Invalid activity payload"),
  caloriesBurned: z.coerce.number().finite("Invalid activity payload"),
});

export const weightSchema = z.object({
  date: z.string().optional(),
  weightKg: z.coerce.number().positive("Invalid weight payload"),
});

export const diaryAddSchema = z.object({
  productId: z.union([z.string(), z.number()]).transform(String),
  amount: z.coerce.number(),
  type: z.enum(["BREAKFAST", "LUNCH", "DINNER", "SNACK", "WATER"]).optional().default("SNACK"),
  usdaData: z.any().optional(),
  date: z.string().optional(),
});

// «Повторить вчера»: копирование позиций одного приёма пищи с даты на дату.
export const diaryCopySchema = z.object({
  type: z.enum(["BREAKFAST", "LUNCH", "DINNER", "SNACK"]),
  fromDate: z.string(),
  toDate: z.string().optional(),
});

export const fastingNotifySchema = z.object({
  event: z.enum(["start", "end"]),
  fastingHours: z.coerce.number().min(0).max(48).optional(),
  eatingHours: z.coerce.number().min(0).max(48).optional(),
});

export const diaryItemAmountSchema = z.object({
  amount: z.coerce.number().positive("Invalid amount"),
});

export const quickAddSchema = z.object({
  date: z.string().optional(),
  mealType: z.enum(["BREAKFAST", "LUNCH", "DINNER", "SNACK", "WATER"]).optional(),
  label: z.string().trim().min(1, "Invalid quick-add payload"),
  calories: z.coerce.number().min(0, "Invalid quick-add payload"),
  protein: z.coerce.number().min(0, "Значение не может быть отрицательным").optional().default(0),
  fat: z.coerce.number().min(0, "Значение не может быть отрицательным").optional().default(0),
  carbs: z.coerce.number().min(0, "Значение не может быть отрицательным").optional().default(0),
});

export const voiceParseSchema = z.object({
  transcript: z.string().min(1, "No transcript provided"),
});

// ─── crm-routes.ts ───────────────────────────────────────────────────────────

export const crmRegisterSchema = z.object({
  email: z.string().trim().toLowerCase().email("Некорректный email"),
  password: z.string().min(6, "Пароль должен содержать минимум 6 символов"),
  firstName: z.string().trim().min(1, "Обязательные поля: email, password, firstName, lastName"),
  lastName: z.string().trim().min(1, "Обязательные поля: email, password, firstName, lastName"),
  specialization: z.string().trim().optional().nullable(),
});

export const crmLoginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1, "Email и пароль обязательны"),
  password: z.string().min(1, "Email и пароль обязательны"),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Введите текущий пароль"),
  newPassword: z.string().min(6, "Новый пароль должен содержать минимум 6 символов"),
});

export const crmCreateClientSchema = z.object({
  clientName: z.string().trim().optional().nullable(),
  secretPhrase: z.string().trim().min(3, "Секретная фраза должна содержать минимум 3 символа"),
  tags: z.array(z.string()).optional(),
});

export const crmUpdateClientSchema = z.object({
  clientName: z.string().optional().nullable(),
  status: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const crmNoteSchema = z.object({
  content: z.string().trim().min(1, "Текст заметки обязателен"),
  context: z.string().optional().nullable(),
});

export const crmRecommendationSchema = z.object({
  content: z.string().trim().min(1, "Текст рекомендации обязателен"),
});

export const crmConsultationSchema = z.object({
  scheduledAt: z.coerce.date({ error: "Дата обязательна" }),
  note: z.string().optional().nullable(),
});

export const crmMealPlanItemSchema = z
  .object({
    dayOfWeek: z.coerce.number().optional(),
    mealType: z.string().optional(),
    productId: z.union([z.string(), z.number()]),
    amountGrams: z.coerce.number().optional(),
  })
  .passthrough();

export const crmMealPlanSchema = z.object({
  title: z.string().trim().min(1, "Название и дата начала недели обязательны"),
  weekStartDate: z.coerce.date({ error: "Название и дата начала недели обязательны" }),
  items: z.array(crmMealPlanItemSchema).min(1, "План должен содержать хотя бы один продукт"),
});

export const crmClientMessageSchema = z.object({
  content: z.string().trim().min(1, "Текст сообщения обязателен"),
});

const crmProfileBaseSchema = {
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  birthYear: z.coerce.number().optional(),
  sex: z.string().optional(),
  heightCm: z.coerce.number().optional(),
  weightKg: z.coerce.number().optional(),
  goal: z.string().optional(),
  activity: z.string().optional(),
  dietRestrictions: z.string().optional().nullable(),
  allergies: z.array(z.string()).optional(),
  complaints: z.string().optional().nullable(),
};

export const crmClientProfilePatchSchema = z.object({
  ...crmProfileBaseSchema,
  sleepQuality: z.string().optional().nullable(),
  badHabits: z.string().optional().nullable(),
  chronicDiseases: z.string().optional().nullable(),
  surgeries: z.string().optional().nullable(),
  medications: z.string().optional().nullable(),
  gutHealth: z.string().optional().nullable(),
});

export const onboardLoginSchema = z.object({
  secretPhrase: z.string().trim().min(1, "Неверная секретная фраза"),
});

export const onboardCompleteSchema = z.object({
  // Обязательна только для CLIENT-приглашений (проверяется в обработчике, т.к. схема
  // не знает роль на момент валидации). NUTRITIONIST/ADMIN вместо этого задают password.
  secretPhrase: z.string().trim().optional(),
  password: z.string().min(6, "Пароль должен быть не короче 6 символов").optional(),
  firstName: z.string().trim().optional(),
  lastName: z.string().trim().optional(),
  profile: z
    .object({
      ...crmProfileBaseSchema,
    })
    .partial()
    .optional(),
});

export const crmInviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Некорректный email"),
  name: z.string().trim().min(1, "Имя обязательно"),
  role: z.enum(["CLIENT", "NUTRITIONIST", "ADMIN"], { error: "Некорректная роль" }),
});
