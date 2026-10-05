# Спідтест — Internet Speed Test

[![CI](https://github.com/VMMNick/speedtest/actions/workflows/ci.yml/badge.svg)](https://github.com/VMMNick/speedtest/actions/workflows/ci.yml)

Браузерний тест швидкості інтернету на чистому JavaScript: **пінг, джиттер, втрати, download, upload, пінг під навантаженням (bufferbloat)** та інтегральна оцінка стабільності з'єднання. Усі вимірювання виконуються у **Web Worker**, тож інтерфейс не фризить навіть на гігабітних каналах.

## Можливості

- Анімований датчик із нелінійною шкалою (0–1000 Мбіт/с) і графік швидкості в реальному часі (Chart.js)
- Паралельні потоки з адаптивним розміром чанка (росте, доки запит не триватиме ~1 с)
- Відкидання TCP slow start (перші 1.5 с) у фінальному результаті
- Пінг під навантаженням → оцінка bufferbloat (A–F)
- Оцінка стабільності 0–100 + придатність для ігор, відеодзвінків, 4K-стрімінгу
- Історія тестів в IndexedDB (фолбек — localStorage), графік історії, експорт у CSV
- Світла/темна тема (з урахуванням налаштувань ОС), звук завершення (Web Audio API)
- Адаптивна верстка, клавіатура (`Enter` — старт, `Esc` — стоп), `prefers-reduced-motion`

## Швидкий старт

```bash
npm install
npm run dev       # http://localhost:5173
npm test          # Vitest
npm run build     # збірка в dist/
npm run preview   # перегляд продакшн-збірки
```

Потрібен Node.js 22.12+ (Node 20 вже не підтримується Vitest 5 і досяг кінця життєвого циклу).

## Якість коду

| Команда                           | Що робить                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| `npm run lint` / `lint:fix`       | ESLint (flat config, `eslint.config.js`)                                              |
| `npm run format` / `format:check` | Prettier (`.prettierrc.json`)                                                         |
| `npm run typecheck`               | TypeScript перевіряє JS за JSDoc-типами (`jsconfig.json`, типи — `src/core/types.js`) |
| `npm run check`                   | усе разом + тести — запускати перед комітом                                           |

## E2E-тести (Playwright)

```bash
npx playwright install chromium   # один раз — завантажити браузер
npm run test:e2e                  # збирає проєкт, піднімає preview і проганяє тести
npm run test:e2e:ui               # інтерактивний режим
npm run test:e2e:report           # HTML-звіт останнього прогону
```

- Cloudflare у тестах **підмінений** (`tests/e2e/fixtures.js`): детерміновані відповіді, керовані затримка, швидкість, недоступність і HTTP-помилки.
- Фази скорочені до ~1 с через тестовий гачок `window.__SPEEDTEST_CONFIG__` (у звичайній роботі не заданий).
- Сценарії: повний тест, повторний запуск, зупинка, клавіатура, недоступний сервер, HTTP 429, історія (збереження після перезавантаження, видалення, експорт CSV, очищення), теми без блимання, адаптивність (desktop + Pixel 7), доступність (axe WCAG 2.1 AA у світлій і темній темі, озвучення фаз).

## CI

GitHub Actions (`.github/workflows/ci.yml`) на кожен push у `main`, pull request і вручну:

1. **quality** (Node 22 і 24): `npm ci` → ESLint → Prettier → typecheck → Vitest → build (артефакт `dist`)
2. **e2e** (після quality): Playwright Chromium з кешем браузера → звіт `playwright-report` (артефакт), трейси при падінні

Dependabot щотижня оновлює npm-залежності (dev-інструменти одним PR) і щомісяця — версії GitHub Actions.

Рекомендовані розширення VS Code — у `.vscode/extensions.json`.

## Як працює вимірювання

Трафік іде через публічний API [speed.cloudflare.com](https://speed.cloudflare.com) (anycast, найближча точка присутності обирається автоматично, CORS дозволений):

| Етап     | Ендпоінт              | Метод                                                                     |
| -------- | --------------------- | ------------------------------------------------------------------------- |
| Пінг     | `GET /__down?bytes=0` | 20 запитів, RTT із Resource Timing API (або wall-clock), перший — прогрів |
| Download | `GET /__down?bytes=N` | 4 потоки × 10 с, байти рахуються зі стриму `ReadableStream`               |
| Upload   | `POST /__up`          | 3 потоки × 10 с, `text/plain` (без CORS preflight), нестискуваний payload |
| Метадані | `GET /meta`           | IP, провайдер, місто, точка присутності                                   |

**Метрики** (`src/core/MetricsCalculator.js`):

- **Джиттер** — середня абсолютна різниця між послідовними RTT (RFC 3550)
- **Втрати** — частка пінг-запитів без відповіді за таймаут (у браузері немає UDP/ICMP, тож це HTTP-апроксимація)
- **Швидкість** — `(байти після розгону) / (час після розгону)`; «жива» швидкість — у ковзному вікні 1 с
- **Bufferbloat** — приріст медіанного пінгу під навантаженням відносно пінгу в спокої
- **Стабільність** — 100 мінус штрафи за джиттер, втрати, високий пінг, bufferbloat і нерівність швидкості

Щоб додати власний сервер — допишіть об'єкт у `SERVERS` (`src/core/config.js`) з тими ж полями; `ServerSelector` обере найшвидший за пінгом.

## Структура

```
public/                 статичні файли (favicon, SVG-іконки)
src/
  core/
    config.js           параметри тестів і сервери
    NetworkEngine.js    рушій: пінг, download, upload, latency під навантаженням
    MetricsCalculator.js чисті функції метрик
  services/
    StorageManager.js   історія (IndexedDB/localStorage) і налаштування
    ServerSelector.js   вибір сервера і метадані з'єднання
  ui/
    UIController.js     DOM: датчик, картки, модалка, тости
    ChartManager.js     графіки Chart.js
    ThemeManager.js     світла/темна тема
  workers/
    speed.worker.js     обгортка NetworkEngine у Web Worker
  styles/               variables / main / dashboard / history
  app.js                оркестрація модулів
  index.html
tests/                  Vitest (мок fetch / ReadableStream)
```

### Протокол воркера

```
main → worker   { type: 'start', server, config? }  |  { type: 'abort' }
worker → main   phase · progress · result · done · aborted · error
```

`NetworkEngine` не залежить від DOM — `fetch`, upload і таймер інжектуються через конструктор, тому рушій повністю покритий юніт-тестами в Node.

## Обмеження

- Браузерний тест зазвичай показує трохи менше за нативні застосунки (накладні витрати HTTP, обмеження браузера на кількість з'єднань).
- Cloudflare може обмежувати дуже часті тести (HTTP 429) — рушій зупиняє потік після 3 помилок поспіль і показує зрозуміле повідомлення.
