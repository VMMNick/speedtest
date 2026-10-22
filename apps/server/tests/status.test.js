/**
 * Стан провайдерів і фонові задачі.
 * Логіка й API — на репозиторії в пам'яті; паритет із PostgreSQL і справжня черга BullMQ —
 * лише з TEST_DATABASE_URL / TEST_REDIS_URL.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { evaluate, incidentAction, checkProviders, DEFAULT_RULES } from '../src/status.js';
import { createHandlers, startJobs, JOBS, QUEUE_NAME, QUEUE_PREFIX } from '../src/jobs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { memoryRepository, createPool, migrate, pgRepository } from '../src/db.js';
import { TEST_ENV } from './fixtures.js';
import { demoStatus } from '../../web/src/core/demoData.js';

const DB = process.env.TEST_DATABASE_URL;
const REDIS = process.env.TEST_REDIS_URL;

const HOUR = 3_600_000;
const NOW = new Date('2026-10-20T12:00:00Z');
const at = (msAgo) => ({ createdAt: new Date(NOW.getTime() - msAgo) });
const base = {
  server: 'cloudflare',
  upload: 50,
  jitter: 2,
  loss: 0,
  grade: 'B',
  score: 80,
  city: 'Kyiv',
  country: 'UA',
};
const quiet = { info() {}, warn() {}, error() {} };

/** Звичайна картина: FastNet ~300 Мбіт/с і 10 мс протягом двох тижнів */
async function seedBaseline(repo) {
  for (let i = 0; i < 12; i++) {
    await repo.insert({ ...base, isp: 'FastNet', download: 280 + (i % 5) * 10, ping: 10 }, at((i + 1) * 24 * HOUR));
    await repo.insert({ ...base, isp: 'SlowNet', download: 40 + (i % 3) * 5, ping: 30 }, at((i + 1) * 24 * HOUR));
  }
}

const window = (over) => ({
  isp: 'X',
  recentSamples: 5,
  baselineSamples: 20,
  recentDownload: 300,
  baselineDownload: 300,
  recentPing: 10,
  baselinePing: 10,
  ...over,
});

describe('evaluate', () => {
  it.each([
    ['як зазвичай', {}, 'ok', []],
    ['download упав більш ніж удвічі', { recentDownload: 140 }, 'degraded', ['download']],
    ['download упав, але не вдвічі', { recentDownload: 160 }, 'ok', []],
    ['пінг зріс утричі й на 20+ мс', { recentPing: 35 }, 'degraded', ['ping']],
    ['пінг зріс утричі, але лише на 6 мс (3 → 9)', { baselinePing: 3, recentPing: 9 }, 'ok', []],
    ['обидва погіршились', { recentDownload: 100, recentPing: 80 }, 'degraded', ['download', 'ping']],
    ['замало свіжих тестів', { recentSamples: 2, recentDownload: 1 }, 'unknown', []],
    ['замало історії', { baselineSamples: 9, recentDownload: 1 }, 'unknown', []],
  ])('%s', (_, over, status, reasons) => {
    expect(evaluate(window(over))).toMatchObject({ status, reasons });
  });
});

it('демо-стан на сторінці аналітики узгоджений із правилами сервера', () => {
  for (const p of demoStatus().providers) {
    const v = evaluate(p);
    expect(v.status, p.isp).toBe(p.status);
    expect(v.reasons, p.isp).toEqual(p.reasons);
  }
});

describe('incidentAction', () => {
  it.each([
    [undefined, 'degraded', 'open'],
    ['ok', 'degraded', 'open'],
    ['unknown', 'degraded', 'open'],
    ['degraded', 'ok', 'close'],
    ['degraded', 'unknown', null], // не знаємо, чи виправили — інцидент лишається відкритим
    ['degraded', 'degraded', null],
    ['ok', 'unknown', null],
  ])('%s → %s = %s', (prev, next, action) => {
    expect(incidentAction(prev, next)).toBe(action);
  });
});

/**
 * Сценарій «деградація → відновлення» — однаковий для пам'яті й PostgreSQL.
 * @returns {Promise<any>} усе, що повернули репозиторій і перевірки, для порівняння реалізацій
 */
