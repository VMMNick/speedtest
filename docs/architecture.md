# Архітектура

[← README](../README.md) · [Вимірювання](measurement.md) · [Архітектура](architecture.md) · [Сервер і деплой](server.md) · [Розробка](development.md)

Монорепозиторій на **npm workspaces**: один `package-lock.json`, один `npm install` у корені ставить фронтенд, сервер і спільний пакет; `@speedtest/shared` підключається як звичайна залежність, а не відносним шляхом.

```
speedtest/
├── apps/
│   ├── web/                      @speedtest/web — фронтенд (Vite)
│   │   ├── src/
│   │   │   ├── index.html · app.js           головна; app.js — composition root
│   │   │   ├── analytics.html · analytics.js аналітика (лише в збірках із бекендом)
│   │   │   ├── privacy.html · privacy.js     конфіденційність
│   │   │   ├── core/          чиста логіка без DOM: config, NetworkEngine, MetricsCalculator,
│   │   │   │                  gauge, heatmap, insights, share, demoData, types
│   │   │   ├── services/      введення-виведення: StorageManager, ServerSelector, ResultsApi, sound, pwa
│   │   │   ├── ui/            DOM: UIController, HistoryPanel, SharePanel, ChartManager, lazyCharts,
│   │   │   │                  ShareCard, ThemeManager, format, dom
│   │   │   ├── i18n/          uk (у стартовому бандлі) і en (окремий чанк)
│   │   │   ├── workers/       speed.worker.js — NetworkEngine у Web Worker
│   │   │   └── styles/
│   │   ├── public/            статика: іконки, manifest, robots.txt
│   │   ├── config/            Vite-плагіни (CSP, service worker)
│   │   ├── tests/unit/        Vitest: рушій, метрики, сховище, i18n, CSP, демо-дані…
│   │   ├── vite.config.js · jsconfig.json · .env.cloud · .env.selfhosted · .env.production
│   │   └── package.json
│   └── server/                   @speedtest/server — Fastify API
│       ├── src/               app · config · db · cache · tokens · timezones · openapi
│       │                      status (правила стану) · status-store (SQL і пам'ять) · jobs (BullMQ) · worker
│       │                      routes/{speed,results,analytics,status}
│       ├── migrations/        SQL-міграції (застосовуються при старті)
│       ├── tests/             юніт, інтеграційні (PostgreSQL/Redis), токени, контрактний тест
│       └── package.json
├── packages/
│   └── shared/                   @speedtest/shared — контракт клієнт ↔ сервер (JSON Schema, межі, заголовок токена)
├── e2e/                          Playwright: web/ · server/ · cloud/ · live/ + конфіг на кожен режим
├── docs/                         документація й медіа для README
├── scripts/                      бюджет розміру, скріншоти, схема архітектури, іконки
├── .github/workflows/            ci.yml · backup.yml · visual-baselines.yml
├── Dockerfile · docker-compose.yml · render.yaml
└── package.json                  workspaces + скрипти для всього репозиторію
```

### Правила залежностей

```
app.js / analytics.js ──► ui ──► services ──► core
                            └──────────────► core
services/ResultsApi ──► @speedtest/shared ◄── apps/server
```

- **core** не знає про DOM, i18n, UI і сервіси — тому рушій працює у воркері й повністю покритий тестами в Node.
- **services** не імпортують **ui**; тексти інтерфейсу живуть лише в **i18n** (тест шукає кирилицю в коді ui/ і services/).
- **@speedtest/shared** не має залежностей; сервер і фронтенд не імпортують одне одного — лише через HTTP і спільний пакет.
- Правила перевіряє ESLint (`no-restricted-imports`, `no-restricted-globals`), тож порушення ламає CI.
- Контрактний тест (`server/tests/contract.test.js`) проганяє тіло з `toPayload()` через справжню валідацію сервера, зокрема крайні значення.

### Протокол воркера

```
main → worker   { type: 'start', server, config? }  |  { type: 'abort' }
worker → main   phase · progress · result · done · aborted · error
```

`NetworkEngine` не залежить від DOM — `fetch`, upload і таймер інжектуються через конструктор, тому рушій повністю покритий юніт-тестами в Node.
