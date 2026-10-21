# Архітектура

[← README](../README.md) · [Вимірювання](measurement.md) · [Архітектура](architecture.md) · [Сервер і деплой](server.md) · [Розробка](development.md)

```
speedtest/
├── src/                      фронтенд (Vite root)
│   ├── index.html · app.js   головна сторінка; app.js — composition root: створює модулі й з'єднує їх
│   ├── analytics.html · analytics.js   сторінка аналітики (лише в збірках із бекендом)
│   ├── core/                 чиста логіка без DOM — працює у воркері й тестується в Node
│   │   ├── config.js         параметри тестів, сервери, режими збірки
│   │   ├── NetworkEngine.js  рушій: пінг, download, upload, latency під навантаженням
│   │   ├── MetricsCalculator.js  метрики: P90, джиттер, стабільність, bufferbloat
│   │   ├── gauge.js · heatmap.js · insights.js · share.js · types.js
│   ├── services/             введення-виведення
│   │   ├── StorageManager.js історія (IndexedDB → localStorage) і налаштування
│   │   ├── ServerSelector.js вибір сервера за пінгом і метадані з'єднання
│   │   ├── ResultsApi.js     анонімна статистика → POST /api/results
│   │   ├── sound.js · pwa.js звук завершення (Web Audio) і service worker
│   ├── ui/                   усе, що працює з DOM
│   │   ├── UIController.js   датчик, картки метрик, тости, модалка
│   │   ├── HistoryPanel.js · SharePanel.js   історія/CSV і «Поділитися»
│   │   ├── ChartManager.js · lazyCharts.js   графіки Chart.js (окремий чанк)
│   │   ├── ShareCard.js · ThemeManager.js · format.js · dom.js
│   ├── i18n/                 uk (за замовчуванням) і en
│   ├── workers/speed.worker.js   NetworkEngine у Web Worker
│   └── styles/
├── shared/
│   └── result-schema.js      контракт клієнт ↔ сервер (JSON Schema + межі полів)
├── server/                   Fastify API (окремий package.json — у Docker-образ іде лише він)
│   ├── src/  app.js · config.js · db.js · cache.js · routes/{speed,results,analytics}.js
│   ├── migrations/           SQL-міграції (застосовуються при старті)
│   └── tests/                юніт, інтеграційні (PostgreSQL/Redis) і контрактний тест
├── tests/
│   ├── unit/                 Vitest: рушій, метрики, сховище, i18n, CSP…
│   ├── e2e/                  Playwright з підмінним Cloudflare (GitHub Pages-збірка)
│   ├── e2e-server/ · e2e-cloud/   фронтенд + Fastify (selfhosted і cloud-режими)
│   └── live/                 смоук проти розгорнутого сайту і справжнього Cloudflare
├── config/                   Vite-плагіни (CSP, service worker)
├── scripts/                  бюджет розміру бандла, генерація іконок
├── public/                   статика: іконки, manifest, robots.txt
└── Dockerfile · docker-compose.yml · render.yaml · .github/workflows/{ci,backup}.yml
```

### Правила залежностей

```
app.js / analytics.js ──► ui ──► services ──► core
                            └──────────────► core
services/ResultsApi ──► shared ◄── server
```

- **core** не знає про DOM, i18n, UI і сервіси — тому рушій працює у воркері й повністю покритий тестами в Node.
- **services** не імпортують **ui**; тексти інтерфейсу живуть лише в **i18n** (тест шукає кирилицю в коді ui/ і services/).
- **shared** не має залежностей; сервер і фронтенд не імпортують одне одного — лише через HTTP і `shared/`.
- Правила перевіряє ESLint (`no-restricted-imports`, `no-restricted-globals`), тож порушення ламає CI.
- Контрактний тест (`server/tests/contract.test.js`) проганяє тіло з `toPayload()` через справжню валідацію сервера, зокрема крайні значення.

### Протокол воркера

```
main → worker   { type: 'start', server, config? }  |  { type: 'abort' }
worker → main   phase · progress · result · done · aborted · error
```

`NetworkEngine` не залежить від DOM — `fetch`, upload і таймер інжектуються через конструктор, тому рушій повністю покритий юніт-тестами в Node.