async function scenario(repo) {
  await seedBaseline(repo);
  const out = {};

  // 1. Свіжі тести FastNet повільні (~60 замість ~300): деградація, відкривається інцидент
  for (const download of [55, 60, 70]) await repo.insert({ ...base, isp: 'FastNet', download, ping: 12 }, at(HOUR));
  for (const download of [40, 45, 50]) await repo.insert({ ...base, isp: 'SlowNet', download, ping: 30 }, at(HOUR));
  out.windows = await repo.providerWindows({ now: NOW, recentHours: 3, baselineDays: 14 });
  out.check1 = await checkProviders(repo, { now: NOW });
  out.status1 = await repo.providerStatus();

  // 2. Повторна перевірка через 10 хв: стан той самий, «since» не змінюється, другого інциденту немає
  out.check2 = await checkProviders(repo, { now: new Date(NOW.getTime() + 10 * 60_000) });
  out.status2 = await repo.providerStatus();

  // 3. Через 4 год свіжі тести знову нормальні: інцидент закривається
  const later = new Date(NOW.getTime() + 4 * HOUR);
  for (const download of [290, 300, 310]) {
    await repo.insert({ ...base, isp: 'FastNet', download, ping: 10 }, { createdAt: new Date(later.getTime() - HOUR) });
  }
  out.check3 = await checkProviders(repo, { now: later });
  out.status3 = await repo.providerStatus();
  out.incidents = await repo.incidents({ days: 30, now: later });
  return out;
}

describe('перевірка стану (пам’ять)', () => {
  let out;
  beforeAll(async () => {
    out = await scenario(memoryRepository());
  });

  it('вікна: медіани «зараз» і «як зазвичай» окремо', () => {
    expect(out.windows.find((w) => w.isp === 'FastNet')).toEqual({
      isp: 'FastNet',
      recentSamples: 3,
      baselineSamples: 12,
      recentDownload: 60,
      baselineDownload: 295,
      recentPing: 12,
      baselinePing: 10,
    });
  });

  it('деградація відкриває інцидент лише для повільного провайдера', () => {
    expect(out.check1.transitions).toEqual([
      { isp: 'FastNet', from: undefined, to: 'degraded', action: 'open' },
      { isp: 'SlowNet', from: undefined, to: 'ok', action: null },
    ]);
    expect(out.status1.map((s) => [s.isp, s.status])).toEqual([
      ['FastNet', 'degraded'],
      ['SlowNet', 'ok'],
    ]);
  });

  it('повторна перевірка без змін: без переходів, since зберігається', () => {
    expect(out.check2.transitions).toEqual([]);
    expect(out.status2[0].since).toBe(out.status1[0].since);
    expect(out.status2[0].checkedAt).not.toBe(out.status1[0].checkedAt);
  });

  it('відновлення закриває інцидент', () => {
    expect(out.check3.transitions).toContainEqual({ isp: 'FastNet', from: 'degraded', to: 'ok', action: 'close' });
    expect(out.incidents).toHaveLength(1);
    expect(out.incidents[0]).toMatchObject({
      isp: 'FastNet',
      startedAt: NOW.toISOString(),
      endedAt: new Date(NOW.getTime() + 4 * HOUR).toISOString(),
      reasons: ['download'],
      recentDownload: 60,
      baselineDownload: 295,
    });
  });
});

describe('API стану', () => {
  let app;
  beforeAll(async () => {
    const repo = memoryRepository();
    await seedBaseline(repo);
    // Свіжі тести відносно справжнього «зараз» — API не приймає now
    for (const download of [55, 60, 70]) {
      await repo.insert({ ...base, isp: 'FastNet', download, ping: 12 }, { createdAt: new Date(Date.now() - HOUR) });
    }
    // TinyISP: 2 тести — нижче порогу k-анонімності, у відповідь не потрапляє
    for (let i = 0; i < 2; i++) await repo.insert({ ...base, isp: 'TinyISP', download: 10, ping: 5 }, at(HOUR));
    // Базові тести посіяні відносно NOW — перевіряємо від справжнього часу з ширшим вікном
    await checkProviders(repo, { rules: { ...DEFAULT_RULES, baselineDays: 400 } });
    app = await buildApp({ config: loadConfig(TEST_ENV), repo, logger: false });
  });
  afterAll(() => app.close());

  it('GET /api/status/providers: проблемні першими, без малих груп', async () => {
    const res = await app.inject('/api/status/providers');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.providers.map((p) => [p.isp, p.status])).toEqual([
      ['FastNet', 'degraded'],
      ['SlowNet', 'unknown'],
    ]);
    expect(body).toMatchObject({ recentHours: 3, baselineDays: 14 });
    expect(Date.parse(body.checkedAt)).toBeGreaterThan(Date.now() - 60_000);
  });

  it('GET /api/status/incidents: відкритий інцидент; валідація days', async () => {
    const list = (await app.inject('/api/status/incidents')).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ isp: 'FastNet', endedAt: null, reasons: ['download'] });
    expect((await app.inject('/api/status/incidents?days=0')).statusCode).toBe(400);
    expect((await app.inject('/api/status/incidents?days=7&x=1')).statusCode).toBe(400);
  });
});

