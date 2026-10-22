# Розробка

[← README](../README.md) · [Вимірювання](measurement.md) · [Архітектура](architecture.md) · [Сервер і деплой](server.md) · [Розробка](development.md)

## Якість коду

| Команда                           | Що робить                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `npm run lint` / `lint:fix`       | ESLint (flat config, `eslint.config.js`)                                                                |
| `npm run format` / `format:check` | Prettier (`.prettierrc.json`)                                                                           |
| `npm run typecheck`               | TypeScript перевіряє JS за JSDoc-типами (`apps/web/jsconfig.json`, типи — `apps/web/src/core/types.js`) |
| `npm run check`                   | усе разом + тести — запускати перед комітом                                                             |
| `npm run size`                    | бюджет розміру бандла (gzip) після `npm run build`                                                      |

## Продуктивність

| Що                      | Розмір (gzip) | Бюджет |
| ----------------------- | ------------- | ------ |
| Стартовий JS            | ~18 KB        | 20 KB  |
| Стартовий CSS           | ~5 KB         | 12 KB  |
| Chart.js (лінивий чанк) | ~58 KB        | 70 KB  |
| Воркер                  | ~4 KB         | 10 KB  |

- **Chart.js вантажиться ліниво** — окремим чанком лише при наведенні/фокусі на «Старт» чи «Історію» або на першу вимогу. До цього стартовий JS займав ~68 KB.
- **Словники мов:** українська (основна) — у стартовому бандлі, англійська — окремим чанком через `loadLang()`. Модулі, спільні для сторінок (i18n, налаштування, тема), зібрані в один чанк `shared` (`manualChunks` у `vite.config.js`), щоб не дробитися на дрібні файли.
- **Шрифти локально** (`@fontsource-variable/inter`, `jetbrains-mono`) — без запитів до Google; через `unicode-range` браузер вантажить лише латиницю/кирилицю. Шрифти не вбудовуються як `data:` (сумісність із CSP).
- Ряд швидкості для графіка рахується за один прохід (O(n)), payload для upload кешується між тестами.
- `npm run size` перевіряє бюджет у CI — випадковий статичний імпорт Chart.js зламає збірку.
- Lighthouse (локально, мобільний профіль): **Performance 98 · Accessibility 100 · SEO 100**, CLS 0, TBT 0 мс.

## E2E-тести (Playwright)

```bash
npx playwright install chromium   # один раз — завантажити браузер
npm run test:e2e                  # збирає проєкт, піднімає preview і проганяє тести
npm run test:e2e:ui               # інтерактивний режим
npm run test:e2e:report           # HTML-звіт останнього прогону
```

- Cloudflare у тестах **підмінений** (`e2e/web/fixtures.js`): детерміновані відповіді, керовані затримка, швидкість, недоступність і HTTP-помилки.
- Фази скорочені до ~1 с через тестовий гачок `window.__SPEEDTEST_CONFIG__` (у звичайній роботі не заданий).
- Сценарії: англійська за мовою браузера та перемикач мови, PWA (маніфест, офлайн-запуск через SW), поділитися (посилання, PNG, пошкоджене посилання), CSP без порушень, лінивий Chart.js (не вантажиться на старті, графік малюється), повний тест, повторний запуск, зупинка, клавіатура, недоступний сервер, HTTP 429, історія (збереження після перезавантаження, видалення, експорт CSV, очищення), теми без блимання, адаптивність (desktop + Pixel 7), доступність (axe WCAG 2.1 AA у світлій і темній темі, озвучення фаз).

## Візуальні регресійні тести

- `e2e/visual/screens.spec.js`: головна до тесту, результат, сторінка конфіденційності, англійська версія й стан «сервер недоступний», у світлій і темній темах, на десктопі й Pixel 7. Разом 12 знімків.
- Дані детерміновані: Cloudflare підмінений, результат відкривається з посилання `#r=…` з фіксованими цифрами, часовий пояс `Europe/Kyiv`, анімації вимкнені, змінний пінг у панелі сервера замаскований.
- Еталони лежать у `e2e/visual/__screenshots__/<desktop|mobile>/`. Шрифти рендеряться по-різному на різних ОС, тому еталоном вважається лише Linux у CI: `npm run test:visual` на Windows чи macOS може показати різницю, і це нормально.
- Після навмисних змін дизайну: **Actions → Visual baselines → Run workflow**. Workflow перезнімає еталони в тому ж середовищі, що й CI, і комітить їх. Якщо порівняння впало, артефакт `visual-report` показує еталон, фактичний знімок і різницю поруч.

## CI

GitHub Actions (`.github/workflows/ci.yml`) на кожен push у `main`, pull request і вручну:

1. **quality** (Node 22 і 24): `npm ci` → ESLint → Prettier → typecheck → Vitest → build (артефакт `apps/web/dist`)
2. **e2e** (після quality): Playwright Chromium з кешем браузера → звіт `playwright-report` (артефакт), трейси при падінні
3. **visual** (після quality): порівняння скріншотів з еталонами (див. вище)
4. **lighthouse** (після quality): Lighthouse CI на тій самій збірці — головна сторінка й сторінка конфіденційності, мобільний профіль, медіана з 3 прогонів. Пороги в `lighthouserc.json`: performance ≥ 90, accessibility = 100, best practices ≥ 95, SEO ≥ 90, LCP ≤ 2,5 с, CLS ≤ 0,05, TBT ≤ 200 мс, JS ≤ 40 KB. HTML-звіти — артефакт `lighthouse-report`. Локально: `npm run build && npm run lighthouse` (потрібен Chrome; інший браузер — через `CHROME_PATH`)
5. **server** — тести сервера з PostgreSQL і Redis + E2E проти self-hosted збірки
6. **docker** — збірка образу, `docker compose up --wait`, смоук-тест API
7. **deploy** (лише `main`, після всього вище): збірка з `BASE_PATH=/<repo>/` → GitHub Pages
8. **live** (після deploy): Playwright проти задеплоєного сайту і **справжнього** Cloudflare — CORS, base path, CSP, повний тест

Dependabot щотижня оновлює npm-залежності (dev-інструменти одним PR) і щомісяця — версії GitHub Actions.

## Локалізація

- Словники: `apps/web/src/i18n/uk.js` (основна і запасна мова) та `apps/web/src/i18n/en.js`; власний модуль `apps/web/src/i18n/index.js` (~60 рядків, без залежностей).
- Статична розмітка: `data-i18n="key"` (текст) і `data-i18n-attr="title:key;aria-label:key"` (атрибути). Динамічний текст — через `t('key', { param })`.
- Помилки рушія мають машинні коди (`UNREACHABLE`, `TRANSFER_FAILED`) — інтерфейс перекладає їх за кодом.
- Тести стежать за цілісністю: однакові ключі й плейсхолдери в усіх мовах, жодної кирилиці в англійському словнику і **жодного жорстко прописаного українського тексту в UI-коді** (усе має йти через `t()`).
- Англійська назва — «Speedcheck» («Speedtest» — торгова марка Ookla).
- Щоб додати мову: новий файл у `apps/web/src/i18n/`, рядок у `DICTIONARIES`/`LOCALES` і правило в `detectLang`.

## PWA

- `apps/web/public/manifest.webmanifest` + іконки в `apps/web/public/icons/` (згенеровані `scripts/generate-icons.py`, є maskable).
- Service worker генерується під час збірки плагіном `apps/web/config/vite-plugin-sw.js` із шаблону `apps/web/config/sw-template.js`: список precache — з файлів збірки, версія кешу — хеш цього списку.
- Стратегії: HTML — network-first з офлайн-фолбеком; власна статика — cache-first; **запити до Cloudflare не перехоплюються і не кешуються** — вимірювання завжди йдуть у мережу.
- Нова версія не підміняє сторінку посеред тесту: користувач бачить тост «Доступна нова версія → Оновити».
- У dev-режимі SW не реєструється (не заважає HMR).

## Деплой і безпека

- **GitHub Pages** через Actions. Один раз: _Settings → Pages → Build and deployment → Source: **GitHub Actions**_.
- **Base path** задається змінною `BASE_PATH` (за замовчуванням `/`), тож ту саму збірку можна викласти будь-куди.
- **Content-Security-Policy** додається в продакшн-збірку як `<meta>` плагіном `apps/web/config/vite-plugin-csp.js` (Pages не дозволяє власні HTTP-заголовки). `default-src 'none'`, без `unsafe-inline`/`unsafe-eval`; хеш inline-скрипта теми рахується автоматично. Мережа дозволена лише до `self` і `speed.cloudflare.com`. Відсутність порушень перевіряють E2E- і live-тести.
- Живий smoke-тест вручну: `LIVE_URL=https://vmmnick.github.io/speedtest/ npm run test:live`.

Рекомендовані розширення VS Code — у `.vscode/extensions.json`.

## Скріншоти й GIF для README

```bash
npm run media   # → docs/media/*.png, demo.gif
```

`scripts/capture-media.js` збирає self-hosted фронтенд, піднімає Fastify з вигаданими даними в пам'яті та локальний HTTPS/HTTP2-сервер замість Cloudflare (Chromium резолвить `speed.cloudflare.com` на `127.0.0.1` через `--host-resolver-rules`). Швидкість «мережі» обмежена на сервері (~350/95 Мбіт/с), тож графіки, пінг під навантаженням і оцінки виглядають як у реальному тесті. Потрібні `ffmpeg` і `openssl`; GIF — двопрохідна палітра, 12 к/с, 900 px.

Схема архітектури в README — не Mermaid (GitHub розкладає її з перехрещеннями), а SVG у двох темах: `node scripts/architecture-svg.js` → `docs/media/architecture-{light,dark}.svg`; README підставляє потрібну через `<picture>`.
