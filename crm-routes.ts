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
import crypto from "node:crypto";
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
  crmInviteSchema,
  changePasswordSchema,
} from "./validation.ts";
import { logError } from "./logging.ts";

const upload = multer({ storage: multer.memoryStorage() });

function resolveJwtSecret(): string {
  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET не задан — обязателен в production (иначе можно подделать сессию нутрициолога/клиента)");
  }
  // eslint-disable-next-line no-console
  console.warn("[crm-routes] JWT_SECRET не задан — используется случайный секрет на время процесса (все сессии слетят при рестарте). Задайте JWT_SECRET в .env.");
  return crypto.randomBytes(32).toString("hex");
}
const JWT_SECRET = resolveJwtSecret();
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

// Установится один раз в registerCrmRoutes (вызывается ровно один раз за процесс) —
// нужен requireAuth, чтобы на каждый запрос проверять актуальный статус (BLOCKED)
// пользователя в БД, а не только доверять роли из самого JWT.
let prismaRef: PrismaClient;

async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const raw = req.cookies?.jwtToken || req.headers.authorization?.replace("Bearer ", "");
  if (!raw) return res.status(401).json({ error: "Unauthorized" });
  const payload = verifyToken(raw);
  if (!payload) return res.status(401).json({ error: "Invalid token" });
  try {
    const user = await prismaRef.user.findUnique({ where: { id: payload.id }, select: { status: true, role: true } });
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    if (user.status === "BLOCKED") return res.status(403).json({ error: "Аккаунт заблокирован" });
    // Роль берём из БД, а не из JWT — если админ сменил роль пользователю, старый
    // JWT (действует до 30 дней) не должен продолжать работать со старыми правами.
    (req as any).user = { ...payload, role: user.role };
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
  next();
}

// Сотрудники (нутрициологи/админы) — все остальные роли считаются клиентами
// дневника питания, включая общий демо-аккаунт ("USER") и любые будущие значения.
const STAFF_ROLES = ["NUTRITIONIST", "ADMIN"];
function isClientRole(role: string | null | undefined) {
  return !!role && !STAFF_ROLES.includes(role);
}

// Админ имеет полный функционал нутрициолога (плюс собственные админ-роуты ниже) —
// поэтому requireNutritionist пропускает обе роли, а не только NUTRITIONIST.
function requireNutritionist(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    if (!STAFF_ROLES.includes((req as any).user?.role)) {
      return res.status(403).json({ error: "Forbidden: nutritionist role required" });
    }
    next();
  });
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    if ((req as any).user?.role !== "ADMIN") {
      return res.status(403).json({ error: "Forbidden: admin role required" });
    }
    next();
  });
}

// Новые ClientInvite.secretPhrase хранятся как bcrypt-хэш. Записи, созданные до
// этого фикса, всё ещё хранят фразу в открытом виде — поддерживаем сравнение с обоими
// форматами, чтобы не сломать уже разосланные ссылки на онбординг.
const BCRYPT_HASH_RE = /^\$2[aby]\$/;
async function verifySecretPhrase(plain: string, stored: string): Promise<boolean> {
  if (BCRYPT_HASH_RE.test(stored)) return bcrypt.compare(plain, stored);
  return plain === stored;
}

// Полное удаление аккаунта вместе с дневником. Product.createdByUserId не каскадируется
// намеренно (продукт мог быть добавлен и в чужой дневник как AI/USDA-совпадение или
// использован в общем каталоге) — просто отвязываем авторство, сам продукт остаётся.
// Всё остальное (Meal→MealItem, ClientInvite как приглашённый, профили, вес, активность,
// сообщения/заметки/анализы как нутрициолог и т.п.) каскадируется через onDelete: Cascade
// в схеме.
async function deleteUserAccount(prisma: PrismaClient, userId: string): Promise<void> {
  await (prisma as any).product.updateMany({ where: { createdByUserId: userId }, data: { createdByUserId: null } });
  await prisma.user.delete({ where: { id: userId } });
}