describe('задачі', () => {
  it('retention видаляє лише результати, старші за поріг', async () => {
    const repo = memoryRepository();
    await repo.insert(
      { ...base, isp: 'A', download: 1, ping: 1 },
      { createdAt: new Date(Date.now() - 500 * 86_400_000) },
    );
    await repo.insert(
      { ...base, isp: 'A', download: 1, ping: 1 },
      { createdAt: new Date(Date.now() - 10 * 86_400_000) },
    );
    const handlers = createHandlers({ repo, retentionDays: 400, statusEveryMs: 60_000, log: quiet });
    expect(await handlers[JOBS.retention]()).toEqual({ deleted: 1 });
    expect(repo.rows).toHaveLength(1);
  });

  it('provider-status передає переходи далі (для сповіщень)', async () => {
    const repo = memoryRepository();
    for (let i = 0; i < 12; i++) {
      await repo.insert(
        { ...base, isp: 'A', download: 300, ping: 10 },
        { createdAt: new Date(Date.now() - (i + 1) * 86_400_000) },
      );
    }
    for (let i = 0; i < 3; i++) {
      await repo.insert({ ...base, isp: 'A', download: 20, ping: 10 }, { createdAt: new Date(Date.now() - HOUR) });
    }
    const seen = [];
    const handlers = createHandlers({ repo, retentionDays: 400, log: quiet, onTransitions: (t) => seen.push(...t) });
    expect(await handlers[JOBS.providerStatus]()).toEqual({ checked: 1, transitions: 1 });
    expect(seen).toEqual([{ isp: 'A', from: undefined, to: 'degraded', action: 'open' }]);
  });

  it('без Redis задачі йдуть за таймером у процесі', async () => {
    const repo = memoryRepository();
    const jobs = await startJobs({ repo, retentionDays: 400, statusEveryMs: 60_000, log: quiet });
    expect(jobs.mode).toBe('timer');
    await jobs.close();
  });
});

describe.skipIf(!DB)('PostgreSQL = пам’ять', () => {
  let pool;
  beforeAll(async () => {
    pool = createPool(DB);
    await migrate(pool, {});
    await pool.query('TRUNCATE results, provider_status, provider_incidents RESTART IDENTITY');
  });
  afterAll(async () => {
    await pool.query('TRUNCATE results, provider_status, provider_incidents RESTART IDENTITY');
    await pool.end();
  });

  it('той самий сценарій дає ті самі вікна, переходи, знімки й інциденти', async () => {
    const pgOut = await scenario(pgRepository(pool));
    const memOut = await scenario(memoryRepository());
    expect(pgOut).toEqual(memOut);
  });

  it('retention у SQL', async () => {
    const repo = pgRepository(pool);
    await repo.insert(
      { ...base, isp: 'Old', download: 1, ping: 1 },
      { createdAt: new Date(Date.now() - 500 * 86_400_000) },
    );
    const before = Number((await pool.query('SELECT count(*) FROM results')).rows[0].count);
    expect(await repo.deleteResultsOlderThan(400)).toBe(1);
    expect(Number((await pool.query('SELECT count(*) FROM results')).rows[0].count)).toBe(before - 1);
  });
});

describe.skipIf(!REDIS)('BullMQ (справжній Redis)', () => {
  const clean = async () => {
    const q = new Queue(QUEUE_NAME, {
      connection: new Redis(REDIS, { maxRetriesPerRequest: null }),
      prefix: QUEUE_PREFIX,
    });
    await q.obliterate({ force: true });
    await q.close();
    await /** @type {any} */ (q.opts.connection).quit();
  };
  beforeAll(clean);
  afterAll(clean);

  it('планувальник створює задачі, воркер їх виконує й зберігає стан', async () => {
    const repo = memoryRepository();
    for (let i = 0; i < 12; i++) {
      await repo.insert(
        { ...base, isp: 'A', download: 300, ping: 10 },
        { createdAt: new Date(Date.now() - (i + 1) * 86_400_000) },
      );
    }
    for (let i = 0; i < 3; i++) {
      await repo.insert({ ...base, isp: 'A', download: 290, ping: 10 }, { createdAt: new Date(Date.now() - HOUR) });
    }
    const jobs = await startJobs({ repo, redisUrl: REDIS, retentionDays: 400, statusEveryMs: 60_000, log: quiet });
    try {
      expect(jobs.mode).toBe('bullmq');
      const schedulers = await jobs.queue.getJobSchedulers();
      expect(schedulers.map((s) => s.key).sort()).toEqual([JOBS.providerStatus, JOBS.retention]);
      // Перший запуск — одразу після створення розкладу
      await expect
        .poll(async () => (await repo.providerStatus()).map((s) => s.status), { timeout: 10_000 })
        .toEqual(['ok']);

      // Повторний старт (новий деплой) не дублює розклад
      const again = await startJobs({ repo, redisUrl: REDIS, retentionDays: 400, statusEveryMs: 60_000, log: quiet });
      expect(await again.queue.getJobSchedulers()).toHaveLength(2);
      await again.close();
    } finally {
      await jobs.close();
    }
  });
});
