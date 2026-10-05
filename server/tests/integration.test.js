/**
 * Інтеграційні тести зі справжніми PostgreSQL і Redis.
 * Запускаються, лише якщо задано TEST_DATABASE_URL / TEST_REDIS_URL (локально або в CI).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Redis } from 'ioredis';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPool, migrate, pgRepository } from '../src/db.js';

const DB = process.env.TEST_DATABASE_URL;
const REDIS = process.env.TEST_REDIS_URL;

const result = {
  server: 'cloudflare',
  download: 300,
  upload: 100,
  ping: 20,
  jitter: 2,
  loss: 0,
  grade: 'B',
  score: 80,
  isp: 'ISP',
  city: 'Lviv',
  country: 'UA',
};

describe.skipIf(!DB)('PostgreSQL', () => {
  let pool;
  beforeAll(async () => {
    pool = createPool(DB);
    await pool.query('DROP TABLE IF EXISTS results, schema_migrations');
  });
  afterAll(() => pool.end());

  it('міграції застосовуються один раз (ідемпотентно)', async () => {
    expect(await migrate(pool, {})).toEqual(['001_results.sql']);
    expect(await migrate(pool, {})).toEqual([]);
  });

  it('паралельний запуск міграцій не ламається (advisory lock)', async () => {
    await pool.query('DROP TABLE IF EXISTS results, schema_migrations');
    const runs = await Promise.all([migrate(pool, {}), migrate(pool, {}), migrate(pool, {})]);
    expect(runs.flat()).toEqual(['001_results.sql']);
  });

  it('insert + stats через HTTP', async () => {
    const app = await buildApp({ config: loadConfig({}), repo: pgRepository(pool), logger: false });
    for (const download of [100, 300, 500]) {
      const res = await app.inject({ method: 'POST', url: '/api/results', payload: { ...result, download } });
      expect(res.statusCode).toBe(201);
    }
    const stats = (await app.inject('/api/results/stats')).json();
    expect(stats).toMatchObject({ count: 3, avgDownload: 300, avgUpload: 100, medianPing: 20 });
    expect((await app.inject('/api/health')).json()).toMatchObject({ db: 'ok' });
    await app.close();
  });

  it('CHECK-обмеження в БД — друга лінія захисту', async () => {
    await expect(pgRepository(pool).insert({ ...result, grade: 'Z' })).rejects.toThrow();
    await expect(pgRepository(pool).insert({ ...result, loss: 101 })).rejects.toThrow();
  });
});

describe.skipIf(!REDIS)('Redis rate limit', () => {
  let redis;
  beforeAll(async () => {
    redis = new Redis(REDIS);
    const keys = await redis.keys('speedtest-rl:*');
    if (keys.length) await redis.del(...keys);
  });
  afterAll(() => redis.quit());

  it('ліміт спільний для кількох інстансів сервера', async () => {
    const config = loadConfig({ RATE_RESULTS_PER_MIN: '2' });
    const a = await buildApp({ config, redis, logger: false });
    const b = await buildApp({ config, redis, logger: false });
    const post = (app) =>
      app.inject({ method: 'POST', url: '/api/results', payload: result, remoteAddress: '192.0.2.50' });
    expect((await post(a)).statusCode).toBe(201);
    expect((await post(b)).statusCode).toBe(201);
    expect((await post(a)).statusCode).toBe(429); // третій — через інший інстанс, але ліміт спільний
    expect((await a.inject('/api/health')).json()).toMatchObject({ redis: 'ok' });
    await a.close();
    await b.close();
  });
});
