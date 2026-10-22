/**
 * Демо-дані для сторінки аналітики, поки справжніх тестів замало.
 *
 * Провайдери й міста вигадані, числа детерміновані (той самий вигляд при кожному відкритті).
 * Форма — точно як у відповідей /api/results/stats і /api/analytics/*, тож рендер той самий.
 * Сторінка завжди підписує такі дані як демо — їх не можна сплутати зі справжньою статистикою.
 */

/** Скільки справжніх тестів потрібно, щоб аналітика за замовчуванням показувала їх, а не демо */
export const DEMO_THRESHOLD = 30;

const TESTS_PER_DAY = 100;

/** Вигадані провайдери: медіана download/upload (Мбіт/с), пінг (мс), частка тестів */
const ISPS = [
  { isp: 'FiberOne', city: 'Kyiv', down: 468, up: 164, ping: 7.6, share: 0.24 },
  { isp: 'CityNet', city: 'Kyiv', down: 254, up: 88.8, ping: 12.2, share: 0.22 },
  { isp: 'HomeLAN', city: 'Lviv', down: 182, up: 63.8, ping: 15.3, share: 0.2 },
  { isp: 'SkyLink Mobile', city: 'Kyiv', down: 73.1, up: 25.6, ping: 34.6, share: 0.18 },
  { isp: 'RadioWave', city: 'Odesa', down: 40.9, up: 14.3, ping: 49.1, share: 0.16 },
];

const round1 = (x) => Math.round(x * 10) / 10;

/** Детермінований «шум» 0..1 за ключем (без Math.random — щоразу однаково) */
function noise(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
}

/** Множник швидкості за годиною: вечірній «прайм-тайм» повільніший, ніч — найшвидша */
function hourFactor(hour) {
  const evening = Math.exp(-((hour - 21) ** 2) / 8);
  const night = hour >= 2 && hour <= 6 ? 1.12 : 1;
  return night * (1 - 0.45 * evening);
}

const pick = ({ city = '', isp = '' } = {}) =>
  ISPS.filter((p) => (!city || p.city === city) && (!isp || p.isp === isp));

const tests = (days, share) => Math.round(days * TESTS_PER_DAY * share);

/** Як GET /api/results/stats */
export function demoStats(days = 30) {
  const total = ISPS.reduce((s, p) => s + p.share, 0);
  const avg = (key) => ISPS.reduce((s, p) => s + p[key] * p.share, 0) / total;
  return {
    count: tests(days, total),
    avgDownload: round1(avg('down')),
    avgUpload: round1(avg('up')),
    medianPing: 15.4,
  };
}

/** Як GET /api/analytics/providers */
export function demoProviders(days = 30, city = '') {
  return pick({ city })
    .map((p) => ({
      isp: p.isp,
      medianDownload: p.down,
      p90Download: round1(p.down * 1.17),
      medianUpload: p.up,
      medianPing: p.ping,
      samples: tests(days, p.share),
    }))
    .sort((a, b) => b.medianDownload - a.medianDownload);
}

/** Як GET /api/analytics/cities */
export function demoCities(days = 30) {
  const byCity = new Map();
  for (const p of ISPS) byCity.set(p.city, (byCity.get(p.city) ?? 0) + tests(days, p.share));
  return [...byCity].map(([city, samples]) => ({ city, country: 'UA', samples })).sort((a, b) => b.samples - a.samples);
}

/** Як GET /api/analytics/heatmap: 7 днів × 24 години, dow 1 = понеділок */
export function demoHeatmap(days = 30, { city = '', isp = '' } = {}) {
  const set = pick({ city, isp });
  if (!set.length) return [];
  const share = set.reduce((s, p) => s + p.share, 0);
  const base = set.reduce((s, p) => s + p.down * p.share, 0) / share;
  const total = tests(days, share);
  const cells = [];
  for (let dow = 1; dow <= 7; dow++) {
    for (let hour = 0; hour < 24; hour++) {
      const n = noise(`${city}|${isp}|${dow}|${hour}`);
      cells.push({
        dow,
        hour,
        medianDownload: round1(base * hourFactor(hour) * (0.88 + n * 0.24)),
        weight: 0.6 + n * 0.8,
      });
    }
  }
  // Розподіл тестів по клітинках так, щоб у сумі вийшла та сама кількість, що й у KPI
  const sum = cells.reduce((s, c) => s + c.weight, 0);
  let left = total;
  cells.forEach((c, i) => {
    const n = i === cells.length - 1 ? left : Math.max(1, Math.round((c.weight / sum) * total));
    left -= n;
    delete c.weight;
    c.samples = Math.max(1, n);
  });
  return cells;
}

const MIN = 60_000;

/**
 * Як GET /api/status/providers: SkyLink Mobile зараз повільніший за звичайне, RadioWave — замало свіжих тестів.
 * @param {number} [now] мс
 */
export function demoStatus(now = Date.now()) {
  const at = (minAgo) => new Date(now - minAgo * MIN).toISOString();
  const providers = ISPS.map((p, i) => {
    const degraded = p.isp === 'SkyLink Mobile';
    const unknown = p.isp === 'RadioWave';
    const recentDownload = degraded ? round1(p.down * 0.38) : round1(p.down * (0.94 + noise(p.isp) * 0.1));
    return {
      isp: p.isp,
      status: degraded ? 'degraded' : unknown ? 'unknown' : 'ok',
      since: at(degraded ? 47 : 60 * 24 * (3 + i)),
      reasons: degraded ? ['download'] : [],
      recentDownload: unknown ? null : recentDownload,
      baselineDownload: p.down,
      recentPing: unknown ? null : round1(p.ping * (degraded ? 1.3 : 1)),
      baselinePing: p.ping,
      recentSamples: unknown ? 2 : Math.round(40 * p.share),
      baselineSamples: tests(14, p.share),
    };
  });
  const order = { degraded: 0, ok: 1, unknown: 2 };
  providers.sort((a, b) => order[a.status] - order[b.status] || b.recentSamples - a.recentSamples);
  return { checkedAt: at(3), recentHours: 3, baselineDays: 14, providers };
}

/**
 * Як GET /api/status/incidents: один триває, два вже минули.
 * @param {number} [now] мс
 */
export function demoIncidents(now = Date.now()) {
  const at = (minAgo) => new Date(now - minAgo * MIN).toISOString();
  const isp = (name) => ISPS.find((p) => p.isp === name);
  const sky = isp('SkyLink Mobile');
  const home = isp('HomeLAN');
  const city = isp('CityNet');
  return [
    {
      id: 3,
      isp: sky.isp,
      startedAt: at(47),
      endedAt: null,
      reasons: ['download'],
      recentDownload: round1(sky.down * 0.38),
      baselineDownload: sky.down,
      recentPing: round1(sky.ping * 1.3),
      baselinePing: sky.ping,
    },
    {
      id: 2,
      isp: home.isp,
      startedAt: at(60 * 26),
      endedAt: at(60 * 23 + 30),
      reasons: ['download'],
      recentDownload: round1(home.down * 0.42),
      baselineDownload: home.down,
      recentPing: home.ping,
      baselinePing: home.ping,
    },
    {
      id: 1,
      isp: city.isp,
      startedAt: at(60 * 24 * 4 + 120),
      endedAt: at(60 * 24 * 4 + 20),
      reasons: ['ping'],
      recentDownload: city.down,
      baselineDownload: city.down,
      recentPing: 58.4,
      baselinePing: city.ping,
    },
  ];
}
