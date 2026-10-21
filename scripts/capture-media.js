/* global window, indexedDB -- функції, що виконуються в браузері (addInitScript) */
/**
 * Знімки екрана й GIF-демо для README (docs/media/).
 *
 *   npm run media
 *
 * Збирає self-hosted фронтенд, піднімає Fastify з демо-даними в пам'яті, підміняє
 * Cloudflare локальним HTTPS-сервером з обмеженою швидкістю (~350/95 Мбіт/с) і знімає сторінки в Chromium.
 * Потрібні ffmpeg і openssl.
 * Реальна мережа не потрібна; дані провайдерів — вигадані.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createSecureServer } from 'node:http2';
import { join } from 'node:path';
import { chromium, devices } from '@playwright/test';
import { buildApp } from '../apps/server/src/app.js';
import { loadConfig } from '../apps/server/src/config.js';
import { memoryRepository } from '../apps/server/src/db.js';

const OUT = 'docs/media';
const TMP = 'test-results/media-video';
const PORT = 4321;
const BASE = `http://127.0.0.1:${PORT}/`;

const DOWN_BYTES_PER_MS = 43_000; // ≈ 344 Мбіт/с
const UP_BYTES_PER_MS = 12_000; // ≈ 96 Мбіт/с
const LATENCY_MS = 9;

const META = {
  clientIp: '203.0.113.42', // діапазон для документації (RFC 5737)
  asOrganization: 'Demo ISP',
  city: 'Kyiv',
  country: 'UA',
  colo: 'WAW',
};

/** Коротші фази, щоб GIF тривав ~10 с, але графік встиг «пожити» */
const DEMO_CONFIG = {
  ping: { count: 12, intervalMs: 40 },
  download: { durationMs: 3500 },
  upload: { durationMs: 3500 },
  warmupMs: 600,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wobble = () => 0.93 + Math.random() * 0.14;

// ───────────── Сервер з демо-даними ─────────────

/** Вигадані провайдери: медіана download, пінг */
const ISPS = [
  { isp: 'FiberOne', city: 'Kyiv', down: 480, ping: 7 },
  { isp: 'CityNet', city: 'Kyiv', down: 260, ping: 11 },
  { isp: 'HomeLAN', city: 'Lviv', down: 190, ping: 14 },
  { isp: 'SkyLink Mobile', city: 'Kyiv', down: 75, ping: 32 },
  { isp: 'RadioWave', city: 'Odesa', down: 42, ping: 45 },
];

async function seed(repo) {
  const now = Date.now();
  let rnd = 42;
  const rand = () => (rnd = (rnd * 16807) % 2147483647) / 2147483647; // детерміновано
  for (let i = 0; i < 3000; i++) {
    const p = ISPS[i % ISPS.length];
    const createdAt = new Date(now - rand() * 28 * 86_400_000);
    // Вечірній «прайм-тайм» за Києвом повільніший, ніч — найшвидша
    const hourKyiv = (createdAt.getUTCHours() + 3) % 24;
    const load = Math.exp(-((hourKyiv - 21) ** 2) / 8); // пік о 21:00
    const night = hourKyiv >= 2 && hourKyiv <= 6 ? 1.12 : 1;
    const down = p.down * night * (1 - 0.45 * load) * (0.85 + rand() * 0.3);
    await repo.insert(
      {
        server: 'cloudflare',
        download: Math.round(down * 10) / 10,
        upload: Math.round(down * 0.35 * 10) / 10,
        ping: Math.round(p.ping * (0.8 + rand() * 0.6) * 10) / 10,
        jitter: Math.round(rand() * 4 * 10) / 10,
        loss: 0,
        grade: down > 150 ? 'A' : down > 60 ? 'B' : 'C',
        score: Math.round(70 + rand() * 30),
        isp: p.isp,
        city: p.city,
        country: 'UA',
      },
      { createdAt },
    );
  }
}

async function startServer() {
  execFileSync('npm', ['run', 'build:self', '--', '--logLevel', 'warn'], { stdio: 'inherit' });
  const repo = memoryRepository();
  await seed(repo);
  const config = loadConfig({ STATIC_DIR: 'apps/web/dist', SPEED_ENDPOINTS: 'false', RATE_RESULTS_PER_MIN: '10000' });
  const app = await buildApp({ config, repo, logger: false });
  await app.listen({ host: '127.0.0.1', port: PORT });
  return app;
}

// ───────────── Підмінний Cloudflare ─────────────
// Окремий HTTPS/HTTP2-сервер на 127.0.0.1, куди Chromium резолвить speed.cloudflare.com
// (--host-resolver-rules). Байти йдуть справжньою мережею з обмеженням швидкості — як у реального
// Cloudflare (HTTP/2, без ліміту з'єднань), тож пінг під навантаженням не «застрягає» в черзі.

const CF_PORT = 8443;

function startFakeCloudflare() {
  const dir = 'test-results/media-cert';
  mkdirSync(dir, { recursive: true });
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=speed.cloudflare.com',
      '-keyout',
      join(dir, 'key.pem'),
      '-out',
      join(dir, 'cert.pem'),
    ],
    { stdio: 'ignore' },
  );

  let activeDown = 0;
  let activeUp = 0;
  const headers = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'timing-allow-origin': '*',
    'cache-control': 'no-store',
  };

  const server = createSecureServer(
    { key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')), allowHTTP1: true },
    async (req, res) => {
      const url = new URL(req.url, 'https://speed.cloudflare.com');
      const bytes = Number(url.searchParams.get('bytes') || 0);
      if (req.method === 'OPTIONS') return res.writeHead(204, headers).end();
      if (url.pathname === '/meta') {
        return res.writeHead(200, { ...headers, 'content-type': 'application/json' }).end(JSON.stringify(META));
      }
      if (url.pathname === '/__down' && bytes === 0) {
        // Невеликий bufferbloat під навантаженням — як у доброго домашнього роутера
        await sleep(LATENCY_MS * wobble() + (activeDown + activeUp ? 6 + Math.random() * 6 : 0));
        return res.writeHead(200, headers).end();
      }
      if (url.pathname === '/__down') {
        activeDown++;
        res.writeHead(200, { ...headers, 'content-type': 'application/octet-stream', 'content-length': bytes });
        await sleep(LATENCY_MS);
        const piece = Buffer.alloc(32 * 1024);
        let sent = 0;
        // Канал ділиться між потоками порівну; кожні 20 мс — своя частка
        while (sent < bytes && !res.destroyed) {
          const quota = Math.max(1024, Math.round(((DOWN_BYTES_PER_MS * 20) / Math.max(1, activeDown)) * wobble()));
          let chunk = Math.min(quota, bytes - sent);
          while (chunk > 0) {
            const n = Math.min(chunk, piece.length);
            res.write(n === piece.length ? piece : piece.subarray(0, n));
            chunk -= n;
            sent += n;
          }
          await sleep(20);
        }
        activeDown--;
        return res.end();
      }
      if (url.pathname === '/__up') {
        activeUp++;
        const t0 = Date.now();
        let size = 0;
        for await (const c of req) size += c.length;
        const need = LATENCY_MS + (size / (UP_BYTES_PER_MS / Math.max(1, activeUp))) * wobble();
        await sleep(Math.max(0, need - (Date.now() - t0)));
        activeUp--;
        return res.writeHead(200, headers).end('ok');
      }
      res.writeHead(404, headers).end();
    },
  );
  return new Promise((resolve) => server.listen(CF_PORT, '127.0.0.1', () => resolve(server)));
}

