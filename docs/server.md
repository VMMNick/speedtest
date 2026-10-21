# Власний сервер і деплой

[← README](../README.md) · [Вимірювання](measurement.md) · [Архітектура](architecture.md) · [Сервер і деплой](server.md) · [Розробка](development.md)

Крім Cloudflare, застосунок може міряти швидкість **до власного сервера** — напр. у локальній мережі (перевірка Wi-Fi/роутера без інтернету) або на своєму VPS — і збирати анонімну статистику.

```bash
docker compose up -d --build   # http://localhost:8080
```

| Сервіс  | Образ                     | Роль                                                                   |
| ------- | ------------------------- | ---------------------------------------------------------------------- |
| `app`   | збирається з `Dockerfile` | фронтенд (збірка `selfhosted`) + API на Fastify, non-root, healthcheck |
| `db`    | `postgres:18-alpine`      | анонімні результати (volume `pgdata18`)                                |
| `redis` | `redis:7-alpine`          | спільні лічильники rate limit для кількох інстансів                    |

**API** (`server/`):

| Метод | Шлях                                          | Опис                                                                                   |
| ----- | --------------------------------------------- | -------------------------------------------------------------------------------------- |
| GET   | `/api/ping`                                   | порожня відповідь + `Server-Timing: app;dur=…`                                         |
| GET   | `/api/download?bytes=N`                       | N нестискуваних байтів потоком (без буферизації)                                       |
| POST  | `/api/upload`                                 | тіло рахується потоком і відкидається; ліміт → 413                                     |
| GET   | `/api/meta`                                   | IP клієнта у форматі Cloudflare `/meta`                                                |
| POST  | `/api/results`                                | зберегти результат; JSON Schema, **зайві поля → 400** (напр. IP), CHECK-обмеження в БД |
| GET   | `/api/results/stats?days=30`                  | кількість, середні швидкості, медіанний пінг                                           |
| GET   | `/api/health`                                 | стан БД і Redis (503, якщо щось недоступне)                                            |
| GET   | `/api/analytics/providers?days=&city=`        | рейтинг провайдерів: медіана й P90 download, медіани upload і пінгу                    |
| GET   | `/api/analytics/cities?days=`                 | міста для фільтра                                                                      |
| GET   | `/api/analytics/heatmap?days=&tz=&isp=&city=` | медіана download за днем тижня × годиною в часовому поясі клієнта                      |

- **Приватність:** IP-адреси не зберігаються (лише для rate limit у Redis з TTL 1 хв). Надсилання статистики можна вимкнути галочкою внизу сторінки.
- **Rate limit** на кожен маршрут (`RATE_SPEED_PER_MIN`, `RATE_RESULTS_PER_MIN`); при недоступному Redis вимірювання не ламаються.
- **Аналітика** (`/analytics.html`, лише в self-hosted збірці): рейтинг провайдерів із фільтром за містом і теплова карта «коли інтернет найшвидший» (7 днів × 24 години, послідовна шкала одного відтінку, окремі кроки для темної теми, текстовий висновок для скрінрідерів). Без Chart.js — таблиця з барами (медіана + риска P90) і CSS-сітка.
- **Демо-режим аналітики:** поки справжніх тестів менше 30 (`DEMO_THRESHOLD` у `src/core/demoData.js`), сторінка показує вигаданий, детермінований приклад у тій самій формі, що й API, з помітним банером «Демо» і кнопкою «Показати справжні». Збірка для GitHub Pages веде кнопкою аналітики на сервер (`VITE_ANALYTICS_URL` у `.env.production`).
- **k-анонімність:** провайдери й міста з менш ніж 3 тестами не показуються.
- **Кеш агрегацій у Redis** на 60 с (заголовок `X-Cache: HIT|MISS`); новий результат збільшує версію даних, тож свіжі тести видно одразу.
- **Часові пояси:** браузери досі віддають застарілі назви (Chrome — `Europe/Kiev`), а PostgreSQL із сучасною tzdata знає лише `Europe/Kyiv` — сервер узгоджує назви (`server/src/timezones.js`).
- SQL-агрегації звіряються в інтеграційних тестах з еталонною реалізацією в пам'яті (однакові результати для всіх фільтрів і часових поясів).
- **Міграції** (`server/migrations/*.sql`) застосовуються при старті під `pg_advisory_lock` — безпечно для кількох інстансів.
- **Кешування статики:** файли з хешем — `immutable` на рік, HTML і `sw.js` — `no-cache`. Безпечні заголовки — `@fastify/helmet`.
- Фронтенд вмикає власний сервер на етапі збірки (`.env.selfhosted` → `npm run build:self`); `ServerSelector` обирає найшвидший сервер за пінгом. На GitHub Pages лишається тільки Cloudflare.

