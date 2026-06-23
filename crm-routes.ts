/**
 * crm-routes.ts — CRM API маршруты для NÜTRIA MVP
 *
 * Подключение в server.ts:
 *   import { registerCrmRoutes } from "./crm-routes.js";
 *   // ... после инициализации app:
 *   registerCrmRoutes(app, prisma);
 */

import type { Express, Request, Response, NextFunction } from "express";
import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import multer from "multer";
import {
  validateBody,
  crmRegisterSchema,
  crmLoginSchema,
  crmCreateClientSchema,
  crmUpdateClientSchema,
  crmNoteSchema,
  crmRecommendationSchema,
  crmConsultationSchema,
  crmMealPlanSchema,
  crmClientMessageSchema,
  crmClientProfilePatchSchema,
  onboardLoginSchema,
  onboardCompleteSchema,
} from "./validation.ts";

const upload = multer({ storage: multer.memoryStorage() });

const JWT_SECRET = process.env.JWT_SECRET || "nutria-jwt-secret-change-in-prod";
const JWT_EXPIRES = "30d";
const SALT_ROUNDS = 10;

// ─── JWT helpers ──────────────────────────────────────────────────────────────

function signToken(payload: object) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function verifyToken(token: string): any {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// ─── Auth middleware ──────────────────────────────────────────────────────────

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const raw = req.cookies?.jwtToken || req.headers.authorization?.replace("Bearer ", "");
  if (!raw) return res.status(401).json({ error: "Unauthorized" });
  const payload = verifyToken(raw);
  if (!payload) return res.status(401).json({ error: "Invalid token" });
  (req as any).user = payload;
  next();
}

function requireNutritionist(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    if ((req as any).user?.role !== "NUTRITIONIST") {
      return res.status(403).json({ error: "Forbidden: nutritionist role required" });
    }
    next();
  });
}

// Сотрудники (нутрициологи/админы) — все остальные роли считаются клиентами
// дневника питания, включая общий демо-аккаунт ("USER") и любые будущие значения.
const STAFF_ROLES = ["NUTRITIONIST", "ADMIN"];
function isClientRole(role: string | null | undefined) {
  return !!role && !STAFF_ROLES.includes(role);
}

// ─── BMR / TDEE расчёты ──────────────────────────────────────────────────────

const PAL: Record<string, number> = {
  low: 1.2,
  moderate: 1.55,
  high: 1.725,
  very_high: 1.9,
};

function calcBMR(sex: string, weightKg: number, heightCm: number, age: number): number {
  // Формула Миффлина-Сан Жеора
  if (sex === "female") {
    return 10 * weightKg + 6.25 * heightCm - 5 * age - 161;
  }
  return 10 * weightKg + 6.25 * heightCm - 5 * age + 5;
}

function calcTDEE(bmr: number, activity: string): number {
  return Math.round(bmr * (PAL[activity] ?? 1.55));
}

function calcBMI(weightKg: number, heightCm: number): number {
  return Number((weightKg / Math.pow(heightCm / 100, 2)).toFixed(1));
}

function calcTargetKbzhu(
  tdee: number,
  goal: string
): { calories: number; protein: number; fat: number; carbs: number; fiber: number } {
  let calories = tdee;
  if (goal === "lose") calories = Math.round(tdee * 0.85);
  if (goal === "gain") calories = Math.round(tdee * 1.1);

  // Стандартное распределение макронутриентов
  const protein = Math.round((calories * 0.25) / 4);
  const fat = Math.round((calories * 0.3) / 9);
  const carbs = Math.round((calories * 0.45) / 4);
  const fiber = 25;

  return { calories, protein, fat, carbs, fiber };
}

// ─── Регистрация маршрутов ────────────────────────────────────────────────────

