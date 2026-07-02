---
name: nutria-project
description: Контекст проекта NUTRIA FOOD — карта архитектуры (server.ts, ClientApp.tsx, Prisma, AI-парсинг продуктов). Используй, когда нужно сориентироваться в проекте до того, как что-то менять, или когда пользователь явно просит "скилл nutria-project".
---

# NUTRIA FOOD — карта проекта

Полноценное приложение (React + Express + Prisma) для учёта питания и микроэлементов. Фронтенд и API работают в одном Node-процессе через `server.ts` (Express + Vite middleware в dev).

## Стек и запуск

- Node >=20 <23, TypeScript, Express, Vite, Prisma (PostgreSQL), React 19.
- `npm run dev` / `npm run start` — `tsx server.ts` (фронт и API вместе).
- `npm run lint` — `tsc --noEmit` (полный типчек, ~ok без сети).
- `npm run db:push` / `db:migrate` / `db:seed` — Prisma.
- AI-ключи через `.env`: `GEMINI_API_KEY` (основной), `DEEPSEEK_API_KEY`, `OPENAI_API_KEY` (фоллбэки), `USDA_FDC_API_KEY` (опционально).

## Деплой — единственный источник правды

- Прод (`app.nutria.one`) хостится на **Render**, сервис `NUTRIA_FOOD1` (`srv-d8qfk7i8qa3s73c7nen0`). Auto-Deploy срабатывает **только на пуш в `main`**. Других путей деплоя (GitHub Actions и т.п.) в проекте нет.
- Все правки делать в feature-ветке (например `claude/...`), **никогда коммитить прямо в `main`**.
- Прежде чем сливать feature-ветку в `main` и пушить туда (= триггерить прод-деплой), нужно явное подтверждение пользователя — это hard-to-reverse, видимое для всех действие.
- Если после нескольких коммитов в feature-ветке пользователь говорит "ничего не меняется на проде" — первым делом проверь, слита ли ветка в `main` (`git log main..<branch> --oneline`), а не ищи баг в коде.
- `scripts/start-server.mjs` (запускается через `npm start`) на старте процесса резолвит `DATABASE_URL` (или `PG*`/`POSTGRES_*` переменные), при наличии — гонит `prisma db push`, затем стартует `server.ts`. Build/Start command настроены в самой панели Render, не файлами в репо.

## Где что лежит

- `server.ts` — весь backend: все `/api/*` роуты, Prisma-клиент, AI-обёртки. Один большой файл (~3000 строк), ищи по `app.get`/`app.post`.
- `src/ClientApp.tsx` — основной клиентский экран (дневник питания, голосовой ввод, фото, поиск продуктов). Огромный компонент, ищи по названию состояния/текста UI.
- `src/CrmApp.tsx`, `crm-routes.ts` — CRM для нутрициологов (отдельная роль).
- `src/LoginPage.tsx`, `src/ClientOnboard.tsx` — авторизация и онбординг.
- `telegram-bot.ts` — интеграция с Telegram.
- `prisma/schema.prisma` — модели: `User`, `Product`, `Meal`, `MealItem`, `Recipe`, `RecognitionCorrection`, `NutrientGoal` и CRM-модели (`NutritionistProfile`, `ClientProfile`, `ClientNote`, ...).
- `prisma/seed.ts`, `backfill-micronutrients.ts`, `import-usda.ts`, `localize-ru.ts` — служебные скрипты заполнения и нормализации базы продуктов.

## Ключевые механизмы в server.ts

- `generateAI(prompt, responseMimeType, image?)` — единая обёртка над AI-провайдерами с фоллбэк-цепочкой: Gemini → DeepSeek → OpenAI (для изображений: OpenAI Vision → Gemini). **Важно**: при `responseMimeType: "application/json"` провайдеры с `response_format: json_object` (OpenAI/DeepSeek) возвращают только top-level JSON **объект**, не массив — поэтому все промпты, ожидающие список, должны просить `{"items": [...]}` и код должен это разворачивать (см. `parseAiJsonPayload` + ручной unwrap), а не просить голый массив.
- `parseAiJsonPayload(text)` — устойчивый парсер ответа AI (снимает ```json-заборы, пытается вырезать `{...}`/`[...]` при невалидном JSON).
- `searchProductsEngine(query, options)` — основной движок поиска продукта: локальная Prisma-БД (fuzzy contains) + USDA FDC API + AI-нормализация запроса + AI-оценка нутриентов как фоллбэк + AI-реранк кандидатов. Поддерживает `options.fast` — режим без AI-нормализации/USDA/реранка (только локальный матчинг + один AI-фоллбэк), используется там, где входное имя уже каноничное (например, после декомпозиции голосовой фразы) и важна низкая латентность.
- `withTimeout(promise, ms, label)` — оборачивает AI/сетевые вызовы таймаутом, чтобы повисший провайдер не блокировал весь запрос.
- Микроэлементы (`MICRONUTRIENT_TEMPLATE`, `buildCompleteMicronutrients`) — полная структура: 15 витаминов, 19 минералов, 20 аминокислот, 5 жирных кислот, 8 типов углеводов. Хранятся в `Product.micronutrients` как JSON-строка.
- Докомплектация микроэлементов (`enrichProductMicronutrientsInBackground`) — при показе дневника продукт с хотя бы одной пустой группой добирается в фоне: сначала точные данные из USDA FDC (`fetchUsdaMicronutrientsByName`; перевод названия на английский через AI; приоритет Foundation/SR Legacy с аминокислотным профилем), затем AI-оценка только для оставшихся пустых групп; уже заполненные группы никогда не перезаписываются. Пакетный прогон по базе: `runMicronutrientBackfill` — env `MICRONUTRIENT_BACKFILL_ON_BOOT=<limit>` (разовый прогон при старте) или `POST /api/admin/backfill-micronutrients?limit=N` с заголовком `x-admin-token: $ADMIN_TOKEN`. Скрипт `prisma/backfill-micronutrients.ts` — только нормализация структуры JSON, реальных данных он не добавляет.
- `/api/voice/parse` — голосовой дневник: один AI-вызов декомпозирует фразу на ингредиенты с граммовками (составные блюда разбиваются на компоненты), затем каждый ингредиент матчится независимо через `searchProductsEngine(..., { fast: true })` с собственным `try/catch` — ошибка одного ингредиента не валит весь запрос.
- Фото-распознавание (`recognitionPrompt` около `findBestPhotoRecognitionMatch`) — два режима: `ingredients` (раздельные компоненты блюда) и `whole_dish` (оценка порции целиком).

## Принципы при правках

- Не дублировать логику матчинга/AI-промптов — переиспользовать `searchProductsEngine` и `generateAI`/`parseAiJsonPayload`, а не писать параллельные ad-hoc реализации (так уже было сломано в `/api/voice/parse` — раздельный код потерялся в синхронизации с основным движком).
- Любой новый промпт, ожидающий список, должен возвращать `{"items": [...]}` (или аналогичный объект-обёртку), а не голый массив — иначе он сломается на OpenAI/DeepSeek-фоллбэке.
- Любой новый AI/внешний сетевой вызов в горячем пути пользовательского запроса должен быть обёрнут в `withTimeout` и `try/catch`, чтобы не блокировать или валить весь ответ при сбое одного провайдера/источника.
- После правок в `server.ts` — обязательно `npx tsc --noEmit` (если `node_modules` не установлен, сначала `npm install`).
- Не плодить новые абстракции в духе этого файла-монолита без необходимости — следуй существующему стилю (один файл на роуты), если пользователь явно не просит рефакторинг на модули.
