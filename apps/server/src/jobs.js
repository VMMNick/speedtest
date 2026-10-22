/**
 * Фонові задачі на BullMQ (черга в Redis):
 *
 *   provider-status — кожні N хв перевіряє, чи провайдери працюють «як зазвичай» (status.js),
 *                     зберігає знімок і відкриває/закриває інциденти
 *   retention       — раз на добу видаляє анонімні результати, старші за RESULTS_RETENTION_DAYS
 *
 * Розклад — job schedulers BullMQ: скільки б інстансів не працювало, кожна задача
 * виконується один раз за інтервал. Без Redis (локальна розробка) ті самі обробники
 * запускаються простим таймером у процесі.
 */
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { checkProviders, DEFAULT_RULES } from './status.js';

export const QUEUE_NAME = 'speedtest-jobs';
export const QUEUE_PREFIX = 'speedtest:bull';
export const JOBS = /** @type {const} */ ({ providerStatus: 'provider-status', retention: 'retention' });

const DAY = 86_400_000;

/**
 * @typedef {object} JobOptions
 * @property {any} repo                  репозиторій (db.js) зі сховищем стану
 * @property {number} statusEveryMs      інтервал перевірки стану
 * @property {number} retentionDays      скільки днів зберігати результати
 * @property {import('./status.js').StatusRules} [rules]
 * @property {{ info: Function, warn: Function, error: Function }} [log]
 * @property {(transitions: any[]) => Promise<void> | void} [onTransitions] напр. сповіщення
 */

/**
 * Обробники задач — звичайні функції, тож їх тестують без черги.
 * @param {JobOptions} opts
 */
export function createHandlers({ repo, retentionDays, rules = DEFAULT_RULES, log = console, onTransitions }) {
  return {
    async [JOBS.providerStatus]() {
      const { checked, transitions } = await checkProviders(repo, { rules });
      for (const t of transitions) log.info({ job: JOBS.providerStatus, ...t }, `provider status: ${t.isp} → ${t.to}`);
      if (transitions.length) await onTransitions?.(transitions);
      return { checked, transitions: transitions.length };
    },
    async [JOBS.retention]() {
      const deleted = await repo.deleteResultsOlderThan(retentionDays);
      if (deleted) log.info({ job: JOBS.retention, deleted }, `retention: видалено ${deleted} результатів`);
      return { deleted };
    },
  };
}

/**
 * Запускає планувальник і обробник задач.
 * @param {JobOptions & { redisUrl?: string | null }} opts
 * @returns {Promise<{ mode: 'bullmq' | 'timer', run: (name: string) => Promise<any>, close: () => Promise<void> }>}
 */
export async function startJobs(opts) {
  const { redisUrl, statusEveryMs, log = console } = opts;
  const handlers = createHandlers(opts);
  const every = { [JOBS.providerStatus]: statusEveryMs, [JOBS.retention]: DAY };
  const run = (name) => handlers[name]();

  if (!redisUrl) {
    // Без Redis — таймери в процесі: перший запуск одразу, далі за інтервалом
    const safeRun = (name) => run(name).catch((err) => log.error({ err, job: name }, 'job failed'));
    const timers = Object.entries(every).map(([name, ms]) => {
      safeRun(name);
      return setInterval(() => safeRun(name), ms).unref();
    });
    return {
      mode: 'timer',
      run,
      async close() {
        timers.forEach(clearInterval);
      },
    };
  }

  // BullMQ потребує maxRetriesPerRequest: null (блокуючі команди воркера)
  /** @type {Redis[]} */
  const connections = [];
  const connection = () => {
    const c = new Redis(redisUrl, { maxRetriesPerRequest: null });
    connections.push(c);
    return c;
  };
  const queue = new Queue(QUEUE_NAME, {
    connection: connection(),
    prefix: QUEUE_PREFIX,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
      // Історія для діагностики, але без нескінченного росту в Redis
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 200 },
    },
  });
  for (const [name, ms] of Object.entries(every)) {
    await queue.upsertJobScheduler(name, { every: ms }, { name });
  }

  const worker = new Worker(QUEUE_NAME, (job) => run(job.name), {
    connection: connection(),
    prefix: QUEUE_PREFIX,
    concurrency: 1,
  });
  worker.on('failed', (job, err) => log.error({ err, job: job?.name, attempt: job?.attemptsMade }, 'job failed'));
  worker.on('error', (err) => log.error({ err }, 'worker error'));

  return {
    mode: 'bullmq',
    run,
    queue,
    worker,
    async close() {
      await worker.close();
      await queue.close();
      // Передані нами з'єднання BullMQ не закриває сам
      await Promise.all(connections.map((c) => c.quit().catch(() => c.disconnect())));
    },
  };
}
