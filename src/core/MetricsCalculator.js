/**
 * Чисті функції для розрахунку метрик мережі.
 * Не мають залежностей від DOM чи мережі — легко тестуються.
 */

export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function percentile(xs, p) {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export const median = (xs) => percentile(xs, 0.5);

export function stdDev(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Байти за мілісекунди → Мбіт/с. */
export function bytesToMbps(bytes, ms) {
  if (ms <= 0) return 0;
  return (bytes * 8) / (ms * 1000);
}

/**
 * Джиттер — середнє абсолютне відхилення між послідовними RTT
 * (спрощений підхід із RFC 3550).
 */
export function jitter(rtts) {
  if (rtts.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < rtts.length; i++) sum += Math.abs(rtts[i] - rtts[i - 1]);
  return sum / (rtts.length - 1);
}

/** Втрата пакетів у відсотках (у браузері — частка запитів, що не повернулись вчасно). */
export function packetLoss(sent, received) {
  if (sent <= 0) return 0;
  return Math.max(0, ((sent - received) / sent) * 100);
}

/** Зведена статистика по пінгу. */
export function summarizeLatency(rtts, sent = rtts.length) {
  return {
    min: rtts.length ? Math.min(...rtts) : 0,
    max: rtts.length ? Math.max(...rtts) : 0,
    avg: mean(rtts),
    median: median(rtts),
    jitter: jitter(rtts),
    loss: packetLoss(sent, rtts.length),
    samples: rtts,
  };
}

/**
 * Фінальна пропускна здатність.
 * samples: [{ t: мс від старту, bytes: кумулятивні байти }]
 * Ігноруємо перші warmupMs (TCP slow start) і рахуємо середню швидкість за решту часу.
 */
export function throughput(samples, warmupMs = 0) {
  if (!samples.length) return 0;
  const last = samples[samples.length - 1];
  let base = { t: 0, bytes: 0 };
  for (const s of samples) {
    if (s.t >= warmupMs) break;
    base = s;
  }
  // Якщо тест надто короткий — використовуємо весь інтервал
  if (last.t - base.t < 250) base = { t: 0, bytes: 0 };
  return bytesToMbps(last.bytes - base.bytes, last.t - base.t);
}

/** Швидкість за останні windowMs — для плавного «живого» датчика. */
export function liveSpeed(samples, windowMs = 1000) {
  if (samples.length < 2) {
    return samples.length ? bytesToMbps(samples[0].bytes, samples[0].t) : 0;
  }
  const last = samples[samples.length - 1];
  let ref = samples[0];
  for (let i = samples.length - 1; i >= 0; i--) {
    ref = samples[i];
    if (last.t - samples[i].t >= windowMs) break;
  }
  return bytesToMbps(last.bytes - ref.bytes, last.t - ref.t);
}

/**
 * Ряд «живої» швидкості для графіка: те саме, що liveSpeed() для кожного префікса,
 * але за один прохід (два вказівники) — O(n) замість O(n²).
 * @param {{ t: number, bytes: number }[]} samples
 * @param {number} windowMs
 * @returns {{ t: number, mbps: number }[]}
 */
export function speedSeries(samples, windowMs = 1000) {
  const out = [];
  let j = 0; // найпізніший семпл, що старший за поточний щонайменше на windowMs
  for (let k = 1; k < samples.length; k++) {
    while (j + 1 < k && samples[k].t - samples[j + 1].t >= windowMs) j++;
    const ref = samples[j];
    out.push({ t: samples[k].t, mbps: bytesToMbps(samples[k].bytes - ref.bytes, samples[k].t - ref.t) });
  }
  return out;
}

/** Коефіцієнт варіації швидкостей (0 = ідеально рівно). */
export function variation(values) {
  const m = mean(values);
  return m > 0 ? stdDev(values) / m : 0;
}

const clamp = (x, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, x));

/** Перетворює числовий бал на буквену оцінку. */
export function grade(score) {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

/**
 * Оцінка bufferbloat: наскільки зростає затримка під навантаженням.
 */
export function bufferbloat(idleMs, loadedMs) {
  const delta = Math.max(0, (loadedMs || 0) - (idleMs || 0));
  let g = 'A';
  if (delta > 400) g = 'F';
  else if (delta > 200) g = 'D';
  else if (delta > 100) g = 'C';
  else if (delta > 30) g = 'B';
  return { delta, grade: g };
}

/**
 * Інтегральна оцінка стабільності з'єднання (0–100).
 * Штрафуємо за джиттер, втрати, високий пінг, bufferbloat і нерівність швидкості.
 */
export function stabilityScore({ ping = 0, jitter: j = 0, loss = 0, bloatMs = 0, speedCv = 0 }) {
  const penalties = {
    jitter: clamp(j * 1.2, 0, 30),
    loss: clamp(loss * 8, 0, 40),
    ping: clamp((ping - 20) * 0.25, 0, 15),
    bloat: clamp(bloatMs * 0.08, 0, 20),
    variation: clamp(speedCv * 40, 0, 20),
  };
  const score = Math.round(clamp(100 - Object.values(penalties).reduce((a, b) => a + b, 0)));
  return { score, grade: grade(score), penalties };
}

/** Чи підходить з'єднання для типових сценаріїв. */
export function useCases({ download = 0, upload = 0, ping = 0, jitter: j = 0, loss = 0 }) {
  return {
    streaming4k: download >= 25 && loss < 2,
    videoCalls: upload >= 3 && download >= 3 && ping < 150 && j < 30,
    gaming: ping < 60 && j < 15 && loss < 1,
    browsing: download >= 2,
  };
}

/**
 * 90-й перцентиль швидкості у ковзному вікні після розгону.
 * Якщо точок замало (дуже короткий тест) — середня швидкість.
 * @param {{ t: number, bytes: number }[]} samples
 */
export function throughputP90(samples, warmupMs = 0, windowMs = 1000) {
  const points = speedSeries(samples, windowMs).filter((p) => p.t >= warmupMs + windowMs);
  if (points.length < 3) return throughput(samples, warmupMs);
  return percentile(
    points.map((p) => p.mbps),
    0.9,
  );
}

/**
 * Чи стабілізувалась швидкість: коефіцієнт варіації ковзної швидкості
 * за останні lookbackMs не перевищує tolerance.
 * @param {{ t: number, bytes: number }[]} samples
 */
export function isStable(samples, { windowMs = 1000, lookbackMs = 2500, tolerance = 0.05 } = {}) {
  if (samples.length < 3) return false;
  const last = samples[samples.length - 1].t;
  if (last < lookbackMs + windowMs) return false;
  const values = speedSeries(samples, windowMs)
    .filter((p) => p.t >= last - lookbackMs)
    .map((p) => p.mbps);
  if (values.length < 5 || mean(values) <= 0) return false;
  return variation(values) <= tolerance;
}

/**
 * Розбирає заголовок Server-Timing: "cfRequestDuration;dur=12.3, cache;desc=hit"
 * @param {string | null | undefined} header
 * @returns {Record<string, number>} назва → тривалість, мс
 */
export function parseServerTiming(header) {
  /** @type {Record<string, number>} */
  const out = {};
  if (!header) return out;
  for (const part of header.split(',')) {
    const [name, ...params] = part.trim().split(';');
    if (!name) continue;
    const dur = params.map((p) => p.trim()).find((p) => p.startsWith('dur='));
    out[name.trim()] = dur ? Number(dur.slice(4)) || 0 : 0;
  }
  return out;
}
