import express from "express";
import { createServer as createViteServer } from "vite";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";
import multer from "multer";
import { GoogleGenAI, Type } from "@google/genai";
import Levenshtein from "fast-levenshtein";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const prisma = new PrismaClient();
const upload = multer({ storage: multer.memoryStorage() });

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

async function startServer() {
  // ... rest of setup ...
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(cookieParser());

  // --- API Routes ---

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", version: "1.0.0" });
  });

  // Barcode Scan (Mock)
  app.get("/api/products/barcode/:code", async (req, res) => {
    const { code } = req.params;
    const product = await prisma.product.findUnique({ where: { barcode: code } });
    if (!product) return res.status(404).json({ error: "Not found" });
    res.json(product);
  });

  // Auth Placeholder (Mock)
  app.post("/api/auth/login", async (req, res) => {
    let user = await prisma.user.findFirst({ where: { email: "user@nutria.app" } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          email: "user@nutria.app",
          passwordHash: "mock-hash",
          role: "USER",
          nutrientGoals: {
            create: {
              calories: 2100,
              protein: 120,
              fat: 70,
              carbs: 250,
              fiber: 30
            }
          }
        }
      });
    }
    res.cookie("token", user.id, { httpOnly: true, secure: true, sameSite: "none" });
    res.json({ success: true, user: { email: user.email, role: user.role } });
  });

  app.get("/api/auth/me", async (req, res) => {
    const userId = req.cookies.token;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const user = await prisma.user.findUnique({ where: { id: userId } });
    res.json({ user });
  });

  // Food Match Engine: Search products
  app.get("/api/products/search", async (req, res) => {
    const { q } = req.query;
    if (!q) return res.json([]);

    const query = String(q).trim();
    
    // Stage A: Normalization & Translation (using Gemini)
    // We normalize the query to handle synonyms, units, and translate to English for USDA
    let normalizedQuery = query;
    let englishQuery = query;
    let categories: string[] = [];

    try {
      const normResponse = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Analyze this food search query: "${query}". 
        Return JSON with:
        - normalized: canonical Russian name (e.g. "яблоко" for "яблочки")
        - english: accurate English translation for USDA database search
        - tags: array of categories (e.g. ["fruit", "snack", "raw"])
        - isDrink: boolean`,
        config: { responseMimeType: "application/json" }
      });
      const normData = JSON.parse(normResponse.text || '{}');
      normalizedQuery = normData.normalized || query;
      englishQuery = normData.english || query;
      categories = normData.tags || [];
    } catch (e) {
      console.error("Normalization error:", e);
    }

    // Stage B: Fast Candidate Selection
    // 1. Search local DB (using token-based approach for better matching)
    const tokens = query.split(/\s+/).filter(t => t.length > 2);
    const localProducts = await prisma.product.findMany({
      where: {
        OR: [
          { name: { contains: normalizedQuery } },
          { name: { contains: query } },
          ...tokens.map(t => ({ name: { contains: t } })),
          { brand: { contains: query } }
        ]
      },
      take: 20
    });
    
    const parsedLocal = localProducts.map(p => {
      let micro: any = {};
      try {
        micro = JSON.parse(p.micronutrients || '{}');
      } catch (e) {}
      return { ...p, ...micro, source: 'local' };
    });

    // 2. Search USDA API
    let usdaProducts: any[] = [];
    const usdaKey = process.env.USDA_FDC_API_KEY;
    if (usdaKey && englishQuery.length > 2) {
      try {
        const response = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${usdaKey}&query=${encodeURIComponent(englishQuery)}&pageSize=15`);
        if (response.ok) {
          const data: any = await response.json();
          usdaProducts = (data.foods || []).map((f: any) => {
            const getNutrient = (id: number) => f.foodNutrients?.find((n: any) => n.nutrientId === id || n.nutrientNumber === String(id))?.value || 0;
            
            const vitamins: any = {};
            const minerals: any = {};
            const aminoAcids: any = {};
            
            // Mapping
            if (getNutrient(1104)) vitamins.A = getNutrient(1104);
            if (getNutrient(1162)) vitamins.C = getNutrient(1162);
            if (getNutrient(1114)) vitamins.D = getNutrient(1114);
            if (getNutrient(1109)) vitamins.E = getNutrient(1109);
            if (getNutrient(1185)) vitamins.K = getNutrient(1185);
            if (getNutrient(1165)) vitamins.B1 = getNutrient(1165);
            if (getNutrient(1166)) vitamins.B2 = getNutrient(1166);
            if (getNutrient(1167)) vitamins.B3 = getNutrient(1167);
            if (getNutrient(1170)) vitamins.B5 = getNutrient(1170);
            if (getNutrient(1175)) vitamins.B6 = getNutrient(1175);
            if (getNutrient(1176)) vitamins.B7 = getNutrient(1176);
            if (getNutrient(1177)) vitamins.B9 = getNutrient(1177);
            if (getNutrient(1178)) vitamins.B12 = getNutrient(1178);
            
            if (getNutrient(1087)) minerals.Calcium = getNutrient(1087);
            if (getNutrient(1089)) minerals.Iron = getNutrient(1089);
            if (getNutrient(1090)) minerals.Magnesium = getNutrient(1090);
            if (getNutrient(1091)) minerals.Phosphorus = getNutrient(1091);
            if (getNutrient(1092)) minerals.Potassium = getNutrient(1092);
            if (getNutrient(1093)) minerals.Sodium = getNutrient(1093);
            if (getNutrient(1095)) minerals.Zinc = getNutrient(1095);
            if (getNutrient(1098)) minerals.Copper = getNutrient(1098);
            if (getNutrient(1103)) minerals.Selenium = getNutrient(1103);

            if (getNutrient(1210)) aminoAcids.Tryptophan = getNutrient(1210);
            if (getNutrient(1211)) aminoAcids.Threonine = getNutrient(1211);
            if (getNutrient(1212)) aminoAcids.Isoleucine = getNutrient(1212);
            if (getNutrient(1213)) aminoAcids.Leucine = getNutrient(1213);
            if (getNutrient(1214)) aminoAcids.Lysine = getNutrient(1214);
            if (getNutrient(1215)) aminoAcids.Methionine = getNutrient(1215);
            if (getNutrient(1216)) aminoAcids.Cystine = getNutrient(1216);
            if (getNutrient(1217)) aminoAcids.Phenylalanine = getNutrient(1217);
            if (getNutrient(1218)) aminoAcids.Tyrosine = getNutrient(1218);
            if (getNutrient(1219)) aminoAcids.Valine = getNutrient(1219);
            if (getNutrient(1220)) aminoAcids.Arginine = getNutrient(1220);
            if (getNutrient(1221)) aminoAcids.Histidine = getNutrient(1221);
            if (getNutrient(1222)) aminoAcids.Alanine = getNutrient(1222);
            if (getNutrient(1223)) aminoAcids.AsparticAcid = getNutrient(1223);
            if (getNutrient(1224)) aminoAcids.GlutamicAcid = getNutrient(1224);
            if (getNutrient(1225)) aminoAcids.Glycine = getNutrient(1225);
            if (getNutrient(1226)) aminoAcids.Proline = getNutrient(1226);
            if (getNutrient(1227)) aminoAcids.Serine = getNutrient(1227);

            return {
              id: `usda-${f.fdcId}`,
              name: f.description,
              brand: f.brandOwner || 'USDA',
              calories: getNutrient(1008) || getNutrient(208),
              protein: getNutrient(1003) || getNutrient(203),
              fat: getNutrient(1004) || getNutrient(204),
              carbs: getNutrient(1005) || getNutrient(205),
              fiber: getNutrient(1079) || getNutrient(291),
              vitamins,
              minerals,
              aminoAcids,
              isUsda: true,
              fdcId: f.fdcId,
              source: 'usda'
            };
          });
        }
      } catch (e) {
        console.error("USDA Search Error:", e);
      }
    }

    // Stage C: String Similarity (Levenshtein) & Ranking
    const allCandidates = [...parsedLocal, ...usdaProducts];
    const scoredCandidates = allCandidates.map(c => {
      // Calculate similarity score
      const nameLower = c.name.toLowerCase();
      const queryLower = query.toLowerCase();
      const normLower = normalizedQuery.toLowerCase();
      
      const distQuery = Levenshtein.get(queryLower, nameLower);
      const distNorm = Levenshtein.get(normLower, nameLower);
      const minDist = Math.min(distQuery, distNorm);
      
      const maxLen = Math.max(queryLower.length, nameLower.length, normLower.length);
      const similarity = 1 - (minDist / maxLen);
      
      // Boost local products slightly for speed/relevance
      const sourceBoost = c.source === 'local' ? 0.1 : 0;
      
      return { ...c, matchScore: similarity + sourceBoost };
    });

    // Sort by match score
    scoredCandidates.sort((a, b) => b.matchScore - a.matchScore);

    // Stage D: LLM Re-rank (Final Layer) & AI Estimation
    let finalResults = scoredCandidates.slice(0, 15);
    
    // If we have very few results or low confidence, we ask AI to estimate the product
    if (finalResults.length === 0 || (finalResults.length > 0 && finalResults[0].matchScore < 0.6)) {
      try {
        const estimateResponse = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: `The user is searching for a food item: "${query}". 
          I couldn't find a perfect match in my database. 
          Please estimate the nutritional values for 100g of this item.
          Return JSON:
          {
            "name": "Estimated Name",
            "calories": number,
            "protein": number,
            "fat": number,
            "carbs": number,
            "fiber": number,
            "vitamins": { "C": number, ... },
            "minerals": { "Iron": number, ... },
            "aminoAcids": { "Leucine": number, ... },
            "explanation": "Briefly why these values"
          }`,
          config: { responseMimeType: "application/json" }
        });
        const estData = JSON.parse(estimateResponse.text || '{}');
        if (estData.name) {
          finalResults.unshift({
            id: `ai-est-${Date.now()}`,
            name: `✨ ${estData.name} (AI Оценка)`,
            brand: 'AI Nutria Engine',
            calories: estData.calories || 0,
            protein: estData.protein || 0,
            fat: estData.fat || 0,
            carbs: estData.carbs || 0,
            fiber: estData.fiber || 0,
            vitamins: estData.vitamins || {},
            minerals: estData.minerals || {},
            aminoAcids: estData.aminoAcids || {},
            isAiEstimated: true,
            explanation: estData.explanation,
            matchScore: 0.95,
            source: 'ai'
          });
        }
      } catch (e) {
        console.error("AI Estimation error:", e);
      }
    }

    // Sort again if AI estimation was added
    finalResults.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));

    if (finalResults.length > 1 && finalResults[0].matchScore < 0.95) {
      try {
        const reRankResponse = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: `User is searching for: "${query}" (Normalized: "${normalizedQuery}").
          I found these candidates:
          ${finalResults.map((c, i) => `${i}: ${c.name} (${c.brand}) - Score: ${c.matchScore}`).join('\n')}
          
          Which of these are the best matches? Return JSON with an array of indices in order of relevance. 
          Exclude completely irrelevant items. If an AI estimation is present and looks accurate, prioritize it.`,
          config: { responseMimeType: "application/json" }
        });
        const reRankData = JSON.parse(reRankResponse.text || '{}');
        let indices = [];
        if (Array.isArray(reRankData)) indices = reRankData;
        else if (reRankData.indices && Array.isArray(reRankData.indices)) indices = reRankData.indices;
        
        if (indices.length > 0) {
          finalResults = indices.map((idx: number) => finalResults[idx]).filter(Boolean);
        }
      } catch (e) {
        console.error("Re-ranking error:", e);
      }
    }

    res.json(finalResults.slice(0, 10));
  });

  // Diary: Get daily meals and aggregates
  app.get("/api/diary", async (req, res) => {
    const userId = req.cookies.token;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const meals = await prisma.meal.findMany({
      where: {
        userId,
        date: { gte: startOfDay, lte: endOfDay }
      },
      include: {
        items: {
          include: { product: true }
        }
      }
    });

    const goals = await prisma.nutrientGoal.findUnique({ where: { userId } });

    // Calculate water intake from special "WATER" meal type
    const waterMeal = meals.find(m => m.type === 'WATER');
    const waterIntake = waterMeal ? waterMeal.items.reduce((sum, item) => sum + item.amount, 0) : 0;

    // Parse micronutrients for each product in the diary
    const parsedMeals = meals.filter(m => m.type !== 'WATER').map(m => ({
      ...m,
      items: m.items.map(i => {
        let micro: any = {};
        try {
          micro = JSON.parse(i.product.micronutrients || '{}');
        } catch (e) {}
        return {
          ...i,
          product: { ...i.product, ...micro }
        };
      })
    }));

    res.json({ meals: parsedMeals, goals, waterIntake });
  });

  // Diary: Update water intake
  app.post("/api/diary/water", async (req, res) => {
    const userId = req.cookies.token;
    const { amount } = req.body; // amount can be positive or negative
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    let meal = await prisma.meal.findFirst({
      where: { userId, type: 'WATER', date: { gte: startOfDay } }
    });

    if (!meal) {
      meal = await prisma.meal.create({
        data: { userId, type: 'WATER', date: new Date() }
      });
    }

    // We need a dummy product for water if it doesn't exist
    let waterProduct = await prisma.product.findFirst({ where: { name: 'Water', brand: 'System' } });
    if (!waterProduct) {
      waterProduct = await prisma.product.create({
        data: { name: 'Water', brand: 'System', calories: 0, protein: 0, fat: 0, carbs: 0 }
      });
    }

    await prisma.mealItem.create({
      data: {
        mealId: meal.id,
        productId: waterProduct.id,
        amount: Number(amount)
      }
    });

    res.json({ success: true });
  });

  // Diary: Delete meal item
  app.delete("/api/diary/item/:id", async (req, res) => {
    const userId = req.cookies.token;
    const { id } = req.params;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    // Verify ownership
    const item = await prisma.mealItem.findUnique({
      where: { id },
      include: { meal: true }
    });

    if (!item || item.meal.userId !== userId) {
      return res.status(403).json({ error: "Forbidden or not found" });
    }

    await prisma.mealItem.delete({ where: { id } });
    res.json({ success: true });
  });

  // Diary: Add meal item
  app.post("/api/diary/add", async (req, res) => {
    const userId = req.cookies.token;
    let { productId, amount, type, usdaData } = req.body;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    // If it's a USDA product, we need to ensure it exists in our local DB first
    if ((String(productId).startsWith('usda-') || String(productId).startsWith('ai-est-')) && usdaData) {
      let product = await prisma.product.findFirst({
        where: { name: usdaData.name, brand: usdaData.brand }
      });

      if (!product) {
        product = await prisma.product.create({
          data: {
            name: usdaData.name,
            brand: usdaData.brand,
            calories: usdaData.calories,
            protein: usdaData.protein,
            fat: usdaData.fat,
            carbs: usdaData.carbs,
            fiber: usdaData.fiber,
            micronutrients: JSON.stringify({
              vitamins: usdaData.vitamins,
              minerals: usdaData.minerals,
              aminoAcids: usdaData.aminoAcids
            })
          }
        });
      }
      productId = product.id;
    }

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    let meal = await prisma.meal.findFirst({
      where: {
        userId,
        type,
        date: { gte: startOfDay }
      }
    });

    if (!meal) {
      meal = await prisma.meal.create({
        data: { userId, type, date: new Date() }
      });
    }

    const mealItem = await prisma.mealItem.create({
      data: {
        mealId: meal.id,
        productId,
        amount: Number(amount)
      }
    });

    res.json(mealItem);
  });

  // --- Admin Routes ---
  app.get("/api/admin/users", async (req, res) => {
    const userId = req.cookies.token;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user?.role !== "ADMIN") return res.status(403).json({ error: "Forbidden" });
    const users = await prisma.user.findMany({ include: { _count: { select: { meals: true } } } });
    res.json(users);
  });

  app.get("/api/admin/stats", async (req, res) => {
    const userId = req.cookies.token;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user?.role !== "ADMIN") return res.status(403).json({ error: "Forbidden" });
    
    const userCount = await prisma.user.count();
    const productCount = await prisma.product.count();
    const mealCount = await prisma.meal.count();
    
    res.json({ userCount, productCount, mealCount });
  });

  // --- Vite / Static ---
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Nutria Server running on http://localhost:${PORT}`);
  });
}

startServer().catch(console.error);
