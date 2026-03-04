import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const products = [
    { 
      name: 'Куриная грудка', 
      brand: 'Мираторг', 
      calories: 165, 
      protein: 31, 
      fat: 3.6, 
      carbs: 0, 
      fiber: 0,
      micronutrients: JSON.stringify({
        vitamins: { B12: 0.6, B6: 0.6, B3: 13.7 },
        minerals: { Phosphorus: 210, Potassium: 256, Sodium: 74, Magnesium: 29, Iron: 1, Zinc: 1 },
        aminoAcids: { Leucine: 2400, Isoleucine: 1400, Valine: 1500, Lysine: 2600 }
      })
    },
    { 
      name: 'Яблоко', 
      brand: 'Сезонное', 
      calories: 52, 
      protein: 0.3, 
      fat: 0.2, 
      carbs: 14, 
      fiber: 2.4,
      micronutrients: JSON.stringify({
        vitamins: { C: 4.6, A: 3, K: 2.2 },
        minerals: { Potassium: 107, Calcium: 6, Magnesium: 5, Phosphorus: 11, Iron: 0.1 }
      })
    },
    { 
      name: 'Гречка отварная', 
      brand: 'Увелка', 
      calories: 110, 
      protein: 4.2, 
      fat: 1.1, 
      carbs: 21.3, 
      fiber: 2.7,
      micronutrients: JSON.stringify({
        vitamins: { B1: 0.1, B2: 0.04, B6: 0.1, E: 0.1 },
        minerals: { Magnesium: 51, Phosphorus: 70, Potassium: 88, Iron: 0.8, Zinc: 0.6 }
      })
    },
    { 
      name: 'Яйцо куриное', 
      brand: 'С0', 
      calories: 155, 
      protein: 13, 
      fat: 11, 
      carbs: 1.1, 
      fiber: 0,
      micronutrients: JSON.stringify({
        vitamins: { A: 160, D: 2, E: 1, B12: 0.9, B2: 0.5 },
        minerals: { Calcium: 50, Phosphorus: 172, Potassium: 126, Sodium: 124, Iron: 1.2, Zinc: 1.1 },
        aminoAcids: { Leucine: 1080, Isoleucine: 680, Valine: 760, Lysine: 900 }
      })
    },
    { 
      name: 'Творог 5%', 
      brand: 'Простоквашино', 
      calories: 121, 
      protein: 16, 
      fat: 5, 
      carbs: 3, 
      fiber: 0,
      micronutrients: JSON.stringify({
        vitamins: { B12: 0.4, B2: 0.2, A: 20 },
        minerals: { Calcium: 164, Phosphorus: 220, Potassium: 112, Sodium: 40, Magnesium: 23 },
        aminoAcids: { Leucine: 1500, Isoleucine: 800, Valine: 900, Lysine: 1300 }
      })
    },
    { 
      name: 'Банан', 
      brand: 'Эквадор', 
      calories: 89, 
      protein: 1.1, 
      fat: 0.3, 
      carbs: 23, 
      fiber: 2.6,
      micronutrients: JSON.stringify({
        vitamins: { C: 8.7, B6: 0.4, A: 3 },
        minerals: { Potassium: 358, Magnesium: 27, Phosphorus: 22, Calcium: 5, Iron: 0.3 }
      })
    },
    { 
      name: 'Авокадо', 
      brand: 'Хасс', 
      calories: 160, 
      protein: 2, 
      fat: 15, 
      carbs: 9, 
      fiber: 7,
      micronutrients: JSON.stringify({
        vitamins: { K: 21, C: 10, E: 2, B5: 1.4, B6: 0.3, B9: 81 },
        minerals: { Potassium: 485, Magnesium: 29, Phosphorus: 52, Calcium: 12, Iron: 0.6 }
      })
    },
  ];

  for (const product of products) {
    await prisma.product.upsert({
      where: { barcode: product.name }, // Use name as mock barcode for seed
      update: {},
      create: {
        ...product,
        barcode: Math.random().toString(36).substring(7),
      },
    });
  }

  console.log('Seed completed!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
