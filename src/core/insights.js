/**
 * Чисті функції для «розумних» підказок інтерфейсу:
 * порівняння з попереднім тестом, частка від тарифу, фільтр історії, спарклайн.
 */

/** Які метрики порівнюємо і в який бік «краще». */
const METRICS = {
  download: { get: (r) => r?.download?.mbps, higherIsBetter: true },
  upload: { get: (r) => r?.upload?.mbps, higherIsBetter: true },
  ping: { get: (r) => r?.ping?.median, higherIsBetter: false },
  jitter: { get: (r) => r?.ping?.jitter, higherIsBetter: false },
};

/** Зміни, менші за цей відсоток, вважаються шумом. */
export const SAME_THRESHOLD_PCT = 3;

/**
 * @typedef {object} Delta
 * @property {number} delta       абсолютна різниця (cur − prev)
 * @property {number} pct         відносна зміна, %
 * @property {'better' | 'worse' | 'same'} trend
 */

/**
 * Порівнює поточний результат із попереднім.
 * @param {object | null | undefined} prev
 * @param {object} cur
 * @returns {Record<string, Delta> | null} null — якщо порівнювати нема з чим
 */
export function compareResults(prev, cur) {
  if (!prev) return null;
  /** @type {Record<string, Delta>} */
  const out = {};
  for (const [key, { get, higherIsBetter }] of Object.entries(METRICS)) {
    const a = get(prev);
    const b = get(cur);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0) continue;
    const delta = b - a;
    const pct = (delta / a) * 100;
    let trend = /** @type {Delta['trend']} */ ('same');
    if (Math.abs(pct) >= SAME_THRESHOLD_PCT) trend = delta > 0 === higherIsBetter ? 'better' : 'worse';
    out[key] = { delta, pct, trend };
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Частка фактичної швидкості від заявленої провайдером.
 * @param {number} mbps
 * @param {number | null | undefined} planMbps
 * @returns {{ pct: number, level: 'good' | 'ok' | 'bad' } | null}
 */
export function planShare(mbps, planMbps) {
  if (!Number.isFinite(mbps) || !Number.isFinite(planMbps) || planMbps <= 0) return null;
  const pct = (mbps / planMbps) * 100;
  return { pct, level: pct >= 80 ? 'good' : pct >= 50 ? 'ok' : 'bad' };
}

/** Періоди для фільтра історії, мс. */
export const PERIODS = {
  all: Infinity,
  '24h': 24 * 3600_000,
  '7d': 7 * 24 * 3600_000,
  '30d': 30 * 24 * 3600_000,
};

/**
 * @template {{ timestamp: number }} T
 * @param {T[]} entries
 * @param {keyof typeof PERIODS | string} period
 * @param {number} [now]
 * @returns {T[]}
 */
export function filterByPeriod(entries, period, now = Date.now()) {
  const span = PERIODS[period] ?? Infinity;
  if (span === Infinity) return entries;
  return entries.filter((e) => now - e.timestamp <= span);
}

/**
 * Точки для SVG <polyline> спарклайна. Більше значення — вище.
 * @param {number[]} values
 * @param {number} width
 * @param {number} height
 * @param {number} [pad] відступ зверху/знизу
 * @returns {string} "x,y x,y …"
 */
export function sparklinePoints(values, width, height, pad = 2) {
  const vs = values.filter(Number.isFinite);
  if (!vs.length) return '';
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const range = max - min || 1;
  const stepX = vs.length > 1 ? width / (vs.length - 1) : 0;
  return vs
    .map((v, i) => {
      const x = vs.length > 1 ? i * stepX : width / 2;
      const y = max === min ? height / 2 : pad + (1 - (v - min) / range) * (height - 2 * pad);
      return `${+x.toFixed(2)},${+y.toFixed(2)}`;
    })
    .join(' ');
}
