/**
 * Анонімна статистика результатів.
 *
 *   GET  /api/results/token  — одноразовий токен на старті тесту (див. tokens.js)
 *   POST /api/results        — зберегти результат (токен, валідація JSON Schema, rate limit)
 *   GET  /api/results/stats  — зведення за період
 */

import { bumpDataVersion } from '../cache.js';
import { resultSchema, RESULT_TOKEN_HEADER } from '@speedtest/shared/result-schema';

// Схема спільна з фронтендом — див. packages/shared/result-schema.js
export { resultSchema };

/**
 * @type {import('fastify').FastifyPluginAsync<{
 *   repo: any, perMinute: number, tokensPerMinute: number,
 *   tokens: ReturnType<import('../tokens.js').createTokenService>, redis?: import('ioredis').Redis
 * }>}
 */
export default async function resultsRoutes(app, { repo, perMinute, tokensPerMinute, tokens, redis }) {
  app.get(
    '/api/results/token',
    { config: { rateLimit: { max: tokensPerMinute, timeWindow: '1 minute' } } },
    async (request, reply) => {
      reply.header('cache-control', 'no-store');
      return { token: tokens.issue(), minAgeMs: tokens.minAgeMs, maxAgeMs: tokens.maxAgeMs };
    },
  );

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
      const check = await tokens.consume(request.headers[RESULT_TOKEN_HEADER]);
      if (!check.ok) return reply.code(403).send({ error: 'invalid result token', reason: check.reason });
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
