/**
 * Кеш агрегацій у Redis. Аналітика рахується по всій таблиці — немає сенсу
 * перераховувати її на кожен запит; 60 с затримки для статистики прийнятні.
 * Без Redis (або якщо він недоступний) — просто обчислює без кешу.
 */

/**
 * @template T
 * @param {import('ioredis').Redis | undefined} redis
 * @param {string} key
 * @param {number} ttlSec
 * @param {() => Promise<T>} compute
 * @returns {Promise<{ value: T, hit: boolean }>}
 */
export async function cached(redis, key, ttlSec, compute) {
  if (redis) {
    try {
      const hit = await redis.get(key);
      if (hit !== null) return { value: JSON.parse(hit), hit: true };
    } catch {
      /* Redis недоступний — рахуємо напряму */
    }
  }
  const value = await compute();
  if (redis) redis.set(key, JSON.stringify(value), 'EX', ttlSec).catch(() => {});
  return { value, hit: false };
}

const VERSION_KEY = 'speedtest:analytics:version';

/**
 * Версія даних для ключів кешу. Новий результат збільшує версію —
 * тож аналітика одразу бачить свіжі дані, а старі ключі просто доживають свій TTL.
 * @param {import('ioredis').Redis | undefined} redis
 */
export async function dataVersion(redis) {
  if (!redis) return '0';
  try {
    return (await redis.get(VERSION_KEY)) ?? '0';
  } catch {
    return '0';
  }
}

/** @param {import('ioredis').Redis | undefined} redis */
export async function bumpDataVersion(redis) {
  if (!redis) return;
  await redis.incr(VERSION_KEY).catch(() => {});
}
