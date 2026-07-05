// Разово (и безопасно повторно) схлопывает дублирующиеся Meal-записи с одинаковыми
// (userId, type, date) в одну — переносит их MealItem в самую раннюю запись и удаляет
// остальные. Нужно запускать ПЕРЕД `prisma db push`, который добавляет
// @@unique([userId, type, date]) на Meal: без дедупликации push упал бы на уже
// существующих дублях (гонка при параллельных клиентах — веб-вкладка + Telegram-бот,
// двойной тап "добавить").
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const duplicateGroups = await prisma.$queryRaw<{ userId: string; type: string; date: Date; ids: string[] }[]>`
    SELECT "userId", "type", "date", array_agg(id ORDER BY "createdAt" ASC) as ids
    FROM "Meal"
    GROUP BY "userId", "type", "date"
    HAVING COUNT(*) > 1
  `;

  if (duplicateGroups.length === 0) {
    console.log('[dedupe-meals] Дублей не найдено — можно применять unique constraint.');
    return;
  }

  console.log(`[dedupe-meals] Найдено ${duplicateGroups.length} групп дублей — объединяю...`);

  for (const group of duplicateGroups) {
    const [keepId, ...duplicateIds] = group.ids;
    if (duplicateIds.length === 0) continue;

    await prisma.mealItem.updateMany({
      where: { mealId: { in: duplicateIds } },
      data: { mealId: keepId },
    });
    await prisma.meal.deleteMany({ where: { id: { in: duplicateIds } } });

    console.log(`[dedupe-meals] userId=${group.userId} type=${group.type} date=${group.date.toISOString()}: объединено ${duplicateIds.length} дублей в ${keepId}`);
  }

  console.log('[dedupe-meals] Готово.');
}

main()
  .catch((e) => {
    console.error('[dedupe-meals] Ошибка:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