### Деплой на Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/VMMNick/speedtest)

`render.yaml` (Blueprint) створює веб-сервіс із `Dockerfile`, PostgreSQL і Key Value (Redis) у Франкфурті та з'єднує їх через приватну мережу. Деплой — автоматично після зеленого CI (`autoDeployTrigger: checksPass`).

- **Хмарна збірка** (`BUILD_MODE=cloud`, `.env.cloud`): вимірювання йдуть через Cloudflare, а сервер **не роздає** download/upload (`SPEED_ENDPOINTS=false`) — інакше кожен тест з'їдав би сотні МБ безкоштовного трафіку. Сервер зберігає статистику й показує аналітику.
- **Безкоштовні тарифи:** сервіс засинає після 15 хв простою (перше відкриття ~1 хв), безкоштовна PostgreSQL живе 30 днів, Key Value не зберігається на диск. Для постійної роботи — платні плани в `render.yaml`.
- **Якщо сервіс створено вручну** (не з `render.yaml`): сервер сам бачить `RENDER=true` і за замовчуванням довіряє проксі (`TRUST_PROXY`) та вимикає ендпоінти вимірювань (`SPEED_ENDPOINTS`) — фронтенд тоді автоматично міряє через Cloudflare. Без `REDIS_URL` rate limit і кеш працюють у пам'яті процесу.
- **PostgreSQL 18** — та сама версія в Neon, CI, `docker-compose` і `render.yaml`. Старий локальний том `pgdata` (PostgreSQL 17) новий образ не читає: дані з нього переносяться через `pg_dump`/`pg_restore`, або том просто видаляється (`docker volume rm speedtest_pgdata`).
- **Постійна база — Neon** (безкоштовна PostgreSQL без терміну дії): у веб-сервісі достатньо замінити `DATABASE_URL` на рядок підключення Neon (`…-pooler…/neondb?sslmode=verify-full`); таблиці створяться міграціями при старті.
- **Redis на Upstash** (безкоштовний тариф із місячним лімітом команд): без нього rate limit і кеш аналітики живуть у пам'яті процесу Render і скидаються після кожного «засинання». Створіть базу в регіоні Frankfurt (поруч із сервісом), скопіюйте рядок підключення `rediss://…` (TLS) і задайте його як `REDIS_URL` у Render → Environment. `ioredis` вмикає TLS за схемою `rediss://` сам; перевірка — `/api/health` має показати `"redis":"ok"`.
- **Щоденний бекап** (`.github/workflows/backup.yml`): `pg_dump` (клієнт PostgreSQL 18 — не старший за сервер) у форматі custom зберігається як артефакт Actions на 30 днів; запуск і вручну (Actions → DB backup → Run workflow). Потрібен секрет `DATABASE_BACKUP_URL` — **прямий** рядок Neon (без `-pooler`). Відновлення: `pg_restore --no-owner --clean --if-exists -d "$DATABASE_URL" speedtest-….dump`.
- Хмарна збірка перевіряється в CI окремим E2E (`npm run test:e2e:cloud`) і збіркою Docker-образу з `BUILD_MODE=cloud`.

Без Docker:

```bash
npm ci --prefix server
npm run build:self
STATIC_DIR=dist DATABASE_URL=postgres://… REDIS_URL=redis://… npm run server   # обидва URL опційні
```

Змінні оточення — у `server/src/config.js`, приклад — `.env.example`.

**Тести сервера:** `npm run test:server` (Vitest + `fastify.inject`; з `TEST_DATABASE_URL`/`TEST_REDIS_URL` — ще й інтеграційні: ідемпотентні й паралельні міграції, CHECK-обмеження, спільний rate limit для двох інстансів). `npm run test:e2e:server` — Playwright проти зібраного фронтенду, який роздає Fastify. У CI обидва йдуть із сервісами PostgreSQL і Redis, а окремий джоб збирає Docker-образ і перевіряє `docker compose up` смоук-тестом.