// Контакты того, кто заблокировал аккаунт — показываются клиенту при попытке входа,
// чтобы он знал, к кому обратиться для разблокировки.
export async function getBlockerContactInfo(
  prisma: PrismaClient,
  blockedByUserId: string | null | undefined
): Promise<{ name: string; email: string; phone: string | null; role: string } | null> {
  if (!blockedByUserId) return null;
  const blocker = await prisma.user.findUnique({
    where: { id: blockedByUserId },
    select: { email: true, role: true, nutritionistProfile: { select: { firstName: true, lastName: true, phone: true } } },
  });
  if (!blocker) return null;
  const profile = blocker.nutritionistProfile;
  const name = profile ? `${profile.firstName || ""} ${profile.lastName || ""}`.trim() : "";
  return {
    name: name || blocker.email,
    email: blocker.email,
    phone: profile?.phone || null,
    role: blocker.role,
  };
}

// Отправка письма с приглашением пока не подключена (нет провайдера/SMTP-ключей) —
// ссылка отдаётся в ответе API и показывается в CRM для ручной отправки. Когда появится
// провайдер (SMTP/SendGrid/Resend/...), реализовать отправку здесь — вызовы уже
// подготовлены во всех местах, где создаётся приглашение.
async function sendInviteEmail(params: { to: string; name: string; role: string; inviteUrl: string }): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`[invite-email] (не отправлено — провайдер не настроен) кому=${params.to} роль=${params.role} ссылка=${params.inviteUrl}`);
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
  prismaRef = prisma;

  // Проверяет, что :clientId НЕ закреплён приглашением за ДРУГИМ нутрициологом
  // (ClientInvite.clientId уникален — у клиента не может быть больше одного
  // владеющего нутрициолога). Ещё не закреплённых клиентов (пришли сами/через
  // Telegram-бота) пропускает — их можно "усыновить" через PATCH .../clients/:clientId.
  // 404 вместо 403, чтобы не подтверждать существование чужого clientId в ответе.
  async function requireOwnClient(req: Request, res: Response, next: NextFunction) {
    try {
      const nutritionistId = (req as any).user.id;
      const { clientId } = req.params;
      const invite = await (prisma as any).clientInvite.findFirst({ where: { clientId } });
      if (invite && invite.nutritionistId !== nutritionistId) {
        return res.status(404).json({ error: "Клиент не найден" });
      }
      next();
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

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
      logError("Register error:", e);
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
      if (!user || !STAFF_ROLES.includes(user.role)) {
        return res.status(401).json({ error: "Неверный email или пароль" });
      }

      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) return res.status(401).json({ error: "Неверный email или пароль" });
      if (user.status === "BLOCKED") {
        const blockedBy = await getBlockerContactInfo(prisma, (user as any).blockedByUserId);
        return res.status(403).json({ error: "Аккаунт заблокирован", blockedBy });
      }

      const token = signToken({ id: user.id, role: user.role, email: user.email });
      res.cookie("jwtToken", token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 30 * 24 * 3600 * 1000 });
      return res.json({
        user: { id: user.id, email: user.email, role: user.role, profile: user.nutritionistProfile },
        token,
      });
    } catch (e: any) {
      logError("Login error:", e);
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

  // ── AUTH: смена пароля (любой залогиненный сотрудник — свой пароль) ────────

  app.post(
    "/api/crm/auth/change-password",
    requireAuth,
    validateBody(changePasswordSchema),
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        const { currentPassword, newPassword } = req.body;

        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) return res.status(404).json({ error: "Пользователь не найден" });

        const ok = await bcrypt.compare(currentPassword, user.passwordHash);
        if (!ok) return res.status(401).json({ error: "Неверный текущий пароль" });

        const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
        await prisma.user.update({ where: { id: userId }, data: { passwordHash: newHash } });
        return res.json({ success: true });
      } catch (e: any) {
        return res.status(500).json({ error: e.message });
      }
    }
  );

  // ── АДМИН: приглашения (любая роль — клиент/нутрициолог/админ) ────────────
  // Только админ создаёт приглашения с выбором роли; нутрициологи по-прежнему
  // приглашают клиентов через POST /api/crm/clients (ниже) — это не заменяет,
  // а дополняет существующий способ.

  app.post("/api/crm/invites", requireAdmin, validateBody(crmInviteSchema), async (req: Request, res: Response) => {
    try {
      const adminId = (req as any).user.id;
      const { email, name, role } = req.body;

      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) return res.status(409).json({ error: "Пользователь с таким email уже зарегистрирован" });

      const existingInvite = await (prisma as any).clientInvite.findFirst({ where: { email, status: "PENDING" } });
      if (existingInvite) return res.status(409).json({ error: "Приглашение на этот email уже отправлено и ожидает регистрации" });

      // secretPhrase не используется для NUTRITIONIST/ADMIN (там вход по email+паролю
      // после онбординга), но поле в схеме обязательно — генерируем случайное служебное значение.
      const secretPhrase = crypto.randomBytes(16).toString("hex");

      const invite = await (prisma as any).clientInvite.create({
        data: { nutritionistId: adminId, clientName: name, email, role, secretPhrase, status: "PENDING" },
      });

      const inviteUrl = `${req.protocol}://${req.get("host")}/onboard/${invite.token}`;
      await sendInviteEmail({ to: email, name, role, inviteUrl }).catch((e) => logError("sendInviteEmail error:", e));

      return res.json({ invite: { id: invite.id, email, clientName: name, role, status: invite.status, createdAt: invite.createdAt }, inviteUrl });
    } catch (e: any) {
      logError("Create invite error:", e);
      return res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/crm/invites", requireAdmin, async (req: Request, res: Response) => {
    try {
      const invites = await (prisma as any).clientInvite.findMany({
        include: { client: { select: { id: true, email: true, role: true } } },
        orderBy: { createdAt: "desc" },
      });
      return res.json({
        invites: invites.map((inv: any) => ({
          id: inv.id,
          email: inv.email,
          clientName: inv.clientName,
          role: inv.role,
          status: inv.status,
          createdAt: inv.createdAt,
          usedAt: inv.usedAt,
          acceptedUser: inv.client ? { id: inv.client.id, email: inv.client.email, role: inv.client.role } : null,
        })),
      });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/crm/invites/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const invite = await (prisma as any).clientInvite.findUnique({ where: { id: req.params.id } });
      if (!invite) return res.status(404).json({ error: "Приглашение не найдено" });
      if (invite.status !== "PENDING") return res.status(400).json({ error: "Можно отозвать только ожидающее приглашение" });
      await (prisma as any).clientInvite.update({ where: { id: req.params.id }, data: { status: "ARCHIVED" } });
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ── АДМИН: статистика и список пользователей ───────────────────────────────
  // (server.ts тоже содержит /api/admin/users и /api/admin/stats, но они читают
  // старую cookie "token" консьюмер-приложения — CRM-сессия администратора живёт в
  // jwtToken, поэтому для админ-панели CRM нужны отдельные, JWT-защищённые роуты.)

  app.get("/api/crm/admin/stats", requireAdmin, async (req: Request, res: Response) => {
    try {
      const since7d = new Date(Date.now() - 7 * 24 * 3600 * 1000);
      const since30d = new Date(Date.now() - 30 * 24 * 3600 * 1000);

      const [
        totalUsers,
        clientCount,
        nutritionistCount,
        adminCount,
        totalProducts,
        totalMeals,
        pendingInvites,
        activeInvites,
        newUsers7d,
        newUsers30d,
        activeUserIds,
      ] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { role: { notIn: STAFF_ROLES } } }),
        prisma.user.count({ where: { role: "NUTRITIONIST" } }),
        prisma.user.count({ where: { role: "ADMIN" } }),
        prisma.product.count(),
        prisma.meal.count(),
        (prisma as any).clientInvite.count({ where: { status: "PENDING" } }),
        (prisma as any).clientInvite.count({ where: { status: "ACTIVE" } }),
        prisma.user.count({ where: { createdAt: { gte: since7d } } }),
        prisma.user.count({ where: { createdAt: { gte: since30d } } }),
        prisma.meal.findMany({ where: { date: { gte: since7d } }, select: { userId: true }, distinct: ["userId"] }),
      ]);

      return res.json({
        totalUsers,
        usersByRole: { client: clientCount, nutritionist: nutritionistCount, admin: adminCount },
        totalProducts,
        totalMeals,
        invites: { pending: pendingInvites, active: activeInvites },
        newUsers: { last7d: newUsers7d, last30d: newUsers30d },
        activeUsersLast7d: activeUserIds.length,
      });
    } catch (e: any) {
      logError("Admin stats error:", e);
      return res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/crm/admin/users", requireAdmin, async (req: Request, res: Response) => {
    try {
      const users = await prisma.user.findMany({
        select: {
          id: true, email: true, role: true, status: true, createdAt: true,
          nutritionistProfile: { select: { firstName: true, lastName: true } },
          clientProfile: { select: { firstName: true, lastName: true } },
          _count: { select: { meals: true } },
        },
        orderBy: { createdAt: "desc" },
      });
      return res.json({
        users: users.map((u: any) => ({
          id: u.id,
          email: u.email,
          role: u.role,
          status: u.status,
          createdAt: u.createdAt,
          name: u.nutritionistProfile
            ? `${u.nutritionistProfile.firstName} ${u.nutritionistProfile.lastName}`.trim()
            : u.clientProfile
            ? `${u.clientProfile.firstName || ""} ${u.clientProfile.lastName || ""}`.trim()
            : null,
          mealCount: u._count.meals,
        })),
      });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ── АДМИН: заблокировать/разблокировать любого пользователя ────────────────

  app.patch("/api/crm/admin/users/:id/status", requireAdmin, async (req: Request, res: Response) => {
    try {
      const adminId = (req as any).user.id;
      const { id } = req.params;
      const { status } = req.body;
      if (status !== "ACTIVE" && status !== "BLOCKED") {
        return res.status(400).json({ error: "Некорректный статус" });
      }
      if (id === adminId) return res.status(400).json({ error: "Нельзя заблокировать собственный аккаунт" });

      const target = await prisma.user.findUnique({ where: { id } });
      if (!target) return res.status(404).json({ error: "Пользователь не найден" });

      if (status === "BLOCKED" && target.role === "ADMIN") {
        const otherActiveAdmins = await prisma.user.count({ where: { role: "ADMIN", status: "ACTIVE", id: { not: id } } });
        if (otherActiveAdmins === 0) {
          return res.status(400).json({ error: "Нельзя заблокировать единственного активного администратора" });
        }
      }

      const updated = await prisma.user.update({
        where: { id },
        data: { status, blockedByUserId: status === "BLOCKED" ? adminId : null },
      });
      return res.json({ user: { id: updated.id, status: updated.status } });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ── АДМИН: удалить любого пользователя (полностью, с дневником) ────────────

  app.delete("/api/crm/admin/users/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const adminId = (req as any).user.id;
      const { id } = req.params;
      if (id === adminId) return res.status(400).json({ error: "Нельзя удалить собственный аккаунт" });

      const target = await prisma.user.findUnique({ where: { id } });
      if (!target) return res.status(404).json({ error: "Пользователь не найден" });

      if (target.role === "ADMIN") {
        const otherAdmins = await prisma.user.count({ where: { role: "ADMIN", id: { not: id } } });
        if (otherAdmins === 0) {
          return res.status(400).json({ error: "Нельзя удалить единственного администратора" });
        }
      }

      await deleteUserAccount(prisma, id);
      return res.json({ success: true });
    } catch (e: any) {
      logError("Admin delete user error:", e);
      return res.status(500).json({ error: e.code === "P2003" ? "Не удалось удалить: пользователь ещё связан с другими данными" : e.message });
    }
  });

  // ── КЛИЕНТЫ: список ────────────────────────────────────────────────────────

  app.get("/api/crm/clients", requireNutritionist, async (req: Request, res: Response) => {
    try {
      const nutritionistId = (req as any).user.id;

      // Показываем клиентов, закреплённых приглашением именно за этим нутрициологом,
      // плюс ещё никем не закреплённых (пришли сами/через Telegram-бота — их можно
      // "усыновить" через PATCH). Клиентов, закреплённых за ДРУГИМ нутрициологом,
      // не показываем — иначе один нутрициолог видел бы медданные клиентов всех остальных.
      const clientUsers = await prisma.user.findMany({
        where: { role: { notIn: STAFF_ROLES }, OR: [{ inviteReceived: { nutritionistId } }, { inviteReceived: null }] },
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
          // Статус самого аккаунта (ACTIVE/BLOCKED) — не путать с status выше, это статус
          // ПРИГЛАШЕНИЯ (PENDING/ACTIVE/ARCHIVED).
          accountStatus: u.status,
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

      // Храним только bcrypt-хэш фразы — саму фразу возвращаем нутрициологу
      // один раз в ответе ниже (для отправки клиенту), но нигде не сохраняем в открытом виде.
      const secretPhraseHash = await bcrypt.hash(secretPhrase, SALT_ROUNDS);
      const invite = await (prisma as any).clientInvite.create({
        data: {
          nutritionistId,
          clientName: clientName || null,
          secretPhrase: secretPhraseHash,
          tagsJson: JSON.stringify(tags || []),
          status: "PENDING",
        },
      });

      const inviteUrl = `${req.protocol}://${req.get("host")}/onboard/${invite.token}`;

      return res.json({ invite: { ...invite, secretPhrase }, inviteUrl });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ── КЛИЕНТ: детальная карточка ─────────────────────────────────────────────

  app.get("/api/crm/clients/:clientId", requireNutritionist, requireOwnClient, async (req: Request, res: Response) => {
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
        accountStatus: user.status,
      });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ── КЛИЕНТ: обновить теги/статус/имя ─────────────────────────────────────

  app.patch("/api/crm/clients/:clientId", requireNutritionist, requireOwnClient, validateBody(crmUpdateClientSchema), async (req: Request, res: Response) => {
    try {
      const nutritionistId = (req as any).user.id;
      const { clientId } = req.params;
      const { clientName, status, tags } = req.body;

      const clientUser = await prisma.user.findUnique({ where: { id: clientId } });
      if (!clientUser || !isClientRole(clientUser.role)) return res.status(404).json({ error: "Клиент не найден" });

      let invite = await (prisma as any).clientInvite.findFirst({ where: { clientId } });
      if (!invite) {
        // Клиент пришёл не через приглашение этого нутрициолога (например, через Telegram-бота)
        // — создаём служебную запись приглашения, чтобы хранить теги/статус, и тем самым
        // закрепляем клиента за этим нутрициологом (первый, кто его "трогает", становится владельцем).
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

  // ── КЛИЕНТ: заблокировать/разблокировать (нутрициолог — только своего клиента) ─

  app.patch("/api/crm/clients/:clientId/account-status", requireNutritionist, requireOwnClient, async (req: Request, res: Response) => {
    try {
      const nutritionistId = (req as any).user.id;
      const { clientId } = req.params;
      const { status } = req.body;
      if (status !== "ACTIVE" && status !== "BLOCKED") {
        return res.status(400).json({ error: "Некорректный статус" });
      }

      const clientUser = await prisma.user.findUnique({ where: { id: clientId } });
      if (!clientUser || !isClientRole(clientUser.role)) return res.status(404).json({ error: "Клиент не найден" });

      const updated = await prisma.user.update({
        where: { id: clientId },
        data: { status, blockedByUserId: status === "BLOCKED" ? nutritionistId : null },
      });
      return res.json({ user: { id: updated.id, status: updated.status } });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ── КЛИЕНТ: удалить аккаунт целиком (нутрициолог — только своего клиента) ─────

  app.delete("/api/crm/clients/:clientId", requireNutritionist, requireOwnClient, async (req: Request, res: Response) => {
    try {
      const { clientId } = req.params;
      const clientUser = await prisma.user.findUnique({ where: { id: clientId } });
      if (!clientUser || !isClientRole(clientUser.role)) return res.status(404).json({ error: "Клиент не найден" });

      await deleteUserAccount(prisma, clientId);
      return res.json({ success: true });
    } catch (e: any) {
      logError("Delete client error:", e);
      return res.status(500).json({ error: e.code === "P2003" ? "Не удалось удалить: клиент ещё связан с другими данными" : e.message });
    }
  });

  // ── ДНЕВНИК КЛИЕНТА (просмотр для нутрициолога) ───────────────────────────

  app.get("/api/crm/clients/:clientId/diary", requireNutritionist, requireOwnClient, async (req: Request, res: Response) => {
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

  app.get("/api/crm/clients/:clientId/weight-history", requireNutritionist, requireOwnClient, async (req: Request, res: Response) => {
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

  app.get("/api/crm/clients/:clientId/analytics", requireNutritionist, requireOwnClient, async (req: Request, res: Response) => {
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

  app.get("/api/crm/clients/:clientId/notes", requireNutritionist, requireOwnClient, async (req: Request, res: Response) => {
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

  app.post("/api/crm/clients/:clientId/notes", requireNutritionist, requireOwnClient, validateBody(crmNoteSchema), async (req: Request, res: Response) => {
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

  app.delete("/api/crm/clients/:clientId/notes/:noteId", requireNutritionist, requireOwnClient, async (req: Request, res: Response) => {
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

  app.get("/api/crm/clients/:clientId/analyses", requireNutritionist, requireOwnClient, async (req: Request, res: Response) => {
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

  app.get("/api/crm/clients/:clientId/analyses/:analysisId/download", requireNutritionist, requireOwnClient, async (req: Request, res: Response) => {
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

  app.delete("/api/crm/clients/:clientId/analyses/:analysisId", requireNutritionist, requireOwnClient, async (req: Request, res: Response) => {
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

  app.get("/api/crm/clients/:clientId/recommendations", requireNutritionist, requireOwnClient, async (req: Request, res: Response) => {
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

  app.post("/api/crm/clients/:clientId/recommendations", requireNutritionist, requireOwnClient, validateBody(crmRecommendationSchema), async (req: Request, res: Response) => {
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

  app.delete("/api/crm/clients/:clientId/recommendations/:recId", requireNutritionist, requireOwnClient, async (req: Request, res: Response) => {
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

  app.post("/api/crm/clients/:clientId/consultations", requireNutritionist, requireOwnClient, validateBody(crmConsultationSchema), async (req: Request, res: Response) => {
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

  app.get("/api/crm/clients/:clientId/meal-plans", requireNutritionist, requireOwnClient, async (req: Request, res: Response) => {
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

  app.post("/api/crm/clients/:clientId/meal-plans", requireNutritionist, requireOwnClient, validateBody(crmMealPlanSchema), async (req: Request, res: Response) => {
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

  app.get("/api/crm/clients/:clientId/messages", requireNutritionist, requireOwnClient, async (req: Request, res: Response) => {
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

  app.post("/api/crm/clients/:clientId/messages", requireNutritionist, requireOwnClient, validateBody(crmClientMessageSchema), async (req: Request, res: Response) => {
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
        email: invite.email,
        role: invite.role || "CLIENT",
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
      if (!(await verifySecretPhrase(secretPhrase, invite.secretPhrase))) {
        return res.status(401).json({ error: "Неверная секретная фраза" });
      }
      if (!BCRYPT_HASH_RE.test(invite.secretPhrase)) {
        const migratedHash = await bcrypt.hash(secretPhrase, SALT_ROUNDS);
        await (prisma as any).clientInvite.update({ where: { id: invite.id }, data: { secretPhrase: migratedHash } });
      }
      if (!invite.clientId || !invite.client) {
        return res.status(400).json({ error: "Сначала завершите онбординг" });
      }
      if (invite.client.status === "BLOCKED") {
        const blockedBy = await getBlockerContactInfo(prisma, invite.client.blockedByUserId);
        return res.status(403).json({ error: "Аккаунт заблокирован", blockedBy });
      }

      const jwtToken = signToken({ id: invite.client.id, role: invite.client.role, email: invite.client.email });
      res.cookie("jwtToken", jwtToken, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 30 * 24 * 3600 * 1000 });
      // Также ставим "token" — куки, которую использует основной дневник питания (server.ts / ClientApp.tsx)
      res.cookie("token", invite.client.id, { httpOnly: true, signed: true, secure: true, sameSite: "none" });

      return res.json({ user: { id: invite.client.id, email: invite.client.email, role: invite.client.role }, token: jwtToken });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ── ОНБОРДИНГ: завершить регистрацию клиента ──────────────────────────────

  app.post("/api/onboard/:token", validateBody(onboardCompleteSchema), async (req: Request, res: Response) => {
    try {
      const { secretPhrase, password, firstName, lastName, profile } = req.body;
      // profile: { firstName, lastName, birthYear, sex, heightCm, weightKg, goal, activity, dietRestrictions, allergies, complaints }

      const invite = await (prisma as any).clientInvite.findUnique({
        where: { token: req.params.token },
      });

      if (!invite) return res.status(404).json({ error: "Приглашение не найдено" });
      if (invite.status === "ARCHIVED") return res.status(410).json({ error: "Ссылка недействительна" });

      const inviteRole = invite.role || "CLIENT";

      // Приглашения с указанным email (созданы через админский флоу — /api/crm/invites)
      // используют регистрацию по email+паролю вместо секретной фразы: фраза для них
      // генерируется случайно и никому не сообщается, так что ввести её всё равно
      // невозможно. Работает для любой роли, включая CLIENT (тогда дополнительно
      // собираем анкету здоровья, как и раньше).
      if (invite.email) {
        // Уже зарегистрирован — повторный переход по ссылке требует ввода пароля
        // заново (иначе кто угодно с URL приглашения мог бы войти без пароля).
        if (invite.clientId) {
          const existingUser = await prisma.user.findUnique({ where: { id: invite.clientId } });
          if (existingUser) {
            if (!password) return res.status(400).json({ error: "Укажите пароль" });
            const ok = await bcrypt.compare(password, existingUser.passwordHash);
            if (!ok) return res.status(401).json({ error: "Неверный пароль" });
            if (existingUser.status === "BLOCKED") {
              const blockedBy = await getBlockerContactInfo(prisma, existingUser.blockedByUserId);
              return res.status(403).json({ error: "Аккаунт заблокирован", blockedBy });
            }

            const jwtToken = signToken({ id: existingUser.id, role: existingUser.role, email: existingUser.email });
            res.cookie("jwtToken", jwtToken, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 30 * 24 * 3600 * 1000 });
            if (existingUser.role === "CLIENT") {
              res.cookie("token", existingUser.id, { httpOnly: true, signed: true, secure: true, sameSite: "none" });
            }
            return res.json({ user: { id: existingUser.id, email: existingUser.email, role: existingUser.role }, token: jwtToken });
          }
        }

        if (!password) return res.status(400).json({ error: "Укажите пароль" });

        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
        const newUser = await prisma.user.create({
          data: inviteRole === "CLIENT"
            ? {
                email: invite.email,
                passwordHash,
                role: "CLIENT",
                clientProfile: {
                  create: {
                    firstName: profile?.firstName || firstName || invite.clientName || null,
                    lastName: profile?.lastName || lastName || null,
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
              }
            : {
                email: invite.email,
                passwordHash,
                role: inviteRole,
                nutritionistProfile: {
                  create: {
                    firstName: firstName || invite.clientName || "",
                    lastName: lastName || "",
                  },
                },
              },
        });

        await (prisma as any).clientInvite.update({
          where: { id: invite.id },
          data: { clientId: newUser.id, status: "ACTIVE", usedAt: new Date() },
        });

        const jwtToken = signToken({ id: newUser.id, role: newUser.role, email: newUser.email });
        res.cookie("jwtToken", jwtToken, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 30 * 24 * 3600 * 1000 });
        if (newUser.role === "CLIENT") {
          res.cookie("token", newUser.id, { httpOnly: true, signed: true, secure: true, sameSite: "none" });
        }
        return res.json({ user: { id: newUser.id, email: newUser.email, role: newUser.role }, token: jwtToken });
      }

      // Приглашения без email (старый флоу — нутрициолог сам придумывает и сообщает
      // клиенту секретную фразу вручную) — всегда CLIENT, поведение не изменилось.
      if (!secretPhrase) return res.status(400).json({ error: "Укажите секретную фразу" });
      if (!(await verifySecretPhrase(secretPhrase, invite.secretPhrase))) {
        return res.status(401).json({ error: "Неверная секретная фраза" });
      }
      if (!BCRYPT_HASH_RE.test(invite.secretPhrase)) {
        const migratedHash = await bcrypt.hash(secretPhrase, SALT_ROUNDS);
        await (prisma as any).clientInvite.update({ where: { id: invite.id }, data: { secretPhrase: migratedHash } });
      }

      // Если клиент уже создан — просто логиним
      if (invite.clientId) {
        const existingUser = await prisma.user.findUnique({ where: { id: invite.clientId } });
        if (existingUser) {
          if (existingUser.status === "BLOCKED") {
            const blockedBy = await getBlockerContactInfo(prisma, existingUser.blockedByUserId);
            return res.status(403).json({ error: "Аккаунт заблокирован", blockedBy });
          }
          const jwtToken = signToken({ id: existingUser.id, role: existingUser.role, email: existingUser.email });
          res.cookie("jwtToken", jwtToken, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 30 * 24 * 3600 * 1000 });
          res.cookie("token", existingUser.id, { httpOnly: true, signed: true, secure: true, sameSite: "none" });
          return res.json({ user: { id: existingUser.id, email: existingUser.email, role: existingUser.role }, token: jwtToken });
        }
      }

      // Создаём клиента — используем реальный email, если он был указан при создании
      // приглашения (новый admin-флоу), иначе синтетический (старый флоу без email).
      const email = invite.email || `client-${invite.id}@nutria.internal`;
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
      res.cookie("token", clientUser.id, { httpOnly: true, signed: true, secure: true, sameSite: "none" });

      return res.json({ user: { id: clientUser.id, email: clientUser.email, role: clientUser.role }, token: jwtToken });
    } catch (e: any) {
      logError("Onboard error:", e);
      return res.status(500).json({ error: e.message });
    }
  });

  // ── АНКЕТА КЛИЕНТА: обновить ──────────────────────────────────────────────

  app.patch("/api/crm/clients/:clientId/profile", requireNutritionist, requireOwnClient, validateBody(crmClientProfilePatchSchema), async (req: Request, res: Response) => {
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
