/**
 * Точка входу: підключення до PostgreSQL і Redis, міграції, запуск і коректна зупинка.
 */
import { Redis } from 'ioredis';
import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { createPool, migrate, pgRepository, memoryRepository } from './db.js';
import { startJobs } from './jobs.js';

const config = loadConfig();

let pool = null;
let repo = memoryRepository();
if (config.databaseUrl) {
  pool = createPool(config.databaseUrl);
  await migrate(pool);
  repo = pgRepository(pool);
}

const redis = config.redisUrl ? new Redis(config.redisUrl, { maxRetriesPerRequest: 1, lazyConnect: false }) : undefined;

const app = await buildApp({ config, repo, redis, logger: { level: config.logLevel } });
if (!config.databaseUrl) app.log.warn('DATABASE_URL не задано — результати зберігаються лише в пам’яті');
if (!redis) app.log.warn('REDIS_URL не задано — rate limit у пам’яті процесу');

// Фонові задачі в цьому ж процесі (за замовчуванням) — або окремим воркером (src/worker.js)
const jobs = config.jobs.inline
  ? await startJobs({ ...config.jobs, repo, redisUrl: config.redisUrl, log: app.log })
  : null;
if (jobs) app.log.info(`фонові задачі: ${jobs.mode === 'bullmq' ? 'BullMQ (Redis)' : 'таймер у процесі'}`);

const shutdown = async (signal) => {
  app.log.info(`${signal}: зупинка`);
  try {
    await jobs?.close();
    await app.close();
    await pool?.end();
    redis?.disconnect();
  } finally {
    process.exit(0);
  }
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ host: config.host, port: config.port });
