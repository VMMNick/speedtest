/**
 * Глобальна конфігурація тесту швидкості.
 * Усі параметри вимірювань зібрані тут, щоб їх можна було тюнити без змін у логіці.
 */

/**
 * Власний сервер (server/ у цьому репозиторії). Вмикається на етапі збірки:
 * VITE_SELF_SERVER=true (так збирає Dockerfile). URL відносні — їх розв'язує resolveServerUrls().
 */
export const SELF_SERVER = {
  id: 'self',
  name: 'Self-hosted',
  nameKey: 'server.self',
  pingUrl: 'api/ping',
  downloadUrl: 'api/download',
  uploadUrl: 'api/upload',
  metaUrl: 'api/meta',
  serverTimingNames: ['app'],
};

// Саме `import.meta.env.VITE_…` (без проміжних змінних): Vite підставляє значення статично
export const FEATURES = Object.freeze({
  selfServer: import.meta.env.VITE_SELF_SERVER === 'true',
  resultsApi: import.meta.env.VITE_RESULTS_API === 'true',
});

/** Перелік серверів-кандидатів. ServerSelector обирає найшвидший за пінгом. */
export const SERVERS = [
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    pingUrl: 'https://speed.cloudflare.com/__down?bytes=0',
    downloadUrl: 'https://speed.cloudflare.com/__down',
    uploadUrl: 'https://speed.cloudflare.com/__up',
    metaUrl: 'https://speed.cloudflare.com/meta',
    // Час обробки на сервері (заголовок Server-Timing) — віднімається від RTT
    serverTimingNames: ['cfRequestDuration'],
  },
  ...(FEATURES.selfServer ? [SELF_SERVER] : []),
];

/**
 * Робить URL сервера абсолютними відносно сторінки.
 * Потрібно, бо воркер розв'язував би відносні шляхи від власного файлу (/assets/…).
 * @template {Record<string, any>} S
 * @param {S} server
 * @param {string} base напр. document.baseURI
 * @returns {S}
 */
export function resolveServerUrls(server, base) {
  const out = /** @type {Record<string, any>} */ ({ ...server });
  for (const key of ['pingUrl', 'downloadUrl', 'uploadUrl', 'metaUrl']) {
    if (out[key]) out[key] = new URL(out[key], base).toString();
  }
  return /** @type {S} */ (out);
}

export const CONFIG = Object.freeze({
  /** Пінг у стані спокою (idle latency). */
  ping: {
    count: 20, // кількість вимірювань
    timeoutMs: 2000, // запит довший за це вважається втраченим
    intervalMs: 40, // пауза між пінгами
    warmup: 1, // перші N запитів відкидаються (DNS + TLS handshake)
  },

  /** Завантаження (download). */
  download: {
    durationMs: 10000,
    streams: 4, // паралельні потоки
    initialBytes: 100_000,
    maxBytes: 50_000_000,
    targetRequestMs: 1000, // розмір чанка росте, доки запит не триватиме ~1с
    maxRequestMs: 3000, // за фактичною швидкістю — запит не довший за це
    abortAtDeadline: true, // частково завантажені байти вже враховані
  },

  /** Вивантаження (upload). */
  upload: {
    durationMs: 10000,
    streams: 3,
    initialBytes: 100_000,
    maxBytes: 20_000_000,
    targetRequestMs: 1000,
    maxRequestMs: 2000, // має бути < graceMs, інакше останній чанк може пропасти
    abortAtDeadline: false, // байти зараховуються лише після завершення запиту
    graceMs: 4000, // жорсткий таймаут після дедлайну
  },

  /** Пінг під навантаженням (bufferbloat). */
  loadedLatency: {
    intervalMs: 400,
    timeoutMs: 3000,
  },

  /**
   * Фінальна швидкість:
   *  'p90'  — 90-й перцентиль швидкості у ковзному вікні після розгону (як Cloudflare/Ookla:
   *           «на що здатен канал», менш чутливо до випадкових просідань);
   *  'mean' — середня за весь час після розгону.
   */
  aggregate: 'p90',

  /** Раннє завершення фази, коли швидкість стабілізувалась (економить час і трафік). */
  earlyStop: {
    enabled: true,
    minDurationMs: 5000, // не раніше
    lookbackMs: 2500, // аналізуємо останні N мс
    tolerance: 0.05, // коефіцієнт варіації ≤ 5% → стабільно
  },

  /** Як часто фіксуються семпли швидкості. */
  sampleIntervalMs: 200,
  /** Розгін TCP (slow start) ігнорується у фінальному результаті. */
  warmupMs: 1500,
  /** Вікно згладжування «живої» швидкості на датчику. */
  liveWindowMs: 1000,

  /** Позначки шкали датчика (Мбіт/с) — нелінійна шкала як у класичних спідтестах. */
  gaugeScale: [0, 1, 5, 10, 20, 30, 50, 75, 100, 250, 500, 1000],
  /** Шкала для мультигігабітних каналів — вмикається автоматично, коли швидкість > 1 Гбіт/с. */
  gaugeScaleGigabit: [0, 10, 50, 100, 250, 500, 1000, 2500, 5000, 7500, 10000],

  history: {
    maxEntries: 100,
  },
});

/**
 * Економний режим для повільних/лімітованих з'єднань:
 * коротші фази, менше потоків і менші чанки → у рази менше трафіку.
 */
export const LIGHT_CONFIG = Object.freeze({
  ping: { count: 12 },
  download: { durationMs: 6000, streams: 2, maxBytes: 10_000_000 },
  upload: { durationMs: 6000, streams: 2, maxBytes: 5_000_000 },
  earlyStop: { minDurationMs: 3500 },
});

/**
 * Чи вмикати економний режим автоматично.
 * @param {{ saveData?: boolean, effectiveType?: string } | undefined} connection navigator.connection
 */
export function detectLightMode(connection) {
  if (!connection) return false;
  return Boolean(connection.saveData) || ['slow-2g', '2g', '3g'].includes(connection.effectiveType);
}

/** Глибоке злиття конфігурацій (масиви замінюються цілком). */
export function mergeDeep(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? mergeDeep(base?.[k] || {}, v) : v;
  }
  return out;
}
