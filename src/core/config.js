/**
 * Глобальна конфігурація тесту швидкості.
 * Усі параметри вимірювань зібрані тут, щоб їх можна було тюнити без змін у логіці.
 */

/** Перелік серверів-кандидатів. ServerSelector обирає найшвидший за пінгом. */
export const SERVERS = [
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    pingUrl: 'https://speed.cloudflare.com/__down?bytes=0',
    downloadUrl: 'https://speed.cloudflare.com/__down',
    uploadUrl: 'https://speed.cloudflare.com/__up',
    metaUrl: 'https://speed.cloudflare.com/meta',
  },
];

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
    abortAtDeadline: true, // частково завантажені байти вже враховані
  },

  /** Вивантаження (upload). */
  upload: {
    durationMs: 10000,
    streams: 3,
    initialBytes: 100_000,
    maxBytes: 20_000_000,
    targetRequestMs: 1000,
    abortAtDeadline: false, // байти зараховуються лише після завершення запиту
    graceMs: 4000, // жорсткий таймаут після дедлайну
  },

  /** Пінг під навантаженням (bufferbloat). */
  loadedLatency: {
    intervalMs: 400,
    timeoutMs: 3000,
  },

  /** Як часто фіксуються семпли швидкості. */
  sampleIntervalMs: 200,
  /** Розгін TCP (slow start) ігнорується у фінальному результаті. */
  warmupMs: 1500,
  /** Вікно згладжування «живої» швидкості на датчику. */
  liveWindowMs: 1000,

  /** Позначки шкали датчика (Мбіт/с) — нелінійна шкала як у класичних спідтестах. */
  gaugeScale: [0, 1, 5, 10, 20, 30, 50, 75, 100, 250, 500, 1000],

  history: {
    maxEntries: 100,
  },
});
