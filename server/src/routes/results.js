/**
 * Анонімна статистика результатів.
 *
 *   POST /api/results        — зберегти результат (валідація JSON Schema, rate limit)
 *   GET  /api/results/stats  — зведення за період
 */

import { bumpDataVersion } from '../cache.js';
import { resultSchema } from '../../../shared/result-schema.js';

// Схема спільна з фронтендом — див. shared/result-schema.js
export { resultSchema };

/** @type {import('fastify').FastifyPluginAsync<{ repo: any, perMinute: number, redis?: import('ioredis').Redis }>} */
export default async function resultsRoutes(app, { repo, perMinute, redis }) {
  app.post(
    '/api/results',
    {
      config: { rateLimit: { max: perMinute, timeWindow: '1 minute' } },
      schema: {
        body: resultSchema,
        response: {
          201: {
            type: 'object',
            properties: { id: { type: 'integer' }, createdAt: { type: 'string' } },
          },
        },
      },
    },
    async (request, reply) => {
      const saved = await repo.insert(request.body);
      await bumpDataVersion(redis); // аналітика має одразу побачити новий результат
      return reply.code(201).send(saved);
    },
  );

  app.get(
    '/api/results/stats',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: { days: { type: 'integer', minimum: 1, maximum: 365, default: 30 } },
        },
      },
    },
    async (request) => repo.stats(/** @type {{ days: number }} */ (request.query).days),
  );
}