/** Кілька попередніх тестів в IndexedDB — щоб у модалці історії був графік */
function seedHistory() {
  const day = 86_400_000;
  const entries = [310, 285, 342, 120, 298, 330, 276, 315, 301, 290].map((down, i) => ({
    timestamp: Date.now() - (10 - i) * 1.4 * day,
    server: { id: 'cloudflare', name: 'Cloudflare' },
    download: { mbps: down },
    upload: { mbps: Math.round(down * 0.3) },
    ping: { median: down < 200 ? 28 : 9 + (i % 3), jitter: 1 + (i % 4) * 0.4, loss: 0 },
    stability: { score: down < 200 ? 61 : 88 + (i % 5), grade: down < 200 ? 'C' : 'A' },
  }));
  const req = indexedDB.open('speedtest-db', 1);
  req.onupgradeneeded = () => {
    const store = req.result.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
    store.createIndex('timestamp', 'timestamp');
  };
  req.onsuccess = () => {
    const tx = req.result.transaction('history', 'readwrite');
    entries.forEach((e) => tx.objectStore('history').add(e));
    tx.oncomplete = () => req.result.close();
  };
}

/**
 * @param {import('@playwright/test').Browser} browser
 * @param {import('@playwright/test').BrowserContextOptions} opts
 */
