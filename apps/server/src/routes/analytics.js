/**
 * Аналітика по зібраних результатах (кешується в Redis на 60 с).
 *
 *   GET /api/analytics/providers?days=30&city=Kyiv   — рейтинг провайдерів
 *   GET /api/analytics/cities?days=30                — міста для фільтра
 *   GET /api/analytics/heatmap?days=30&tz=Europe/Kyiv&isp=&city=
 *                                                    — медіана download за днем тижня × годиною
 *
 * Приватність: групи з менш ніж MIN_SAMPLES тестів не показуються (k-анонімність).
 */
import { cached, dataVersion } from '../cache.js';

export const MIN_SAMPLES = 3;
const CACHE_TTL = 60;
/** Чи відомий часовий пояс (Intl приймає і канонічні назви, і аліаси — напр. Europe/Kyiv і Europe/Kiev) */
export function isValidTimeZone(tz) {
  if (!/^[A-Za-z0-9_+\-/]{1,64}$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const common = {
  days: { type: 'integer', minimum: 1, maximum: 365, default: 30 },
  city: { type: 'string', minLength: 1, maxLength: 100 },
};

/** @type {import('fastify').FastifyPluginAsync<{ repo: any, redis?: import('ioredis').Redis }>} */
export default async function analyticsRoutes(app, { repo, redis }) {
  /** Обгортка: кеш + заголовок X-Cache для наочності */
  const serve = async (reply, key, compute) => {
    const version = await dataVersion(redis);
    const { value, hit } = await cached(redis, `speedtest:analytics:v${version}:${key}`, CACHE_TTL, compute);
    reply.header('x-cache', hit ? 'HIT' : 'MISS').header('cache-control', `public, max-age=${CACHE_TTL}`);
    return value;
  };

  app.get(
    '/api/analytics/providers',
    { schema: { querystring: { type: 'object', additionalProperties: false, properties: common } } },
    async (request, reply) => {
      const { days, city = null } = /** @type {any} */ (request.query);
      return serve(reply, `providers:${days}:${city ?? ''}`, () =>
        repo.providers({ days, city, minSamples: MIN_SAMPLES }),
      );
    },
  );

  app.get(
    '/api/analytics/cities',
    { schema: { querystring: { type: 'object', additionalProperties: false, properties: { days: common.days } } } },
    async (request, reply) => {
      const { days } = /** @type {any} */ (request.query);
      return serve(reply, `cities:${days}`, () => repo.cities({ days, minSamples: MIN_SAMPLES }));
    },
  );

  app.get(
    '/api/analytics/heatmap',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ...common,
            isp: { type: 'string', minLength: 1, maxLength: 100 },
            tz: { type: 'string', maxLength: 64, default: 'UTC' },
          },
        },
      },
    },
    async (request, reply) => {
      const { days, tz, isp = null, city = null } = /** @type {any} */ (request.query);
      // Часовий пояс іде в SQL параметром, але все одно перевіряємо формат і що він існує
      if (!isValidTimeZone(tz)) return reply.code(400).send({ error: 'Unknown time zone' });
      return serve(reply, `heatmap:${days}:${tz}:${isp ?? ''}:${city ?? ''}`, () =>
        repo.heatmap({ days, tz, isp, city }),
      );
    },
  );
}
