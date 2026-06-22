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

## Деплой (Render) — единственный источник правды

Прод (`app.nutria.one`) хостится на **Render**, сервис `NUTRIA_FOOD1` (`srv-d8qfk7i8qa3s73c7nen0`).
Render настроен на **Auto-Deploy при пуше в ветку `main`** — других механизмов деплоя в проекте нет.

**Правило для любой разработки (в т.ч. через Claude Code):**
1. Все рабочие коммиты — в свою feature-ветку (`claude/...` или иную), **никогда напрямую в `main`**.
2. Когда изменения проверены и готовы к продакшену — слить ветку в `main` (fast-forward или PR) и запушить.
3. Пуш в `main` = немедленный автодеплой на Render. Прогресс смотреть в Render Dashboard → `Events` (там видно `Deploy started` → `Deploy live` для конкретного коммита).
4. Если коммиты лежат только в feature-ветке и не слиты в `main` — на проде ничего не изменится, как бы много коммитов ни было.

Render-настройки сервиса (Build/Start command, переменные окружения) задаются в самой панели Render, а не файлами в репозитории — `railway.json`/`nixpacks.toml` (Railway-specific) удалены, т.к. Render их не читает.

Build command: `npm install && npm run build`
Start command: `npm start` (= `node scripts/start-server.mjs`)

Обязательные переменные окружения в Render → `Environment`:
- `NODE_ENV=production`
- `DATABASE_URL=...` (Postgres-инстанс)
- `GEMINI_API_KEY=...`
- `USDA_FDC_API_KEY=...` (опционально, для поиска по USDA)
- `BARCODE_PREFERRED_COUNTRY=ru`
- `BARCODE_PREFERRED_LANG=ru`

Сервер автоматически подхватывает `PORT` из окружения хостинга.

`scripts/start-server.mjs` выполняется через `npm start` при каждом старте процесса:
- пытается взять `DATABASE_URL` (или fallback `DATABASE_PRIVATE_URL` / `POSTGRES_URL` / `PG*` переменные),
- если URL найден — выполняет `prisma db push`,
- если URL пустой — пропускает `db push` и запускает сервер с предупреждением в логах.

## База данных (PostgreSQL)

Prisma уже настроена на PostgreSQL через `DATABASE_URL`.

Полезные команды:
- `npm run db:push` — применить текущую схему к базе
- `npm run db:migrate` — применить миграции в проде
- `npm run db:seed` — заполнить базу стартовыми продуктами

На Render: создайте/подключите Postgres-инстанс, скопируйте его `DATABASE_URL` в `Environment` веб-сервиса, затем запушите в `main`, чтобы запустить деплой.

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

## Фото еды

В приложении теперь есть два режима:
- `Фото состав` — распознаёт отдельные продукты и компоненты блюда.
- `Фото блюда` — отдельно оценивает всю порцию целиком и её суммарные калории/БЖУ.

Если AI ошибся, пользователь может нажать `Исправить`, выбрать правильный продукт через поиск, и эта правка будет использоваться в следующих совпадениях.

Важно для persistence коррекций:
- если используется PostgreSQL, после обновления схемы выполните `npm run db:push`, чтобы создать таблицу `RecognitionCorrection`;
- если база не подключена или схема ещё не применена, коррекции всё равно работают, но только в памяти текущего процесса.
