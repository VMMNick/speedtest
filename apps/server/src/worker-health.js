/**
 * Healthcheck воркера (docker-compose): здоровий, якщо в черзі BullMQ зареєстровано
 * хоча б один активний воркер і розклад задач створено. Код виходу 0 — здоровий.
 *
 *   node apps/server/src/worker-health.js
 */
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { QUEUE_NAME, QUEUE_PREFIX, JOBS } from './jobs.js';

const connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: 1,
  connectTimeout: 2_000,
});
const queue = new Queue(QUEUE_NAME, { connection, prefix: QUEUE_PREFIX });
let healthy = false;
try {
  const [workers, schedulers] = await Promise.all([queue.getWorkersCount(), queue.getJobSchedulers()]);
  healthy = workers > 0 && schedulers.some((s) => s.key === JOBS.providerStatus);
  if (!healthy) console.error(`unhealthy: workers=${workers}, schedulers=${schedulers.length}`);
} catch (err) {
  console.error(`unhealthy: ${err.message}`);
} finally {
  await queue.close().catch(() => {});
  connection.disconnect();
}
process.exit(healthy ? 0 : 1);
