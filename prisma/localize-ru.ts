import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import OpenAI from "openai";

const prisma = new PrismaClient();
const CYRILLIC_RE = /[А-Яа-яЁё]/;

function hasCyrillic(value: unknown) {
  return CYRILLIC_RE.test(String(value || ""));
}

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

async function translateToRussian(openai: OpenAI, text: string, type: "name" | "brand") {
  const source = normalizeText(text);
  if (!source || hasCyrillic(source)) return source;

  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_TEXT_MODEL || "gpt-4o-mini",
    messages: [
      {
        role: "user",
        content: `Переведи на русский ${type === "name" ? "название продукта/блюда" : "название бренда"}: "${source}".\nВерни только JSON вида: {"text":"..."}`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0]?.message?.content || "{}";
  const parsed = JSON.parse(raw);
  const translated = normalizeText(parsed?.text);
  return translated || source;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for db:localize:ru");
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for db:localize:ru");
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const dryRun = String(process.env.DRY_RUN || "false").toLowerCase() === "true";

  const products = await prisma.product.findMany({
    select: { id: true, name: true, brand: true },
  });

  let scanned = 0;
  let updated = 0;

  for (const product of products) {
    scanned += 1;

    const currentName = normalizeText(product.name);
    const currentBrand = normalizeText(product.brand);

    const nextName = await translateToRussian(openai, currentName, "name");
    const nextBrand = currentBrand ? await translateToRussian(openai, currentBrand, "brand") : currentBrand;

    if (nextName === currentName && nextBrand === currentBrand) {
      continue;
    }

    if (!dryRun) {
      await prisma.product.update({
        where: { id: product.id },
        data: {
          name: nextName,
          brand: nextBrand || null,
        },
      });
    }

    updated += 1;
  }

  console.log(`Localization completed. Scanned: ${scanned}, updated: ${updated}, dryRun: ${dryRun}`);
}

main()
  .catch((error) => {
    console.error("Localization failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
