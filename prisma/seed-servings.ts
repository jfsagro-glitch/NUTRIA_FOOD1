// Проставляет типовые "человеческие" порции (1 шт/1 стакан/1 ломтик и т.п.) продуктам
// каталога по совпадению названия. Безопасно запускать повторно — только заполняет
// servingsJson там, где он ещё пуст, существующие записи не трогает.
// Покрывает не весь каталог (это нереалистично для ~8000 USDA-записей без ручной
// разметки), а курируемый список повседневных продуктов, где размер порции очевиден
// и одинаков для большинства людей.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface ServingRule {
  // Ищем продукты, чьё название (без учёта регистра) содержит любую из этих подстрок
  match: string[];
  servings: { name: string; grams: number }[];
}

const SERVING_RULES: ServingRule[] = [
  { match: ['яйцо куриное', 'яйцо, куриное', 'egg, whole'], servings: [{ name: '1 шт', grams: 55 }] },
  { match: ['банан'], servings: [{ name: '1 шт', grams: 120 }] },
  { match: ['авокадо'], servings: [{ name: '1/2 шт', grams: 70 }, { name: '1 шт', grams: 140 }] },
  { match: ['яблоко'], servings: [{ name: '1 шт', grams: 150 }] },
  { match: ['апельсин'], servings: [{ name: '1 шт', grams: 130 }] },
  { match: ['йогурт греческий', 'йогурт, греческий', 'greek yogurt'], servings: [{ name: '1 стакан', grams: 170 }] },
  { match: ['кефир'], servings: [{ name: '1 стакан', grams: 200 }] },
  { match: ['молоко'], servings: [{ name: '1 стакан', grams: 240 }] },
  { match: ['рис', 'варен'], servings: [{ name: '1 порция', grams: 150 }] },
  { match: ['гречка', 'варен'], servings: [{ name: '1 порция', grams: 150 }] },
  { match: ['овсян'], servings: [{ name: '1 порция', grams: 200 }] },
  { match: ['хлеб'], servings: [{ name: '1 ломтик', grams: 25 }] },
  { match: ['масло сливочное', 'butter'], servings: [{ name: '1 ложка', grams: 15 }] },
  { match: ['масло растительное', 'масло оливковое', 'olive oil'], servings: [{ name: '1 ложка', grams: 14 }] },
  { match: ['мёд', 'мед,'], servings: [{ name: '1 ложка', grams: 21 }] },
  { match: ['сахар'], servings: [{ name: '1 ложка', grams: 12 }] },
  { match: ['картофель'], servings: [{ name: '1 шт (средний)', grams: 150 }] },
  { match: ['помидор', 'томат'], servings: [{ name: '1 шт', grams: 120 }] },
  { match: ['огурец'], servings: [{ name: '1 шт', grams: 100 }] },
];

async function main() {
  let updated = 0;
  for (const rule of SERVING_RULES) {
    const candidates = await prisma.product.findMany({
      where: {
        AND: [
          { OR: rule.match.map((m) => ({ name: { contains: m, mode: 'insensitive' as const } })) },
          { OR: [{ servingsJson: null }, { servingsJson: '' }] },
        ],
      },
      select: { id: true, name: true },
    });

    if (candidates.length === 0) continue;

    await prisma.product.updateMany({
      where: { id: { in: candidates.map((c) => c.id) } },
      data: { servingsJson: JSON.stringify(rule.servings) },
    });

    updated += candidates.length;
    console.log(`[seed-servings] "${rule.match[0]}" → ${candidates.length} продукт(ов): ${candidates.map((c) => c.name).slice(0, 5).join(', ')}${candidates.length > 5 ? '…' : ''}`);
  }

  console.log(`[seed-servings] Готово, обновлено продуктов: ${updated}`);
}

main()
  .catch((e) => {
    console.error('[seed-servings] Ошибка:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
