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
3. Railway автоматически выполнит:
   - `npm install`
   - `npm run build`
   - `npm run db:push && npm start` (из `railway.json`)
4. Сервер автоматически подхватывает `PORT` из окружения хостинга.

## База данных (PostgreSQL)

Prisma уже настроена на PostgreSQL через `DATABASE_URL`.

Полезные команды:
- `npm run db:push` — применить текущую схему к базе
- `npm run db:migrate` — применить миграции в проде
- `npm run db:seed` — заполнить базу стартовыми продуктами

Для Railway: добавьте сервис PostgreSQL, скопируйте его `DATABASE_URL` в Variables вашего web-сервиса, затем выполните деплой.
