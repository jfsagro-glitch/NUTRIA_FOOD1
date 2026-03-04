import express from "express";
import { createServer as createViteServer } from "vite";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";
import multer from "multer";
import { GoogleGenAI, Type } from "@google/genai";
import Levenshtein from "fast-levenshtein";
import OpenAI from "openai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const prisma = new PrismaClient();
const upload = multer({ storage: multer.memoryStorage() });

// AI Clients
const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;
const deepseek = process.env.DEEPSEEK_API_KEY ? new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com"
}) : null;
const openai = process.env.OPENAI_API_KEY ? new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
}) : null;

function isDatabaseConfigured() {
  return typeof process.env.DATABASE_URL === "string" && process.env.DATABASE_URL.trim().length > 0;
}

// AI Helper: Unified AI Generation with Fallback (Gemini -> DeepSeek -> OpenAI)
async function generateAI(prompt: string, responseMimeType: string = "application/json", image?: { data: string, mimeType: string }) {
  // 1. Try Gemini
  if (ai) {
    try {
      const contents = image 
        ? { parts: [{ text: prompt }, { inlineData: { data: image.data, mimeType: image.mimeType } }] }
        : prompt;
      
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: contents as any,
        config: { responseMimeType: responseMimeType as any }
      });
      if (response.text) return response.text;
    } catch (e) {
      console.warn("Gemini Error, falling back to DeepSeek:", e);
    }
  } else {
    console.warn("GEMINI_API_KEY is missing, skipping Gemini and trying fallback providers.");
  }

  // 2. Try DeepSeek (Note: DeepSeek chat doesn't support images yet, so we skip if image present)
  if (deepseek && !image) {
    try {
      const response = await deepseek.chat.completions.create({
        model: "deepseek-chat",
        messages: [{ role: "user", content: prompt }],
        response_format: responseMimeType === "application/json" ? { type: "json_object" } : undefined
      });
      return response.choices[0].message.content;
    } catch (e) {
      console.warn("DeepSeek Error, falling back to OpenAI:", e);
    }
  }

  // 3. Try OpenAI (Supports images via GPT-4o)
  if (openai) {
    try {
      const messages: any[] = [
        {
          role: "user",
          content: image 
            ? [
                { type: "text", text: prompt },
                { type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.data}` } }
              ]
            : prompt
        }
      ];

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        response_format: responseMimeType === "application/json" ? { type: "json_object" } : undefined
      });
      return response.choices[0].message.content;
    } catch (e) {
      console.error("OpenAI Error:", e);
    }
  }

  throw new Error("All AI models failed or keys are missing.");
}

async function startServer() {
  // ... rest of setup ...
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json());
  app.use(cookieParser());

  // --- API Routes ---

  // AI Proxy: Unified generation with fallback
  app.post("/api/ai/generate", async (req, res) => {
    const { prompt, responseMimeType, image } = req.body;
    if (!prompt) return res.status(400).json({ error: "No prompt provided" });

    try {
      const text = await generateAI(prompt, responseMimeType, image);
      res.json({ text });
    } catch (e: any) {
      console.error("AI Proxy Error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // Health check
  app.get("/api/health", async (req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: "ok", database: "connected", version: "1.0.0" });
    } catch (e: any) {
      console.error("Health check database error:", e);
      res.status(500).json({ status: "error", database: "disconnected", error: e.message });
    }
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
    if (!isDatabaseConfigured()) {
      return res.status(503).json({ error: "Database is not configured", code: "DATABASE_URL_MISSING" });
    }

    try {
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
    } catch (e: any) {
      console.error("Auth Login Error:", e);
      res.status(500).json({ error: "Internal Server Error", message: e.message });
    }
  });

  app.get("/api/auth/me", async (req, res) => {
    try {
      const userId = req.cookies.token;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const user = await prisma.user.findUnique({ where: { id: userId } });
      res.json({ user });
    } catch (e: any) {
      console.error("Auth Me Error:", e);
      res.status(500).json({ error: "Internal Server Error", message: e.message });
    }
  });

  // Food Match Engine: Search products
  app.get("/api/products/search", async (req, res) => {
    try {
      const { q } = req.query;
      if (!q) return res.json([]);

      const query = String(q).trim();
      const dbReady = isDatabaseConfigured();
    
    // Stage A: Normalization & Translation (using Gemini)
    // We normalize the query to handle synonyms, units, and translate to English for USDA
    let normalizedQuery = query;
    let englishQuery = query;
    let searchTerms: string[] = [query];
    let categories: string[] = [];

    try {
      const normResponseText = await generateAI(`Analyze this food search query: "${query}". 
        The user might be using Russian, English, or a mix.
        Return JSON with:
        - normalized: canonical Russian name (e.g. "яблоко" for "яблочки")
        - english: accurate English translation for USDA database search
        - search_terms: array of 3-5 keywords for broad database searching (include both RU and EN versions)
        - tags: array of categories (e.g. ["fruit", "snack", "raw"])
        - isDrink: boolean`);
      const normData = JSON.parse(normResponseText || '{}');
      normalizedQuery = normData.normalized || query;
      englishQuery = normData.english || query;
      searchTerms = Array.from(new Set([
        query, 
        normalizedQuery, 
        englishQuery, 
        ...(normData.search_terms || [])
      ])).filter(t => t && t.length > 1);
      categories = normData.tags || [];
    } catch (e) {
      console.error("Normalization error:", e);
    }

    // Stage B: Fast Candidate Selection
    // 1. Search local DB (using token-based approach for better matching)
      const tokens = query.split(/\s+/).filter(t => t.length > 1);
      const localProducts = dbReady
        ? await prisma.product.findMany({
            where: {
              OR: [
                { name: { contains: normalizedQuery } },
                { name: { contains: query } },
                { name: { contains: englishQuery } },
                ...searchTerms.map(t => ({ name: { contains: t } })),
                ...tokens.map(t => ({ name: { contains: t } })),
                { brand: { contains: query } }
              ]
            },
            take: 30
          })
        : [];
    
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
    if (usdaKey && englishQuery.length > 1) {
      try {
        // Search with English query
        const response = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${usdaKey}&query=${encodeURIComponent(englishQuery)}&pageSize=15`);
        if (response.ok) {
          const data: any = await response.json();
          usdaProducts = (data.foods || []).map((f: any) => {
            const getNutrient = (id: number) => f.foodNutrients?.find((n: any) => n.nutrientId === id || n.nutrientNumber === String(id))?.value || 0;
            const getNutrientMg = (id: number) => (f.foodNutrients?.find((n: any) => n.nutrientId === id || n.nutrientNumber === String(id))?.value || 0) * 1000;
            
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

            if (getNutrientMg(1210)) aminoAcids.Tryptophan = getNutrientMg(1210);
            if (getNutrientMg(1211)) aminoAcids.Threonine = getNutrientMg(1211);
            if (getNutrientMg(1212)) aminoAcids.Isoleucine = getNutrientMg(1212);
            if (getNutrientMg(1213)) aminoAcids.Leucine = getNutrientMg(1213);
            if (getNutrientMg(1214)) aminoAcids.Lysine = getNutrientMg(1214);
            if (getNutrientMg(1215)) aminoAcids.Methionine = getNutrientMg(1215);
            if (getNutrientMg(1216)) aminoAcids.Cystine = getNutrientMg(1216);
            if (getNutrientMg(1217)) aminoAcids.Phenylalanine = getNutrientMg(1217);
            if (getNutrientMg(1218)) aminoAcids.Tyrosine = getNutrientMg(1218);
            if (getNutrientMg(1219)) aminoAcids.Valine = getNutrientMg(1219);
            if (getNutrientMg(1220)) aminoAcids.Arginine = getNutrientMg(1220);
            if (getNutrientMg(1221)) aminoAcids.Histidine = getNutrientMg(1221);
            if (getNutrientMg(1222)) aminoAcids.Alanine = getNutrientMg(1222);
            if (getNutrientMg(1223)) aminoAcids.AsparticAcid = getNutrientMg(1223);
            if (getNutrientMg(1224)) aminoAcids.GlutamicAcid = getNutrientMg(1224);
            if (getNutrientMg(1225)) aminoAcids.Glycine = getNutrientMg(1225);
            if (getNutrientMg(1226)) aminoAcids.Proline = getNutrientMg(1226);
            if (getNutrientMg(1227)) aminoAcids.Serine = getNutrientMg(1227);

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

    // Stage C: String Similarity & Ranking
    const allCandidates = [...parsedLocal, ...usdaProducts];
    const scoredCandidates = allCandidates.map(c => {
      const nameLower = c.name.toLowerCase();
      const queryLower = query.toLowerCase();
      const normLower = normalizedQuery.toLowerCase();
      const engLower = englishQuery.toLowerCase();
      
      // 1. Levenshtein Distance (Character level)
      const distQuery = Levenshtein.get(queryLower, nameLower);
      const distNorm = Levenshtein.get(normLower, nameLower);
      const distEng = Levenshtein.get(engLower, nameLower);
      const minDist = Math.min(distQuery, distNorm, distEng);
      const maxLen = Math.max(queryLower.length, nameLower.length, normLower.length, engLower.length);
      const charSimilarity = 1 - (minDist / maxLen);
      
      // 2. Token Overlap (Word level)
      const queryTokens = new Set([...queryLower.split(/\s+/), ...normLower.split(/\s+/), ...engLower.split(/\s+/)]);
      const nameTokens = nameLower.split(/\s+/);
      const overlap = nameTokens.filter(t => queryTokens.has(t)).length;
      const tokenSimilarity = overlap / Math.max(queryTokens.size, nameTokens.length);

      // 3. Substring Match Boost
      const containsBoost = (nameLower.includes(queryLower) || nameLower.includes(normLower) || nameLower.includes(engLower)) ? 0.2 : 0;
      
      // 4. Source Boost
      const sourceBoost = c.source === 'local' ? 0.1 : 0;
      
      const finalScore = (charSimilarity * 0.3) + (tokenSimilarity * 0.5) + containsBoost + sourceBoost;
      
      return { ...c, matchScore: finalScore };
    });

    // Sort by match score
    scoredCandidates.sort((a, b) => b.matchScore - a.matchScore);

    // Stage D: LLM Re-rank (Final Layer) & AI Estimation
    let finalResults = scoredCandidates.slice(0, 15);
    
    // If we have very few results or low confidence, we ask AI to estimate the product
    if (finalResults.length === 0 || (finalResults.length > 0 && finalResults[0].matchScore < 0.6)) {
      try {
        const estimateResponseText = await generateAI(`The user is searching for a food item: "${query}". 
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
            "aminoAcids": { "Leucine": number, "Isoleucine": number, "Valine": number, "Lysine": number, "Threonine": number, "Tryptophan": number, "Methionine": number, "Phenylalanine": number, "Histidine": number, "Arginine": number },
            "explanation": "Briefly why these values"
          }
          IMPORTANT: Amino acid values MUST be in milligrams (mg) per 100g.`);
        const estData = JSON.parse(estimateResponseText || '{}');
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
        const reRankResponseText = await generateAI(`User is searching for: "${query}" (Normalized: "${normalizedQuery}").
          I found these candidates:
          ${finalResults.map((c, i) => `${i}: ${c.name} (${c.brand}) - Score: ${c.matchScore}`).join('\n')}
          
          Which of these are the best matches? Return JSON with an array of indices in order of relevance. 
          Exclude completely irrelevant items. If an AI estimation is present and looks accurate, prioritize it.`);
        const reRankData = JSON.parse(reRankResponseText || '{}');
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
    } catch (e: any) {
      console.error("Products Search Error:", e);
      res.status(500).json({ error: "Products search failed", message: e.message });
    }
  });

  // Diary: Get daily meals and aggregates
  app.get("/api/diary", async (req, res) => {
    if (!isDatabaseConfigured()) {
      return res.status(503).json({ error: "Database is not configured", code: "DATABASE_URL_MISSING" });
    }

    const userId = req.cookies.token;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    try {
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

      const waterMeal = meals.find(m => m.type === 'WATER');
      const waterIntake = waterMeal ? waterMeal.items.reduce((sum, item) => sum + item.amount, 0) : 0;

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
    } catch (e: any) {
      console.error("Diary Get Error:", e);
      res.status(500).json({ error: "Internal Server Error", message: e.message });
    }
  });

  // Diary: Update water intake
  app.post("/api/diary/water", async (req, res) => {
    if (!isDatabaseConfigured()) {
      return res.status(503).json({ error: "Database is not configured", code: "DATABASE_URL_MISSING" });
    }

    const userId = req.cookies.token;
    const { amount } = req.body; // amount can be positive or negative
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    try {
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
    } catch (e: any) {
      console.error("Diary Water Error:", e);
      res.status(500).json({ error: "Internal Server Error", message: e.message });
    }
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
              vitamins: usdaData.vitamins || {},
              minerals: usdaData.minerals || {},
              aminoAcids: usdaData.aminoAcids || {}
            })
          }
        });
      } else if (!product.micronutrients || product.micronutrients === '{}') {
        // Update existing product if it lacks micronutrients
        product = await prisma.product.update({
          where: { id: product.id },
          data: {
            micronutrients: JSON.stringify({
              vitamins: usdaData.vitamins || {},
              minerals: usdaData.minerals || {},
              aminoAcids: usdaData.aminoAcids || {}
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

  // Voice: Parse transcript into food items
  app.post("/api/voice/parse", async (req, res) => {
    const { transcript } = req.body;
    if (!transcript) return res.status(400).json({ error: "No transcript provided" });

    try {
      const responseText = await generateAI(`The user said: "${transcript}". 
        Extract food items and their estimated amounts (in grams or ml). 
        If amount is not specified, estimate a typical portion.
        Return JSON array of objects: [{ "name": "food name", "amount": number }].
        Focus on accuracy and common portion sizes.`);

      const items = JSON.parse(responseText || "[]");
      
      // Match each item with database products
      const dbReady = isDatabaseConfigured();

      const matchedItems = await Promise.all(items.map(async (item: any) => {
        // Use the existing search logic (internal call or refactor search logic)
        // For simplicity, we'll fetch from our own search endpoint or reuse the logic
        // Let's just do a quick search here
        const normalizedQuery = item.name;
        const localProducts = dbReady
          ? await prisma.product.findMany({
              where: {
                OR: [
                  { name: { contains: normalizedQuery } },
                  { name: { contains: item.name } }
                ]
              },
              take: 1
            })
          : [];

        if (localProducts.length > 0) {
          return { ...item, product: { ...localProducts[0], source: 'local' } };
        }

        // Try USDA
        const usdaKey = process.env.USDA_FDC_API_KEY;
        if (usdaKey) {
          try {
            const usdaRes = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${usdaKey}&query=${encodeURIComponent(item.name)}&pageSize=1`);
            if (usdaRes.ok) {
              const usdaData: any = await usdaRes.json();
              if (usdaData.foods && usdaData.foods.length > 0) {
                const f = usdaData.foods[0];
                const getNutrient = (id: number) => f.foodNutrients?.find((n: any) => n.nutrientId === id || n.nutrientNumber === String(id))?.value || 0;
                return {
                  ...item,
                  product: {
                    id: `usda-${f.fdcId}`,
                    name: f.description,
                    brand: f.brandOwner || 'USDA',
                    calories: getNutrient(1008) || getNutrient(208),
                    protein: getNutrient(1003) || getNutrient(203),
                    fat: getNutrient(1004) || getNutrient(204),
                    carbs: getNutrient(1005) || getNutrient(205),
                    fiber: getNutrient(1079) || getNutrient(291),
                    source: 'usda',
                    isUsda: true
                  }
                };
              }
            }
          } catch (e) {}
        }

        // If still no product, use AI to estimate
        try {
          const estText = await generateAI(`Estimate nutritional values for 100g of "${item.name}". 
            Return JSON: { "calories": number, "protein": number, "fat": number, "carbs": number, "fiber": number, "aminoAcids": { "Leucine": number, "Isoleucine": number, "Valine": number, "Lysine": number, "Threonine": number, "Tryptophan": number, "Methionine": number, "Phenylalanine": number, "Histidine": number, "Arginine": number }, "explanation": "string" }
            IMPORTANT: Amino acid values MUST be in milligrams (mg) per 100g.`);
          const est = JSON.parse(estText || '{}');
          return {
            ...item,
            product: {
              id: `ai-est-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
              name: `✨ ${item.name} (AI Оценка)`,
              brand: 'AI Nutria Engine',
              calories: est.calories || 0,
              protein: est.protein || 0,
              fat: est.fat || 0,
              carbs: est.carbs || 0,
              fiber: est.fiber || 0,
              isAiEstimated: true,
              explanation: est.explanation,
              source: 'ai'
            }
          };
        } catch (e) {
          console.error("AI estimation in voice parse failed:", e);
        }

        return { ...item, product: null };
      }));

      res.json(matchedItems);
    } catch (e) {
      console.error("Voice parsing error:", e);
      res.status(500).json({ error: "Failed to parse voice input" });
    }
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

  // Global error handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("Global Error Handler:", err);
    res.status(500).json({
      error: "Internal Server Error",
      message: err.message,
      stack: process.env.NODE_ENV === "production" ? undefined : err.stack
    });
  });
}

startServer().catch(console.error);
