# NUTRIA FOOD

Полноценное приложение (React + Express + Prisma), где фронтенд и API работают в одном Node-процессе через `server.ts`.

## Локальный запуск

Требования:
- Node.js 20+

Шаги:
1. Установить зависимости:
   `npm install`
2. Создать `.env` (или задать переменные в системе) и указать минимум:
   - `GEMINI_API_KEY=...`
   - `USDA_FDC_API_KEY=...` (опционально)
   - `BARCODE_PREFERRED_COUNTRY=ru` (опционально, по умолчанию `ru`)
   - `BARCODE_PREFERRED_LANG=ru` (опционально, по умолчанию `ru`)
   - `OPENAI_VISION_MODEL=gpt-4o-mini` (опционально; можно поставить более сильную vision-модель для фото)
3. Запустить проект:
   `npm run dev`

## Деплой на Railway

В проекте уже есть `railway.json`, поэтому достаточно подключить репозиторий и задать переменные окружения.
Также добавлен `nixpacks.toml`, который фиксирует Node.js 20 для сборки Railway.

1. Создайте новый проект в Railway и подключите этот репозиторий.
2. В `Variables` добавьте:
   - `NODE_ENV=production`
   - `DATABASE_URL=...` (из Railway PostgreSQL)
   - `GEMINI_API_KEY=...`
   - `USDA_FDC_API_KEY=...` (если нужен поиск по USDA)
   - `BARCODE_PREFERRED_COUNTRY=ru`
   - `BARCODE_PREFERRED_LANG=ru`
3. Railway автоматически выполнит:
   - `npm install`
   - `npm run build`
   - `node scripts/start-railway.mjs` (из `railway.json`)
4. Сервер автоматически подхватывает `PORT` из окружения хостинга.

Скрипт `scripts/start-railway.mjs` делает запуск автоматическим:
- пытается взять `DATABASE_URL` (или fallback `DATABASE_PRIVATE_URL` / `POSTGRES_URL` / `PG*` переменные),
- если URL найден — выполняет `prisma db push`,
- если URL пустой — пропускает `db push` и запускает сервер с предупреждением в логах.

## База данных (PostgreSQL)

Prisma уже настроена на PostgreSQL через `DATABASE_URL`.

Полезные команды:
- `npm run db:push` — применить текущую схему к базе
- `npm run db:migrate` — применить миграции в проде
- `npm run db:seed` — заполнить базу стартовыми продуктами

Для Railway: добавьте сервис PostgreSQL, скопируйте его `DATABASE_URL` в Variables вашего web-сервиса, затем выполните деплой.

## QR / штрихкод (быстро и качественно)

Сервер использует каскад поиска по коду:
1. Кэш в памяти (мгновенный повторный ответ)
2. Локальная БД (Prisma/PostgreSQL)
3. OpenFoodFacts с приоритетом RU (`ru.openfoodfacts.org` → `world.openfoodfacts.org`)

Если продукт найден в OpenFoodFacts и база подключена, он автоматически сохраняется в локальную БД — последующие сканы работают быстрее.

Дополнительные параметры:
- `BARCODE_LOOKUP_TIMEOUT_MS=3500` — timeout запроса к OpenFoodFacts
- `BARCODE_CACHE_TTL_MS=21600000` — TTL кэша в ms (по умолчанию 6 часов)

Для фото-распознавания уже используется AI fallback-цепочка на сервере (OpenAI Vision → Gemini для image), что покрывает случаи, когда точных совпадений в базе нет.
