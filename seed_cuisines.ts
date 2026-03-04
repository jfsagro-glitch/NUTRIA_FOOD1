
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const foods = [
  // Russian Cuisine
  { name: 'Борщ', brand: 'Русская кухня', calories: 60, protein: 2.5, fat: 3.5, carbs: 5.5, fiber: 1.5, micronutrients: JSON.stringify({ vitamins: { C: 10, A: 50 }, minerals: { Iron: 1.2, Potassium: 250 } }) },
  { name: 'Пельмени с говядиной', brand: 'Русская кухня', calories: 275, protein: 12, fat: 13, carbs: 28, fiber: 1.2, micronutrients: JSON.stringify({ vitamins: { B12: 1.5 }, minerals: { Iron: 2.5, Zinc: 3.5 }, aminoAcids: { Leucine: 1200, Isoleucine: 650, Valine: 700, Lysine: 900, Threonine: 500, Tryptophan: 150, Methionine: 300, Phenylalanine: 600, Histidine: 400, Arginine: 800 } }) },
  { name: 'Блины', brand: 'Русская кухня', calories: 230, protein: 6, fat: 10, carbs: 30, fiber: 0.5, micronutrients: JSON.stringify({ vitamins: { B2: 0.2 }, minerals: { Calcium: 120 } }) },
  { name: 'Оливье', brand: 'Русская кухня', calories: 190, protein: 5, fat: 15, carbs: 9, fiber: 1.8, micronutrients: JSON.stringify({ vitamins: { C: 5 }, minerals: { Sodium: 450 } }) },
  { name: 'Сырники', brand: 'Русская кухня', calories: 220, protein: 14, fat: 10, carbs: 18, fiber: 0.2, micronutrients: JSON.stringify({ vitamins: { B2: 0.3 }, minerals: { Calcium: 150 } }) },
  
  // Caucasian Cuisine
  { name: 'Шашлык из баранины', brand: 'Кавказская кухня', calories: 280, protein: 22, fat: 20, carbs: 0, fiber: 0, micronutrients: JSON.stringify({ vitamins: { B12: 2.5 }, minerals: { Iron: 3.2, Zinc: 4.5 }, aminoAcids: { Leucine: 1800, Isoleucine: 950, Valine: 1100, Lysine: 1600, Threonine: 850, Tryptophan: 250, Methionine: 550, Phenylalanine: 900, Histidine: 600, Arginine: 1400 } }) },
  { name: 'Хачапури по-аджарски', brand: 'Кавказская кухня', calories: 310, protein: 12, fat: 18, carbs: 25, fiber: 0.8, micronutrients: JSON.stringify({ vitamins: { A: 150 }, minerals: { Calcium: 350 } }) },
  { name: 'Хинкали', brand: 'Кавказская кухня', calories: 210, protein: 10, fat: 9, carbs: 22, fiber: 1.0, micronutrients: JSON.stringify({ vitamins: { B6: 0.3 }, minerals: { Iron: 1.8 } }) },
  { name: 'Лобио', brand: 'Кавказская кухня', calories: 120, protein: 7, fat: 4, carbs: 15, fiber: 6.5, micronutrients: JSON.stringify({ vitamins: { B9: 120 }, minerals: { Magnesium: 60, Iron: 2.5 } }) },
  
  // Mediterranean Cuisine
  { name: 'Салат Греческий', brand: 'Средиземноморская кухня', calories: 115, protein: 3, fat: 9, carbs: 5, fiber: 2.2, micronutrients: JSON.stringify({ vitamins: { K: 45, C: 15 }, minerals: { Calcium: 140 } }) },
  { name: 'Паста Карбонара', brand: 'Итальянская кухня', calories: 350, protein: 14, fat: 18, carbs: 32, fiber: 1.5, micronutrients: JSON.stringify({ vitamins: { B12: 0.8 }, minerals: { Phosphorus: 210 } }) },
  { name: 'Хумус', brand: 'Ближневосточная кухня', calories: 166, protein: 8, fat: 10, carbs: 14, fiber: 6.0, micronutrients: JSON.stringify({ vitamins: { B6: 0.4 }, minerals: { Iron: 2.4, Magnesium: 71 } }) },
  { name: 'Сибас на гриле', brand: 'Средиземноморская кухня', calories: 125, protein: 24, fat: 3, carbs: 0, fiber: 0, micronutrients: JSON.stringify({ vitamins: { D: 10, B12: 3.5 }, minerals: { Selenium: 45 }, aminoAcids: { Leucine: 1900, Isoleucine: 1000, Valine: 1200, Lysine: 1700, Threonine: 900, Tryptophan: 280, Methionine: 600, Phenylalanine: 950, Histidine: 650, Arginine: 1500 } }) },
  
  // Asian Cuisine
  { name: 'Суши Ролл Филадельфия', brand: 'Японская кухня', calories: 220, protein: 9, fat: 11, carbs: 21, fiber: 0.5, micronutrients: JSON.stringify({ vitamins: { D: 4, B12: 1.2 }, minerals: { Iodine: 50 } }) },
  { name: 'Том Ям', brand: 'Тайская кухня', calories: 95, protein: 6, fat: 5, carbs: 7, fiber: 1.2, micronutrients: JSON.stringify({ vitamins: { C: 25 }, minerals: { Potassium: 310 } }) },
  { name: 'Утка по-пекински', brand: 'Китайская кухня', calories: 330, protein: 19, fat: 28, carbs: 1.5, fiber: 0, micronutrients: JSON.stringify({ vitamins: { B3: 5.5 }, minerals: { Iron: 2.7 } }) },
  { name: 'Фо Бо', brand: 'Вьетнамская кухня', calories: 110, protein: 8, fat: 3, carbs: 12, fiber: 0.8, micronutrients: JSON.stringify({ vitamins: { B6: 0.2 }, minerals: { Iron: 1.5, Sodium: 650 } }) },
  
  // Drinks & Beverages
  { name: 'Кофе Капучино', brand: 'Напитки', calories: 45, protein: 3, fat: 2.5, carbs: 4, fiber: 0, micronutrients: JSON.stringify({ vitamins: { B2: 0.15 }, minerals: { Calcium: 110 } }) },
  { name: 'Чай Зеленый', brand: 'Напитки', calories: 2, protein: 0.2, fat: 0, carbs: 0.3, fiber: 0, micronutrients: JSON.stringify({ vitamins: { C: 2 }, minerals: { Potassium: 25, Manganese: 0.3 } }) },
  { name: 'Вино красное сухое', brand: 'Алкоголь', calories: 85, protein: 0.1, fat: 0, carbs: 2.6, fiber: 0, micronutrients: JSON.stringify({ minerals: { Potassium: 127, Iron: 0.5 } }) },
  { name: 'Пиво светлое', brand: 'Алкоголь', calories: 43, protein: 0.5, fat: 0, carbs: 3.6, fiber: 0, micronutrients: JSON.stringify({ vitamins: { B3: 0.5, B9: 6 }, minerals: { Magnesium: 6 } }) },
  { name: 'Смузи клубника-банан', brand: 'Напитки', calories: 65, protein: 1.2, fat: 0.5, carbs: 14, fiber: 2.5, micronutrients: JSON.stringify({ vitamins: { C: 35, B6: 0.2 }, minerals: { Potassium: 280 } }) },
  { name: 'Матча Латте', brand: 'Напитки', calories: 55, protein: 3.5, fat: 2.8, carbs: 5, fiber: 0.5, micronutrients: JSON.stringify({ vitamins: { A: 80, C: 5 }, minerals: { Calcium: 125 } }) },
  
  // More Russian
  { name: 'Рассольник', brand: 'Русская кухня', calories: 45, protein: 2, fat: 2.5, carbs: 4.5, fiber: 1.2, micronutrients: JSON.stringify({ vitamins: { C: 8 }, minerals: { Sodium: 550 } }) },
  { name: 'Гречка с грибами', brand: 'Русская кухня', calories: 130, protein: 4.5, fat: 5, carbs: 18, fiber: 3.5, micronutrients: JSON.stringify({ vitamins: { B1: 0.2, B6: 0.3 }, minerals: { Magnesium: 80, Iron: 2.2 } }) },
  { name: 'Винегрет', brand: 'Русская кухня', calories: 90, protein: 1.5, fat: 5, carbs: 10, fiber: 3.2, micronutrients: JSON.stringify({ vitamins: { C: 12, A: 40 }, minerals: { Potassium: 320 } }) },
  
  // More Caucasian
  { name: 'Сациви из курицы', brand: 'Грузинская кухня', calories: 240, protein: 18, fat: 16, carbs: 6, fiber: 1.5, micronutrients: JSON.stringify({ vitamins: { B6: 0.4 }, minerals: { Zinc: 2.5, Iron: 1.8 } }) },
  { name: 'Чахохбили', brand: 'Грузинская кухня', calories: 160, protein: 14, fat: 9, carbs: 5, fiber: 1.8, micronutrients: JSON.stringify({ vitamins: { C: 15, A: 60 }, minerals: { Potassium: 420 } }) },
  
  // More Asian
  { name: 'Мисо суп', brand: 'Японская кухня', calories: 40, protein: 3, fat: 1.5, carbs: 4, fiber: 1.0, micronutrients: JSON.stringify({ vitamins: { B12: 0.5 }, minerals: { Sodium: 800, Magnesium: 30 } }) },
  { name: 'Курица Гунбао', brand: 'Китайская кухня', calories: 210, protein: 16, fat: 12, carbs: 10, fiber: 1.5, micronutrients: JSON.stringify({ vitamins: { B3: 4.5 }, minerals: { Zinc: 1.8 } }) },
  
  // More Drinks
  { name: 'Эспрессо', brand: 'Напитки', calories: 1, protein: 0.1, fat: 0, carbs: 0, fiber: 0, micronutrients: JSON.stringify({ minerals: { Magnesium: 2, Potassium: 42 } }) },
  { name: 'Латте Макиато', brand: 'Напитки', calories: 60, protein: 3.2, fat: 3.5, carbs: 4.5, fiber: 0, micronutrients: JSON.stringify({ vitamins: { B12: 0.4 }, minerals: { Calcium: 115 } }) },
  { name: 'Пиво темное', brand: 'Алкоголь', calories: 50, protein: 0.6, fat: 0, carbs: 4.5, fiber: 0, micronutrients: JSON.stringify({ vitamins: { B3: 0.6, B9: 8 } }) },
  { name: 'Джин-тоник', brand: 'Алкоголь', calories: 170, protein: 0, fat: 0, carbs: 15, fiber: 0, micronutrients: JSON.stringify({ minerals: { Sodium: 15 } }) },
];

async function main() {
  console.log('Seeding diverse cuisines...');
  for (const food of foods) {
    await prisma.product.upsert({
      where: { name_brand: { name: food.name, brand: food.brand } },
      update: food,
      create: food,
    });
  }
  console.log('Seeding complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
