/**
 * Окремий процес фонових задач (BullMQ). Для кількох інстансів веб-сервера або коли
 * задачі не повинні ділити CPU з API: JOBS_INLINE=false на веб-сервері + цей процес.
 *
 *   node src/worker.js     (docker-compose: сервіс worker)
 */
import { loadConfig } from './config.js';
import { createPool, migrate, pgRepository } from './db.js';
import { startJobs } from './jobs.js';

const config = loadConfig();
const log = {
  info: (obj, msg) => console.warn(JSON.stringify({ level: 'info', time: Date.now(), ...obj, msg })),
  warn: (obj, msg) => console.warn(JSON.stringify({ level: 'warn', time: Date.now(), ...obj, msg })),
  error: (obj, msg) =>
    console.error(JSON.stringify({ level: 'error', time: Date.now(), ...obj, err: obj?.err?.message, msg })),
};

if (!config.databaseUrl || !config.redisUrl) {
  log.error({}, 'worker потребує DATABASE_URL і REDIS_URL');
  process.exit(1);
}

const pool = createPool(config.databaseUrl);
await migrate(pool, { info: (m) => log.info({}, m) });
const jobs = await startJobs({ ...config.jobs, repo: pgRepository(pool), redisUrl: config.redisUrl, log });
log.info({ mode: jobs.mode }, 'worker started');

const shutdown = async (signal) => {
  log.info({ signal }, 'worker stopping');
  try {
    await jobs.close();
    await pool.end();
  } finally {
    process.exit(0);
  }
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