async function newPage(browser, { history = false, ...opts } = {}) {
  const context = await browser.newContext({ locale: 'uk-UA', ignoreHTTPSErrors: true, ...opts });
  if (history) await context.addInitScript(seedHistory);
  await context.addInitScript((cfg) => {
    // @ts-ignore — тестовий гачок, див. src/app.js
    window.__SPEEDTEST_CONFIG__ = cfg;
    localStorage.setItem('speedtest:settings', JSON.stringify({ sound: false, planMbps: 500, shareStats: false }));
  }, DEMO_CONFIG);
  const page = await context.newPage();
  return { context, page };
}

/** @param {import('@playwright/test').Page} page */
async function runTest(page) {
  await page.goto(BASE);
  // Чекаємо, поки визначиться сервер (опитуванням: сувора CSP сторінки не заважає)
  for (let i = 0; i < 100 && !(await page.textContent('#server-name'))?.includes('WAW'); i++) await sleep(100);
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: 'Старт' }).click();
  await page
    .locator('#summary')
    .waitFor({ state: 'visible', timeout: 60_000 })
    .catch(async (e) => {
      await page.screenshot({ path: 'test-results/media-failure.png' });
      throw e;
    });
  await page.waitForTimeout(1200); // анімація датчика доїжджає
}

// ───────────── Зйомка ─────────────

async function main() {
  mkdirSync(OUT, { recursive: true });
  rmSync(TMP, { recursive: true, force: true });
  const app = await startServer();
  const cf = await startFakeCloudflare();
  const browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM_PATH || undefined,
    args: [
      `--host-resolver-rules=MAP speed.cloudflare.com 127.0.0.1:${CF_PORT}`,
      '--ignore-certificate-errors',
      '--no-proxy-server', // інакше системний проксі з оточення обійде підміну DNS
    ],
  });
  try {
    // 1. Відео повного тесту → GIF
    const size = { width: 1280, height: 800 };
    {
      const { context, page } = await newPage(browser, {
        viewport: size,
        colorScheme: 'dark',
        recordVideo: { dir: TMP, size },
      });
      await runTest(page);
      await context.close();
      const video = join(
        TMP,
        readdirSync(TMP).find((f) => f.endsWith('.webm')),
      );
      const gif = join(OUT, 'demo.gif');
      // Двопрохідна палітра — чисті кольори без «бруду»; 12 к/с і 900 px — компроміс якості й розміру
      execFileSync('ffmpeg', [
        '-y',
        '-loglevel',
        'error',
        '-ss',
        '0.6',
        '-i',
        video,
        '-vf',
        'fps=12,scale=900:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
        gif,
      ]);
      console.log(`✓ ${gif} (${(statSync(gif).size / 1024 / 1024).toFixed(1)} МБ)`);
    }

    // 2. Результат: світла й темна тема (робочий стіл)
    for (const scheme of /** @type {const} */ (['light', 'dark'])) {
      const { context, page } = await newPage(browser, {
        viewport: size,
        colorScheme: scheme,
        history: scheme === 'light',
      });
      await runTest(page);
      await page.screenshot({ path: join(OUT, `result-${scheme}.png`), fullPage: true });
      if (scheme === 'light') {
        // Історія з графіком
        await page.getByRole('button', { name: /історія/i }).click();
        await page.locator('#history-modal[open]').waitFor();
        await page.waitForTimeout(600);
        await page.screenshot({ path: join(OUT, 'history.png') });
      }
      await context.close();
      console.log(`✓ result-${scheme}.png`);
    }

    // 3. Мобільний
    {
      const { context, page } = await newPage(browser, { ...devices['Pixel 7'], colorScheme: 'dark' });
      await runTest(page);
      await page.screenshot({ path: join(OUT, 'mobile.png') });
      await context.close();
      console.log('✓ mobile.png');
    }

    // 4. Аналітика (дані — вигадані)
    {
      const { context, page } = await newPage(browser, {
        viewport: { width: 1280, height: 900 },
        colorScheme: 'light',
      });
      await page.goto(`${BASE}analytics.html`);
      await page.locator('#providers-body tr').first().waitFor();
      await page.locator('.heatmap__cell[data-bin]').first().waitFor();
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(OUT, 'analytics.png'), fullPage: true });
      await context.close();
      console.log('✓ analytics.png');
    }
  } finally {
    await browser.close();
    await app.close();
    cf.close();
    rmSync(TMP, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
