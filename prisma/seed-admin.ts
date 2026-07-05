// Разово (и безопасно повторно) создаёт учётную запись первого администратора CRM,
// если пользователя с этим email ещё нет. Запускается на каждом деплое (см.
// scripts/start-server.mjs), но идемпотентно — не трогает существующего пользователя,
// даже если пароль уже сменили.
//
// Пароль НЕ хранится в открытом виде нигде в репозитории — ниже только bcrypt-хэш,
// посчитанный один раз локально. Сменить пароль можно позже через обычный механизм
// смены пароля (или напрямую в БД), этот скрипт не переопределяет существующего admin.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const BOOTSTRAP_ADMIN_EMAIL = '89184140636@mail.ru';
const BOOTSTRAP_ADMIN_PASSWORD_HASH = '$2b$10$N2Gc6ElLLsueDdWP211ZX.Y7voPsPT0oCd8TOAqRiJZlTyPphjA9S';

async function main() {
  const existing = await prisma.user.findUnique({ where: { email: BOOTSTRAP_ADMIN_EMAIL } });
  if (existing) {
    if (existing.role !== 'ADMIN') {
      console.warn(`[seed-admin] Пользователь ${BOOTSTRAP_ADMIN_EMAIL} уже существует с ролью ${existing.role} — роль НЕ меняю автоматически.`);
    } else {
      console.log(`[seed-admin] Админ ${BOOTSTRAP_ADMIN_EMAIL} уже существует — пропускаю.`);
    }
    return;
  }

  const admin = await prisma.user.create({
    data: {
      email: BOOTSTRAP_ADMIN_EMAIL,
      passwordHash: BOOTSTRAP_ADMIN_PASSWORD_HASH,
      role: 'ADMIN',
      nutritionistProfile: {
        create: { firstName: 'Администратор', lastName: 'Nutria' },
      },
    },
  });

  console.log(`[seed-admin] Создан администратор ${admin.email} (id=${admin.id}). Вход через /login на cms.nutria.one.`);
}

main()
  .catch((e) => {
    console.error('[seed-admin] Ошибка:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