export function registerCrmRoutes(app: Express, prisma: PrismaClient) {

  // ── AUTH: регистрация нутрициолога ─────────────────────────────────────────

  app.post("/api/crm/auth/register", validateBody(crmRegisterSchema), async (req: Request, res: Response) => {
    try {
      const { email, password, firstName, lastName, specialization } = req.body;

      const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
      if (existing) return res.status(409).json({ error: "Email уже зарегистрирован" });

      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
      const user = await prisma.user.create({
        data: {
          email: email.toLowerCase(),
          passwordHash,
          role: "NUTRITIONIST",
          nutritionistProfile: {
            create: { firstName, lastName, specialization: specialization || null },
          },
        },
        include: { nutritionistProfile: true },
      });

      const token = signToken({ id: user.id, role: user.role, email: user.email });
      res.cookie("jwtToken", token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 30 * 24 * 3600 * 1000 });
      return res.json({
        user: { id: user.id, email: user.email, role: user.role, profile: user.nutritionistProfile },
        token,
      });
    } catch (e: any) {
      console.error("Register error:", e);
      return res.status(500).json({ error: "Ошибка сервера", message: e.message });
    }
  });

  // ── AUTH: вход нутрициолога ─────────────────────────────────────────────────

  app.post("/api/crm/auth/login", validateBody(crmLoginSchema), async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;

      const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
        include: { nutritionistProfile: true },
      });
      if (!user || user.role !== "NUTRITIONIST") {
        return res.status(401).json({ error: "Неверный email или пароль" });
      }

      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) return res.status(401).json({ error: "Неверный email или пароль" });

      const token = signToken({ id: user.id, role: user.role, email: user.email });
      res.cookie("jwtToken", token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 30 * 24 * 3600 * 1000 });
      return res.json({
        user: { id: user.id, email: user.email, role: user.role, profile: user.nutritionistProfile },
        token,
      });
    } catch (e: any) {
      console.error("Login error:", e);
      return res.status(500).json({ error: "Ошибка сервера", message: e.message });
    }
  });

  // ── AUTH: текущий пользователь ─────────────────────────────────────────────

  app.get("/api/crm/auth/me", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user.id;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { nutritionistProfile: true, clientProfile: true },
      });
      if (!user) return res.status(404).json({ error: "Пользователь не найден" });
      return res.json({ user: { id: user.id, email: user.email, role: user.role, profile: user.nutritionistProfile || user.clientProfile } });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ── AUTH: выход ─────────────────────────────────────────────────────────────

  app.post("/api/crm/auth/logout", (_req: Request, res: Response) => {
    res.clearCookie("jwtToken");
    res.json({ success: true });
  });

  // ── КЛИЕНТЫ: список ────────────────────────────────────────────────────────

  app.get("/api/crm/clients", requireNutritionist, async (req: Request, res: Response) => {
    try {
      const nutritionistId = (req as any).user.id;

      // Показываем ВСЕХ зарегистрированных клиентов дневника питания (app.nutria.one),
      // а не только тех, кого пригласил именно этот нутрициолог. Клиент — любой
      // пользователь, кроме сотрудников (нутрициологов/админов), включая общий
      // демо-аккаунт веб-приложения и аккаунты, созданные через Telegram-бота.
      const clientUsers = await prisma.user.findMany({
        where: { role: { notIn: STAFF_ROLES } },
        include: {
          clientProfile: true,
          inviteReceived: { include: { nutritionist: { include: { nutritionistProfile: true } } } },
          telegramAccount: true,
          meals: { select: { date: true }, orderBy: { date: "desc" }, take: 1 },
        },
        orderBy: { createdAt: "desc" },
      });

      const clients = clientUsers.map((u: any) => {
        const invite = u.inviteReceived;
        const profile = u.clientProfile;
        const source = invite ? "invite" : u.telegramAccount ? "telegram" : "self";
        return {
          clientId: u.id,
          inviteId: invite?.id || null,
          token: invite?.token || null,
          clientName: profile
            ? `${profile.firstName || ""} ${profile.lastName || ""}`.trim() || invite?.clientName || "Без имени"
            : invite?.clientName || "Без имени",
          status: invite?.status || "ACTIVE",
          tagsJson: invite?.tagsJson || "[]",
          createdAt: u.createdAt,
          usedAt: invite?.usedAt || null,
          source,
          nutritionistName: invite?.nutritionist?.nutritionistProfile
            ? `${invite.nutritionist.nutritionistProfile.firstName} ${invite.nutritionist.nutritionistProfile.lastName}`
            : null,
          isOwnInvite: invite?.nutritionistId === nutritionistId,
          lastActivityAt: u.meals?.[0]?.date || null,
          // Краткие данные анкеты
          profile: profile
            ? {
                sex: profile.sex,
                weightKg: profile.weightKg,
                heightCm: profile.heightCm,
                goal: profile.goal,
              }
            : null,
        };
      });

      return res.json({ clients });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ── КЛИЕНТЫ: создать приглашение ──────────────────────────────────────────

  app.post("/api/crm/clients", requireNutritionist, validateBody(crmCreateClientSchema), async (req: Request, res: Response) => {
    try {
      const nutritionistId = (req as any).user.id;
      const { clientName, secretPhrase, tags } = req.body;

      const invite = await (prisma as any).clientInvite.create({
        data: {
          nutritionistId,
          clientName: clientName || null,
          secretPhrase,
          tagsJson: JSON.stringify(tags || []),
          status: "PENDING",
        },
      });

      const inviteUrl = `${req.protocol}://${req.get("host")}/onboard/${invite.token}`;

      return res.json({ invite, inviteUrl });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ── КЛИЕНТ: детальная карточка ─────────────────────────────────────────────

  app.get("/api/crm/clients/:clientId", requireNutritionist, async (req: Request, res: Response) => {
    try {
      const { clientId } = req.params;

      const user = await prisma.user.findUnique({
        where: { id: clientId },
        include: { clientProfile: true, inviteReceived: true },
      });
      if (!user || !isClientRole(user.role)) return res.status(404).json({ error: "Клиент не найден" });

      const invite = (user as any).inviteReceived;

      // Вычисляем ИМТ/BMR/TDEE если есть данные
      let calculations: any = null;
      const p = user?.clientProfile;
      if (p?.weightKg && p?.heightCm && p?.birthYear && p?.sex && p?.activity) {
        const age = new Date().getFullYear() - p.birthYear;
        const bmr = calcBMR(p.sex, p.weightKg, p.heightCm, age);
        const tdee = calcTDEE(bmr, p.activity);
        const bmi = calcBMI(p.weightKg, p.heightCm);
        const kbzhu = calcTargetKbzhu(tdee, p.goal || "maintain");
        calculations = { bmi, bmr: Math.round(bmr), tdee, ...kbzhu };
      }

      return res.json({
        invite: invite
          ? { id: invite.id, token: invite.token, status: invite.status, clientName: invite.clientName, tagsJson: invite.tagsJson, createdAt: invite.createdAt, usedAt: invite.usedAt }
          : null,
        profile: user?.clientProfile || null,
        calculations,
      });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ── КЛИЕНТ: обновить теги/статус/имя ─────────────────────────────────────

  app.patch("/api/crm/clients/:clientId", requireNutritionist, validateBody(crmUpdateClientSchema), async (req: Request, res: Response) => {
    try {
      const nutritionistId = (req as any).user.id;
      const { clientId } = req.params;
      const { clientName, status, tags } = req.body;

      const clientUser = await prisma.user.findUnique({ where: { id: clientId } });
      if (!clientUser || !isClientRole(clientUser.role)) return res.status(404).json({ error: "Клиент не найден" });

      let invite = await (prisma as any).clientInvite.findFirst({ where: { clientId } });
      if (!invite) {
        // Клиент пришёл не через приглашение этого нутрициолога (например, через Telegram-бота)
        // — создаём служебную запись приглашения, чтобы хранить теги/статус.
        invite = await (prisma as any).clientInvite.create({
          data: {
            nutritionistId,
            clientId,
            clientName: clientName || null,
            secretPhrase: "—",
            status: "ACTIVE",
            usedAt: new Date(),
          },
        });
      }

      const updated = await (prisma as any).clientInvite.update({
        where: { id: invite.id },
        data: {
          ...(clientName !== undefined && { clientName }),
          ...(status !== undefined && { status }),
          ...(tags !== undefined && { tagsJson: JSON.stringify(tags) }),
        },
      });

      return res.json({ invite: updated });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ── ДНЕВНИК КЛИЕНТА (просмотр для нутрициолога) ───────────────────────────

  app.get("/api/crm/clients/:clientId/diary", requireNutritionist, async (req: Request, res: Response) => {
    try {
      const { clientId } = req.params;
      const { date, days = "7" } = req.query;

      const clientUser = await prisma.user.findUnique({ where: { id: clientId } });
      if (!clientUser || !isClientRole(clientUser.role)) return res.status(404).json({ error: "Клиент не найден" });

      const endDate = date ? new Date(String(date)) : new Date();
      endDate.setHours(23, 59, 59, 999);
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - (Number(days) - 1));
      startDate.setHours(0, 0, 0, 0);

      const meals = await prisma.meal.findMany({
        where: {
          userId: clientId,
          date: { gte: startDate, lte: endDate },
        },
        include: {
          items: { include: { product: true } },
        },
        orderBy: { date: "desc" },
      });

      return res.json({ meals });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ── ВЕС КЛИЕНТА (просмотр для нутрициолога) ───────────────────────────────

  app.get("/api/crm/clients/:clientId/weight-history", requireNutritionist, async (req: Request, res: Response) => {
    try {
      const { clientId } = req.params;
      const { days = "90" } = req.query;

      const clientUser = await prisma.user.findUnique({ where: { id: clientId } });
      if (!clientUser || !isClientRole(clientUser.role)) return res.status(404).json({ error: "Клиент не найден" });

      const since = new Date();
      since.setDate(since.getDate() - Number(days));

      const logs = await (prisma as any).weightLog.findMany({
        where: { userId: clientId, date: { gte: since } },
        orderBy: { date: "asc" },
      });

      return res.json({ history: logs.map((l: any) => ({ date: l.date, weightKg: l.weightKg })) });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ── АНАЛИТИКА КЛИЕНТА ЗА ПЕРИОД ────────────────────────────────────────────

  app.get("/api/crm/clients/:clientId/analytics", requireNutritionist, async (req: Request, res: Response) => {
    try {
      const { clientId } = req.params;
      const days = Math.min(180, Math.max(1, parseInt(String(req.query.days ?? "30"), 10) || 30));

      const clientUser = await prisma.user.findUnique({ where: { id: clientId } });
      if (!clientUser || !isClientRole(clientUser.role)) return res.status(404).json({ error: "Клиент не найден" });

      const since = new Date();
      since.setDate(since.getDate() - days);

      const [meals, goals, weightLogs] = await Promise.all([
        prisma.meal.findMany({
          where: { userId: clientId, date: { gte: since }, type: { not: "WATER" } },
          include: { items: { include: { product: true } } },
        }),
        prisma.nutrientGoal.findUnique({ where: { userId: clientId } }),
        (prisma as any).weightLog.findMany({ where: { userId: clientId, date: { gte: since } }, orderBy: { date: "asc" } }),
      ]);

      const dayTotals = new Map<string, { calories: number; protein: number; fat: number; carbs: number }>();
      for (const meal of meals) {
        const key = meal.date.toISOString().slice(0, 10);
        const point = dayTotals.get(key) || { calories: 0, protein: 0, fat: 0, carbs: 0 };
        for (const item of meal.items) {
          const factor = item.amount / 100;
          const product = item.product || ({} as any);
          point.calories += (product.calories || 0) * factor;
          point.protein += (product.protein || 0) * factor;
          point.fat += (product.fat || 0) * factor;
          point.carbs += (product.carbs || 0) * factor;
        }
        dayTotals.set(key, point);
      }

      const trackedDays = Array.from(dayTotals.values());
      const n = trackedDays.length || 1;
      const avgCalories = trackedDays.reduce((s, d) => s + d.calories, 0) / n;
      const avgProtein = trackedDays.reduce((s, d) => s + d.protein, 0) / n;
      const avgFat = trackedDays.reduce((s, d) => s + d.fat, 0) / n;
      const avgCarbs = trackedDays.reduce((s, d) => s + d.carbs, 0) / n;

      const calGoalHitDays = goals
        ? trackedDays.filter((d) => Math.abs(d.calories - goals.calories) / Math.max(1, goals.calories) <= 0.1).length
        : 0;

      const weightTrend = weightLogs.map((w: any) => ({ date: new Date(w.date).toISOString().slice(0, 10), weightKg: w.weightKg }));

      return res.json({
        days,
        trackedDays: trackedDays.length,
        avgCalories: Math.round(avgCalories),
        avgProtein: Math.round(avgProtein),
        avgFat: Math.round(avgFat),
        avgCarbs: Math.round(avgCarbs),
        calGoalHitDays,
        goals,
        weightTrend,
      });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ── ЗАМЕТКИ: список ────────────────────────────────────────────────────────

  app.get("/api/crm/clients/:clientId/notes", requireNutritionist, async (req: Request, res: Response) => {
    try {
      const nutritionistId = (req as any).user.id;
      const { clientId } = req.params;

      const notes = await (prisma as any).clientNote.findMany({
        where: { nutritionistId, clientId },
        orderBy: { createdAt: "desc" },
      });

      return res.json({ notes });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ── ЗАМЕТКИ: создать ───────────────────────────────────────────────────────

  app.post("/api/crm/clients/:clientId/notes", requireNutritionist, validateBody(crmNoteSchema), async (req: Request, res: Response) => {
    try {
      const nutritionistId = (req as any).user.id;
      const { clientId } = req.params;
      const { content, context } = req.body;

      const note = await (prisma as any).clientNote.create({
        data: {
          nutritionistId,
          clientId,
          content,
          context: context || null,
        },
      });

      return res.json({ note });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ── ЗАМЕТКИ: удалить ───────────────────────────────────────────────────────

  app.delete("/api/crm/clients/:clientId/notes/:noteId", requireNutritionist, async (req: Request, res: Response) => {
    try {
      const nutritionistId = (req as any).user.id;
      const { clientId, noteId } = req.params;

      const note = await (prisma as any).clientNote.findFirst({
        where: { id: noteId, nutritionistId, clientId },
      });
      if (!note) return res.status(404).json({ error: "Заметка не найдена" });

      await (prisma as any).clientNote.delete({ where: { id: noteId } });
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ── АНАЛИЗЫ: список ────────────────────────────────────────────────────────

  app.get("/api/crm/clients/:clientId/analyses", requireNutritionist, async (req: Request, res: Response) => {
    try {
      const nutritionistId = (req as any).user.id;
      const { clientId } = req.params;

      const analyses = await (prisma as any).analysisFile.findMany({
        where: { nutritionistId, clientId },
        orderBy: { takenAt: "desc" },
        // Не возвращаем base64 в списке — только метаданные
        select: { id: true, fileName: true, mimeType: true, note: true, takenAt: true, createdAt: true },
      });

      return res.json({ analyses });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ── АНАЛИЗЫ: загрузить файл ────────────────────────────────────────────────

  app.post(
    "/api/crm/clients/:clientId/analyses",
    requireNutritionist,
    upload.single("file"),
    async (req: Request, res: Response) => {
      try {
        const nutritionistId = (req as any).user.id;
        const { clientId } = req.params;
        const { note, takenAt } = req.body;

        if (!req.file) return res.status(400).json({ error: "Файл обязателен" });

        const dataBase64 = req.file.buffer.toString("base64");
        const analysis = await (prisma as any).analysisFile.create({
          data: {
            nutritionistId,
            clientId,
            fileName: req.file.originalname,
            mimeType: req.file.mimetype,
            dataBase64,
            note: note || null,
            takenAt: takenAt ? new Date(takenAt) : new Date(),
          },
        });

        return res.json({
          analysis: {
            id: analysis.id,
            fileName: analysis.fileName,
            mimeType: analysis.mimeType,
            note: analysis.note,
            takenAt: analysis.takenAt,
            createdAt: analysis.createdAt,
          },
        });
      } catch (e: any) {
        return res.status(500).json({ error: e.message });
      }
    }
  );

  // ── АНАЛИЗЫ: скачать файл ─────────────────────────────────────────────────

  app.get("/api/crm/clients/:clientId/analyses/:analysisId/download", requireNutritionist, async (req: Request, res: Response) => {
    try {
      const nutritionistId = (req as any).user.id;
      const { clientId, analysisId } = req.params;

      const analysis = await (prisma as any).analysisFile.findFirst({
        where: { id: analysisId, nutritionistId, clientId },
      });
      if (!analysis) return res.status(404).json({ error: "Файл не найден" });

      const buffer = Buffer.from(analysis.dataBase64, "base64");
      res.setHeader("Content-Type", analysis.mimeType);
      res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(analysis.fileName)}"`);
      return res.send(buffer);
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ── АНАЛИЗЫ: удалить ──────────────────────────────────────────────────────

  app.delete("/api/crm/clients/:clientId/analyses/:analysisId", requireNutritionist, async (req: Request, res: Response) => {
    try {
      const nutritionistId = (req as any).user.id;
      const { clientId, analysisId } = req.params;

      const analysis = await (prisma as any).analysisFile.findFirst({
        where: { id: analysisId, nutritionistId, clientId },
      });
      if (!analysis) return res.status(404).json({ error: "Файл не найден" });

      await (prisma as any).analysisFile.delete({ where: { id: analysisId } });
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ── РЕКОМЕНДАЦИИ: список ──────────────────────────────────────────────────

  app.get("/api/crm/clients/:clientId/recommendations", requireNutritionist, async (req: Request, res: Response) => {
    try {
      const nutritionistId = (req as any).user.id;
      const { clientId } = req.params;

      const recs = await (prisma as any).recommendation.findMany({
        where: { nutritionistId, clientId },
        orderBy: { createdAt: "desc" },
      });

      return res.json({ recommendations: recs });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ── РЕКОМЕНДАЦИИ: создать ─────────────────────────────────────────────────

  app.post("/api/crm/clients/:clientId/recommendations", requireNutritionist, validateBody(crmRecommendationSchema), async (req: Request, res: Response) => {
    try {
      const nutritionistId = (req as any).user.id;
      const { clientId } = req.params;
      const { content } = req.body;

      const rec = await (prisma as any).recommendation.create({
        data: { nutritionistId, clientId, content },
      });

      return res.json({ recommendation: rec });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ── РЕКОМЕНДАЦИИ: удалить ─────────────────────────────────────────────────

  app.delete("/api/crm/clients/:clientId/recommendations/:recId", requireNutritionist, async (req: Request, res: Response) => {
    try {
      const nutritionistId = (req as any).user.id;
      const { clientId, recId } = req.params;

      const rec = await (prisma as any).recommendation.findFirst({
        where: { id: recId, nutritionistId, clientId },
      });
      if (!rec) return res.status(404).json({ error: "Рекомендация не найдена" });

      await (prisma as any).recommendation.delete({ where: { id: recId } });
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ── КОНСУЛЬТАЦИИ: список ──────────────────────────────────────────────────

  app.get("/api/crm/consultations", requireNutritionist, async (req: Request, res: Response) => {
    try {
      const nutritionistId = (req as any).user.id;

      const consultations = await (prisma as any).consultationDate.findMany({
        where: { nutritionistId },
        orderBy: { scheduledAt: "asc" },
      });

      return res.json({ consultations });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ── КОНСУЛЬТАЦИИ: добавить ────────────────────────────────────────────────

  app.post("/api/crm/clients/:clientId/consultations", requireNutritionist, validateBody(crmConsultationSchema), async (req: Request, res: Response) => {
    try {
      const nutritionistId = (req as any).user.id;
      const { clientId } = req.params;
      const { scheduledAt, note } = req.body;

      const consultation = await (prisma as any).consultationDate.create({
        data: {
          nutritionistId,
          clientId,
          scheduledAt,
          note: note || null,
        },
      });

      return res.json({ consultation });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ── ПЛАНЫ ПИТАНИЯ: список для клиента ──────────────────────────────────────

  app.get("/api/crm/clients/:clientId/meal-plans", requireNutritionist, async (req: Request, res: Response) => {
    try {
      const { clientId } = req.params;
      const clientUser = await prisma.user.findUnique({ where: { id: clientId } });
      if (!clientUser || !isClientRole(clientUser.role)) return res.status(404).json({ error: "Клиент не найден" });

      const plans = await (prisma as any).mealPlan.findMany({
        where: { clientId },
        include: { items: true },
        orderBy: { weekStartDate: "desc" },
      });
      return res.json({ plans });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ── ПЛАНЫ ПИТАНИЯ: создать ──────────────────────────────────────────────────

  app.post("/api/crm/clients/:clientId/meal-plans", requireNutritionist, validateBody(crmMealPlanSchema), async (req: Request, res: Response) => {
    try {
      const nutritionistId = (req as any).user.id;
      const { clientId } = req.params;
      const { title, weekStartDate, items } = req.body;

      const clientUser = await prisma.user.findUnique({ where: { id: clientId } });
      if (!clientUser || !isClientRole(clientUser.role)) return res.status(404).json({ error: "Клиент не найден" });

      const plan = await (prisma as any).mealPlan.create({
        data: {
          nutritionistId,
          clientId,
          title,
          weekStartDate,
          items: {
            create: items.map((it: any) => ({
              dayOfWeek: Math.min(6, Math.max(0, parseInt(it.dayOfWeek, 10) || 0)),
              mealType: String(it.mealType || "BREAKFAST"),
              productId: String(it.productId),
              amountGrams: Math.max(1, Number(it.amountGrams) || 100),
            })),
          },
        },
        include: { items: { include: { product: true } } },
      });

      return res.json({ plan });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ── ПЛАНЫ ПИТАНИЯ: получить один (с продуктами) ─────────────────────────────

  app.get("/api/crm/meal-plans/:planId", requireNutritionist, async (req: Request, res: Response) => {
    try {
      const nutritionistId = (req as any).user.id;
      const { planId } = req.params;
      const plan = await (prisma as any).mealPlan.findUnique({
        where: { id: planId },
        include: { items: { include: { product: true } } },
      });
      if (!plan || plan.nutritionistId !== nutritionistId) return res.status(404).json({ error: "План не найден" });
      return res.json({ plan });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ── ПЛАНЫ ПИТАНИЯ: удалить ───────────────────────────────────────────────────

  app.delete("/api/crm/meal-plans/:planId", requireNutritionist, async (req: Request, res: Response) => {
    try {
      const nutritionistId = (req as any).user.id;
      const { planId } = req.params;
      const plan = await (prisma as any).mealPlan.findUnique({ where: { id: planId } });
      if (!plan || plan.nutritionistId !== nutritionistId) return res.status(404).json({ error: "План не найден" });

      await (prisma as any).mealPlan.delete({ where: { id: planId } });
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ── ПЛАНЫ ПИТАНИЯ: список покупок ────────────────────────────────────────────
  // Грубая категоризация по ключевым словам в названии продукта — без AI,
  // т.к. в Product нет поля category, а для списка покупок нужна стабильность.
  const SHOPPING_CATEGORY_KEYWORDS: { category: string; keywords: string[] }[] = [
    { category: "Овощи и фрукты", keywords: ["яблок", "банан", "помидор", "огурец", "картоф", "морков", "лук", "капуст", "перец", "зелен", "салат", "фрукт", "овощ", "ягод", "лимон", "апельсин", "чеснок", "свекл", "тыкв", "кабачок"] },
    { category: "Молочные продукты", keywords: ["молок", "сыр", "творог", "йогурт", "кефир", "сметан", "масло слив", "сливк"] },
    { category: "Мясо, рыба, яйца", keywords: ["мясо", "курин", "куриц", "говяд", "свин", "индейк", "рыба", "лосос", "тунец", "яйцо", "яйца", "фарш", "колбас"] },
    { category: "Крупы, мука, бакалея", keywords: ["мука", "рис", "греч", "овес", "макарон", "паста", "крупа", "сахар", "соль", "масло раст", "хлеб"] },
  ];
  function categorizeProductName(name: string): string {
    const lower = name.toLowerCase();
    for (const { category, keywords } of SHOPPING_CATEGORY_KEYWORDS) {
      if (keywords.some((kw) => lower.includes(kw))) return category;
    }
    return "Прочее";
  }

  app.post("/api/crm/meal-plans/:planId/shopping-list", requireNutritionist, async (req: Request, res: Response) => {
    try {
      const nutritionistId = (req as any).user.id;
      const { planId } = req.params;
      const plan = await (prisma as any).mealPlan.findUnique({
        where: { id: planId },
        include: { items: { include: { product: true } } },
      });
      if (!plan || plan.nutritionistId !== nutritionistId) return res.status(404).json({ error: "План не найден" });

      const totalsByProduct = new Map<string, { name: string; totalGrams: number }>();
      for (const item of plan.items) {
        const key = item.productId;
        const entry = totalsByProduct.get(key) || { name: item.product.name, totalGrams: 0 };
        entry.totalGrams += item.amountGrams;
        totalsByProduct.set(key, entry);
      }

      const grouped = new Map<string, { name: string; totalGrams: number }[]>();
      for (const entry of totalsByProduct.values()) {
        const category = categorizeProductName(entry.name);
        if (!grouped.has(category)) grouped.set(category, []);
        grouped.get(category)!.push({ name: entry.name, totalGrams: Math.round(entry.totalGrams) });
      }

      const shoppingList = Array.from(grouped.entries()).map(([category, items]) => ({
        category,
        items: items.sort((a, b) => a.name.localeCompare(b.name)),
      }));

      return res.json({ shoppingList });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ── СООБЩЕНИЯ: список переписки с клиентом ────────────────────────────────

  app.get("/api/crm/clients/:clientId/messages", requireNutritionist, async (req: Request, res: Response) => {
    try {
      const { clientId } = req.params;

      const clientUser = await prisma.user.findUnique({ where: { id: clientId } });
      if (!clientUser || !isClientRole(clientUser.role)) return res.status(404).json({ error: "Клиент не найден" });

      // Переписка не делится по нутрициологам — это одна практика, любой
      // нутрициолог видит всю переписку с клиентом, кем бы из них она ни велась.
      const messages = await (prisma as any).message.findMany({
        where: { clientId },
        orderBy: { createdAt: "asc" },
      });

      // Отмечаем сообщения от клиента как прочитанные
      await (prisma as any).message.updateMany({
        where: { clientId, sender: "CLIENT", readAt: null },
        data: { readAt: new Date() },
      });

      return res.json({ messages });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ── СООБЩЕНИЯ: отправить клиенту ───────────────────────────────────────────

  app.post("/api/crm/clients/:clientId/messages", requireNutritionist, validateBody(crmClientMessageSchema), async (req: Request, res: Response) => {
    try {
      const nutritionistId = (req as any).user.id;
      const { clientId } = req.params;
      const { content } = req.body;

      const clientUser = await prisma.user.findUnique({ where: { id: clientId } });
      if (!clientUser || !isClientRole(clientUser.role)) return res.status(404).json({ error: "Клиент не найден" });

      const message = await (prisma as any).message.create({
        data: { nutritionistId, clientId, sender: "NUTRITIONIST", content },
      });

      return res.json({ message });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ── СООБЩЕНИЯ: количество непрочитанных по всем клиентам ──────────────────

  app.get("/api/crm/messages/unread-count", requireNutritionist, async (req: Request, res: Response) => {
    try {
      const rows = await (prisma as any).message.groupBy({
        by: ["clientId"],
        where: { sender: "CLIENT", readAt: null },
        _count: { _all: true },
      });
      const total = rows.reduce((sum: number, r: any) => sum + r._count._all, 0);
      const byClient: Record<string, number> = {};
      for (const r of rows) byClient[r.clientId] = r._count._all;
      return res.json({ total, byClient });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ── ОНБОРДИНГ: проверить токен ─────────────────────────────────────────────

  app.get("/api/onboard/:token", async (req: Request, res: Response) => {
    try {
      const invite = await (prisma as any).clientInvite.findUnique({
        where: { token: req.params.token },
        include: {
          nutritionist: { include: { nutritionistProfile: true } },
        },
      });

      if (!invite) return res.status(404).json({ error: "Приглашение не найдено или ссылка устарела" });
      if (invite.status === "ARCHIVED") return res.status(410).json({ error: "Ссылка недействительна" });

      return res.json({
        valid: true,
        clientName: invite.clientName,
        nutritionistName: invite.nutritionist?.nutritionistProfile
          ? `${invite.nutritionist.nutritionistProfile.firstName} ${invite.nutritionist.nutritionistProfile.lastName}`
          : "Ваш нутрициолог",
        status: invite.status,
        alreadyUsed: invite.status === "ACTIVE",
      });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ── ОНБОРДИНГ: вход существующего клиента ─────────────────────────────────

  app.post("/api/onboard/:token/login", validateBody(onboardLoginSchema), async (req: Request, res: Response) => {
    try {
      const { secretPhrase } = req.body;

      const invite = await (prisma as any).clientInvite.findUnique({
        where: { token: req.params.token },
        include: { client: { include: { clientProfile: true } } },
      });

      if (!invite) return res.status(404).json({ error: "Приглашение не найдено" });
      if (invite.secretPhrase !== secretPhrase) {
        return res.status(401).json({ error: "Неверная секретная фраза" });
      }
      if (!invite.clientId || !invite.client) {
        return res.status(400).json({ error: "Сначала завершите онбординг" });
      }

      const jwtToken = signToken({ id: invite.client.id, role: invite.client.role, email: invite.client.email });
      res.cookie("jwtToken", jwtToken, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 30 * 24 * 3600 * 1000 });
      // Также ставим "token" — куки, которую использует основной дневник питания (server.ts / ClientApp.tsx)
      res.cookie("token", invite.client.id, { httpOnly: true, secure: true, sameSite: "none" });

      return res.json({ user: { id: invite.client.id, email: invite.client.email, role: invite.client.role }, token: jwtToken });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ── ОНБОРДИНГ: завершить регистрацию клиента ──────────────────────────────

  app.post("/api/onboard/:token", validateBody(onboardCompleteSchema), async (req: Request, res: Response) => {
    try {
      const { secretPhrase, profile } = req.body;
      // profile: { firstName, lastName, birthYear, sex, heightCm, weightKg, goal, activity, dietRestrictions, allergies, complaints }

      const invite = await (prisma as any).clientInvite.findUnique({
        where: { token: req.params.token },
      });

      if (!invite) return res.status(404).json({ error: "Приглашение не найдено" });
      if (invite.status === "ARCHIVED") return res.status(410).json({ error: "Ссылка недействительна" });
      if (invite.secretPhrase !== secretPhrase) {
        return res.status(401).json({ error: "Неверная секретная фраза" });
      }

      // Если клиент уже создан — просто логиним
      if (invite.clientId) {
        const existingUser = await prisma.user.findUnique({ where: { id: invite.clientId } });
        if (existingUser) {
          const jwtToken = signToken({ id: existingUser.id, role: existingUser.role, email: existingUser.email });
          res.cookie("jwtToken", jwtToken, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 30 * 24 * 3600 * 1000 });
          res.cookie("token", existingUser.id, { httpOnly: true, secure: true, sameSite: "none" });
          return res.json({ user: { id: existingUser.id, email: existingUser.email, role: existingUser.role }, token: jwtToken });
        }
      }

      // Создаём клиента
      const email = `client-${invite.id}@nutria.internal`;
      const passwordHash = await bcrypt.hash(secretPhrase.trim(), SALT_ROUNDS);

      const clientUser = await prisma.user.create({
        data: {
          email,
          passwordHash,
          role: "CLIENT",
          clientProfile: {
            create: {
              firstName: profile?.firstName || invite.clientName || null,
              lastName: profile?.lastName || null,
              birthYear: profile?.birthYear ? Number(profile.birthYear) : null,
              sex: profile?.sex || null,
              heightCm: profile?.heightCm ? Number(profile.heightCm) : null,
              weightKg: profile?.weightKg ? Number(profile.weightKg) : null,
              goal: profile?.goal || null,
              activity: profile?.activity || null,
              dietRestrictions: profile?.dietRestrictions || null,
              allergiesJson: JSON.stringify(profile?.allergies || []),
              complaints: profile?.complaints || null,
              weightHistoryJson: profile?.weightKg
                ? JSON.stringify([{ date: new Date().toISOString().split("T")[0], kg: Number(profile.weightKg) }])
                : "[]",
            },
          },
        },
      });

      // Привязываем к приглашению
      await (prisma as any).clientInvite.update({
        where: { id: invite.id },
        data: {
          clientId: clientUser.id,
          status: "ACTIVE",
          usedAt: new Date(),
        },
      });

      const jwtToken = signToken({ id: clientUser.id, role: clientUser.role, email: clientUser.email });
      res.cookie("jwtToken", jwtToken, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 30 * 24 * 3600 * 1000 });
      res.cookie("token", clientUser.id, { httpOnly: true, secure: true, sameSite: "none" });

      return res.json({ user: { id: clientUser.id, email: clientUser.email, role: clientUser.role }, token: jwtToken });
    } catch (e: any) {
      console.error("Onboard error:", e);
      return res.status(500).json({ error: e.message });
    }
  });

  // ── АНКЕТА КЛИЕНТА: обновить ──────────────────────────────────────────────

  app.patch("/api/crm/clients/:clientId/profile", requireNutritionist, validateBody(crmClientProfilePatchSchema), async (req: Request, res: Response) => {
    try {
      const { clientId } = req.params;

      const clientUser = await prisma.user.findUnique({ where: { id: clientId } });
      if (!clientUser || !isClientRole(clientUser.role)) return res.status(404).json({ error: "Клиент не найден" });

      const {
        firstName, lastName, birthYear, sex, heightCm, weightKg,
        goal, activity, dietRestrictions, allergies, complaints,
        sleepQuality, badHabits, chronicDiseases, surgeries, medications, gutHealth,
      } = req.body;

      // Обновляем историю веса если передан новый вес
      let weightHistoryUpdate: any = undefined;
      if (weightKg) {
        const existing = await (prisma as any).clientProfile.findUnique({ where: { userId: clientId } });
        if (existing) {
          const history = JSON.parse(existing.weightHistoryJson || "[]");
          const today = new Date().toISOString().split("T")[0];
          const lastEntry = history[history.length - 1];
          if (!lastEntry || lastEntry.date !== today) {
            history.push({ date: today, kg: Number(weightKg) });
          } else {
            history[history.length - 1].kg = Number(weightKg);
          }
          weightHistoryUpdate = JSON.stringify(history);
        }
      }

      const profile = await (prisma as any).clientProfile.upsert({
        where: { userId: clientId },
        create: {
          userId: clientId,
          firstName, lastName,
          birthYear: birthYear ? Number(birthYear) : null,
          sex, heightCm: heightCm ? Number(heightCm) : null,
          weightKg: weightKg ? Number(weightKg) : null,
          goal, activity, dietRestrictions,
          allergiesJson: JSON.stringify(allergies || []),
          complaints, sleepQuality, badHabits, chronicDiseases, surgeries, medications, gutHealth,
          weightHistoryJson: weightHistoryUpdate || "[]",
        },
        update: {
          ...(firstName !== undefined && { firstName }),
          ...(lastName !== undefined && { lastName }),
          ...(birthYear !== undefined && { birthYear: Number(birthYear) }),
          ...(sex !== undefined && { sex }),
          ...(heightCm !== undefined && { heightCm: Number(heightCm) }),
          ...(weightKg !== undefined && { weightKg: Number(weightKg) }),
          ...(goal !== undefined && { goal }),
          ...(activity !== undefined && { activity }),
          ...(dietRestrictions !== undefined && { dietRestrictions }),
          ...(allergies !== undefined && { allergiesJson: JSON.stringify(allergies) }),
          ...(complaints !== undefined && { complaints }),
          ...(sleepQuality !== undefined && { sleepQuality }),
          ...(badHabits !== undefined && { badHabits }),
          ...(chronicDiseases !== undefined && { chronicDiseases }),
          ...(surgeries !== undefined && { surgeries }),
          ...(medications !== undefined && { medications }),
          ...(gutHealth !== undefined && { gutHealth }),
          ...(weightHistoryUpdate && { weightHistoryJson: weightHistoryUpdate }),
        },
      });

      // Пересчитываем показатели
      let calculations: any = null;
      if (profile.weightKg && profile.heightCm && profile.birthYear && profile.sex && profile.activity) {
        const age = new Date().getFullYear() - profile.birthYear;
        const bmr = calcBMR(profile.sex, profile.weightKg, profile.heightCm, age);
        const tdee = calcTDEE(bmr, profile.activity);
        const bmi = calcBMI(profile.weightKg, profile.heightCm);
        const kbzhu = calcTargetKbzhu(tdee, profile.goal || "maintain");
        calculations = { bmi, bmr: Math.round(bmr), tdee, ...kbzhu };
      }

      return res.json({ profile, calculations });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });
}
